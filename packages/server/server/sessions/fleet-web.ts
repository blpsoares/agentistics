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
import { fleetRow, type FleetActionRequest, type FleetRow } from './fleet-row'

// The REQUEST shape lives in the leaf `fleet-row.ts` so `index.ts` can name it without naming
// this module — see the note there.
export type { FleetRow, FleetVerb, FleetActionId, FleetActionRequest } from './fleet-row'

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
  /** Tasks the user marked finished — a statement about the WORK, not about any session's state. */
  finishedTasks: string[]
  /** How many are waiting on a person — the same count the cockpit's header carries. */
  attention: number
  /** Already-localized reason this list may not be the whole truth. Never an empty list alone. */
  unavailable?: string
  /** The tasks that already exist here, so filing a session is a pick rather than a spelling test. */
  tasks: string[]
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

async function hostFor(lang: CliLang): Promise<StartHost> {
  const cached = HOSTS.get(lang)
  if (cached) return cached
  // Dynamic: `cli-start` reaches `@agentistics/tui/control`, which pulls in Ink and React. The HTTP
  // server must not carry that in its own import graph for the machines that never open this page.
  const { createControlHost } = await import('../cli-start')
  const host = createControlHost(lang, NO_TERMINAL)
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
export async function readFleet(lang: CliLang): Promise<FleetPayload> {
  const s = controlStrings(lang)
  try {
    const host = await hostFor(lang)
    if (!host.sessions) return { sessions: [], rows: [], attention: 0, tasks: [], finishedTasks: [] }
    const fleet = await host.sessions()
    const tasks = host.sessionTasks ? await host.sessionTasks().catch(() => []) : []
    return {
      sessions: fleet.sessions.map(row => fleetRow(row, s)),
      rows: fleet.sessions,
      attention: fleet.attention,
      ...(fleet.unavailable ? { unavailable: fleet.unavailable } : {}),
      tasks,
      finishedTasks: fleet.finishedTasks ?? [],
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
