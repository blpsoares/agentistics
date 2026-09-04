/**
 * harnessModels.ts — PURE: the models each harness offers, and the NAME each one goes by.
 *
 * `spawn-spec.ts` already holds the ids `--model` accepts, and its rule is the one this file
 * inherits verbatim: A VALUE APPEARS HERE ONLY IF THE CLI ITSELF NAMES IT — in `--help`, in a
 * listing subcommand, or by answering with it when driven. A plausible id sourced from anywhere
 * else is a guess, and a guess here fails after the session has already started.
 *
 * What this file adds is the second half of the pair. The picker used to print `opus` while the
 * harness's own `/model` prints `Opus 5`, so the two surfaces named the same model differently.
 * The LABEL is what a person reads; the ID is what is sent, always.
 *
 * The direction matters and has bitten before. `modelSwitch.ts` records it: `/model` matches the
 * id, so a display label typed into a live session answers `Model 'Opus 5' not found` — a silent
 * no-op the user reads as the switch having worked. Never send `label`.
 *
 * This is a convenience and never a validation set: `planSpawn` does not check membership, because
 * every one of these CLIs also accepts a full model name and several scope what is available to
 * the signed-in account.
 *
 * `SPAWN_SPECS_MODEL_IDS` must equal `SPAWN_SPECS[h].modelSuggestions` for every harness — pinned
 * by `spawn-spec.test.ts`. Where the two disagree, `spawn-spec.ts` is the authority on which ids
 * exist; this file supplies the label and the source for each.
 */

import type { HarnessId } from './types'

export interface ModelOption {
  /** What the CLI accepts. Sent verbatim. */
  id: string
  /** What the harness itself calls it on screen. Displayed, never sent. */
  label: string
  /** When the pair was established, `YYYY-MM-DD`. */
  verifiedAt: string
  /** The exact command or output that established it. */
  source: string
}

/**
 * A `Record`, never an array or a partial: TypeScript accepts an array literal with a member
 * missing, and CLAUDE.md records five surfaces that silently lost a harness exactly that way.
 */
export const HARNESS_MODELS: Record<HarnessId, ModelOption[]> = {
  // VERIFIED 2026-09-02 against claude 2.1.259 by driving the CLI:
  //   `claude --model <alias> -p ok` is accepted for all four;
  //   `claude -p "/model <alias>"` answers `Set model to \`Fable 5.1\` | \`Opus 5\` |
  //   \`Sonnet 5\` | \`Haiku 4.5\`` for the same four.
  // `mythos` is deliberately ABSENT: both front doors reject it on this version.
  claude: [
    { id: 'fable', label: 'Fable 5.1', verifiedAt: '2026-09-02', source: 'claude -p "/model fable" → Set model to `Fable 5.1`' },
    { id: 'opus', label: 'Opus 5', verifiedAt: '2026-09-02', source: 'claude -p "/model opus" → Set model to `Opus 5`' },
    { id: 'sonnet', label: 'Sonnet 5', verifiedAt: '2026-09-02', source: 'claude -p "/model sonnet" → Set model to `Sonnet 5`' },
    { id: 'haiku', label: 'Haiku 4.5', verifiedAt: '2026-09-02', source: 'claude -p "/model haiku" → Set model to `Haiku 4.5`' },
  ],
  // `codex --help` prints "-m, --model <MODEL>" with no values, and no subcommand lists any.
  // Nothing to name honestly.
  codex: [],
  // `gemini --help` names no models; the string is forwarded verbatim to the Google API, which is
  // what rejects an unknown one. Nothing the CLI itself names.
  gemini: [],
  // Measured 2026-09-02: of copilot's three shipped ids only `auto` was accepted; the other two —
  // and copilot's OWN help example — came back `Model "…" from --model flag is not available.`
  copilot: [
    { id: 'auto', label: 'Auto', verifiedAt: '2026-09-02', source: "copilot --help: \"use 'auto' to let Copilot pick\"; the only id accepted when driven" },
  ],
  // `agy models` is the only real listing command here, and it names the effort-suffixed ids.
  // Printed verbatim by agy 1.1.22 on 2026-09-02, in the order it gave them — the same list
  // `spawn-spec.ts`'s `modelSuggestions` carries, which `spawn-spec.test.ts` pins against this one.
  // Caveat kept honest: `agy models` FETCHES, so this is a snapshot of what it answered.
  antigravity: [
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (high)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (medium)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (low)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (high)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (medium)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (low)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (high)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (medium)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (low)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.5-flash-high', label: 'Gemini 3.5 Flash (high)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.5-flash-medium', label: 'Gemini 3.5 Flash (medium)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.5-flash-low', label: 'Gemini 3.5 Flash (low)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (low)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
    { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (high)', verifiedAt: '2026-09-02', source: 'agy models (agy 1.1.22)' },
  ],
  // Kimi routes per request and its CLI publishes no list of accepted `--model` values.
  kimi: [],
}

/** The ids only, keyed by harness — what `spawn-spec.ts`'s `modelSuggestions` must equal. */
export const SPAWN_SPECS_MODEL_IDS: Record<HarnessId, string[]> = Object.fromEntries(
  Object.entries(HARNESS_MODELS).map(([h, opts]) => [h, opts.map(o => o.id)]),
) as Record<HarnessId, string[]>

/** Total: an unknown harness has no models, which is not the same as an error. */
export function modelsFor(harness: string): ModelOption[] {
  return HARNESS_MODELS[harness as HarnessId] ?? []
}

/**
 * The name to show for an id.
 *
 * Falls back to the ID ITSELF, never to an invented name: a session can legitimately run a full
 * model name this table does not list, and printing a guessed label over it would be the confident
 * -zero defect in words.
 */
export function modelLabel(harness: string, id: string): string {
  return modelsFor(harness).find(m => m.id === id)?.label ?? id
}
