/**
 * task-reopen.ts — PURE: what reopening a whole task actually does, row by row.
 *
 * Reopening a task is implemented twice — once behind `agentop session open` and once behind the
 * cockpit's verb — and the two had drifted: only one of them retired the row it was replacing, so
 * the same gesture left a different registry depending on where you pressed it. The DECISION lives
 * here and both callers perform it.
 *
 * The rules it encodes, each of which was a real defect:
 *
 *  - A row that is still RUNNING is left alone. After a reboot one session sometimes survives, and
 *    reopening the task must not spawn a second copy of it. It is reported as `already`, never as a
 *    failure — calling it a skip announces a problem where there is none.
 *  - A row already marked FINISHED is not resurrected. Ending a session is a decision, and "open
 *    the task" must not quietly undo every one of them.
 *  - A row whose conversation cannot be resolved is skipped AND counted. A partial reopen reported
 *    as a success leaves someone believing they have their whole task back.
 *  - Everything reopened RETIRES its old row. Without it a laptop closed and opened twice leaves the
 *    task holding two dead twins and one live session, all wearing the same name.
 */

import type { ManagedSession } from './types'

export interface TaskReopenRow {
  entry: ManagedSession
  /** The harness's own conversation id to resume. */
  resumeId: string
  /** What the new row should be called: the user's label wins over the transcript's title. */
  label: string
}

export interface TaskReopenPlan {
  /** In registry order, so a task comes back in the order it was built. */
  reopen: TaskReopenRow[]
  /** Ids left alone because they are still running. */
  already: string[]
  /** Ids that could not be reopened at all, and are reported as such. */
  skipped: string[]
}

export function planTaskReopen(o: {
  entries: readonly ManagedSession[]
  /** Ids the backend reports as alive right now. */
  liveIds: ReadonlySet<string>
  /** The conversation to resume for a row, or `null` when none can be resolved. */
  conversationFor: (entry: ManagedSession) => { sessionId: string; title: string } | null
}): TaskReopenPlan {
  const plan: TaskReopenPlan = { reopen: [], already: [], skipped: [] }
  for (const entry of o.entries) {
    // Ending a session is a decision; "open the task" must not quietly undo every one of them.
    if (entry.endedAt) continue
    if (o.liveIds.has(entry.id)) { plan.already.push(entry.id); continue }
    const conv = o.conversationFor(entry)
    if (!conv) { plan.skipped.push(entry.id); continue }
    plan.reopen.push({ entry, resumeId: conv.sessionId, label: entry.label ?? conv.title })
  }
  return plan
}

/** Whether the whole thing worked out: something came back, or something was already up. */
export function taskReopenSucceeded(plan: TaskReopenPlan, started: number): boolean {
  return started > 0 || plan.already.length > 0
}
