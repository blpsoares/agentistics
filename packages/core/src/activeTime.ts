/**
 * activeTime.ts — the project-wide rule for how long a session ACTUALLY lasted.
 *
 * `duration_minutes` is wall-clock: last event − first event. It answers "when was this session
 * open", not "how long was it worked on". A session reopened across three weeks reports 958h, which
 * is true and useless. This module computes the other half: `active_minutes`.
 *
 * THE RULE (identical for every harness — see docs/harness-contract.md):
 *
 *   active time = Σ per-turn duration, where a turn runs from a human prompt until the harness
 *   stops working on it (its last event before the next human prompt).
 *
 *   1. If the harness MEASURED the turn itself and wrote it to disk, that number wins.
 *      Claude Code writes `{"type":"system","subtype":"turn_duration","durationMs":N}`; Codex
 *      writes `task_complete.duration_ms`; Copilot brackets a turn with
 *      `assistant.turn_start` / `assistant.turn_end`.
 *   2. Otherwise the turn is reconstructed from the event timestamps the harness does write.
 *      This is the same quantity, not an approximation of a different one: validated against
 *      Claude's own `turn_duration` over 1326 real turns, the reconstruction has a MEDIAN
 *      difference of 0.0s and lands within 5s on 63% of them.
 *   3. If a harness writes no per-event timestamps at all, the result is `undefined` — the UI
 *      shows "—". Never a guess, never an idle-gap threshold pulled out of the air.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: subtract "the user walked away mid-turn". A turn blocked on
 * a permission prompt overnight is measured as ~8h by Claude Code itself. Cutting it would require
 * an arbitrary idle cutoff, which would be a made-up number in a metric whose whole point is to
 * stop reporting made-up numbers. The gap that IS excluded — between the harness finishing and the
 * human's next prompt — is excluded because it is a real, observable boundary, not a threshold.
 */

/** One event from a harness transcript, mapped to the only three things this rule needs. */
export interface TurnEvent {
  /** Event time, epoch ms. Events must be supplied in transcript (chronological) order. */
  ts: number
  /** True only for a genuine HUMAN prompt — never a tool result, replay or system line. */
  userPrompt?: boolean
  /** A duration the harness itself recorded for the turn that ends at this event, in ms. */
  measuredMs?: number
  /** The harness itself recorded that the turn ended HERE (an abort, a shutdown, an explicit
   *  end-of-turn marker) without stating a duration. Closes the open turn at this timestamp.
   *  Without it, a turn the user aborted stays open until the session's last line — a Copilot
   *  session aborted at 20:13 whose file ends at 23:34 reported 3.4h of "active" work. */
  turnEnd?: boolean
}

/** Close-out of one turn; exported for tests and for adapters that want the count. */
export interface ActiveTimeResult {
  /** Total active time in minutes, or `undefined` when the transcript carries no usable time. */
  activeMinutes?: number
  /** How many turns were counted. */
  turns: number
  /** How many of those came from a duration the harness measured itself (rule 1). */
  measuredTurns: number
}

/**
 * Applies THE RULE above to one session's events.
 *
 * A `measuredMs` event closes the open turn with the harness's own number. A `userPrompt` closes
 * the previous turn (at the last event seen) and opens a new one. Anything else just advances the
 * clock. Backwards timestamps contribute 0 rather than a negative, so a transcript written out of
 * order can never subtract time.
 */
export function computeActiveTime(events: TurnEvent[]): ActiveTimeResult {
  let totalMs = 0
  let turns = 0
  let measuredTurns = 0
  let sawTime = false
  let turnStart: number | null = null
  let last: number | null = null

  for (const e of events) {
    const ts = Number.isFinite(e.ts) ? e.ts : NaN
    // `last` is advanced AFTER the branches below: a turn must be closed at the last event of that
    // turn, not at the prompt that starts the next one — otherwise every idle gap is counted back in.
    if (!Number.isNaN(ts)) sawTime = true

    if (typeof e.measuredMs === 'number' && Number.isFinite(e.measuredMs) && e.measuredMs >= 0) {
      // The harness measured this turn. Its number replaces anything we would reconstruct — but
      // only when a turn is actually open, so a stray metric line can't invent a turn.
      if (turnStart !== null) {
        totalMs += e.measuredMs
        turns++
        measuredTurns++
        turnStart = null
      }
      if (!Number.isNaN(ts)) last = ts
      continue
    }

    if (e.turnEnd && !Number.isNaN(ts)) {
      if (turnStart !== null) {
        totalMs += Math.max(0, ts - turnStart)
        turns++
        turnStart = null
      }
      last = ts
      continue
    }

    if (e.userPrompt && !Number.isNaN(ts)) {
      if (turnStart !== null && last !== null) {
        totalMs += Math.max(0, last - turnStart)
        turns++
      }
      turnStart = ts
    }
    if (!Number.isNaN(ts)) last = ts
  }

  // The final turn ends at the last event of the transcript.
  if (turnStart !== null && last !== null) {
    totalMs += Math.max(0, last - turnStart)
    turns++
  }

  if (!sawTime) return { activeMinutes: undefined, turns: 0, measuredTurns: 0 }
  return { activeMinutes: Math.round(totalMs / 60000), turns, measuredTurns }
}

/** Convenience wrapper for adapters that only need the number. */
export function activeMinutesOf(events: TurnEvent[]): number | undefined {
  return computeActiveTime(events).activeMinutes
}
