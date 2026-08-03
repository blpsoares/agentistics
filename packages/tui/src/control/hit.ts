/**
 * hit.ts — PURE hit-testing: a terminal coordinate in, the region it landed in out.
 *
 * The rule this module exists to enforce is the one that keeps a mouse from rotting: THE LAYOUT IS
 * NEVER RECONSTRUCTED. A second copy of the geometry would agree with the first on the day it was
 * written and drift from it silently afterwards — a click landing one row above the row it lit up is
 * not a crash, it is a screen that quietly acts on the wrong service. So every function here takes
 * the SAME values the renderer was handed (`headerLayout(...).rows`, `bodyHeight(...)`, a
 * `CockpitLayout`, a `TabStripLayout`) and does arithmetic on them.
 *
 * The chain of frames, each one narrowing the last:
 *
 *   terminal (1-based)  →  shellHit   →  the body, in the shell's content coordinates
 *                                     →  paneHit  →  the inside of a framed screen
 *                                     →  rectHit  →  one pane of the cockpit
 *                                     →  listRowAt →  the row under the pointer
 *
 * Nothing here knows what a click MEANS. Deciding that is the screen's business, which is why this
 * module has no dependency on the host, the strings or React.
 */

import { PANE_MIN_ROWS, paneInnerHeight, paneInnerWidth } from './chrome.ts'

/** A block of cells, 0-based and half-open on the right and bottom edges. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Coordinates relative to `rect`, or `null` when the point is outside it. */
export function rectHit(rect: Rect, x: number, y: number): { x: number; y: number } | null {
  const local = { x: x - rect.x, y: y - rect.y }
  if (local.x < 0 || local.y < 0 || local.x >= rect.width || local.y >= rect.height) return null
  return local
}

// ---------------------------------------------------------------------------
// the shell
// ---------------------------------------------------------------------------

/**
 * The one column of padding on each side of everything the shell draws (`paddingX={1}`).
 *
 * It is why the body's first column is terminal column 2, and why a click on column 1 belongs to
 * nothing at all rather than to the leftmost cell of whatever is beside it.
 */
export const SHELL_PAD_X = 1

/** The blank row between the title and the tab bar. */
const BLANK_ROWS = 1
/** The tab bar proper and the accent rule under it — one region as far as a click is concerned. */
const TAB_ROWS = 2

/** What the shell laid out, in the two numbers a click has to be measured against. */
export interface ShellGeometry {
  /** `headerLayout(...).rows` — one for the compact mark, more for the block wordmark. */
  headerRows: number
  /** `bodyHeight(...)` — the rows the active screen was given. */
  bodyRows: number
}

/**
 * Where a terminal coordinate landed in the shell's own chrome.
 *
 * `chrome` is everything with nothing to click: the title, the blank, the status line, the footer
 * and the padding columns. A click there does nothing, silently — which is the correct behaviour and
 * not a gap.
 */
export type ShellHit =
  /** The tab bar. `x` is the column inside the strip, 0-based. */
  | { region: 'tabs'; x: number }
  /** The active screen. `x`/`y` are relative to the body's top-left cell. */
  | { region: 'body'; x: number; y: number }
  | { region: 'chrome' }

/**
 * Resolves a 1-based terminal coordinate against the shell's row bands.
 *
 * The bands, in the order `ControlCenter` draws them: the header (whose height is NOT a constant —
 * it is the block wordmark when the row can carry it), a blank, the tab bar, its rule, the body, the
 * status line, the footer. The tab bar's rule counts as the bar: it is drawn from the same cell
 * widths and reads as part of it, so refusing a click one row low would be a control that looks
 * bigger than it is.
 */
export function shellHit(geometry: ShellGeometry, column: number, row: number): ShellHit {
  const x = column - 1 - SHELL_PAD_X
  const y = row - 1
  if (x < 0) return { region: 'chrome' }

  const tabTop = Math.max(1, geometry.headerRows) + BLANK_ROWS
  const bodyTop = tabTop + TAB_ROWS

  if (y >= tabTop && y < bodyTop) return { region: 'tabs', x }
  if (y >= bodyTop && y < bodyTop + geometry.bodyRows) return { region: 'body', x, y: y - bodyTop }
  return { region: 'chrome' }
}

// ---------------------------------------------------------------------------
// panes
// ---------------------------------------------------------------------------

/**
 * The inside of a `Pane` drawn at the origin of the given frame, or `null` for a click on its border.
 *
 * It mirrors `Pane` exactly, including its last degradation: below `PANE_MIN_ROWS` the pane gives up
 * its frame and hands its rows to the content, so the interior starts at the top-left cell. Getting
 * that branch wrong would offset every click by a row on precisely the short terminals where the
 * rows are scarcest.
 *
 * The content columns come from `paneInnerWidth`, the same number the children were told to budget
 * against — a click past the last column a child could have drawn on belongs to nothing.
 */
export function paneHit(
  width: number,
  height: number,
  x: number,
  y: number,
): { x: number; y: number } | null {
  if (width <= 0 || height <= 0) return null
  if (height < PANE_MIN_ROWS) {
    return rectHit({ x: 0, y: 0, width: paneInnerWidth(width), height }, x, y)
  }
  return rectHit(
    { x: PANE_PAD_X, y: PANE_PAD_Y, width: paneInnerWidth(width), height: paneInnerHeight(height) },
    x,
    y,
  )
}

/** A pane spends one column on its left border and one on its inner padding before any content. */
const PANE_PAD_X = 2
/** And one row on the titled top border. `PANE_FRAME_Y`'s other row is the bottom one. */
const PANE_PAD_Y = 1

/**
 * Where a `Pane`'s first content cell sits inside its own frame — `paneHit` read the other way.
 *
 * Needed by anything that draws a child INTO a pane and then has to tell that child where it is: the
 * cockpit's overlay hands a menu the offset of the pane it was framed in, so the menu can resolve a
 * click against its own rows without learning anything about the frame around it.
 */
export function paneOrigin(height: number): { x: number; y: number } {
  return height < PANE_MIN_ROWS ? { x: 0, y: 0 } : { x: PANE_PAD_X, y: PANE_PAD_Y }
}

// ---------------------------------------------------------------------------
// lists
// ---------------------------------------------------------------------------

/**
 * Which item of a scrolled list a row belongs to, or `null` for a row that is not one.
 *
 * `offset` is the same `windowOffset(...)` the renderer sliced with, and `leading` is whatever the
 * list drew above its first item (the `↑ n` marker a scrolling `Menu` reserves). Passing both in
 * rather than recomputing them is the whole point: a list that scrolls and a hit test that does not
 * know it has scrolled is a cursor that lands on the wrong row exactly when the list got long enough
 * to matter.
 */
export function listRowAt(y: number, offset: number, shown: number, leading = 0): number | null {
  const i = y - leading
  if (i < 0 || i >= shown) return null
  return offset + i
}
