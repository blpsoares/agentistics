/**
 * fleetGrouping.ts — PURE: how the web Sessions list is banded, and in whose words.
 *
 * The arrangement itself is NOT implemented here. `groupSessions` in
 * `@agentistics/tui/control/session-fleet` is the one implementation of what a band is, which
 * dimension a row falls under, and how bands are ordered — the very module the terminal cockpit
 * uses. A second grouping written for the browser would be a second set of rules for one fact, and
 * `session-dimensions.test.ts` cross-checks that filtering to a bucket returns exactly the rows
 * that bucket's band contains; a browser copy would sit outside that check.
 *
 * What lives here is the part `session-fleet.ts` deliberately does not own: the WORDS. That module
 * holds no strings, so every caller supplies its own book — which is also what lets the band and
 * the chip that selects it read the same name.
 *
 * One arrangement is ours rather than the cockpit's: `active`, the two-band Active/Inactive split
 * this page has shipped with. It is NOT the `status` dimension — that one bands by exact state
 * (working, waiting, waiting-approval, exited, lost…), which is a finer question than "what is
 * running and what is not". Keeping both means the default the page already had survives the
 * arrival of the picker instead of being silently replaced by its nearest relative.
 */

import {
  DIMENSION_ORDER, GONE_PROJECT_KEY, dimensionWordBook,
  type DimensionWordBook, type SessionDimensionId,
  // Through `session-fleet`, which already re-exports the dimension module for exactly this reason
  // — it is the door the rest of the control center comes in by, and the package's export map has
  // no entry for the inner file.
} from '@agentistics/tui/control/session-fleet'

/** `active` is this page's own two-band split; the rest are the cockpit's dimensions. */
export type FleetGrouping = 'active' | SessionDimensionId

/** The picker's order. `active` leads because it is the default and the cheapest to read. */
export const FLEET_GROUPINGS: readonly FleetGrouping[] = ['active', ...DIMENSION_ORDER] as const

export function isFleetGrouping(v: unknown): v is FleetGrouping {
  return typeof v === 'string' && (FLEET_GROUPINGS as readonly string[]).includes(v)
}

const LABELS: Record<FleetGrouping, { en: string; pt: string }> = {
  active: { en: 'Running', pt: 'Em andamento' },
  day: { en: 'Day', pt: 'Dia' },
  status: { en: 'Status', pt: 'Estado' },
  repo: { en: 'Repository', pt: 'Repositório' },
  project: { en: 'Project', pt: 'Projeto' },
  task: { en: 'Task', pt: 'Tarefa' },
  harness: { en: 'Assistant', pt: 'Assistente' },
  model: { en: 'Model', pt: 'Modelo' },
  marked: { en: 'Pinned', pt: 'Fixadas' },
}

export function groupingLabel(id: FleetGrouping, lang: 'en' | 'pt'): string {
  return LABELS[id]?.[lang] ?? id
}

/**
 * Every dimension's "no value" band, in words.
 *
 * Each one is a DIFFERENT fact and gets a different sentence: a session with no model recorded and
 * a session whose harness could not be identified are not the same absence, and one blank heading
 * shared between them is how a list starts reading as a category that does not exist.
 */
const UNFILED: Record<SessionDimensionId, { en: string; pt: string }> = {
  day: { en: 'No date recorded', pt: 'Sem data registrada' },
  status: { en: 'Status unknown', pt: 'Estado desconhecido' },
  harness: { en: 'Assistant unknown', pt: 'Assistente desconhecido' },
  model: { en: 'No model recorded', pt: 'Sem modelo registrado' },
  project: { en: 'Outside a project', pt: 'Fora de um projeto' },
  repo: { en: 'No repository', pt: 'Sem repositório' },
  task: { en: 'No task', pt: 'Sem tarefa' },
  marked: { en: 'Not pinned', pt: 'Não fixadas' },
}

/** The state words. Keys ARE states — the status dimension buckets on them directly. */
const STATES: Record<string, { en: string; pt: string }> = {
  working: { en: 'working', pt: 'trabalhando' },
  waiting: { en: 'needs you', pt: 'precisa de você' },
  'waiting-approval': { en: 'needs approval', pt: 'precisa aprovar' },
  exited: { en: 'finished', pt: 'encerrada' },
  lost: { en: 'lost', pt: 'perdida' },
  closed: { en: 'closed', pt: 'fechada' },
  unknown: { en: 'external', pt: 'externa' },
}

/**
 * The book `groupSessions` reads, for one language.
 *
 * `days` is deliberately NOT supplied: naming "today" needs a clock this module does not read, and
 * an unnamed day falls back to its own `YYYY-MM-DD` key — already a date a person can read. A
 * degraded heading beats a wrong one.
 */
export function fleetWordBook(lang: 'en' | 'pt'): DimensionWordBook {
  const pick = (r: Record<string, { en: string; pt: string }>): Record<string, string> =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v[lang]]))
  const byDimension = (r: Record<SessionDimensionId, { en: string; pt: string }>) =>
    Object.fromEntries(DIMENSION_ORDER.map(id => [id, r[id][lang]])) as Record<SessionDimensionId, string>
  return dimensionWordBook({
    labels: byDimension(LABELS as Record<SessionDimensionId, { en: string; pt: string }>),
    unfiled: byDimension(UNFILED),
    states: pick(STATES),
    goneProject: lang === 'pt' ? 'Pasta removida' : 'Folder gone',
    marked: lang === 'pt' ? 'Fixadas' : 'Pinned',
  })
}

export { GONE_PROJECT_KEY }

// ---------------------------------------------------------------------------
// Persistence — a per-viewer view preference, and nothing more
// ---------------------------------------------------------------------------

const KEY = 'agentistics-fleet-grouping-v1'

/**
 * PURE: what a stored value means. VALIDATED, never cast — a stored id from a build that offered a
 * grouping this one does not (`tree`, say) would otherwise reach `groupSessions` as an unknown
 * dimension. Anything unrecognised falls back to the default rather than being repaired: there is
 * nothing to repair it from, and the default is a complete answer.
 *
 * Separated from the read below so the decision is testable without a browser — `localStorage` does
 * not exist in the test runner, and a rule that can only be exercised by opening a page is a rule
 * nothing checks.
 */
export function parseGrouping(raw: string | null | undefined): FleetGrouping {
  return isFleetGrouping(raw) ? raw : 'active'
}

/** The stored arrangement, or the default when storage is unavailable (a private window, site data
 *  blocked) — which is a complete answer, not a degraded one. */
export function readGrouping(): FleetGrouping {
  try {
    return parseGrouping(localStorage.getItem(KEY))
  } catch {
    return 'active'
  }
}

export function writeGrouping(id: FleetGrouping): void {
  try { localStorage.setItem(KEY, id) } catch { /* storage disabled — the choice lasts this session */ }
}
