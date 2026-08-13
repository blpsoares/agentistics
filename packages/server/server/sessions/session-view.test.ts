import { describe, expect, it } from 'bun:test'
import type { HarnessProcess } from '../live-sessions'
import type { ManagedSession, SessionActivity } from './types'
import type { ReconciledSession } from './session-ref'
import {
  attentionCount, bellTransitions, buildSessionViews, groupSessions, needsAttention,
} from './session-view'

const managed = (id: string, over: Partial<ManagedSession> = {}): ManagedSession => ({
  id, harness: 'claude', cwd: '/repo/a', createdAt: '2026-08-13T10:00:00.000Z', ...over,
})

const row = (id: string, over: Partial<ReconciledSession> = {}): ReconciledSession => ({
  id,
  managed: managed(id),
  backend: { id, createdMs: 1000, attached: false, alive: true, lastActivityMs: 1000 },
  status: 'running',
  ...over,
})

const proc = (over: Partial<HarnessProcess> = {}): HarnessProcess =>
  ({ harness: 'claude', cwd: '/repo/other', startedMs: 5000, ...over })

describe('needsAttention', () => {
  it('counts both waiting states and nothing else', () => {
    expect(needsAttention('waiting')).toBe(true)
    expect(needsAttention('waiting-approval')).toBe(true)
    expect(needsAttention('working')).toBe(false)
    expect(needsAttention('exited')).toBe(false)
    expect(needsAttention(undefined)).toBe(false)
  })
})

describe('buildSessionViews', () => {
  it('carries the registry metadata onto the view', () => {
    const reconciled = [row('a', { managed: managed('a', { label: 'auth', note: 'wip', model: 'opus' }) })]
    const [v] = buildSessionViews({ reconciled, activity: new Map([['a', 'waiting']]), processes: [] })
    expect(v).toMatchObject({
      id: 'a', harness: 'claude', cwd: '/repo/a', label: 'auth', note: 'wip', model: 'opus',
      status: 'running', activity: 'waiting', approvalDetection: true,
    })
  })

  it('says approval detection is unavailable for an unprobed harness', () => {
    const reconciled = [row('a', { managed: managed('a', { harness: 'gemini' }) })]
    const [v] = buildSessionViews({ reconciled, activity: new Map(), processes: [] })
    expect(v!.approvalDetection).toBe(false)
  })

  it('leaves the harness absent for a session the registry has forgotten', () => {
    // `unregistered` means the backend hosts it and the registry does not know it. Which harness it
    // runs is genuinely unknown, and defaulting it to claude would file it under a harness it may
    // not be — in a list whose entire value is being trustworthy.
    const reconciled: ReconciledSession[] = [{
      id: 'u',
      backend: { id: 'u', createdMs: 1000, attached: false, alive: true, lastActivityMs: 1000 },
      status: 'unregistered',
    }]
    const [v] = buildSessionViews({ reconciled, activity: new Map(), processes: [] })
    expect(v!.harness).toBeUndefined()
    expect(v!.approvalDetection).toBe(false)
  })

  it('lists an external process, with no activity claimed for it', () => {
    const views = buildSessionViews({ reconciled: [], activity: new Map(), processes: [proc()] })
    expect(views).toHaveLength(1)
    expect(views[0]!.status).toBe('external')
    expect(views[0]!.activity).toBeUndefined()
    expect(views[0]!.cwd).toBe('/repo/other')
  })

  it('gives an external process a stable id across polls', () => {
    const once = buildSessionViews({ reconciled: [], activity: new Map(), processes: [proc()] })
    const again = buildSessionViews({ reconciled: [], activity: new Map(), processes: [proc()] })
    expect(once[0]!.id).toBe(again[0]!.id)
  })

  it('separates two external processes of the same harness in the same directory', () => {
    // Keyed on the start time as well as harness+cwd: two assistants open in one repo are two rows,
    // and the start time is the only thing that both distinguishes them and survives a poll.
    const views = buildSessionViews({
      reconciled: [],
      activity: new Map(),
      processes: [proc({ startedMs: 1 }), proc({ startedMs: 2 })],
    })
    expect(views).toHaveLength(2)
    expect(views[0]!.id).not.toBe(views[1]!.id)
  })

  it('drops an external process already covered by a managed session', () => {
    // The same running assistant must not appear as a managed row AND an external one — the bug
    // resolveLiveSnapshot already had to fix once.
    const views = buildSessionViews({
      reconciled: [row('a')],
      activity: new Map([['a', 'working']]),
      processes: [proc({ cwd: '/repo/a' })],
    })
    expect(views).toHaveLength(1)
    expect(views[0]!.id).toBe('a')
  })

  it('keeps an external process of a DIFFERENT harness in the same directory', () => {
    const views = buildSessionViews({
      reconciled: [row('a')],
      activity: new Map([['a', 'working']]),
      processes: [proc({ cwd: '/repo/a', harness: 'codex' })],
    })
    expect(views).toHaveLength(2)
  })

  it('sorts what needs answering to the top', () => {
    const reconciled = [row('w'), row('k'), row('ap'), row('x', { status: 'exited' })]
    const activity = new Map<string, SessionActivity>([
      ['w', 'working'], ['k', 'waiting'], ['ap', 'waiting-approval'], ['x', 'exited'],
    ])
    const views = buildSessionViews({ reconciled, activity, processes: [proc()] })
    expect(views.map(v => v.id).slice(0, 4)).toEqual(['ap', 'k', 'w', 'x'])
    expect(views[4]!.status).toBe('external')
  })
})

describe('attentionCount', () => {
  it('counts only the sessions waiting on someone', () => {
    const reconciled = [row('a'), row('b'), row('c')]
    const activity = new Map<string, SessionActivity>([
      ['a', 'waiting-approval'], ['b', 'working'], ['c', 'waiting'],
    ])
    expect(attentionCount(buildSessionViews({ reconciled, activity, processes: [] }))).toBe(2)
  })
})

describe('groupSessions', () => {
  const views = buildSessionViews({
    reconciled: [
      row('a', { managed: managed('a', { harness: 'claude', model: 'opus', cwd: '/repo/x' }) }),
      row('b', { managed: managed('b', { harness: 'codex', model: 'gpt', cwd: '/repo/x' }) }),
      row('c', { managed: managed('c', { harness: 'claude', cwd: '/repo/y' }) }),
    ],
    activity: new Map(),
    processes: [],
  })

  it('groups by harness', () => {
    const g = groupSessions(views, 'harness')
    expect(g.map(x => x.key).sort()).toEqual(['claude', 'codex'])
    expect(g.find(x => x.key === 'claude')!.sessions).toHaveLength(2)
  })

  it('groups by model, with an honest bucket for the ones that never named one', () => {
    const g = groupSessions(views, 'model')
    expect(g.find(x => x.key === '')!.label).toBe('no model recorded')
  })

  it('groups by project on the directory name', () => {
    const g = groupSessions(views, 'project')
    expect(g.map(x => x.label).sort()).toEqual(['x', 'y'])
  })

  it('returns one unnamed group when grouping is off', () => {
    const g = groupSessions(views, 'none')
    expect(g).toHaveLength(1)
    expect(g[0]!.sessions).toHaveLength(3)
  })

  it('gives an unknown harness its own stated bucket rather than folding it into one', () => {
    const unknown = buildSessionViews({
      reconciled: [{
        id: 'u',
        backend: { id: 'u', createdMs: 1, attached: false, alive: true, lastActivityMs: 1 },
        status: 'unregistered',
      }],
      activity: new Map(),
      processes: [],
    })
    const g = groupSessions(unknown, 'harness')
    expect(g[0]!.label).toBe('harness unknown')
  })
})

describe('bellTransitions', () => {
  const views = (activity: SessionActivity) =>
    buildSessionViews({ reconciled: [row('a')], activity: new Map([['a', activity]]), processes: [] })

  it('rings when a session enters attention', () => {
    expect(bellTransitions(new Map([['a', 'working']]), views('waiting'))).toEqual(['a'])
  })

  it('does not ring again while it stays there', () => {
    expect(bellTransitions(new Map([['a', 'waiting']]), views('waiting'))).toEqual([])
  })

  it('rings when it escalates from waiting to a blocking question', () => {
    // Different urgency, and the user chose the terminal bell as the only signal there is.
    expect(bellTransitions(new Map([['a', 'waiting']]), views('waiting-approval'))).toEqual(['a'])
  })

  it('rings for a session seen for the first time already waiting', () => {
    expect(bellTransitions(new Map(), views('waiting'))).toEqual(['a'])
  })

  it('never rings for an external session, whose state is not knowable', () => {
    const external = buildSessionViews({ reconciled: [], activity: new Map(), processes: [proc()] })
    expect(bellTransitions(new Map(), external)).toEqual([])
  })
})
