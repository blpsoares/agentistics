/**
 * sessions.ts — PURE arithmetic for the sessions screen: its row budget, its cells, its grouping
 * and its counter.
 *
 * Split out for the same reason `chrome.ts` and `surface.ts` are: a row that is one column too wide
 * wraps and shears every row under it, and a screen that draws more rows than its `height` is
 * COMPOSITED by Ink rather than clipped — both read as a corrupted frame rather than as a cramped
 * one, and neither is visible in a screenshot of a wide terminal.
 */

import type { ControlSession, SessionState } from './types'

// ---------------------------------------------------------------------------
// ordering
// ---------------------------------------------------------------------------

/** What is waiting on a person first, then what is running, then what is done, then what cannot be
 *  acted on at all. The same ranking the server-side view uses, restated here because the screen
 *  re-sorts within a group. */
const RANK: Record<SessionState, number> = {
  'waiting-approval': 0,
  waiting: 1,
  working: 2,
  exited: 3,
  lost: 4,
  unknown: 5,
}

export function sessionRank(s: ControlSession): number {
  return RANK[s.state]
}

export function sortSessions(list: readonly ControlSession[]): ControlSession[] {
  return [...list].sort((a, b) => {
    const byRank = sessionRank(a) - sessionRank(b)
    if (byRank !== 0) return byRank
    return (b.startedAt ?? 0) - (a.startedAt ?? 0)
  })
}

export function attentionOf(list: readonly ControlSession[]): number {
  return list.filter(s => s.state === 'waiting' || s.state === 'waiting-approval').length
}

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

export type SessionGrouping = 'none' | 'harness' | 'model' | 'project'

export const GROUPINGS: readonly SessionGrouping[] = ['none', 'harness', 'model', 'project'] as const

export interface SessionGroup {
  key: string
  /** Display-ready. An empty key is a fact that was never recorded, and says so in words. */
  label: string
  sessions: ControlSession[]
}

/**
 * Group the fleet along one dimension.
 *
 * `unknownLabels` are supplied by the caller because they are LOCALIZED chrome and this module owns
 * no strings — the same split the rest of the control center keeps. An empty key never shares one
 * blank heading across dimensions: "harness unknown" and "no model recorded" are different facts,
 * and a heading that reads as a category when it is really an absence is how a list starts lying.
 */
export function groupSessions(
  list: readonly ControlSession[],
  by: SessionGrouping,
  unknownLabels: { harness: string; model: string; project: string },
): SessionGroup[] {
  if (by === 'none') return [{ key: '', label: '', sessions: sortSessions(list) }]

  const groups = new Map<string, SessionGroup>()
  for (const s of list) {
    const key = by === 'harness' ? s.harness : by === 'model' ? (s.model ?? '') : s.project
    const label = key !== '' ? key : unknownLabels[by]
    const found = groups.get(key)
    if (found) found.sessions.push(s)
    else groups.set(key, { key, label, sessions: [s] })
  }

  // Groups ordered by their most urgent member, so the box holding a blocked session is the one at
  // the top — grouping must not bury the thing the screen exists to surface.
  return [...groups.values()]
    .map(g => ({ ...g, sessions: sortSessions(g.sessions) }))
    .sort((a, b) => {
      const byRank = sessionRank(a.sessions[0]!) - sessionRank(b.sessions[0]!)
      return byRank !== 0 ? byRank : a.label.localeCompare(b.label)
    })
}

/**
 * The groups flattened into the rows the screen actually draws, headings included.
 *
 * One list rather than nested loops because the CURSOR moves over it: with headings drawn separately
 * the selected index and the drawn rows are two different countings of one screen, and they agree
 * until the first group boundary.
 */
export type SessionRow =
  | { kind: 'heading'; label: string; count: number }
  | { kind: 'session'; session: ControlSession }

export function sessionRows(groups: readonly SessionGroup[]): SessionRow[] {
  const out: SessionRow[] = []
  for (const g of groups) {
    if (g.label !== '') out.push({ kind: 'heading', label: g.label, count: g.sessions.length })
    for (const session of g.sessions) out.push({ kind: 'session', session })
  }
  return out
}

/** Index of the nth selectable row, so the cursor never lands on a heading. */
export function selectableIndexes(rows: readonly SessionRow[]): number[] {
  const out: number[] = []
  rows.forEach((r, i) => { if (r.kind === 'session') out.push(i) })
  return out
}

// ---------------------------------------------------------------------------
// the row
// ---------------------------------------------------------------------------

export interface SessionCells {
  /** Always present — the state is the one cell nothing else on the screen repeats. */
  state: string
  /** Dropped first under width pressure. */
  title: string
  harness: string
  /** Dropped second. */
  where: string
}

const GAP = 2

/**
 * Fit one row to `width`, giving up cells in the order the screen can afford to lose them.
 *
 * The STATE word is the last thing standing, mirroring `serviceCells`: the harness is said again by
 * the row's colour and by the detail pane, the directory is said by the detail pane, but nothing
 * else on the frame says whether this session is waiting for you. A row reduced to a coloured glyph
 * announces the one thing that matters in colour alone, which is exactly what this model exists to
 * prevent.
 */
export function sessionCells(s: ControlSession, width: number): SessionCells {
  const state = s.stateLabel
  const full: SessionCells = { state, title: s.title, harness: s.harness, where: s.project }

  if (rowWidth(full) <= width) return full

  const noWhere: SessionCells = { ...full, where: '' }
  if (rowWidth(noWhere) <= width) return noWhere

  const noHarness: SessionCells = { ...noWhere, harness: '' }
  if (rowWidth(noHarness) <= width) return noHarness

  // The title is given up LAST among the droppable cells, and truncated rather than dropped whole
  // while any room remains: a row with no name is unusable, a row with a shortened one is not.
  const room = Math.max(0, width - state.length - GAP)
  return { state, harness: '', where: '', title: room > 0 ? truncateCell(s.title, room) : '' }
}

export function rowWidth(c: SessionCells): number {
  const parts = [c.state, c.title, c.harness, c.where].filter(p => p !== '')
  if (parts.length === 0) return 0
  return parts.reduce((n, p) => n + p.length, 0) + GAP * (parts.length - 1)
}

function truncateCell(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return text.slice(0, width)
  return text.slice(0, width - 1) + '…'
}

// ---------------------------------------------------------------------------
// the screen's budget
// ---------------------------------------------------------------------------

export interface SessionsLayout {
  /** Rows the list gets. At least one — a screen with no list is not a smaller screen. */
  list: number
  /** Rows the detail pane gets, or 0 when the screen is too short to earn one. */
  detail: number
  /** Whether the summary row above the list fits. */
  summary: boolean
}

// ---------------------------------------------------------------------------
// the detail pane's content
// ---------------------------------------------------------------------------

export interface DetailLine {
  key: string
  /** Empty for a full-width sentence rather than a labelled fact. */
  label: string
  value: string
  /** A caveat rather than a fact — rendered dim. */
  note?: boolean
}

/**
 * Everything the pane can say about one session, most identifying first.
 *
 * Pure and separate from the component because the LAYOUT needs the count before anything is drawn:
 * a detail pane sized to a constant leaves dead rows under it when it has less to say, and the
 * control center's own rule calls air under a pane a fault. Here the pane asks for exactly what it
 * has, and the list absorbs the difference — a list with room to grow is a list, not air.
 *
 * The labels arrive already localized, for the same reason `groupSessions` takes its headings: this
 * module owns no strings.
 */
export function detailLines(s: ControlSession, labels: {
  where: string
  model: string
  note: string
  started: string
  external: string
}, ago: (startedAt: number) => string): DetailLine[] {
  const out: DetailLine[] = []
  out.push({ key: 'where', label: labels.where, value: s.cwd })
  if (s.model) out.push({ key: 'model', label: labels.model, value: s.model })
  if (s.note) out.push({ key: 'note', label: labels.note, value: s.note })
  if (s.startedAt !== undefined) {
    out.push({ key: 'started', label: labels.started, value: ago(s.startedAt) })
  }
  // The two caveats, last and dim. Each is a statement the state word cannot make on its own, and
  // each is present only where it is TRUE — an absent caveat is not a reassurance, it is silence.
  if (!s.actionable) out.push({ key: 'external', label: '', value: labels.external, note: true })
  if (s.approvalBlind) out.push({ key: 'blind', label: '', value: s.approvalBlind, note: true })
  return out
}

/** The fewest rows a detail pane is worth: its divider plus something to say. */
const DETAIL_MIN = 4
/** The fewest list rows worth keeping before the detail pane is dropped entirely. */
const LIST_MIN = 4
const SUMMARY_ROWS = 1

/**
 * Split the screen between the list and the detail pane.
 *
 * `rowCount` is what stops this leaving air. The list is given what it can USE — five sessions never
 * need fourteen rows — and everything left over goes to the detail pane, which always has more to
 * say than it has room for. Budgeting the list at a fixed share instead left eight dead rows under a
 * three-row detail pane on an ordinary terminal, which the control center's own rule calls a fault:
 * air under a pane is a fault, air inside one is a pane.
 *
 * The list still wins a genuine shortage: when the two cannot both be served, the detail pane is
 * what goes, because the list is what the screen IS. And `Math.max(1, height - chrome)` is
 * deliberately not the shape of any of this — it hands out a row that does not exist.
 */
export function sessionsLayout(height: number, detailWanted = 0): SessionsLayout {
  if (height <= 2) return { list: Math.max(1, height), detail: 0, summary: false }

  const summary = height >= 6
  const available = height - (summary ? SUMMARY_ROWS : 0)

  // Nothing selected, or too short to hold both: the list takes everything.
  if (detailWanted <= 0 || available < LIST_MIN + DETAIL_MIN) {
    return { list: available, detail: 0, summary }
  }

  // The pane asks for its divider plus its lines, and is capped at half the screen — a session with
  // a long note must not push the list it was selected from off the screen. Everything else goes to
  // the list, which is a scrolling region and can hold empty rows honestly.
  const detail = Math.min(detailWanted + 1, Math.max(DETAIL_MIN, Math.floor(available / 2)))
  return { list: available - detail, detail, summary }
}
