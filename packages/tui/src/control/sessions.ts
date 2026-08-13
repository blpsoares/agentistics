/**
 * sessions.ts — PURE arithmetic for the sessions screen: its row budget, its cells, its grouping
 * and its counter.
 *
 * Split out for the same reason `chrome.ts` and `surface.ts` are: a row that is one column too wide
 * wraps and shears every row under it, and a screen that draws more rows than its `height` is
 * COMPOSITED by Ink rather than clipped — both read as a corrupted frame rather than as a cramped
 * one, and neither is visible in a screenshot of a wide terminal.
 */

import { PANE_FRAME_Y } from './chrome.ts'
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
  /** A TASK the user has marked finished. Only ever set while grouping by task. */
  done?: boolean
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
  /** The tasks the user marked finished — a statement about the WORK, not about any session. */
  doneTasks: readonly string[] = [],
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
    else {
      const done = by === 'task' && key !== '' && doneTasks.includes(key)
      groups.set(key, { key, label, sessions: [s], ...(done ? { done: true } : {}) })
    }
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
export function sessionRows(
  groups: readonly SessionGroup[],
  closedLabel?: string,
  /** Already-localized word marking a finished task's heading, e.g. "finished". */
  doneLabel?: string,
): SessionRow[] {
  const out: SessionRow[] = []

  const push = (label: string, sessions: readonly ControlSession[], muted?: boolean) => {
    if (sessions.length === 0) return
    if (out.length > 0) out.push({ kind: 'spacer' })
    if (label !== '') out.push({ kind: 'heading', label, count: sessions.length, ...(muted ? { muted } : {}) })
    for (const session of sessions) out.push({ kind: 'session', session })
  }

  // "Live" is a stricter question than "not closed": a session whose command has EXITED is not
  // running either, and leaving it among the working ones is what made a finished session sit in
  // the live list looking like something you could still talk to. `lost` joins it — the backend has
  // no idea what happened to it, so it is certainly not something you are working in.
  const isLive = (s: ControlSession) =>
    s.state !== 'closed' && s.state !== 'exited' && s.state !== 'lost'

  for (const g of groups) {
    const live = g.sessions.filter(isLive)
    const closed = g.sessions.filter(s => !isLive(s))
    // An empty KEY is an absence ("no task"), not a category, and is drawn as one. A FINISHED task
    // says so in its heading and is muted with it: the sessions are still listed and still
    // attachable, so the screen must say why they are set apart rather than merely dimming them.
    const head = g.done && doneLabel ? `${g.label} · ${doneLabel}` : g.label
    push(head, live, g.key === '' || Boolean(g.done))
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
  /**
   * How to LEAVE an attached session, already localized, and the real keystroke the backend
   * reported — never an assumed `Ctrl-b`.
   *
   * Said HERE, on the row you would attach to, because it used to be printed once as the terminal
   * was handed over and then scrolled away under whatever the session drew next. A user who cannot
   * get out is stranded in a buffer that hides their shell, and "read it before you press enter" is
   * not a thing anyone does.
   */
  detach?: { label: string; keys: string }
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
  // Only where attaching is actually offered: on a closed or external row it would answer a
  // question the screen is not letting anyone ask.
  if (labels.detach && s.actionable && s.state !== 'closed') {
    out.push({ key: 'detach', label: labels.detach.label, value: labels.detach.keys })
  }
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


// ---------------------------------------------------------------------------
// the visible action row
// ---------------------------------------------------------------------------

/** What a verb DOES, independent of what it is called in either language. */
export type SessionAction =
  | 'attach' | 'resume' | 'rename' | 'note' | 'task' | 'kill' | 'openTask' | 'finishTask'
  | 'new' | 'search' | 'group'

/**
 * The verbs offered for the selected row — PURE, and the single answer both the drawn row and a
 * click on it resolve against.
 *
 * Composed rather than fixed, on the same rule the services cockpit follows: a verb that cannot work
 * on this row is ABSENT, never present and refusing. A closed conversation has nothing to attach to;
 * one running outside agentop has nothing to rename; a row whose harness cannot reopen by id gets no
 * reopen at all.
 */
export interface OfferedAction {
  action: SessionAction
  /** False when this row cannot take it. Drawn DIM and skipped by the cursor — never selectable. */
  enabled: boolean
}

/**
 * The verbs, ALWAYS all of them, each marked with whether this row can take it.
 *
 * The rule everywhere else in this control center is that a verb which cannot work is absent. Here
 * that was wrong, and it took watching someone use it to see why: with a fleet of sessions agentop
 * did not start, the row shrank from nine verbs to four, and the honest reading of a menu that lost
 * five items is that the feature broke. Absence communicates nothing about WHY.
 *
 * So the shape stays constant and the unavailable verbs are dimmed. Nothing failing is ever offered
 * — the cursor skips them and a click does nothing — but the screen no longer implies that renaming
 * a session stopped existing because the one you selected cannot be renamed.
 */
export function sessionActions(selected: ControlSession | undefined): OfferedAction[] {
  const hosted = selected !== undefined
    && selected.state !== 'unknown'
    && selected.state !== 'closed'
  const canReopen = Boolean(selected?.resume)
  const hasTask = Boolean(selected?.task)

  return [
    // The row-specific verb comes first, and which one it is depends on what the row IS: a session
    // we host is attached to, one we do not is reopened. They are never both live.
    ...(hosted
      ? [{ action: 'attach' as const, enabled: true }]
      : [{ action: 'resume' as const, enabled: canReopen }]),
    { action: 'rename', enabled: hosted },
    { action: 'note', enabled: hosted },
    { action: 'task', enabled: hosted },
    { action: 'openTask', enabled: hosted && hasTask },
    // Finishing needs only a TASK, not a live session: the ordinary moment to close a piece of work
    // is when its last session has already ended, and requiring a hosted row would make the verb
    // unreachable at exactly that moment.
    { action: 'finishTask', enabled: hasTask },
    { action: 'kill', enabled: hosted },
    // These three need no selection at all and are therefore never dim.
    { action: 'new', enabled: true },
    { action: 'search', enabled: true },
    { action: 'group', enabled: true },
  ]
}

/** The already-localized labels for those verbs, in the order they are offered. */
export function actionLabels(
  actions: readonly OfferedAction[],
  words: Record<SessionAction, string>,
): string[] {
  return actions.map(a => words[a.action])
}

/** Index of the nth ENABLED verb, so the cursor never lands on one that cannot run. */
export function enabledActionIndexes(actions: readonly OfferedAction[]): number[] {
  const out: number[] = []
  actions.forEach((a, i) => { if (a.enabled) out.push(i) })
  return out
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

// ---------------------------------------------------------------------------
// column alignment
// ---------------------------------------------------------------------------

export interface SessionColumns {
  state: number
  title: number
  /**
   * The task the session is filed under.
   *
   * `0` when nothing on screen carries one, and `0` while GROUPING BY TASK — there the heading over
   * the row already says it, and repeating it on every row under that heading is a column of the
   * same word. Everywhere else it must be on the row: filing a session under a task and then not
   * being able to see which task it is in is the feature not working.
   */
  task: number
  /** Tokens + cost. `0` when nothing on screen has any — never a column of blanks. */
  metrics: number
  harness: number
  where: number
}

/**
 * Tokens and cost as ONE cell — PURE, and EMPTY when the conversation recorded neither.
 *
 * Empty rather than a zero, for the same reason the detail pane omits the line: a harness that
 * cannot report usage would otherwise show every one of its sessions costing nothing, which is a
 * confident wrong number in the place a person looks to decide what to close.
 */
export function sessionMetric(s: ControlSession): string {
  return [s.tokens, s.cost].filter(Boolean).join(' ')
}

/**
 * The column widths for a screenful of rows — PURE.
 *
 * Computed ACROSS the visible rows rather than per row, which is the whole point: the state words
 * have very different lengths ("needs approval" against "waiting"), so a row that merely separates
 * its cells with two spaces starts every title at a different column and every harness after that.
 * The result reads as a jumble of words rather than as a list of sessions.
 *
 * Widths come from what is on screen, not from the whole fleet: a single long title thirty rows
 * down must not narrow every visible row to pay for something nobody can see.
 *
 * The give-up order is unchanged — the directory goes first, then the harness, then the title is
 * squeezed — because the STATE is the one cell nothing else on the frame repeats.
 */
export function sessionColumns(
  rows: readonly ControlSession[],
  width: number,
  /** True while the HEADING above each row already names the task, so the cell would repeat it. */
  groupedByTask = false,
): SessionColumns {
  const widest = (pick: (s: ControlSession) => string) =>
    rows.reduce((n, s) => Math.max(n, pick(s).length), 0)

  const state = widest(s => s.stateLabel)
  const task = groupedByTask ? 0 : widest(s => s.task ?? '')
  const metrics = widest(sessionMetric)
  const harness = widest(s => s.harness)
  const where = widest(s => s.project)
  const title = widest(s => s.title)

  /**
   * Columns everything BUT the title costs: two for the cursor, the cells, and a gap between each
   * pair of cells that is actually drawn.
   *
   * Counted from the cells rather than from a constant because a cell can be ZERO — a fleet where
   * no session reports usage draws no metrics column, and paying its gap anyway would narrow every
   * title on the screen to reserve a space nothing occupies.
   */
  const overhead = (k: number, m: number, h: number, w: number) => {
    const drawn = [state, 1, k, m, h, w].filter(n => n > 0).length
    return 2 + state + k + m + h + w + GAP * (drawn - 1)
  }

  // The fewest columns a title is worth. Below it the row has a state word and an ellipsis, which
  // names nothing — so the screen gives up a whole cell instead.
  const MIN_TITLE = 8

  // The give-up order, least important first: the directory, then the harness, then the usage. The
  // STATE and the NAME are what a row cannot lose — the state because nothing else on the frame
  // says whether this session is waiting for you, the name because a row you cannot identify is not
  // a row you can act on.
  const ladder: Array<[number, number, number, number]> = [
    [task, metrics, harness, where],
    [task, metrics, harness, 0],
    [task, metrics, 0, 0],
    [task, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  for (const [k, m, h, w] of ladder) {
    const room = width - overhead(k, m, h, w)
    // The title takes what it NEEDS, not what is left: stretching it to the full remainder pushed
    // the trailing cells to the far edge with a field of blank between, which is the old
    // misalignment wearing a different shape.
    if (room >= MIN_TITLE || (k === 0 && m === 0 && h === 0 && w === 0)) {
      return {
        state, title: Math.max(1, Math.min(title, room)), task: k, metrics: m, harness: h, where: w,
      }
    }
  }
  /* c8 ignore next */
  return { state, title: 1, task: 0, metrics: 0, harness: 0, where: 0 }
}

/** Pad or truncate a cell to exactly `w` columns. `0` means the column is not drawn. */
export function padCell(text: string, w: number): string {
  if (w <= 0) return ''
  return text.length >= w ? truncateCell(text, w) : text + ' '.repeat(w - text.length)
}

// ---------------------------------------------------------------------------
// the cockpit: an aside menu beside the list, over a detail pane
// ---------------------------------------------------------------------------

export interface CockpitLayout {
  /** Columns the aside menu takes. `0` when the terminal is too narrow to carry one. */
  aside: number
  /** Columns the list takes — everything the aside leaves, minus the gap between them. */
  list: number
  /** Rows the list band gets, FRAME INCLUDED — every region here is a framed pane. */
  band: number
  /** Rows the detail pane gets under it, or 0 when the screen cannot pay for one. */
  detail: number
  /** Whether the summary row above the sessions fits INSIDE the list pane. */
  summary: boolean
  /** Rows for session rows inside the list pane, frame and summary already paid for. */
  listRows: number
}

/** The aside's natural width: wide enough for its longest label, within bounds. */
const ASIDE_MIN = 14
const ASIDE_MAX = 26
/** Below this the screen is all list — an aside that squeezes the sessions to nothing helps nobody. */
const ASIDE_NEEDS = 52
/** The fewest rows a detail pane is worth: a divider plus something to say. */
const COCKPIT_DETAIL_MIN = 4

/**
 * Split the screen into an aside menu, the list beside it, and a detail pane under both.
 *
 * The aside exists because everything on this screen used to be a letter: the grouping cycled on a
 * hidden `v`, the visibility switches were a corner label, and the verbs only appeared once you
 * knew `tab` reached them. A menu you can see and click is not a nicety here, it is the difference
 * between a screen you can use and one you have to be taught.
 *
 * It is DROPPED on a narrow terminal rather than squeezed: at 40 columns an aside leaves nothing for
 * the sessions, and the sessions are what the screen is. The letters keep working, so a narrow
 * terminal loses the menu and not the feature.
 *
 * The detail pane is reserved BEFORE the band on a short screen, the same rule the services cockpit
 * follows — it is where a question is asked, and a prompt with nowhere to draw cannot be answered.
 */
export function sessionsCockpit(o: {
  width: number
  height: number
  /** The widest label the aside must carry, so it is measured rather than guessed at. */
  asideLabel: number
  /** Rows the detail pane is asking for, `0` when there is nothing selected to describe. */
  detailWanted: number
}): CockpitLayout {
  const width = Math.max(1, o.width)
  const height = Math.max(1, o.height)

  const aside = width >= ASIDE_NEEDS
    ? Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, o.asideLabel + 2))
    : 0
  // One column of divider between the two panes, and only when there are two.
  const list = Math.max(1, width - (aside > 0 ? aside + 1 : 0))

  // Every region is a FRAMED pane now, so the frame is part of the arithmetic rather than something
  // the component pays for out of rows this function already handed to content. A screen whose
  // budget and whose frames are decided in two places is one where they disagree by two rows, and
  // Ink composites the overflow rather than clipping it — which reads as a corrupted frame.
  const finish = (band: number, detail: number): CockpitLayout => {
    const inner = Math.max(0, band - PANE_FRAME_Y)
    // The summary is the first thing given up: it describes the list, and a list with no rows left
    // has nothing to describe.
    const summary = inner >= 4
    return { aside, list, band, detail, summary, listRows: Math.max(1, inner - (summary ? 1 : 0)) }
  }

  if (height <= COCKPIT_DETAIL_MIN + 2 || o.detailWanted <= 0) return finish(height, 0)
  // `+ PANE_FRAME_Y`: what the pane asks for is its LINES, and the frame around them is this
  // function's to pay.
  const detail = Math.min(
    o.detailWanted + PANE_FRAME_Y,
    Math.max(COCKPIT_DETAIL_MIN, Math.floor(height / 2)),
  )
  return finish(height - detail, detail)
}

// ---------------------------------------------------------------------------
// the aside menu's rows
// ---------------------------------------------------------------------------

/** What an aside row DOES. `heading` and `rule` are not selectable. */
export type AsideRow =
  | { kind: 'heading'; label: string }
  | { kind: 'rule' }
  | { kind: 'action'; action: SessionAction; label: string; enabled: boolean }
  | { kind: 'group'; value: SessionGrouping; label: string; on: boolean }
  | { kind: 'toggle'; toggle: SessionToggle; label: string; on: boolean }
  /** One task, with how many sessions are filed under it. `name: ''` is "all of them". */
  | { kind: 'task'; name: string; count: number; on: boolean; done?: boolean }
  /** One project directory, with its session count. `name: ''` is "every project". */
  | { kind: 'project'; name: string; count: number; on: boolean }

/** The three things the list can be told to withhold. */
export type SessionToggle = 'closed' | 'exited' | 'unfiled' | 'done'

/**
 * The aside's rows, in reading order — PURE, so what is drawn and what a click resolves against are
 * one answer.
 *
 * Actions first because they are what a person came to do; the view switches under them because they
 * are set once and then left alone. Every row states its own state: a menu that shows only a cursor
 * makes you press things to find out what they already were.
 */
export function asideRows(o: {
  actions: readonly OfferedAction[]
  actionWords: Record<SessionAction, string>
  grouping: SessionGrouping
  groupWords: Record<SessionGrouping, string>
  toggles: Record<SessionToggle, boolean>
  toggleWords: Record<SessionToggle, string>
  headings: { actions: string; view: string; show: string }
  /** `unfiled` only means anything while grouping by task, so it is ABSENT otherwise. */
  showUnfiled: boolean
  /**
   * The tasks in the fleet with their session counts, and which one the list is scoped to.
   *
   * Offered as a SECTION rather than as a separate screen: a task is a place you work out of, so
   * picking one should narrow the list you are already looking at rather than take you somewhere
   * else and make you come back.
   */
  tasks?: {
    counts: ReadonlyArray<{ name: string; count: number }>
    active: string | null
    heading: string
    allLabel: string
    /** The finished ones, marked in the list so the menu states what it already knows. */
    done?: readonly string[]
  }
  /**
   * The project directories in the fleet, with their session counts.
   *
   * A second scope beside the tasks, and the answer to "where is that session I had open" — a task
   * is something you declared, a project is something every session already has. Picking one
   * narrows the list you are already looking at, which is what makes this a drill-down rather than
   * a separate screen you have to come back from.
   */
  projects?: { counts: ReadonlyArray<{ name: string; count: number }>; active: string | null; heading: string; allLabel: string }
}): AsideRow[] {
  const rows: AsideRow[] = [{ kind: 'heading', label: o.headings.actions }]
  for (const a of o.actions) {
    rows.push({ kind: 'action', action: a.action, label: o.actionWords[a.action], enabled: a.enabled })
  }
  rows.push({ kind: 'rule' }, { kind: 'heading', label: o.headings.view })
  for (const g of GROUPINGS) {
    rows.push({ kind: 'group', value: g, label: o.groupWords[g], on: g === o.grouping })
  }
  rows.push({ kind: 'rule' }, { kind: 'heading', label: o.headings.show })
  // `done` sits with the other two because it is the same kind of thing — what the list withholds.
  // `unfiled` only means anything while grouping by task and is ABSENT otherwise.
  const toggles: SessionToggle[] = o.showUnfiled
    ? ['closed', 'exited', 'done', 'unfiled']
    : ['closed', 'exited', 'done']
  for (const t of toggles) {
    rows.push({ kind: 'toggle', toggle: t, label: o.toggleWords[t], on: o.toggles[t] })
  }

  // The tasks, last, and only when there are any: a heading over an empty section is a promise the
  // screen cannot keep.
  if (o.tasks && o.tasks.counts.length > 0) {
    const done = o.tasks.done ?? []
    rows.push({ kind: 'rule' }, { kind: 'heading', label: o.tasks.heading })
    rows.push({ kind: 'task', name: '', count: 0, on: o.tasks.active === null })
    for (const t of o.tasks.counts) {
      rows.push({
        kind: 'task', name: t.name, count: t.count, on: o.tasks.active === t.name,
        ...(done.includes(t.name) ? { done: true } : {}),
      })
    }
  }

  if (o.projects && o.projects.counts.length > 0) {
    rows.push({ kind: 'rule' }, { kind: 'heading', label: o.projects.heading })
    rows.push({ kind: 'project', name: '', count: 0, on: o.projects.active === null })
    for (const p of o.projects.counts) {
      rows.push({ kind: 'project', name: p.name, count: p.count, on: o.projects.active === p.name })
    }
  }
  return rows
}

/**
 * How many sessions each PROJECT directory has — PURE, and counted over the whole fleet.
 *
 * Same rule as `taskCounts`: the count is what says a project has work in it, and counting after
 * the filters would report the number the filter left.
 */
export function projectCounts(list: readonly ControlSession[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const s of list) {
    if (!s.project) continue
    counts.set(s.project, (counts.get(s.project) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name))
}

/**
 * How many sessions each task has — PURE, and counted over the WHOLE fleet.
 *
 * Over the whole fleet rather than the filtered list, because the count is what tells you a task
 * has work in it: computing it after the filters would make picking a task report the number the
 * filter left, which is the one number nobody is asking for.
 */
export function taskCounts(list: readonly ControlSession[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const s of list) {
    if (!s.task) continue
    counts.set(s.task, (counts.get(s.task) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name))
}

/** Index of the nth row the cursor may land on: never a heading, a rule, or a disabled action. */
export function asideSelectable(rows: readonly AsideRow[]): number[] {
  const out: number[] = []
  rows.forEach((r, i) => {
    if (r.kind === 'heading' || r.kind === 'rule') return
    if (r.kind === 'action' && !r.enabled) return
    out.push(i)
  })
  return out
}

// ---------------------------------------------------------------------------
// the project picker's table
// ---------------------------------------------------------------------------

/** One project row, already reduced to the four things a column can hold. */
export interface ProjectRow {
  name: string
  repo: string
  path: string
  /** Already-localized reason it is being offered ("you are here", "you worked here"). */
  why: string
}

export interface ProjectColumns {
  name: number
  repo: number
  path: number
  why: number
}

/**
 * Column widths for a screenful of project candidates — PURE, and MEASURED across the page.
 *
 * The picker used to size each row against its own content, so every name started at a different
 * column and the eye had to re-find the path on every line. With twenty candidates that is not a
 * list, it is a paragraph per row — and this is the one control that decides where work happens.
 *
 * The PATH is the cell that survives everything: a machine with six directories called `portifolio`
 * renders six identical rows without it, so the name answers "what" and the path answers "which
 * one". The name is what the eye scans, so it goes first and is squeezed rather than dropped; the
 * repo and the provenance word are both derivable from the path and are given up before it.
 */
export function projectColumns(rows: readonly ProjectRow[], width: number): ProjectColumns {
  const widest = (pick: (r: ProjectRow) => string) =>
    rows.reduce((n, r) => Math.max(n, pick(r).length), 0)

  const name = widest(r => r.name)
  const repo = widest(r => r.repo)
  const path = widest(r => r.path)
  const why = widest(r => r.why)

  // Two for the cursor, then a gap between each pair of cells that is actually drawn. Counted from
  // the cells because any of them can be zero — a fleet of candidates with no repo draws no repo
  // column, and paying its gap anyway narrows every name to reserve a space nothing occupies.
  // The NAME counts as a drawn cell even while its width is still being solved for — it is always
  // drawn. Leaving it out of the tally lost one GAP, so the table came out two columns wider than
  // the pane and every row was truncated by the frame it had just been measured against.
  const room = (r: number, p: number, w: number) => {
    const drawn = [1, r, p, w].filter(v => v > 0).length
    return 2 + r + p + w + GAP * Math.max(0, drawn - 1)
  }

  const MIN_NAME = 10
  const MIN_PATH = 12

  const ladder: Array<[number, number, number]> = [
    [repo, path, why],
    [repo, path, 0],
    [0, path, 0],
  ]
  for (const [r, p, w] of ladder) {
    const over = room(r, p, w)
    const left = width - over
    if (left >= MIN_NAME) return { name: Math.min(name, left), repo: r, path: p, why: w }
  }
  // Nothing fits whole. The name and the path SHARE what there is, because either alone is a row
  // that cannot be acted on: a name with no path does not say which directory, a path with no name
  // is a row nobody scans.
  const shared = Math.max(2, width - 2 - GAP)
  const forPath = Math.min(path, Math.max(MIN_PATH, Math.floor(shared / 2)))
  return { name: Math.max(1, shared - forPath), repo: 0, path: forPath, why: 0 }
}
