import { test, expect, beforeEach } from 'bun:test'
import { recordMemberLive, clearMemberLive, collectMemberLive, resetMemberLive, LIVE_REPORT_TTL_MS } from './team-live'

const NOW = 1_800_000_000_000
const proc = (cwd: string) => ({ harness: 'claude' as const, cwd })

beforeEach(() => { resetMemberLive() })

test('a report is visible until its TTL expires', () => {
  recordMemberLive('Bryan', ['s1'], [proc('/a')], NOW)
  expect(collectMemberLive(null, NOW).liveSessionIds).toEqual(['s1'])
  expect(collectMemberLive(null, NOW + LIVE_REPORT_TTL_MS - 1).liveSessionIds).toEqual(['s1'])
  // Past the TTL the member is presumed gone — no cleanup path to forget to run.
  expect(collectMemberLive(null, NOW + LIVE_REPORT_TTL_MS + 1).liveSessionIds).toEqual([])
})

test('a later report REPLACES the earlier one (a snapshot is complete, not additive)', () => {
  recordMemberLive('Bryan', ['s1', 's2'], [], NOW)
  recordMemberLive('Bryan', ['s2'], [], NOW + 1000)
  // Merging would resurrect s1, which the member just told us is closed.
  expect(collectMemberLive(null, NOW + 1000).liveSessionIds).toEqual(['s2'])
})

test('reports from several members are unioned and processes carry their owner', () => {
  recordMemberLive('Bryan', ['s1'], [proc('/a')], NOW)
  recordMemberLive('Ana', ['s2'], [proc('/b')], NOW)
  const out = collectMemberLive(null, NOW)
  expect(out.liveSessionIds.sort()).toEqual(['s1', 's2'])
  expect(out.liveProcesses.map(p => [p.user, p.cwd]).sort()).toEqual([['Ana', '/b'], ['Bryan', '/a']])
})

// The scoping guarantee: a principal must never learn that a machine they cannot see is running,
// nor read its working directory off an unmatched process.
test('scoping to visible users hides both the ids and the cwd of everyone else', () => {
  recordMemberLive('Bryan', ['s1'], [proc('/secret')], NOW)
  recordMemberLive('Ana', ['s2'], [proc('/ok')], NOW)
  const out = collectMemberLive(new Set(['Ana']), NOW)
  expect(out.liveSessionIds).toEqual(['s2'])
  expect(out.liveProcesses.map(p => p.cwd)).toEqual(['/ok'])
})

test('a clean disconnect drops the report immediately, without waiting out the TTL', () => {
  recordMemberLive('Bryan', ['s1'], [], NOW)
  clearMemberLive('Bryan')
  expect(collectMemberLive(null, NOW).liveSessionIds).toEqual([])
})

test('the same session open on two members is counted once', () => {
  recordMemberLive('Bryan', ['shared'], [], NOW)
  recordMemberLive('Ana', ['shared'], [], NOW)
  expect(collectMemberLive(null, NOW).liveSessionIds).toEqual(['shared'])
})
