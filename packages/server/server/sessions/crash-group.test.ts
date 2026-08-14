import { describe, expect, it } from 'bun:test'
import { CRASH_WINDOW_MS, HEARTBEAT_MS, planCrashGroup } from './crash-group'
import type { ManagedSession } from './types'

const NOW = 1_786_700_000_000

const row = (id: string, over: Partial<ManagedSession> = {}): ManagedSession => ({
  id,
  harness: 'claude',
  cwd: '/repo/a',
  createdAt: '2026-08-13T10:00:00.000Z',
  lastSeenMs: NOW,
  ...over,
})

const ids = (o: ReturnType<typeof planCrashGroup>) => (o?.entries ?? []).map(e => e.id)

describe('planCrashGroup', () => {
  it('groups the sessions the backend no longer knows about, sharing one heartbeat', () => {
    const group = planCrashGroup({
      entries: [row('a'), row('b'), row('c')],
      backendIds: new Set(),
    })
    expect(ids(group)).toEqual(['a', 'b', 'c'])
    expect(group?.atMs).toBe(NOW)
  })

  it('keeps registry order, so a task comes back the way it was built', () => {
    const group = planCrashGroup({
      entries: [row('c'), row('a'), row('b')],
      backendIds: new Set(),
    })
    expect(ids(group)).toEqual(['c', 'a', 'b'])
  })

  // --- the garbage rules, which are the whole point ------------------------------------------

  it('never includes a session the user FINISHED — that is a decision, not a fall', () => {
    const group = planCrashGroup({
      entries: [row('a'), row('done', { endedAt: '2026-08-13T11:00:00.000Z' })],
      backendIds: new Set(),
    })
    expect(ids(group)).toEqual(['a'])
  })

  it('never includes a session the backend still holds, running or exited', () => {
    // tmux keeps a finished session listable (`remain-on-exit`), so a command that ended on its own
    // is still something the backend can name. Nothing took it.
    const group = planCrashGroup({
      entries: [row('a'), row('alive'), row('deadPane')],
      backendIds: new Set(['alive', 'deadPane']),
    })
    expect(ids(group)).toEqual(['a'])
  })

  it('never includes a row with no evidence it was ever alive', () => {
    // A registry written by an older build, or a row this process never once saw. It is EXCLUDED
    // rather than guessed at from `createdAt` — which is equally true of a session abandoned three
    // weeks ago, and is exactly how a crash group turns into a list of everything that ever ran.
    const group = planCrashGroup({
      entries: [row('a'), row('legacy', { lastSeenMs: undefined })],
      backendIds: new Set(),
    })
    expect(ids(group)).toEqual(['a'])
  })

  it('refuses a lastSeenMs that is not a real number, however the file got that way', () => {
    // `managed-sessions.json` is hand-editable. A NaN reaching the comparison below would put an
    // always-false test in charge of which sessions get reopened.
    const group = planCrashGroup({
      entries: [row('a'), row('junk', { lastSeenMs: Number.NaN })],
      backendIds: new Set(),
    })
    expect(ids(group)).toEqual(['a'])
  })

  it('leaves out an OLDER fall — a machine that crashed twice has two events, not one', () => {
    const group = planCrashGroup({
      entries: [
        row('old', { lastSeenMs: NOW - 3 * 24 * 60 * 60_000 }),
        row('new1'),
        row('new2'),
      ],
      backendIds: new Set(),
    })
    expect(ids(group)).toEqual(['new1', 'new2'])
    expect(group?.atMs).toBe(NOW)
  })

  it('is null when nothing qualifies, rather than an empty group', () => {
    expect(planCrashGroup({ entries: [], backendIds: new Set() })).toBeNull()
    expect(planCrashGroup({
      entries: [row('a', { endedAt: 'x' })],
      backendIds: new Set(),
    })).toBeNull()
  })

  // --- the window ----------------------------------------------------------------------------

  it('absorbs one heartbeat of spread, which is the widest a genuine fall can be', () => {
    // The oldest possible member carries the previous heartbeat's stamp while a session created
    // just after it carries its own creation stamp. That gap is one interval, and no more.
    const group = planCrashGroup({
      entries: [row('older', { lastSeenMs: NOW - HEARTBEAT_MS }), row('newer')],
      backendIds: new Set(),
    })
    expect(ids(group)).toEqual(['older', 'newer'])
  })

  it('is wider than the heartbeat, or a real fall would be split into two groups', () => {
    expect(CRASH_WINDOW_MS).toBeGreaterThan(HEARTBEAT_MS)
  })

  it('excludes anything outside the window, erring toward leaving a real casualty out', () => {
    // The deliberate direction of the error: a session wrongly left out is still on screen with its
    // own Reopen verb — one keypress. A session wrongly let in is invisible, and makes the whole
    // group untrustworthy.
    const group = planCrashGroup({
      entries: [row('edge', { lastSeenMs: NOW - CRASH_WINDOW_MS - 1 }), row('now')],
      backendIds: new Set(),
    })
    expect(ids(group)).toEqual(['now'])
  })

  it('includes a lone session — one thing open when the laptop died is one thing that fell', () => {
    const group = planCrashGroup({ entries: [row('a')], backendIds: new Set() })
    expect(ids(group)).toEqual(['a'])
  })

  it('says nothing about whether a row can be RESUMED — that is planTaskReopen business', () => {
    // Filtering unresolvable rows here would make the group quietly smaller than the fall it
    // describes; `planTaskReopen` already reports them as skipped AND counted.
    const group = planCrashGroup({
      entries: [row('a', { harness: 'gemini' })],
      backendIds: new Set(),
    })
    expect(ids(group)).toEqual(['a'])
  })
})
