/**
 * task-conversations.ts — PURE. The ONE rule for "which row stands for a conversation" when a
 * surface walks a task's registry rows. `task-report.ts`, `task-stats.ts` and `task-overview.ts` all
 * read it, and it lives here rather than in `task-report.ts` only because `task-report.ts` imports
 * `task-stats.ts` — a rule two of them share cannot sit in the one that imports the other.
 *
 * Every attach, reopen and restart mints a NEW managed id for the SAME conversation and retires the
 * old row without removing it (see `collapseSupersededSessions` for the fleet's own list), so a
 * conversation worked on across a fortnight is several registry rows. They are one conversation and
 * must be counted once — but they are NOT interchangeable: each row carries its own filing
 * (`taskId` / `subtaskId` / `attemptId`), its own `endedAt` and its own liveness, and the filing is
 * a MOVE (`planAttach`), so only the newest row holds where the person put the conversation LAST.
 */

import type { ManagedSession } from './types'

/**
 * Is `a` at least as new as `b`? By `createdAt` when both parse and differ; otherwise REGISTRY
 * ORDER decides, and a later row is the newer one (the registry only ever appends). A missing or
 * unparseable stamp must not be a reason to keep the older row: an unreadable date is not evidence
 * that a row is old.
 */
function atLeastAsNew(a: ManagedSession, b: ManagedSession): boolean {
  const ta = Date.parse(a.createdAt)
  const tb = Date.parse(b.createdAt)
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb
  return true
}

/**
 * One row per CONVERSATION — and that row is the NEWEST of the candidates it is given, because the
 * newest row carries the CURRENT filing and the CURRENT liveness. Output order is the FIRST-SEEN
 * order of the conversations, with the newest row substituted into its conversation's slot, so a
 * list does not reshuffle when a conversation is reopened.
 *
 * The rule is stated once here for every surface that accumulates over a task's rows. Keeping the
 * FIRST row instead (as this once did) counted each conversation correctly and then described it by
 * its OLDEST row: a session filed on a subtask yesterday and running now was absent from a task's
 * `sessions`, and its cost stayed attributed to whichever filing it was born with.
 *
 * The candidates are whatever the caller passes, so the caller decides the scope: hand it a task's
 * rows (`rowsOfTask`) and the newest row OF THAT TASK stands for the conversation.
 *
 * A row with NO conversation link is always kept: it cannot be shown to be a duplicate of anything.
 */
export function distinctConversations(rows: readonly ManagedSession[]): ManagedSession[] {
  const slotOf = new Map<string, number>()
  const out: ManagedSession[] = []
  for (const r of rows) {
    if (!r.conversationId) {
      out.push(r)
      continue
    }
    const slot = slotOf.get(r.conversationId)
    if (slot === undefined) {
      slotOf.set(r.conversationId, out.length)
      out.push(r)
    } else if (atLeastAsNew(r, out[slot]!)) {
      out[slot] = r
    }
  }
  return out
}
