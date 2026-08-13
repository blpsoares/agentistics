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
  /** `external` is the whole of "this row cannot be acted on". There is deliberately no second
   *  `managed` boolean saying the same thing, which could then disagree with it. */
  status: ReconciledSession['status'] | 'external'
  /** ABSENT for an external session — not capturable, so not knowable. */
  activity?: SessionActivity
  label?: string
  note?: string
  model?: string
  effort?: string
  createdMs?: number
  attached: boolean
  /**
   * Whether this harness has probed approval rules at all.
   *
   * False means a session blocked on a permission prompt reads as plain `waiting` — still counted,
   * still surfaced, but the reason cannot be shown. The UI says so; this flag is where it learns it.
   */
  approvalDetection: boolean
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

export function buildSessionViews(o: {
  reconciled: readonly ReconciledSession[]
  activity: ReadonlyMap<string, SessionActivity>
  processes: readonly HarnessProcess[]
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
      ...(r.managed?.label ? { label: r.managed.label } : {}),
      ...(r.managed?.note ? { note: r.managed.note } : {}),
      ...(r.managed?.model ? { model: r.managed.model } : {}),
      ...(r.managed?.effort ? { effort: r.managed.effort } : {}),
      ...(r.backend ? { createdMs: r.backend.createdMs } : {}),
      attached: r.backend?.attached ?? false,
      approvalDetection: harness !== undefined && rulesFor(harness) !== undefined,
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

  const external: SessionView[] = o.processes.filter(p => !covered(p)).map(p => ({
    id: externalId(p),
    harness: p.harness,
    cwd: p.cwd,
    status: 'external' as const,
    ...(p.startedMs !== undefined ? { createdMs: p.startedMs } : {}),
    attached: false,
    approvalDetection: false,
  }))

  return [...managed, ...external].sort((a, b) => {
    const byRank = rankOf(a) - rankOf(b)
    if (byRank !== 0) return byRank
    return (b.createdMs ?? 0) - (a.createdMs ?? 0)
  })
}

export function attentionCount(views: readonly SessionView[]): number {
  return views.filter(v => needsAttention(v.activity)).length
}

export type SessionGrouping = 'harness' | 'model' | 'project' | 'none'

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
      : projectName(v.cwd)
    // An empty key means the fact was never recorded. Each dimension says so in its own words
    // rather than sharing one blank heading that reads as a category.
    const label = key !== '' ? key
      : by === 'harness' ? 'harness unknown'
      : by === 'model' ? 'no model recorded'
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
