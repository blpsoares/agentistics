/**
 * attention-rules.ts — PURE. The per-harness screen markers, READ FROM REAL FRAMES.
 *
 * Every pattern here was captured on 2026-08-13 by starting the CLI under tmux and reading
 * `capture-pane -p`. Nothing is written from memory of what a CLI prints, for the same reason
 * `spawn-spec.ts` reads every flag from the tool's own `--help`: a plausible-looking pattern that
 * never matches fails SILENTLY. It does not throw and it does not look wrong — it just reports a
 * working session as waiting, forever, and the counter that was supposed to earn this feature its
 * place becomes noise.
 *
 * Two findings from that probe are load-bearing, and both contradict what the patterns would have
 * been if guessed:
 *
 *  - **Claude's input box is not a discriminator.** The `❯` prompt line and its two rules are drawn
 *    identically while a turn is running and after it finishes. Only the FOOTER changes —
 *    `esc to interrupt` while working, `? for shortcuts` when done. A rule keyed on the box would
 *    have called every working session waiting.
 *  - **Codex has no working marker at all.** Its status footer and its ghost placeholder
 *    (`› Find and fix a bug in @filename`) are byte-identical while it streams output and while it
 *    sits idle. For codex, movement is the only working signal that exists, so `working` is absent
 *    rather than approximated.
 *
 * `Record<HarnessId, … | null>` and not a `Partial`: a harness added to `HarnessId` must fail the
 * build until someone decides, exactly as `SPAWN_SPECS` and `HARNESS_CAPABILITIES` do. `null` is
 * that decision — "not probed", which the UI reports as approval detection being unavailable.
 *
 * No pattern may carry the `g` flag: `RegExp.test` is stateful with it and alternate calls return
 * false. The test asserts this.
 */

import type { HarnessId } from '@agentistics/core'
import type { AttentionRules } from './types'

export const ATTENTION_RULES: Record<HarnessId, AttentionRules | null> = {
  claude: {
    probed: 'claude 2.1.231 2026-08-13; permission prompt re-probed on 2.1.232, 2026-08-14',
    approval: [
      // Captured from the folder-trust dialog claude opens with, and from `/model`.
      /Enter to confirm · Esc to cancel/,
      // THE PERMISSION PROMPT DOES NOT DRAW THAT FOOTER, and the comment here used to claim it did.
      // Caught by watching a real session sit on `rm -v …` while the monitor reported plain
      // `waiting`: a tool-permission prompt draws `Esc to cancel · Tab to amend · ctrl+e to
      // explain` and asks `Do you want to proceed?`. Both are matched, because they fail
      // independently — the footer varies with what the prompt offers (a plan-mode prompt has no
      // `Tab to amend`), while the question is the component's own and does not.
      //
      // This is exactly the failure mode this file's header warns about, and it is worth recording
      // that it happened anyway: a pattern that never matches does not throw and does not look
      // wrong. It reported the ONE state this whole channel exists for as an ordinary wait.
      /Do you want to proceed\?/,
      /Esc to cancel · Tab to amend/,
    ],
    // The footer while a turn runs. `? for shortcuts` takes its place when the turn ends.
    working: [/esc to interrupt/],
  },
  codex: {
    probed: 'codex 0.113.0, 2026-08-13',
    approval: [/Press enter to continue/],
    // `working` deliberately absent — see the header.
  },
  kimi: {
    probed: 'kimi 0.35.0, 2026-08-13',
    approval: [/↑↓ navigate · Enter select · Esc exit/],
  },
  gemini: {
    probed: 'gemini 0.55.1, 2026-08-13',
    // Captured from TWO different blocking dialogs — the folder-trust prompt it opens with and an
    // authentication confirmation — which is what makes this the component's footer rather than one
    // dialog's wording.
    approval: [/Enter to select · ↑\/↓ to navigate/],
    // No working marker found: gemini's frame while a turn runs was not distinguishable from its
    // idle one in the frames captured, so movement is the only signal. Absent, not approximated.
  },
  copilot: {
    probed: 'GitHub Copilot CLI 1.0.79, 2026-08-13',
    approval: [/↑\/↓ to navigate · enter to select/],
  },
  antigravity: {
    probed: 'agy 1.1.12, 2026-08-13',
    // agy words its footer differently from the others — `Navigate`/`Confirm` capitalised, no `esc`
    // — which is precisely why each harness gets its own probed pattern instead of one shared guess.
    approval: [/↑\/↓ Navigate · enter Confirm/],
  },
}

/** The rules for a harness, or `undefined` when it was never probed. */
export function rulesFor(harness: HarnessId): AttentionRules | undefined {
  return ATTENTION_RULES[harness] ?? undefined
}
