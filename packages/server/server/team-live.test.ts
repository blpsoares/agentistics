import { test, expect, beforeEach } from 'bun:test'
import { recordMemberLive, clearMemberLive, collectMemberLive, resetMemberLive, LIVE_REPORT_TTL_MS } from './team-live'

const NOW = 1_800_000_000_000
const proc = (cwd: string) => ({ harness: 'claude' as const, cwd })

beforeEach(() => { resetMemberLive() })

test('a report is visible until its TTL expires', () => {
  recordMemberLive('m1', 'Bryan', ['s1'], [proc('/a')], NOW)
  expect(collectMemberLive(null, NOW).liveSessionIds).toEqual(['s1'])
  expect(collectMemberLive(null, NOW + LIVE_REPORT_TTL_MS - 1).liveSessionIds).toEqual(['s1'])
  // Past the TTL the member is presumed gone — no cleanup path to forget to run.
  expect(collectMemberLive(null, NOW + LIVE_REPORT_TTL_MS + 1).liveSessionIds).toEqual([])
})

test('a later report from the SAME machine REPLACES the earlier one (a snapshot is complete)', () => {
  recordMemberLive('m1', 'Bryan', ['s1', 's2'], [], NOW)
  recordMemberLive('m1', 'Bryan', ['s2'], [], NOW + 1000)
  // Merging would resurrect s1, which the machine just told us is closed.
  expect(collectMemberLive(null, NOW + 1000).liveSessionIds).toEqual(['s2'])
})

// The regression this keying exists for: one person, two machines. Keyed by display name, the idle
// laptop's empty snapshot overwrote the desktop's every 8s and "Open now" read empty while work was
// visibly in progress.
test("a person's two machines are independent snapshots, not one that overwrites the other", () => {
  recordMemberLive('desktop', 'Bryan', ['s1'], [proc('/work')], NOW)
  recordMemberLive('laptop', 'Bryan', [], [], NOW + 100)
  const out = collectMemberLive(null, NOW + 100)
  expect(out.liveSessionIds).toEqual(['s1'])
  expect(out.liveProcesses.map(p => p.cwd)).toEqual(['/work'])
})

test("disconnecting one machine leaves the same person's other machine reporting", () => {
  recordMemberLive('desktop', 'Bryan', ['s1'], [], NOW)
  recordMemberLive('laptop', 'Bryan', ['s2'], [], NOW)
  clearMemberLive('laptop')
  expect(collectMemberLive(null, NOW).liveSessionIds).toEqual(['s1'])
})

test('reports from several members are unioned and processes carry their owner', () => {
  recordMemberLive('m1', 'Bryan', ['s1'], [proc('/a')], NOW)
  recordMemberLive('m2', 'Ana', ['s2'], [proc('/b')], NOW)
  const out = collectMemberLive(null, NOW)
  expect(out.liveSessionIds.sort()).toEqual(['s1', 's2'])
  expect(out.liveProcesses.map(p => [p.user, p.cwd]).sort()).toEqual([['Ana', '/b'], ['Bryan', '/a']])
})

// The scoping guarantee: a principal must never learn that a machine they cannot see is running,
// nor read its working directory off an unmatched process. Scoping stays per PERSON even though
// the registry is keyed per machine.
test('scoping to visible users hides both the ids and the cwd of everyone else', () => {
  recordMemberLive('m1', 'Bryan', ['s1'], [proc('/secret')], NOW)
  recordMemberLive('m2', 'Ana', ['s2'], [proc('/ok')], NOW)
  const out = collectMemberLive(new Set(['Ana']), NOW)
  expect(out.liveSessionIds).toEqual(['s2'])
  expect(out.liveProcesses.map(p => p.cwd)).toEqual(['/ok'])
})

test('scoping hides EVERY machine of a hidden person', () => {
  recordMemberLive('desktop', 'Bryan', ['s1'], [proc('/secret')], NOW)
  recordMemberLive('laptop', 'Bryan', ['s2'], [proc('/also-secret')], NOW)
  recordMemberLive('m3', 'Ana', ['s3'], [], NOW)
  const out = collectMemberLive(new Set(['Ana']), NOW)
  expect(out.liveSessionIds).toEqual(['s3'])
  expect(out.liveProcesses).toEqual([])
})

test('a clean disconnect drops the report immediately, without waiting out the TTL', () => {
  recordMemberLive('m1', 'Bryan', ['s1'], [], NOW)
  clearMemberLive('m1')
  expect(collectMemberLive(null, NOW).liveSessionIds).toEqual([])
})

test('the same session open on two members is counted once', () => {
  recordMemberLive('m1', 'Bryan', ['shared'], [], NOW)
  recordMemberLive('m2', 'Ana', ['shared'], [], NOW)
  expect(collectMemberLive(null, NOW).liveSessionIds).toEqual(['shared'])
})
