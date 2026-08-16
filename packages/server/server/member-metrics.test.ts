// packages/server/server/member-metrics.test.ts
import { test, expect } from 'bun:test'
import { aggregateMemberMetrics, sessionCostUSD, LOCAL_KEY } from './member-metrics'
import { calcCost, type SessionMeta } from '@agentistics/core'

let seq = 0
function session(over: Partial<SessionMeta> = {}): SessionMeta {
  seq++
  return {
    session_id: `s${seq}`,
    project_path: '/home/dev/app',
    start_time: '2026-07-01T10:00:00.000Z',
    duration_minutes: 5,
    user_message_count: 1,
    assistant_message_count: 1,
    tool_counts: {},
    tool_output_tokens: {},
    agent_file_reads: {},
    languages: [],
    git_commits: 0,
    git_pushes: 0,
    input_tokens: 1000,
    output_tokens: 500,
    first_prompt: '',
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: 0,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: false,
    uses_web_search: false,
    uses_web_fetch: false,
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: [],
    user_message_timestamps: [],
    harness: 'claude',
    ...over,
  }
}

test('empty input yields an empty list', () => {
  expect(aggregateMemberMetrics([])).toEqual([])
  expect(aggregateMemberMetrics([], 'user')).toEqual([])
})

test('a member with sessions across two projects picks the busier folder', () => {
  const rows = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', project_path: '/a' }),
    session({ user: 'ana', memberId: 'm1', project_path: '/b' }),
    session({ user: 'ana', memberId: 'm1', project_path: '/b' }),
  ])
  expect(rows).toHaveLength(1)
  expect(rows[0]!.sessions).toBe(3)
  expect(rows[0]!.topProject).toEqual({ kind: 'folder', key: '/b', sessions: 2 })
})

test('a repo with more sessions than any folder wins over the folder', () => {
  // Same repo cloned into two different paths: the repo bucket (3) beats each folder bucket (2/1).
  const rows = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', project_path: '/x', git_remote: 'github.com/org/repo' }),
    session({ user: 'ana', memberId: 'm1', project_path: '/x', git_remote: 'github.com/org/repo' }),
    session({ user: 'ana', memberId: 'm1', project_path: '/y', git_remote: 'github.com/org/repo' }),
  ])
  expect(rows[0]!.topProject).toEqual({ kind: 'repo', key: 'github.com/org/repo', sessions: 3 })
})

test('a folder busier than every repo wins over the repo', () => {
  const rows = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', project_path: '/plain' }),
    session({ user: 'ana', memberId: 'm1', project_path: '/plain' }),
    session({ user: 'ana', memberId: 'm1', project_path: '/plain' }),
    session({ user: 'ana', memberId: 'm1', project_path: '/repo-a', git_remote: 'github.com/org/a' }),
  ])
  expect(rows[0]!.topProject).toEqual({ kind: 'folder', key: '/plain', sessions: 3 })
})

test('ties resolve deterministically — repo over folder, then ascending key', () => {
  // One session with a remote: repo bucket 1, folder bucket 1 → the repo wins the tie.
  const tie = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', project_path: '/x', git_remote: 'github.com/org/repo' }),
  ])
  expect(tie[0]!.topProject).toEqual({ kind: 'repo', key: 'github.com/org/repo', sessions: 1 })

  // Two folders with the same count, inserted in reverse alphabetical order → '/aaa' still wins.
  const folders = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', project_path: '/zzz' }),
    session({ user: 'ana', memberId: 'm1', project_path: '/aaa' }),
  ])
  expect(folders[0]!.topProject).toEqual({ kind: 'folder', key: '/aaa', sessions: 1 })

  // Same for models and harnesses.
  const ties = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', model: 'gpt-5', harness: 'codex' }),
    session({ user: 'ana', memberId: 'm1', model: 'claude-opus-4-6', harness: 'claude' }),
  ])
  expect(ties[0]!.topModel).toEqual({ key: 'claude-opus-4-6', sessions: 1 })
  expect(ties[0]!.topHarness).toEqual({ key: 'claude', sessions: 1 })
})

test('most used model and harness win by count', () => {
  const rows = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', model: 'claude-opus-4-6', harness: 'claude' }),
    session({ user: 'ana', memberId: 'm1', model: 'gpt-5', harness: 'codex' }),
    session({ user: 'ana', memberId: 'm1', model: 'gpt-5', harness: 'codex' }),
  ])
  expect(rows[0]!.topModel).toEqual({ key: 'gpt-5', sessions: 2 })
  expect(rows[0]!.topHarness).toEqual({ key: 'codex', sessions: 2 })
  // Ordered by count desc, then id asc.
  expect(rows[0]!.harnesses).toEqual(['codex', 'claude'])
})

test('a member with no model produces null rather than a phantom entry', () => {
  const rows = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', model: undefined }),
    session({ user: 'ana', memberId: 'm1', model: '' }),
  ])
  expect(rows[0]!.topModel).toBeNull()
  // The harness is always present, so it still resolves.
  expect(rows[0]!.topHarness).toEqual({ key: 'claude', sessions: 2 })
})

test('a member with no project at all produces a null topProject', () => {
  const rows = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', project_path: '', git_remote: '' }),
  ])
  expect(rows[0]!.topProject).toBeNull()
})

test('groups per machine by default and per user on request', () => {
  const sessions = [
    session({ user: 'ana', memberId: 'm1' }),
    session({ user: 'ana', memberId: 'm2' }),
    session({ user: 'bob', memberId: 'm3' }),
  ]
  const byMachine = aggregateMemberMetrics(sessions, 'machine')
  expect(byMachine.map(r => r.key)).toEqual(['m1', 'm2', 'm3'])
  expect(byMachine.every(r => r.machineCount === 1)).toBe(true)

  const byUser = aggregateMemberMetrics(sessions, 'user')
  expect(byUser.map(r => r.key)).toEqual(['ana', 'bob'])
  expect(byUser[0]!.sessions).toBe(2)
  expect(byUser[0]!.machineCount).toBe(2)
  // Two machines → no single machine identity for the row.
  expect(byUser[0]!.memberId).toBeNull()
  expect(byUser[1]!.memberId).toBe('m3')
})

test('sessions with neither user nor machine fall into the local bucket', () => {
  const rows = aggregateMemberMetrics([session(), session()])
  expect(rows).toHaveLength(1)
  expect(rows[0]!.key).toBe(LOCAL_KEY)
  expect(rows[0]!.user).toBe('')
  expect(rows[0]!.memberId).toBeNull()
})

test('rows are sorted by sessions desc, then cost desc, then key asc', () => {
  const rows = aggregateMemberMetrics([
    session({ user: 'zoe', memberId: 'm3' }),
    session({ user: 'ana', memberId: 'm1' }),
    session({ user: 'bob', memberId: 'm2' }),
    session({ user: 'bob', memberId: 'm2' }),
  ], 'user')
  expect(rows.map(r => r.key)).toEqual(['bob', 'ana', 'zoe'])
})

test('volume metrics sum tokens and cost via calcCost, and track first/last activity', () => {
  const a = session({
    user: 'ana', memberId: 'm1', model: 'claude-opus-4-6',
    input_tokens: 1000, output_tokens: 200,
    cache_read_input_tokens: 300, cache_creation_input_tokens: 40,
    start_time: '2026-07-02T08:00:00.000Z', end_time: '2026-07-02T09:00:00.000Z',
  })
  const b = session({
    user: 'ana', memberId: 'm1', model: 'claude-opus-4-6',
    input_tokens: 500, output_tokens: 100,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    start_time: '2026-07-01T08:00:00.000Z', end_time: '2026-07-01T08:30:00.000Z',
  })
  const rows = aggregateMemberMetrics([a, b])
  const r = rows[0]!
  expect(r.inputTokens).toBe(1500)
  expect(r.outputTokens).toBe(300)
  expect(r.cacheReadTokens).toBe(300)
  expect(r.cacheWriteTokens).toBe(40)
  expect(r.totalTokens).toBe(2140)
  expect(r.costUSD).toBeCloseTo(sessionCostUSD(a) + sessionCostUSD(b), 12)
  expect(r.costUSD).toBeGreaterThan(0)
  expect(r.firstActivity).toBe('2026-07-01T08:00:00.000Z')
  expect(r.lastActivity).toBe('2026-07-02T09:00:00.000Z')
})

test('sessionCostUSD matches calcCost with the correct usage field names', () => {
  const s = session({
    model: 'claude-opus-4-6',
    input_tokens: 1_000_000, output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
  })
  const expected = calcCost({
    inputTokens: 1_000_000, outputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000,
    webSearchRequests: 0, costUSD: 0,
  }, 'claude-opus-4-6')
  expect(sessionCostUSD(s)).toBe(expected)
  expect(Number.isFinite(sessionCostUSD(s))).toBe(true)
})

test('an unparseable timestamp never poisons first/last activity', () => {
  const rows = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1', start_time: 'not-a-date', end_time: 'nope' }),
    session({ user: 'ana', memberId: 'm1', start_time: '2026-07-05T00:00:00.000Z', end_time: '2026-07-05T01:00:00.000Z' }),
  ])
  expect(rows[0]!.firstActivity).toBe('2026-07-05T00:00:00.000Z')
  expect(rows[0]!.lastActivity).toBe('2026-07-05T01:00:00.000Z')
})

test('a member row breaks down into its machines, ranked by cost', () => {
  // m2 is the cheap one, m1 the heavy one — the ranking must not follow insertion order.
  const rows = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm2', input_tokens: 100, output_tokens: 10 }),
    session({ user: 'ana', memberId: 'm1', input_tokens: 9000, output_tokens: 4000 }),
    session({ user: 'ana', memberId: 'm1', input_tokens: 9000, output_tokens: 4000 }),
  ], 'user')

  const row = rows[0]!
  expect(row.machineCount).toBe(2)
  expect(row.machines.map(m => m.key)).toEqual(['m1', 'm2'])
  expect(row.machines[0]!.sessions).toBe(2)
  expect(row.machines[1]!.sessions).toBe(1)
  // The parts add up to the whole — the per-machine slice is the same money as the row's.
  // This holds for a row built purely from sessions. The case where it deliberately does NOT —
  // totals replaced by the statsCache history — lives in the web copy's test file, because
  // withStatsCacheTotals only exists there.
  const summed = row.machines.reduce((a, m) => a + m.costUSD, 0)
  expect(summed).toBeCloseTo(row.costUSD, 10)
  expect(row.machines.reduce((a, m) => a + m.sessions, 0)).toBe(row.sessions)
  expect(row.machines.reduce((a, m) => a + m.totalTokens, 0)).toBe(row.totalTokens)
  // No cache was involved, so nothing to disclose.
  expect(row.totalsFromCache).toBeFalsy()
})


test('grouping by machine yields exactly one machine slice per row', () => {
  const rows = aggregateMemberMetrics([
    session({ user: 'ana', memberId: 'm1' }),
    session({ user: 'ana', memberId: 'm2' }),
  ], 'machine')
  expect(rows.every(r => r.machines.length === 1)).toBe(true)
  expect(rows.every(r => r.machines[0]!.key === r.key)).toBe(true)
})

test('sessions with no machine produce an empty breakdown, never a phantom machine', () => {
  const rows = aggregateMemberMetrics([session({ user: 'ana', memberId: undefined })], 'user')
  expect(rows[0]!.machineCount).toBe(0)
  expect(rows[0]!.machines).toEqual([])
})
