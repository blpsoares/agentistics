import { test, expect } from 'bun:test'
import { NO_REPO_KEY, normalizeGitRemote } from '@agentistics/core'
import type { SessionMeta, WorkflowRun, HarnessId } from '@agentistics/core'
import {
  canonicalRepoKey, normalizeDenied, buildPathRepoIndex, repoKeyOf, sessionShared,
  filterShared, deniedSessionIds, sharedSessionIds, filterSharedWorkflows,
  withUnresolvedDenied, denialSignature, hasRestrictions,
} from './share-rules'

function s(over: Partial<SessionMeta> & { session_id: string }): SessionMeta {
  return {
    project_path: '/p', start_time: '2026-06-20T10:00:00Z', duration_minutes: 0,
    user_message_count: 0, assistant_message_count: 0, tool_counts: {}, tool_output_tokens: {},
    agent_file_reads: {}, languages: [], git_commits: 0, git_pushes: 0,
    input_tokens: 0, output_tokens: 0, first_prompt: '', user_interruptions: 0,
    user_response_times: [], tool_errors: 0, tool_error_categories: {}, uses_task_agent: false,
    uses_mcp: false, uses_web_search: false, uses_web_fetch: false, lines_added: 0,
    lines_removed: 0, files_modified: 0, message_hours: [], user_message_timestamps: [],
    harness: 'claude' as HarnessId,
    ...over,
  }
}

// --- keys and normalization ---

test('NO_REPO_KEY cannot collide with a real remote', () => {
  expect(NO_REPO_KEY.includes('/')).toBe(false)
  expect(normalizeGitRemote(NO_REPO_KEY)).toBe('')
})

test('repoKeyOf: a remote gives its key, a missing one gives the sentinel', () => {
  expect(repoKeyOf(s({ session_id: 'a', git_remote: 'github.com/org/repo' }))).toBe('github.com/org/repo')
  expect(repoKeyOf(s({ session_id: 'b', git_remote: undefined }))).toBe(NO_REPO_KEY)
  expect(repoKeyOf(s({ session_id: 'c', git_remote: '' }))).toBe(NO_REPO_KEY)
})

test('canonicalRepoKey folds case and ssh front-door hosts', () => {
  expect(canonicalRepoKey('GitHub.com/Acme/API')).toBe('github.com/acme/api')
  expect(canonicalRepoKey('ssh.github.com/acme/api')).toBe('github.com/acme/api')
  expect(canonicalRepoKey('altssh.bitbucket.org/t/r')).toBe('bitbucket.org/t/r')
})

test('the same repo cloned over ssh and https is ONE key', () => {
  const viaSsh = repoKeyOf(s({ session_id: 'a', git_remote: normalizeGitRemote('git@github.com:Acme/API.git') }))
  const viaHttps = repoKeyOf(s({ session_id: 'b', git_remote: normalizeGitRemote('https://github.com/acme/api') }))
  expect(viaSsh).toBe(viaHttps)
})

test('normalizeDenied canonicalizes, folds the sentinel and drops junk', () => {
  const set = normalizeDenied(['', '__no_repo__', 'junk', 'GitHub.com/O/R.git'])
  expect(set.has(NO_REPO_KEY)).toBe(true)
  expect(set.has('github.com/o/r')).toBe(true)
  expect(set.has('junk')).toBe(false)
  expect(set.size).toBe(2)
})

test('normalizeDenied on empty input, and hasRestrictions', () => {
  expect(normalizeDenied(undefined).size).toBe(0)
  expect(normalizeDenied([]).size).toBe(0)
  expect(hasRestrictions(undefined)).toBe(false)
  expect(hasRestrictions([])).toBe(false)
  expect(hasRestrictions(['github.com/o/r'])).toBe(true)
  expect(hasRestrictions([NO_REPO_KEY])).toBe(true)
})

// --- the path index ---

test('buildPathRepoIndex: first writer wins, a second remote makes a conflict', () => {
  const idx = buildPathRepoIndex([
    s({ session_id: 'a', project_path: '/ws', git_remote: 'github.com/o/one' }),
    s({ session_id: 'b', project_path: '/ws', git_remote: 'github.com/o/two' }),
  ])
  expect(idx.resolved.get('/ws')).toBe('github.com/o/one')
  expect(idx.conflicts.get('/ws')).toEqual(new Set(['github.com/o/one', 'github.com/o/two']))
})

test('buildPathRepoIndex is seeded from project.gitRemote too', () => {
  const idx = buildPathRepoIndex([], [{ path: '/codex-only', gitRemote: 'github.com/o/repo' }])
  expect(idx.resolved.get('/codex-only')).toBe('github.com/o/repo')
})

test('repoKeyOf resolves a remote-less session through the index, but never overrides its own', () => {
  const idx = buildPathRepoIndex([s({ session_id: 'a', project_path: '/ws', git_remote: 'github.com/o/one' })])
  expect(repoKeyOf(s({ session_id: 'x', project_path: '/ws' }), idx)).toBe('github.com/o/one')
  expect(repoKeyOf(s({ session_id: 'y', project_path: '/ws', git_remote: 'github.com/o/other' }), idx)).toBe('github.com/o/other')
  expect(repoKeyOf(s({ session_id: 'z', project_path: '/elsewhere' }), idx)).toBe(NO_REPO_KEY)
})

// --- filtering ---

test('an empty denylist shares everything, including unresolved sessions', () => {
  const all = [s({ session_id: 'a', git_remote: 'github.com/o/r' }), s({ session_id: 'b' })]
  expect(filterShared(all, normalizeDenied([]))).toHaveLength(2)
})

test('denying one remote drops exactly its sessions', () => {
  const all = [
    s({ session_id: 'a', git_remote: 'github.com/o/secret' }),
    s({ session_id: 'b', git_remote: 'github.com/o/public' }),
    s({ session_id: 'c' }),
  ]
  const out = filterShared(all, normalizeDenied(['github.com/o/secret']))
  expect(out.map(x => x.session_id)).toEqual(['b', 'c'])
})

test('denying the sentinel drops only unresolved sessions', () => {
  const all = [s({ session_id: 'a', git_remote: 'github.com/o/r' }), s({ session_id: 'b' })]
  const out = filterShared(all, normalizeDenied([NO_REPO_KEY]))
  expect(out.map(x => x.session_id)).toEqual(['a'])
})

test('filterShared preserves order, returns a new array and never mutates', () => {
  const all = [s({ session_id: 'a' }), s({ session_id: 'b', git_remote: 'github.com/o/r' }), s({ session_id: 'c' })]
  const snapshot = JSON.stringify(all)
  const out = filterShared(all, normalizeDenied(['github.com/o/r']))
  expect(out).not.toBe(all)
  expect(out.map(x => x.session_id)).toEqual(['a', 'c'])
  expect(JSON.stringify(all)).toBe(snapshot)
})

test('non-Claude sessions obey the same rule', () => {
  const all = [s({ session_id: 'a', harness: 'codex', git_remote: 'github.com/o/secret' })]
  expect(filterShared(all, normalizeDenied(['github.com/o/secret']))).toHaveLength(0)
})

test('a remote-less non-Claude session in a denied folder is dropped via the index', () => {
  const idx = buildPathRepoIndex([s({ session_id: 'claude1', project_path: '/repo', git_remote: 'github.com/o/secret' })])
  const codex = s({ session_id: 'codex1', harness: 'codex', project_path: '/repo' })
  expect(sessionShared(codex, normalizeDenied(['github.com/o/secret']), idx)).toBe(false)
})

test('a conflicting path fails CLOSED — denied if ANY remote under it is denied', () => {
  const idx = buildPathRepoIndex([
    s({ session_id: 'a', project_path: '/ws', git_remote: 'github.com/o/public' }),
    s({ session_id: 'b', project_path: '/ws', git_remote: 'github.com/o/secret' }),
  ])
  const inPublic = s({ session_id: 'c', project_path: '/ws', git_remote: 'github.com/o/public' })
  expect(sessionShared(inPublic, normalizeDenied(['github.com/o/secret']), idx)).toBe(false)
})

test('withUnresolvedDenied adds the sentinel only once restrictions exist, idempotently', () => {
  expect(withUnresolvedDenied([])).toEqual([])
  const once = withUnresolvedDenied(['github.com/o/r'])
  expect(once).toContain(NO_REPO_KEY)
  expect(withUnresolvedDenied(once)).toEqual(once)
})

test('deniedSessionIds returns ids that are present AND excluded — never merely absent', () => {
  const all = [s({ session_id: 'a', git_remote: 'github.com/o/secret' }), s({ session_id: 'b' })]
  const ids = deniedSessionIds(all, normalizeDenied(['github.com/o/secret']))
  expect([...ids]).toEqual(['a'])
  expect(deniedSessionIds([], normalizeDenied(['github.com/o/secret'])).size).toBe(0)
})

// --- workflows ---

function run(runId: string, sessionId: string): WorkflowRun {
  return {
    runId, name: 'audit', sessionId, status: 'completed', startedAt: '2026-06-20T10:00:00Z',
    durationMs: 0, phases: [], agents: [],
    totals: { agentCount: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, durationMs: 0, toolUses: 0 },
  }
}

test('filterSharedWorkflows keeps a run whose session is shared', () => {
  expect(filterSharedWorkflows([run('r1', 'a')], new Set(['a']))).toHaveLength(1)
})

test('filterSharedWorkflows fails CLOSED for a denied or unknown session', () => {
  expect(filterSharedWorkflows([run('r1', 'a')], new Set(['b']))).toHaveLength(0)
  expect(filterSharedWorkflows([run('r1', 'unknown')], new Set())).toHaveLength(0)
})

test('sharedSessionIds collects the ids of the filtered set', () => {
  expect(sharedSessionIds([s({ session_id: 'a' }), s({ session_id: 'b' })])).toEqual(new Set(['a', 'b']))
})

// --- signature ---

test('denialSignature is order-, case- and normalization-independent', () => {
  const a = denialSignature(['github.com/o/r', 'GitHub.com/O/Two'])
  const b = denialSignature(['github.com/o/two', 'github.com/o/r'])
  expect(a).toBe(b)
})

test('denialSignature changes when an entry is added or removed, and [] is stable', () => {
  expect(denialSignature([])).toBe(denialSignature([]))
  expect(denialSignature([])).not.toBe(denialSignature(['github.com/o/r']))
  expect(denialSignature(['github.com/o/r'])).not.toBe(denialSignature(['github.com/o/r', 'github.com/o/s']))
})

// --- accumulateClaudeSessions / buildSharedStatsCache ---

import { emptyStatsCache } from '@agentistics/core'
import type { StatsCache } from '@agentistics/core'
import { accumulateClaudeSessions, buildSharedStatsCache } from './share-rules'

/** 2026-06-20T09:30 LOCAL — hour bucketing is local-clock, like every adapter. */
function localAt(day: string, hour: number): string {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:30:00`).toISOString()
}

test('buildSharedStatsCache on an empty set equals emptyStatsCache (bar version)', () => {
  expect(buildSharedStatsCache([])).toEqual(emptyStatsCache())
  expect(buildSharedStatsCache([], { version: 4 }).version).toBe(4)
})

test('non-Claude sessions contribute to NOTHING', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'x', harness: 'codex', start_time: localAt('2026-06-20', 9), user_message_count: 5, input_tokens: 100, model: 'gpt-5.4' }),
  ])
  expect(out).toEqual(emptyStatsCache())
})

test('lastComputedDate stays empty even for a multi-month input', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-02-01', 9) }),
    s({ session_id: 'b', start_time: localAt('2026-06-20', 9) }),
  ])
  expect(out.lastComputedDate).toBe('')
})

test('totals match the sum of dailyActivity — the invariant the real file holds', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9), user_message_count: 3, assistant_message_count: 4 }),
    s({ session_id: 'b', start_time: localAt('2026-06-21', 14), user_message_count: 1, assistant_message_count: 1 }),
  ])
  expect(out.totalSessions).toBe(out.dailyActivity.reduce((a, d) => a + d.sessionCount, 0))
  expect(out.totalMessages).toBe(out.dailyActivity.reduce((a, d) => a + d.messageCount, 0))
  expect(out.totalSessions).toBe(2)
  expect(out.totalMessages).toBe(9)
})

test('hourCounts buckets SESSION START hours on the local clock, and sums to totalSessions', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9), message_hours: [1, 1, 1, 1] }),
    s({ session_id: 'b', start_time: localAt('2026-06-21', 9), message_hours: [2, 2] }),
    s({ session_id: 'c', start_time: localAt('2026-06-21', 15), message_hours: [3] }),
  ])
  expect(out.hourCounts['9']).toBe(2)
  expect(out.hourCounts['15']).toBe(1)
  expect(Object.values(out.hourCounts).reduce((a, b) => a + b, 0)).toBe(out.totalSessions)
})

test('dailyModelTokens sums the four token kinds per claude model per day, and skips foreign ids', () => {
  const out = buildSharedStatsCache([
    s({
      session_id: 'a', start_time: localAt('2026-06-20', 9), model: 'claude-opus-5',
      input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40,
    }),
    s({ session_id: 'b', start_time: localAt('2026-06-20', 9), model: '<synthetic>', input_tokens: 999 }),
  ])
  const day = out.dailyModelTokens.find(d => d.date === '2026-06-20')!
  expect(day.tokensByModel['claude-opus-5']).toBe(100)
  expect(day.tokensByModel['<synthetic>']).toBeUndefined()
  // The <synthetic> session still counts as activity.
  expect(out.totalSessions).toBe(2)
})

test('modelUsage keeps costUSD and webSearchRequests at 0, like the real file', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9), model: 'claude-opus-5', input_tokens: 10, uses_web_search: true }),
  ])
  expect(out.modelUsage['claude-opus-5']!.inputTokens).toBe(10)
  expect(out.modelUsage['claude-opus-5']!.costUSD).toBe(0)
  expect(out.modelUsage['claude-opus-5']!.webSearchRequests).toBe(0)
})

test('firstSessionDate is the earliest FULL ISO start_time', () => {
  const early = localAt('2026-02-06', 8)
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9) }),
    s({ session_id: 'b', start_time: early }),
  ])
  expect(out.firstSessionDate).toBe(early)
  expect(out.firstSessionDate.length).toBeGreaterThan(10)
  expect(buildSharedStatsCache([]).firstSessionDate).toBe('')
})

test('longestSession is the zero value even with a long session present', () => {
  const out = buildSharedStatsCache([s({ session_id: 'a', start_time: localAt('2026-06-20', 9), duration_minutes: 400 })])
  expect(out.longestSession).toEqual({ sessionId: '', duration: 0, messageCount: 0, timestamp: '' })
})

test('a session with no start_time is skipped without throwing', () => {
  expect(() => buildSharedStatsCache([s({ session_id: 'a', start_time: '' })])).not.toThrow()
  expect(buildSharedStatsCache([s({ session_id: 'a', start_time: '' })]).totalSessions).toBe(0)
})

test('the output carries NO key outside the StatsCache shape', () => {
  const out = buildSharedStatsCache([s({ session_id: 'a', start_time: localAt('2026-06-20', 9) })])
  expect(Object.keys(out).sort()).toEqual(Object.keys(emptyStatsCache()).sort())
})

test('end to end: a denied repo contributes to no field at all', () => {
  const all = [
    s({ session_id: 'keep', start_time: localAt('2026-06-20', 9), model: 'claude-opus-5', input_tokens: 10, git_remote: 'github.com/o/public', user_message_count: 1 }),
    s({ session_id: 'drop', start_time: localAt('2026-06-20', 11), model: 'claude-opus-5', input_tokens: 500, git_remote: 'github.com/o/secret', user_message_count: 9 }),
  ]
  const out = buildSharedStatsCache(filterShared(all, normalizeDenied(['github.com/o/secret'])))
  expect(out.totalSessions).toBe(1)
  expect(out.totalMessages).toBe(1)
  expect(out.modelUsage['claude-opus-5']!.inputTokens).toBe(10)
  expect(out.dailyModelTokens[0]!.tokensByModel['claude-opus-5']).toBe(10)
  expect(out.hourCounts['11']).toBeUndefined()
  expect(JSON.stringify(out)).not.toContain('secret')
})

test('accumulateClaudeSessions honours `after` exclusively (<=), and includes all without it', () => {
  const sessions = [
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9) }),
    s({ session_id: 'b', start_time: localAt('2026-06-22', 9) }),
    s({ session_id: 'c', start_time: localAt('2026-06-23', 9) }),
  ]
  expect(accumulateClaudeSessions(sessions, { after: '2026-06-22' }).totalSessions).toBe(1)
  expect(accumulateClaudeSessions(sessions).totalSessions).toBe(3)
})

test('accumulateClaudeSessions without claudeOnly counts every harness — the data.ts contract', () => {
  const mixed = [
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9) }),
    s({ session_id: 'b', harness: 'codex', start_time: localAt('2026-06-20', 9) }),
  ]
  expect(accumulateClaudeSessions(mixed).totalSessions).toBe(2)
  expect(accumulateClaudeSessions(mixed, { claudeOnly: true }).totalSessions).toBe(1)
})
