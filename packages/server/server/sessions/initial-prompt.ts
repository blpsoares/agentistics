/**
 * initial-prompt.ts — PURE. When and how a detached session's INITIAL PROMPT reaches the harness.
 *
 * ## The defect this exists for
 *
 * A session created detached with a prompt has to receive that prompt with no human in the loop. The
 * old path did not guarantee it: for a `send-keys` harness it typed after a FIXED 1200ms sleep (a
 * race a slow-starting harness loses — the keys land in a pane that has not drawn its prompt yet),
 * and for a `positional`/`flag` harness it passed the text in argv and relied entirely on the CLI
 * auto-submitting it. That reliance is fragile in two proven ways:
 *
 *  1. **Some harnesses/versions PRE-FILL without auto-submitting.** The field symptom was exact — the
 *     prompt "stays in the field" and nothing is sent, so the agent sits waiting for something that
 *     already arrived. A coordinator worked around it by `tmux send-keys`-ing every dispatch by hand;
 *     the workaround became a habit and the habit hid the defect for days.
 *  2. **A startup dialog can block the initial prompt.** Launched in a folder the harness does not
 *     yet trust, claude opens with a trust prompt whose DEFAULT option is "No, exit". The positional
 *     prompt is queued behind it — and a naive "just press Enter" would select "No, exit" and KILL
 *     the session. Submitting too early fails as silently and as badly as not submitting at all.
 *
 * ## The rule
 *
 * Deliver only once the harness is genuinely READY — its input surface drawn, and NOT sitting on a
 * startup/approval dialog — and then deliver ONCE:
 *
 *  - A `send-keys` harness (its only prompt flag exits) has the text TYPED IN after readiness.
 *  - A `positional` harness whose working marker lets us tell "already submitted" from "idle" (claude)
 *    gets a single Enter to SUBMIT the pre-filled text — but only after it has sat idle for a few
 *    consecutive polls without ever running, which gives a CLI that DOES auto-submit its beat to do
 *    so (we see the working marker and stand down). A running turn means it already went in.
 *  - A `positional` harness with no working marker (codex) is left to its CLI's own contract: we
 *    cannot tell an auto-submitted turn from an idle prompt, so forcing an Enter risks a double
 *    submit. Refusing to guess is the same discipline `attention-rules.ts` uses for an unprobed
 *    dialog.
 *  - A `flag` harness (`--prompt-interactive`) runs the prompt by design; nothing is delivered.
 *
 * Never into a dialog: a frame whose footer is a startup/approval prompt is never `ready`, so the
 * destructive early Enter cannot happen.
 *
 * The IMPURE loop lives in `backend-tmux.ts`; this module only reads a frame and a small streak and
 * says what to do, so every rule above is testable without a tmux server.
 */

import type { AttentionRules } from './types'
import { FOOTER_LINES } from './attention'

/**
 * How many consecutive READY-and-not-running polls before we act.
 *
 * For a `submit` harness it is the "auto-submit's beat": if the CLI were going to submit the
 * positional prompt itself, the working marker would have appeared within this window and we would
 * have stood down. For a `type` harness it just means the surface has been stably drawn — a hedge
 * against typing into a half-rendered frame. At the poll interval below (~400ms) this is a bit over a
 * second, matching the old fixed delay while being adaptive instead of a fixed guess.
 */
const READY_CONFIRM = 3

/** A line that is only box-drawing / rule characters — a frame's furniture, not its content. */
const RULE = /^[─━═╌┄┈╭╰╮╯┌└┐┘│|+\-=_~]+$/
/** A prompt or box glyph at the start of a line — every one of these CLIs draws its input box with
 *  one. Its presence is the cross-harness "the input surface is on screen" signal. */
const INPUT_GLYPH = /^\s*[❯›»▌│|>]/

function footerOf(frame: readonly string[]): string {
  return frame.slice(Math.max(0, frame.length - FOOTER_LINES)).join('\n')
}

/** A startup/approval dialog is on screen — matched in the FOOTER only, and never a running turn. */
function dialogPresent(frame: readonly string[], rules: AttentionRules): boolean {
  const footer = footerOf(frame)
  const working = rules.working?.some(re => re.test(footer)) ?? false
  return !working && rules.approval.some(re => re.test(footer))
}

/** The harness has drawn an input surface (a box edge or a prompt glyph), past the boot splash. */
function hasInputSurface(frame: readonly string[]): boolean {
  return frame.some(l => {
    const t = l.trim()
    if (!t) return false
    return RULE.test(t) || INPUT_GLYPH.test(l)
  })
}

/**
 * The harness is ready to receive the initial prompt: its input surface is drawn and it is not
 * sitting on a startup/approval dialog. PURE.
 */
export function promptSurfaceReady(frame: readonly string[], rules?: AttentionRules): boolean {
  if (rules && dialogPresent(frame, rules)) return false
  return hasInputSurface(frame)
}

/** A turn is running — for a positional harness that means the prompt was already submitted. PURE. */
export function turnRunning(frame: readonly string[], rules?: AttentionRules): boolean {
  if (!rules?.working) return false
  const footer = footerOf(frame)
  return rules.working.some(re => re.test(footer))
}

export interface DeliveryDecision {
  action: 'wait' | 'type' | 'submit' | 'done'
  /** The consecutive-ready streak to carry to the next poll. */
  readyStreak: number
}

/**
 * What the backend should do with the initial prompt on THIS poll — PURE.
 *
 * `mode` is the delivery kind the plan chose (`type` for a send-keys harness, `submit` for a
 * positional one). `readyStreak` is how many consecutive ready-and-not-running polls preceded this
 * one. The returned `readyStreak` is what to pass back next time.
 */
export function planPromptDelivery(o: {
  frame: readonly string[]
  rules?: AttentionRules
  mode: 'type' | 'submit'
  readyStreak: number
}): DeliveryDecision {
  // A running turn (positional auto-submit already fired) — nothing left to do.
  if (o.mode === 'submit' && turnRunning(o.frame, o.rules)) return { action: 'done', readyStreak: 0 }

  // Not ready (boot splash, or a dialog we must never submit into): wait, and reset the streak so a
  // momentary ready frame followed by a repaint does not count toward acting.
  if (!promptSurfaceReady(o.frame, o.rules)) return { action: 'wait', readyStreak: 0 }

  const readyStreak = o.readyStreak + 1
  if (readyStreak < READY_CONFIRM) return { action: 'wait', readyStreak }

  if (o.mode === 'type') return { action: 'type', readyStreak }

  // submit mode: only where a working marker lets us verify the CLI did NOT auto-submit. Without one
  // (codex) we cannot tell submitted from idle, so we never force an Enter — see the header.
  if (!o.rules?.working) return { action: 'wait', readyStreak }
  return { action: 'submit', readyStreak }
}
