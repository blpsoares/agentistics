/**
 * takeover.ts — PURE. Taking a conversation that is ALREADY RUNNING and reopening it under agentop.
 *
 * ## What this replaces, and why the previous answer was not one
 *
 * A conversation held by a live assistant could not be reopened, and the product said so:
 *
 *   "essa conversa já está aberta em …/worktrees/session-monitor — abra ela por lá."
 *
 * That sentence is **correct about the fact and useless as an action**. It names a place, and for a
 * background agent there is no place: no tty, no tmux, no window to go to. The user's answer was the
 * right one — *find the process, close it, and reopen the conversation here* — and it is right for a
 * reason worth writing down: the lock exists to stop TWO assistants in one conversation, and closing
 * the first satisfies it exactly. Refusing satisfies it by leaving the user with none.
 *
 * ## It is a destructive act, so it is planned rather than performed
 *
 * Ending somebody's running assistant loses whatever it was in the middle of. This module decides
 * and the caller performs, so the decision can be shown, confirmed and tested without a process
 * being killed to find out what would happen.
 *
 * ## Every harness, not just the one that reported it
 *
 * Killing a pid and resuming by id are the same two steps everywhere, so nothing here is
 * claude-specific: the caller supplies the holder (whatever source found it) and `planSpawn` already
 * knows which harnesses can resume by id at all. A harness that cannot is refused BEFORE anything is
 * killed — ending a session to then discover the conversation cannot be reopened would be the worst
 * possible order, and it is the one a check written after the kill would produce.
 */

import type { HarnessId } from '@agentistics/core'

/** The assistant currently holding a conversation. */
export interface ConversationHolder {
  /** OS pid, when the source could name one. Without it nothing can be closed. */
  pid?: number
  /** The agentop row driving it, when it is one of ours — closed through the backend, not a signal. */
  sessionId?: string
  /** Where it is running, so the replacement opens in the same place. */
  cwd?: string
  /** What to call it while asking. */
  label?: string
}

export type TakeoverPlan =
  /** Close `holder`, then reopen `conversationId` in `cwd`. The only outcome that acts. */
  | { kind: 'takeover'; conversationId: string; cwd: string; holder: ConversationHolder }
  /** Nothing is holding it — the ordinary reopen applies, and this module has no business here. */
  | { kind: 'free'; conversationId: string }
  /** It cannot be done, and `reason` says which of the ways. */
  | { kind: 'refuse'; reason: TakeoverRefusal }

export type TakeoverRefusal =
  /** The harness cannot reopen a conversation by id, so closing the holder would strand it. */
  | { code: 'resume-unsupported'; harness: HarnessId }
  /** Something holds it and nothing here can close that something. */
  | { code: 'holder-unreachable'; label?: string }
  /** No directory to reopen in — a removed worktree, most likely. */
  | { code: 'no-cwd' }

/**
 * Decide — PURE.
 *
 * `resumable` is the harness's own capability (from `SPAWN_SPECS`), checked FIRST and before any
 * thought of closing anything. `holder` is whatever the caller's search turned up: `undefined`
 * means nothing holds the conversation.
 */
export function planTakeover(o: {
  conversationId: string
  harness: HarnessId
  /** Can this harness reopen a conversation by id at all? */
  resumable: boolean
  holder?: ConversationHolder
  /** Where to reopen. The holder's own directory when it has one. */
  cwd?: string
}): TakeoverPlan {
  if (!o.holder) return { kind: 'free', conversationId: o.conversationId }
  // Before the kill, always. Ending a session and THEN discovering the conversation cannot be
  // reopened is the one ordering that loses work for nothing.
  if (!o.resumable) return { kind: 'refuse', reason: { code: 'resume-unsupported', harness: o.harness } }

  // Closable through the backend (a row of ours) or by signal (a pid). With neither there is
  // nothing to act on, and saying so beats a verb that silently does nothing.
  if (o.holder.sessionId === undefined && o.holder.pid === undefined) {
    return {
      kind: 'refuse',
      reason: { code: 'holder-unreachable', ...(o.holder.label ? { label: o.holder.label } : {}) },
    }
  }

  const cwd = o.cwd ?? o.holder.cwd
  if (!cwd) return { kind: 'refuse', reason: { code: 'no-cwd' } }

  return { kind: 'takeover', conversationId: o.conversationId, cwd, holder: o.holder }
}
