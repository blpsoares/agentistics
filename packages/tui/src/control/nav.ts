/**
 * nav.ts — PURE navigation logic for the control center.
 *
 * Every key the app understands is resolved here, against plain values, so the behaviour can be
 * tested without mounting Ink or driving a pty. The components call these and render the result;
 * they hold no navigation rules of their own.
 */

import { TAB_ORDER, type TabId } from './types'

/** The keys `useInput` reports, reduced to what navigation cares about. */
export interface NavKey {
  input: string
  leftArrow?: boolean
  rightArrow?: boolean
  upArrow?: boolean
  downArrow?: boolean
  pageUp?: boolean
  pageDown?: boolean
  home?: boolean
  end?: boolean
  return?: boolean
  escape?: boolean
  tab?: boolean
  shift?: boolean
}

export type NavAction =
  | { kind: 'tab'; tab: TabId }
  | { kind: 'move'; delta: -1 | 1 }
  | { kind: 'select' }
  | { kind: 'back' }
  | { kind: 'quit' }
  | { kind: 'jump'; index: number }
  | { kind: 'none' }

/**
 * Screen switching, which is global: it works from any screen so the app never traps the user.
 *
 * `←`/`→` and nothing else. `tab` used to do this and belongs to the cockpit's panes now, and the
 * DIGITS used to do it as well — a second way in, documented by the numbers the old bottom strip
 * printed beside each name. Both are gone: the tab bar sits at the top where it reads as
 * navigation rather than as a legend, and it is not something a user should have to translate into
 * a number to use.
 *
 * Losing the digits is a simplification rather than a loss, because they were double-booked. The
 * log viewer numbers its three sources on screen, so `2` there switched the source AND left the
 * screen — one keypress doing two things, only one of which was advertised. That is what the
 * `claimDigits` flag existed to arbitrate; with the screens off the digits entirely, the log viewer
 * simply owns 1/2/3 again and the flag is gone.
 *
 * `arrows` is the one claim left, and it has a real owner: the detail pane's action row is a
 * horizontal list, so while it has focus the arrows move between verbs and the footer stops saying
 * `←→ screens`. `esc` is the way back out, one keypress from every screen again.
 */
export function resolveTabKey(key: NavKey, current: TabId, arrows = true): TabId | null {
  if (!arrows) return null
  const i = TAB_ORDER.indexOf(current)
  const at = (n: number) => TAB_ORDER[(n + TAB_ORDER.length) % TAB_ORDER.length]!

  if (key.leftArrow) return at(i - 1)
  if (key.rightArrow) return at(i + 1)
  return null
}

/**
 * The focusable regions of the cockpit, in the order `tab` walks them.
 *
 * Reading order, and also the order of the work: you pick a service, you consult the machine's
 * settings beside it, you act on what you picked. Config sits after the services list because it is
 * the other half of the same band and the same kind of thing — a list of rows you select.
 *
 * There is no `log` any more. Logs belong to the Logs screen: a tailing viewer squeezed into a pane
 * was a second, worse copy of a screen one keypress away, and it was what pushed the pane the
 * cockpit is actually FOR — the detail of the selected service — into a column too narrow to state
 * a URL.
 */
export type PaneId = 'services' | 'config' | 'actions'

export const PANE_ORDER: readonly PaneId[] = ['services', 'config', 'actions'] as const

/**
 * `tab` / `shift+tab` cycle focus through the panes the CURRENT layout actually drew.
 *
 * `panes` is passed in rather than assumed: a short terminal has no log pane and a narrow one may
 * have no config pane, and focus that lands on a pane which is not on screen is a cursor the user
 * cannot find and keys that appear to do nothing.
 */
export function resolveFocusKey(key: NavKey, current: PaneId, panes: readonly PaneId[]): PaneId | null {
  if (!key.tab || panes.length === 0) return null
  const i = panes.indexOf(current)
  // An unknown current focus means the layout just dropped the pane we were on; `tab` should land
  // on the first available one rather than nowhere.
  if (i < 0) return panes[0]!
  return panes[(i + (key.shift ? -1 : 1) + panes.length) % panes.length]!
}

/** The nearest valid focus after a resize dropped a pane. Never returns a pane that is not drawn. */
export function clampFocus(current: PaneId, panes: readonly PaneId[]): PaneId {
  if (panes.length === 0) return 'services'
  if (panes.includes(current)) return current
  // Walk back toward the services pane, which is the one pane that is always drawn — so focus
  // falls toward the selection rather than jumping forward onto a log the user was not reading.
  const wanted = PANE_ORDER.indexOf(current)
  for (let i = wanted; i >= 0; i--) {
    const candidate = PANE_ORDER[i]!
    if (panes.includes(candidate)) return candidate
  }
  return panes[0]!
}

/**
 * List navigation within a screen. Wraps at both ends, and accepts vi keys because a terminal
 * audience expects them.
 */
export function resolveListKey(key: NavKey, index: number, length: number): number {
  if (length <= 0) return 0
  const wrap = (n: number) => (n + length) % length
  if (key.upArrow || key.input === 'k') return wrap(index - 1)
  if (key.downArrow || key.input === 'j') return wrap(index + 1)
  if (key.input === 'g') return 0
  if (key.input === 'G') return length - 1
  return index
}

/**
 * A 1-9 digit shortcut into a list of `length` items, or null.
 *
 * Digits are only a shortcut when the list is short enough to number visibly; past 9 items the
 * numbers stop matching what is on screen, so they are not offered.
 *
 * They belong to the SCREENS' menus and lists now — the log viewer's sources, a numbered menu — and
 * to nothing global, which is what makes a number drawn beside a row safe to press again.
 */
export function resolveDigit(key: NavKey, length: number): number | null {
  if (key.input.length !== 1) return null
  const n = Number(key.input)
  if (!Number.isInteger(n) || n < 1 || n > Math.min(9, length)) return null
  return n - 1
}

/**
 * DOCUMENT scrolling, as opposed to list navigation — one reducer for every screen that scrolls.
 *
 * The difference from `resolveListKey` is the ends: a menu WRAPS, because the items are a ring and
 * the cursor is a choice; a document CLAMPS, because `↓` at the bottom of a log must not throw the
 * reader back to the first line of two thousand.
 *
 * The full set, in one place so the Logs screen, the help, the cheat sheet and the command list
 * cannot answer different keys: `↑`/`↓` and `k`/`j` by a row, page up / page down by a screenful,
 * `home`/`end` and `g`/`G` to the ends. Returns `null` for anything else, which is what lets the
 * caller fall through to its own keys without listing these twice.
 *
 * `page` is passed in rather than derived: only the caller knows how many rows its viewport got
 * after its own chrome, and a page that overshoots is a scrollbar that skips.
 */
export function resolveScrollKey(
  key: NavKey,
  index: number,
  length: number,
  page: number,
): number | null {
  if (length <= 0) return null
  const clamp = (n: number) => Math.min(Math.max(0, n), length - 1)
  const step = Math.max(1, page)

  if (key.upArrow || key.input === 'k') return clamp(index - 1)
  if (key.downArrow || key.input === 'j') return clamp(index + 1)
  if (key.pageUp) return clamp(index - step)
  if (key.pageDown) return clamp(index + step)
  if (key.home || key.input === 'g') return 0
  if (key.end || key.input === 'G') return length - 1
  return null
}

/**
 * A document cursor moved by `delta` rows and CLAMPED at both ends — the wheel's counterpart to
 * `resolveScrollKey`.
 *
 * Clamped, never wrapped, and that is the whole of it: a wheel that jumped from the last line of a
 * log to the first would be a scroll gesture that teleports, which reads as a broken screen rather
 * than as the end of the document. Stopping dead at both ends is what the user is already expecting
 * from every other scrollable thing on their desktop.
 */
export function scrollBy(index: number, delta: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(0, index + delta), length - 1)
}

/**
 * A TAILING viewport: a position plus whether it is pinned to the newest line.
 *
 * The state is a value rather than two `useState`s inside the screen so the whole behaviour is
 * testable and so a driver that is not the keyboard — a mouse wheel, next — has one shape to
 * produce and one function to go through.
 */
export interface TailState {
  index: number
  follow: boolean
}

/**
 * The Logs screen's keys: `f` re-pins to the tail, and every scroll key unpins it.
 *
 * Unpinning on ANY movement is the whole contract — a reader who scrolled back and is then yanked
 * to the newest line one second later has been shown that this screen cannot be read.
 */
export function resolveTailKey(
  key: NavKey,
  state: TailState,
  length: number,
  page: number,
): TailState | null {
  if (key.input === 'f') return state.follow ? null : { index: state.index, follow: true }
  const next = resolveScrollKey(key, state.index, length, page)
  if (next === null) return null
  if (next === state.index && !state.follow) return null
  return { index: next, follow: false }
}

/**
 * The tailing viewport moved by `delta` rows — the wheel, arriving at `resolveTailKey`'s rule.
 *
 * Any movement unpins the tail, exactly as every scroll key does: a reader who rolled the wheel back
 * and is then yanked to the newest line one second later has been shown that this screen cannot be
 * read. `null` when nothing would change, so a wheel notch at the very top of a log does not
 * re-render the screen thirty times a second.
 */
export function scrollTailBy(state: TailState, delta: number, length: number): TailState | null {
  if (length <= 0) return null
  const next = scrollBy(state.index, delta, length)
  if (next === state.index && !state.follow) return null
  return { index: next, follow: false }
}

/**
 * Scroll offset that keeps `index` visible in a window of `height` rows.
 *
 * Returned rather than stored so the viewport can never drift out of sync with the selection —
 * a bug that shows up as an invisible cursor after a resize.
 */
export function windowOffset(index: number, length: number, height: number): number {
  if (height <= 0 || length <= height) return 0
  const half = Math.floor(height / 2)
  return Math.min(Math.max(0, index - half), length - height)
}

/**
 * The chrome rows that are NOT the header: a blank, the tab bar, its underline, then — under the
 * body — the status line and the footer.
 *
 * The header is the one part whose height is not a constant: it is the two-line block wordmark when
 * the terminal can carry it beside the machine's tag, and the one-line mark when it cannot (see
 * `headerLayout`). So the body is budgeted against a header height passed in rather than assumed.
 */
export const CHROME_ROWS_AROUND = 5

/**
 * How many rows a screen may use for its body, given the terminal height.
 *
 * `headerRows` defaults to one — the compact mark — which is what makes `CHROME_ROWS` the total for
 * the narrow case and keeps every caller that does not draw art honest.
 *
 * A very short terminal still gets at least one usable row rather than a negative height, which
 * Ink would render as an empty screen.
 */
export const CHROME_ROWS = CHROME_ROWS_AROUND + 1

export function bodyHeight(rows: number, headerRows = 1): number {
  return Math.max(1, rows - CHROME_ROWS_AROUND - Math.max(1, headerRows))
}
