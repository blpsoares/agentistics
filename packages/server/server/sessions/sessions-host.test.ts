import { describe, expect, it } from 'bun:test'
import type { HarnessProcess } from '../live-sessions'
import type { BackendSession, ManagedSession, SessionBackend } from './types'
import { createSessionsPoller } from './sessions-host'

const NOW = 1_786_600_000_000

const managed = (id: string, over: Partial<ManagedSession> = {}): ManagedSession => ({
  id, harness: 'claude', cwd: '/repo/a', createdAt: '2026-08-13T10:00:00.000Z', ...over,
})

const backendSession = (id: string, over: Partial<BackendSession> = {}): BackendSession => ({
  id,
  createdMs: NOW - 600_000,
  attached: false,
  alive: true,
  // Quiet enough that movement cannot fire, recent enough that a probed marker is still trusted.
  lastActivityMs: NOW - 30_000,
  ...over,
})

function fakeBackend(o: {
  sessions: BackendSession[]
  frames?: Record<string, string[]>
  unavailable?: string
  onCapture?: (id: string) => void
}): SessionBackend {
  return {
    id: 'tmux',
    async unavailable() { return o.unavailable },
    async spawn() {},
    async list() { return o.sessions },
    async capture(id) { o.onCapture?.(id); return o.frames?.[id] ?? [] },
    async kill() { return true },
    attachCommand(id) { return ['tmux', 'attach', id] },
    async detachHint() { return 'Ctrl-b then d' },
    async sendText() { return true },
    async sendKey() { return true },
  }
}

const poller = (o: {
  backend: SessionBackend
  registry?: ManagedSession[]
  processes?: HarnessProcess[]
  now?: () => number
  touchSessions?: (ids: readonly string[], atMs: number) => Promise<unknown>
  heartbeatMs?: number
}) => createSessionsPoller({
  backend: o.backend,
  readRegistry: async () => o.registry ?? [],
  scanProcesses: async () => ({ procs: o.processes ?? [] }),
  now: o.now ?? (() => NOW),
  ...(o.touchSessions ? { touchSessions: o.touchSessions } : {}),
  ...(o.heartbeatMs !== undefined ? { heartbeatMs: o.heartbeatMs } : {}),
})

describe('createSessionsPoller', () => {
  it('reports a quiet session as waiting and counts it', async () => {
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames: { a: ['❯ '] } }),
      registry: [managed('a')],
    })
    const snap = await p.poll()
    expect(snap.sessions[0]!.activity).toBe('waiting')
    expect(snap.attention).toBe(1)
  })

  it('reports a session working from its probed footer', async () => {
    const p = poller({
      backend: fakeBackend({
        sessions: [backendSession('a')],
        frames: { a: ['  ⏸ manual mode on · esc to interrupt · ← 6 agents'] },
      }),
      registry: [managed('a')],
    })
    expect((await p.poll()).sessions[0]!.activity).toBe('working')
    expect((await p.poll()).attention).toBe(0)
  })

  it('sees a frame that changed between two polls as working', async () => {
    const frames: Record<string, string[]> = { a: ['one'] }
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames }),
      registry: [managed('a')],
    })
    expect((await p.poll()).sessions[0]!.activity).toBe('waiting')
    frames.a = ['two']
    expect((await p.poll()).sessions[0]!.activity).toBe('working')
    // Third poll: unchanged again, so it settles back to waiting with no extra interval of lag.
    expect((await p.poll()).sessions[0]!.activity).toBe('waiting')
  })

  it('never captures a dead pane', async () => {
    const captured: string[] = []
    const p = poller({
      backend: fakeBackend({
        sessions: [backendSession('a', { alive: false })],
        onCapture: id => captured.push(id),
      }),
      registry: [managed('a')],
    })
    expect((await p.poll()).sessions[0]!.activity).toBe('exited')
    expect(captured).toEqual([])
  })

  it('rings once on the transition into waiting, not on every poll', async () => {
    const frames: Record<string, string[]> = { a: ['esc to interrupt'] }
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames }),
      registry: [managed('a')],
    })
    expect((await p.poll()).rang).toEqual([])

    // The turn ends. The poll that OBSERVES the ending sees a frame that changed since the last
    // one, which is movement — so the session still reads `working` for this one interval. That is
    // not a defect to design around: the alternative is to stop trusting movement, which is the
    // only working signal codex has at all. The bell is therefore at most one interval late, and
    // never early, which is the right way round for a signal a person acts on.
    frames.a = ['done']
    expect((await p.poll()).sessions[0]!.activity).toBe('working')

    // Next poll: the frame is unchanged and the session has settled.
    const settled = await p.poll()
    expect(settled.sessions[0]!.activity).toBe('waiting')
    expect(settled.rang).toEqual(['a'])

    // And it does not ring again while it stays there.
    expect((await p.poll()).rang).toEqual([])
  })

  it('reports the backend own reason instead of an empty list', async () => {
    const p = poller({ backend: fakeBackend({ sessions: [], unavailable: 'tmux is not installed' }) })
    const snap = await p.poll()
    expect(snap.unavailable).toBe('tmux is not installed')
    expect(snap.sessions).toEqual([])
  })

  it('keeps the previous snapshot when a poll throws, rather than reporting zero', async () => {
    let fail = false
    const backend = fakeBackend({ sessions: [backendSession('a')], frames: { a: ['x'] } })
    const broken: SessionBackend = {
      ...backend,
      async list() {
        if (fail) throw new Error('boom')
        return [backendSession('a')]
      },
    }
    const p = poller({ backend: broken, registry: [managed('a')] })
    await p.poll()
    fail = true
    const snap = await p.poll()
    expect(snap.sessions).toHaveLength(1)
    expect(snap.unavailable).toContain('boom')
  })

  it('includes external processes the backend does not host', async () => {
    const p = poller({
      backend: fakeBackend({ sessions: [] }),
      processes: [{ harness: 'codex', cwd: '/repo/z', startedMs: NOW - 1000 }],
    })
    const snap = await p.poll()
    expect(snap.sessions).toHaveLength(1)
    expect(snap.sessions[0]!.status).toBe('external')
    expect(snap.attention).toBe(0)
  })
})

describe('the heartbeat', () => {
  it('stamps every ALIVE session on the first poll, so a fleet already up is on record', () => {
    // `-Infinity` as the initial mark is what makes this true. A control center opened onto a fleet
    // that was already running would otherwise carry no evidence of life until a minute in, and
    // would sit out a fall that happened in that minute.
    const calls: Array<{ ids: readonly string[]; atMs: number }> = []
    const p = poller({
      backend: fakeBackend({
        sessions: [backendSession('a'), backendSession('dead', { alive: false })],
      }),
      registry: [managed('a'), managed('dead')],
      touchSessions: async (ids, atMs) => { calls.push({ ids, atMs }) },
    })
    return p.poll().then(() => {
      expect(calls).toHaveLength(1)
      // A dead pane is not alive. Stamping it would put a session that ended on its own into the
      // same cluster as the ones a reboot took.
      expect(calls[0]!.ids).toEqual(['a'])
      expect(calls[0]!.atMs).toBe(NOW)
    })
  })

  it('does not write on every poll — the poll runs every five seconds', async () => {
    let n = 0
    let clock = NOW
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')] }),
      registry: [managed('a')],
      touchSessions: async () => { n++ },
      now: () => clock,
      heartbeatMs: 60_000,
    })
    await p.poll()
    expect(n).toBe(1)
    clock += 5_000
    await p.poll()
    clock += 5_000
    await p.poll()
    expect(n).toBe(1)
    clock += 60_000
    await p.poll()
    expect(n).toBe(2)
  })

  it('keeps polling when the registry cannot be written', async () => {
    // A registry that cannot be written costs the crash group, not the fleet on screen.
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames: { a: ['x'] } }),
      registry: [managed('a')],
      touchSessions: async () => { throw new Error('read-only filesystem') },
    })
    const snap = await p.poll()
    expect(snap.unavailable).toBeUndefined()
    expect(snap.sessions).toHaveLength(1)
  })
})

describe('the sessions that fell together', () => {
  it('marks the rows and reports the group when the backend has lost them', async () => {
    const p = poller({
      backend: fakeBackend({ sessions: [] }),
      registry: [
        managed('a', { lastSeenMs: NOW - 10_000 }),
        managed('b', { lastSeenMs: NOW - 10_000 }),
      ],
    })
    const snap = await p.poll()
    expect(snap.fell?.entries.map(e => e.id)).toEqual(['a', 'b'])
    expect(snap.sessions.every(v => v.fell === true)).toBe(true)
  })

  it('says nothing when there is nothing to say', async () => {
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames: { a: ['x'] } }),
      registry: [managed('a', { lastSeenMs: NOW })],
    })
    const snap = await p.poll()
    expect(snap.fell).toBeUndefined()
    expect(snap.sessions[0]!.fell).toBeUndefined()
  })

  it('keeps the group when a poll fails, alongside the sessions it describes', async () => {
    let fail = false
    const backend = fakeBackend({ sessions: [] })
    const broken: SessionBackend = {
      ...backend,
      async list() {
        if (fail) throw new Error('boom')
        return []
      },
    }
    const p = poller({ backend: broken, registry: [managed('a', { lastSeenMs: NOW })] })
    await p.poll()
    fail = true
    const snap = await p.poll()
    expect(snap.fell?.entries.map(e => e.id)).toEqual(['a'])
    expect(snap.unavailable).toContain('boom')
  })
})

describe('the dialog a blocked session is showing', () => {
  const DIALOG = [
    '● running the migration',
    '│ Do you want to proceed?  │',
    '│ ❯ 1. Yes                 │',
    '│ Enter to confirm · Esc to cancel │',
  ]

  it('carries the bottom of the screen, verbatim, only while it is asking', async () => {
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames: { a: DIALOG } }),
      registry: [managed('a')],
    })
    const snap = await p.poll()
    expect(snap.sessions[0]!.activity).toBe('waiting-approval')
    // The options and the highlight, which nothing else on the screen carries: `lastLines` cuts at
    // the last rule and would hand back the conversation above the dialog.
    expect(snap.sessions[0]!.approvalLines?.join('\n')).toContain('❯ 1. Yes')
  })

  it('carries nothing on a session that is not blocked', async () => {
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames: { a: ['❯ '] } }),
      registry: [managed('a')],
    })
    expect((await p.poll()).sessions[0]!.approvalLines).toBeUndefined()
  })
})
