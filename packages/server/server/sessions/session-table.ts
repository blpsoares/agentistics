/**
 * session-table.ts — PURE. The sessions table, drawn as plain terminal lines.
 *
 * This is the cockpit's table printed instead of mounted: `agentop session ls` asks the same
 * question the Sessions tab answers ("what is running, grouped by where I am working") and a person
 * reading a log wants the same aligned columns and the same section headings. What changes is the
 * DRAWING — ANSI written once to stdout rather than Ink components repainted — and nothing else.
 *
 * So every rule about what a row IS lives in `@agentistics/tui/control/sessions` and is consumed
 * here: `sessionColumns` measures the page, `groupSessions` + `sessionRows` decide the sections and
 * the air between them, `sessionHandle` / `worktreeName` / `sessionMetric` / `padCell` fill the
 * cells. A second implementation of any of them is a second set of rules that agree until the day
 * they do not — this repository has already paid for that once, with a task `open` written twice
 * that left the registry in two different states depending on which one you pressed.
 *
 * Two things ARE this module's own, because they are drawing:
 *
 *  - **Nothing may exceed the width.** Ink truncates an over-wide row with `wrap="truncate"`; a
 *    terminal wraps it, and a wrapped row shears every column under it. `sessionColumns` fits the
 *    row for every width a person actually uses, but at ~20 columns its own floor (the state word
 *    plus a one-character title) is already wider than the terminal — so the last step here CLIPS,
 *    counting only visible characters.
 *  - **Colour is optional and is never measured.** It is applied to a cell that is already padded,
 *    so a pipe and a terminal are the same table with the same column positions.
 */

import {
  DEFAULT_ORDER,
  groupSessions,
  padCell,
  sessionColumns,
  sessionHandle,
  sessionMetric,
  sessionRows,
  worktreeName,
  type SessionColumns,
  type SessionGrouping,
  type SessionOrder,
} from '@agentistics/tui/control/sessions'
import type { ControlSession, SessionState } from '@agentistics/tui/control'

/**
 * The words the table wears. Supplied by the caller, already localized — the same split every pure
 * module in the control center keeps, and the reason `agentop session ls` can print the very
 * headings the cockpit prints without either of them owning a copy of the other's strings.
 */
export interface SessionTableStrings {
  cols: Record<keyof SessionColumns, string>
  unknown: { harness: string; model: string; project: string; task: string; repo: string }
  /** Heads the block of conversations that are not running. */
  closed: string
  /** Marks a task the user finished, on its heading. */
  done: string
}

// ---------------------------------------------------------------------------
// colour
// ---------------------------------------------------------------------------

const ESC = '\x1b'
const RESET = `${ESC}[0m`
const DIM = `${ESC}[2m`
const CYAN = `${ESC}[36m`

/**
 * The state palette, mirroring the cockpit's `STATE_COLOR` intent in the sixteen colours a plain
 * terminal is guaranteed to have.
 *
 * The theme's hex values are not reused directly: Ink resolves them through chalk, which downgrades
 * per terminal, and writing a truecolor escape ourselves would render as nothing on a terminal that
 * does not speak it — on the one cell of the row that nothing else repeats.
 */
const STATE_ANSI: Record<SessionState, string> = {
  'waiting-approval': `${ESC}[1;31m`,
  waiting: `${ESC}[33m`,
  working: `${ESC}[32m`,
  exited: DIM,
  lost: DIM,
  unknown: DIM,
  closed: DIM,
}

/** One piece of a line: its text, and the escape that colours it when colour is on. */
interface Seg {
  text: string
  code?: string
}

/**
 * Segments to one line, clipped to `width` — the only place a line is finished.
 *
 * Clipping counts the TEXT, never the escapes, so a coloured table and a piped one break in exactly
 * the same column. A segment that straddles the edge is cut; the ones after it are dropped whole.
 */
export function composeLine(segs: readonly Seg[], width: number, color: boolean): string {
  let left = Math.max(0, width)
  const kept: Seg[] = []
  for (const seg of segs) {
    if (left === 0) break
    const text = seg.text.length > left ? seg.text.slice(0, left) : seg.text
    if (text === '') continue
    left -= text.length
    kept.push({ text, ...(seg.code ? { code: seg.code } : {}) })
  }

  // The last cell's padding is blanks nobody can see, and it is what makes two identical rows differ
  // in a diff. Trimmed on the TEXT, before any escape is applied — a trailing space wrapped in a
  // colour would survive a trim of the finished string, so a coloured table and a piped one would
  // not end in the same place.
  while (kept.length > 0) {
    const last = kept[kept.length - 1]!
    last.text = last.text.replace(/\s+$/, '')
    if (last.text !== '') break
    kept.pop()
  }

  return kept.map(s => (color && s.code ? `${s.code}${s.text}${RESET}` : s.text)).join('')
}

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

export interface SessionTableOptions {
  sessions: readonly ControlSession[]
  /** Columns available. See `naturalWidth` for what a pipe gets instead of a terminal's. */
  width: number
  grouping: SessionGrouping
  strings: SessionTableStrings
  color: boolean
  /** Tasks the user marked finished — their headings say so. */
  doneTasks?: readonly string[]
  order?: SessionOrder
}

/**
 * A width no row reaches, for output that is not going to a terminal.
 *
 * A pipe has no width, and inventing one truncates a session's name to fit a terminal nobody is
 * looking at. Passed as the budget, `sessionColumns` gives every column its natural size and the
 * lines come out exactly as long as their content.
 */
export const NATURAL_WIDTH = 10_000

/**
 * Why there is no table — PURE, and `null` when there is one.
 *
 * A blank where a list was expected is indistinguishable from a command that broke, so an empty run
 * has to say which of three things happened, and they are genuinely different claims:
 *
 *  - `unavailable` — the poll did not establish anything. Claiming "nothing is running" here would
 *    be a confident zero, which is the one answer this monitor may never give.
 *  - `empty` — the machine really has no sessions.
 *  - `filtered` — sessions exist and the default question ("what is running") withheld them. They
 *    are still named, still filed and still reopenable, so the caller names the flag that lists
 *    them.
 */
export function emptyReason(o: {
  /** How many rows the fleet holds, before the filter. */
  fleet: number
  /** How many are left after it. */
  shown: number
  unavailable?: string
}): 'unavailable' | 'empty' | 'filtered' | null {
  if (o.shown > 0) return null
  if (o.unavailable) return 'unavailable'
  return o.fleet === 0 ? 'empty' : 'filtered'
}

/** The whole table as lines — headings, the column header, the rows, and the air between sections. */
export function renderSessionTable(o: SessionTableOptions): string[] {
  const groups = groupSessions(
    o.sessions,
    o.grouping,
    o.strings.unknown,
    o.doneTasks ?? [],
    o.order ?? DEFAULT_ORDER,
  )
  const rows = sessionRows(groups, o.strings.closed, o.strings.done)
  if (rows.length === 0) return []

  // Measured across every row that will be PRINTED. Unlike the cockpit there is no window here —
  // the whole fleet is the page — so a long title does widen the column for all of it, which is
  // correct for a log: it is read as one block, not scrolled.
  const columns = sessionColumns(
    rows.flatMap(r => (r.kind === 'session' ? [r.session] : [])),
    o.width,
    { groupedByTask: o.grouping === 'task', headings: o.strings.cols },
  )

  // Every line except the headings, first — because a heading's rule runs to the edge of the TABLE
  // and the table is only as wide as its widest row. Ruling to the budget instead is invisible at a
  // terminal's width and absurd at a pipe's, where it drew ten thousand dashes over four sessions.
  const drawn = [headerSegs(columns, o.strings.cols), ...rows.map(
    r => (r.kind === 'session' ? rowSegs(r.session, columns) : null),
  )]
  const table = drawn.reduce(
    (n, segs) => (segs ? Math.max(n, plainWidth(segs)) : n),
    0,
  )
  const edge = Math.min(o.width, table)

  const out: string[] = [composeLine(drawn[0]!, o.width, o.color)]
  rows.forEach((row, i) => {
    const segs = drawn[i + 1]
    if (segs) { out.push(composeLine(segs, o.width, o.color)); return }
    if (row.kind === 'spacer') { out.push(''); return }
    if (row.kind === 'heading') {
      out.push(composeLine(headingSegs(row.label, row.count, edge, row.muted), o.width, o.color))
    }
  })
  return out
}

/** What these segments occupy on screen, escapes excluded — they are added after this is decided. */
function plainWidth(segs: readonly Seg[]): number {
  // Joined THEN trimmed, never per segment: the padding inside a row is real width, and only what
  // trails the last cell is the padding `composeLine` drops.
  return segs.map(s => s.text).join('').replace(/\s+$/, '').length
}

const GAP = '  '

/** The header row — the same cells, from the same measured widths, so a heading can never sit over
 *  a column it no longer names. */
function headerSegs(c: SessionColumns, words: Record<keyof SessionColumns, string>): Seg[] {
  const segs: Seg[] = [{ text: GAP }]
  if (c.id > 0) segs.push({ text: padCell(words.id, c.id) + GAP, code: DIM })
  segs.push({ text: padCell(words.state, c.state), code: DIM })
  const rest: Array<[number, string]> = [
    [c.title, words.title],
    [c.worktree, words.worktree],
    [c.task, words.task],
    [c.metrics, words.metrics],
    [c.harness, words.harness],
    [c.where, words.where],
  ]
  for (const [w, word] of rest) {
    if (w > 0) segs.push({ text: GAP + padCell(word, w), code: DIM })
  }
  return segs
}

/**
 * A section heading: its name, how many rows are under it, and a rule out to the edge.
 *
 * The rule is what makes the sections visible in a wall of scrollback. A heading dimmed to the same
 * weight as its rows is not a hierarchy — it is a list that happens to be sorted.
 */
function headingSegs(label: string, count: number, width: number, muted?: boolean): Seg[] {
  const head = `${label}  ${count}`
  const rule = Math.max(0, width - head.length - 3)
  return [
    { text: head, code: muted ? DIM : CYAN },
    ...(rule > 0 ? [{ text: `${GAP}${'─'.repeat(rule)}`, code: DIM }] : []),
  ]
}

/** One session row. The cell order and the give-up order are `sessionColumns`', not this module's. */
function rowSegs(s: ControlSession, c: SessionColumns): Seg[] {
  // Two columns where the cockpit draws its cursor and its mark. Kept rather than reclaimed: it is
  // what `sessionColumns` budgets for, and it is what leaves the rows indented under their heading.
  const segs: Seg[] = [{ text: GAP }]
  if (c.id > 0) segs.push({ text: padCell(sessionHandle(s), c.id) + GAP, code: DIM })
  segs.push({ text: padCell(s.stateLabel, c.state), code: STATE_ANSI[s.state] })
  if (c.title > 0) segs.push({ text: GAP + padCell(s.title, c.title) })
  if (c.worktree > 0) segs.push({ text: GAP + padCell(worktreeName(s), c.worktree), code: DIM })
  if (c.task > 0) segs.push({ text: GAP + padCell(s.task ?? '', c.task), code: DIM })
  if (c.metrics > 0) segs.push({ text: GAP + padCell(sessionMetric(s), c.metrics), code: DIM })
  if (c.harness > 0) segs.push({ text: GAP + padCell(s.harness, c.harness), code: CYAN })
  if (c.where > 0) {
    segs.push({ text: GAP + padCell(s.projectGroup || s.project, c.where), code: DIM })
  }
  return segs
}
