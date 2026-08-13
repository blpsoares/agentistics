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
  closed: 6,
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

/**
 * The rows matching what was typed — the SAME predicate for every kind of row.
 *
 * One function rather than a filter per state: a search that quietly skipped closed conversations
 * would be a search that cannot find the thing it was most likely opened to find. `searchText` is
 * composed by the host and already carries a closed conversation's opening prompt.
 */
export function filterSessions(list: readonly ControlSession[], query: string): ControlSession[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...list]
  return list.filter(v => v.searchText.includes(q))
}

export function attentionOf(list: readonly ControlSession[]): number {
  return list.filter(s => s.state === 'waiting' || s.state === 'waiting-approval').length
}

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

export type SessionGrouping = 'none' | 'harness' | 'model' | 'project' | 'task'

export const GROUPINGS: readonly SessionGrouping[] = ['none', 'task', 'harness', 'model', 'project'] as const

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
  unknownLabels: { harness: string; model: string; project: string; task: string },
): SessionGroup[] {
  if (by === 'none') return [{ key: '', label: '', sessions: sortSessions(list) }]

  const groups = new Map<string, SessionGroup>()
  for (const s of list) {
    const key = by === 'harness' ? s.harness
      : by === 'model' ? (s.model ?? '')
      : by === 'task' ? (s.task ?? '')
      : s.project
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
  | { kind: 'heading'; label: string; count: number; muted?: boolean }
  /** A blank line between sections. Air INSIDE a list is what makes its sections readable. */
  | { kind: 'spacer' }
  | { kind: 'session'; session: ControlSession }

/**
 * Flatten the groups into the rows actually drawn — headings and the air between them included.
 *
 * Two things happen here that grouping alone does not give you:
 *
 *  - **History is always its own section.** A conversation that is CLOSED is not a session that is
 *    running, and putting the two in one undifferentiated run made the list read as if seven things
 *    were open when three of them had been over for a day. Even with grouping off, the closed rows
 *    get their own heading.
 *  - **A blank line before each heading.** The sections were distinguishable only by reading every
 *    row's first word, which is not a visual hierarchy — it is a list that happens to be sorted.
 *
 * One flat list rather than nested loops because the CURSOR moves over it: with headings drawn
 * separately, the selected index and the drawn rows are two different countings of one screen, and
 * they agree right up until the first group boundary.
 */
export function sessionRows(groups: readonly SessionGroup[], closedLabel?: string): SessionRow[] {
  const out: SessionRow[] = []

  const push = (label: string, sessions: readonly ControlSession[], muted?: boolean) => {
    if (sessions.length === 0) return
    if (out.length > 0) out.push({ kind: 'spacer' })
    if (label !== '') out.push({ kind: 'heading', label, count: sessions.length, ...(muted ? { muted } : {}) })
    for (const session of sessions) out.push({ kind: 'session', session })
  }

  for (const g of groups) {
    const live = g.sessions.filter(x => x.state !== 'closed')
    const closed = g.sessions.filter(x => x.state === 'closed')
    // An empty KEY is an absence ("no task"), not a category, and is drawn as one.
    push(g.label, live, g.key === '')
    if (closed.length > 0) {
      // Inside a named group the closed block still says which group it belongs to, so a heading
      // read on its own is never ambiguous.
      const label = closedLabel ?? ''
      push(g.label !== '' && label ? `${g.label} · ${label}` : label, closed, true)
    }
  }
  return out
}

/** Index of the nth selectable row, so the cursor never lands on a heading or a blank. */
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
  /** A line the assistant itself wrote, rendered in the text colour rather than as a label. */
  say?: boolean
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
  /** Said on a conversation that is not running — a different fact from "started elsewhere". */
  closed: string
  doing: string
  task: string
  metrics: string
}, ago: (startedAt: number) => string): DetailLine[] {
  const out: DetailLine[] = []

  // WHAT IT IS SAYING comes first, because it is the reason someone selected the row. Everything
  // below is context for it.
  if (s.lastLines?.length) {
    s.lastLines.forEach((line, i) => {
      out.push({ key: `say${i}`, label: i === 0 ? labels.doing : '', value: line, say: true })
    })
  }

  out.push({ key: 'where', label: labels.where, value: s.cwd })
  if (s.task) out.push({ key: 'task', label: labels.task, value: s.task })
  if (s.model) out.push({ key: 'model', label: labels.model, value: s.model })
  // Tokens and cost only where the conversation actually recorded them. Absent is never rendered as
  // zero — the same N/A-versus-a-confident-0 rule the dashboard applies to harness capabilities.
  if (s.tokens || s.cost) {
    out.push({
      key: 'metrics',
      label: labels.metrics,
      value: [s.tokens, s.cost].filter(Boolean).join('  ·  '),
    })
  }
  if (s.note) out.push({ key: 'note', label: labels.note, value: s.note })
  if (s.startedAt !== undefined) {
    out.push({ key: 'started', label: labels.started, value: ago(s.startedAt) })
  }
  // The two caveats, last and dim. Each is a statement the state word cannot make on its own, and
  // each is present only where it is TRUE — an absent caveat is not a reassurance, it is silence.
  // The two non-actionable rows are non-actionable for DIFFERENT reasons, and one sentence for both
  // said "started outside agentop" about a conversation that agentop may well have started and that
  // is simply over.
  if (s.state === 'closed') out.push({ key: 'closed', label: '', value: labels.closed, note: true })
  else if (!s.actionable) out.push({ key: 'external', label: '', value: labels.external, note: true })
  if (s.approvalBlind) out.push({ key: 'blind', label: '', value: s.approvalBlind, note: true })
  return out
}

/**
 * The rows a QUESTION needs, floor.
 *
 * A confirmation is a wrapped sentence, a blank and two answers; anything less hides one of the
 * answers, which is worse than not asking — the user is looking at a destructive verb with only the
 * word "Yes" on screen. The cockpit reserves its own `QUESTION_ROWS` for exactly this reason.
 */
export const QUESTION_ROWS = 5

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

// ---------------------------------------------------------------------------
// the visible action row
// ---------------------------------------------------------------------------

/** What a verb DOES, independent of what it is called in either language. */
export type SessionAction =
  | 'attach' | 'resume' | 'rename' | 'note' | 'task' | 'kill' | 'openTask' | 'new' | 'search' | 'group'

/**
 * The verbs offered for the selected row — PURE, and the single answer both the drawn row and a
 * click on it resolve against.
 *
 * Composed rather than fixed, on the same rule the services cockpit follows: a verb that cannot work
 * on this row is ABSENT, never present and refusing. A closed conversation has nothing to attach to;
 * one running outside agentop has nothing to rename; a row whose harness cannot reopen by id gets no
 * reopen at all.
 */
export function sessionActions(selected: ControlSession | undefined): SessionAction[] {
  const out: SessionAction[] = ['new', 'search', 'group']
  if (!selected) return out

  const managed = selected.state !== 'unknown' && selected.state !== 'closed'
  if (managed) out.unshift('attach')
  else if (selected.resume) out.unshift('resume')

  if (managed) {
    out.push('rename', 'note', 'task', 'kill')
    if (selected.task) out.push('openTask')
  }
  return out
}

/** The already-localized labels for those verbs, in the order they are offered. */
export function actionLabels(
  actions: readonly SessionAction[],
  words: Record<SessionAction, string>,
): string[] {
  return actions.map(a => words[a])
}

/**
 * The summary row's two halves, fitted to `width` — PURE.
 *
 * It has to be MEASURED, not merely truncated. A row wider than the terminal wraps, and a wrapped
 * row takes two of the screen's rows while its budget counted one — which pushes the action row,
 * the detail pane and the footer off the bottom. "Everything below the list vanished" is what that
 * looks like, and nothing about it says the cause was one row too wide.
 *
 * Cells are given up in the order the row can afford to lose them: the list of what is being HIDDEN
 * first (the panel one keypress away states it in full), then the waiting count, then the total.
 * The grouping is last because it is the only cell that explains why the rows are arranged as they
 * are, and it is truncated rather than dropped.
 */
export function summaryCells(o: {
  group: string
  hiding: string
  count: string
  waiting: string
  width: number
}): { group: string; hiding: string; count: string; waiting: string } {
  const GAP = 3
  const width = Math.max(0, o.width)
  const fits = (parts: string[]) => {
    const kept = parts.filter(p => p !== '')
    return kept.reduce((n, p) => n + p.length, 0) + GAP * Math.max(0, kept.length - 1) <= width
  }

  const full = { group: o.group, hiding: o.hiding, count: o.count, waiting: o.waiting }
  if (fits([full.group, full.hiding, full.count, full.waiting])) return full

  const noHiding = { ...full, hiding: '' }
  if (fits([noHiding.group, noHiding.count, noHiding.waiting])) return noHiding

  const noWaiting = { ...noHiding, waiting: '' }
  if (fits([noWaiting.group, noWaiting.count])) return noWaiting

  const groupOnly = { group: o.group, hiding: '', count: '', waiting: '' }
  if (fits([groupOnly.group])) return groupOnly

  return { ...groupOnly, group: o.group.slice(0, Math.max(0, width)) }
}
