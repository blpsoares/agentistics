/**
 * session-restore.ts — PURE: what to offer back after the machine took everything.
 *
 * A crash, a closed terminal, a WSL that fell over: tmux dies and every managed session reconciles
 * to `lost` while the registry keeps its name, its note and its task. The rows are all still there
 * and every one of them is reopenable — but finding that out means opening the app, noticing the
 * list is not what it was, and reopening them one at a time. The offer is the whole feature.
 *
 * What this module decides is WHICH rows are worth offering, and the answer is narrower than "every
 * lost row":
 *
 *  - A session the user ENDED is not lost work. `endedAt` is a decision, and an offer to restore
 *    what someone deliberately stopped is an offer to undo their last action.
 *  - A row with nothing to reopen is not an offer, it is a button that fails. Only rows whose
 *    conversation resolves are listed.
 *  - A conversation is CLAIMED once, so a repository holding four lost rows does not offer four
 *    copies of one conversation — the bug this project has already shipped once.
 *  - Nothing is offered while something is RUNNING. A machine that still has live sessions did not
 *    lose everything; it is a normal restart of the app, and greeting that with a modal is a modal
 *    people learn to dismiss without reading — which is the same as not having one.
 */

import type { ManagedSession } from './types'

export interface RestoreCandidate {
  id: string
  /** The user's own name when there is one, else the conversation's. */
  label: string
  harness: string
  cwd: string
  /** The harness's conversation id this row would reopen. */
  resumeId: string
  /** When it started, epoch ms — absent when the registry's timestamp is unreadable. */
  startedMs?: number
}

/**
 * The rows worth offering back, newest first — PURE.
 *
 * Newest first because a restore is a list someone reads under one question, and the sessions they
 * were in the middle of when the machine died are the recent ones. `limit` bounds it for the same
 * reason the closed block is bounded: a modal listing forty rows is not an offer, it is a wall.
 */
export function planRestore(o: {
  /** Every registry entry, with whether the backend still has it. */
  entries: readonly ManagedSession[]
  /** Ids the backend reports alive right now. */
  liveIds: ReadonlySet<string>
  /** The conversation this entry would reopen, or `null` when none resolves. */
  conversationFor: (entry: ManagedSession) => { sessionId: string; title: string } | null
  limit?: number
}): RestoreCandidate[] {
  // Something is still running: this is not a machine that lost everything.
  if (o.entries.some(e => o.liveIds.has(e.id) && !e.endedAt)) return []

  const out: RestoreCandidate[] = []
  for (const entry of o.entries) {
    // A session the user ENDED is not lost work — offering it back undoes their last action.
    if (entry.endedAt) continue
    if (o.liveIds.has(entry.id)) continue
    const conv = o.conversationFor(entry)
    // A row with nothing to reopen is a button that fails, not an offer.
    if (!conv) continue
    const started = Date.parse(entry.createdAt)
    out.push({
      id: entry.id,
      label: entry.label ?? conv.title,
      harness: entry.harness,
      cwd: entry.cwd,
      resumeId: conv.sessionId,
      ...(Number.isFinite(started) ? { startedMs: started } : {}),
    })
  }

  return out
    .sort((a, b) => (b.startedMs ?? 0) - (a.startedMs ?? 0))
    .slice(0, o.limit ?? 8)
}
