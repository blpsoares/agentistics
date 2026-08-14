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
  /**
   * Already-localized display name.
   *
   * A session can be named in TWO places — in agentop, and inside the harness with its own
   * `/rename` — and the host decides which one this is. See `titleSource`.
   */
  title: string
  /**
   * Where `title` came from, present ONLY when the two names disagree.
   *
   * `label` is the name typed in agentop, `harness` the one typed inside the session. Its presence
   * is the statement: an ordinary row, named in one place or neither, carries nothing here.
   */
  titleSource?: 'label' | 'harness' | 'derived'
  /**
   * The name that LOST, when there was one and it differs.
   *
   * Neither name is ever discarded. Someone who renamed in both places must be able to see that both
   * renames happened — a rename that vanishes without a word is indistinguishable from one that
   * failed, which is the complaint this whole field exists to answer.
   */
  titleOther?: string
  /** Harness id, or `''` when the registry has forgotten it. The colour and grouping key. */
  harness: string
  cwd: string
  /** The last path segment of `cwd` — the "by project" grouping key, computed by the host. */
  project: string
  /**
   * The REPOSITORY this session's directory belongs to, `org/repo` or the checkout's folder name.
   *
   * A separate grouping from `project`, and the one that matches how the work is organised: three
   * worktrees of one repo are three places to work on ONE thing, and grouping by directory files
   * them under three unrelated names. Absent for a directory that is not in a repository at all.
   */
  repo?: string
  /**
   * What the "by project" grouping keys on, when it is not simply the directory name.
   *
   * The main checkout's folder for anything inside a repository — so the three worktrees of
   * `agentistics` group under `agentistics` rather than under `session-monitor`, `billing-basis`
   * and `agentistics`, which files one project as three. It is a SEPARATE field from `project`
   * because the row must still say which directory it is actually in: with several worktrees open
   * at once, the folder cell is the only thing telling them apart.
   */
  projectGroup?: string
  /** True only for a LINKED worktree. Said on the row, because it changes what the row IS. */
  worktree?: boolean
  /**
   * Whether the user deliberately MARKED this session — gave it a name, a note or a task.
   *
   * Its own flag rather than something the screen infers from `title`, because `title` always has a
   * value: the host derives one when there is no label, so "has a title" says nothing about whether
   * anyone chose it. The history switches make an exception of a marked row — see `sessionNamed`.
   */
  named?: boolean
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
  /**
   * The DIALOG this session is blocked on, verbatim — present only while it is asking.
   *
   * A different reading of the frame from `lastLines`, which cuts the input box and the status strip
   * away and would therefore cut the dialog away. This is what a person has to READ before agreeing:
   * the options, which one is highlighted, and the footer naming the key. The keystroke that answers
   * cannot know which option it is taking, so the screen showing this IS the safety.
   */
  approvalLines?: string[]
  /**
   * Whether the approve verb can run on this row at all.
   *
   * True only when the session is blocked on a dialog AND this harness's dialog has been read, so
   * the keystroke that answers it is a recorded fact rather than a guess. False everywhere else,
   * including on a perfectly healthy working session — approving something that is not asking
   * anything sends a blank turn, or takes an option out of a menu nobody was looking at.
   */
  canApprove?: boolean
  /**
   * The OPTIONS the dialog is offering, when its screen could be read with confidence.
   *
   * Present only on a blocked row, and ABSENT rather than invented when the screen cannot be
   * parsed. Its presence changes what "answering" means: with options there is no such thing as
   * approving, only choosing one of them, and the UI must show them and send the one picked.
   *
   * The case this exists for is real and was reported: a session asking "how should I promote to
   * prod?" with four different answers, in front of a key called `approve` that would have silently
   * taken whichever was highlighted.
   */
  dialogOptions?: Array<{ number: number; label: string; selected: boolean }>
  /**
   * Whether the user may pick one of `dialogOptions` from here.
   *
   * False when this harness has no verified way to select an option by number (`approval-spec.ts`).
   * There is deliberately NO fallback to the confirm key in that case: confirming the highlighted
   * row on a dialog somebody is being shown four answers to is choosing for them.
   */
  canChoose?: boolean
  /**
   * Why approving is unavailable HERE, already localized — present only when the session is blocked
   * and nobody has read this harness's dialog.
   *
   * Its presence is the statement, the same shape as `approvalBlind`: absence is not a reassurance,
   * and a verb that vanished without a word reads as the feature being broken.
   */
  approveBlind?: string
  /**
   * Why the options on screen cannot be answered from here, already localized — present only when
   * there ARE options and this harness has no verified way to pick one.
   *
   * A refusal that names its reason is usable: it tells someone to attach, which works. A verb that
   * quietly picks for them is not.
   */
  chooseBlind?: string
  /**
   * This session was taken by the machine along with the others, and comes back with them.
   *
   * Decided over the WHOLE registry rather than from this row — "did these fall together" is a
   * question about a set — so the host hands the answer down rather than the screen inferring one.
   */
  fell?: boolean
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
  grouping: 'none' | 'task' | 'harness' | 'model' | 'project' | 'repo'
  showClosed: boolean
  showExited: boolean
  /** Only meaningful while grouping by task, but stored either way so it survives a detour. */
  showUnfiled: boolean
  /**
   * Whether the sessions of a FINISHED task are listed.
   *
   * Absent reads as `false`, which is the point of marking a task finished at all: the work is over
   * and its sessions stop competing for the screen with the work that is not. It is a filter and
   * never a deletion — the sessions are still there, still attachable, one toggle away.
   */
  showDone?: boolean
  /**
   * Show ONLY what is running: working, waiting, waiting on approval. Nothing else, no exceptions.
   *
   * The one switch that OVERRIDES the "a row you named is never hidden" rule rather than widening
   * alongside it. That rule exists so a reboot does not empty the list, and it is right by default —
   * but it also means a machine with months of named work shows all of it, and someone who wants
   * the four things they are actually doing had no way to say so. This is that way.
   */
  onlyActive?: boolean
  /**
   * The exact states the list keeps, when the user narrowed it beyond "active or everything".
   *
   * Absent means the two switches above decide, which is the ordinary case. Present, it is the
   * whole answer — and it is stored as the states to KEEP rather than the ones to hide, so a state
   * added to the product later is not silently included in a filter written before it existed.
   */
  states?: string[]
  /** How the rows are ordered. Absent is by state — what is blocked on you, first. */
  sort?: { by: string; dir: 'asc' | 'desc' }
  /** Whether the detail pane under the list is drawn at all. */
  hideDetail?: boolean
  /**
   * How the fleet is ARRANGED — a list of rows, or a grid of cards.
   *
   * Absent reads as `DEFAULT_SESSION_VIEW.layout`, never as a literal: a fallback written by hand
   * once turned the strict filter off on every machine that already had a `preferences.json`, and
   * the persist effect then wrote that off to disk, making it permanent.
   */
  layout?: 'list' | 'cards'
  /**
   * WHICH PAGE of cards was open, named by the SESSION at the top of it rather than by a number.
   *
   * The fleet re-sorts every five seconds, so "page 2" is a position and a position is not an
   * identity — by the next poll it holds different sessions. The same rule `asideRowKey` follows
   * for the menu cursor. An anchor that is no longer in the list simply opens page 0.
   */
  cardAnchor?: string
  /**
   * Session ids the user has MARKED, so a row can be found again without searching for it.
   *
   * Persisted for the same reason the arrangement is: detaching from a session remounts this
   * screen, and a mark that did not survive that would be gone at exactly the moment it was most
   * useful — you marked the row because you were about to go into it.
   */
  marked?: string[]
}

/**
 * How the fleet list opens on a machine that has never chosen — and what `ctrl+r` restores.
 *
 * Stated ONCE, here, because three places used to spell it out: the host's fallback, the screen's
 * initial state, and the reset. Three copies of a default is three chances for the app to open on
 * one arrangement and reset to another.
 *
 * Only ACTIVE conversations, grouped by project. The list opens as what is happening rather than as
 * everything that ever has — and `onlyActive` means that strictly, named rows included, which is
 * the whole reason it exists.
 *
 * The consequence is deliberate and has to be stated somewhere the user can see it: when nothing is
 * running, this default shows an EMPTY list. It is not empty because the fleet is — the sessions
 * that a reboot turned into `lost` rows are still there, still named, still reopenable — so the
 * screen says so in words and names the key that lifts the filter. A blank pane under a strict
 * filter is indistinguishable from a broken one.
 */
export const DEFAULT_SESSION_VIEW: SessionViewPrefs = {
  grouping: 'project',
  showClosed: false,
  showExited: false,
  showUnfiled: true,
  showDone: false,
  onlyActive: true,
  layout: 'list',
}

/**
 * A session the machine lost that could be started again — see `planRestore`.
 *
 * Offered ONCE, on the run after everything went down, and never while anything is still running:
 * a machine with live sessions did not lose everything, and a modal that greets an ordinary restart
 * is a modal people learn to dismiss without reading.
 */
export interface RestoreCandidate {
  id: string
  /** Already-composed name: the user's own when there is one, else the conversation's. */
  label: string
  harness: string
  /** The last path segment, for a list that has to stay narrow. */
  project: string
  /**
   * When it started, epoch ms — absent when the registry's timestamp is unreadable.
   *
   * An instant rather than a duration, like every other time this contract carries: the screen
   * repaints far more often than the poll runs, so a duration computed here would freeze at
   * whatever it was when the host last looked.
   */
  startedAt?: number
}

export interface ControlSessions {
  sessions: ControlSession[]
  /** How many are waiting on a person. Drives the header counter, from every tab. */
  attention: number
  /** Ids that JUST entered attention. The shell rings the terminal bell for these, once. */
  rang: string[]
  /** Already-localized reason this list may not be the whole truth. Never an empty list alone. */
  unavailable?: string
  /**
   * The REAL keystroke that leaves an attached session, read from the backend.
   *
   * On the snapshot rather than only on the attach, so the screen can state it permanently. It was
   * printed once before handing the terminal over and then scrolled away — and a user who cannot
   * get out is stranded in a buffer that hides their shell.
   */
  detachHint?: string
  /**
   * The tasks the user has marked FINISHED.
   *
   * On the snapshot rather than derived from the sessions, because it is a statement about the WORK
   * and not about any session's state: a task is over when the person says it is, which is a
   * different fact from every one of its sessions having exited. Sessions of a finished task are
   * hidden by default and shown by a toggle.
   */
  finishedTasks?: string[]
  /**
   * The sessions the machine took ALL AT ONCE, when there are any.
   *
   * A reboot, an OOM kill or a lost tmux server turns every managed session into a `lost` row in the
   * same instant. This names that event so all of them can be picked back up with one action — which
   * is the whole point: a list of forty rows that includes everything that ever ran cannot be
   * reopened without reading each one first.
   *
   * `atMs` is when it happened, and the UI must SAY it: a fall from three days ago is a perfectly
   * legitimate thing to offer, and an offer that does not say when reads as one that just happened.
   */
  fell?: { count: number; atMs: number }
  /**
   * The SAME fall, named row by row, for the offer made on the way in.
   *
   * `fell` is the count and the instant — enough for the summary row, the section heading and the
   * menu verb. This is the list a person reads to DECIDE, and a count cannot be decided on: three
   * sessions in a repository you have finished with and one you were in the middle of are the same
   * "4" on screen.
   *
   * Both come from ONE selection (`planCrashGroup`), and that is the point of them being two fields
   * rather than two questions: a second answer to "what fell" is a second set of rules, which is
   * the bug `task-reopen.ts` exists to have fixed once.
   *
   * Narrower than `fell` by exactly one rule: a row whose conversation does not resolve is dropped
   * here, because this list is CLICKABLE and a row that cannot be reopened is a button that fails.
   * It stays inside `fell`, where the reopen counts it as skipped rather than pretending it never
   * fell.
   */
  restorable?: RestoreCandidate[]
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

  /**
   * Type one line into a session and submit it, WITHOUT attaching to it.
   *
   * The ordinary case is a session that is working or waiting: the text lands in its prompt and it
   * reads it when it gets there. The case that must be refused is a session with a DIALOG open —
   * there the prompt is not a prompt, it is a menu, and a sentence typed into it is an answer to a
   * question nobody read. The host re-reads the screen before sending and refuses in words; the
   * screen cannot decide it, because its list is up to a poll old.
   */
  promptSession?(id: string, text: string): Promise<ActionResult>

  /**
   * Answer the dialog this session is blocked on.
   *
   * `choice` is the option NUMBER to pick, and it is the whole point of this signature: a dialog
   * offering "only my fix / promote everything / stop here / type something" has no approval, and a
   * verb that took the highlighted row would be choosing between four different outcomes on the
   * user's behalf. Omitted only for a dialog with no readable options — the codex-shaped
   * `Press enter to continue`, where there genuinely is nothing to choose between — and the host
   * then sends the confirm key.
   *
   * The host re-reads the frame immediately before sending and refuses when the session is no longer
   * asking, or when the options on screen no longer match what the user was shown. A snapshot is up
   * to five seconds old, and an answer to a question that has changed is worse than no answer.
   */
  answerSession?(id: string, choice?: number): Promise<ActionResult>

  /**
   * Reopen every session of the last fall, in the background.
   *
   * The same arithmetic `openTask` runs (`task-reopen.ts`), over the set `ControlSessions.fell`
   * names instead of over a task: a row still running is left alone and reported as such, a row
   * already finished is not resurrected, an unresolvable one is skipped AND counted, and everything
   * reopened retires the row it replaced.
   */
  reopenFell?(): Promise<ActionResult>

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
   * Mark a task finished, or reopen it. Absent on a host that cannot remember the answer.
   *
   * Takes the state to SET rather than toggling, so the screen and the store can never disagree
   * about what the button just did — a toggle computed from a snapshot one poll old flips the wrong
   * way the moment two things happen between polls.
   */
  finishTask?(task: string, done: boolean): Promise<ActionResult>

  /**
   * Start the offered sessions again, detached, or decline them.
   *
   * DECLINING is not a no-op: it retires the rows it was offered (`endedAt`), because "no" here
   * means the work is over. Without that the same modal greets you on the next run and the run
   * after, which is how a prompt becomes something people clear without reading — and the rows
   * stay listed and individually reopenable either way, so nothing is destroyed by saying no.
   */
  restoreSessions?(ids: string[], accept: boolean): Promise<ActionResult>

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
  /**
   * The directory NAME, on its own.
   *
   * On its own, and not joined to the repo any more: the picker draws a measured TABLE, and a cell
   * that already contains two facts and a separator cannot be aligned against anything. It read as
   * a paragraph per row — which, on a machine with twenty candidates, is what made it unusable.
   */
  label: string
  /** The repository it belongs to (`org/repo`), when it belongs to one. Its own column. */
  repo?: string
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
  /**
   * The piece of work this session belongs to, chosen while starting it.
   *
   * Declared, and not merely spread in by the wizard: TypeScript runs no excess-property check on a
   * spread, so a field the request type does not know about is dropped in silence — the wizard
   * would ask the question and throw the answer away.
   */
  task?: string
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
  /**
   * The registry row this reopen REPLACES, when there is one.
   *
   * Reopening spawns a new session, so without this the old row stays beside it: a laptop closed
   * and opened twice leaves a task holding two dead twins and one live session, all with the same
   * name. The host retires the named row and carries its note and its task onto the new one — what
   * you wrote about a piece of work must survive picking that work back up.
   */
  replaces?: string
  attach: boolean
}

export interface SpawnSessionResult {
  ok: boolean
  /** Already-localized outcome for the status line. */
  message: string
  /** Present only on a successful ATTACHED start — the shell reports it as `ControlExit.attach`. */
  ticket?: AttachTicket
  /**
   * The id of the session that was started, on success.
   *
   * Returned so a caller that is REPLACING an older row can carry its note onto the new one — the
   * spawn is the only place that knows the id, and asking the registry afterwards would be a guess
   * about which of several rows in the same directory is the one just created.
   */
  id?: string
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
