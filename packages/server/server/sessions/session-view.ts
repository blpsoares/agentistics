/**
 * session-view.ts — PURE. One list holding the whole fleet: the sessions agentop hosts, and the
 * assistants running beside it that it did not start.
 *
 * External processes are here because "one place to see everything" is the point of the monitor —
 * an assistant opened by hand in another terminal is exactly the one a user loses track of. They
 * are marked `external` and carry NO activity, because nothing about them is capturable: there is
 * no frame to read and no backend to ask. Rendering a state for them would be inventing one.
 */

import type { HarnessId } from '@agentistics/core'
import { type HarnessProcess, sessionAtCwd } from '../live-sessions'
import { rulesFor } from './attention-rules'
import { chosenName, type HarnessSessionFile } from './harness-session-file'
import type { HarnessSessionIndex } from './harness-sessions'
import type { ReconciledSession } from './session-ref'
import type { Conversation } from './conversations'
import { conversationForProcess } from './conversations'
import type { ManagedSession, SessionActivity } from './types'

/**
 * The registry's own record of when a session began, as epoch ms — PURE.
 *
 * `''` and anything unparseable yield nothing rather than 1970: a start time nobody can read is an
 * absence, and an absence rendered as "56 years ago" is worse than a blank.
 */
export function registryCreatedMs(iso: string | undefined): { createdMs?: number } {
  if (!iso) return {}
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? { createdMs: ms } : {}
}

export interface SessionView {
  id: string
  /**
   * ABSENT when it cannot be known.
   *
   * An `unregistered` row is one the backend hosts and the registry has forgotten — the harness it
   * runs is not recorded anywhere we can read. Defaulting it to `claude` would file a session under
   * a harness it may not be, in a list whose entire value is that it can be trusted.
   */
  harness?: HarnessId
  cwd: string
  /**
   * `external` — running, but agentop did not start it. `closed` — a conversation on this machine
   * that is not running at all.
   *
   * Neither can be attached to, and both can usually be REOPENED, which is what `resume` carries.
   * There is deliberately no second `managed` boolean saying the same thing as this field, which
   * could then disagree with it.
   */
  status: ReconciledSession['status'] | 'external' | 'closed'
  /** ABSENT for an external session — not capturable, so not knowable. */
  activity?: SessionActivity
  /**
   * The last few meaningful lines of this session's screen — what it is saying right now.
   *
   * Only ever present for a session agentop hosts: it comes from the frame that was captured to
   * decide the state, so it costs nothing extra, and there is no frame to read for anything else.
   */
  lastLines?: string[]
  /**
   * The BOTTOM of the screen verbatim, present only while this session is blocked on a dialog.
   *
   * A different reading of the same frame from `lastLines`, and it has to be: `frameTail` cuts the
   * input box and the status strip off, which for a session sitting on a dialog cuts the dialog off.
   * This is what the person answering actually needs to read — the options, which one is highlighted
   * and the footer naming the key — because the keystroke that answers cannot know which option it
   * is taking. See `approval-spec.ts` and `approvalTail`.
   */
  approvalLines?: string[]
  /**
   * This session was taken by the machine along with the others, and is offered back with them.
   *
   * Decided by `crash-group.ts` over the whole registry, so it cannot be derived from this row: the
   * question "did these fall together" is about a set, and a per-row rule could only ever guess.
   */
  fell?: boolean
  label?: string
  /** When `label` was written, epoch ms — the recency side of the title contest. */
  labelSince?: number
  /**
   * The name the user gave this session FROM INSIDE IT, and when.
   *
   * Read from what the harness records about its own live sessions (`harness-sessions.ts`), matched
   * EXACTLY — by the tmux session for a row we host, by pid for one we merely observed. A name the
   * harness invented for itself is not carried here at all: `chosenName` drops it, because a
   * generated `agentistics-77` replacing a label somebody typed is the "reopen renamed the row back"
   * bug in a new costume.
   */
  harnessName?: string
  harnessNameSince?: number
  note?: string
  model?: string
  effort?: string
  /** The piece of work this session belongs to, when the user said. Groups the list. */
  task?: string
  createdMs?: number
  attached: boolean
  /**
   * The conversation this row could REOPEN, when there is one.
   *
   * Present on an `external` row (the conversation it appears to be driving) and on a `closed` one
   * (itself). Absent when the harness cannot reopen by id — gemini takes "latest" or an index, never
   * an id — so the verb is simply not offered rather than offered and wrong.
   */
  resume?: { sessionId: string; title: string }
  /** Metrics of the conversation behind this row, when it has any. Absent is never zero. */
  tokens?: number
  costUSD?: number
  /**
   * Whether this harness has probed approval rules at all.
   *
   * False means a session blocked on a permission prompt reads as plain `waiting` — still counted,
   * still surfaced, but the reason cannot be shown. The UI says so; this flag is where it learns it.
   */
  approvalDetection: boolean
  /**
   * Everything about this row worth searching, lowercased and joined.
   *
   * Composed HERE so the search reaches a closed conversation's OPENING PROMPT — which is what a
   * person actually remembers about something they closed ("the one where I asked about the
   * migration") — without the screen having to hold conversation text it never renders.
   */
  searchText: string
}

export function needsAttention(a?: SessionActivity): boolean {
  return a === 'waiting' || a === 'waiting-approval'
}

/** Sort key: what is waiting on a person first, then what is running, then what is finished, then
 *  the rows nothing can be done about. */
const RANK: Record<string, number> = {
  'waiting-approval': 0,
  waiting: 1,
  working: 2,
  exited: 3,
}

function rankOf(v: SessionView): number {
  // Closed conversations sit below everything running: they are history, and history must never
  // push a session that is waiting on someone further down the screen.
  if (v.status === 'closed') return 6
  if (v.status === 'external') return 5
  return RANK[v.activity ?? ''] ?? 4
}

/**
 * An id for an external process that is STABLE across polls and unique per process.
 *
 * The start time is what does both jobs: it distinguishes two assistants of the same harness open
 * in one directory (harness + cwd alone would collapse them into a single row), and unlike a list
 * index it does not change when an unrelated process appears or exits.
 */
function externalId(p: HarnessProcess): string {
  return `external:${p.harness}:${p.cwd}:${p.startedMs ?? 0}`
}

/** Everything a row can be found by, in one lowercased blob. */
function searchTextOf(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ').toLowerCase()
}

/**
 * The rows matching what was typed — PURE, and the same predicate for every kind of row.
 *
 * One function rather than a filter per status: a search that quietly skipped closed conversations
 * would be a search that cannot find the thing it was most likely opened to find.
 */
export function filterSessions(views: readonly SessionView[], query: string): SessionView[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...views]
  return views.filter(v => v.searchText.includes(q))
}

export function buildSessionViews(o: {
  reconciled: readonly ReconciledSession[]
  activity: ReadonlyMap<string, SessionActivity>
  /** The tail of each hosted session's screen, keyed by session id. */
  tails?: ReadonlyMap<string, string[]>
  /** The DIALOG a blocked session is showing, keyed by session id — see `SessionView.approvalLines`. */
  approvals?: ReadonlyMap<string, string[]>
  /** The ids `crash-group.ts` decided fell together. A set, because the question is about a set. */
  fell?: ReadonlySet<string>
  /**
   * What each harness records about its OWN live sessions, indexed by the two exact keys — the tmux
   * session a managed row runs in, and the pid of a process found on the host.
   *
   * It is what makes this the one correlation in this file that is not a guess: a row matched here
   * knows its conversation id exactly, so `claimResume` never has to fall back to "some conversation
   * in this directory" — the fallback that once reopened three rows onto one conversation.
   */
  harnessSessions?: HarnessSessionIndex
  processes: readonly HarnessProcess[]
  /** Everything this machine has ever recorded, newest first. Used to name what an external process
   *  is driving, and to offer the conversations that are not running at all. */
  conversations?: readonly Conversation[]
  /**
   * How many closed conversations to offer.
   *
   * Small on purpose. A machine with hundreds of them must not drown the handful that are actually
   * running — the list is for what is happening, and SEARCH is how an older conversation is found.
   * Forty made the closed block longer than everything else on the screen put together.
   */
  closedLimit?: number
}): SessionView[] {
  /**
   * Conversations already spoken for, so ONE is never offered to two rows.
   *
   * `conversationForProcess` matches on harness and directory, which is all it can do for a process
   * it did not start — and every managed session in one directory therefore resolved to the SAME
   * conversation. After a crash left five rows `lost` in this repository, reopening them handed
   * three of them the same conversation and the fleet came back with one session listed three
   * times, all wearing the same name. Reported from a real machine.
   *
   * A row that RECORDED which conversation it drives is exact and claims that one. The rest fall
   * back to the directory guess, but only to a conversation nobody has taken.
   */
  const claimed = new Set<string>()
  const claimResume = (
    managed: ManagedSession | undefined,
    harness: HarnessId,
    /**
     * The conversation the HARNESS ITSELF says this row is driving.
     *
     * Outranks the registry's own record and the directory guess alike, because it is the only one
     * of the three that is a fact rather than a recollection or an inference: the harness wrote it
     * about the session it is running, and the row was matched to it by tmux session or by pid.
     */
    exactId?: string,
  ): { resume?: { sessionId: string; title: string } } => {
    const pool = o.conversations ?? []
    const exact = exactId ? pool.find(c => c.sessionId === exactId) : undefined
    const own = exact ?? (managed?.conversationId
      ? pool.find(c => c.sessionId === managed.conversationId)
      : undefined)
    const conv = own ?? pool.find(c =>
      !claimed.has(c.sessionId)
      && c.harness === harness
      && sessionAtCwd({ current_cwd: c.cwd, project_path: c.cwd }, managed?.cwd ?? ''))
    if (!conv?.resumable) return {}
    claimed.add(conv.sessionId)
    return { resume: { sessionId: conv.sessionId, title: conv.title } }
  }

  const managed: SessionView[] = o.reconciled.map(r => {
    const harness = r.managed?.harness
    // What the harness says about ITSELF, matched by the tmux session it recorded — the one exact
    // link between its record and this row.
    const own: HarnessSessionFile | undefined = o.harnessSessions?.byManagedId.get(r.id)
    const ownName = chosenName(own)
    // A session the user FINISHED reports `exited` whatever the backend still holds: the row exists
    // to be reopened, and calling it `running` because a dead tmux pane lingers would put it back
    // among the things you can talk to.
    const finished = Boolean(r.managed?.endedAt)
    const activity = finished ? ('exited' as const) : o.activity.get(r.id)
    return {
      id: r.id,
      ...(harness ? { harness } : {}),
      cwd: r.managed?.cwd ?? '',
      status: finished ? ('exited' as const) : r.status,
      ...(activity ? { activity } : {}),
      ...((o.tails?.get(r.id)?.length ?? 0) > 0 ? { lastLines: o.tails!.get(r.id)! } : {}),
      // Only while it is genuinely asking. A dialog frame carried on a row that has moved on would
      // be shown under "what you are about to confirm" for a question that is no longer open.
      ...(activity === 'waiting-approval' && (o.approvals?.get(r.id)?.length ?? 0) > 0
        ? { approvalLines: o.approvals!.get(r.id)! }
        : {}),
      ...(o.fell?.has(r.id) ? { fell: true as const } : {}),
      ...(r.managed?.label ? { label: r.managed.label } : {}),
      ...(r.managed?.labelSince !== undefined ? { labelSince: r.managed.labelSince } : {}),
      ...(ownName ? { harnessName: ownName } : {}),
      ...(ownName && own?.nameSince !== undefined ? { harnessNameSince: own.nameSince } : {}),
      ...(r.managed?.note ? { note: r.managed.note } : {}),
      ...(r.managed?.model ? { model: r.managed.model } : {}),
      ...(r.managed?.effort ? { effort: r.managed.effort } : {}),
      ...(r.managed?.task ? { task: r.managed.task } : {}),
      // The backend's clock when there is a backend, the REGISTRY's when there is not. A row the
      // machine lost has no tmux session left to ask, so it reported no start time at all — and a
      // session you are deciding whether to reopen is one whose age is most of the decision.
      ...(r.backend
        ? { createdMs: r.backend.createdMs }
        : registryCreatedMs(r.managed?.createdAt)),
      // Reopening a finished session is the whole reason its row is kept. Resolved the same way an
      // external process's conversation is — by harness and directory — and absent when nothing
      // can be resolved, rather than offering a verb with no target.
      // Reopening is offered for ANY managed row that is not running — one you finished, one whose
      // command exited, and one the backend no longer has at all. That last case is a REBOOT: tmux
      // is gone, every managed session is `lost`, and without this the sessions you were in the
      // middle of came back as rows with no verb on them. Resolved the same way an external
      // process's conversation is, and absent when nothing resolves rather than offering a verb
      // with no target.
      ...((finished || r.status === 'lost' || r.status === 'exited') && harness
        // `own?.sessionId` is only ever present for a row still ALIVE — the harness deletes its
        // record when the process goes — so on a `lost` row this is `undefined` and the registry's
        // own `conversationId` decides, exactly as before. That is not a gap: the id was recorded
        // into the registry while the session was up, by the branch below.
        ? claimResume(r.managed, harness, own?.sessionId)
        : {}),
      attached: r.backend?.attached ?? false,
      approvalDetection: harness !== undefined && rulesFor(harness) !== undefined,
      // The harness's own name is searchable too: it is the name the person reading this screen may
      // well be the only one they remember, having typed it inside the session.
      searchText: searchTextOf(
        harness, r.managed?.cwd, r.managed?.label, ownName, r.managed?.note, r.managed?.task,
      ),
    }
  })

  // An assistant already accounted for by a managed row must not appear twice. Matched through the
  // same `sessionAtCwd` predicate the live panel uses, so the two surfaces cannot disagree about
  // whether one running assistant is one row or two.
  //
  // A row whose harness is unknown covers NOTHING: it might be that process or might not, and
  // silently swallowing an external session on a maybe is the worse of the two errors — a duplicate
  // row is visible and self-correcting, a missing one is not.
  const covered = (p: HarnessProcess): boolean => managed.some(m =>
    m.harness === p.harness &&
    m.status !== 'lost' &&
    sessionAtCwd({ current_cwd: m.cwd, project_path: m.cwd }, p.cwd))

  const conversations = o.conversations ?? []

  const external: SessionView[] = o.processes.filter(p => !covered(p)).map(p => {
    // What the harness says about ITSELF, keyed on the pid `/proc` reported. Exact where every other
    // reading of an external process is an inference from its directory.
    const own = p.pid !== undefined ? o.harnessSessions?.byPid.get(p.pid) : undefined
    const ownName = chosenName(own)
    // What this process appears to be driving. The harness's own `sessionId` outranks the argv one
    // and the directory guess alike: it is what the process is writing to, said by the process.
    const conv = conversationForProcess(conversations, {
      harness: p.harness,
      cwd: p.cwd,
      ...(own?.sessionId ?? p.sessionId ? { namedId: own?.sessionId ?? p.sessionId! } : {}),
    })
    return {
      id: externalId(p),
      harness: p.harness,
      cwd: p.cwd,
      status: 'external' as const,
      ...(ownName ? { harnessName: ownName } : {}),
      ...(ownName && own?.nameSince !== undefined ? { harnessNameSince: own.nameSince } : {}),
      ...(p.startedMs !== undefined ? { createdMs: p.startedMs } : {}),
      attached: false,
      approvalDetection: false,
      ...(conv?.resumable ? { resume: { sessionId: conv.sessionId, title: conv.title } } : {}),
      ...(conv?.tokens !== undefined ? { tokens: conv.tokens } : {}),
      ...(conv?.costUSD !== undefined ? { costUSD: conv.costUSD } : {}),
      searchText: searchTextOf(p.harness, p.cwd, ownName, conv?.title, conv?.firstPrompt),
    }
  })

  // Conversations that are not running at all — the ones you closed and want back. They are the
  // reason this screen can answer "what was I doing yesterday" as well as "what is running now".
  //
  // A conversation ALREADY on screen must not appear a second time as history, and it was: only the
  // external rows were excluded, so a session agentop is running right now was listed once as
  // `working` and again as `closed` — the same title, the same directory, twice. Every LIVE row
  // covers its conversation, whether that row is one we host or one we merely observed.
  const shown = new Set<string>()
  for (const v of external) if (v.resume) shown.add(v.resume.sessionId)
  for (const m of managed) {
    // A managed row does not carry a conversation id, so it covers by the same harness+directory
    // inference used for a foreign process. `exited` and `lost` rows cover nothing: their work IS
    // over, and the conversation belongs in history where it can be reopened.
    if (m.status !== 'running' && m.status !== 'unregistered') continue
    const conv = m.harness
      ? conversationForProcess(conversations, { harness: m.harness, cwd: m.cwd })
      : undefined
    if (conv) shown.add(conv.sessionId)
  }

  const closed: SessionView[] = conversations
    .filter(c => !shown.has(c.sessionId))
    .slice(0, o.closedLimit ?? 12)
    .map(c => ({
      id: `closed:${c.sessionId}`,
      harness: c.harness,
      cwd: c.cwd,
      status: 'closed' as const,
      label: c.title,
      createdMs: c.lastActivityMs,
      attached: false,
      approvalDetection: false,
      ...(c.resumable ? { resume: { sessionId: c.sessionId, title: c.title } } : {}),
      ...(c.tokens !== undefined ? { tokens: c.tokens } : {}),
      ...(c.costUSD !== undefined ? { costUSD: c.costUSD } : {}),
      searchText: searchTextOf(c.harness, c.cwd, c.title, c.firstPrompt),
    }))

  return [...managed, ...external, ...closed].sort((a, b) => {
    const byRank = rankOf(a) - rankOf(b)
    if (byRank !== 0) return byRank
    return (b.createdMs ?? 0) - (a.createdMs ?? 0)
  })
}

export function attentionCount(views: readonly SessionView[]): number {
  return views.filter(v => needsAttention(v.activity)).length
}

export type SessionGrouping = 'harness' | 'model' | 'project' | 'task' | 'none'

export interface SessionGroup {
  key: string
  /** Already display-ready. An empty key gets a sentence rather than a blank heading. */
  label: string
  sessions: SessionView[]
}

/** The last path segment, separators normalised — the same reading `projectNameKey` uses, minus the
 *  case folding, because this is a heading rather than a cross-machine correlation key. */
function projectName(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] ?? cwd
}

export function groupSessions(views: readonly SessionView[], by: SessionGrouping): SessionGroup[] {
  if (by === 'none') return [{ key: '', label: '', sessions: [...views] }]

  const groups = new Map<string, SessionGroup>()
  for (const v of views) {
    const key = by === 'harness' ? (v.harness ?? '')
      : by === 'model' ? (v.model ?? '')
      : by === 'task' ? (v.task ?? '')
      : projectName(v.cwd)
    // An empty key means the fact was never recorded. Each dimension says so in its own words
    // rather than sharing one blank heading that reads as a category.
    const label = key !== '' ? key
      : by === 'harness' ? 'harness unknown'
      : by === 'model' ? 'no model recorded'
      : by === 'task' ? 'no task'
      : 'no directory recorded'
    const found = groups.get(key)
    if (found) found.sessions.push(v)
    else groups.set(key, { key, label, sessions: [v] })
  }
  return [...groups.values()]
}

/**
 * The ids that JUST entered a state needing an answer — what the caller rings the bell for.
 *
 * A transition rather than a level, so a session sitting on a question for ten minutes does not
 * beep every five seconds. Escalating from `waiting` to `waiting-approval` counts as a transition:
 * it is a different urgency, and the bell is the only signal this design ships.
 */
export function bellTransitions(
  prev: ReadonlyMap<string, SessionActivity>,
  next: readonly SessionView[],
): string[] {
  const out: string[] = []
  for (const v of next) {
    if (!needsAttention(v.activity)) continue
    const before = prev.get(v.id)
    if (before === v.activity) continue
    out.push(v.id)
  }
  return out
}
