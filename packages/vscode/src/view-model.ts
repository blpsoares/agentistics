/**
 * view-model.ts — PURE. The fleet, arranged for a panel that is often 300px wide.
 *
 * It owns the ARRANGEMENT and nothing else. What is most urgent is `sessionRank` and what counts as
 * running is `sessionRunning`, both imported from the control center rather than restated here — a
 * ranking copied into an editor client would be a third answer to "which of these needs me first",
 * after the cockpit's and the browser's, and the three would drift apart one state at a time.
 *
 * The default arrangement is the cockpit's: **grouped by project, most urgent first**. The cascade
 * (the directory tree inside each band) is deliberately absent — it is measured against
 * `ControlSession.projectRoot`, which is not on the wire, and a tree derived here by
 * string-matching the project NAME against each `cwd` goes wrong wherever a path segment repeats.
 * A band per project plus the shortened directory is the honest subset.
 */

import { sessionRunning } from '@agentistics/tui/control/session-dimensions'
import { sessionRank } from '@agentistics/tui/control/session-order'
import type { FleetRow } from './protocol'

export interface SessionGroup {
  /** The project, as the SERVER resolved it (`repo-facts.ts`) — never re-derived from the path. */
  project: string
  rows: FleetRow[]
}

export interface ViewOptions {
  query: string
  onlyActive: boolean
}

/**
 * Why the list is empty — three different facts, and the screen must say the right one.
 *
 * Blaming the filter while a search removed the rows sends someone to the wrong switch, and blaming
 * a search while nothing is running at all hides that the filter is on. The same distinction
 * `emptyReason` draws for `agentop session ls`.
 */
export type EmptyReason = 'none' | 'filtered' | 'onlyActive' | null

export interface FleetView {
  groups: SessionGroup[]
  /** How many rows survived the filters — the count the header prints. */
  shown: number
  /** How many rows exist at all, so "6 of 40" can be said. */
  total: number
  empty: EmptyReason
}

/** Everything about a row a search may look inside. Composed once so the predicate is one line. */
function haystack(row: FleetRow): string {
  return [row.title, row.project, row.cwd, row.harness, row.task, row.note, row.model]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function matches(row: FleetRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  // Every term, in any order — a two-word search that only matched them adjacent would fail on the
  // fields being separate values rather than a sentence.
  return q.split(/\s+/).every(term => haystack(row).includes(term))
}

/**
 * Arrange the fleet.
 *
 * Groups are ordered by their MOST URGENT member, not alphabetically: the point of the screen is
 * that what is blocked on you is at the top, and a band sorted by name buries it under whatever
 * project starts with an `a`. Ties fall back to the project name so the order is stable between
 * polls — a list that reshuffles every five seconds cannot be clicked.
 */
export function buildView(rows: readonly FleetRow[], opts: ViewOptions): FleetView {
  const active = opts.onlyActive ? rows.filter(sessionRunning) : [...rows]
  const kept = active.filter(r => matches(r, opts.query))

  const byProject = new Map<string, FleetRow[]>()
  for (const row of kept) {
    const key = row.project || ''
    const bucket = byProject.get(key)
    if (bucket) bucket.push(row)
    else byProject.set(key, [row])
  }

  const groups: SessionGroup[] = [...byProject.entries()]
    .map(([project, list]) => ({
      project,
      rows: [...list].sort((a, b) => sessionRank(a) - sessionRank(b) || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => {
      const rankA = Math.min(...a.rows.map(sessionRank))
      const rankB = Math.min(...b.rows.map(sessionRank))
      return rankA - rankB || a.project.localeCompare(b.project)
    })

  return {
    groups,
    shown: kept.length,
    total: rows.length,
    empty: emptyReason(rows.length, active.length, kept.length, opts),
  }
}

/**
 * Which sentence the empty state gets.
 *
 * Order matters: a SEARCH that removed the rows is blamed before the filter that also would have,
 * because it is the thing the user just typed and the thing they can undo with one keystroke.
 */
function emptyReason(total: number, afterActive: number, shown: number, opts: ViewOptions): EmptyReason {
  if (shown > 0) return null
  if (total === 0) return 'none'
  if (opts.query.trim() && afterActive > 0) return 'filtered'
  if (opts.onlyActive) return 'onlyActive'
  return 'filtered'
}
