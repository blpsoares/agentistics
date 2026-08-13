/**
 * types.ts — the contract between the control center (presentation) and its host (logic).
 *
 * The Ink layer owns NO logic: `cli-start.ts` still decides what the service state is, what the
 * choices are and what each action does. It implements `ControlHost`; the components below render
 * already-localized strings and report intents through it. Keeping the split this way is what
 * lets the whole surface be rewritten without changing a single behaviour.
 */

import type { CliLang } from './lang'

export type TabId = 'services' | 'sessions' | 'setup' | 'logs' | 'cheatsheet' | 'help' | 'contribute'

export const TAB_ORDER: readonly TabId[] = [
  'services',
  'sessions',
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

// ---------------------------------------------------------------------------
// the session fleet
// ---------------------------------------------------------------------------

/**
 * What a session is doing, machine-readable — the colour, the sort and the counter read this.
 *
 * `unknown` is for an EXTERNAL session: an assistant running on this machine that agentop did not
 * start. Its screen cannot be captured and its backend cannot be asked, so no state can honestly be
 * claimed for it. The same N/A-versus-a-confident-0 rule the detail pane applies to `boot`.
 */
export type SessionState =
  | 'working'
  | 'waiting-approval'
  | 'waiting'
  | 'exited'
  | 'lost'
  /** Running, but agentop did not start it — nothing about it is capturable. */
  | 'unknown'
  /** Not running at all: a conversation on this machine that can usually be reopened. */
  | 'closed'

/**
 * One session, as the host currently sees it.
 *
 * Every displayable string arrives already localized, exactly as `ControlService` does — the TUI
 * owns no logic, so it neither decides what a session is doing nor what to call it.
 */
export interface ControlSession {
  id: string
  /** Already-localized display name: the user's label when there is one, else a derived one. */
  title: string
  /** Harness id, or `''` when the registry has forgotten it. The colour and grouping key. */
  harness: string
  cwd: string
  /** The last path segment of `cwd` — the "by project" grouping key, computed by the host. */
  project: string
  model?: string
  note?: string
  /** The piece of work this session belongs to, when the user said so. Groups the list. */
  task?: string
  /**
   * The conversation this row could REOPEN, when there is one.
   *
   * Present on a row that is running outside agentop (the conversation it appears to be driving) and
   * on a closed one (itself). Absent when the harness cannot reopen by id, so the verb is not
   * offered rather than offered and wrong.
   */
  resume?: { sessionId: string; title: string }
  /**
   * The last few meaningful lines of this session's screen — what it is saying right now.
   *
   * Present only for a session agentop hosts; there is no frame to read for anything else, and an
   * invented one would be the worst possible thing to put under "what is it doing".
   */
  lastLines?: string[]
  /** Already-formatted token count, when this row's conversation has metrics. */
  tokens?: string
  /** Already-formatted cost, same. */
  cost?: string
  /** Everything this row can be found by, already lowercased — including a closed conversation's
   *  opening prompt, which is what a person remembers about work they put down. */
  searchText: string
  state: SessionState
  /** Already-localized state word, e.g. "needs approval". */
  stateLabel: string
  /**
   * Whether this row can be acted on at all.
   *
   * False for an external session, which is listed because "the fleet in one place" is the point,
   * and marked because offering it verbs that cannot work would be worse than not listing it.
   */
  actionable: boolean
  /**
   * Already-localized sentence, present only when this harness has no probed approval markers.
   *
   * Its presence is the statement: a blocking question on such a session reads as plain `waiting`,
   * so the detail pane says so rather than letting the state word imply a certainty it does not have.
   */
  approvalBlind?: string
  /** When it started, epoch ms. An instant rather than a duration — see `ServiceRuntimeState`. */
  startedAt?: number
  attached: boolean
}

/**
 * How the fleet list is arranged, remembered ACROSS RUNS.
 *
 * It lives on the status rather than in the TUI for the same reason the language and the mouse do:
 * the control center owns no persistence. Without it the grouping was per-run state, so every
 * restart threw away the arrangement someone had chosen — which reads as the screen forgetting on
 * its own rather than as a setting that was never stored.
 */
export interface SessionViewPrefs {
  grouping: 'none' | 'task' | 'harness' | 'model' | 'project'
  showClosed: boolean
  showExited: boolean
  /** Only meaningful while grouping by task, but stored either way so it survives a detour. */
  showUnfiled: boolean
}

export interface ControlSessions {
  sessions: ControlSession[]
  /** How many are waiting on a person. Drives the header counter, from every tab. */
  attention: number
  /** Ids that JUST entered attention. The shell rings the terminal bell for these, once. */
  rang: string[]
  /** Already-localized reason this list may not be the whole truth. Never an empty list alone. */
  unavailable?: string
}

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
  /** How the fleet list was last arranged. Absent on a machine that has never chosen. */
  sessionView?: SessionViewPrefs
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
   * Remember how the fleet list is arranged. Same shape as `setLang`, and for the same reason: a
   * preference the control center can toggle is a preference the host stores. Best-effort — a
   * machine that cannot write its preferences still gets the setting for this run.
   */
  setSessionView?(view: SessionViewPrefs): Promise<void>

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

  /**
   * The session fleet, re-read. Must never throw — a failed poll comes back as the previous list
   * plus an `unavailable` sentence, never as an empty one.
   *
   * OPTIONAL, and its absence means the feature does not exist here: a host that does not implement
   * it gets no `sessions` tab content beyond a sentence saying so. Same treatment as `openUrl?`,
   * and for the same reason — a screen that offers what the host cannot do is the one bug this
   * contract exists to prevent.
   */
  sessions?(): Promise<ControlSessions>

  /**
   * What it takes to attach to a session, or `null` when this one cannot be attached.
   *
   * Returned rather than PERFORMED, exactly as the backend's own `attachCommand` is: attaching needs
   * the real tty, which it can only have once the control center has released it. The cockpit
   * reports the intent as `ControlExit.attach` and `cli-start.ts` takes over — the same discipline
   * `central.sh init` already follows.
   */
  attachSession?(id: string): Promise<AttachTicket | null>

  killSession?(id: string): Promise<ActionResult>
  renameSession?(id: string, label: string): Promise<ActionResult>
  noteSession?(id: string, text: string): Promise<ActionResult>
  /** File this session under a piece of work. Empty string clears it. */
  taskSession?(id: string, task: string): Promise<ActionResult>

  /**
   * The tasks that already exist on this machine.
   *
   * So filing a session under one is a PICK rather than a spelling test: a task is a free string, so
   * typing "auth-refactor" a second time as "auth refactor" makes two tasks that look like one and
   * group like two. Offering what exists is what keeps that from happening.
   */
  sessionTasks?(): Promise<string[]>

  /**
   * Reopen a conversation as a NEW managed session.
   *
   * This is what makes a closed conversation, or one running outside agentop, something the cockpit
   * can act on at all: it cannot attach to a process it did not start, but it can start a session
   * that resumes the same conversation.
   */
  resumeSession?(req: ResumeSessionRequest): Promise<SpawnSessionResult>

  /**
   * Reopen every session of one task, in the background.
   *
   * The point of naming a task is getting all of its work back at once. Sessions whose conversation
   * cannot be resolved are SKIPPED AND COUNTED in the result — a silent partial reopen would leave
   * someone believing they had their whole task back.
   */
  openTask?(task: string): Promise<ActionResult>

  /**
   * The harnesses this machine can actually START, with what each of them accepts.
   *
   * Derived by the host from the spawn specs, so a harness with no spec is ABSENT from the wizard
   * rather than offered and failing — the same rule the CLI already follows. The wizard renders
   * whatever comes back and knows nothing about which CLI takes which flag.
   */
  startableHarnesses?(): Promise<SessionHarnessOption[]>

  /** Places a new session could start, ranked. `query` may be empty, which opens on recency. */
  searchProjects?(query: string): Promise<ProjectOption[]>

  /** Start one. An attached request comes back with a ticket the shell hands to `ControlExit`. */
  spawnSession?(req: SpawnSessionRequest): Promise<SpawnSessionResult>
}

/** One harness the wizard may offer, and the shape of the questions it earns. */
export interface SessionHarnessOption {
  id: string
  /** Already-localized name. */
  label: string
  /**
   * Models to OFFER — never a validation list. `claude --help` documents `--model` as an alias "or
   * a model's full name", so refusing anything outside a fixed list would reject valid input the
   * day a model ships. The wizard therefore lets the value be typed as well as picked.
   */
  modelSuggestions: string[]
  /** Absent when the CLI has no model flag at all, which is a different thing from an empty list. */
  supportsModel: boolean
  /** A genuine closed enum printed by the CLI itself, so this one IS validated. Empty = none. */
  efforts: string[]
}

/** One place a session could start. */
export interface ProjectOption {
  /** The directory. The only field that is load-bearing. */
  path: string
  /** Already-composed display label — the directory name, and the repo when it belongs to one. */
  label: string
  /**
   * The path, shortened for display.
   *
   * Not decoration: a machine with six directories called `portifolio` renders six identical rows
   * without it, and the search field is the one control that decides where work happens.
   */
  detail: string
  /**
   * Why it is being offered, so the list can say so — and so a folder that was merely FOUND is not
   * mistaken for one you have worked in.
   *
   * `cwd` where you are standing · `history` somewhere sessions have run · `repo` a git repository
   * found on disk · `folder` any other directory found on disk · `typed` a path given in full.
   */
  source: 'cwd' | 'history' | 'repo' | 'folder' | 'typed'
}

export interface SpawnSessionRequest {
  harness: string
  cwd: string
  prompt?: string
  model?: string
  effort?: string
  label?: string
  /** Take the terminal now, versus start detached and stay here. */
  attach: boolean
}

export interface ResumeSessionRequest {
  /** The HARNESS's own conversation id. */
  sessionId: string
  harness: string
  cwd: string
  /** Already-composed name for the new session, so the row keeps reading the same. */
  label: string
  attach: boolean
}

export interface SpawnSessionResult {
  ok: boolean
  /** Already-localized outcome for the status line. */
  message: string
  /** Present only on a successful ATTACHED start — the shell reports it as `ControlExit.attach`. */
  ticket?: AttachTicket
}

/** Everything the caller needs to hand the terminal over and get the user back afterwards. */
export interface AttachTicket {
  /** Exec'd with inherited stdio once Ink has unmounted and the alternate buffer is released. */
  argv: string[]
  /**
   * The REAL detach keystroke, read from the backend — never assumed to be `Ctrl-b`.
   *
   * Printed before the handover: a user who cannot get out is stranded in a buffer that hides their
   * shell, and a tmux prefix the user rebound would make a guessed hint actively wrong.
   */
  detachHint: string
  /** Already-localized name of what is being attached to, for the sentence printed on the way in. */
  label: string
}

/**
 * Why the control center stopped. `foreground` tells `cli.ts` to fall through to the in-process
 * server startup, exactly as the old launcher's `'foreground'` sentinel did.
 */
export type ControlExit =
  | { kind: 'quit'; code: number }
  | { kind: 'foreground' }
  /**
   * Hand the terminal to a session, then COME BACK.
   *
   * The Ink app never execs anything itself: it unmounts, `cli-start.ts` runs the argv with the real
   * tty, and when that returns it re-enters the control center on the sessions tab. The loop is what
   * makes attach and detach feel like two halves of one gesture rather than an exit.
   */
  | { kind: 'attach'; ticket: AttachTicket }
