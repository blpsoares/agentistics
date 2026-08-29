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
import { HARNESS_SESSION_SOURCES } from './harness-session-file'
import type { InitialPrompt, SpawnRequest, SpawnPlanResult, SpawnSpec } from './types'

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
    // `--session-id <uuid>  Use a specific session ID for the conversation (must be a valid UUID)`.
    // VERIFIED 2026-08-14 against claude 2.1.x: `claude --session-id <uuid> -p …` in `/tmp/sid-probe`
    // wrote `~/.claude/projects/-tmp-sid-probe/<uuid>.jsonl` — the same id the adapter reads back as
    // `SessionMeta.session_id`, which is the only thing that makes the record worth keeping.
    assignId: id => ['--session-id', id],
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
    //
    // And deliberately NO `assignId`, although `--session-id  Start a new session with a manually
    // provided UUID` exists: the id agentistics knows a gemini conversation by is SYNTHETIC —
    // `gemini.ts` builds `${dirName}/${fileBase}` from the chat file's path, because the files
    // carry no id of their own. A recorded UUID would therefore match no session in the store, and
    // an id that resolves to nothing is worse than no id at all: it looks like an exact link.
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
    // The SAME flag: `--session-id <id>  Resume an existing session or task by ID, **or set the
    // UUID for a new session**`. VERIFIED 2026-08-14: `copilot --session-id <uuid> -p …` printed
    // back `Resume  copilot --resume=<that uuid>` and created
    // `~/.copilot/session-state/<uuid>/events.jsonl` — and that directory name IS the id the
    // adapter keys sessions by.
    assignId: id => ['--session-id', id],
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

/**
 * Can agentop ever know EXACTLY which conversation a fresh session of this harness is writing?
 *
 * Two ways exist and this is both of them: we told the CLI which id to use (`assignId`), or the
 * harness keeps a record of its own live sessions that can be matched back to our row
 * (`HARNESS_SESSION_SOURCES` — Claude's `~/.claude/sessions/<pid>.json`, which carries the tmux
 * session name we started it under).
 *
 * `false` is the answer for codex, kimi, gemini and antigravity, and it must be SAID rather than
 * papered over: everything downstream then falls back to `conversationForProcess`, which matches by
 * harness and directory and therefore gives every session of one repository the same conversation.
 * That guess is good enough to OFFER a reopen a person confirms by title, and not good enough to be
 * presented as the conversation this row is in. The same rule `HARNESS_CAPABILITIES` applies to a
 * metric, applied to a link.
 */
export function conversationLinkable(harness: HarnessId): boolean {
  return SPAWN_SPECS[harness]?.assignId !== undefined
    || HARNESS_SESSION_SOURCES[harness] !== null
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
  // A FRESH session may be told which conversation id to write under, where the CLI accepts one.
  // Never alongside a resume: the conversation already exists and already has an id.
  const assigned = !req.resumeId && req.conversationId && spec.assignId ? req.conversationId : undefined
  if (assigned && spec.assignId) argv.push(...spec.assignId(assigned))
  if (req.model && spec.modelFlag) argv.push(spec.modelFlag, req.model)
  if (req.effort && spec.effortFlag) argv.push(spec.effortFlag, req.effort)

  // How the initial prompt will be DELIVERED once the session is up — see `initial-prompt.ts`. A
  // `positional` prompt is in argv but may not have been auto-submitted (`submit`); a `send-keys`
  // harness needs it typed (`type`); a `flag` harness runs it itself and needs no delivery.
  let initialPrompt: InitialPrompt | undefined
  if (req.prompt) {
    if (spec.prompt.kind === 'positional') {
      argv.push(req.prompt)
      initialPrompt = { mode: 'submit' }
    } else if (spec.prompt.kind === 'flag') {
      argv.push(spec.prompt.flag, req.prompt)
    } else {
      initialPrompt = { mode: 'type', text: req.prompt }
    }
  }

  // The conversation this spawn is KNOWN to drive: the one we asked to reopen, or the one we just
  // named. Absent for a fresh session on a CLI that will invent its own id and never report it —
  // and absent is what makes the UI say so instead of showing a guess.
  const conversationId = req.resumeId ?? assigned

  return {
    ok: true,
    plan: {
      argv,
      ...(initialPrompt ? { initialPrompt } : {}),
      ...(conversationId ? { conversationId } : {}),
    },
  }
}
