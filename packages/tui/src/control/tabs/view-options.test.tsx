/**
 * The "Search in" panel scrolls, so every option is reachable.
 *
 * `ViewOptions` is one flat list — Group by (every grouping), Show, and the Search-in depths with
 * their two-way "all". Long enough to overflow a short terminal. It used to slice from zero
 * (`rows.slice(0, height - 2)`), which left the depth rows BELOW THE FOLD: the cursor moved onto
 * them and the screen never drew them, so the section this delivery added was unreachable exactly
 * when the terminal was small — the `Math.max(1, height - chrome)` trap.
 *
 * The window arithmetic is pure (`viewMenuWindow`), so the guarantee is pinned here without a tty:
 * whatever row the cursor lands on, that row is inside the visible window, and the window really is
 * a window (smaller than the list) rather than the whole list drawn from the top. An input-driven
 * render test proved the same thing but flaked under concurrent load, because ink reads stdin on a
 * timer the full suite does not give it — the pure test cannot flake.
 */

import { describe, test, expect } from 'bun:test'
import { viewMenuWindow } from './Sessions'

// One heading + 8 groupings + one heading + closed + named + one heading + 3 depths + all = 17 rows.
// The last selectable row (the two-way "all") is index 16; the "Search in" section is indices 12-16.
const ROWS = 17
const SEARCH_IN_SECTION = [12, 13, 14, 15, 16]

// A cursor row is visible when it lies inside the [offset, offset + body) window the menu draws.
const visible = (cursorRow: number, height: number) => {
  const { offset, body } = viewMenuWindow(ROWS, cursorRow, height)
  return cursorRow >= offset && cursorRow < offset + body
}

describe('viewMenuWindow — the "Search in" list scrolls', () => {
  test('a short terminal cannot show the whole list — it is a window, not the top', () => {
    const { offset, body } = viewMenuWindow(ROWS, 16, 10)
    // 10 rows of terminal, minus the title and hint, is 8 — fewer than the 17 rows.
    expect(body).toBe(8)
    expect(body).toBeLessThan(ROWS)
    // With the cursor at the bottom the window has scrolled off zero to keep it in view.
    expect(offset).toBeGreaterThan(0)
  })

  test('every row the cursor can reach stays on screen, at every height that clips the list', () => {
    for (const height of [6, 8, 10, 12, 16, 18]) {
      for (let cursor = 0; cursor < ROWS; cursor++) {
        expect(visible(cursor, height), `row ${cursor} hidden at height ${height}`).toBe(true)
      }
    }
  })

  test('the whole Search-in section is reachable — the regression that failed review', () => {
    // At the height where the bug showed (10), each depth row is inside the window when selected.
    for (const row of SEARCH_IN_SECTION) {
      expect(visible(row, 10), `Search-in row ${row} unreachable`).toBe(true)
    }
  })

  test('a tall terminal shows everything from the top — no needless scroll', () => {
    const { offset, body } = viewMenuWindow(ROWS, 16, 40)
    expect(offset).toBe(0)
    expect(body).toBeGreaterThanOrEqual(ROWS)
  })

  test('a one-line terminal still yields a usable window, never a negative height', () => {
    const { body } = viewMenuWindow(ROWS, 5, 1)
    expect(body).toBe(1)
    expect(visible(5, 1)).toBe(true)
  })
})
