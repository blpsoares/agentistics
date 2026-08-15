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
import {
  ACTIVE_STATES, GROUPINGS, SESSION_STATES, SESSION_DIMENSIONS, UNFILED,
  bucketKey, dimensionValueLabel, sessionNamed, sessionRunning,
  type DimensionContext, type DimensionWordBook, type SessionDimensionId, type SessionGroupingId,
} from './session-dimensions'
import type { ControlSession, SessionState } from './types'

// The status vocabulary and the two row predicates live in `session-dimensions.ts`, because `keyOf`
// needs them and the dependency has to run one way. Re-exported here because this is the module the
// rest of the control center imports from, and moving a name is not a reason to touch nine files.
export {
  ACTIVE_STATES, SESSION_STATES, SESSION_DIMENSIONS, DIMENSION_ORDER, GROUPINGS, UNFILED,
  GONE_PROJECT_KEY, FILTERS_VERSION, DEFAULT_FILTERS, DEFAULT_MARKED, DEFAULT_SHOW_NAMED,
  SHORTCUT_STATES,
  applyShortcut, bucketKey, dimensionValueLabel, dimensionWordBook, migrateSessionFilters,
  sessionKept, sessionNamed,
  sessionRunning, shortcutOn, storedFilters, toggleValue,
  type DimensionContext, type DimensionWordBook, type DimensionWords, type SessionDimensionId,
  type SessionFilters,
  type SessionFilterState, type SessionGroupingId, type StatusShortcut,
} from './session-dimensions'

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

/**
 * What a list can be ordered BY.
 *
 * `state` is the default and is not merely one option among the others: it puts what is blocked on
 * you at the top, which is the reason this screen exists. Every other order is a way of ANSWERING a
 * question ("what is costing me", "where was I an hour ago"), and each keeps state as its tiebreak
 * so a run of equal values still surfaces the blocked one first.
 */
export type SessionSort = 'state' | 'name' | 'started' | 'usage' | 'project'

export const SESSION_SORTS: readonly SessionSort[] = ['state', 'name', 'started', 'usage', 'project'] as const

export interface SessionOrder {
  by: SessionSort
  /** `desc` is newest / largest / most-urgent first — the direction each key is useful in. */
  dir: 'asc' | 'desc'
}

export const DEFAULT_ORDER: SessionOrder = { by: 'state', dir: 'desc' }

/**
 * Tokens as a NUMBER for ordering, from the already-formatted string the host sent.
 *
 * The host formats `51.7k` because every other surface wants it formatted, and re-deriving the
 * number here beats asking it to send both — but it must parse the SUFFIX, or `9.9k` sorts above
 * `1.2M` and the column that exists to show what is expensive points at the cheapest row.
 */
export function usageOf(s: ControlSession): number {
  const raw = (s.tokens ?? '').trim()
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return 0
  const unit = raw.replace(/[\d.,\s]/g, '').toUpperCase()
  return n * (unit.startsWith('M') ? 1e6 : unit.startsWith('K') ? 1e3 : 1)
}

/**
 * Order a list — PURE.
 *
 * STATE is every key's tiebreak, not only its own: a screen sorted by name that buries a session
 * waiting on approval among nine idle ones has lost the thing it is for. The direction flips the
 * primary key only, so `asc` by name still puts the blocked session first among equal names.
 */
export function sortSessions(
  list: readonly ControlSession[],
  order: SessionOrder = DEFAULT_ORDER,
): ControlSession[] {
  // `primary` returns negative when `a` belongs FIRST in the direction the key is useful in, which
  // `desc` names: most urgent, A to Z, largest, newest. `asc` is that flipped. One convention for
  // every key, rather than a per-key argument about which way round its "descending" runs.
  const primary = (a: ControlSession, b: ControlSession): number => {
    switch (order.by) {
      case 'state': return sessionRank(a) - sessionRank(b)
      case 'name': return a.title.localeCompare(b.title)
      case 'project': return (a.projectGroup || a.project).localeCompare(b.projectGroup || b.project)
      case 'usage': return usageOf(b) - usageOf(a)
      case 'started': return (b.startedAt ?? 0) - (a.startedAt ?? 0)
    }
  }
  const sign = order.dir === 'asc' ? -1 : 1
  return [...list].sort((a, b) => {
    const byPrimary = primary(a, b) * sign
    if (byPrimary !== 0) return byPrimary
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

/**
 * Grouping is a DIMENSION ID, plus the one arrangement that is not a dimension.
 *
 * It used to be a hand-written union sitting beside a differently-shaped set of filters, which is
 * the two-lists-of-one-fact defect `session-dimensions.ts` exists to remove. The alias is kept
 * because half the control center names this type.
 */
export type SessionGrouping = SessionGroupingId

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
  /**
   * Every dimension's words, so a band and the chip that selects it read the SAME name.
   *
   * The whole book rather than one dimension's slice: the caller resolves its strings once, and a
   * screen that offers seven groupings would otherwise pick the slice itself on every render — one
   * more place to pick the wrong one.
   */
  words: DimensionWordBook,
  /** The tasks the user marked finished — a statement about the WORK, not about any session. */
  doneTasks: readonly string[] = [],
  order: SessionOrder = DEFAULT_ORDER,
  ctx: DimensionContext = {},
): SessionGroup[] {
  if (by === 'none') return [{ key: '', label: '', sessions: sortSessions(list, order) }]

  const groups = new Map<string, SessionGroup>()
  for (const s of list) {
    // The SAME `keyOf` the filter reads. Deriving the bucket here as well is how the chip
    // "status: waiting" and the band "waiting" come to show different sets with nothing failing.
    const key = bucketKey(s, by, ctx)
    const label = dimensionValueLabel(words[by], key)
    const found = groups.get(key)
    if (found) found.sessions.push(s)
    else {
      const done = by === 'task' && key !== UNFILED && doneTasks.includes(key)
      groups.set(key, { key, label, sessions: [s], ...(done ? { done: true } : {}) })
    }
  }

  // Groups ordered by their most urgent member, so the box holding a blocked session is the one at
  // the top — grouping must not bury the thing the screen exists to surface.
  return [...groups.values()]
    .map(g => ({ ...g, sessions: sortSessions(g.sessions, order) }))
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
  /**
   * Already-localized word for the sessions the machine took at once, e.g. "fell together".
   *
   * Absent — on a machine where nothing fell, and in the tests that predate the section — leaves
   * those rows exactly where they used to be, in the history block. The section is an addition to
   * the reading order, never a change to which rows are listed.
   */
  fellLabel?: string,
  /**
   * The rows the user MARKED, and what to call their band.
   *
   * Marking a row exists for exactly one purpose — finding it again — and a glyph on a line that
   * stays wherever the ordering left it does not serve it. So marked rows become a BAND AT THE TOP,
   * in the same shape as every other band here.
   *
   * Three rules, and the third is the one that makes the feature work:
   *  - the band is absent when nothing is marked (a band with a title and no rows is a box with a
   *    name in it);
   *  - it applies under EVERY arrangement, `none` included — marking is the user's, and it outranks
   *    the grouping;
   *  - a marked row appears in the band and NOWHERE ELSE. The same session in two places is the
   *    reason someone was hunting for it.
   *
   * It lives here rather than in a component because `cardPages` walks these very rows: the card
   * grid gets the band for free, and cannot disagree with the list about which group a row is in.
   */
  marked?: { ids: ReadonlySet<string>; label: string },
): SessionRow[] {
  const out: SessionRow[] = []
  const isMarked = (s: ControlSession) => marked?.ids.has(s.id) ?? false

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
  // A row the machine TOOK, carved out of the history block it would otherwise sit in. It is not
  // history: it is work that was open a moment ago and is one action away from being open again,
  // and burying it among conversations that ended days ago is what made "reopen what I lost" a
  // matter of reading forty rows first.
  const hasFell = Boolean(fellLabel)
  const isFell = (s: ControlSession) => hasFell && s.fell === true && !isLive(s)

  // The marked band leads, drawn from every group so a mark outranks the arrangement. It is ONE
  // band rather than the live/fell/closed split the groups get: a marked conversation that is over
  // is still the one you marked, and filing it under history is putting it back where it was hard
  // to find.
  if (marked) {
    push(marked.label, groups.flatMap(g => g.sessions.filter(isMarked)))
  }

  for (const g of groups) {
    // Everything the band above took is gone from here — the same row twice is the bug, not the
    // feature. A group left empty by this simply draws nothing: `push` skips it.
    const rest = g.sessions.filter(s => !isMarked(s))
    const live = rest.filter(isLive)
    const fell = rest.filter(isFell)
    const closed = rest.filter(s => !isLive(s) && !isFell(s))
    // An empty KEY is an absence ("no task"), not a category, and is drawn as one. A FINISHED task
    // says so in its heading and is muted with it: the sessions are still listed and still
    // attachable, so the screen must say why they are set apart rather than merely dimming them.
    const head = g.done && doneLabel ? `${g.label} · ${doneLabel}` : g.label
    push(head, live, g.key === '' || Boolean(g.done))
    if (fell.length > 0) {
      // NOT muted: everything else set apart on this screen is set apart because it is over, and
      // this block is the opposite — it is the one thing on the list asking to be acted on.
      const label = fellLabel ?? ''
      push(g.label !== '' && label ? `${g.label} · ${label}` : label, fell)
    }
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
  /** Heads the spelled-out gauge: `45%  ·  455.4k / 1M`. */
  context: string
  /**
   * Heads the conversation this row continues from — the id `--resume` takes.
   *
   * Worth a row of its own because it is the one fact that turns "this session is somewhere" into
   * something a person can act on outside agentop, and because it is only ever shown when it was
   * RECORDED: a row without it is a row where nobody knows, and `conversationBlind` says so.
   */
  conversation: string
  /**
   * Labels for the OTHER name, when a session is named in both places.
   *
   * Two of them, because which one is the other depends on which one won — and a single label
   * saying "also called" would leave a person unable to tell whether the name on the row is the one
   * they typed here or the one they typed inside the session. That distinction is the entire point:
   * it is what says both renames landed.
   */
  alsoLabel: string
  alsoHarness: string
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

  // The name that did NOT win, right under what it is saying and above everything else, because it
  // answers "did my rename work" — which is the question someone has the moment they notice the row
  // saying something other than what they typed. The label names WHICH place it came from.
  if (s.titleOther) {
    out.push({
      key: 'also',
      // `titleSource` is where the WINNER came from, so the loser is the other place.
      label: s.titleSource === 'harness' ? labels.alsoLabel : labels.alsoHarness,
      value: s.titleOther,
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
  // The gauge SPELLED OUT: the bar on the row is a glance, and this is the only place the two
  // numbers behind it are legible. Without them a percentage is unauditable — you cannot tell a
  // reading against the right window from one against the wrong one, which is the single most
  // useful thing to be able to check about this feature.
  if (s.context) {
    out.push({
      key: 'context',
      label: labels.context,
      value: `${s.context.label}  ·  ${s.context.used} / ${s.context.window}`,
    })
  }
  // Where it continues from. Under the metrics because it is the fact you copy rather than read.
  if (s.conversationId) {
    out.push({ key: 'conv', label: labels.conversation, value: s.conversationId })
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
  // The directory first: it is the caveat that explains the others — a path that resolves to
  // nothing is why the project may be a bucket and why reopening will fail.
  if (s.dirGone) out.push({ key: 'gone', label: '', value: s.dirGone, note: true })
  if (s.approvalBlind) out.push({ key: 'blind', label: '', value: s.approvalBlind, note: true })
  if (s.conversationBlind) {
    out.push({ key: 'convblind', label: '', value: s.conversationBlind, note: true })
  }
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

/**
 * The most of a blocked session's dialog a confirmation will show.
 *
 * Six lines carries a question, three options and the footer naming the key — measured against the
 * frames `attention-rules.ts` was probed from. It is a CAP rather than a size: a shorter dialog
 * shows whole, and the pane asks for only what it has.
 */
export const APPROVAL_PREVIEW_MAX = 6

/**
 * The dialog cut to the rows there are — from the TOP, so the BOTTOM survives — PURE.
 *
 * The bottom is where the options are, where the highlight is, and where the footer names the key.
 * That is the part being answered; the lines above it are the context that led there, and context is
 * what a short pane can afford to lose. Cutting the other way round would leave a question with its
 * answers off screen, which is the one thing a confirmation may not do.
 */
export function fitApprovalPreview(lines: readonly string[], rows: number): string[] {
  const keep = Math.max(0, Math.min(rows, APPROVAL_PREVIEW_MAX))
  return lines.slice(Math.max(0, lines.length - keep))
}

/**
 * How many rows the detail region must be given for the question that is open — PURE.
 *
 * A question ALWAYS outranks the facts: a prompt with nowhere to draw cannot be answered, which is
 * why `QUESTION_ROWS` is the floor. What is new here is that one question carries evidence — the
 * dialog a person has to read before agreeing — and those rows have to be BUDGETED rather than
 * drawn on top of the answers. Ink composites what does not fit, so an unbudgeted preview does not
 * crowd the two answers, it draws over whatever was under them.
 *
 * `+ 1` for the row that LABELS the evidence. It is not decoration: the dialog being quoted has its
 * own numbered options, the confirmation under it has two of its own, and without a line saying
 * which is which the pane is two menus stacked on top of each other.
 */
export function askRows(o: { preview: number; detail: number; choices?: number }): number {
  const preview = Math.max(0, Math.min(o.preview, APPROVAL_PREVIEW_MAX))
  // A picker draws one row per option instead of the two a yes/no carries, and it is budgeted for
  // the same reason the evidence is: Ink composites what does not fit, so an unbudgeted list does
  // not scroll, it draws over whatever is under the pane. `QUESTION_ROWS` stays the floor — a
  // two-option dialog must not end up with less room than a confirmation would have had.
  const choices = Math.max(0, o.choices ?? 0)
  const body = choices > 1 ? Math.max(QUESTION_ROWS, choices) : QUESTION_ROWS
  return Math.max(body + (preview > 0 ? preview + 1 : 0), Math.max(0, o.detail))
}


// ---------------------------------------------------------------------------
// the visible action row
// ---------------------------------------------------------------------------

/** What a verb DOES, independent of what it is called in either language. */
export type SessionAction =
  | 'attach' | 'resume' | 'approve' | 'prompt' | 'rename' | 'note' | 'task' | 'kill'
  | 'openTask' | 'reopenFell' | 'finishTask'
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
export function sessionActions(
  selected: ControlSession | undefined,
  /** Facts about the FLEET rather than the row — what the fleet-level verbs need. */
  fleet: { fell?: number } = {},
): OfferedAction[] {
  // A row agentop still HOSTS: it has a registry entry, so it can be renamed, filed and stopped.
  // `exited` and `lost` are hosted — a reboot loses every backend session while the registry keeps
  // every name, and losing the verbs that edit those names is how a rename disappears.
  const hosted = selected !== undefined
    && selected.state !== 'unknown'
    && selected.state !== 'closed'
  // ATTACHING is narrower: there has to be something running to attach TO. A hosted row whose
  // backend is gone offers REOPEN instead, which is the verb that actually works on it — offering
  // `attach` there was a button whose only outcome was an error.
  const live = hosted
    && (selected.state === 'working' || selected.state === 'waiting'
      || selected.state === 'waiting-approval')
  const canReopen = Boolean(selected?.resume)
  const hasTask = Boolean(selected?.task)

  return [
    // The row-specific verb comes first, and which one it is depends on what the row IS: something
    // running is attached to, everything else is reopened. They are never both live.
    ...(live
      ? [{ action: 'attach' as const, enabled: true }]
      : [{ action: 'resume' as const, enabled: canReopen }]),
    // APPROVE leads the rest because a session blocked on a question is the reason this screen
    // exists. The host decides `canApprove`, and it is true only when the session is genuinely
    // asking AND somebody has read this harness's dialog — a keystroke sent into a session that is
    // not asking is a blank turn, or an option taken out of a menu nobody was looking at.
    // Enabled wherever there is something to ANSWER: a plain confirmation, a pickable option list,
    // or an option list this harness cannot pick from — that last one opens a refusal that names why
    // and points at attaching, which is information rather than an inert key.
    {
      action: 'approve',
      enabled: Boolean(selected?.canApprove)
        || Boolean(selected?.canChoose)
        || (selected?.dialogOptions?.length ?? 0) > 1,
    },
    // Typing into a session needs it to be RUNNING and nothing more: a session that is working will
    // read what it was handed when it gets there. The one case that must not go through is a
    // session sitting on a dialog, where the prompt is a menu — and that is refused by the HOST,
    // which re-reads the screen, rather than here from a list up to a poll old.
    { action: 'prompt', enabled: live },
    { action: 'rename', enabled: hosted },
    { action: 'note', enabled: hosted },
    { action: 'task', enabled: hosted },
    { action: 'openTask', enabled: hosted && hasTask },
    // A FLEET verb sitting among the row verbs, because that is where the hand already is when a
    // reboot has just emptied the screen. Enabled only when something actually fell — offered and
    // doing nothing is the shape this menu already refuses everywhere else.
    { action: 'reopenFell', enabled: (fleet.fell ?? 0) > 0 },
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
 * first (the panel one keypress away states it in full), then the waiting count, then the total,
 * then the fall. The grouping is last because it is the only cell that explains why the rows are
 * arranged as they are, and it is truncated rather than dropped.
 *
 * The FALL outlives the other three because it is the only cell that is an OFFER: the rest describe
 * the list, and this one names work that is one keypress from coming back. It is also the only cell
 * that is usually absent, so it costs nothing on an ordinary machine.
 */
export function summaryCells(o: {
  group: string
  hiding: string
  count: string
  waiting: string
  /** "N sessions fell X ago — R reopens them", or `''` when nothing did. */
  fell?: string
  width: number
}): { group: string; hiding: string; count: string; waiting: string; fell: string } {
  const GAP = 3
  const width = Math.max(0, o.width)
  const fits = (parts: string[]) => {
    const kept = parts.filter(p => p !== '')
    return kept.reduce((n, p) => n + p.length, 0) + GAP * Math.max(0, kept.length - 1) <= width
  }

  const fell = o.fell ?? ''
  const full = { group: o.group, hiding: o.hiding, count: o.count, waiting: o.waiting, fell }
  if (fits([full.group, full.hiding, full.count, full.waiting, full.fell])) return full

  const noHiding = { ...full, hiding: '' }
  if (fits([noHiding.group, noHiding.count, noHiding.waiting, noHiding.fell])) return noHiding

  const noWaiting = { ...noHiding, waiting: '' }
  if (fits([noWaiting.group, noWaiting.count, noWaiting.fell])) return noWaiting

  const noCount = { ...noWaiting, count: '' }
  if (fits([noCount.group, noCount.fell])) return noCount

  const groupOnly = { group: o.group, hiding: '', count: '', waiting: '', fell: '' }
  if (fits([groupOnly.group])) return groupOnly

  return { ...groupOnly, group: o.group.slice(0, Math.max(0, width)) }
}

// ---------------------------------------------------------------------------
// column alignment
// ---------------------------------------------------------------------------

export interface SessionColumns {
  /**
   * The first few characters of the session id.
   *
   * It is the HANDLE: `agentop session attach 3f5f` takes a prefix, so the row that shows one is
   * the row you can act on from another terminal. Fixed width and always drawn — it is five columns
   * and it is the only thing on the screen that names the session to anything but this screen.
   */
  id: number
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
  /**
   * How long ago it started, for a row that is NOT running.
   *
   * On the row rather than only in the detail pane, and only for what is down, because that is the
   * one place it decides something: a live session's age is idle curiosity, while "reopen this or
   * not" is mostly a question about how old it is. A running row spends the column on nothing.
   */
  age: number
  /**
   * The worktree's own folder name. `0` when no row on screen is one — never a column of blanks.
   *
   * The NAME rather than the word "worktree": with the list grouped by project, the heading already
   * says which project and the folder cell says the same, so a cell repeating "worktree" on every
   * row told you the kind and never which one. Three checkouts of one repository are told apart by
   * exactly this.
   */
  worktree: number
  /** Tokens + cost. `0` when nothing on screen has any — never a column of blanks. */
  metrics: number
  /**
   * The context gauge — bar plus percentage. `0` when no row on screen has a reading.
   *
   * It outlives `metrics` under width pressure, which is the one ordering decision here worth
   * stating: tokens and cost are a record of what a session HAS spent, while this is the only cell
   * that says what it can still do. On a narrow terminal the question people are answering is
   * "which of these do I need to deal with", and a session about to run out of window is the
   * answer to it.
   */
  context: number
  harness: number
  where: number
}

/**
 * How long ago a row that is not running began — PURE, and EMPTY for one that is.
 *
 * `now` is passed in rather than read: this is called on every repaint and a clock inside it would
 * make the column's width depend on the second it was measured in.
 */
export function sessionAge(s: ControlSession, now: number, ago: (seconds: number) => string): string {
  if (sessionRunning(s) || s.startedAt === undefined) return ''
  return ago(Math.max(0, Math.round((now - s.startedAt) / 1000)))
}

/** How much of a session id a row shows. Enough to be unambiguous in practice, and to type. */
export const ID_CELL = 5

/**
 * The handle: the leading characters of the id, which is what the CLI resolves a prefix against.
 *
 * Empty for a row that has no id of ours — an external process and a closed conversation are named
 * by the harness, not by agentop, and showing five characters of a synthetic id would offer a
 * handle that `agentop session attach` cannot resolve.
 */
export function sessionHandle(s: ControlSession): string {
  return s.id.startsWith('external:') || s.id.startsWith('closed:') ? '' : s.id.slice(0, ID_CELL)
}

/**
 * What a worktree row is CALLED — its own directory name, or `''` when it is not one.
 *
 * The folder cell shows the PROJECT once the project grouping keys on the main checkout, so this is
 * the cell that says which checkout of it you are looking at. The NAME rather than the word
 * "worktree": a cell repeating one word on every such row told you the kind and never which one,
 * and three checkouts of one repository are told apart by exactly this.
 */
export function worktreeName(s: ControlSession): string {
  return s.worktree ? s.project : ''
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

// ---------------------------------------------------------------------------
// the context gauge
// ---------------------------------------------------------------------------

/**
 * Columns the bar itself takes, label excluded.
 *
 * Six, because the bar's job on a row is a GLANCE — nearly empty, half, nearly full — and six cells
 * resolve that to within a sixth. Anything finer is a number, and the number is already printed
 * beside it. Anything coarser stops being a shape.
 */
export const CONTEXT_BAR = 6

/** The filled/empty bar for a fraction — PURE, and SATURATED at both ends.
 *
 *  Saturation is the whole point of drawing this separately from the label: a session really can
 *  exceed the window this reading was computed against, and a bar allowed to overflow would draw
 *  past its own cell and shear every row under it — the exact failure the pure-layout rule exists
 *  to prevent. So the BAR pins at full and the LABEL keeps telling the truth (`106%`), which is the
 *  only division of labour where neither half lies. */
export function contextBar(fraction: number, width: number = CONTEXT_BAR): string {
  const w = Math.max(0, Math.floor(width))
  if (w === 0) return ''
  const safe = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0
  // Rounded DOWN, mirroring the label: a bar showing full while the label says 99% is one of them
  // being wrong, and it would be the bar — the shape is what gets believed at a glance.
  const filled = Math.min(w, Math.floor(safe * w))
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}

/** The whole cell — bar, a space, then the percentage. `''` when this row has no reading. */
export function sessionContext(s: ControlSession, width: number = CONTEXT_BAR): string {
  if (!s.context) return ''
  return `${contextBar(s.context.fraction, width)} ${s.context.label}`
}

/**
 * How full is "too full" — the threshold the row changes colour at.
 *
 * Two of them rather than one, because they answer different questions: `warn` is "start thinking
 * about wrapping this up", `full` is "the window this was measured against is exceeded and the
 * reading past it is no longer a proportion of anything". `full` is deliberately 1 exactly, not
 * 0.95: past it the number is not a warning, it is a different kind of statement.
 */
export const CONTEXT_WARN = 0.8
export const CONTEXT_FULL = 1

export type ContextLevel = 'ok' | 'warn' | 'full'

export function contextLevel(fraction: number): ContextLevel {
  if (fraction >= CONTEXT_FULL) return 'full'
  if (fraction >= CONTEXT_WARN) return 'warn'
  return 'ok'
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
  o: {
    /** True while the HEADING above each row already names the task, so the cell would repeat it. */
    groupedByTask?: boolean
    /** Already-localized age per row, keyed by session id — see `sessionAge`. */
    ages?: ReadonlyMap<string, string>
    /**
     * The column HEADINGS, when a header row is being drawn.
     *
     * Measured as content of their own columns, because they are: a heading wider than the column
     * under it is truncated, and a truncated heading sits over a cell it no longer names. Passed
     * only when the header is actually drawn — a pane too short for one must not pay for words
     * nobody is going to see.
     */
    headings?: Partial<Record<keyof SessionColumns, string>>
  } = {},
): SessionColumns {
  const head = (key: keyof SessionColumns) => (o.headings?.[key] ?? '').length
  // A column that draws nothing stays at zero: the heading is only content of a column that exists.
  const widest = (key: keyof SessionColumns, pick: (s: ControlSession) => string) => {
    const data = rows.reduce((n, s) => Math.max(n, pick(s).length), 0)
    return data === 0 ? 0 : Math.max(data, head(key))
  }

  const id = widest('id', sessionHandle)
  const state = widest('state', s => s.stateLabel)
  const title = widest('title', s => s.title)

  /**
   * The droppable cells, in the order the screen gives them up — least important FIRST.
   *
   * Named rather than positional. This used to be a list of six-number tuples fed to a six-argument
   * `overhead(a, wt, k, m, h, w)`, which was already at the limit of what can be read; the context
   * gauge would have made it seven, where a transposed pair is invisible in review and shows up as
   * a column of the wrong width on somebody's terminal.
   *
   * The order itself: the directory first (the heading usually says it), then the harness (the
   * row's colour says it), then tokens and cost, then the gauge, then the task, the worktree, and
   * finally the age. The STATE and the NAME are not in this list at all — they are what a row
   * cannot lose, the state because nothing else on the frame says whether this session is waiting
   * for you, the name because a row you cannot identify is not a row you can act on.
   */
  const droppable = [
    // The PROJECT, not the directory: once the grouping keys on the main checkout, a folder cell
    // showing the worktree's own name says something the worktree cell already says better.
    ['where', widest('where', s => s.projectGroup || s.project)],
    ['harness', widest('harness', s => s.harness)],
    ['metrics', widest('metrics', sessionMetric)],
    ['context', widest('context', s => sessionContext(s))],
    ['task', o.groupedByTask ? 0 : widest('task', s => s.task ?? '')],
    ['worktree', widest('worktree', worktreeName)],
    ['age', widest('age', s => o.ages?.get(s.id) ?? '')],
  ] as const satisfies ReadonlyArray<readonly [keyof SessionColumns, number]>

  /**
   * Columns everything BUT the title costs: two for the cursor, the cells, and a gap between each
   * pair of cells that is actually drawn.
   *
   * Counted from the cells rather than from a constant because a cell can be ZERO — a fleet where
   * no session reports usage draws no metrics column, and paying its gap anyway would narrow every
   * title on the screen to reserve a space nothing occupies.
   */
  const overhead = (cells: Partial<Record<keyof SessionColumns, number>>) => {
    const values = Object.values(cells).filter((n): n is number => n !== undefined)
    const sum = values.reduce((n, v) => n + v, 0)
    // `1` stands in for the title, which is always drawn and so always pays its own gap.
    const drawn = [id, state, 1, ...values].filter(n => n > 0).length
    return 2 + id + state + sum + GAP * (drawn - 1)
  }

  // The fewest columns a title is worth. Below it the row has a state word and an ellipsis, which
  // names nothing — so the screen gives up a whole cell instead.
  const MIN_TITLE = 8

  const kept = new Map<keyof SessionColumns, number>(droppable)
  const finish = (room: number): SessionColumns => ({
    id, state, title: Math.max(1, Math.min(title, room)),
    where: kept.get('where') ?? 0,
    harness: kept.get('harness') ?? 0,
    metrics: kept.get('metrics') ?? 0,
    context: kept.get('context') ?? 0,
    task: kept.get('task') ?? 0,
    worktree: kept.get('worktree') ?? 0,
    age: kept.get('age') ?? 0,
  })

  // One pass more than there are droppable cells: the first tries them all, the last tries none.
  for (let i = 0; i <= droppable.length; i++) {
    const room = width - overhead(Object.fromEntries(kept))
    // The title takes what it NEEDS, not what is left: stretching it to the full remainder pushed
    // the trailing cells to the far edge with a field of blank between, which is the old
    // misalignment wearing a different shape.
    if (room >= MIN_TITLE || kept.size === 0) return finish(room)
    kept.delete(droppable[i]![0])
  }
  /* c8 ignore next 2 */
  return finish(width - overhead({}))
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
  /** Whether the column-header row fits under it. */
  header: boolean
  /** Rows for session rows inside the list pane, frame and summary already paid for. */
  listRows: number
}

/** The aside's natural width: wide enough for its longest label, within bounds. */
const ASIDE_MIN = 18
const ASIDE_MAX = 34
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
  /** Folded away by the user — the list takes the whole width, whatever it would have fitted. */
  hideAside?: boolean
}): CockpitLayout {
  const width = Math.max(1, o.width)
  const height = Math.max(1, o.height)

  const aside = o.hideAside ? 0 : width >= ASIDE_NEEDS
    // `+ 4` rather than `+ 2`: the rows carry a cursor, a state dot and — for a task or a project —
    // a trailing count, and sizing to the label alone truncated every long verb in the menu.
    ? Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, o.asideLabel + 4))
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
    const summary = inner >= 5
    // The column HEADER is the row that says what each cell is. It is given up before the summary,
    // because the summary states what is being withheld from the list — a filter you cannot see is
    // a list lying about its length, while an unlabelled column is merely one you have to learn.
    const header = inner >= 4
    const spent = (summary ? 1 : 0) + (header ? 1 : 0)
    return { aside, list, band, detail, summary, header, listRows: Math.max(1, inner - spent) }
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
  /** One LAYOUT the list can be drawn in, and whether it is the one in force. */
  | { kind: 'layout'; value: SessionLayout; label: string; on: boolean }
  | { kind: 'toggle'; toggle: SessionToggle; label: string; on: boolean }
  /**
   * One task, with how many sessions are filed under it.
   *
   * `all` marks the "every task" row — `name: ''` cannot, now that the UNFILED bucket is a real
   * selectable value whose key is also `''`. Two different rows had one identity, and clicking
   * "no task" cleared the scope instead of selecting it.
   */
  | {
      kind: 'task'
      name: string
      /**
       * What the row is CALLED, decided here rather than rebuilt by the renderer.
       *
       * The renderer used to draw `name || allLabel`, which collapsed two different rows the moment
       * the UNFILED bucket became selectable: "every task" and "no task" both carry `name: ''`, so
       * the menu listed "every task" twice and one of them scoped to something else.
       */
      label: string
      count: number
      on: boolean
      done?: boolean
      all?: boolean
    }
  /** One project directory, with its session count. `name: ''` is "every project". */
  | { kind: 'project'; name: string; count: number; on: boolean }
  /** One STATE the list may keep, with how many rows wear it. */
  | { kind: 'state'; value: SessionState; label: string; count: number; on: boolean }
  /** One ordering, and whether it is the one in force. */
  | { kind: 'sort'; value: SessionSort; label: string; on: boolean; dir: 'asc' | 'desc' }


/**
 * The switches in the SHOW block.
 *
 * `unfiled` is gone: it hid the task-less band, but only while grouping BY task, and only for that
 * one dimension. Every dimension now has a selectable "no value" bucket, so the switch was a hidden
 * special case of a control that exists in the open.
 *
 * `named` replaces it, and is the opposite kind of change — it makes an EXISTING hidden behaviour
 * visible. A row the user named used to survive the history switches unconditionally, unwritten.
 */
/**
 * The switches the menu draws.
 *
 * `closed` and `exited` were two of these and asked ONE question — "is it not running" — so ticking
 * either while the other was on appeared to do nothing. They are now `history`.
 */
export type SessionToggle = 'history' | 'named' | 'done' | 'active' | 'detail'

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
  /**
   * The layout block.
   *
   * Its own section rather than two more rows among the groupings: "list or cards" and "grouped by
   * what" are different questions, and six grouping rows with two unlike ones among them is a menu
   * nobody reads correctly.
   */
  layout: { heading: string; words: Record<SessionLayout, string>; value: SessionLayout }
  toggles: Record<SessionToggle, boolean>
  toggleWords: Record<SessionToggle, string>
  headings: { actions: string; view: string; show: string }
  /** The ordering block, when the menu should offer one. */
  sort?: { heading: string; words: Record<SessionSort, string>; by: SessionSort; dir: 'asc' | 'desc' }
  /**
   * The per-STATE block: which states are kept, what each is called, and how many wear it.
   *
   * Counted over the fleet rather than over the filtered list, for the same reason the tasks are:
   * the count is what says a state has anything in it, and counting after the filter would report
   * the number the filter left — which for an unselected state is always zero.
   */
  states?: {
    heading: string
    words: Record<SessionState, string>
    counts: Partial<Record<SessionState, number>>
    kept: readonly SessionState[]
  }
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
    /** What the "no task" bucket is called — the row that replaced the `unfiled` switch. */
    unfiled: string
    /** How many sessions are in it. A bucket with nothing in it draws no row. */
    unfiledCount?: number
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
  rows.push({ kind: 'rule' }, { kind: 'heading', label: o.layout.heading })
  for (const value of LAYOUTS) {
    rows.push({
      kind: 'layout', value, label: o.layout.words[value], on: value === o.layout.value,
    })
  }
  rows.push({ kind: 'rule' }, { kind: 'heading', label: o.headings.view })
  for (const g of GROUPINGS) {
    rows.push({ kind: 'group', value: g, label: o.groupWords[g], on: g === o.grouping })
  }
  rows.push({ kind: 'rule' }, { kind: 'heading', label: o.headings.show })
  // `active` leads because it is the STRICT one, with the widening ones beneath. It no longer
  // overrides them: all three write into one status selection and read their state back out of it,
  // so ticking `closed` while `active` is on widens the list and turns `active` off — a switch is
  // never lit over a list it does not describe. `named` sits with them because it is the same kind
  // of thing, and because it used to be the one widening nobody could see.
  const toggles: SessionToggle[] = ['active', 'history', 'named', 'done', 'detail']
  for (const t of toggles) {
    rows.push({ kind: 'toggle', toggle: t, label: o.toggleWords[t], on: o.toggles[t] })
  }

  // The tasks, last, and only when there are any: a heading over an empty section is a promise the
  // screen cannot keep.
  // ORDER, then STATE: the first is how the list is arranged and belongs beside the grouping, the
  // second is what it contains and belongs beside the switches that decide the same thing.
  if (o.sort) {
    rows.push({ kind: 'rule' }, { kind: 'heading', label: o.sort.heading })
    for (const by of SESSION_SORTS) {
      rows.push({
        kind: 'sort', value: by, label: o.sort.words[by], on: by === o.sort.by, dir: o.sort.dir,
      })
    }
  }

  if (o.states) {
    rows.push({ kind: 'rule' }, { kind: 'heading', label: o.states.heading })
    for (const value of SESSION_STATES) {
      const count = o.states.counts[value] ?? 0
      // A state nothing on this machine wears is not a filter, it is a row that does nothing.
      if (count === 0 && !o.states.kept.includes(value)) continue
      rows.push({
        kind: 'state', value, label: o.states.words[value], count,
        on: o.states.kept.includes(value),
      })
    }
  }

  if (o.tasks && o.tasks.counts.length > 0) {
    const done = o.tasks.done ?? []
    rows.push({ kind: 'rule' }, { kind: 'heading', label: o.tasks.heading })
    rows.push({
      kind: 'task', name: '', label: o.tasks.allLabel, count: 0,
      on: o.tasks.active === null, all: true,
    })
    for (const t of o.tasks.counts) {
      rows.push({
        kind: 'task', name: t.name, label: t.name, count: t.count, on: o.tasks.active === t.name,
        ...(done.includes(t.name) ? { done: true } : {}),
      })
    }
    // The "no task" bucket, last, and only when something is in it. It is what the `unfiled` switch
    // used to be — except it is a value on a dimension like any other, selectable under every
    // grouping rather than only while grouping by task.
    const unfiledCount = o.tasks.unfiledCount ?? 0
    if (unfiledCount > 0) {
      rows.push({
        kind: 'task', name: UNFILED, label: o.tasks.unfiled, count: unfiledCount,
        on: o.tasks.active === UNFILED,
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

/**
 * A stable NAME for a menu row, so a cursor can survive the list being rebuilt — PURE.
 *
 * The cursor used to be an index into the SELECTABLE rows, and that list changes composition
 * constantly: which verbs are enabled depends on the selected session, so moving down the fleet
 * silently renumbered every row beneath the actions block and the menu cursor jumped — usually back
 * into the first section, which then opened. An index is not an identity.
 *
 * Keyed by kind and by what the row acts on, never by position.
 */
export function asideRowKey(row: AsideRow): string {
  switch (row.kind) {
    case 'action': return `action:${row.action}`
    case 'group': return `group:${row.value}`
    case 'layout': return `layout:${row.value}`
    case 'toggle': return `toggle:${row.toggle}`
    case 'task': return `task:${row.name}`
    case 'state': return `state:${row.value}`
    case 'sort': return `sort:${row.value}`
    case 'project': return `project:${row.name}`
    case 'heading': return `heading:${row.label}`
    case 'rule': return 'rule'
  }
}

/**
 * Where the cursor lands after the menu is rebuilt — PURE.
 *
 * The SAME row when it is still there and still selectable; otherwise the nearest selectable row to
 * where it was, so a verb that becomes unavailable moves the cursor by one place rather than to the
 * top of the menu.
 */
export function resolveAsideCursor(rows: readonly AsideRow[], wanted: string): number {
  const picks = asideSelectable(rows)
  if (picks.length === 0) return -1
  const exact = picks.find(i => asideRowKey(rows[i]!) === wanted)
  if (exact !== undefined) return exact
  // Not there any more: fall back to where it WAS, which for a disabled verb is the row that took
  // its place. Never the top — a cursor that jumps to the first section makes that section open.
  const previous = rows.findIndex(r => asideRowKey(r) === wanted)
  if (previous < 0) return picks[0]!
  return picks.reduce((best, i) =>
    Math.abs(i - previous) < Math.abs(best - previous) ? i : best, picks[0]!)
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

/** One section of the picker: the repository its rows belong to, or `''` for the loose folders. */
export interface ProjectSection {
  repo: string
  rows: ProjectRow[]
}

/**
 * Group the candidates by REPOSITORY, keeping the order they arrived in — PURE.
 *
 * First appearance decides section order, which is what preserves the host's ranking: the section
 * holding the directory you are standing in stays at the top, and re-sorting alphabetically here
 * would throw away the one piece of ordering the search actually earned.
 *
 * Loose folders — anything with no repository — go LAST, under their own empty-keyed section. They
 * are the long tail of a `$HOME` walk, and the sections above them are the answer most of the time.
 */
export function groupProjects(rows: readonly ProjectRow[]): ProjectSection[] {
  const byRepo = new Map<string, ProjectSection>()
  const loose: ProjectRow[] = []
  for (const r of rows) {
    if (!r.repo) { loose.push(r); continue }
    const found = byRepo.get(r.repo)
    if (found) found.rows.push(r)
    else byRepo.set(r.repo, { repo: r.repo, rows: [r] })
  }
  const out = [...byRepo.values()]
  if (loose.length > 0) out.push({ repo: '', rows: loose })
  return out
}

/**
 * The picker's rows as they are DRAWN — headings included, in one flat list.
 *
 * Flat because the cursor moves over it: with headings drawn separately, the selected index and the
 * drawn rows are two different countings of one list and they agree until the first section
 * boundary. `index` is the position in the ORIGINAL list, so what `enter` picks is never in doubt.
 *
 * Sections are only drawn when they earn themselves: one section is not a grouping, it is a heading
 * over the whole list.
 */
export type ProjectPickRow =
  | { kind: 'heading'; label: string }
  | { kind: 'project'; row: ProjectRow; index: number }

export function projectPickRows(
  rows: readonly ProjectRow[],
  /** Already-localized heading for the folders that belong to no repository. */
  looseLabel: string,
): { rows: ProjectPickRow[]; grouped: boolean } {
  const sections = groupProjects(rows)
  const named = sections.filter(s => s.repo !== '').length
  // A grouping needs at least one named repository AND something to separate it from.
  if (named === 0 || sections.length < 2) {
    return { rows: rows.map((row, index) => ({ kind: 'project' as const, row, index })), grouped: false }
  }
  const out: ProjectPickRow[] = []
  let index = 0
  const seen = new Map<ProjectRow, number>()
  rows.forEach((r, i) => seen.set(r, i))
  for (const section of sections) {
    out.push({ kind: 'heading', label: section.repo || looseLabel })
    for (const row of section.rows) {
      index = seen.get(row) ?? index
      out.push({ kind: 'project', row, index })
    }
  }
  return { rows: out, grouped: true }
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
/** Cursor plus the kind glyph, both always drawn: `❯ ◆ `. */
export const PROJECT_LEAD = 4

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
    return PROJECT_LEAD + r + p + w + GAP * Math.max(0, drawn - 1)
  }

  const MIN_NAME = 10
  const MIN_PATH = 12
  // Two for the cursor and two for the glyph that says what kind of place this is. The glyph is
  // always drawn, so it is chrome rather than a column that can be given up.

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
  const shared = Math.max(2, width - PROJECT_LEAD - GAP)
  const forPath = Math.min(path, Math.max(MIN_PATH, Math.floor(shared / 2)))
  return { name: Math.max(1, shared - forPath), repo: 0, path: forPath, why: 0 }
}

// ---------------------------------------------------------------------------
// the aside, split into its own panes
// ---------------------------------------------------------------------------

/** One titled block of the menu, ready to be drawn as its own framed pane. */
export interface AsideSection {
  /** Already-localized title, taken from the heading row that opened the block. */
  title: string
  /** The rows of this block, WITHOUT its heading or the rule that followed it. */
  rows: AsideRow[]
  /** Index into the flat `asideRows` list of each row above, so the cursor keeps ONE counting. */
  indexes: number[]
}

/**
 * Split the flat menu into its titled sections — PURE.
 *
 * The menu is authored as one flat list because the CURSOR moves over one list: with the sections
 * kept as separate arrays, the selected index and the drawn rows are two different countings of one
 * menu and they agree until the first section boundary. This takes that one list apart for DRAWING
 * only, and every row carries the index it had — so what `enter` runs is never in doubt.
 *
 * It exists because a single scrolling pane titled "menu" showed its first section and nothing
 * else: with the actions at the top and the pane four rows tall, every switch and every task was
 * below the fold, and the honest reading of that screen is that everything lives inside "Actions".
 */
export function asideSections(rows: readonly AsideRow[]): AsideSection[] {
  const out: AsideSection[] = []
  rows.forEach((row, index) => {
    if (row.kind === 'rule') return
    if (row.kind === 'heading') { out.push({ title: row.label, rows: [], indexes: [] }); return }
    const current = out[out.length - 1]
    if (!current) return
    current.rows.push(row)
    current.indexes.push(index)
  })
  return out.filter(s => s.rows.length > 0)
}

/**
 * How many rows each menu section gets — PURE, and the ONE answer for every terminal height.
 *
 * A section that is open is a framed pane holding all of its rows; a section that is not gives up
 * its frame and its contents and keeps its NAME, on one row. Nothing is ever hidden: what a
 * collapsed section costs is what is inside it, never the fact that it exists — which was the whole
 * complaint about the single scrolling pane, where the first section filled the box and the rest
 * were below a fold nothing announced.
 *
 * The section holding the cursor opens first, then the others in reading order while they fit
 * WHOLE. Opening one part-way was the middle ground and it was the worst of the three: a block cut
 * to its first two rows says no more than its heading did, and every one of them grew its own
 * little scrollbar. The active section is the single exception — it takes whatever is left even if
 * that is not all of it, because it is the one being read.
 *
 * So a tall terminal opens every section and a short one opens the one you are using, with no
 * second behaviour to learn and no dead air under the last pane.
 *
 * `null` when the band cannot even name every section and open one, and the caller falls back to
 * the single scrolling pane.
 */
export function asideFold(
  sections: readonly AsideSection[],
  band: number,
  active: number,
): number[] | null {
  if (sections.length === 0) return null
  const at = Math.max(0, Math.min(active, sections.length - 1))
  const collapsed = sections.length - 1
  if (band < collapsed + PANE_FRAME_Y + 1) return null

  const want = (i: number) => PANE_FRAME_Y + sections[i]!.rows.length
  const out: number[] = sections.map(() => 1)
  // The one being read, first and at whatever height is left to it.
  out[at] = Math.min(want(at), band - collapsed)
  let used = out.reduce((a, b) => a + b, 0)

  // Then the rest, in READING order rather than outward from the cursor: the menu must not
  // rearrange itself as the cursor moves, or the box you were aiming at is somewhere else by the
  // time you get there.
  for (let i = 0; i < sections.length; i++) {
    if (i === at) continue
    const extra = want(i) - out[i]!
    if (extra <= 0 || used + extra > band) continue
    out[i] = want(i)
    used += extra
  }

  // Whatever is left over goes to the OPEN section, so the column ends flush with the list beside
  // it. Air under a pane is a fault and air inside one is a pane — and the section you are using is
  // the one where the spare rows are worth having, since its contents are what grows.
  out[at] += band - used
  return out
}

// ---------------------------------------------------------------------------
// how far down a scrolling region is
// ---------------------------------------------------------------------------

/**
 * The scrollbar for a windowed list, one character per drawn row — PURE.
 *
 * A window with no scrollbar is a list whose length is a secret: you cannot tell whether the row
 * under the cursor is the last one or the tenth of ninety, and the only way to find out is to keep
 * pressing down until it stops moving. That is what people were doing.
 *
 * Returns an EMPTY array when everything fits. A bar that is always drawn says "there is more" on a
 * list that has no more, which is the same class of lie as a confident zero.
 */
/** The thumb: a heavy hairline, so it is the same width as the track and plainly darker. */
export const THUMB = '┃'
/** The track: the lightest vertical rule the box-drawing set has. */
export const TRACK = '│'

export function scrollBar(o: { offset: number; total: number; rows: number }): string[] {
  const rows = Math.max(0, o.rows)
  if (rows === 0 || o.total <= rows) return []

  // At least one cell, and never the whole track — a full-length thumb reads as "nothing to scroll"
  // on exactly the list that has the most of it.
  const thumb = Math.max(1, Math.min(rows - 1, Math.round((rows * rows) / o.total)))
  const span = Math.max(1, o.total - rows)
  const offset = Math.max(0, Math.min(o.offset, span))
  const top = Math.round((offset / span) * (rows - thumb))
  // A HAIRLINE, not a block. `█` fills its whole cell, so beside a border it reads as a second
  // wall rather than as a position — the bar is a fact about where you are, and it has to be
  // legible without competing with the frame it sits inside.
  return Array.from({ length: rows }, (_, i) => (i >= top && i < top + thumb ? THUMB : TRACK))
}

// ---------------------------------------------------------------------------
// the new-session wizard's last step
// ---------------------------------------------------------------------------

/** What the wizard has collected so far. Only two of them are required to start anything. */
export interface SessionDraft {
  harness?: { id: string; supportsModel?: boolean }
  cwd?: string
  task?: string
  /** The name the user typed for this session. Absent means "no name of my own" — the row derives one. */
  label?: string
  prompt?: string
  model?: string
  effort?: string
}

export type SubmitPlan =
  | { ok: true; req: { harness: string; cwd: string; attach: boolean } & Record<string, unknown> }
  /** `step` is where the missing answer is given, so a refusal is a way BACK rather than a dead end. */
  | { ok: false; reason: 'no-host' | 'no-harness' | 'no-cwd'; step?: 'harness' | 'where' }

/**
 * What pressing the last `enter` of the wizard should do — PURE.
 *
 * It exists because the component's version returned SILENTLY when it had nothing to spawn with:
 * `if (!spawn || !draft.harness || !draft.cwd) return`. The final keystroke of a six-step wizard
 * did nothing at all, with no way to tell a dead key from a slow one — and the prompt someone had
 * just typed was still on screen, about to be thrown away by whatever they pressed next.
 *
 * Every refusal now NAMES itself and, where there is one, names the step that takes the missing
 * answer. The caller reports it and stays put; nothing typed is discarded.
 */
export function planSubmit(o: {
  draft: SessionDraft
  hasSpawn: boolean
  attach: boolean
}): SubmitPlan {
  if (!o.hasSpawn) return { ok: false, reason: 'no-host' }
  if (!o.draft.harness) return { ok: false, reason: 'no-harness', step: 'harness' }
  if (!o.draft.cwd) return { ok: false, reason: 'no-cwd', step: 'where' }
  return {
    ok: true,
    req: {
      harness: o.draft.harness.id,
      cwd: o.draft.cwd,
      attach: o.attach,
      // Only what was actually answered travels: an empty model is not a model called "".
      ...(o.draft.model ? { model: o.draft.model } : {}),
      ...(o.draft.effort ? { effort: o.draft.effort } : {}),
      ...(o.draft.prompt ? { prompt: o.draft.prompt } : {}),
      ...(o.draft.task ? { task: o.draft.task } : {}),
      ...(o.draft.label ? { label: o.draft.label } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// what every key on this screen does
// ---------------------------------------------------------------------------

export interface KeyHelp {
  /** The keystroke as a person types it. */
  keys: string
  /** Already-localized: what it does. */
  what: string
}

/**
 * Every key the sessions screen answers, in one place — PURE.
 *
 * One place because there were already two and they were drifting: the footer names a handful of
 * keys chosen for width, and the keys themselves live in a long if-chain. Neither is a list anyone
 * can read. This is the list, and `ctrl+h` prints it.
 *
 * It is grouped in the order someone learns them — move, act, filter, arrange — rather than
 * alphabetically, because a reference sorted by character is a reference you can only use if you
 * already know what you are looking for.
 */
export function sessionKeyHelp(w: {
  move: string; open: string; attach: string; menu: string; section: string
  newSession: string; search: string; clear: string; kill: string; rename: string
  note: string; task: string; mark: string; onlyActive: string; closed: string
  exited: string; group: string; layout: string; detail: string; menuFold: string
  reset: string; tabs: string; help: string; quit: string
  approve: string; prompt: string; reopenFell: string
}): KeyHelp[] {
  return [
    { keys: '↑ ↓ / j k', what: w.move },
    { keys: 'enter', what: w.menu },
    { keys: 'o', what: w.attach },
    // The two that act on a session WITHOUT entering it, listed right under the one that enters it:
    // they answer the same question ("this one needs me") in the two cheaper ways.
    { keys: 'y', what: w.approve },
    { keys: 'p', what: w.prompt },
    { keys: 'R', what: w.reopenFell },
    { keys: 'tab', what: w.open },
    { keys: '1-9 / ← →', what: w.section },
    { keys: 'a', what: w.newSession },
    { keys: 'ctrl+f', what: w.search },
    { keys: 'esc', what: w.clear },
    { keys: 'x', what: w.kill },
    { keys: 'n', what: w.rename },
    { keys: 't', what: w.note },
    { keys: 'space', what: w.mark },
    { keys: 'ctrl+a / l', what: w.onlyActive },
    { keys: 'c', what: w.closed },
    { keys: 'e', what: w.exited },
    { keys: 'v', what: w.group },
    { keys: 'ctrl+g', what: w.layout },
    { keys: 'd', what: w.detail },
    // `b` leads: `ctrl+b` is tmux's default prefix, so inside a tmux the chord never reaches this
    // app at all. The plain letter is the one that always works, and the one the footer names.
    { keys: 'b / ctrl+b', what: w.menuFold },
    { keys: 'ctrl+r', what: w.reset },
    { keys: '[ ]', what: w.tabs },
    { keys: '?', what: w.help },
    { keys: 'q', what: w.quit },
  ]
}

/** The width the keystroke column needs, so the descriptions line up — PURE. */
export function keyHelpColumn(rows: readonly KeyHelp[]): number {
  return rows.reduce((n, r) => Math.max(n, r.keys.length), 0)
}

// the card grid
// ---------------------------------------------------------------------------

/**
 * How the fleet is ARRANGED — the same rows, two shapes.
 *
 * The list is the right shape for scanning forty sessions and the wrong shape for reading one:
 * what a session is saying, which model it runs, the note left on it and how long it has been
 * going exist only in the detail pane, one selection at a time. A card carries them all at once.
 */
export type SessionLayout = 'list' | 'cards'

/**
 * The most cards one page may hold.
 *
 * A CAP rather than a page size: ten cards rarely fit — at 130x30 the pane carries six — and a
 * fixed ten would have to SCROLL inside the page, which is two mechanisms for reaching one card.
 * The page is what the grid can actually show, and on a terminal that can carry ten it is ten.
 */
export const CARD_PAGE_MAX = 10

/**
 * The layouts, in the order the menu lists them.
 *
 * A `const` array rather than a literal inside `asideRows`, for the same reason `SESSION_STATES`
 * is one: a layout added later shows up as a missing row rather than as a menu that silently
 * cannot reach it.
 */
export const LAYOUTS: readonly SessionLayout[] = ['list', 'cards'] as const

/** One column between two cards. The frames already separate them; a wider gutter is spent air. */
export const CARD_GAP = 1

/**
 * The narrowest card worth drawing, frame included.
 *
 * `PANE_FRAME_X` of that is border and padding, so the floor leaves 24 columns for a name — below
 * which every card is an ellipsis and the grid says less than the list it replaced.
 */
export const CARD_MIN_WIDTH = 28

/**
 * The widest a card is allowed to grow, so a fleet of three on a 200-column terminal draws three
 * readable cards rather than three billboards. The same bounded-growth rule the aside menu follows.
 */
export const CARD_MAX_WIDTH = 46

/**
 * Content lines a full card carries: name, state, usage, the context gauge, where, model, and what
 * it is filed under.
 *
 * SEVEN, and it got there twice for different reasons — the MODEL took a line of its own (it used
 * to ride the `where` line as ` · opus`, where a bare word after a folder name reads as another
 * folder), and the context GAUGE took one because it is a shape rather than a word and sharing a
 * row with `12.4k $0.83` made it read as one more figure in a run of figures.
 *
 * It is a CEILING, not a demand: `cardGrid` takes `min(fullHeight, what the band affords)` and
 * `fitCardLines` cuts from the bottom, so a short terminal draws exactly the cards it drew before
 * and loses the same trailing lines. What changes is only that a tall one may say more.
 */
export const CARD_LINES = 7

/** The fewest a card is worth: the name, the state, and one fact. Below that it is a list row. */
export const CARD_MIN_LINES = 3

export interface CardGrid {
  /** Cards across. */
  cols: number
  /** Rows of cards. */
  rows: number
  /** Columns per card, FRAME INCLUDED. */
  cardWidth: number
  /** Rows per card, FRAME INCLUDED. */
  cardHeight: number
  /** Columns between two cards. */
  gap: number
  /** How many cards one page holds — `cols * rows`, never above `CARD_PAGE_MAX`. */
  capacity: number
}

/**
 * The grid a region can carry — PURE, and `null` when it cannot carry one whole card.
 *
 * `null` is a real answer, not a failure: on a short or narrow terminal the screen falls back to
 * the list, which is the same degradation the aside menu makes when it is dropped rather than
 * squeezed. A grid drawn into a region too small for it is composited over the rows below.
 *
 * The shape is decided by the FLEET rather than by the cap: a 6x2 grid holding three sessions is
 * three cards and nine holes. So the rows are the fewest that can carry what will be shown, the
 * columns are the fewest that can place them in those rows, and every column left over is spent
 * making the cards WIDER rather than making more of them.
 */
export function cardGrid(o: {
  width: number
  height: number
  total: number
  /**
   * The most lines any card on screen will actually draw, when the caller has counted them.
   *
   * A card is as tall as the band affords and never taller than it has content for — the rule this
   * function already followed against the CONSTANT, and which the constant alone cannot keep: a
   * fleet whose richest session records no model, no task and no note draws four lines into a
   * six-line frame, and two rows of blank inside a frame are not a card, they are a box with a name
   * in it. Counted, those rows go back to the region and another band fits on the page.
   */
  lines?: number
  /**
   * Whether the grid will draw a group HEADING over its bands.
   *
   * A band's real cost is its cards plus the name over them, and sizing as though a band were only
   * its cards is what made the grouped grid page four times over: the ceiling was measured for a
   * region that then had to pay a row per band out of the same rows. Counted here, one row per
   * band, the cards give up a line and the page carries a group more.
   *
   * It is the ARITHMETIC of a band, not a rule of thumb — the same `+ PANE_FRAME_Y` this function
   * already pays for a frame, for the row a heading occupies.
   */
  headings?: boolean
}): CardGrid | null {
  const width = Math.max(0, o.width)
  const height = Math.max(0, o.height)
  const head = o.headings ? 1 : 0
  const floorHeight = PANE_FRAME_Y + CARD_MIN_LINES + head
  const fullHeight = PANE_FRAME_Y
    + Math.max(CARD_MIN_LINES, Math.min(CARD_LINES, o.lines ?? CARD_LINES))
  if (width < CARD_MIN_WIDTH || height < floorHeight) return null

  // How many the region could carry at the floor — the ceiling on everything below.
  const maxCols = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)))
  const maxRows = Math.max(1, Math.floor(height / floorHeight))
  const want = Math.max(1, Math.min(Math.max(0, o.total), CARD_PAGE_MAX))

  const rows = Math.max(1, Math.min(maxRows, Math.ceil(want / maxCols)))
  const cols = Math.max(1, Math.min(maxCols, Math.ceil(want / rows)))
  // The floor is unreachable — `cols <= maxCols` guarantees it — and stated anyway, because this is
  // the one line whose being wrong truncates every card by the frame it was measured against.
  const cardWidth = Math.max(
    CARD_MIN_WIDTH,
    Math.min(CARD_MAX_WIDTH, Math.floor((width - CARD_GAP * (cols - 1)) / cols)),
  )
  // As tall as the band affords, never taller than the card has content for: rows of blank inside
  // a frame are not a card, they are a box with a name in it. `- head` is the row the name over the
  // band takes — the cards of a headed grid are shorter by exactly what their headings cost, and
  // `rows <= maxRows` is what keeps the result at or above the floor.
  const cardHeight = Math.min(fullHeight, Math.floor(height / rows) - head)

  return {
    cols, rows, cardWidth, cardHeight, gap: CARD_GAP,
    capacity: Math.min(cols * rows, CARD_PAGE_MAX),
  }
}

/**
 * One horizontal BAND of a card page: a group's name, or a row of that group's cards.
 *
 * A band belongs to exactly ONE group. That is the whole model: a group opens a band with its name
 * and its cards fill the bands under it, and a group with one card leaves the rest of its band
 * EMPTY. The air to the right of a short group is not waste — it is what separates one group from
 * the next, and filling it with the following group's cards is precisely how the grid used to
 * ignore the grouping it was drawn under. (The control center's "air under a pane is a fault" rule
 * is about air OUTSIDE a region; this air is inside the band and is doing work.)
 */
export type CardBand =
  /** `muted` is the list's own reading: an absent key, a finished task, the history section. */
  | { kind: 'heading'; label: string; count: number; muted: boolean }
  /**
   * Indexes into the flat card sequence — at most `cols` of them, all from one group — and the rows
   * this band occupies, FRAME INCLUDED.
   *
   * The height is the BAND's, not the grid's, and that is the point: a single grid height is the
   * height of the richest card in the whole fleet, so one session carrying a note and a model made
   * every card on screen two rows taller than it had anything to put in them. Rows of blank inside a
   * frame are not a card, they are a box with a name in it.
   *
   * It is the band and not the card because the cards of one band stand side by side: giving each
   * its own height leaves the bottom edge of the row ragged, which is a worse thing to look at than
   * the one blank line a short card beside a rich one still keeps.
   */
  | { kind: 'cards'; items: number[]; height: number }

export interface CardPage {
  bands: CardBand[]
  /** Every card index on this page, in order — what the pager counts. */
  items: number[]
}

/** Rows a page's bands occupy: one per heading, its own height per row of cards — PURE. */
export function cardPageRows(bands: readonly CardBand[]): number {
  return bands.reduce((n, b) => n + (b.kind === 'heading' ? 1 : Math.max(1, b.height)), 0)
}

/**
 * The fleet split into pages of bands — PURE, and the ONE arithmetic the grid is drawn from.
 *
 * It walks the very `SessionRow[]` the LIST draws, so what a group is called, which ones are muted
 * and where the history section begins are decided once, in `sessionRows`, for both layouts. Working
 * the grouping out a second way here is a second implementation of it, and the two would disagree
 * the first time either changed.
 *
 * Two rules paying for themselves:
 *
 *  - **A heading is never placed without a row of cards under it.** They go onto a page together or
 *    neither does, so no page ever ends with a name and nothing named.
 *  - **A group that crosses a page boundary REPEATS its name at the top of the next page.** Within
 *    one page the name sits a band or two above and plainly governs the bands under it, so it is
 *    said once; across a break it is gone, and a card under no name does not say what it belongs
 *    to. The repeated heading carries the group's own count, not the count on this page — it is the
 *    same statement the list makes, and the pager already says how much of the fleet is on screen.
 *
 * `headed: false` — a grouping of `none`, or a band too short to spend a row on a name — packs the
 * whole fleet as one nameless group, which is exactly the dense grid this screen drew before.
 *
 * Each band is also SIZED here, to the tallest card in it and no taller, which is why the rows it
 * gives back turn into more bands on the page rather than into air.
 */
export function cardPages(o: {
  /** The rows the list would draw, headings and spacers included. */
  rows: readonly SessionRow[]
  cols: number
  /** Rows the grid region has, pager already paid for. */
  gridRows: number
  /** The TALLEST a band may be — the ceiling the region affords, from `cardGrid`. */
  cardHeight: number
  /**
   * How many lines each card has to draw, by card index — see `cardLines`.
   *
   * Absent, every band takes the ceiling, which is the uniform grid this screen drew before.
   */
  lines?: readonly number[]
  /** The most cards one page may hold — see `CARD_PAGE_MAX`. */
  capacity: number
  headed: boolean
}): CardPage[] {
  const cols = Math.max(1, o.cols)
  const cardHeight = Math.max(1, o.cardHeight)
  const cap = Math.max(1, o.capacity)
  const budget = Math.max(0, o.gridRows)
  /**
   * The rows a band of these cards needs: its tallest card's lines plus the frame, never below the
   * floor that makes a card a card, never above what the region affords.
   */
  const heightOf = (chunk: readonly number[]): number => {
    if (!o.lines) return cardHeight
    const most = chunk.reduce((n, i) => Math.max(n, o.lines![i] ?? 0), 0)
    return Math.min(cardHeight, Math.max(PANE_FRAME_Y + CARD_MIN_LINES, PANE_FRAME_Y + most))
  }

  type Head = { label: string; count: number; muted: boolean }
  const sections: Array<{ head: Head | null; items: number[] }> = []
  let index = 0
  for (const row of o.rows) {
    if (row.kind === 'spacer') continue
    if (row.kind === 'heading') {
      // Unheaded, every row joins ONE nameless section, so nothing wraps early and the layout is
      // byte-for-byte the one this screen drew before groups reached it.
      if (o.headed) sections.push({ head: { label: row.label, count: row.count, muted: row.muted === true }, items: [] })
      continue
    }
    const last = sections[sections.length - 1]
    if (last && (o.headed || last.head === null)) last.items.push(index)
    else sections.push({ head: null, items: [index] })
    index++
  }

  const pages: CardPage[] = []
  let bands: CardBand[] = []
  let items: number[] = []
  let used = 0
  const flush = () => {
    if (items.length > 0) pages.push({ bands, items })
    bands = []
    items = []
    used = 0
  }

  for (const section of sections) {
    // Whether THIS page already carries this section's name. Reset by every page break, which is
    // what makes a split group say its name again.
    let named = false
    for (let i = 0; i < section.items.length; i += cols) {
      const chunk = section.items.slice(i, i + cols)
      const height = heightOf(chunk)
      const cost = () => (section.head && !named ? 1 : 0) + height
      // A page break is the only way to make room, so it is only ever taken while there is
      // something to break away from — the loop always terminates.
      if (items.length > 0 && (used + cost() > budget || items.length + chunk.length > cap)) {
        flush()
        named = false
      }
      if (section.head && !named) {
        bands.push({ kind: 'heading', ...section.head })
        used += 1
        named = true
      }
      bands.push({ kind: 'cards', items: chunk, height })
      items.push(...chunk)
      used += height
    }
  }
  flush()
  return pages
}

/** Which page holds a card — PURE. `0` for an index no page carries, which is the first frame. */
export function pageOfCard(pages: readonly CardPage[], index: number): number {
  const at = pages.findIndex(p => p.items.includes(index))
  return at < 0 ? 0 : at
}

// ---------------------------------------------------------------------------
// what a card says
// ---------------------------------------------------------------------------

/**
 * The group each card belongs to, in the order the cards are drawn — PURE.
 *
 * Taken from the HEADING the list would have drawn above that row, never re-derived from the
 * session: `sessionRows` already decides what a group is called, including the history section, a
 * finished task's suffix and the localized word for an absent key. Working it out a second way is a
 * second implementation of the grouping, and the two would disagree the first time either changed.
 *
 * With grouping off there is no heading, and the card falls back to the project — the fact every
 * session already carries. A blank badge is a frame with a gap in it.
 *
 * Read ONLY where the grid draws no group headings: with a heading over the band, the same name on
 * every card under it is a column of one word, which is why the list drops its `task` cell while
 * grouping by task. One of the two says it, never both and never neither.
 */
export function cardBadges(rows: readonly SessionRow[]): string[] {
  const out: string[] = []
  let heading = ''
  for (const row of rows) {
    if (row.kind === 'heading') { heading = row.label; continue }
    if (row.kind !== 'session') continue
    out.push(heading || row.session.projectGroup || row.session.project)
  }
  return out
}

/** What a card line IS, so the component can colour it without parsing it back.
 *
 *  `gauge` is its own kind rather than a `fact` for exactly that reason: its colour depends on the
 *  LEVEL it is showing, which no other line's does, and the component must not have to re-derive
 *  that by parsing the text back out of the line. */
export type CardLineKind = 'title' | 'state' | 'fact' | 'say' | 'gauge'

export interface CardLine {
  key: string
  kind: CardLineKind
  text: string
  /**
   * What this line IS, already localized — drawn dim in front of the value.
   *
   * Only on the lines a reader cannot name from the value alone. A card is narrow and the list
   * solves this with a column HEADER the grid has no room for, so the naming moves onto the row:
   * `session-monitor` and `cockpit: canal de eventos` are a folder and a task, drawn identically,
   * and nothing on the card said which was which.
   *
   * Absent on the lines that say what they are: the name is the card's first line and its only bold
   * one, the state word is coloured and unique, and `51.7k $1.24 · há 10h` names its own units.
   * Rotulating those would spend the width that makes the ambiguous ones readable.
   */
  label?: string
  /** Drawn dim on the same row, after `text`. Given up first when the card is narrow. */
  tail?: string
  /** Only on a `gauge` line: how full, so the component colours it without parsing `text` back. */
  level?: ContextLevel
}

/** The already-localized words a card needs. This module owns no strings. */
export interface CardLabels {
  /** Said on a session whose terminal is currently handed over. */
  attached: string
  /** Short caveat for a harness with no probed approval markers. */
  blind: string
  /**
   * The names of the facts, from the very table the list's column header prints (`sessionsCols`).
   *
   * The same words on purpose: the two layouts are one screen in two shapes, and a card that called
   * the folder something the header does not would be a second vocabulary to learn.
   */
  worktree: string
  project: string
  task: string
  note: string
  model: string
  ago: (startedAt: number) => string
}

/** Columns between a card's label and its value. */
export const CARD_LABEL_GAP = 2

/**
 * Below this a labelled card says LESS than an unlabelled one: `worktree  sess…` names the field and
 * stops answering which one, which is the trade the labels exist to avoid.
 */
export const CARD_VALUE_MIN = 10

/**
 * The column the labels are drawn in, or `0` to draw none — PURE.
 *
 * All-or-nothing per CARD rather than per line, and that is the whole point: labels that come and go
 * down a card leave the values starting at different columns, which is the jumble `sessionColumns`
 * exists to prevent on the list. So either every fact is named and aligned, or none is.
 *
 * Dropping them is the right degradation because a label never removes a line — it only narrows the
 * value. A card too narrow to carry both keeps the values whole and gives up the naming, which is
 * exactly what the list does when it drops its header row.
 */
export function cardLabelWidth(lines: readonly CardLine[], width: number): number {
  const widest = lines.reduce((n, l) => Math.max(n, (l.label ?? '').length), 0)
  if (widest === 0) return 0
  return width - widest - CARD_LABEL_GAP >= CARD_VALUE_MIN ? widest : 0
}

/**
 * Everything a card can say about one session, most identifying first — PURE.
 *
 * The order IS the give-up order: `fitCardLines` cuts from the bottom, so the name and the state
 * are the two a card can never lose — the name because a card you cannot identify is not one you
 * can act on, the state because nothing else on the frame says whether this session is waiting for
 * you.
 *
 * A fact that was never recorded is an ABSENT line, never a zero: a harness that cannot report
 * usage would otherwise show every one of its sessions costing nothing, in the very place a person
 * looks to decide what to close. Same rule the detail pane and `sessionMetric` already follow.
 */
export function cardLines(
  s: ControlSession,
  labels: CardLabels,
  /**
   * The name of the band this card sits under, when there is one.
   *
   * A fact whose value IS that name is dropped: under a heading reading `agentistics`, a line
   * reading `project  agentistics` spends one of four rows saying what the row above already said,
   * and the row it costs is the one that would have carried the model or the task. The same rule
   * `sessionColumns` applies to its `task` cell while grouping by task, one line lower down.
   *
   * Matched on the drawn LABEL, so a composite heading (`agentistics · closed`) keeps the line: it
   * is not the same word, and dropping a fact because a heading merely contains it would be a card
   * withholding something nothing on screen says.
   */
  group = '',
): CardLine[] {
  const marks = [
    s.attached ? labels.attached : '',
    s.approvalBlind ? labels.blind : '',
  ].filter(Boolean)
  const tail = [s.harness, ...marks].filter(Boolean).join(' · ')

  const out: CardLine[] = [
    { key: 'title', kind: 'title', text: s.title },
    { key: 'state', kind: 'state', text: s.stateLabel, ...(tail ? { tail: ` · ${tail}` } : {}) },
  ]

  const usage = [sessionMetric(s), s.startedAt !== undefined ? labels.ago(s.startedAt) : '']
    .filter(Boolean).join(' · ')
  if (usage) out.push({ key: 'usage', kind: 'fact', text: usage })

  // The gauge gets its OWN line rather than joining the usage one. A card is read one line at a
  // time and the bar is the only thing on it that is a shape rather than a word — sharing a line
  // with `12.4k $0.83` would make it read as one more figure in a run of figures, which is exactly
  // the glance it exists to shortcut. It sits directly under the usage because it is the same
  // subject, and above `where` because it is a fact about the session rather than its address.
  if (s.context) {
    out.push({
      key: 'context',
      kind: 'gauge',
      text: sessionContext(s),
      level: contextLevel(s.context.fraction),
    })
  }

  // WHERE, and which checkout of it: with several worktrees of one repository open at once, the
  // folder name is the only thing telling them apart — and the label says WHICH of the two kinds of
  // place this is, since a worktree's name and a project's name are the same shape of word.
  const said = (text: string) => text !== '' && text !== group
  const worktree = worktreeName(s)
  const where = worktree || s.projectGroup || s.project
  if (said(where)) {
    out.push({
      key: 'where', kind: 'fact', text: where,
      label: worktree ? labels.worktree : labels.project,
    })
  }
  // The MODEL on its own line rather than trailing the folder: appended there it was a bare word
  // after a path, which reads as another path.
  if (said(s.model ?? '')) out.push({ key: 'model', kind: 'fact', text: s.model!, label: labels.model })

  if (said(s.task ?? '')) out.push({ key: 'task', kind: 'fact', text: s.task!, label: labels.task })
  if (s.note) out.push({ key: 'note', kind: 'fact', text: s.note, label: labels.note })

  // What it is SAYING, last, because it is the line a short card gives up first — and the only one
  // that would be invented if it were not there. Present only for a session agentop hosts.
  const say = s.lastLines?.[0]
  if (say) out.push({ key: 'say', kind: 'say', text: say })

  return out
}

/** The lines that fit, cut from the BOTTOM — so the name and the state are the two that survive. */
export function fitCardLines(lines: readonly CardLine[], rows: number): CardLine[] {
  return lines.slice(0, Math.max(0, rows))
}

/**
 * The state row's two halves, fitted — PURE.
 *
 * The state WORD is what a card may never give up, exactly as `sessionCells` keeps it for a row:
 * the harness is said again by the card's colour, the markers are said again by the detail pane,
 * but nothing else on the card says whether this session is waiting for you.
 */
export function cardStateCells(state: string, tail: string, width: number): {
  state: string
  tail: string
} {
  const room = Math.max(0, width)
  if (state.length + tail.length <= room) return { state, tail }
  if (state.length <= room) return { state, tail: '' }
  return { state: truncateCell(state, room), tail: '' }
}

// ---------------------------------------------------------------------------
// the card band, its pager, and where a click lands
// ---------------------------------------------------------------------------

/**
 * How the list pane's rows are split between the grid and its pager — PURE.
 *
 * The column HEADER is reclaimed: it names cells (`state`, `task`, `harness`) that a card does not
 * have, so drawing it over a grid would be a heading over nothing. The PAGER is a row like any
 * other and is paid for out of the same band — a row taken without being paid for is composited
 * onto the frame below it, which reads as a corrupted frame rather than a cramped one.
 *
 * The pager is given up before the grid: a page you cannot leave is worse than one you cannot
 * count, and the keys still turn the page.
 */
export function cardBand(o: { listRows: number; header: boolean }): {
  gridRows: number
  pager: boolean
} {
  const available = Math.max(0, o.listRows) + (o.header ? 1 : 0)
  const pager = available >= PANE_FRAME_Y + CARD_MIN_LINES + 1
  return { gridRows: Math.max(0, available - (pager ? 1 : 0)), pager }
}

/**
 * Which card a click landed on — PURE, and resolved against the very BANDS that were drawn.
 *
 * Against the bands rather than against a uniform `cols × cardHeight` grid, because with grouping on
 * the page is no longer uniform: a heading costs one row and a short group leaves the right of its
 * band empty. Re-deriving the geometry from `cols` alone answers with the card one row up, or with a
 * card that is not there.
 *
 * The gutter between two cards belongs to neither, a heading row belongs to no card, and the empty
 * right-hand end of a short group's band is not a card either: each returns `null`, because
 * answering a click the user did not make is worse than not answering at all.
 */
export function cardHit(o: {
  bands: readonly CardBand[]
  cardWidth: number
  gap: number
  x: number
  y: number
}): number | null {
  if (o.x < 0 || o.y < 0) return null
  let top = 0
  for (const band of o.bands) {
    if (band.kind === 'heading') {
      if (o.y === top) return null
      top += 1
      continue
    }
    const height = Math.max(1, band.height)
    if (o.y < top + height) {
      const stride = o.cardWidth + o.gap
      const col = Math.floor(o.x / stride)
      // The gap AFTER a card belongs to the gutter, not to the card in front of it.
      if (o.x - col * stride >= o.cardWidth) return null
      return band.items[col] ?? null
    }
    top += height
  }
  return null
}

/** Every band of cards, across every page, in drawing order — the sequence `↑`/`↓` walk. */
export function cardRows(pages: readonly CardPage[]): number[][] {
  return pages.flatMap(p => p.bands.flatMap(b => (b.kind === 'cards' ? [b.items] : [])))
}

/**
 * Where `↑`/`↓` land from a card — PURE.
 *
 * Stepping by `cols` was right while every band was full and is wrong the moment a group is shorter
 * than the grid is wide: `↓` from the only card of a one-card group jumped over the whole band
 * underneath it. So the move is band to band, keeping the COLUMN — and clamped to the last card of a
 * shorter band rather than falling off it.
 *
 * It walks every page, not just the open one, because the page FOLLOWS the cursor: stepping off the
 * bottom band is how you reach the next page, and there is no second position to keep in step.
 */
export function cardStep(pages: readonly CardPage[], index: number, dy: number): number {
  const rows = cardRows(pages)
  let at = -1
  let col = 0
  rows.forEach((row, i) => {
    const found = row.indexOf(index)
    if (found >= 0) { at = i; col = found }
  })
  if (at < 0) return index
  const target = rows[Math.max(0, Math.min(at + dy, rows.length - 1))]
  if (!target || target.length === 0) return index
  return target[Math.min(col, target.length - 1)] ?? index
}

export interface PagerCells {
  /** `''` when the row is too narrow to carry the arrows at all. */
  prev: string
  next: string
  label: string
  /** How many of how many. The first cell given up. */
  note: string
  /** Column each arrow is drawn at, or `-1` when it is not drawn. */
  prevAt: number
  nextAt: number
  /** What the row actually occupies — never more than the width it was measured against. */
  width: number
}

/** The glyphs, so the drawn row and the hit test cannot disagree about their width. */
const PAGER_PREV = '‹'
const PAGER_NEXT = '›'

/**
 * The pager row, fitted — PURE.
 *
 * Cells are given up in the order the row can afford to lose them: the COUNT first (the page label
 * already says where you are), then the arrows (the keys still work, and the footer names them),
 * and the page label last — a pager that cannot say which page this is has stopped being a pager.
 */
export function pagerCells(o: { label: string; note: string; width: number }): PagerCells {
  const width = Math.max(0, o.width)
  const none: PagerCells = {
    prev: '', next: '', label: '', note: '', prevAt: -1, nextAt: -1, width: 0,
  }
  if (width === 0) return none

  const arrows = 4 + o.label.length // "‹ label ›"
  if (arrows <= width) {
    const nextAt = 2 + o.label.length + 1
    const noteAt = nextAt + 3
    const withNote = noteAt + o.note.length <= width && o.note !== ''
    return {
      prev: PAGER_PREV, next: PAGER_NEXT, label: o.label,
      note: withNote ? o.note : '',
      prevAt: 0, nextAt,
      width: withNote ? noteAt + o.note.length : arrows,
    }
  }
  const label = o.label.length <= width ? o.label : o.label.slice(0, width)
  return { ...none, label, width: label.length }
}

/** Which arrow a click landed on, resolved against the very cells that were drawn. */
export function pagerHit(cells: PagerCells, x: number): 'prev' | 'next' | null {
  if (cells.prev !== '' && x === cells.prevAt) return 'prev'
  if (cells.next !== '' && x === cells.nextAt) return 'next'
  return null
}

// ---------------------------------------------------------------------------
// closing a session from its own row
// ---------------------------------------------------------------------------

/**
 * The control that closes a session from its own row.
 *
 * A bare `✕` at the end of a table reads as a TRUNCATION mark, not as a verb — which is what it was
 * reported as. A wastebasket would say it plainly, and it is what the design asked for, but it
 * cannot be measured here: `truncate` counts `s.length`, which is UTF-16 code UNITS, and there is no
 * width dependency anywhere in this package. `🗑` is a surrogate pair, so `.length` is 2, while its
 * DISPLAY width is 1 or 2 depending on the terminal and on whether it is given emoji presentation.
 * Neither number is reliably the other, and a glyph whose measure is wrong by one shears every row
 * under it.
 *
 * So it is bracketed ASCII: three characters, `.length === 3`, three columns, on every terminal.
 * The design named this trade itself — a pretty glyph that shears the table is worse than a plain
 * one that does not. Revisit it the day this package measures display width.
 */
export const CLOSE_CELL = '[x]'

/**
 * Columns reserved at the right edge of the list for the per-row close control — PURE.
 *
 * **Always zero: the control is gone.** Kept as a function rather than deleted so the width
 * arithmetic still has one place that says what the right edge costs, and so a future control there
 * has somewhere to declare itself instead of being sprinkled through the callers.
 *
 * Removed because it did not make sense where it sat. Every other verb on this screen is reached
 * from the menu or a key, and a table's last column is where a VALUE goes — so a control parked
 * there reads as a truncated cell until you happen to click it. It also put the most destructive
 * question on the screen exactly where a reader's eye lands after skimming a row.
 *
 * Nothing was taken away but the button: `x` still closes the selected session, and the menu still
 * offers it in words.
 */
export function closeCellWidth(_rows: readonly ControlSession[], _width: number): number {
  return 0
}

/**
 * Can this row be closed at all?
 *
 * Only a session agentop HOSTS: an external process is someone else's to stop, and a closed
 * conversation has nothing running to end. A row that cannot take it draws no glyph — a control
 * that is visible and refuses is worse than one that is absent.
 */
export function canClose(s: ControlSession): boolean {
  return s.actionable && s.state !== 'closed' && s.state !== 'exited'
}
