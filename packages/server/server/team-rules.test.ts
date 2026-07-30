import { describe, it, test, expect, afterAll } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionMeta, WorkflowRun, StatsCache } from '@agentistics/core'
import { planRulesReconcile, emptyRulesState, loadRulesState, saveRulesState } from './team-rules'
import { denialSignature, deniedDeltaByDay, attributionBoundary, buildPathRepoIndex } from './share-rules'
import { __setTeamConnDirForTests, TEAM_CONN_DIR } from './config'

const s = (id: string, remote: string): SessionMeta => ({
  session_id: id, project_path: `/p/${id}`, git_remote: remote,
  start_time: '2026-07-20T10:00:00.000Z', harness: 'claude',
} as SessionMeta)

function run(runId: string, sessionId: string): WorkflowRun {
  return {
    runId, name: 'audit', sessionId, status: 'completed', startedAt: '2026-07-20T10:00:00.000Z',
    durationMs: 0, phases: [], agents: [],
    totals: { agentCount: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, durationMs: 0, toolUses: 0 },
  }
}

const base = {
  sentRunIds: [] as string[], workflows: [] as WorkflowRun[],
  real: { lastComputedDate: '2026-07-01', dailyActivity: [], totalSessions: 0, hourCounts: {} } as unknown as StatsCache,
  prev: emptyRulesState(),
}

describe('planRulesReconcile', () => {
  it('asks to forget exactly the sessions that are BOTH sent and denied', () => {
    const sessions = [s('a', 'github.com/o/pub'), s('b', 'github.com/o/secret')]
    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'],
      sentHashes: { a: 'h1', b: 'h2' }, storedSessions: sessions, liveSessions: sessions,
    })
    expect(plan.forgetIds).toEqual(['b'])
  })

  // R4, the one that costs data: a session missing from the store is NOT a denied session.
  it('never asks to forget a session that is merely absent from the store', () => {
    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'],
      sentHashes: { a: 'h1', gone: 'h2' },
      storedSessions: [s('a', 'github.com/o/pub')], liveSessions: [s('a', 'github.com/o/pub')],
    })
    expect(plan.forgetIds).toEqual([])
  })

  it('returns an empty plan when the store is empty, whatever the denylist says', () => {
    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'],
      sentHashes: { a: 'h1' }, storedSessions: [], liveSessions: [],
    })
    expect(plan.forgetIds).toEqual([])
    expect(plan.forgetRuns).toEqual([])
  })

  // R19: upgrade day must not become a fleet-wide removal.
  it('treats a missing rulesHash as "no restrictions", not as a change', () => {
    const plan = planRulesReconcile({
      ...base, deniedRepos: [], sentHashes: {}, storedSessions: [s('a', 'github.com/o/pub')],
      liveSessions: [s('a', 'github.com/o/pub')], prev: { ...emptyRulesState(), rulesHash: '' },
    })
    expect(plan.rulesChanged).toBe(false)
    expect(plan.next.rulesHash).toBe(denialSignature([]))
  })

  it('reports rulesChanged when the denylist changed, and not on a reorder or case variant', () => {
    const sessions = [s('a', 'github.com/o/pub')]
    const prevWithRule = {
      ...emptyRulesState(),
      rulesHash: denialSignature(['github.com/o/r1', 'github.com/o/r2']),
    }

    const changed = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/r1'],
      sentHashes: {}, storedSessions: sessions, liveSessions: sessions,
      prev: prevWithRule,
    })
    expect(changed.rulesChanged).toBe(true)

    const reordered = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/r2', 'github.com/o/r1'],
      sentHashes: {}, storedSessions: sessions, liveSessions: sessions,
      prev: prevWithRule,
    })
    expect(reordered.rulesChanged).toBe(false)

    const caseVariant = planRulesReconcile({
      ...base, deniedRepos: ['GitHub.com/O/R1', 'github.com/o/R2'],
      sentHashes: {}, storedSessions: sessions, liveSessions: sessions,
      prev: prevWithRule,
    })
    expect(caseVariant.rulesChanged).toBe(false)
  })

  it('drops a workflow run whose session became denied, from sentRunIds', () => {
    const sessions = [s('a', 'github.com/o/pub'), s('b', 'github.com/o/secret')]
    const workflows = [run('r1', 'a'), run('r2', 'b'), run('r3', 'unsent')]
    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'],
      sentHashes: {}, sentRunIds: ['r1', 'r2'], workflows,
      storedSessions: sessions, liveSessions: sessions,
    })
    expect(plan.forgetRuns).toEqual(['r2'])
  })

  it('seals a day that has crossed the watermark and never re-seals it', () => {
    // lastComputedDate is 2026-07-01, so the boundary is 2026-07-02: the 07-20 session below is
    // still decomposable (>= boundary) the first cycle, and PENDING rather than sealed.
    const denySession = { ...s('b', 'github.com/o/secret'), start_time: '2026-07-20T10:00:00.000Z' }
    const pubSession = { ...s('a', 'github.com/o/pub'), start_time: '2026-07-20T11:00:00.000Z' }
    const sessions = [pubSession, denySession]
    const denied = ['github.com/o/secret']

    const first = planRulesReconcile({
      ...base, deniedRepos: denied, sentHashes: {},
      storedSessions: sessions, liveSessions: sessions,
    })
    // Still inside the decomposable window: pending holds the day, nothing sealed yet.
    expect(first.next.sealed['2026-07-20']).toBeUndefined()
    expect(first.next.pending['2026-07-20']?.sessionCount).toBe(1)

    // Now Claude's own watermark has advanced past 07-20 — the day has crossed into prehistory.
    const advancedReal = { ...base.real, lastComputedDate: '2026-07-21' } as StatsCache
    const second = planRulesReconcile({
      ...base, deniedRepos: denied, sentHashes: {},
      storedSessions: sessions, liveSessions: sessions,
      real: advancedReal, prev: first.next,
    })
    expect(second.next.sealed['2026-07-20']?.sessionCount).toBe(1)

    // A day already sealed is measured once and never re-measured: adding a THIRD denied session
    // on 07-20 to the store must not change the frozen seal for that day.
    const grownSessions = [...sessions, { ...s('c', 'github.com/o/secret'), start_time: '2026-07-20T12:00:00.000Z' }]
    const third = planRulesReconcile({
      ...base, deniedRepos: denied, sentHashes: {},
      storedSessions: grownSessions, liveSessions: grownSessions,
      real: advancedReal, prev: second.next,
    })
    expect(third.next.sealed['2026-07-20']?.sessionCount).toBe(1)
  })

  // Important 1 (review fix): the seal ledger's only consumer is buildSplitStatsCache's
  // subtraction against `real`, and `real` is supplemented from `liveSessions` — never from
  // `storedSessions` (pushOnceDetailed, team-uploader.ts). Measuring the delta over the wrong
  // array under/over-subtracts once the two genuinely disagree (buildSplitStatsCache's own
  // precondition comment measured 5 stored sessions against 12 in the cache for one real day).
  it('measures the seal ledger over liveSessions, never storedSessions', () => {
    const pub = { ...s('pub', 'github.com/o/pub'), start_time: '2026-07-20T09:00:00.000Z' }
    const liveOnlyDenied = { ...s('live-denied', 'github.com/o/secret'), start_time: '2026-07-20T10:00:00.000Z' }
    const storeOnlyDenied = { ...s('store-denied', 'github.com/o/secret'), start_time: '2026-07-20T11:00:00.000Z' }

    // Present in liveSessions but absent from storedSessions: DOES contribute to the delta.
    const liveContributes = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'], sentHashes: {},
      storedSessions: [pub], liveSessions: [pub, liveOnlyDenied],
    })
    expect(liveContributes.next.pending['2026-07-20']?.sessionCount).toBe(1)

    // Present in storedSessions but absent from liveSessions: does NOT contribute — the ledger
    // is measured against the array `real` was actually built from.
    const storeOnlyExcluded = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'], sentHashes: {},
      storedSessions: [pub, storeOnlyDenied], liveSessions: [pub],
    })
    expect(storeOnlyExcluded.next.pending['2026-07-20']).toBeUndefined()
  })

  // Important 3 (review fix): a null `real` means there is no watermark to test days against, so
  // `boundary` is `null` and `deniedDeltaByDay`'s day filter never fires — measuring anything in
  // that state would fold genuine prehistory (once a real cache later appears) into `pending`,
  // producing a seal that is permanently wrong. The ledger must be carried forward untouched.
  it('carries the seal ledger forward unchanged when real is null, never measuring into it', () => {
    const denySession = { ...s('b', 'github.com/o/secret'), start_time: '2020-01-01T10:00:00.000Z' }
    const sessions = [s('a', 'github.com/o/pub'), denySession]
    const prevWithPending: ReturnType<typeof emptyRulesState> = {
      ...emptyRulesState(),
      pending: { '2019-12-31': { sessionCount: 5, messageCount: 0, toolCallCount: 0, tokensByModel: {}, usageByModel: {}, hourCounts: {} } },
    }
    const plan = planRulesReconcile({
      ...base, real: null, deniedRepos: ['github.com/o/secret'], sentHashes: {},
      storedSessions: sessions, liveSessions: sessions, prev: prevWithPending,
    })
    expect(plan.next.boundary).toBeNull()
    expect(plan.next.pending).toEqual(prevWithPending.pending)
    expect(plan.next.sealed).toEqual(prevWithPending.sealed)
  })

  // Controller item A: forgetRuns is a denial-only intersection, NOT `sentRunIds ∖ sharedRunIds`
  // — a run in `sentRunIds` whose owning session is merely absent from the store must survive.
  it('forgets a run only when its owning session is actively denied, never merely absent', () => {
    const sessions = [s('a', 'github.com/o/pub'), s('b', 'github.com/o/secret')]
    const workflows = [run('r1', 'b'), run('r2', 'gone')]
    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'],
      sentHashes: {}, sentRunIds: ['r1', 'r2'], workflows,
      storedSessions: sessions, liveSessions: sessions,
    })
    // r1's session ('b') is present in the store AND denied -> forgotten.
    expect(plan.forgetRuns).toContain('r1')
    // r2's session ('gone') is simply absent from the store -> NOT forgotten, even though r2 is
    // in sentRunIds -- absence is not denial.
    expect(plan.forgetRuns).toEqual(['r1'])
  })

  // Controller item B (1/2): a session with no git_remote of its own is resolved through the
  // PathRepoIndex, learned from a sibling session at the same project_path.
  it('resolves a denied session with an empty git_remote through the PathRepoIndex', () => {
    const seedSession = { ...s('seed', 'github.com/o/secret'), project_path: '/repo/secret' }
    const target = { ...s('b', ''), project_path: '/repo/secret' }
    const index = buildPathRepoIndex([seedSession])

    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'], sentHashes: { b: 'h1' },
      storedSessions: [target], liveSessions: [target], index,
    })
    expect(plan.forgetIds).toEqual(['b'])
  })

  // Controller item B (2/2): "growth never deletes" — a denylist growing to include a repository
  // that was never sent changes rulesChanged (the hash differs) but must not produce a
  // forgetIds entry for a session that was never actually denied.
  it('a growing denylist reports rulesChanged=true with an empty forgetIds when nothing sent is actually denied', () => {
    const sessions = [s('a', 'github.com/o/pub')]
    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/unrelated'],
      sentHashes: { a: 'h1' }, storedSessions: sessions, liveSessions: sessions,
      prev: { ...emptyRulesState(), rulesHash: denialSignature([]) },
    })
    expect(plan.rulesChanged).toBe(true)
    expect(plan.forgetIds).toEqual([])
  })
})

// Sanity cross-check against share-rules.ts's own primitives, so this module's seal test above
// is not the only place the boundary/seal arithmetic is exercised.
test('attributionBoundary/deniedDeltaByDay agree with the fixture used above', () => {
  const boundary = attributionBoundary(base.real)
  expect(boundary).toBe('2026-07-02')
  const denySession = { ...s('b', 'github.com/o/secret'), start_time: '2026-07-20T10:00:00.000Z' }
  const pubSession = { ...s('a', 'github.com/o/pub'), start_time: '2026-07-20T11:00:00.000Z' }
  const delta = deniedDeltaByDay([pubSession, denySession], [pubSession], boundary)
  expect(delta['2026-07-20']?.sessionCount).toBe(1)
})

// ---------------------------------------------------------------------------
// loadRulesState / saveRulesState — the only impure functions in this module.
// ---------------------------------------------------------------------------

describe('loadRulesState / saveRulesState', () => {
  const original = TEAM_CONN_DIR
  const tmp = mkdtempSync(join(tmpdir(), 'agentistics-team-rules-'))
  __setTeamConnDirForTests(tmp)

  afterAll(() => {
    __setTeamConnDirForTests(original)
  })

  const connId = 'c_abcdef012345'

  it('returns emptyRulesState() when nothing has been saved yet', async () => {
    const state = await loadRulesState('c_000000000000')
    expect(state).toEqual(emptyRulesState())
  })

  it('round-trips a saved state', async () => {
    const state = {
      rulesHash: denialSignature(['github.com/o/r']),
      sharedIds: ['a', 'b'],
      boundary: '2026-07-02',
      sealed: { '2026-07-01': { sessionCount: 1, messageCount: 0, toolCallCount: 0, tokensByModel: {}, usageByModel: {}, hourCounts: {} } },
      pending: {},
    }
    await saveRulesState(connId, state)
    expect(await loadRulesState(connId)).toEqual(state)
  })

  it('treats corrupt JSON as emptyRulesState(), never a thrown error', async () => {
    const { writeFile } = await import('node:fs/promises')
    const { teamRulesFile } = await import('./config')
    await writeFile(teamRulesFile('c_111111111111'), 'not json{{', 'utf-8')
    expect(await loadRulesState('c_111111111111')).toEqual(emptyRulesState())
  })
})

// ---------------------------------------------------------------------------
// Important 2 (review fix): saveRulesState must swallow a write failure rather than throw.
// `reconcileRulesFor` in team-uploader.ts awaits this BEFORE reconcileSyncState/pushOnceDetailed
// — an unguarded throw here would take the whole push down with it, persistently (the same write
// fails every cycle), which is reachable whenever TEAM_CONN_DIR itself failed to be created.
// ---------------------------------------------------------------------------

describe('saveRulesState swallows a write failure', () => {
  const original = TEAM_CONN_DIR

  afterAll(() => {
    __setTeamConnDirForTests(original)
  })

  it('does not throw when the connection directory does not exist', async () => {
    const missingDir = join(tmpdir(), `agentistics-team-rules-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    __setTeamConnDirForTests(missingDir)
    // writeFile does not create missing intermediate directories, so this reproduces the
    // ENOENT the review found reachable (only migrateTeamStateOnce creates TEAM_CONN_DIR, and
    // its own failure is caught-and-warned rather than surfaced).
    await expect(saveRulesState('c_333333333333', emptyRulesState())).resolves.toBeUndefined()
    // And a subsequent load sees nothing was persisted — never a partial/corrupt file either.
    expect(await loadRulesState('c_333333333333')).toEqual(emptyRulesState())
  })
})
