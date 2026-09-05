/**
 * attention-stable.ts — PURE: a state has to hold still before it is believed.
 *
 * ⚠️ NOT WIRED YET, deliberately, and this note is the honest half of that.
 *
 * The rule below is right and tested; hooking it into `sessions-host.ts` is not done, because the
 * poller ALREADY carries a confirmation in one direction (`working → waiting`) and believes the
 * other one at once. Making both symmetric broke three of its tests, and each of those tests
 * encodes a deliberate decision with its reason written beside it. Changing them needs a reading of
 * the poller this note's author did not finish, and guessing at it is how the flapping got shipped
 * in the first place.
 *
 * WHAT IS ESTABLISHED, so the next reader does not re-derive it:
 *   - The flapping is `waiting → working` being believed on movement ALONE. A repaint moves the
 *     frame; the row flips instantly and takes two polls to come back.
 *   - The fix is to require corroboration for that direction ONLY when the harness prints a working
 *     marker at all — `esc to interrupt` for claude. A harness with no marker (codex) has nothing
 *     better than movement, and must keep believing it at once.
 *   - `markerBacked = rules?.working?.some(re => re.test(frame.join('\n')))` is the flag, passed in
 *     as `corroborated`.
 *   - An attempt to wire exactly that produced `working` where `waiting` was expected in the
 *     poller's own tests, and the reason was NOT established. That is where to start.
 *
 * `attentionOf` reads `working` from whether the pane MOVED since the last poll, and that is the
 * only universal signal there is — codex draws an identical screen streaming and idle. It is also
 * noisy: a pane moves for reasons that are not a turn. A tmux advisory line, a plugin notice, a
 * clock in a status bar, a spinner finishing its last frame — any of them flips a row to `working`
 * for one poll and back.
 *
 * On screen that is a row changing colour and wording every few seconds, and a notification each
 * time: "tem sessao que ta alterandno entre workking e needs you a cada 1s cara". The web notifier
 * was taught to wait for two consecutive polls, which stopped the noise it made and left the ROW
 * flapping — the label and the colour are read straight from the state.
 *
 * So the confirmation belongs HERE, at the source, where both the row and every notifier read from
 * it. It is the same rule `event-plan.ts` already states for the same signal, and for the same
 * reason: a time window does not work, because the next flicker lands outside it.
 *
 * TWO EXCEPTIONS, and they are what keep this honest:
 *
 * - `waiting-approval` is applied IMMEDIATELY. It means a person is being asked something, and
 *   delaying it by a poll to smooth a colour is trading a real block for a cosmetic problem. Same
 *   judgement `event-dedupe.ts` makes when it refuses to dedupe this one state.
 * - `exited` is applied immediately. The process is gone; there is nothing to confirm, and holding
 *   a dead session at `working` for another poll is a lie with a spinner on it.
 */

import type { SessionActivity } from './types'

/** What the caller carries between polls for one session. */
export interface StablePending {
  /** The state that has been seen once and is waiting to be seen again. */
  state: SessionActivity
}

/** States that take effect the moment they are observed — see the header. */
const IMMEDIATE: ReadonlySet<SessionActivity> = new Set<SessionActivity>(['waiting-approval', 'exited'])

export interface StableInput {
  /** What this poll observed. */
  observed: SessionActivity
  /** What the row is currently showing. Absent on the first sighting of a session. */
  shown?: SessionActivity
  /** What was observed on the previous poll but not yet believed. */
  pending?: StablePending
  /**
   * The observation is CORROBORATED — believe it at once.
   *
   * Movement alone is the weakest evidence there is: a repaint moves the frame and means nothing.
   * A working MARKER on the screen (`esc to interrupt`) is the harness saying so itself, and a
   * harness that prints no marker has nothing better to offer, so its movement stands on its own.
   * The caller knows which of those it has; this module only knows how long to wait.
   */
  corroborated?: boolean
}

export interface StableResult {
  /** What the row should show now. */
  state: SessionActivity
  /** Carry this to the next poll. */
  pending?: StablePending
}

/**
 * The state to show, and what to remember.
 *
 * The FIRST sighting of a session is shown at once: there is nothing to flap against yet, and
 * holding a new row blank for a poll would make every start look slow.
 */
export function stableAttention(
  { observed, shown, pending, corroborated }: StableInput,
): StableResult {
  if (shown === undefined) return { state: observed }
  if (IMMEDIATE.has(observed)) return { state: observed }
  if (corroborated) return { state: observed }
  if (observed === shown) return { state: shown }
  // A change: believed only when the previous poll saw the same thing.
  if (pending?.state === observed) return { state: observed }
  return { state: shown, pending: { state: observed } }
}
