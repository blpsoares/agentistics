/**
 * subtaskRollup.ts — pure reads over `TaskDetail.subtaskRollups`, pulled out of `SubtaskTable.tsx`
 * so the empty-vs-N/A-vs-zero decision has something testable to assert against.
 *
 * This project has no React-rendering test infrastructure (see `ConnectionCard.test.tsx`), so the
 * one thing worth getting wrong here — whether a subtask with no session yet renders as an honest
 * "not measured" rather than a `0` — is asserted directly against these functions, not through DOM.
 *
 * **A subtask with no session filed under it renders NO metric field at all — not even "N/A".**
 * It used to render "N/A", which reads as "this was measured and could not be priced" — the wrong
 * sentence for "nobody has done anything here yet". `isUntracked` is the ONE place that draws the
 * line: `sessionsUsed === 0` means metric tracking has not started, and the cell stays blank until
 * a session is actually linked. "N/A" is kept for the genuinely different case — a LINKED session
 * whose cost or token count still cannot be produced (an unlinked conversation, a harness that does
 * not report a figure) — which is a real measurement that came back empty, not an absent one.
 */

import type { AttemptRollup, Subtask, SubtaskView } from '../../lib/tasks'

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
 * A subtask nobody has filed a session under yet is not "measured at zero" and not even "not
 * measurable" — it simply has no metric to show, because metric tracking starts the moment a
 * session is linked. `!r` (no bucket at all, which should not happen given the server always
 * returns one per subtask — see `subtaskViews()` — but is not proof of a session either) is read
 * the same way: absence of a bucket is absence of a session, never evidence of one.
 */
export function isUntracked(r: AttemptRollup | undefined): boolean {
  return !r || r.sessionsUsed === 0
}

export type CostCell =
  /** No session has ever been filed here — render NO field at all, not even "N/A". */
  | { kind: 'empty' }
  | { kind: 'credits'; premiumRequests: number }
  /** `usd: null` here means a LINKED session whose cost genuinely cannot be computed — that one
   *  still renders "N/A", since `useMoney()` refuses to turn `null` into `$0.00`. */
  | { kind: 'money'; usd: number | null }

/** Same branch `TaskTable.tsx`'s own cost cell takes, over one subtask's rollup instead of a
 *  task's — a second formatting rule here would be a second answer for the same figure. */
export function costCellFor(r: AttemptRollup | undefined): CostCell {
  if (isUntracked(r)) return { kind: 'empty' }
  const rollup = r!
  if (rollup.mixedCurrency || (rollup.credits !== null && rollup.costUSD === null)) {
    return { kind: 'credits', premiumRequests: rollup.credits!.premiumRequests }
  }
  return { kind: 'money', usd: rollup.costUSD }
}

export type TokensCell =
  /** No session has ever been filed here — render NO field at all, not even "N/A". */
  | { kind: 'empty' }
  | { kind: 'tokens'; n: number | null }

/** The tokens column's own version of `costCellFor` — same "no session yet" rule, over `r.tokens`
 *  instead of `r.costUSD`. Kept as its own function rather than a boolean flag on the caller, so
 *  the decision lives in one place next to the cost one it mirrors. */
export function tokensCellFor(r: AttemptRollup | undefined): TokensCell {
  if (isUntracked(r)) return { kind: 'empty' }
  return { kind: 'tokens', n: r!.tokens }
}

/** Whether the cost cell should carry the "N of M sessions priced" caveat as a tooltip. */
export function costCaveat(r: AttemptRollup | undefined): string | undefined {
  if (!r || r.sessionsLinked >= r.sessionsUsed) return undefined
  return `cost covers ${r.sessionsLinked} of ${r.sessionsUsed} sessions`
}
