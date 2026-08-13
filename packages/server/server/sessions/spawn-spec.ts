/**
 * spawn-spec.ts — PURE. What argv each harness needs to start an interactive session.
 *
 * A `Record<HarnessId, …>`, never an array: TypeScript accepts an array literal with a member
 * missing, and CLAUDE.md records five surfaces that silently lost a harness exactly that way. A
 * harness whose entry is `null` is not spawnable by us yet, and every caller must therefore refuse
 * it by name rather than offering a verb that fails.
 *
 * EVERY flag below was read from that tool's own `--help` on 2026-08-12. A flag that could not be
 * verified is absent, not guessed.
 */

import { HARNESS_ORDER, type HarnessId } from '@agentistics/core'
import type { SpawnRequest, SpawnPlanResult, SpawnSpec } from './types'

export const SPAWN_SPECS: Record<HarnessId, SpawnSpec | null> = {
  // `Usage: claude [options] [command] [prompt]` / `Arguments: prompt  Your prompt`
  claude: {
    bin: 'claude',
    prompt: { kind: 'positional' },
    modelFlag: '--model',
    // "an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name"
    modelSuggestions: ['fable', 'opus', 'sonnet'],
    effortFlag: '--effort',
    // "Effort level for the current session (low, medium, high, xhigh, max)"
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },

  // `Usage: codex [OPTIONS] [PROMPT]` / `[PROMPT]  Optional user prompt to start the session`
  // No `--effort`: the reasoning effort is a `-c key=value` override whose key is not verifiable
  // from the CLI (`-c` accepts unknown keys silently), so it is absent rather than guessed.
  codex: {
    bin: 'codex',
    prompt: { kind: 'positional' },
    modelFlag: '--model', // `-m, --model <MODEL>`
    modelSuggestions: [],
  },

  // Kimi's only prompt flag is `-p, --prompt <prompt>  Run one prompt non-interactively and print
  // the response.` — that exits, leaving nothing to attach to. So the prompt is TYPED IN instead.
  kimi: {
    bin: 'kimi',
    prompt: { kind: 'send-keys' },
    modelFlag: '--model', // `-m, --model <model>`
    modelSuggestions: [],
  },

  // Phase 5. Absent from the wizard and refused by name, rather than offered and failing.
  gemini: null,
  copilot: null,
  antigravity: null,
}

/**
 * The harnesses agentop can start, DERIVED from the specs above.
 *
 * Never a second hand-written list: it is what the CLI's usage prints, what its "supported"
 * refusals name and what the control center's wizard offers, and three copies of it would be three
 * chances for a harness to be startable in one place and absent in another. Ordered by
 * `HARNESS_ORDER` so every surface lists them the same way.
 */
export const STARTABLE_HARNESSES: HarnessId[] = HARNESS_ORDER.filter(h => SPAWN_SPECS[h] !== null)

/** Decide the exact argv (and any text to type in) for a requested session. */
export function planSpawn(req: SpawnRequest): SpawnPlanResult {
  const spec = SPAWN_SPECS[req.harness]
  if (!spec) return { ok: false, error: { code: 'unsupported-harness', harness: req.harness } }

  if (req.model && !spec.modelFlag) {
    return { ok: false, error: { code: 'model-unsupported', harness: req.harness } }
  }
  if (req.effort && (!spec.effortFlag || !spec.efforts)) {
    return { ok: false, error: { code: 'effort-unsupported', harness: req.harness } }
  }
  if (req.effort && spec.efforts && !spec.efforts.includes(req.effort)) {
    return {
      ok: false,
      error: { code: 'unknown-effort', harness: req.harness, value: req.effort, accepted: spec.efforts },
    }
  }

  const argv: string[] = [spec.bin]
  if (req.model && spec.modelFlag) argv.push(spec.modelFlag, req.model)
  if (req.effort && spec.effortFlag) argv.push(spec.effortFlag, req.effort)

  let sendKeys: string | undefined
  if (req.prompt) {
    if (spec.prompt.kind === 'positional') argv.push(req.prompt)
    else if (spec.prompt.kind === 'flag') argv.push(spec.prompt.flag, req.prompt)
    else sendKeys = req.prompt
  }

  return { ok: true, plan: sendKeys === undefined ? { argv } : { argv, sendKeys } }
}
