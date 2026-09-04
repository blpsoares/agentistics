/**
 * wizardSteps.ts — PURE: what the new-session wizard asks, in what order, and when it may advance.
 *
 * Separated from the rendering so "can I continue", "what is missing" and "what did they choose"
 * are answerable without a DOM. A wizard whose gating lives in JSX is a wizard nothing can check,
 * and this one gates the most powerful act the server performs.
 *
 * TWO RULES CARRIED OVER FROM THE TERMINAL WIZARD, both load-bearing:
 *
 * - The assistants offered are the ones `availableHarnesses()` found ON PATH. Anything else starts
 *   a tmux session that dies on `command not found` behind a screen nobody is watching.
 * - `model` and `effort` are SKIPPED, not shown-and-disabled, where the harness cannot take them.
 *   `efforts` is a closed set read from each CLI's own `--help`. A model question is skipped where
 *   the harness NAMES no models, even if it accepts `--model`: a dropdown whose only entry is "the
 *   assistant's default" is a control that cannot be used, while an absent one says "we cannot name
 *   these for you".
 */

export type StepId = 'assistant' | 'where' | 'message' | 'review'

export const STEP_ORDER: StepId[] = ['assistant', 'where', 'message', 'review']

export interface WizardHarness {
  id: string
  label: string
  models: { id: string; label: string }[]
  supportsModel: boolean
  efforts: string[]
}

export interface WizardDraft {
  harness: string
  cwd: string
  task: string
  model: string
  effort: string
  prompt: string
  label: string
  /** Paths already stored on the machine by `POST /api/fleet/attach`. */
  attachments: { name: string; path: string }[]
}

export interface StepState {
  ok: boolean
  /** What is missing, when it is not. Never an empty string when `ok` is false. */
  missing?: string
}

export function visibleQuestions(harness: WizardHarness | null): { model: boolean; effort: boolean } {
  if (!harness) return { model: false, effort: false }
  return {
    model: harness.supportsModel && harness.models.length > 0,
    effort: harness.efforts.length > 0,
  }
}

export function stepReady(step: StepId, draft: WizardDraft, harness: WizardHarness | null): StepState {
  switch (step) {
    case 'assistant':
      return harness && draft.harness !== ''
        ? { ok: true }
        : { ok: false, missing: 'assistant' }
    case 'where':
      return draft.cwd !== '' ? { ok: true } : { ok: false, missing: 'cwd' }
    // The first message is optional: a session started with none is a session waiting for you,
    // which is a perfectly ordinary thing to want.
    case 'message':
      return { ok: true }
    case 'review': {
      const a = stepReady('assistant', draft, harness)
      if (!a.ok) return a
      return stepReady('where', draft, harness)
    }
  }
}

export function nextStep(step: StepId): StepId {
  const i = STEP_ORDER.indexOf(step)
  return STEP_ORDER[Math.min(i + 1, STEP_ORDER.length - 1)]!
}

export function prevStep(step: StepId): StepId {
  const i = STEP_ORDER.indexOf(step)
  return STEP_ORDER[Math.max(i - 1, 0)]!
}

/**
 * Drop only the answers the NEW assistant cannot accept.
 *
 * Carrying `effort: 'high'` across to a harness whose set does not contain it would send a flag
 * the CLI rejects at spawn. Everything else — the directory, the task, the message, the name —
 * belongs to any assistant and going back a step must not silently discard it.
 */
export function clearForHarness(draft: WizardDraft, harness: WizardHarness | null): WizardDraft {
  const q = visibleQuestions(harness)
  const keepModel = q.model && harness!.models.some(m => m.id === draft.model)
  const keepEffort = q.effort && harness!.efforts.includes(draft.effort)
  return { ...draft, model: keepModel ? draft.model : '', effort: keepEffort ? draft.effort : '' }
}
