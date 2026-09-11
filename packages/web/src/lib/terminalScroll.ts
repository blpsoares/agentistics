/**
 * terminalScroll.ts — PURE. Where a terminal box is scrolled to after a repaint, and the one
 * question that decides it: what is the LIVE SCREEN, and what is only history behind it.
 *
 * A frame carries up to `TERMINAL_VIEW_LINES` of scrollback PLUS the pane's own screen, rendered
 * onto one grid so the box can scroll through all of it. The box used to be pinned to the BOTTOM of
 * that grid, which is wrong twice over, and both were reported:
 *
 * - **A fresh shell opened scrolled past its own prompt.** A 50-row pane whose first row holds the
 *   prompt is 49 rows of blank screen after it; the bottom of the grid is the bottom of those
 *   blanks, so the band opened on empty space with the prompt somewhere above the fold.
 * - **`clear` looked like it did nothing.** MEASURED on tmux 3.2a: `clear` does NOT empty tmux's
 *   history (a capture at `-S -200` returns every line it "removed"), because the pane's TERM is
 *   `screen`, whose terminfo carries no `E3` — so the escape that WOULD clear it
 *   (`\033[3J`, which tmux does honour: history 22 → 0 when sent by hand) is never emitted. The
 *   capture is therefore unchanged apart from a fresh prompt at the top of the screen, and a
 *   bottom-pinned box went on showing the very lines the user asked to be rid of.
 *
 * The answer to both is the same and needs no tmux command at all: **anchor the viewport at the
 * first row of the LIVE SCREEN**, which is exactly what a terminal shows — the screen fills the
 * window and the history is above it, reachable by scrolling. After a `clear` the screen is blank
 * with the prompt on its first row, so the band goes blank; on a fresh shell the screen IS the whole
 * capture, so the prompt sits at the top.
 *
 * The one correction is the CURSOR. A pane taller than the box (the moment before a resize lands,
 * or a resize that was refused) would put the screen's first row at the top and the cursor below the
 * fold, which is the "I cannot see what I am typing" version of the same bug. So the anchor moves
 * down by exactly as much as it takes to keep the cursor's row visible, and no further.
 */

/** How far from the anchor still counts as "watching the live screen". Absorbs the sub-pixel
 *  rounding the fit-to-box scale introduces; anything more is a reader who scrolled up. */
export const FOLLOW_TOLERANCE_PX = 4

export interface TerminalScrollInput {
  /** Rows on the emulator's grid — the whole capture. */
  bufRows: number
  /** Rows of the pane's LIVE SCREEN; everything before them is history. */
  screenRows: number
  /** The cursor's row WITHIN the live screen, or `null` when the frame draws none. */
  cursorRow: number | null
  /** The scroll container as measured after the repaint. */
  scrollHeight: number
  clientHeight: number
}

/**
 * The `scrollTop` that shows the live screen.
 *
 * Row height is derived from the measured `scrollHeight`, never from a font size: the grid is
 * SCALED to the box (see `SessionTerminal`'s `fit`), so the only honest row height is the rendered
 * one.
 */
export function terminalScrollTop(o: TerminalScrollInput): number {
  if (o.bufRows <= 0 || o.scrollHeight <= 0) return 0
  const rowH = o.scrollHeight / o.bufRows
  const screenTop = Math.max(0, o.bufRows - o.screenRows)
  let top = screenTop * rowH
  if (o.cursorRow !== null && o.clientHeight > 0) {
    const cursorBottom = (screenTop + o.cursorRow + 1) * rowH
    const overflow = cursorBottom - (top + o.clientHeight)
    if (overflow > 0) top += overflow
  }
  const max = Math.max(0, o.scrollHeight - o.clientHeight)
  return Math.round(Math.min(Math.max(0, top), max))
}

/**
 * Was the reader still watching the live screen before this repaint?
 *
 * A frame arrives twice a second; snapping a reader who has scrolled up into the history back to the
 * live edge is the same defect as never following it at all, from the other side.
 */
export function stillFollowing(scrollTop: number, lastTop: number): boolean {
  return scrollTop >= lastTop - FOLLOW_TOLERANCE_PX
}
