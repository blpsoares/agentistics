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
  }
}

const poller = (o: {
  backend: SessionBackend
  registry?: ManagedSession[]
  processes?: HarnessProcess[]
  now?: () => number
}) => createSessionsPoller({
  backend: o.backend,
  readRegistry: async () => o.registry ?? [],
  scanProcesses: async () => ({ procs: o.processes ?? [] }),
  now: o.now ?? (() => NOW),
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
