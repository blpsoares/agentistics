import { test, expect } from 'bun:test'
import { costCaveat, costCellFor, rollupKeyOf, subtaskRollupOf } from './subtaskRollup'
import type { AttemptRollup, Subtask, SubtaskView } from '../../lib/tasks'

function rollup(over: Partial<AttemptRollup> = {}): AttemptRollup {
  return {
    sessionsUsed: 1, sessionsLinked: 1, provenance: { assigned: 1, observed: 0, none: 0 },
    rounds: 3, activeMinutes: 10, tokens: 1000, costUSD: 1.5,
    costMeasuredSessions: 0, costEstimatedSessions: 1, credits: null, mixedCurrency: false,
    ...over,
  }
}

function sub(id: string, groupId?: string): Pick<Subtask, 'id' | 'groupId'> {
  return groupId === undefined ? { id } : { id, groupId }
}

// --- rollupKeyOf -----------------------------------------------------------------------------

test('rollupKeyOf: an ungrouped subtask is bucketed under its own id', () => {
  expect(rollupKeyOf(sub('s1'))).toBe('s1')
})

test('rollupKeyOf: a grouped subtask is bucketed under the group id, never its own', () => {
  expect(rollupKeyOf(sub('s1', 'g1'))).toBe('g1')
})

// --- subtaskRollupOf -----------------------------------------------------------------------------

test('subtaskRollupOf: finds the bucket by subtask id', () => {
  const r = rollup({ costUSD: 7 })
  const views: SubtaskView[] = [{ id: 's1', rollup: r }, { id: 's2', rollup: rollup({ costUSD: 3 }) }]
  expect(subtaskRollupOf(views, sub('s1'))).toBe(r)
})

test('subtaskRollupOf: undefined when the server has no bucket for this subtask', () => {
  const views: SubtaskView[] = [{ id: 's1', rollup: rollup() }]
  expect(subtaskRollupOf(views, sub('unknown'))).toBeUndefined()
})

test('subtaskRollupOf: the id:null direct-branch bucket is not confused with a real subtask', () => {
  const views: SubtaskView[] = [{ id: null, rollup: rollup({ costUSD: 99 }) }]
  expect(subtaskRollupOf(views, sub('s1'))).toBeUndefined()
})

test('subtaskRollupOf: two subtasks sharing a groupId read the SAME bucket, keyed by the group', () => {
  // The server collapses a group into ONE view keyed by the group id (task-report.ts's `keyOf`),
  // so neither member's own id appears in the list at all.
  const shared = rollup({ costUSD: 8, sessionsUsed: 2, sessionsLinked: 2 })
  const views: SubtaskView[] = [{ id: 'g1', rollup: shared }, { id: 's3', rollup: rollup({ costUSD: 1 }) }]
  const a = subtaskRollupOf(views, sub('s1', 'g1'))
  const b = subtaskRollupOf(views, sub('s2', 'g1'))
  expect(a).toBe(shared)
  expect(b).toBe(shared)
  // The SAME object, never two sums: reading it per member is what would multiply the cost by the
  // group's size.
  expect(a).toBe(b!)
})

test('subtaskRollupOf: a grouped subtask never falls back to a bucket under its own id', () => {
  // If the list somehow still carried a per-member bucket, the group's key must win — the member
  // id is not the effective key and reading it would be a second, smaller sum.
  const own = rollup({ costUSD: 1 })
  const group = rollup({ costUSD: 9 })
  const views: SubtaskView[] = [{ id: 's1', rollup: own }, { id: 'g1', rollup: group }]
  expect(subtaskRollupOf(views, sub('s1', 'g1'))).toBe(group)
})

test('subtaskRollupOf: an ungrouped subtask beside a group is unaffected', () => {
  const mine = rollup({ costUSD: 4 })
  const views: SubtaskView[] = [{ id: 'g1', rollup: rollup({ costUSD: 8 }) }, { id: 's3', rollup: mine }]
  expect(subtaskRollupOf(views, sub('s3'))).toBe(mine)
})

// --- costCellFor -----------------------------------------------------------------------------

test('costCellFor: no bucket at all renders N/A, never a 0', () => {
  expect(costCellFor(undefined)).toEqual({ kind: 'na' })
})

test('costCellFor: a subtask with no session filed yet — sessionsUsed 0, costUSD null — is honest N/A, not a fake 0', () => {
  const r = rollup({ sessionsUsed: 0, sessionsLinked: 0, rounds: null, activeMinutes: null, tokens: null, costUSD: null })
  expect(costCellFor(r)).toEqual({ kind: 'money', usd: null })
})

test('costCellFor: an ordinary priced subtask renders its dollar figure', () => {
  expect(costCellFor(rollup({ costUSD: 12.34 }))).toEqual({ kind: 'money', usd: 12.34 })
})

test('costCellFor: mixed currency takes the credits branch even if costUSD is set', () => {
  const r = rollup({ mixedCurrency: true, costUSD: 5, credits: { nanoAiu: 0, premiumRequests: 4 } })
  expect(costCellFor(r)).toEqual({ kind: 'credits', premiumRequests: 4 })
})

test('costCellFor: Copilot-only credits with no USD figure takes the credits branch', () => {
  const r = rollup({ mixedCurrency: false, costUSD: null, credits: { nanoAiu: 0, premiumRequests: 2 } })
  expect(costCellFor(r)).toEqual({ kind: 'credits', premiumRequests: 2 })
})

// --- costCaveat ------------------------------------------------------------------------------

test('costCaveat: absent when every linked session is priced', () => {
  expect(costCaveat(rollup({ sessionsUsed: 2, sessionsLinked: 2 }))).toBeUndefined()
})

test('costCaveat: names the split when some sessions have no conversation link', () => {
  expect(costCaveat(rollup({ sessionsUsed: 3, sessionsLinked: 2 }))).toBe('cost covers 2 of 3 sessions')
})

test('costCaveat: absent when there is no bucket to speak of', () => {
  expect(costCaveat(undefined)).toBeUndefined()
})
