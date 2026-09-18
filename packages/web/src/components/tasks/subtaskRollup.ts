/**
 * subtaskRollup.ts — pure reads over `TaskDetail.subtaskRollups`, pulled out of `SubtaskTable.tsx`
 * so the N/A-vs-zero decision has something testable to assert against.
 *
 * This project has no React-rendering test infrastructure (see `ConnectionCard.test.tsx`), so the
 * one thing worth getting wrong here — whether a subtask with no session yet renders as an honest
 * "not measured" rather than a `0` — is asserted directly against these functions, not through DOM.
 */

import type { AttemptRollup, Subtask, SubtaskView, TaskStats } from '../../lib/tasks'

/**
 * The EFFECTIVE bucket key of a subtask — the same one the server bucketed by.
 *
 * `subtaskViews()` (`task-report.ts`) keys a bucket by `s.groupId ?? s.id`, so a group of subtasks
 * collapses into ONE view filed under the group id and NEITHER member's own id appears in the list.
 * Reading a grouped subtask by its own id therefore finds nothing — or, worse, a stale per-member
 * bucket — and a member would show N/A (or a second, smaller sum) beside siblings showing the
 * group's real figure. See docs/superpowers/specs/2026-09-11-alm-session-linking-ux.md §B.3.
 */
export function rollupKeyOf(subtask: Pick<Subtask, 'id' | 'groupId'>): string {
  return subtask.groupId ?? subtask.id
}

/** The rollup for one subtask, or `undefined` when the server has no bucket for it at all — which
 *  reads exactly like an empty one: nothing measured, never a `0` standing in for it.
 *
 *  It takes the SUBTASK and not a bare id on purpose: the effective key is the group's whenever
 *  there is one, and a signature accepting a plain string is one a caller can satisfy with
 *  `t.id` — silently reading the wrong bucket for every grouped row. */
export function subtaskRollupOf(
  views: readonly SubtaskView[],
  subtask: Pick<Subtask, 'id' | 'groupId'>,
): AttemptRollup | undefined {
  const key = rollupKeyOf(subtask)
  return views.find(v => v.id === key)?.rollup
}

/**
 * The delivery-evidence numbers for one subtask (or the direct branch), or `undefined` when the
 * server has no bucket for it at all — the same "no bucket" vs "an honest empty one" distinction
 * `subtaskRollupOf` already makes for the cost/session rollup, applied here to
 * `SubtaskView.stats`. A `null` result (bucket exists, `stats` is `null`) means nothing is filed
 * under this piece yet; a real `TaskStats` object means at least one session is, even if none of
 * them reported anything measurable. See
 * docs/superpowers/specs/2026-09-11-alm-session-linking-ux.md §C.5.
 *
 * Same effective-key resolution as `subtaskRollupOf` — a grouped subtask's evidence numbers live
 * under the GROUP's bucket, never a per-member one.
 */
export function subtaskStatsOf(
  views: readonly SubtaskView[],
  subtask: Pick<Subtask, 'id' | 'groupId'>,
): TaskStats | null | undefined {
  const key = rollupKeyOf(subtask)
  return views.find(v => v.id === key)?.stats
}

export type CostCell =
  | { kind: 'na' }
  | { kind: 'credits'; premiumRequests: number }
  /** `usd: null` still renders as N/A — `useMoney()` already refuses to turn `null` into `$0.00`. */
  | { kind: 'money'; usd: number | null }

/** Same branch `TaskTable.tsx`'s own cost cell takes, over one subtask's rollup instead of a
 *  task's — a second formatting rule here would be a second answer for the same figure. */
export function costCellFor(r: AttemptRollup | undefined): CostCell {
  if (!r) return { kind: 'na' }
  if (r.mixedCurrency || (r.credits !== null && r.costUSD === null)) {
    return { kind: 'credits', premiumRequests: r.credits!.premiumRequests }
  }
  return { kind: 'money', usd: r.costUSD }
}

/** Whether the cost cell should carry the "N of M sessions priced" caveat as a tooltip. */
export function costCaveat(r: AttemptRollup | undefined): string | undefined {
  if (!r || r.sessionsLinked >= r.sessionsUsed) return undefined
  return `cost covers ${r.sessionsLinked} of ${r.sessionsUsed} sessions`
}
