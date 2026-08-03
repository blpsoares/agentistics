import { describe, expect, it } from 'bun:test'

import { listRowAt, paneHit, paneOrigin, rectHit, shellHit, SHELL_PAD_X, type Rect } from './hit'
import { bodyHeight, CHROME_ROWS_AROUND } from './nav'
import { PANE_FRAME_X, PANE_FRAME_Y, PANE_MIN_ROWS, paneInnerHeight, paneInnerWidth } from './chrome.ts'

describe('rectHit', () => {
  const rect: Rect = { x: 4, y: 2, width: 3, height: 2 }

  it('returns coordinates relative to the rectangle', () => {
    expect(rectHit(rect, 4, 2)).toEqual({ x: 0, y: 0 })
    expect(rectHit(rect, 6, 3)).toEqual({ x: 2, y: 1 })
  })

  it('is half-open, so two rectangles that touch cannot both claim a cell', () => {
    expect(rectHit(rect, 7, 2)).toBeNull()
    expect(rectHit(rect, 4, 4)).toBeNull()
  })

  it('rejects anything before its origin', () => {
    expect(rectHit(rect, 3, 2)).toBeNull()
    expect(rectHit(rect, 4, 1)).toBeNull()
  })
})

describe('shellHit', () => {
  const geometry = { headerRows: 2, bodyRows: 20 }

  it('ignores the padding column, which belongs to nothing', () => {
    // The shell pads one column on each side; a click there is not the leftmost cell of the pane
    // beside it, and treating it as one would make every frame one column wider than it draws.
    expect(shellHit(geometry, 1, 6).region).toBe('chrome')
    expect(shellHit(geometry, 2, 6)).toEqual({ region: 'body', x: 0, y: 0 })
  })

  it('answers the tab bar AND the accent rule under it', () => {
    // The rule is drawn from the strip's own cell widths and reads as part of it, so refusing a
    // click one row low would be a control that looks bigger than it is.
    expect(shellHit(geometry, 5, 4)).toEqual({ region: 'tabs', x: 3 })
    expect(shellHit(geometry, 5, 5)).toEqual({ region: 'tabs', x: 3 })
  })

  it('puts the header, the blank, the status line and the footer out of reach', () => {
    expect(shellHit(geometry, 5, 1).region).toBe('chrome')
    expect(shellHit(geometry, 5, 2).region).toBe('chrome')
    expect(shellHit(geometry, 5, 3).region).toBe('chrome')
    // One past the body: the status line.
    expect(shellHit(geometry, 5, 6 + geometry.bodyRows).region).toBe('chrome')
  })

  it('follows a header whose height is not a constant', () => {
    // The block wordmark costs a row the compact mark does not, and the body moves with it.
    expect(shellHit({ headerRows: 1, bodyRows: 5 }, 2, 5)).toEqual({ region: 'body', x: 0, y: 0 })
    expect(shellHit({ headerRows: 3, bodyRows: 5 }, 2, 7)).toEqual({ region: 'body', x: 0, y: 0 })
  })

  it('partitions the whole terminal, with no row claimed twice and none left out', () => {
    // THE test that keeps this in step with the renderer: the bands are walked against the very
    // numbers `ControlCenter` lays out with, so a chrome row added to one and not the other shows up
    // here rather than as a click that acts on the row above the one under the pointer.
    for (const headerRows of [1, 2, 3]) {
      const rows = 34
      const bodyRows = bodyHeight(rows, headerRows)
      expect(headerRows + CHROME_ROWS_AROUND + bodyRows).toBe(rows)

      const seen = Array.from({ length: rows }, (_, i) =>
        shellHit({ headerRows, bodyRows }, 1 + SHELL_PAD_X, i + 1))

      expect(seen.filter(h => h.region === 'tabs')).toHaveLength(2)
      const body = seen.filter(h => h.region === 'body')
      expect(body).toHaveLength(bodyRows)
      // Contiguous and starting at zero — the body's own coordinate frame.
      expect(body.map(h => (h as { y: number }).y)).toEqual(body.map((_, i) => i))
      // Header + blank above, status + footer below.
      expect(seen.filter(h => h.region === 'chrome')).toHaveLength(headerRows + 1 + 2)
    }
  })
})

describe('paneHit', () => {
  const width = 40
  const height = 10

  it('starts the interior past the border and the padding', () => {
    expect(paneHit(width, height, 2, 1)).toEqual({ x: 0, y: 0 })
    // The titled top border, the left border and the padding column are all frame.
    expect(paneHit(width, height, 2, 0)).toBeNull()
    expect(paneHit(width, height, 1, 1)).toBeNull()
    expect(paneHit(width, height, 0, 1)).toBeNull()
  })

  it('offers exactly the cells the children were told to budget for', () => {
    const last = paneHit(width, height, 2 + paneInnerWidth(width) - 1, 1 + paneInnerHeight(height) - 1)
    expect(last).toEqual({ x: paneInnerWidth(width) - 1, y: paneInnerHeight(height) - 1 })
    expect(paneHit(width, height, 2 + paneInnerWidth(width), 1)).toBeNull()
    expect(paneHit(width, height, 2, 1 + paneInnerHeight(height))).toBeNull()
  })

  it('agrees with the frame `Pane` actually spends', () => {
    expect(PANE_FRAME_X).toBe(4)
    expect(PANE_FRAME_Y).toBe(2)
  })

  it('follows the pane past its last degradation, where the frame is given up', () => {
    // Below PANE_MIN_ROWS `Pane` draws no border at all and hands the rows to the content, so the
    // interior starts at the top-left cell. Getting this branch wrong offsets every click by a row
    // on precisely the terminals with the fewest rows to spare.
    const short = PANE_MIN_ROWS - 1
    expect(paneHit(width, short, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(paneOrigin(short)).toEqual({ x: 0, y: 0 })
    expect(paneOrigin(PANE_MIN_ROWS)).toEqual({ x: 2, y: 1 })
  })

  it('is null for a pane with no room at all', () => {
    expect(paneHit(0, 10, 0, 0)).toBeNull()
    expect(paneHit(40, 0, 0, 0)).toBeNull()
  })

  it('is the inverse of paneOrigin', () => {
    const origin = paneOrigin(height)
    expect(paneHit(width, height, origin.x, origin.y)).toEqual({ x: 0, y: 0 })
  })
})

describe('listRowAt', () => {
  it('maps a row of the visible window onto the real list', () => {
    expect(listRowAt(0, 12, 5)).toBe(12)
    expect(listRowAt(4, 12, 5)).toBe(16)
  })

  it('refuses a row past what was drawn', () => {
    expect(listRowAt(5, 12, 5)).toBeNull()
    expect(listRowAt(-1, 12, 5)).toBeNull()
  })

  it('skips whatever the list drew above its first item', () => {
    // A scrolling `Menu` reserves a row for its `↑ n` marker; counting from the marker would act on
    // the row above the one under the pointer for the whole length of the list.
    expect(listRowAt(0, 12, 5, 1)).toBeNull()
    expect(listRowAt(1, 12, 5, 1)).toBe(12)
  })

  it('claims nothing when nothing was drawn', () => {
    expect(listRowAt(0, 0, 0)).toBeNull()
  })
})
