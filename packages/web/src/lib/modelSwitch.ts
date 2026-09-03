/**
 * modelSwitch.ts — PURE: can this session's model be changed mid-conversation, and how?
 *
 * A `Record` per harness with an explicit `null`, deliberately shaped like the server's
 * `rename-spec.ts`: adding a harness breaks the build here rather than silently shipping a control
 * that does nothing, and every `null` is a FINDING with its own sentence rather than an omission.
 *
 * There is no fleet VERB for this and there should not be: changing the model is not something
 * agentop does to a session, it is something the assistant's own command does from inside it. So
 * the mechanism is a typed line — the same `prompt` action the composer already uses — and it
 * therefore inherits every rule that action has: the session must be running, and it is refused
 * while a dialog is open, because a slash command typed into a permission prompt goes into that
 * dialog's filter and the submit takes the highlighted option.
 *
 * ONLY CLAUDE IS WIRED, and it is wired because it was verified: `/model` was read back from the
 * running CLI (claude 2.1.x, `claude -p` asked for the command's exact name) rather than assumed.
 * The others are null until somebody checks the same way — a guessed slash command does not fail
 * loudly, it types a line of nonsense into a live session.
 */

export interface ModelSwitchSpec {
  /** The line to type. `{model}` is replaced with the chosen id. */
  line: string
}

/** Keyed by the harness ids the fleet reports. */
export const MODEL_SWITCH: Record<string, ModelSwitchSpec | null> = {
  // Verified against the running CLI, not the docs.
  claude: { line: '/model {model}' },
  // Codex takes `--model` at spawn; nothing in its help offers a mid-session switch.
  codex: null,
  // Gemini's model is chosen at spawn.
  gemini: null,
  // Copilot exposes model selection through its own UI, not a line that can be typed.
  copilot: null,
  // Antigravity has no documented slash command for it.
  antigravity: null,
  // Kimi routes per request; there is no session-level switch to type.
  kimi: null,
}

export function modelSwitchLine(harness: string, model: string): string | null {
  const spec = MODEL_SWITCH[harness]
  if (!spec || !model) return null
  return spec.line.replace('{model}', model)
}

/** Why the control is absent, so the panel can say it instead of leaving a hole. */
export function modelSwitchReason(harness: string, lang: 'en' | 'pt'): string | null {
  if (MODEL_SWITCH[harness]) return null
  const pt = lang === 'pt'
  return pt
    ? 'Trocar de modelo no meio da conversa só está verificado no Claude Code.'
    : 'Switching model mid-conversation is only verified for Claude Code.'
}
