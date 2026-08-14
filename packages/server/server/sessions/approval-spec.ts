/**
 * approval-spec.ts — PURE. The keystroke that ANSWERS each harness's blocking dialog.
 *
 * A sibling of `attention-rules.ts`, and deliberately a second file rather than a field on it,
 * because the two answer different questions and can be known independently: `attention-rules.ts`
 * says how to RECOGNISE that a session is blocked, this says what to SEND once it is. A harness
 * could be probed for the first and not the second — a dialog whose footer names no key at all — and
 * a single record would then force one guess to stand in for the other.
 *
 * ## What a spec claims, exactly
 *
 * `key` is the keystroke that CONFIRMS THE OPTION THE DIALOG HAS HIGHLIGHTED. It is not "approve",
 * and the difference matters enough to be the reason this feature is built the way it is: none of
 * these CLIs can be asked which option is highlighted, and a dialog whose default is "No, tell
 * Claude what to do differently" would be answered by the same byte that approves everywhere else.
 *
 * So the keystroke is only half of the design. The other half is that the caller REREADS the screen
 * immediately before sending (a poll is up to five seconds old — the dialog may already be gone) and
 * SHOWS THE FRAME to the person answering. What is being confirmed is on the screen; the only thing
 * this table supplies is the byte that presses it.
 *
 * ## Where the values come from
 *
 * Every one of them is the footer `attention-rules.ts` captured, read for what it says about keys —
 * same probe, same CLI versions, same date, nothing added from memory of what a CLI prints:
 *
 *   claude       `Enter to confirm · Esc to cancel`
 *   codex        `Press enter to continue`
 *   kimi         `↑↓ navigate · Enter select · Esc exit`
 *   gemini       `Enter to select · ↑/↓ to navigate`
 *   copilot      `↑/↓ to navigate · enter to select`
 *   antigravity  `↑/↓ Navigate · enter Confirm`
 *
 * All six name ENTER, and all six name it as the key that takes the highlighted option. That the
 * table currently holds one value six times is a finding, not a shortcut — the footers disagree
 * about wording, capitalisation and whether `esc` is even mentioned, which is exactly why each is
 * recorded on its own row rather than collapsed into one shared assumption.
 *
 * `Record<HarnessId, … | null>` and not a `Partial`: a harness added to `HarnessId` must fail the
 * build until someone decides, the same rule `SPAWN_SPECS`, `ATTENTION_RULES` and
 * `HARNESS_CAPABILITIES` follow. `null` is that decision — "nobody has read this dialog" — and the
 * verb is then ABSENT rather than offered and wrong, with the UI saying so in words.
 *
 * The values are tmux key names (`send-keys` argument syntax), because that is the only backend
 * there is. When a second backend exists this becomes its own vocabulary; until then, inventing an
 * abstraction over one implementation would be inventing a mapping nobody can check.
 */

import type { HarnessId } from '@agentistics/core'

export interface ApprovalSpec {
  /**
   * The key that takes the option the dialog is currently highlighting, as tmux `send-keys` names
   * it. NOT "the key that approves" — see the header.
   */
  key: string
  /** Provenance — the exact CLI version the dialog came from, and the date. */
  probed: string
}

export const APPROVAL_SPECS: Record<HarnessId, ApprovalSpec | null> = {
  claude: { key: 'Enter', probed: 'claude 2.1.231, 2026-08-13' },
  codex: { key: 'Enter', probed: 'codex 0.113.0, 2026-08-13' },
  kimi: { key: 'Enter', probed: 'kimi 0.35.0, 2026-08-13' },
  gemini: { key: 'Enter', probed: 'gemini 0.55.1, 2026-08-13' },
  copilot: { key: 'Enter', probed: 'GitHub Copilot CLI 1.0.79, 2026-08-13' },
  antigravity: { key: 'Enter', probed: 'agy 1.1.12, 2026-08-13' },
}

/** The spec for a harness, or `undefined` when its dialog was never read. */
export function approvalFor(harness: HarnessId | undefined): ApprovalSpec | undefined {
  return harness ? (APPROVAL_SPECS[harness] ?? undefined) : undefined
}
