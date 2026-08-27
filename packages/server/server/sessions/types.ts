/**
 * types.ts — the whole contract of the session manager.
 *
 * Two boundaries live here. `SpawnSpec` / `planSpawn` decide WHAT to run and are per harness;
 * `SessionBackend` decides WHERE it runs and is per platform. Neither knows about the other: the
 * planner emits an argv, the backend hosts an argv, and that is the only thing they share.
 */

import type { HarnessId } from '@agentistics/core'
import type { RepoFacts } from './repo-facts'

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
  /**
   * The argv (after `bin`) that tells a FRESH session which conversation id to write under.
   *
   * Absent for every CLI that invents its own and never reports it back, which is most of them —
   * and absence is load-bearing: it is what makes the cockpit say the link cannot be recorded for
   * this harness rather than showing the harness-and-directory guess as though it were a fact.
   *
   * Only ever set where the id the CLI accepts is EXACTLY the id the adapter reads sessions back
   * by, verified by running it. Gemini accepts a UUID and is deliberately absent for that reason —
   * see its entry in `SPAWN_SPECS`.
   */
  assignId?: (id: string) => string[]
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
  /**
   * A conversation id to ASSIGN to a fresh session — a UUID the caller minted.
   *
   * Offered, never imposed: it is used only where `SpawnSpec.assignId` says the CLI accepts one,
   * and ignored beside `resumeId`, whose conversation already has an id. The caller reads back
   * `SpawnPlan.conversationId` to learn whether it was actually applied, so nothing is ever
   * recorded that was not passed to the CLI.
   */
  conversationId?: string
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
  /**
   * The conversation this spawn is KNOWN to drive — the id reopened, or the id assigned.
   *
   * This is the whole of what a caller may record. Absent means the harness will invent its own and
   * never say what it was, and the registry must then hold nothing rather than a plausible guess:
   * `conversationForProcess` matches by harness and directory, so a guess files every session of
   * one repository under the same conversation, which is how a crash left one conversation listed
   * three times under three names.
   */
  conversationId?: string
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
  /**
   * When the label was written, epoch ms — so a name typed HERE can be compared with one typed
   * inside the session.
   *
   * A harness records its own name too (`/rename` in Claude Code), and the two can disagree. The
   * only non-arbitrary way to settle that is recency, which needs both sides to say WHEN — this is
   * our side. Absent on a row renamed before agentop recorded it, which `pickTitle` handles rather
   * than treating as "long ago". See `harness-session-file.ts`.
   */
  labelSince?: number
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
   * The last time this session was OBSERVED ALIVE, epoch ms — stamped at creation, then refreshed by
   * the poller's heartbeat for every session the backend reports as running.
   *
   * It exists so that "these fell together" can be answered at all. A machine that reboots takes the
   * backend with it, so nothing about a `lost` row says whether it was open at the time: `createdAt`
   * is equally true of a session abandoned three weeks ago, and `BackendSession.lastActivityMs` only
   * exists for a session the backend still has. See `crash-group.ts`.
   *
   * Absent on a row written by a build that predates it, and on one this process has never seen
   * alive. Absent is never guessed at — it simply keeps the row out of a crash group until the next
   * heartbeat stamps it.
   */
  lastSeenMs?: number
  /**
   * When this session was FINISHED, ISO — set instead of deleting the entry.
   *
   * Killing used to remove the registry row outright, so a session you ended vanished from the
   * screen and took with it the only record of which conversation it was: the store had not caught
   * up yet, so there was nothing to offer as reopenable either. A session you finish is still a
   * thing that happened, and reopening it is the ordinary next thing to want.
   */
  endedAt?: string
  /**
   * The harness's own conversation id this session drives, when it is known exactly.
   *
   * Known for a session that was REOPENED from a conversation — we handed the id to the CLI, so
   * there is no guessing left. Absent for one started fresh, because the conversation is created by
   * the harness and is not reported back.
   *
   * It exists because the fallback is a guess that cannot tell two sessions apart:
   * `conversationForProcess` matches on harness and directory, so every session in one repository
   * resolves to the same conversation. A crash that left five rows `lost` here handed three of them
   * the same one, and the fleet came back with a single session listed three times under one name.
   */
  conversationId?: string
  /**
   * The repository this session's directory belonged to WHEN IT STARTED.
   *
   * Recorded because `repo-facts.ts` can only answer by running git in the directory, and the
   * directory does not always survive the session: `ExitWorktree --remove` and `git worktree
   * remove` leave the row registered at a path that names nothing. Every probe then fails, the
   * grouping falls through to the last path segment, and a removed worktree appears as a PROJECT
   * of its own beside the project it was a worktree of — a name invented from a path that resolves
   * to nothing, which is the same error as a confident `0` for a metric nobody can produce.
   *
   * Spawn is the one moment the answer is certain, because the directory is provably there — the
   * session is being started in it. Absent on a row written by a build that predates this, and on
   * one started outside a repository; `resolveRepoFacts` treats absence as "nothing recorded",
   * never as "no repository", so an older row simply behaves as it always did.
   */
  repo?: RepoFacts
  /**
   * The name the user gave this session FROM INSIDE the harness (Claude Code's `/rename`), captured
   * while the session was alive so it OUTLIVES the process.
   *
   * A title is an identity: whatever a session is called while it runs, it stays called after it
   * ends. But that name lives only in the harness's own `~/.claude/sessions/<pid>.json`, which Claude
   * DELETES when the process exits — so a session that showed a `/rename` name while running lost it
   * the instant it finished, the displayed title fell back to a different source, and `CTRL+F` could
   * no longer find the row by the name it had a second earlier. The poller persists the LIVE,
   * non-derived name here (via `chosenName`) the moment it sees it, so the title is stable across the
   * running -> finished transition. Only a name a PERSON typed is stored: a harness-invented
   * `agentistics-77` never reaches this field, so it can never displace an agentop label. See
   * `pickTitle` and `harness-session-file.ts`.
   *
   * Absent for a session that was never `/rename`d, and on a row written by a build predating this —
   * both read exactly as they did before (the live file, when present, still wins).
   */
  harnessName?: string
  /** When `harnessName` was set inside the harness, epoch ms — the recency side of the title
   *  contest, mirrored from the harness's own `nameSince` so `pickTitle` settles it the same way
   *  whether the session is alive (live file) or finished (this persisted copy). Absent on a claude
   *  older than 2.1.232, which writes the name with no timestamp. */
  harnessNameSince?: number
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
   * Type `text` into the session and submit it — what a person does at the keyboard.
   *
   * A capability of its own rather than something only `spawn` may do. It was already implemented
   * (kimi and copilot have no interactive prompt flag, so their opening line is TYPED IN), but it was
   * buried inside the spawn path, so the one thing the backend could do that nothing else could ask
   * for was talking to a session that already exists.
   *
   * `false` when the backend could not deliver it. Never a throw: a session that ended between the
   * poll and the keystroke is an ordinary outcome, not an error to crash a caller with.
   */
  sendText(id: string, text: string): Promise<boolean>
  /**
   * Press ONE named key — the backend's own vocabulary (`Enter`, `Escape`).
   *
   * Separate from `sendText` because the two are opposites and confusing them fails silently: sent
   * as text, `Enter` is five characters typed into the assistant's prompt.
   */
  sendKey(id: string, key: string): Promise<boolean>
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
  /** Map of managed session ID to OS pane process ID, where available. */
  listPanePids?(): Promise<Map<string, number>>
}
