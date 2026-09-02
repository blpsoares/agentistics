/**
 * fleetFilter.ts — PURE. Applying the dashboard's global filters to the LIVE fleet.
 *
 * The filters were built to scope METRICS — a date range, a set of projects, a set of models. A
 * fleet is not metrics: it is what is running now. So only the dimensions that mean something about
 * a live session are applied, and the rest are ignored ON PURPOSE:
 *
 * - `dateRange` / `customStart` / `customEnd` — a live session is happening now, and "last 7 days"
 *   would silently hide a session that started eight days ago and is still working.
 * - `users` / `teams` / `machines` / `presence` — every row here is on THIS machine by definition;
 *   the fleet route is refused on a central.
 * - `tags` — a tag resolves to a set of stored sessions server-side, and a live row is not in that
 *   set until its metrics are written.
 *
 * What IS applied: harness, project, repository, model — each a fact the row carries itself.
 *
 * `activeOnly` is the fleet's OWN dimension and lives here rather than in `Filters`, because the
 * dashboard has no use for it: it is a statement about what a session is doing right now.
 *
 * `withheld` is returned alongside, because a filter that narrows silently is one people conclude
 * is broken when the list looks short — and on this surface a hidden row can be a session waiting
 * for a person.
 */

import type { Filters } from '@agentistics/core'
import { ACTIVE_STATES, type ControlSession } from '@agentistics/tui/control/session-fleet'

const ACTIVE = new Set<string>(ACTIVE_STATES)

export interface FleetFilterResult {
  rows: ControlSession[]
  /** How many rows the filters removed, so the surface can say what lifting them would show. */
  withheld: number
  /** True when any filter is doing something — the switch that says "you are not seeing all of it". */
  narrowed: boolean
}

export interface FleetFilterInput {
  rows: readonly ControlSession[]
  filters: Filters
  /** Keep only what is running. The fleet's own dimension; see the header. */
  activeOnly: boolean
}

export function filterFleet({ rows, filters, activeOnly }: FleetFilterInput): FleetFilterResult {
  const harnesses = new Set<string>(filters.harnesses ?? (filters.harness ? [filters.harness] : []))
  const projects = new Set(filters.projects ?? [])
  const repos = new Set(filters.repos ?? [])
  const models = new Set(filters.models ?? [])

  const kept = rows.filter(r => {
    if (activeOnly && !ACTIVE.has(r.state)) return false
    if (harnesses.size > 0 && !harnesses.has(r.harness)) return false
    // The project filter names PATHS; a row carries its own project name and its group. Matched
    // against both, because the dashboard's chips are built from stored session paths while the
    // fleet's rows are named by the directory they were spawned in.
    if (projects.size > 0 && !matchesProject(r, projects)) return false
    if (repos.size > 0 && !(r.repo !== undefined && repos.has(r.repo))) return false
    // A row with no model recorded is not "some other model" — it is unknown, and a model filter
    // cannot say anything about it either way, so it is withheld like any non-match.
    if (models.size > 0 && !(r.model !== undefined && models.has(r.model))) return false
    return true
  })

  return {
    rows: kept,
    withheld: rows.length - kept.length,
    narrowed: activeOnly || harnesses.size > 0 || projects.size > 0 || repos.size > 0 || models.size > 0,
  }
}

/** A row matches a project filter by its own name, its group, or the tail of its path. */
function matchesProject(r: ControlSession, projects: ReadonlySet<string>): boolean {
  if (r.project !== '' && projects.has(r.project)) return true
  if (r.projectGroup !== undefined && projects.has(r.projectGroup)) return true
  // The dashboard's chips are full paths; a row's `cwd` is one. Exact, never a prefix — a prefix
  // test would let a filter on `$HOME` match every session on the machine.
  if (projects.has(r.cwd)) return true
  return false
}
