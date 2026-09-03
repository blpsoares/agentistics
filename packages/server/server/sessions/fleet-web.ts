/**
 * fleet-web.ts — the WEB dashboard's window onto the session fleet.
 *
 * It owns no rules. The fleet is read through the very `ControlHost` the cockpit drives
 * (`createControlHost`), the rows are mapped by the very `toControlSession` the cockpit and
 * `agentop session ls` map with, and which verbs a row may take is the very `sessionActions` the
 * cockpit resolves every keypress against. What is added is the transport and nothing else.
 *
 * That indirection is the point rather than an accident. `answerSession` re-reads the frame
 * immediately before sending, re-parses the options, and REFUSES a numbered dialog on a harness
 * with no verified way to select by number — because the confirm key takes whichever row is
 * highlighted, which on "only my fix / promote everything / stop here" is choosing for somebody. A
 * browser-side copy of that would be a button that quietly picks. So the browser asks the host.
 *
 * The host is built ONCE per language and kept: constructing one fires a version check, and a fresh
 * host per request would fire one per poll.
 */

import type { StartHost } from '../cli-start'
import type { CliLang } from '../cli-lang'
import { controlStrings } from '@agentistics/tui/control/i18n'
import type { ControlSession } from '@agentistics/tui/control/session-fleet'
import { sessionRunning } from '@agentistics/tui/control/session-dimensions' 
import { fleetRow, type FleetActionRequest, type FleetRow } from './fleet-row'
import { planFleetSpawn, type FleetSpawnBody } from './fleet-spawn'
import { arrangeFleet, type FleetArrangement, type FleetViewRequest } from './fleet-arrange'
import { markFleetPhase, timeFleetPhase } from './fleet-profile'

// The REQUEST shape lives in the leaf `fleet-row.ts` so `index.ts` can name it without naming
// this module — see the note there.
export type { FleetRow, FleetVerb, FleetActionId, FleetActionRequest } from './fleet-row'
export type { FleetSpawnBody } from './fleet-spawn'
export type {
  FleetArrangement, FleetGroup, FleetViewRequest, Facet, FacetValue,
} from './fleet-arrange'

export interface FleetPayload {
  sessions: FleetRow[]
  /**
   * The SAME rows, unshaped — what the cockpit itself arranges.
   *
   * `FleetRow` is the presentation half: a state already turned into a word, the verbs already
   * decided. The browser needs the other half too, because grouping, ordering, the cascade and the
   * filters are `session-fleet.ts`'s job and it operates on `ControlSession`. Sending only
   * `FleetRow` would have forced the browser to re-derive them, which is the one thing this whole
   * bridge exists to prevent — the same argument `fleet-row.ts` makes about the verbs.
   *
   * It carries nothing `FleetRow` did not already carry, including the approval screen: this route
   * is `localShell` in `capability-guard.ts`, refused on a central and on every exposed profile, so
   * it is not a new class of exposure. It is the same machine reading its own terminals.
   */
  rows: ControlSession[]
  /** How many are waiting on a person — the same count the cockpit's header carries. */
  attention: number
  /** Already-localized reason this list may not be the whole truth. Never an empty list alone. */
  unavailable?: string
  /** The tasks that already exist here, so filing a session is a pick rather than a spelling test. */
  tasks: string[]
  /** The tasks the user marked FINISHED — a statement about the work, not about any session. */
  finishedTasks?: string[]
  /** How many sessions FELL together, when some did — the "reopen what fell" offer. */
  fell?: { count: number; atMs: number }
  /**
   * The same fleet, ARRANGED as the caller asked (`fleet-arrange.ts`).
   *
   * Beside `sessions` rather than instead of it: a client that wants the flat list — the dashboard's
   * session drawer, anything matching a stored row to a live one — should not have to walk bands to
   * find one id.
   */
  view?: FleetArrangement
}


export interface FleetActionResponse {
  ok: boolean
  /** Already localized, and always present: a refusal that says nothing is a broken control. */
  message: string
}

/**
 * `suspend` exists for the one action that needs a real terminal (`central.sh init`). Nothing the
 * web routes call goes near it, and it throws rather than silently running a prompt against a
 * stdin no browser owns.
 */
const NO_TERMINAL = {
  async suspend<T>(_fn: () => Promise<T>): Promise<T> {
    throw new Error('fleet-web: this action needs a terminal and cannot run from the dashboard')
  },
}

const HOSTS = new Map<CliLang, StartHost>()

/** Exported so sibling routes share the ONE host — building a second fires a second version check. */
export async function hostForFleet(lang: CliLang): Promise<StartHost> {
  return hostFor(lang)
}

async function hostFor(lang: CliLang): Promise<StartHost> {
  const cached = HOSTS.get(lang)
  if (cached) return cached
  // Dynamic: `cli-start` reaches `@agentistics/tui/control`, which pulls in Ink and React. The HTTP
  // server must not carry that in its own import graph for the machines that never open this page.
  // See `fleet-profile.ts`: this import is one of the untested candidates for the cold `/api/fleet`
  // cost, split out from `createControlHost` so a profile run says which of the two it actually is.
  const importStart = performance.now()
  const { createControlHost } = await import('../cli-start')
  markFleetPhase('hostFor: import(cli-start)', importStart)
  const constructStart = performance.now()
  const host = createControlHost(lang, NO_TERMINAL)
  markFleetPhase('hostFor: createControlHost', constructStart)
  HOSTS.set(lang, host)
  return host
}

/** Only the two languages exist; anything else reads as English, as everywhere else. */
export function fleetLang(raw: string | null): CliLang {
  return raw === 'pt' ? 'pt' : 'en'
}

/**
 * The fleet, already shaped for the page.
 *
 * Never throws: a poll that failed comes back as the previous list plus a sentence, and a machine
 * with no session backend at all comes back as an empty list plus the reason. An empty list with no
 * reason would be a confident "nothing is running" from a machine that cannot tell — the same
 * defect `liveEmptyNotice` exists to prevent on the dashboard.
 */
export async function readFleet(lang: CliLang, view?: FleetViewRequest): Promise<FleetPayload> {
  const s = controlStrings(lang)
  const totalStart = performance.now()
  try {
    const host = await hostFor(lang)
    if (!host.sessions) return { sessions: [], rows: [], attention: 0, tasks: [] }
    const fleet = await timeFleetPhase('readFleet: host.sessions()', () => host.sessions!())
    const tasks = host.sessionTasks ? await host.sessionTasks().catch(() => []) : []
    const finishedTasks = fleet.finishedTasks ?? []
    return {
      sessions: fleet.sessions.map(row => fleetRow(row, s)),
      rows: fleet.sessions,
      attention: fleet.attention,
      ...(fleet.unavailable ? { unavailable: fleet.unavailable } : {}),
      tasks,
      ...(finishedTasks.length > 0 ? { finishedTasks: [...finishedTasks] } : {}),
      // What FELL together, so a client can offer to reopen the lot — the cockpit's own grouping,
      // which errs toward excluding: a session with no evidence it was ever alive is never in it.
      ...(fleet.fell ? { fell: fleet.fell } : {}),
      // The arrangement is computed only when a caller asks for one. The dashboard does not, and
      // paying for a grouping nobody reads on every five-second poll is the kind of cost that never
      // shows up in one profile and always shows up in a battery.
      ...(view ? { view: arrangeFleet(fleet.sessions, view, s, finishedTasks) } : {}),
    }
  } catch (e) {
    return {
      sessions: [],
      rows: [],
      attention: 0,
      unavailable: e instanceof Error ? e.message : String(e),
      tasks: [],
      finishedTasks: [],
    }
  } finally {
    markFleetPhase('readFleet: total', totalStart)
  }
}

/**
 * Perform one verb on one row — through the host, so every refusal the cockpit makes is made here.
 *
 * `resume` is the exception in shape rather than in principle: the host's reopen takes the
 * CONVERSATION and the directory, not the row id, so the row is looked up in the very fleet the
 * page was shown. A row whose reopen target cannot be resolved is refused by name rather than
 * spawning a session against a guess.
 */
export async function runFleetAction(
  lang: CliLang,
  req: FleetActionRequest,
): Promise<FleetActionResponse> {
  const s = controlStrings(lang)
  const host = await hostFor(lang)
  const text = (req.text ?? '').trim()

  switch (req.action) {
    case 'approve':
      if (!host.answerSession) return { ok: false, message: s.sessionsNoHost }
      return await host.answerSession(req.id, req.choice)
    case 'prompt':
      if (!host.promptSession) return { ok: false, message: s.sessionsNoHost }
      return await host.promptSession(req.id, text)
    case 'rename':
      if (!host.renameSession) return { ok: false, message: s.sessionsNoHost }
      return await host.renameSession(req.id, text)
    case 'note':
      if (!host.noteSession) return { ok: false, message: s.sessionsNoHost }
      return await host.noteSession(req.id, text)
    case 'task':
      if (!host.taskSession) return { ok: false, message: s.sessionsNoHost }
      return await host.taskSession(req.id, text)
    case 'kill':
      if (!host.killSession) return { ok: false, message: s.sessionsNoHost }
      return await host.killSession(req.id)
    case 'interrupt': {
      // Only meaningful on a session that is actually doing something: pressing Escape into an idle
      // prompt closes whatever the harness has open, which is not what "stop" means.
      if (!host.interruptSession) return { ok: false, message: s.sessionsNoHost }
      return await host.interruptSession(req.id)
    }
    // Acts on the GROUP that fell together, not on a row — the caller names nothing, and the
    // cockpit's own `task-reopen` arithmetic decides which sessions were in it. A caller that could
    // pass a list could resurrect anything on this machine.
    case 'reopenFell':
      if (!host.reopenFell) return { ok: false, message: s.sessionsNoHost }
      return await host.reopenFell()
    // The one action whose subject is a NAME rather than a row: a task is not a session.
    case 'deleteTask':
      if (!host.deleteTask) return { ok: false, message: s.sessionsNoHost }
      if (!text) return { ok: false, message: s.taskNone }
      return await host.deleteTask(text)
    // The two TASK verbs act on the piece of WORK the row is filed under, never on a task named in
    // the request: a caller that could pass its own string could reopen every session of any task
    // on this machine. The row is looked up in the fleet and its own `task` is what is used.
    case 'openTask':
    case 'finishTask': {
      if (!host.openTask || !host.finishTask || !host.sessions) {
        return { ok: false, message: s.sessionsNoHost }
      }
      const fleet = await host.sessions()
      const task = fleet.sessions.find(r => r.id === req.id)?.task
      if (!task) return { ok: false, message: s.taskNone }
      if (req.action === 'openTask') return await host.openTask(task)
      // A TOGGLE, read from the snapshot rather than from the request: "finish" and "unfinish" are
      // the same switch, and letting the browser state which way it goes is how a page one poll
      // behind marks a task finished that somebody had just reopened.
      return await host.finishTask(task, !(fleet.finishedTasks ?? []).includes(task))
    }
    case 'resume': {
      if (!host.resumeSession || !host.sessions) return { ok: false, message: s.sessionsNoHost }
      // Read from the fleet rather than trusted from the browser: the reopen target is a
      // conversation id and a directory, and taking either from a request body would let a caller
      // start an assistant anywhere on this machine.
      const fleet = await host.sessions()
      const row = fleet.sessions.find(r => r.id === req.id)
      if (!row?.resume) return { ok: false, message: s.sessionsReopenNone }
      const out = await host.resumeSession({
        sessionId: row.resume.sessionId,
        harness: row.harness,
        cwd: row.cwd,
        // The user's own name wins over the conversation's derived one — the same precedence the
        // cockpit's reopen applies, or a reopen renames the row back to whatever the transcript
        // called it and undoes the rename every time.
        label: row.named ? row.title : row.resume.title,
        // Only a MANAGED row is replaced: an external process's id is synthetic and a closed
        // conversation's is the harness's own, so retiring either would name a registry row that
        // does not exist.
        ...(row.actionable ? { replaces: row.id } : {}),
        attach: false,
      })
      return { ok: out.ok, message: out.message }
    }
  }
}

// ---------------------------------------------------------------------------
// Attaching, and starting something new.
//
// Both are the SAME indirection as the two above: the host answers, and this module carries the
// answer over the wire. Neither adds a rule.

/** Everything a client needs to enter a session in a terminal IT owns. */
export interface FleetAttachTicket {
  /** The command, already split. Run it with the caller's own stdio — nothing here spawns it. */
  argv: string[]
  /** The REAL detach keystroke, read from the backend, never assumed to be `Ctrl-b`. */
  detachHint: string
  /** What is being attached to, for the sentence printed on the way in. */
  label: string
}

/**
 * What it takes to attach to one session, or `null` when this machine cannot attach to it.
 *
 * Returned rather than PERFORMED, exactly as it is for the cockpit — and for the same reason, one
 * step further out: attaching needs a real tty, and an HTTP server has none to give. A client with
 * a terminal of its own (the VS Code extension's integrated terminal, a shell) runs the argv; a
 * client without one (a browser tab) has the row's `attachCommand` to copy instead.
 *
 * The DETACH KEY travels with it because it is the one fact the user cannot recover alone: a tmux
 * prefix they rebound makes a guessed hint actively wrong, and someone who cannot get out is
 * stranded in a buffer that hides their shell.
 */
export async function readAttachTicket(
  lang: CliLang,
  id: string,
): Promise<FleetAttachTicket | null> {
  const host = await hostFor(lang)
  if (!host.attachSession || !host.sessions) return null

  // SCOPE, checked here and not left to the backend. `attachSession` composes the command from the
  // id it is given — it does not ask whether that session exists — so an id off the wire came back
  // as a perfectly well-formed ticket for nothing, and the client opened a terminal that printed
  // `no such session` and sat there. The same check `/api/fleet/stream` makes for the same reason:
  // the row must be one this machine manages AND be running, or there is nothing to attach TO. An
  // external row is refused on `actionable`: agentop did not start it, so it owns no pane to enter.
  const fleet = await host.sessions()
  const row = fleet.sessions.find(r => r.id === id)
  if (!row || !row.actionable || !sessionRunning(row)) return null

  const ticket = await host.attachSession(id)
  if (!ticket) return null
  return { argv: [...ticket.argv], detachHint: ticket.detachHint, label: ticket.label }
}

/** The questions a start EARNS, and the places it could happen — the wizard, as data. */
export interface FleetNewOptions {
  /**
   * Derived by the host from the spawn specs, so a harness with no spec is ABSENT rather than
   * offered and failing — the same rule the cockpit's wizard and the CLI already follow.
   */
  harnesses: {
    id: string
    label: string
    /** Suggestions to OFFER, never a validation list — see `planFleetSpawn`. */
    modelSuggestions: string[]
    supportsModel: boolean
    /** A genuine closed enum, printed by the CLI itself. Empty means it has no effort flag. */
    efforts: string[]
  }[]
  /** Ranked places, from the LOCAL store — so the picker answers with no network and a cold cache. */
  projects: { path: string; label: string; repo?: string; detail: string; source: string }[]
  /** The tasks that already exist here, so filing the new session is a pick, not a spelling test. */
  tasks: string[]
  /**
   * This machine cannot start sessions at all (no backend on this platform, or a host that does not
   * implement it). Said in words: an empty harness list on its own reads as a broken wizard.
   */
  unavailable?: string
}

/**
 * The wizard's own data. Never throws — a machine that cannot answer says so in a sentence, and an
 * empty list is only ever a real "there is nothing here".
 */
export async function readNewOptions(lang: CliLang, query: string): Promise<FleetNewOptions> {
  const s = controlStrings(lang)
  try {
    const host = await hostFor(lang)
    if (!host.startableHarnesses || !host.spawnSession) {
      return { harnesses: [], projects: [], tasks: [], unavailable: s.sessionsNoHost }
    }
    const [harnesses, projects, tasks] = await Promise.all([
      host.startableHarnesses(),
      host.searchProjects ? host.searchProjects(query).catch(() => []) : Promise.resolve([]),
      host.sessionTasks ? host.sessionTasks().catch(() => []) : Promise.resolve([]),
    ])
    return {
      harnesses: harnesses.map(h => ({
        id: h.id,
        label: h.label,
        modelSuggestions: [...h.modelSuggestions],
        supportsModel: h.supportsModel,
        efforts: [...h.efforts],
      })),
      projects: projects.map(p => ({
        path: p.path,
        label: p.label,
        ...(p.repo ? { repo: p.repo } : {}),
        detail: p.detail,
        source: p.source,
      })),
      tasks,
    }
  } catch (e) {
    return {
      harnesses: [],
      projects: [],
      tasks: [],
      unavailable: e instanceof Error ? e.message : String(e),
    }
  }
}

export interface FleetSpawnResponse {
  ok: boolean
  /** Already localized, and always present. */
  message: string
  /** The id of the session that was started, so the caller can attach to the very one it created. */
  id?: string
}

/**
 * Start one session on this machine.
 *
 * This is the one fleet call that takes a DIRECTORY from the request rather than reading it off a
 * row — `resume` above refuses to, and says why. The difference is the question being asked:
 * reopening names an existing conversation, so a directory in the body could only ever contradict
 * it, while STARTING is the act of choosing where work happens and has nothing else to read it
 * from. The power that comes with it is real and is bounded by exposure rather than by wording:
 * `capability-guard.ts` maps this route to `localShell`, so it is unreachable on a `lan` or
 * `public` profile whoever is authenticated — the same gate the rest of the fleet already sits
 * behind, for the same reason.
 *
 * The request is read by the pure `planFleetSpawn` against the harnesses THIS host says it can
 * start, so the checks the wizard makes by construction are made here explicitly, and the refusal
 * is a sentence naming the offending value. Nothing is repaired: a request asking for a model on a
 * harness with no model flag is refused rather than started without it, because a session that is
 * not the one asked for is worse than no session.
 *
 * `attach` is forced false by the plan and cannot be requested: this process has no tty to hand
 * over. A caller that wants to enter what it started asks `readAttachTicket` for the id that comes
 * back here.
 */
export async function runFleetSpawn(
  lang: CliLang,
  body: FleetSpawnBody,
): Promise<FleetSpawnResponse> {
  const s = controlStrings(lang)
  const host = await hostFor(lang)
  if (!host.spawnSession || !host.startableHarnesses) return { ok: false, message: s.sessionsNoHost }

  const decision = planFleetSpawn(body, await host.startableHarnesses())
  if (!decision.ok) {
    const detail = decision.detail ?? ''
    const message =
      decision.reason === 'unknown_harness' ? s.spawnUnknownHarness(detail)
      : decision.reason === 'cwd_missing' ? s.spawnCwdMissing
      : decision.reason === 'cwd_relative' ? s.spawnCwdRelative(detail)
      : decision.reason === 'unknown_effort' ? s.spawnUnknownEffort(detail)
      : s.spawnModelUnsupported(detail)
    return { ok: false, message }
  }

  const out = await host.spawnSession(decision.plan)
  return { ok: out.ok, message: out.message, ...(out.id ? { id: out.id } : {}) }
}
