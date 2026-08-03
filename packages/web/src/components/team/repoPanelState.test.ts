import { test, expect } from 'bun:test'
import { NO_REPO_KEY } from '@agentistics/core'
import type { ShareTarget } from '../../lib/shareRepos'
import { fmtDateLocalized } from '../../lib/dateFormat'
import type { ConnectionStatusEntry } from './statusTypes'
import {
  buildInitialDraft, toggleTarget, shareAllDraft, blockAllDraft, synthesizeMissingDenied,
  buildRows, groupRows, diffDraft, isDirty, keepVisibleKeys, computeApplyImpact,
  hasProvenPrehistory, resolveConfirmVariant, statsCopyVars, isLocked,
  isApplyBusy, canEditRepos, resolveApplyBanner, resolveReadViewSummary, resolveCardActionsHidden,
  type DraftDiff,
} from './repoPanelState'

function t(over: Partial<ShareTarget>): ShareTarget {
  return {
    key: 'github.com/org/repo', kind: 'repo', name: 'org/repo', host: 'github.com',
    sessions: 1, lastActive: '', orphan: false, conflictPaths: [],
    ...over,
  }
}

// --- 1. grouping: blocked first, shared second, each sessions-desc; a toggled row moves group ---

test('grouping: blocked and shared are each sessions-desc, and toggling moves a row between groups', () => {
  const targets = [
    t({ key: 'a', name: 'a', sessions: 1 }),
    t({ key: 'b', name: 'b', sessions: 5 }),
    t({ key: 'c', name: 'c', sessions: 3 }),
  ]
  const draft = new Set(['a', 'c']) // a, c denied; b shared
  const rows = buildRows(targets, draft)
  const grouped = groupRows(rows, '', new Set())
  expect(grouped.blocked.map(r => r.target.key)).toEqual(['c', 'a']) // 3 desc 1
  expect(grouped.shared.map(r => r.target.key)).toEqual(['b'])

  // toggle 'b' to blocked -> moves into the blocked group
  const draft2 = toggleTarget(draft, targets[1]!, false)
  const rows2 = buildRows(targets, draft2)
  const grouped2 = groupRows(rows2, '', new Set())
  expect(grouped2.blocked.map(r => r.target.key).sort()).toEqual(['a', 'b', 'c'].sort())
  expect(grouped2.shared.length).toBe(0)
})

// --- 2. search filters by name and host, case-insensitively, and never hides a just-toggled row ---

test('search filters case-insensitively by name and by host', () => {
  const targets = [
    t({ key: 'a', name: 'Acme/Api', host: 'GitHub.com', sessions: 2 }),
    t({ key: 'b', name: 'Other/Thing', host: 'gitlab.com', sessions: 1 }),
  ]
  const rows = buildRows(targets, new Set())
  expect(groupRows(rows, 'acme', new Set()).shared.map(r => r.target.key)).toEqual(['a'])
  expect(groupRows(rows, 'GITHUB', new Set()).shared.map(r => r.target.key)).toEqual(['a'])
  expect(groupRows(rows, 'gitlab', new Set()).shared.map(r => r.target.key)).toEqual(['b'])
  expect(groupRows(rows, 'nomatch', new Set()).shared).toEqual([])
})

test('a row the user just toggled is never hidden by a search query that no longer matches it', () => {
  const targets = [
    t({ key: 'a', name: 'Acme/Api', host: 'github.com', sessions: 2 }),
    t({ key: 'b', name: 'Other/Thing', host: 'gitlab.com', sessions: 1 }),
  ]
  const stored = new Set<string>()
  const draft = toggleTarget(stored, targets[0]!, false) // block 'a'
  const diff = diffDraft(draft, stored)
  const keepVisible = keepVisibleKeys(diff)
  const rows = buildRows(targets, draft)
  // search for something that matches neither row's name/host
  const grouped = groupRows(rows, 'zzzz-no-match', keepVisible)
  expect(grouped.blocked.map(r => r.target.key)).toEqual(['a'])
  expect(grouped.shared).toEqual([])
})

// --- 3. orphan rows are excluded from both main groups and land in stale -------------------------

test('a denied repository with zero sessions lands only in stale, never blocked/shared', () => {
  const targets = [
    t({ key: 'a', name: 'a', sessions: 3 }),
    t({ key: 'gone', name: 'gone', sessions: 0 }),
  ]
  const draft = new Set(['a', 'gone'])
  const rows = buildRows(targets, draft)
  const grouped = groupRows(rows, '', new Set())
  expect(grouped.blocked.map(r => r.target.key)).toEqual(['a'])
  expect(grouped.shared).toEqual([])
  expect(grouped.stale.map(r => r.target.key)).toEqual(['gone'])
})

test('a zero-session repository that is NOT denied appears in neither group (nothing to show)', () => {
  const targets = [t({ key: 'ghost', name: 'ghost', sessions: 0 })]
  const rows = buildRows(targets, new Set())
  const grouped = groupRows(rows, '', new Set())
  expect(grouped.blocked).toEqual([])
  expect(grouped.shared).toEqual([])
  expect(grouped.stale).toEqual([])
})

test('synthesizeMissingDenied adds a row for a denied key absent from targets, and leaves existing rows untouched', () => {
  const targets = [t({ key: 'present', name: 'present', sessions: 2 })]
  const out = synthesizeMissingDenied(targets, ['github.com/org/vanished', NO_REPO_KEY], 'No repository')
  expect(out.length).toBe(3)
  const vanished = out.find(x => x.key === 'github.com/org/vanished')!
  expect(vanished.sessions).toBe(0)
  expect(vanished.orphan).toBe(true)
  expect(vanished.kind).toBe('repo')
  const none = out.find(x => x.key === NO_REPO_KEY)!
  expect(none.kind).toBe('none')
  expect(none.name).toBe('No repository')
  expect(out.find(x => x.key === 'present')).toEqual(targets[0])
})

// --- 4. a conflictPaths row is reported locked and forced blocked; blockAll/shareAll can't unlock it ---

test('a conflictPaths row is locked, forced blocked in the initial draft, and immune to toggling / shareAll', () => {
  const locked = t({ key: 'mixed', name: 'mixed', sessions: 4, conflictPaths: ['/workspace'] })
  const unlocked = t({ key: 'clean', name: 'clean', sessions: 2 })
  const targets = [locked, unlocked]

  expect(isLocked(locked)).toBe(true)
  expect(isLocked(unlocked)).toBe(false)

  // Not previously denied at all — still forced into the initial draft.
  const draft = buildInitialDraft(targets, [])
  expect(draft.has('mixed')).toBe(true)

  // A direct toggle attempting to "share" it is a no-op.
  const afterToggle = toggleTarget(draft, locked, true)
  expect(afterToggle.has('mixed')).toBe(true)

  // shareAll unlocks everything EXCEPT locked rows.
  const shared = shareAllDraft(targets)
  expect(shared.has('mixed')).toBe(true)
  expect(shared.has('clean')).toBe(false)

  const rows = buildRows(targets, shared)
  const mixedRow = rows.find(r => r.target.key === 'mixed')!
  expect(mixedRow.denied).toBe(true)
  expect(mixedRow.locked).toBe(true)
})

// --- 5. shareAll / blockAll produce the expected draft; blockAll keeps NO_REPO_KEY blocked --------

test('shareAll empties the draft (except locked rows) and blockAll denies everything plus NO_REPO_KEY', () => {
  const targets = [
    t({ key: 'a', sessions: 3 }),
    t({ key: 'b', sessions: 1 }),
    t({ key: NO_REPO_KEY, kind: 'none', name: 'No repository', host: '', sessions: 2 }),
  ]
  const shared = shareAllDraft(targets)
  expect([...shared]).toEqual([])

  const blocked = blockAllDraft(targets)
  expect(blocked.has('a')).toBe(true)
  expect(blocked.has('b')).toBe(true)
  expect(blocked.has(NO_REPO_KEY)).toBe(true)
})

// --- 6. the draft diff: added/removed relative to stored; a no-op draft reports no change ---------

test('diffDraft reports added and removed keys, and a no-op draft is not dirty', () => {
  const stored = new Set(['a', 'b'])
  const draft = new Set(['b', 'c']) // 'a' newly shared, 'c' newly blocked, 'b' unchanged
  const diff = diffDraft(draft, stored)
  expect(diff.added.sort()).toEqual(['c'])
  expect(diff.removed.sort()).toEqual(['a'])
  expect(isDirty(diff)).toBe(true)

  const noop: DraftDiff = diffDraft(new Set(stored), stored)
  expect(noop.added).toEqual([])
  expect(noop.removed).toEqual([])
  expect(isDirty(noop)).toBe(false)
})

// --- 7. applyImpact counts only NEWLY blocked sessions, not everything already blocked -----------

test('computeApplyImpact counts sessions only from newly-added keys, never previously-blocked ones', () => {
  const targets = [
    t({ key: 'github.com/org/already-blocked', sessions: 10 }),
    t({ key: 'github.com/org/newly-blocked', sessions: 4 }),
    t({ key: 'github.com/org/still-shared', sessions: 6 }),
  ]
  const stored = new Set(['github.com/org/already-blocked'])
  const draft = new Set(['github.com/org/already-blocked', 'github.com/org/newly-blocked'])
  const diff = diffDraft(draft, stored)
  const rate = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  const sessions = [
    // Contributes to cost — its own git_remote matches the newly-blocked key.
    { git_remote: 'github.com/org/newly-blocked', input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    // Does NOT contribute — already-blocked, not newly blocked by this save.
    { git_remote: 'github.com/org/already-blocked', input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    // Does NOT contribute — still shared.
    { git_remote: 'github.com/org/still-shared', input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  ]
  const impact = computeApplyImpact(sessions, targets, diff, rate)
  expect(impact.sessions).toBe(4) // targets' own count — includes path-fallback sessions, not just the one direct-match row above
  expect(impact.costUSD).toBeCloseTo(3 + 15, 6) // only the one matching session's tokens, at the given rate
})

test('computeApplyImpact reports zero sessions and cost when nothing is newly blocked', () => {
  const targets = [t({ key: 'a', sessions: 5 })]
  const diff = diffDraft(new Set(), new Set())
  const rate = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  expect(computeApplyImpact([], targets, diff, rate)).toEqual({ sessions: 0, costUSD: 0 })
})

// --- 8. confirm variant: proven vs generic; null boundary never selects proven -------------------

test('resolveConfirmVariant is proven only when a newly-blocked repo has a session before the boundary', () => {
  const sessions = [
    { git_remote: 'github.com/org/newly-blocked', start_time: '2026-01-01T00:00:00.000Z' },
    { git_remote: 'github.com/org/still-shared', start_time: '2026-01-01T00:00:00.000Z' },
  ]
  const diff: DraftDiff = { added: ['github.com/org/newly-blocked'], removed: [] }
  const boundary = '2026-06-01'

  expect(hasProvenPrehistory(sessions, diff, boundary)).toBe(true)
  expect(resolveConfirmVariant(true, boundary)).toBe('proven')

  // A session AFTER the boundary does not prove anything.
  const laterOnly = [{ git_remote: 'github.com/org/newly-blocked', start_time: '2026-07-01T00:00:00.000Z' }]
  expect(hasProvenPrehistory(laterOnly, diff, boundary)).toBe(false)
  expect(resolveConfirmVariant(false, boundary)).toBe('generic')

  // A session in a repo that is NOT newly blocked does not prove anything either.
  const otherRepoOnly = [{ git_remote: 'github.com/org/still-shared', start_time: '2026-01-01T00:00:00.000Z' }]
  expect(hasProvenPrehistory(otherRepoOnly, diff, boundary)).toBe(false)
})

test('an unknown (null) boundary never selects the proven variant, even if hasProven is (incorrectly) true', () => {
  expect(resolveConfirmVariant(true, null)).toBe('generic')
  expect(hasProvenPrehistory(
    [{ git_remote: 'github.com/org/x', start_time: '2020-01-01' }],
    { added: ['github.com/org/x'], removed: [] },
    null,
  )).toBe(false)
})

// --- 9. null boundary / null prehistorySessions produce copy inputs that state no number ---------

test('statsCopyVars omits the clause (returns null) whenever boundary or prehistorySessions is unknowable', () => {
  expect(statsCopyVars(null, 5, 'en')).toBeNull()
  expect(statsCopyVars('2026-06-01', null, 'en')).toBeNull()
  expect(statsCopyVars(null, null, 'en')).toBeNull()
  expect(statsCopyVars('2026-06-01', 5, 'en')).toEqual({ boundary: fmtDateLocalized('2026-06-01', 'en'), n: 5 })
  // A real 0 is a legitimate, renderable value — it must never be treated as unknowable.
  expect(statsCopyVars('2026-06-01', 0, 'en')).toEqual({ boundary: fmtDateLocalized('2026-06-01', 'en'), n: 0 })
})

// --- fix 3: the boundary is formatted in the viewer's locale, never the raw yyyy-MM-dd -----------

test('statsCopyVars formats the boundary in the viewer locale, never as the raw machine string', () => {
  const en = statsCopyVars('2026-07-20', 3, 'en')
  const pt = statsCopyVars('2026-07-20', 3, 'pt')
  expect(en).not.toBeNull()
  expect(pt).not.toBeNull()
  expect(en?.boundary).not.toBe('2026-07-20')
  expect(pt?.boundary).not.toBe('2026-07-20')
  expect(en?.boundary).toBe(fmtDateLocalized('2026-07-20', 'en'))
  expect(pt?.boundary).toBe(fmtDateLocalized('2026-07-20', 'pt'))
  // Month names differ pt vs en — a real locale switch, not just passthrough.
  expect(en?.boundary).not.toBe(pt?.boundary)
})

// --- fix 1: the read view separates "hidden from this central" (every stored denial, including
// stale ones with zero current sessions) from "shared" (live targets only) ------------------------

test('resolveReadViewSummary counts every stored denial as hidden (including stale), and shares only live non-denied targets', () => {
  const targets = [
    t({ key: 'a', sessions: 3 }),
    t({ key: 'b', sessions: 5 }),
    t({ key: 'gone', sessions: 0 }), // stale — denied but no longer produces sessions
  ]
  const stored = new Set(['a', 'gone'])
  const summary = resolveReadViewSummary(targets, stored)
  expect(summary.hiddenCount).toBe(2)
  expect(summary.sharedCount).toBe(1)
  expect(summary.totalLive).toBe(2)
})

test('resolveReadViewSummary reports zero hidden and every live target shared when nothing is denied', () => {
  const targets = [t({ key: 'a', sessions: 2 }), t({ key: 'b', sessions: 1 })]
  const summary = resolveReadViewSummary(targets, new Set())
  expect(summary).toEqual({ hiddenCount: 0, sharedCount: 2, totalLive: 2 })
})

// --- fix 6: the repo panel reports its own edit-mode state so the card can hide two actions -------

test('resolveCardActionsHidden hides Disconnect/Sync now for the whole time the repo panel is editing, and only then', () => {
  expect(resolveCardActionsHidden(true)).toBe(true)
  expect(resolveCardActionsHidden(false)).toBe(false)
})

// --- review fix (Important 2): the write guard covers the FULL apply duration, not just resync ---

test('isApplyBusy is true for both submitting and waiting, and false for idle/done/error', () => {
  expect(isApplyBusy('submitting')).toBe(true)
  expect(isApplyBusy('waiting')).toBe(true)
  expect(isApplyBusy('idle')).toBe(false)
  expect(isApplyBusy('done')).toBe(false)
  expect(isApplyBusy('error')).toBe(false)
})

test('canEditRepos is false while resyncing (server-reported) AND for the whole submitting/waiting apply window', () => {
  // The server has not yet reported a resync, but the apply is mid-flight — Edit must still be blocked.
  expect(canEditRepos('connected', 'submitting')).toBe(false)
  expect(canEditRepos('connected', 'waiting')).toBe(false)
  // A live server-reported resync blocks it regardless of local phase.
  expect(canEditRepos('resyncing', 'idle')).toBe(false)
  // Neither condition holds — Edit is available.
  expect(canEditRepos('connected', 'idle')).toBe(true)
  expect(canEditRepos('offline', 'done')).toBe(true)
  expect(canEditRepos('offline', 'error')).toBe(true)
})

// --- review fix (Important 1): the `waiting` fall-through is PROGRESS, never a premature `done` --

function statusEntry(over: Partial<ConnectionStatusEntry> = {}): ConnectionStatusEntry {
  return {
    id: 'c_1', endpoint: 'https://central.example', org: 'default', user: 'alice',
    lastSuccessAt: null, errKind: null, latencyMs: null,
    shareMode: 'denylist', deniedRepos: 0, deniedProjects: 0, allowedCount: 0,
    deniedCount: 0, restricted: false, boundary: null, prehistorySessions: null,
    canForget: true, centralTooOld: false, resync: null, pendingRules: false,
    ...over,
  }
}

test('waiting with a STALE status (the poll taken BEFORE the PATCH) reports progress, never a green done', () => {
  // `phase` flips to 'waiting' the instant the PATCH resolves, while `status` is still the previous
  // poll's entry — resync null, pendingRules false. Returning 'done' here told the user the
  // repository was hidden up to 5s before the first post-apply poll could contradict it.
  expect(resolveApplyBanner('waiting', statusEntry())).toBe('progress')
})

test('waiting with NO status at all (no poll has landed yet) reports progress, never done', () => {
  expect(resolveApplyBanner('waiting', undefined)).toBe('progress')
})

test('waiting with a live resync reports progress, and an unreachable central reports queued', () => {
  expect(resolveApplyBanner('waiting', statusEntry({ resync: { phase: 'forget', done: 1, total: 4 } }))).toBe('progress')
  expect(resolveApplyBanner('waiting', statusEntry({ pendingRules: true }))).toBe('queued')
  // A live resync wins over pendingRules — one message, and it is the one with real progress in it.
  expect(resolveApplyBanner('waiting', statusEntry({ pendingRules: true, resync: { phase: 'push', done: 0, total: 0 } }))).toBe('progress')
})

test('only the explicit done/error phases produce their banners, and idle produces none', () => {
  // 'done' is set exclusively by SharedReposPanel's two effects, which check pendingRules first.
  expect(resolveApplyBanner('done', statusEntry())).toBe('done')
  expect(resolveApplyBanner('error', statusEntry())).toBe('error')
  expect(resolveApplyBanner('idle', statusEntry())).toBeNull()
  expect(resolveApplyBanner('submitting', statusEntry())).toBeNull()
})
