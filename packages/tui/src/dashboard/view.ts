/**
 * view.ts — PURE navigation and row arithmetic for the metrics dashboard.
 *
 * The dashboard is drawn in two places now — full-screen behind `agentop tui`, and inside the
 * control center's `dashboard` tab — so everything both of them have to agree about lives here,
 * against plain values, and neither of them holds a rule of its own. A second implementation of one
 * screen is the bug `task-reopen.ts` exists to have fixed once, and five screens is five chances to
 * make it.
 *
 * The height arithmetic is the half that is genuinely new. Full-screen, the dashboard had the whole
 * terminal and its screens simply drew what they had; inside a pane it has the terminal MINUS the
 * chrome, the frame and the screen strip, and Ink does not clip an overflowing child — it composites
 * it, so a screen one row too tall reads as a corrupted frame rather than as a cramped one. Every
 * screen therefore gets a budget it can actually spend, and each `*Plan` below states the order in
 * which its parts give way.
 */

import type { NavKey } from '../control/nav'
import type { ControlService } from '../control/types'
import { sourceRowFit, type SourceRowFit } from '../control/surface.ts'
import type { TuiStrings } from '../i18n'

/**
 * The dashboard's five screens.
 *
 * `history` is what the standalone app called `sessions`, and the rename is the whole of the fix for
 * a collision the merge created: the control center ALREADY has a `sessions` tab, and it is a
 * different thing entirely — the fleet running right now, which can be attached to, approved and
 * killed. This one is the recorded past: conversations that have finished, and what each of them
 * cost. Two names for two things, in one application, rather than the same word twice.
 *
 * It is also the word the machine already uses for exactly this material: `history` is what the
 * archive setting preserves (`archiveMode`, the config pane's `history` row), and what it preserves
 * is precisely the rows this screen lists.
 */
export type DashboardScreenId = 'overview' | 'projects' | 'history' | 'costs' | 'harnesses'

export const DASHBOARD_SCREENS: readonly DashboardScreenId[] = [
  'overview',
  'projects',
  'history',
  'costs',
  'harnesses',
] as const

/**
 * Which screen a key selects, or `null` when the key is not ours.
 *
 * THE KEYS ARE CHOSEN BY WHAT THE SHELL ALREADY OWNS, and that is the only interesting thing about
 * this function. The control center answers `←`/`→` and `[`/`]` for its TABS, `q`, `r` and `m`
 * globally; a key answered here as well would do two things at once, and only one of them could be
 * named by the footer. So:
 *
 *  - the DIGITS are free — the control center gave them up when the numbered bottom strip went away
 *    (`nav.ts`), and they belong to whatever list draws them. This screen draws them, on the strip,
 *    which is what makes them safe to press;
 *  - `tab` / `shift+tab` are free on any screen with no panes of its own, and they are what the
 *    standalone dashboard has always used to cycle screens. Keeping them is what stops the merge
 *    costing an existing user their muscle memory;
 *  - the ARROWS are deliberately NOT taken. Claiming them would mean the shell's `←→ screens` stops
 *    working here and `[`/`]` becomes the only way out of the tab — a trade the sessions cockpit
 *    makes because its arrows drive a list, and one this screen has no reason to make.
 */
export function resolveDashboardScreen(
  key: NavKey,
  current: DashboardScreenId,
): DashboardScreenId | null {
  if (key.input.length === 1) {
    const n = Number(key.input)
    if (Number.isInteger(n) && n >= 1 && n <= DASHBOARD_SCREENS.length) {
      return DASHBOARD_SCREENS[n - 1]!
    }
  }
  if (key.tab) {
    const i = DASHBOARD_SCREENS.indexOf(current)
    const step = key.shift ? DASHBOARD_SCREENS.length - 1 : 1
    return DASHBOARD_SCREENS[(i + step) % DASHBOARD_SCREENS.length]!
  }
  return null
}

/** The screen names, in strip order. */
export function screenLabels(s: TuiStrings): Record<DashboardScreenId, string> {
  return {
    overview: s.overview,
    projects: s.projects,
    history: s.history,
    costs: s.costs,
    harnesses: s.harnesses,
  }
}

/**
 * The strip's cells: the digit that reaches each screen, then its name.
 *
 * The number is drawn rather than merely documented for the same reason the log viewer numbers its
 * sources — a shortcut nobody can see is a shortcut nobody uses, and one that is visible is one the
 * footer does not have to spend a hint on.
 */
export function stripCells(s: TuiStrings): string[] {
  const labels = screenLabels(s)
  return DASHBOARD_SCREENS.map((id, i) => `${i + 1} ${labels[id]}`)
}

/**
 * The strip, fitted to the width it will be drawn at — the SAME widget the log viewer's source
 * selector is, through the same function.
 *
 * It is a plain function rather than a value threaded down because two callers need it: whatever
 * draws the row, and whatever resolves a click on it (`sourceAtColumn`). Two calls of one pure
 * function cannot disagree; a second measurement of the same row would agree until the day one of
 * them changed, and the failure mode is a click that opens the screen beside the one under the
 * pointer.
 */
export function stripFit(s: TuiStrings, screen: DashboardScreenId, width: number): SourceRowFit {
  const at = Math.max(0, DASHBOARD_SCREENS.indexOf(screen))
  return sourceRowFit(s.viewLabel, stripCells(s), at, width)
}

// ---------------------------------------------------------------------------
// where the data comes from
// ---------------------------------------------------------------------------

/**
 * What the dashboard can read right now — decided from what the HOST already reported.
 *
 * This is the one place the tab differs from the standalone app on purpose. `agentop tui` starts a
 * server for itself when none is listening (`ensureApi`), which is right for a command whose whole
 * job is to show metrics. The control center is the screen that STARTS AND STOPS that server, and a
 * tab inside it that quietly started one would contradict the button two screens away — so it starts
 * nothing, reads `ControlStatus.services`, and when there is nothing to read it says so in a sentence
 * that names the way to fix it. An empty dashboard rendered as zeros would be the confident-0 this
 * codebase refuses everywhere else.
 */
export type DashboardSource =
  | { kind: 'api'; apiBase: string }
  /** The host has not answered yet — not the same thing as "there is nothing". */
  | { kind: 'loading' }
  /** The service is confidently down. There is a start one screen away, and we name it. */
  | { kind: 'down' }
  /** Detection failed, or it is up and publishes no address we could read. Never reported as down. */
  | { kind: 'unknown' }

export function dashboardSource(services: readonly ControlService[] | undefined): DashboardSource {
  if (!services) return { kind: 'loading' }
  const svc = services.find(s => s.id === 'agentistics')
  if (!svc) return { kind: 'unknown' }
  if (svc.state === 'down') return { kind: 'down' }
  if (svc.state !== 'up') return { kind: 'unknown' }
  // The api port is the one that answers `/api/data`. `webUrl` is the SPA and is a different port on
  // the native runtime, so it is not a fallback — asking it for `/api/data` works only by accident of
  // the two ports sharing one handler, and naming it here would hide the day they stop.
  const apiBase = svc.active?.apiUrl
  return apiBase ? { kind: 'api', apiBase } : { kind: 'unknown' }
}

// ---------------------------------------------------------------------------
// row budgets
// ---------------------------------------------------------------------------

/** A `Section` costs its blank separator plus its title before it draws anything. */
const SECTION_CHROME = 2
/** `Kpi` is a value over its label. */
const KPI_ROWS = 2
/** The activity section: its chrome plus the one row the sparkline is. */
const ACTIVITY_ROWS = SECTION_CHROME + 1
/** `Empty` renders a blank and a sentence. */
const EMPTY_ROWS = 2
/** A table spends a row on its header before the first result. */
const TABLE_HEADER = 1
/** The share panel never ranks more than five models. */
export const SHARE_MAX = 5

export interface OverviewPlan {
  /** The headline numbers. Dropped only when there is no room for a single one. */
  kpis: boolean
  /** The 30-day sparkline. */
  activity: boolean
  /** How many harness bars are drawn. `0` means the section holds no bars. */
  bars: number
  /**
   * Draw the harness section's EMPTY state — there is no harness to rank.
   *
   * Its own flag rather than something the screen infers from `bars === 0`, because the two are
   * genuinely different: no bars can also mean the section was trimmed away for want of rows, and
   * an empty state drawn in that case is two rows spent saying nothing on the screen that had none
   * to spare. "Nothing is tracked" costs rows like anything else.
   */
  empty: boolean
}

/**
 * Divides the Overview between its three parts.
 *
 * THE ORDER THINGS GIVE WAY, and it is the one thing here worth arguing about:
 *
 *  1. the KPI ROW stays. It is the answer — what this cost, how many tokens, how many sessions —
 *     and `fitKpis` already drops them from the right as the terminal narrows;
 *  2. the ACTIVITY sparkline goes next. It spends three rows to draw one line, and it is the part
 *     of this screen that says the least per row;
 *  3. the HARNESS bars are trimmed last, and never below one: the breakdown is the substance, and a
 *     section reduced to its heading says nothing the heading did not.
 */
export function overviewPlan(height: number, harnesses: number): OverviewPlan {
  const none = { kpis: false, activity: false, bars: 0, empty: false }
  if (height < KPI_ROWS) return none

  const rest = height - KPI_ROWS
  // With no harness at all the section still draws its empty state, which costs rows of its own.
  const want = harnesses > 0 ? harnesses : EMPTY_ROWS
  const section = SECTION_CHROME + want
  const whole = { kpis: true, bars: harnesses, empty: harnesses === 0 }

  if (rest >= ACTIVITY_ROWS + section) return { ...whole, activity: true }
  if (rest >= section) return { ...whole, activity: false }
  const bars = rest - SECTION_CHROME
  if (harnesses > 0 && bars >= 1) return { kpis: true, activity: false, bars, empty: false }
  return { kpis: true, activity: false, bars: 0, empty: false }
}

export interface CostsPlan {
  /** Model rows under the table header. */
  table: number
  /** Bars in the share panel. `0` means it is not drawn. */
  share: number
}

/**
 * Divides the Costs screen between its table and its share panel.
 *
 * The TABLE is the screen: it is every model, priced and ranked, while the share panel re-states the
 * top five as bars. So the panel is what gives way, whole — a share panel showing one of five bars is
 * a proportion the reader cannot use.
 */
export function costsPlan(height: number, models: number): CostsPlan {
  // At one row there is only the table's own header, which still says what the columns are. Asking
  // for a result row as well is one row of overflow — and `Math.max(1, …)` is exactly the shape of
  // that bug: it hands out a row that does not exist.
  if (height <= TABLE_HEADER || models <= 0) return { table: 0, share: 0 }
  const wantShare = Math.min(models, SHARE_MAX)
  const shareCost = SECTION_CHROME + wantShare

  if (height >= TABLE_HEADER + 1 + shareCost) {
    return { table: Math.min(models, height - TABLE_HEADER - shareCost), share: wantShare }
  }
  return { table: Math.min(models, height - TABLE_HEADER), share: 0 }
}

/** Result rows a plain table may draw at this height — its header is not free. */
export function listRows(height: number): number {
  return Math.max(1, height - TABLE_HEADER)
}

/**
 * What the dashboard may draw at this height: the screen strip, its rule, and the body.
 *
 * The same three-part question the Logs screen answers, and the same order of giving way — one row
 * of content unconditionally, then the strip, then the rule. The strip outranks the rule because a
 * dashboard that does not say which of five screens you are on, or that the digits reach the other
 * four, is a screen about nothing; the rule only separates two things that already look different.
 */
export interface DashboardRows {
  strip: boolean
  divider: boolean
  body: number
}

export function dashboardRows(height: number): DashboardRows {
  if (height <= 0) return { strip: false, divider: false, body: 0 }
  const strip = height >= 2
  const divider = height >= 4
  return { strip, divider, body: height - (strip ? 1 : 0) - (divider ? 1 : 0) }
}
