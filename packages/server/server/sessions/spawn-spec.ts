/**
 * spawn-spec.ts — PURE. What argv each harness needs to start an interactive session.
 *
 * A `Record<HarnessId, …>`, never an array: TypeScript accepts an array literal with a member
 * missing, and CLAUDE.md records five surfaces that silently lost a harness exactly that way. A
 * harness whose entry is `null` is not spawnable by us yet, and every caller must therefore refuse
 * it by name rather than offering a verb that fails.
 *
 * EVERY flag below was read from that tool's own `--help` — claude, codex and kimi on 2026-08-12,
 * gemini, copilot and antigravity on 2026-08-13. A flag that could not be verified is absent, not
 * guessed.
 *
 * Where `--help` prints no list of accepted MODELS, the suggestions are the ids this machine has
 * actually run (read from the local session store) rather than ids recalled from anywhere else. They
 * are a convenience for the picker and never a validation set — every one of these CLIs accepts a
 * full model name, so refusing an unlisted value would reject valid input the day a model ships.
 */

import type { HarnessId } from '@agentistics/core'
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
    // `-r, --resume [value]  Resume a conversation by session ID`
    resume: id => ['--resume', id],
  },

  // `Usage: codex [OPTIONS] [PROMPT]` / `[PROMPT]  Optional user prompt to start the session`
  // No `--effort`: the reasoning effort is a `-c key=value` override whose key is not verifiable
  // from the CLI (`-c` accepts unknown keys silently), so it is absent rather than guessed.
  codex: {
    bin: 'codex',
    prompt: { kind: 'positional' },
    modelFlag: '--model', // `-m, --model <MODEL>`
    modelSuggestions: [],
    // A SUBCOMMAND, not a flag: `codex resume [OPTIONS] [SESSION_ID] [PROMPT]`, whose argument is
    // documented as "Conversation/session id (UUID) or thread name".
    resume: id => ['resume', id],
  },

  // Kimi's only prompt flag is `-p, --prompt <prompt>  Run one prompt non-interactively and print
  // the response.` — that exits, leaving nothing to attach to. So the prompt is TYPED IN instead.
  kimi: {
    bin: 'kimi',
    prompt: { kind: 'send-keys' },
    modelFlag: '--model', // `-m, --model <model>`
    modelSuggestions: [],
    // `-S, --session [id]  Resume a session. With ID: resume that session.`
    resume: id => ['-S', id],
  },

  // `-i, --prompt-interactive  Execute the provided prompt and continue in interactive mode`.
  // Preferred over the positional `query` (which also stays interactive) because it says so in its
  // own name — a positional that silently becomes headless on a future release is a trap, and this
  // flag cannot.
  gemini: {
    bin: 'gemini',
    prompt: { kind: 'flag', flag: '--prompt-interactive' },
    modelFlag: '--model', // `-m, --model  Model  [string]`
    // No model list is printed by `--help`, so these are the ids this machine has actually run
    // rather than ids from memory. The list is a convenience, never a validation set.
    modelSuggestions: ['gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    // No effort flag exists, and no `resume`: gemini's `-r, --resume` takes "latest" or an index
    // number, never a session id. Offering it would be a verb that reopens the wrong conversation.
  },

  // `-p, --prompt <text>  Execute a prompt in non-interactive mode (exits after completion)` — the
  // same trap kimi has, so the prompt is TYPED IN instead of passed. There is no interactive prompt
  // flag to use in its place.
  copilot: {
    bin: 'copilot',
    prompt: { kind: 'send-keys' },
    modelFlag: '--model', // `--model <model>  Set the AI model to use (use 'auto' to let Copilot pick)`
    modelSuggestions: ['auto', 'claude-sonnet-4.6', 'gpt-5.3-codex'],
    // `--session-id <id>  Resume an existing session or task by id` — used in preference to
    // `-r, --resume[=value]`, whose `[=value]` form requires the `=` and silently degrades to
    // "resume the most recent" when the id is passed as a separate argument.
    resume: id => ['--session-id', id],
  },

  // `--prompt-interactive  Run an initial prompt interactively and continue the session`, plus a
  // real closed effort enum — the only harness besides claude that documents one.
  antigravity: {
    bin: 'agy',
    prompt: { kind: 'flag', flag: '--prompt-interactive' },
    modelFlag: '--model', // `--model  Model for the current CLI session`
    modelSuggestions: ['gemini-3.6-flash'],
    effortFlag: '--effort',
    // `--effort  Reasoning effort for the current CLI session (low|medium|high)` — printed by the
    // CLI itself, so unlike codex's `-c` override this one IS verifiable and IS validated.
    efforts: ['low', 'medium', 'high'],
    resume: id => ['--conversation', id], // `--conversation  Resume a previous conversation by ID`
  },
}

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

  if (req.resumeId && !spec.resume) {
    return { ok: false, error: { code: 'resume-unsupported', harness: req.harness } }
  }

  const argv: string[] = [spec.bin]
  // The resume argv goes FIRST because one of these is a subcommand (`codex resume <id>`), and a
  // subcommand that follows a flag is not a subcommand any more.
  if (req.resumeId && spec.resume) argv.push(...spec.resume(req.resumeId))
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
