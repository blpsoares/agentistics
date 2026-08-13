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
  /**
   * The argv (after `bin`) that reopens an existing conversation by ID.
   *
   * A function rather than a flag string because the shapes genuinely differ: codex takes a
   * SUBCOMMAND (`codex resume <id>`), the rest take a flag, and they do not agree on which. Absent
   * when the CLI cannot reopen a conversation by id at all — gemini's `--resume` takes "latest" or
   * an index, never an id, so it has none and the verb is simply not offered for it.
   */
  resume?: (id: string) => string[]
}

export interface SpawnRequest {
  harness: HarnessId
  cwd: string
  /**
   * Reopen this conversation instead of starting a fresh one.
   *
   * Mutually exclusive with `prompt` in practice — the conversation already has its history — but
   * not refused, because a resumed session accepting an opening line is a reasonable thing to want.
   */
  resumeId?: string
  prompt?: string
  model?: string
  effort?: string
  label?: string
  task?: string
}

export interface SpawnPlan {
  argv: string[]
  /** Typed into the session once it is up, for a `send-keys` harness. */
  sendKeys?: string
}

export type SpawnPlanError =
  | { code: 'unsupported-harness'; harness: HarnessId }
  | { code: 'resume-unsupported'; harness: HarnessId }
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
  /**
   * The piece of work this session belongs to.
   *
   * A free string rather than an id: a task is whatever the person says it is, and making them
   * create one before they can name one is how a grouping feature goes unused. Several sessions
   * carrying the same task are that task's sessions, and can be reopened together.
   */
  task?: string
  /**
   * When this session was FINISHED, ISO — set instead of deleting the entry.
   *
   * Killing used to remove the registry row outright, so a session you ended vanished from the
   * screen and took with it the only record of which conversation it was: the store had not caught
   * up yet, so there was nothing to offer as reopenable either. A session you finish is still a
   * thing that happened, and reopening it is the ordinary next thing to want.
   */
  endedAt?: string
}

/**
 * What a session is doing right now.
 *
 * There is deliberately no `idle`. An interactive assistant whose process is alive and whose screen
 * has stopped moving is, by construction, waiting for the person in front of it — there is no third
 * thing it could be doing. What genuinely cannot always be known is WHY it is waiting, and that
 * uncertainty lives in `AttentionRules.approval` being absent for a harness nobody has probed, which
 * the UI states in words. A state word is the wrong place to put it: `idle` reads as "nothing to do
 * here" on exactly the session that is blocked on a permission prompt.
 */
export type SessionActivity =
  | 'working'
  | 'waiting-approval'
  | 'waiting'
  | 'exited'

/** The screen markers of ONE harness, read from real frames. See `attention-rules.ts`. */
export interface AttentionRules {
  /** A frame matching one of these is a question the session is blocked on. */
  approval: RegExp[]
  /**
   * Proof the session is working, even if it did not redraw between two polls.
   *
   * Optional because it does not always exist: codex draws the same footer and the same ghost
   * placeholder while streaming output as it does while sitting idle. For such a harness movement
   * is the only working signal there is, and claiming otherwise would be a guess.
   */
  working?: RegExp[]
  /** Provenance — the exact CLI version the frames came from, and the date. */
  probed: string
}

export interface SessionBackend {
  readonly id: 'tmux' | 'pty'
  /** Why this backend cannot run here, already localized. Absent when it can. */
  unavailable(): Promise<string | undefined>
  spawn(req: BackendSpawn): Promise<void>
  list(): Promise<BackendSession[]>
  /** Newest-last lines of the last rendered frame, trailing blanks removed. */
  capture(id: string, lines: number): Promise<string[]>
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
  /** The real detach keystroke, read from the backend — never assumed to be `Ctrl-b`. */
  detachHint(): Promise<string>
}
