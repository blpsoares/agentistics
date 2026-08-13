/**
 * types.ts — the contract between the control center (presentation) and its host (logic).
 *
 * The Ink layer owns NO logic: `cli-start.ts` still decides what the service state is, what the
 * choices are and what each action does. It implements `ControlHost`; the components below render
 * already-localized strings and report intents through it. Keeping the split this way is what
 * lets the whole surface be rewritten without changing a single behaviour.
 */

import type { HarnessId } from '@agentistics/core'
import type { CliLang } from './lang'

export type TabId = 'services' | 'setup' | 'logs' | 'cheatsheet' | 'help' | 'contribute'

export const TAB_ORDER: readonly TabId[] = [
  'services',
  'setup',
  'logs',
  'cheatsheet',
  'help',
  'contribute',
] as const

/** A service is `unknown` when detection itself failed (no docker, no lsof) — never assume down. */
export type ServiceState = 'up' | 'down' | 'unknown'

/**
 * A LOGICAL service — what the user thinks about, and what the list shows one row per.
 *
 * There are two, and only two: the analytics server itself, and the team central. The ways of
 * running each of them are `RuntimeId`s below, and they are NOT services. Listing them as if they
 * were is what made the screen offer to start a Docker copy of a server that was already running
 * natively: the same program, the same files, the same port, presented as two independent things
 * the user could start independently. CLAUDE.md states outright that the two must never both run.
 */
export type ServiceId = 'agentistics' | 'central'

/**
 * One concrete way to run a logical service — an implementation detail of the host.
 *
 * `local` is the native process, `machine` is the same program inside a container
 * (docker-compose.machine.yml), and `central` is the team central's container. A `RuntimeId`
 * appears in the contract only where an action or a log genuinely has to name ONE of them: the
 * conflict case (both runtimes of `agentistics` up at once), a start option, and the full-screen
 * Logs screen's source selector.
 */
export type RuntimeId = 'local' | 'machine' | 'central'

/**
 * How a runtime runs — the word a row and a pane badge wear.
 *
 * Deliberately untranslated: `native` and `docker` are the same two words in both languages, and
 * they are the words the CLI, the compose files and the docs already use.
 */
export type ServiceRuntime = 'native' | 'docker'

/**
 * Anything an action or a log read can name: a logical service, or one exact runtime of one.
 *
 * `central` is a member of both halves, which is not an accident and not an ambiguity — the central
 * has exactly one runtime, so naming the service and naming its runtime are the same instruction.
 */
export type ServiceRef = ServiceId | RuntimeId

/** Which services an action targets. `all` means every runtime currently up. */
export type ActionTarget = ServiceRef | 'all'

export type LogSource = ServiceRef

/**
 * One runtime of a logical service, as the host currently sees it.
 *
 * Every field past `available` is OPTIONAL and absent whenever it could not be detected — a missing
 * pid is `undefined`, never `0`, and a runtime whose uptime the OS would not give up says nothing
 * rather than claiming it started this instant. The N/A-versus-real-0 rule the dashboard follows
 * for harness capabilities applies here for the same reason: a confident wrong number is worse
 * than an honest gap, and the user acts on what this screen says.
 */
export interface ServiceRuntimeState {
  id: RuntimeId
  kind: ServiceRuntime
  state: ServiceState
  /**
   * Whether this box can run it AT ALL — false when the runtime's prerequisite is missing (docker
   * not installed). It is what keeps an honest `unknown` from spreading: a container runtime on a
   * box with no docker cannot be running, so it neither makes its service's state unknown nor gets
   * offered as a start option. A verb that cannot possibly work is worse than a missing one.
   */
  available: boolean
  /** Why this runtime's state is `unknown`, already localized. */
  reason?: string
  /** OS pid of a native process, or the container's main pid. */
  pid?: number
  /**
   * When the process started, as epoch milliseconds.
   *
   * An instant rather than a duration on purpose: the detail pane repaints far more often than the
   * status refreshes, and a "seconds so far" number would freeze at whatever it was when the host
   * last looked while the clock beside it kept moving. Formatting is the UI's job.
   */
  startedAt?: number
  /** The dashboard URL, when the runtime serves one. */
  webUrl?: string
  /** The api + mcp URL, when it is a DIFFERENT port from the dashboard's. */
  apiUrl?: string
}

/**
 * `fg` (attached — runs on this terminal, or the docker/native equivalent of that) versus `bg`
 * (detached — returns immediately, keeps running). Every runtime that CAN run has both shapes now:
 * `local` always did, `machine` runs `docker compose up [--build]` with or without `-d`, and
 * `central` offers it only when a native start is even possible (see `StartFacts.centralPlan`) —
 * the Docker central still has one shape, `bg`, because its `up` (central.sh or the standalone
 * image path) has no attached variant.
 */
export type StartHow = 'fg' | 'bg'

/** What `ControlHost.start` needs: which runtime, and — natively — whether it keeps this terminal. */
export interface StartRequest {
  runtime: RuntimeId
  how?: StartHow
}

/**
 * A start the host is offering, ready to be drawn and handed straight back to `start()`.
 *
 * The host composes these because it is the only side that knows what this box can actually run:
 * without docker there is no container option, and while anything is up there are no start options
 * at all — which is precisely the fix for "it offered to start a docker copy while one was already
 * running". The UI renders `label`/`hint` and returns the value; it decides nothing.
 */
export interface StartOption extends StartRequest {
  /** Already-localized verb, e.g. "Start (docker)". */
  label: string
  /** Already-localized one-line explanation, for surfaces that show hints. */
  hint?: string
  /**
   * The runtime this start would collide with, when there is one.
   *
   * The api port is single-occupancy, so taking it means stopping whatever holds it — and WHICH
   * runtime that is is host knowledge. The UI reads this to know that the collision question
   * applies and what to stop when the answer is yes; it used to know instead that `local` was the
   * runtime with a port, which is a rule about the product living in the presentation layer.
   */
  blockedBy?: RuntimeId
  /**
   * This start records history, so the archive consent gate applies before it runs.
   *
   * A container start does not ask: `runStart()` never has, and the gate belongs to the process
   * that will be writing to `~/.agentistics`.
   */
  asksArchive?: boolean
  /**
   * Worth asking whether it should come back on boot, once it worked.
   *
   * True only for a DETACHED option — a foreground one holds the terminal (or, for a container,
   * blocks it under `suspend` until Ctrl-C), so the question would be about something that has not
   * finished happening yet. Among the detached options, it is further true only where a genuine,
   * separate boot mechanism exists: `local` background installs the native `agentop-server` unit,
   * `machine` background installs `agentop-machine` (`docker compose … up -d`), Docker `central`
   * keeps its existing `agentop-central` unit. A NATIVE central background start does not offer
   * it — no native-central systemd unit exists yet, and installing the Docker one would claim a
   * mechanism that does not match what actually started.
   */
  offersBoot?: boolean
}

/** A stop that names ONE runtime — offered only to break a conflict. */
export interface StopOption {
  runtime: RuntimeId
  /** Already-localized verb, e.g. "Stop (native)". */
  label: string
}

/** What `ControlHost.restart` needs: what to bounce, and whether to rebuild it on the way. */
export interface RestartRequest {
  target: ActionTarget
  /**
   * Rebuild before restarting instead of just bouncing what is already built.
   *
   * What that MEANS is per runtime and is the host's business: the native server recompiles the
   * binary (`bun run bin`), a container rebuilds its image and is recreated, the central goes
   * through its own `up`. The UI hands the flag back and learns none of it.
   */
  rebuild?: boolean
}

/**
 * A restart the host is offering, ready to be drawn and handed straight back to `restart()`.
 *
 * Composed by the host for the same reason `StartOption` is: whether a rebuild can work here is a
 * fact about this box, not about this screen. The native rebuild needs the repo checkout and the
 * machine's needs its compose file, so on a box without them the option is ABSENT rather than
 * present and failing — a verb that cannot work is worse than a missing one.
 */
export interface RestartOption extends RestartRequest {
  /** Already-localized verb, e.g. "Restart" / "Rebuild & restart (docker)". */
  label: string
  /** Already-localized one-line explanation, for surfaces that show hints. */
  hint?: string
}

/**
 * One logical service, as the host currently sees it.
 *
 * The list shows one row per service whether it is up or down — a stopped central stays visible
 * (dim) rather than being hidden, because hiding it would turn "start the central" into a hunt
 * through a menu. What changes with the state is what the row can DO: a running service offers
 * restart / stop / open and no start at all, a stopped one offers exactly the starts this box can
 * perform.
 */
export interface ControlService {
  id: ServiceId
  /** Already-localized name — "agentistics", "agentistics central". */
  label: string
  /**
   * The service's state, aggregated from its runtimes: `up` when any runtime is up, `unknown` when
   * an AVAILABLE runtime could not be probed, `down` only when every runtime is confidently down.
   */
  state: ServiceState
  /** Every runtime this box could run it under, in the order they are offered. */
  runtimes: ServiceRuntimeState[]
  /** The runtimes that are up right now, in that same order. Empty when nothing is up. */
  running: RuntimeId[]
  /** The runtime the detail pane describes: the first running one, absent when nothing is up. */
  active?: ServiceRuntimeState
  /**
   * Set when MORE THAN ONE runtime of this service is up at once — already localized, and naming
   * both runtimes.
   *
   * The state must never be normalised away by showing one of the two: they read the same files and
   * fight over the same port, so a user shown half of it would act on a half-truth. Its presence is
   * the flag; pair it with a word as well as a colour, and offer `stopOptions`.
   */
  conflict?: string
  /** Why the state is `unknown`, already localized. */
  reason?: string
  /**
   * Whether it comes back on boot — `undefined` when the host cannot tell, never a guess.
   *
   * A state rather than a localized string, exactly like `ServiceState`: the two words are chrome
   * the TUI owns, and the host is the only side that can answer the question.
   */
  boot?: BootState
  /** The starts this box can perform right now. ALWAYS EMPTY while the service is up. */
  startOptions: StartOption[]
  /**
   * The restarts this box can perform right now — the plain bounce, plus a rebuild wherever the
   * pieces a rebuild needs are actually here. ALWAYS EMPTY while the service is down.
   *
   * The mirror image of `startOptions`, and for the same reason: there is nothing to restart until
   * something is running, and nothing to start while something is.
   */
  restartOptions: RestartOption[]
  /** Per-runtime stops, populated only while more than one runtime is up. */
  stopOptions: StopOption[]
}

/**
 * Whether a service is registered to come back on its own after a reboot.
 *
 * ABSENT means the host could not tell — there is no user systemd on this platform, or the probe
 * itself failed — and the detail pane then says NOTHING about boot rather than "no". A service that
 * silently claims it will not restart is the fact a user acts on by installing a second copy of it.
 */
export type BootState = 'on' | 'off'

export type TeamMode = 'solo' | 'central' | 'member'

export type ArchiveMode = 'consolidate' | 'full' | 'off'

export interface ControlStatus {
  mode: TeamMode
  /** Already-localized sentence describing the mode. */
  modeLabel: string
  endpoint?: string
  services: ControlService[]
  version: string
  /** Set when a newer release exists; drives the update dot in the header. */
  latestVersion?: string
  /** The history-preservation setting in force, or `undefined` while it is still unanswered. */
  archiveMode?: ArchiveMode
  /**
   * Whether the terminal should report the mouse. Defaults to ON — the mouse is the thing a user
   * reaches for first, and `m` (or this preference) is how someone who wants their terminal's own
   * selection back turns it off.
   *
   * It lives on the STATUS rather than in the TUI because the TUI reads no preferences: the host
   * stores it beside the language and the archive mode, and hands the answer over like any other.
   */
  mouse?: boolean
}

export interface ActionResult {
  ok: boolean
  /** Already-localized one-line outcome, shown in the status line. */
  message: string
}

// ---------------------------------------------------------------------------
// Sessions — the assistant sessions this machine hosts, and the ones it can only watch
// ---------------------------------------------------------------------------

/**
 * `SessionState`, `SessionView` and `ProjectChoice` are STRUCTURALLY RE-DECLARED here.
 *
 * All three exist already, under `packages/server/server/sessions/` (`attention.ts`, `monitor.ts`,
 * `project-search.ts`) — and this package may not import them. CLAUDE.md fixes the dependency
 * direction as `server -> tui`: the server builds a `ControlHost` out of its own modules and hands
 * it over, and nothing in here ever reads a file, spawns a process or imports
 * `packages/server/server/*`. Reversing that for the sake of three interfaces would put Bun/Node
 * APIs on the import graph of a package whose whole job is to draw.
 *
 * Two declarations of one shape drift. `cli-start.ts` therefore holds a compile-time cross-check
 * (`SESSION_CONTRACT_MATCHES`) that fails `bun tsc --noEmit` the moment either side gains, loses or
 * retypes a field — change one, change the other, in the same commit.
 */

/**
 * What a session is doing — an ENUM the TUI turns into a word, exactly like `ServiceState` and
 * `BootState`, and the one thing on a row that does NOT arrive already localized.
 *
 * The distinctions are the point, and flattening any of them is the confident-zero this codebase
 * forbids: `idle-unknown` is "the frame was read and no rule matched it", `unreadable` is "the
 * frame could not be read at all", and `external` is a process seen only in `/proc` — no pane, so
 * no attention state was ever looked for. None of the three may be rendered as "idle".
 */
export type SessionState =
  | 'working'
  | 'waiting-approval'
  | 'waiting-input'
  | 'idle-unknown'
  | 'unreadable'
  | 'exited'
  | 'external'

/** One row of the fleet — a session agentop hosts, or a bare process it only observed. */
export interface SessionView {
  id: string
  harness: HarnessId
  cwd: string
  /** The user's label, or '' when they never gave one. */
  label: string
  note: string
  state: SessionState
  /** True for a session agentop hosts (whether or not the registry still knows it); false for a
   *  bare process this monitor only observed in /proc. */
  managed: boolean
  attached: boolean
  createdMs?: number
  lastActivityMs?: number
  attachable: boolean
  killable: boolean
  /** Set for an external row so the UI can say WHY it offers nothing. */
  externalReason?: 'not-hosted-by-agentop'
}

/**
 * The fleet, or the reason there cannot be one.
 *
 * A record rather than a bare `SessionView[]` because those are two different facts: an empty list
 * means nothing is running, `unavailable` means nothing could be looked at (no tmux on this box).
 * Rendering the second as the first is the same error as a harness capability rendered as `0`.
 * `unavailable` is already localized, like every other string the host hands over.
 */
export interface SessionSnapshot {
  views: SessionView[]
  unavailable?: string
}

/**
 * What the new-session wizard collected.
 *
 * There is deliberately no "attached" flag: starting and attaching are two verbs. The backend
 * always starts a session detached and `attachCommand()` hands the terminal over afterwards, so
 * "start it attached" is a start FOLLOWED BY an attach — and an attach that fails never costs the
 * user the session they just created.
 */
export interface NewSessionRequest {
  harness: HarnessId
  /** Absolute, or relative to where `agentop` itself was launched — the host resolves it before it
   *  can reach the backend, which would otherwise read it against ITS own working directory. */
  cwd: string
  prompt?: string
  model?: string
  effort?: string
  label?: string
}

/**
 * A harness the wizard may offer, DERIVED on the host from `SPAWN_SPECS`.
 *
 * A harness agentop cannot start yet is simply ABSENT — never listed and failing, the same rule a
 * service row follows for a start this box cannot perform.
 */
export interface HarnessChoice {
  id: HarnessId
  /** Deliberately untranslated, like `native`/`docker`: it is the word the CLI and the docs use. */
  label: string
  /**
   * Models to suggest, NOT a closed list. `claude --help` documents `--model` as an alias "or a
   * model's full name", so a picker that refused anything outside this list would reject valid
   * input the day a model ships. Empty when the harness publishes no suggestions.
   */
  models: string[]
  /** A genuine closed enum, printed by the CLI itself. Empty when it has no effort flag at all. */
  efforts: string[]
}

/** Somewhere a new session could start — a directory this machine has already recorded work in. */
export interface ProjectChoice {
  path: string
  /** `org/repo`, or '' when the directory has no recorded remote. Never invented. */
  repo: string
  lastActiveMs: number
  sessions: number
}

export interface ControlHost {
  /** Re-detect config + services. Must never throw; failures come back as `unknown` services. */
  refresh(): Promise<ControlStatus>

  /**
   * Start one runtime — normally a `StartOption` handed straight back.
   *
   * `{ runtime: 'local', how: 'fg' }` never resolves usefully from inside the mounted app: the
   * server needs the tty, which it can only have once the control center has unmounted, so the
   * cockpit reports that choice as `onExit({ kind: 'foreground' })` instead and the host takes over.
   */
  start(req: StartRequest): Promise<ActionResult>

  connect(v: { endpoint: string; token: string; org: string }): Promise<ActionResult>
  disconnect(): Promise<ActionResult>

  /**
   * Bounce / stop what a target names. A LOGICAL target acts on whichever runtimes of it are
   * actually up (both, when they are in conflict); a runtime target acts on exactly that one.
   * Naming something that is not running is answered, not silently reported as done.
   *
   * `rebuild` is a `RestartOption` handed straight back — the flag is the host's to interpret, and
   * it is only ever true for an option the host offered in the first place.
   */
  restart(target: ActionTarget, rebuild?: boolean): Promise<ActionResult>
  stop(target: ActionTarget): Promise<ActionResult>

  /** Persist a team mode from the Setup tab. `member` also needs `connect`. */
  setMode(mode: 'solo'): Promise<ActionResult>
  initCentral(): Promise<ActionResult>
  /** The archive-history consent, asked once. `null` when already chosen. */
  /**
   * Install the newer release and restart whatever is running onto it.
   *
   * Offered only while `ControlStatus.latestVersion` says there IS one. It is the whole of
   * `agentop upgrade` — download, verify, install, then restart the active systemd services, the
   * central's containers and a machine container — run as a CHILD process, because that command
   * prints, and nothing may print while the alternate buffer is live. Its output is the point, so
   * it streams into the detail pane like a build.
   */
  upgrade(): Promise<ActionResult>

  pendingArchiveMode(): Promise<ArchiveMode | null>
  setArchiveMode(mode: ArchiveMode): Promise<ActionResult>

  /**
   * Install the systemd user service that brings a logical service up on every boot.
   *
   * `runtime` is the one the option that led here actually started (`StartOption.runtime`), passed
   * straight back — a container and a native process boot through genuinely DIFFERENT mechanisms
   * (a systemd user unit that runs `docker compose … up -d`, versus one that runs the binary
   * directly), so the host needs to know which was used in order to write the matching unit rather
   * than defaulting to the native one regardless. It is optional because the manual "enable boot"
   * action row — offered while the service is down, with no runtime yet running to name — has no
   * runtime to hand over; the host then falls back to its default (native for `agentistics`,
   * Docker for `central`, its only mechanism).
   */
  enableBoot(service: ServiceId, runtime?: RuntimeId): Promise<ActionResult>

  setLang(lang: CliLang): Promise<void>

  /**
   * Persist whether the mouse reports. Same shape as `setLang`, and for the same reason: the
   * control center owns no persistence, so a preference it can toggle is a preference the host
   * stores. Best-effort — a machine that cannot write its preferences still gets the toggle for
   * this session.
   */
  setMouse(on: boolean): Promise<void>

  /**
   * Hand a URL to the desktop's browser.
   *
   * OPTIONAL, and the cockpit treats its absence as the feature not existing: the "open in browser"
   * action, the `o` key and its footer hint all appear only when a host implements this. A hint for
   * a key that does nothing is the one bug this screen's footer exists to prevent, and a headless
   * box — the exact machine where `agentop` is most likely to be run over ssh — has no browser to
   * hand it to.
   */
  openUrl?(url: string): Promise<ActionResult>

  /**
   * Watch what the CURRENT action is saying, line by line. Returns an unsubscribe.
   *
   * ONE channel rather than a callback threaded through every action signature: the commands worth
   * watching are the long ones — `docker compose up --build`, `central.sh up`, `bun run bin` — and
   * which of them a given call ends up running is the host's business. The UI subscribes once,
   * around whatever it is performing, and renders what arrives.
   *
   * The lines are already sanitised (see `control/stream.ts`): no escape sequences, no carriage
   * returns, no tabs, nothing whose rendered width differs from its length. That is not politeness
   * — a raw cursor-up sequence inside a pane moves the real cursor and corrupts every row Ink draws
   * after it, which is exactly why these children are PIPED now instead of inheriting the terminal.
   */
  onOutput(handler: (line: string) => void): () => void

  /**
   * Newest-last lines of a log, or an empty array when there is nothing to show.
   *
   * A LOGICAL source reads whichever runtime is up (falling back to the service's primary runtime
   * when none is, so the file a crashed server left behind is still readable); a runtime source
   * reads exactly that one, which is what the full-screen Logs screen's selector needs.
   */
  readLog(source: LogSource, maxLines: number): Promise<string[]>

  // -- the sessions tab ------------------------------------------------------

  /**
   * The whole fleet, as of now. Must never throw — the Sessions screen polls this on a timer, and
   * a rejection there would take the control center down five seconds after it opened.
   *
   * Reading it costs a capture per RUNNING session, so it is the one call on this interface worth
   * not making more often than the screen actually repaints.
   */
  sessions(): Promise<SessionSnapshot>

  /**
   * Start a session and register it. The id comes back so the caller can select the new row — and
   * attach to it, which is a separate verb (see `NewSessionRequest`).
   *
   * `id` is absent on failure, and only on failure: a start that reached the backend is recorded
   * before this returns, so an id here always names a session `sessions()` will list.
   */
  startSession(req: NewSessionRequest): Promise<ActionResult & { id?: string }>

  /**
   * Kill a session and forget it. Reports failure rather than clearing the registry entry when the
   * backend could not confirm the session is gone — a still-running session with no registry entry
   * is one nothing can name again.
   */
  killSession(id: string): Promise<ActionResult>

  /** Set the row's label. Fails for a session with no registry entry, which has none to patch. */
  renameSession(id: string, label: string): Promise<ActionResult>
  /** Same contract as `renameSession`, for the free-text note. */
  noteSession(id: string, note: string): Promise<ActionResult>

  /**
   * The argv to exec to take over the terminal, or `null` when this session cannot be attached to
   * — the backend cannot run here, the session is gone, or its command has already exited.
   *
   * Returned rather than executed for the same reason the backend returns it: the attach needs the
   * REAL tty, which it can only have once Ink has been unmounted and the alternate buffer left.
   */
  attachCommand(id: string): Promise<string[] | null>

  /**
   * The real detach keystroke, read from the backend — never assumed to be `Ctrl-b`, which is only
   * the default and is the first thing a tmux user rebinds. It has to be said BEFORE the terminal
   * is handed over: a user who cannot get out is stranded in a session that hides their shell.
   */
  detachHint(): Promise<string>

  /**
   * Directories a new session could start in, ranked, filtered by `query`.
   *
   * Called on every keystroke of the wizard's search field, so the host caches the underlying list;
   * an empty query is the unfiltered head of it. It answers "where have I worked", not "what exists
   * on disk" — a path the machine has never seen is accepted by the caller as typed.
   */
  projectChoices(query: string, limit: number): Promise<ProjectChoice[]>

  /** The harnesses agentop can actually start here. See `HarnessChoice`. */
  sessionHarnesses(): Promise<HarnessChoice[]>
}

/**
 * Why the control center stopped. `foreground` tells `cli.ts` to fall through to the in-process
 * server startup, exactly as the old launcher's `'foreground'` sentinel did.
 */
export type ControlExit = { kind: 'quit'; code: number } | { kind: 'foreground' }
