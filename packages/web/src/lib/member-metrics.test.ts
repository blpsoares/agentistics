import { test, expect } from 'bun:test'
import { aggregateMemberMetrics, withStatsCacheTotals } from './member-metrics'
import type { SessionMeta, StatsCache } from '@agentistics/core'

const cache = (over: Partial<StatsCache>): StatsCache => ({
  version: 1, lastComputedDate: '2026-07-01',
  dailyActivity: [], dailyModelTokens: [], modelUsage: {},
  totalSessions: 0, totalMessages: 0, hourCounts: {},
  ...over,
} as StatsCache)

/** Proportions from live central data: the surviving session documents are a fraction of it. */
const deep = cache({
  modelUsage: {
    'claude-opus-4-8': {
      inputTokens: 5_000_000, outputTokens: 20_000_000,
      cacheReadInputTokens: 5_000_000_000, cacheCreationInputTokens: 160_000_000,
      webSearchRequests: 0, costUSD: 0,
    },
  },
  dailyActivity: [{ date: '2026-07-01', sessionCount: 472, messageCount: 90_000, toolCallCount: 0 }],
})

const sess = (over: Partial<SessionMeta>): SessionMeta => ({
  session_id: Math.random().toString(36).slice(2), harness: 'claude',
  user: 'Bryan Soares', memberId: 'alienware',
  start_time: '2026-07-01T10:00:00', project_path: '/p',
  input_tokens: 1_000, output_tokens: 1_000,
  ...over,
} as unknown as SessionMeta)

test('withStatsCacheTotals replaces the session sum with the deep history', () => {
  const sessions = [sess({}), sess({})]
  const base = aggregateMemberMetrics(sessions, 'machine')
  expect(base[0]!.sessions).toBe(2)

  const out = withStatsCacheTotals(base, sessions, 'machine', { alienware: deep })
  // 472 from dailyActivity; the two sessions are on a day the cache already covers.
  expect(out[0]!.sessions).toBe(472)
  expect(out[0]!.totalTokens).toBe(5_000_000 + 20_000_000 + 5_000_000_000 + 160_000_000)
  expect(out[0]!.costUSD).toBeGreaterThan(base[0]!.costUSD)
  // Cache reads dominate the bill, so they must be in the token total the page ranks on.
  expect(out[0]!.cacheReadTokens).toBe(5_000_000_000)
})

test('withStatsCacheTotals keeps the qualitative fields session-derived', () => {
  const sessions = [sess({ git_remote: 'github.com/o/r', model: 'claude-opus-4-8' })]
  const base = aggregateMemberMetrics(sessions, 'machine')
  const out = withStatsCacheTotals(base, sessions, 'machine', { alienware: deep })
  expect(out[0]!.topProject).toEqual(base[0]!.topProject)
  expect(out[0]!.topModel).toEqual(base[0]!.topModel)
  expect(out[0]!.lastActivity).toBe(base[0]!.lastActivity)
  expect(out[0]!.user).toBe('Bryan Soares')
})

test('withStatsCacheTotals adds the non-Claude spend no cache can hold', () => {
  // statsCache is Claude-only, so a Codex session's money is in NO cache and must be added on top.
  const claudeOnly = [sess({})]
  const withCodex = [sess({}), sess({ harness: 'codex', model: 'gpt-5', input_tokens: 20_000_000, output_tokens: 20_000_000 })]
  const a = withStatsCacheTotals(aggregateMemberMetrics(claudeOnly, 'machine'), claudeOnly, 'machine', { alienware: deep })
  const b = withStatsCacheTotals(aggregateMemberMetrics(withCodex, 'machine'), withCodex, 'machine', { alienware: deep })
  expect(b[0]!.costUSD).toBeGreaterThan(a[0]!.costUSD)
  expect(b[0]!.totalTokens).toBe(a[0]!.totalTokens + 40_000_000)
  // The Codex session is a session too, even on a day the Claude cache "covers".
  expect(b[0]!.sessions).toBe(a[0]!.sessions + 1)
})

test('withStatsCacheTotals counts a Claude session only on days the cache has not computed', () => {
  const covered = [sess({ start_time: '2026-07-01T10:00:00' })]
  const gap = [sess({ start_time: '2026-07-20T10:00:00' })]
  const c = withStatsCacheTotals(aggregateMemberMetrics(covered, 'machine'), covered, 'machine', { alienware: deep })
  const g = withStatsCacheTotals(aggregateMemberMetrics(gap, 'machine'), gap, 'machine', { alienware: deep })
  expect(c[0]!.sessions).toBe(472)
  expect(g[0]!.sessions).toBe(473)
  // Money is not gap-filled — modelUsage already holds it whole.
  expect(g[0]!.costUSD).toBeCloseTo(c[0]!.costUSD, 6)
})

test('withStatsCacheTotals leaves a row with no cache untouched, and is inert without caches', () => {
  const sessions = [sess({ memberId: 'ghost' })]
  const base = aggregateMemberMetrics(sessions, 'machine')
  expect(withStatsCacheTotals(base, sessions, 'machine', { alienware: deep })).toEqual(base)
  // No caches at all (solo, or a filter the caches cannot represent) → previous behaviour exactly.
  expect(withStatsCacheTotals(base, sessions, 'machine', undefined)).toBe(base)
})

test('grouping by user reads the user-keyed caches', () => {
  const sessions = [sess({}), sess({ memberId: 'dell' })]
  const base = aggregateMemberMetrics(sessions, 'user')
  expect(base[0]!.key).toBe('Bryan Soares')
  const out = withStatsCacheTotals(base, sessions, 'user', { 'Bryan Soares': deep })
  expect(out[0]!.sessions).toBe(472)
  expect(out[0]!.machineCount).toBe(2)
})

test('a row whose totals come from the statsCache SAYS SO, because the parts stop adding up', () => {
  // The row's headline becomes the full machine history while `machines` stays the visible
  // sessions. That is correct — the caches are the history, the session documents only the part
  // Claude Code has not pruned — but a card showing parts that fail to close without a word of
  // explanation teaches the reader to distrust both numbers. The flag is what lets it say so.
  const sessions = [sess({ memberId: 'alienware' })]
  const rows = withStatsCacheTotals(
    aggregateMemberMetrics(sessions, 'machine'), sessions, 'machine', { alienware: deep })

  const row = rows[0]!
  expect(row.totalsFromCache).toBe(true)
  // The whole is genuinely larger than the visible parts — exactly what the flag warns of.
  expect(row.machines.reduce((a, m) => a + m.totalTokens, 0)).toBeLessThan(row.totalTokens)
})

test('a session-only row does not claim cache totals', () => {
  // No caches passed → nothing was substituted → nothing to disclose.
  expect(aggregateMemberMetrics([sess({})], 'machine')[0]!.totalsFromCache).toBeFalsy()
})
