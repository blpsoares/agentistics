/**
 * event-dedupe.ts — PURE. The same end of turn, seen twice, read once.
 *
 * A Claude session that stops answering is reported by BOTH sources: the `Stop` hook fires
 * immediately, and the poller notices up to five seconds later that the screen went quiet. They are
 * the same fact. The reader wants it once.
 *
 * ## The hook wins, and the rule is one-directional
 *
 * The hook is exact (Claude itself said the turn ended) and it is FIRST (no polling interval to
 * wait out). So a hook event is always written, and a poll event is suppressed when a hook event
 * for the same conversation already landed inside the window. Never the other way round: a poller
 * event arriving first would mean the hook is not installed, or is slower than its own event, and
 * dropping the hook's exact record in favour of an inference is the wrong trade in both cases.
 *
 * ## Matching, and why `cwd` is a fallback rather than the key
 *
 * `conversationId` is the only key both sources provably share, so it is preferred. It is often
 * absent — agentop does not learn the conversation id of a session it started fresh — and the
 * fallback is `harness === 'claude'` plus the same `cwd`. That is a heuristic, and it is bounded on
 * purpose: it only ever applies to Claude (no other harness has a hook to collide with), and only
 * inside `DEDUPE_WINDOW_MS`. Two Claude sessions in one directory finishing within that window
 * would collapse into one line — a real, rare loss, chosen over the certain and constant duplicate.
 *
 * ## Only turn-shaped kinds are deduped
 *
 * `Stop` says the turn ended; the poller renders that as `waiting` (the screen stopped moving) and
 * the hook as `turn-end`. Those two are the pair. A `waiting-approval` has no hook counterpart at
 * all — Claude Code does not fire `Stop` for a permission prompt — so it is never suppressed, which
 * matters because it is the event a person most needs to see.
 */

import type { SessionEvent } from './event-types'

/**
 * How long a hook event shadows the poll event that duplicates it.
 *
 * Wider than the five-second poll (the poll that notices is the one AFTER the turn ended, so the
 * gap can be a full interval plus the capture) and narrow enough that a second turn in the same
 * conversation is its own event. Twenty seconds is two polls plus room.
 */
export const DEDUPE_WINDOW_MS = 20_000

/** The kinds that describe "the turn ended", one word per source. */
const TURN_END_KINDS = new Set(['turn-end', 'waiting'])

function sameConversation(a: SessionEvent, b: SessionEvent): boolean {
  if (a.conversationId && b.conversationId) return a.conversationId === b.conversationId
  // The fallback, deliberately narrow — see the header.
  if (a.harness !== 'claude' || b.harness !== 'claude') return false
  return a.cwd !== '' && a.cwd === b.cwd
}

/**
 * Is this candidate a duplicate of something already in the inbox?
 *
 * `recent` is whatever the caller has to hand — the tail of the inbox is enough, and cheaper than
 * the whole file. A caller that passes nothing suppresses nothing, which is the safe direction: an
 * extra line is visible and self-correcting, a dropped one is not.
 */
export function isDuplicate(
  candidate: SessionEvent,
  recent: readonly SessionEvent[],
  nowMs: number,
  windowMs = DEDUPE_WINDOW_MS,
): boolean {
  // Only a POLL event is ever suppressed, and only a turn-shaped one.
  if (candidate.source !== 'poll') return false
  if (!TURN_END_KINDS.has(candidate.kind)) return false

  for (const seen of recent) {
    if (seen.source !== 'hook') continue
    if (!TURN_END_KINDS.has(seen.kind)) continue
    const seenMs = Date.parse(seen.at)
    // An unparseable timestamp cannot be shown to be inside the window, so it does not suppress.
    if (!Number.isFinite(seenMs)) continue
    if (nowMs - seenMs > windowMs || seenMs > nowMs + windowMs) continue
    if (sameConversation(candidate, seen)) return true
  }
  return false
}

/** The candidates that survive, in order. Each one is judged against the inbox tail AND against the
 *  ones already kept from this same batch, so one poll cannot emit two duplicates of each other. */
export function dedupeEvents(
  candidates: readonly SessionEvent[],
  recent: readonly SessionEvent[],
  nowMs: number,
  windowMs = DEDUPE_WINDOW_MS,
): SessionEvent[] {
  const kept: SessionEvent[] = []
  for (const c of candidates) {
    if (isDuplicate(c, [...recent, ...kept], nowMs, windowMs)) continue
    kept.push(c)
  }
  return kept
}
