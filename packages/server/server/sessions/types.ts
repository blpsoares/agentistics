/**
 * types.ts — the whole contract of the session manager.
 *
 * Two boundaries live here. `SpawnSpec` / `planSpawn` decide WHAT to run and are per harness;
 * `SessionBackend` decides WHERE it runs and is per platform. Neither knows about the other: the
 * planner emits an argv, the backend hosts an argv, and that is the only thing they share.
 */

import type { HarnessId } from '@agentistics/core'

/**
 * How a harness accepts an initial prompt while starting an INTERACTIVE session.
 *
 * `send-keys` is not a fallback for laziness — it is the honest answer for a CLI whose only prompt
 * flag is non-interactive. `kimi -p` prints one response and exits, so passing the prompt that way
 * would leave nothing to attach to; typing it into the session is what a person does.
 */
export type PromptMode =
  | { kind: 'positional' }
  | { kind: 'flag'; flag: string }
  | { kind: 'send-keys' }

export interface SpawnSpec {
  /** The binary, as it is found on PATH. */
  bin: string
  prompt: PromptMode
  /** Absent when the CLI has no model flag. */
  modelFlag?: string
  /**
   * Models offered by the picker. Deliberately NOT a validation list: `claude --help` documents
   * `--model` as an alias "or a model's full name", so refusing anything outside a fixed list
   * would reject valid input the day a model ships.
   */
  modelSuggestions: string[]
  /** Absent when the CLI has no effort flag. Paired with `efforts`; never one without the other. */
  effortFlag?: string
  /** A genuine closed enum, printed by the CLI itself — so this one IS validated. */
  efforts?: string[]
}

export interface SpawnRequest {
  harness: HarnessId
  cwd: string
  prompt?: string
  model?: string
  effort?: string
  label?: string
}

export interface SpawnPlan {
  argv: string[]
  /** Typed into the session once it is up, for a `send-keys` harness. */
  sendKeys?: string
}

export type SpawnPlanError =
  | { code: 'unsupported-harness'; harness: HarnessId }
  | { code: 'model-unsupported'; harness: HarnessId }
  | { code: 'effort-unsupported'; harness: HarnessId }
  | { code: 'unknown-effort'; harness: HarnessId; value: string; accepted: string[] }

export type SpawnPlanResult =
  | { ok: true; plan: SpawnPlan }
  | { ok: false; error: SpawnPlanError }

/** What the backend is asked to host. Harness-agnostic by construction. */
export interface BackendSpawn {
  /** Our session id. The backend derives its own name from it; callers never see that name. */
  id: string
  cwd: string
  argv: string[]
  sendKeys?: string
}

export type CaptureFailure = 'no-session' | 'backend-error'

export type CaptureResult =
  | { ok: true; lines: string[] }
  | { ok: false; reason: CaptureFailure }

/** One session as the BACKEND sees it — existence and liveness, no product metadata. */
export interface BackendSession {
  id: string
  createdMs: number
  attached: boolean
  /** False once the hosted command has exited. The session is still listable and capturable. */
  alive: boolean
  /** Last time the backend saw activity, epoch ms. Phase 2's quiescence gate reads this. */
  lastActivityMs: number
}

/** One session as the PRODUCT sees it. Persisted; the backend knows none of this. */
export interface ManagedSession {
  id: string
  harness: HarnessId
  cwd: string
  /** ISO string: this is a local JSON store, where ISO is the correct representation. */
  createdAt: string
  model?: string
  effort?: string
  label?: string
  note?: string
}

export interface SessionBackend {
  readonly id: 'tmux' | 'pty'
  /** Why this backend cannot run here, already localized. Absent when it can. */
  unavailable(): Promise<string | undefined>
  spawn(req: BackendSpawn): Promise<void>
  list(): Promise<BackendSession[]>
  /**
   * Newest-last lines of the last rendered frame, trailing blanks removed.
   *
   * A RESULT rather than a bare array: a failed capture and a blank pane are different facts, and
   * the attention monitor may not treat "could not read" as "nothing is happening".
   */
  capture(id: string, lines: number): Promise<CaptureResult>
  /**
   * Kill the session and report whether it is confirmed GONE afterwards. "Already gone" (the
   * session finished or was removed between `list` and this call) counts as success — the caller
   * asked for the outcome, not for one particular command to have run. A `false` means the backend
   * could not confirm the session is gone, so a caller that deletes its registry entry on `true`
   * alone never turns a still-running session into one nothing can name again.
   */
  kill(id: string): Promise<boolean>
  /**
   * The argv a caller execs to attach. Returned rather than executed: the attach needs the real
   * tty, which it can only have after the caller has released it.
   */
  attachCommand(id: string): string[]
  /**
   * The real prefix KEY a detach starts with, read from the backend — never assumed to be `Ctrl-b`,
   * which is only the default and is the first thing a tmux user rebinds.
   *
   * A key, not a sentence, and `''` when it could not be read: the words around it belong to
   * whichever front end is speaking, and one of the two speaks Portuguese.
   */
  detachKey(): Promise<string>
}
