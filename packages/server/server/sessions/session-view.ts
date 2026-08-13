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
import type { ReconciledSession } from './session-ref'
import type { Conversation } from './conversations'
import { conversationForProcess } from './conversations'
import type { SessionActivity } from './types'

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
  label?: string
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
  const managed: SessionView[] = o.reconciled.map(r => {
    const harness = r.managed?.harness
    const activity = o.activity.get(r.id)
    return {
      id: r.id,
      ...(harness ? { harness } : {}),
      cwd: r.managed?.cwd ?? '',
      status: r.status,
      ...(activity ? { activity } : {}),
      ...((o.tails?.get(r.id)?.length ?? 0) > 0 ? { lastLines: o.tails!.get(r.id)! } : {}),
      ...(r.managed?.label ? { label: r.managed.label } : {}),
      ...(r.managed?.note ? { note: r.managed.note } : {}),
      ...(r.managed?.model ? { model: r.managed.model } : {}),
      ...(r.managed?.effort ? { effort: r.managed.effort } : {}),
      ...(r.managed?.task ? { task: r.managed.task } : {}),
      ...(r.backend ? { createdMs: r.backend.createdMs } : {}),
      attached: r.backend?.attached ?? false,
      approvalDetection: harness !== undefined && rulesFor(harness) !== undefined,
      searchText: searchTextOf(harness, r.managed?.cwd, r.managed?.label, r.managed?.note, r.managed?.task),
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
    // What this process appears to be driving. Offered, never acted on: the confirmation names the
    // conversation's own title, which is what lets the person judge whether it is the right one.
    const conv = conversationForProcess(conversations, {
      harness: p.harness,
      cwd: p.cwd,
      ...(p.sessionId ? { namedId: p.sessionId } : {}),
    })
    return {
      id: externalId(p),
      harness: p.harness,
      cwd: p.cwd,
      status: 'external' as const,
      ...(p.startedMs !== undefined ? { createdMs: p.startedMs } : {}),
      attached: false,
      approvalDetection: false,
      ...(conv?.resumable ? { resume: { sessionId: conv.sessionId, title: conv.title } } : {}),
      ...(conv?.tokens !== undefined ? { tokens: conv.tokens } : {}),
      ...(conv?.costUSD !== undefined ? { costUSD: conv.costUSD } : {}),
      searchText: searchTextOf(p.harness, p.cwd, conv?.title, conv?.firstPrompt),
    }
  })

  // Conversations that are not running at all — the ones you closed and want back. They are the
  // reason this screen can answer "what was I doing yesterday" as well as "what is running now".
  const running = new Set<string>()
  for (const v of external) if (v.resume) running.add(v.resume.sessionId)

  const closed: SessionView[] = conversations
    .filter(c => !running.has(c.sessionId))
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
