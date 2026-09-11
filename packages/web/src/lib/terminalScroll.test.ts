import { describe, it, expect } from 'bun:test'
import { terminalScrollTop, stillFollowing, FOLLOW_TOLERANCE_PX } from './terminalScroll'

// One row is 20px throughout: scrollHeight = bufRows * 20.
const px = (rows: number) => rows * 20

describe('terminalScrollTop', () => {
  it('puts the live screen at the top of the viewport', () => {
    // 200 captured lines, a 50-row screen, a box that shows 50 rows.
    const top = terminalScrollTop({
      bufRows: 200, screenRows: 50, cursorRow: 0,
      scrollHeight: px(200), clientHeight: px(50),
    })
    expect(top).toBe(px(150))
  })

  it('shows the prompt at the top of a screen that is mostly blank', () => {
    // A fresh shell: the whole capture IS the screen, the prompt on its first row.
    const top = terminalScrollTop({
      bufRows: 50, screenRows: 50, cursorRow: 0,
      scrollHeight: px(50), clientHeight: px(14),
    })
    expect(top).toBe(0)
  })

  it('leaves history above and the cleared screen in view after a clear', () => {
    // 42 lines of scrollback the `clear` did not remove, then a 14-row blank screen.
    const top = terminalScrollTop({
      bufRows: 56, screenRows: 14, cursorRow: 0,
      scrollHeight: px(56), clientHeight: px(14),
    })
    expect(top).toBe(px(42))
  })

  it('scrolls further down when the cursor would fall below the box', () => {
    // The pane is taller than the box: anchoring at the screen top would hide the cursor.
    const top = terminalScrollTop({
      bufRows: 50, screenRows: 50, cursorRow: 40,
      scrollHeight: px(50), clientHeight: px(14),
    })
    // The cursor's row must be the last visible one: top = (40 + 1 - 14) rows.
    expect(top).toBe(px(27))
  })

  it('never scrolls past the end of the content', () => {
    const top = terminalScrollTop({
      bufRows: 20, screenRows: 50, cursorRow: 49,
      scrollHeight: px(20), clientHeight: px(14),
    })
    expect(top).toBe(px(6))
  })

  it('answers 0 for a grid with no rows or no measured height', () => {
    expect(terminalScrollTop({ bufRows: 0, screenRows: 0, cursorRow: null, scrollHeight: 0, clientHeight: 0 })).toBe(0)
    expect(terminalScrollTop({ bufRows: 10, screenRows: 5, cursorRow: 0, scrollHeight: 0, clientHeight: 100 })).toBe(0)
  })

  it('ignores the cursor when there is none', () => {
    const top = terminalScrollTop({
      bufRows: 50, screenRows: 50, cursorRow: null,
      scrollHeight: px(50), clientHeight: px(14),
    })
    expect(top).toBe(0)
  })
})

describe('stillFollowing', () => {
  it('follows when the reader sits at the live screen', () => {
    expect(stillFollowing(300, 300)).toBe(true)
  })
  it('absorbs sub-pixel rounding from the scale', () => {
    expect(stillFollowing(300 - FOLLOW_TOLERANCE_PX, 300)).toBe(true)
  })
  it('leaves a reader who scrolled up into the history alone', () => {
    expect(stillFollowing(100, 300)).toBe(false)
  })
})
