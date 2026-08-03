import { test, expect, describe } from 'bun:test'
import { PAGE_SIZE_OPTIONS, resolvePaging, machineCell } from './tablePaging'

const p = (over: Partial<Parameters<typeof resolvePaging>[0]> = {}) =>
  resolvePaging({ mode: 'inline', total: 0, page: 0, size: 5, ...over })

describe('page sizes are owned by the mode', () => {
  test('the inline preview starts at 5 and never offers a maximized size', () => {
    expect(PAGE_SIZE_OPTIONS.inline[0]).toBe(5)
    expect(PAGE_SIZE_OPTIONS.inline).not.toContain(50)
    expect(Math.max(...PAGE_SIZE_OPTIONS.inline)).toBe(15)
  })

  test('maximized goes to 50 and no further', () => {
    expect(Math.max(...PAGE_SIZE_OPTIONS.maximized)).toBe(50)
  })

  test('a size the mode does not offer NARROWS to an offered one, never widens', () => {
    // Leaving the maximized view at 50 must not hand 50 rows to a card that must hold at 390px.
    expect(p({ mode: 'inline', total: 100, size: 50 }).size).toBe(15)
    expect(p({ mode: 'maximized', total: 100, size: 5 }).size).toBe(10)
    // Junk from an older persisted value falls back to the smallest, never to zero rows.
    expect(p({ total: 100, size: 0 }).size).toBe(5)
    expect(p({ total: 100, size: -3 }).size).toBe(5)
    expect(p({ total: 100, size: Number.NaN }).size).toBe(5)
    // An in-between value snaps DOWN to what is offered.
    expect(p({ mode: 'inline', total: 100, size: 12 }).size).toBe(10)
  })
})

describe('the window is always valid', () => {
  test('an empty table is page 1 of 1, not page 1 of 0', () => {
    const r = p({ total: 0 })
    expect(r.pageCount).toBe(1)
    expect(r.page).toBe(0)
    expect(r.start).toBe(0)
    expect(r.end).toBe(0)
    expect(r.paged).toBe(false)
  })

  test('the last page is short, and `end` reports the real count rather than the slice width', () => {
    // 13 rows at 5 per page: pages of 5, 5 and 3.
    const last = p({ total: 13, size: 5, page: 2 })
    expect(last.pageCount).toBe(3)
    expect(last.start).toBe(10)
    expect(last.end).toBe(13)
    // An exact multiple must not produce a trailing empty page.
    expect(p({ total: 15, size: 5 }).pageCount).toBe(3)
    expect(p({ total: 16, size: 5 }).pageCount).toBe(4)
    // One row over is still one page when it fits exactly.
    expect(p({ total: 5, size: 5 }).paged).toBe(false)
    expect(p({ total: 6, size: 5 }).paged).toBe(true)
  })

  test('a page left pointing past the end is pulled back, not rendered empty', () => {
    // The real case: the user is on page 3, lifts a rule, and three rows disappear.
    const r = p({ total: 6, size: 5, page: 2 })
    expect(r.page).toBe(1)
    expect(r.start).toBe(5)
    expect(r.end).toBe(6)
    // Rows vanishing entirely lands on the only page there is.
    expect(p({ total: 0, page: 7 }).page).toBe(0)
    // Negative and junk indexes clamp to the first page.
    expect(p({ total: 20, page: -4 }).page).toBe(0)
    expect(p({ total: 20, page: Number.NaN }).page).toBe(0)
  })

  test('growing the page size keeps the user on a page that exists', () => {
    // 13 rows, on page 2 (0-based) at 5/page — going to 15/page leaves only one page.
    const grown = p({ total: 13, size: 15, page: 2 })
    expect(grown.pageCount).toBe(1)
    expect(grown.page).toBe(0)
    expect(grown.end).toBe(13)
  })

  test('every page together covers every row exactly once', () => {
    const total = 23
    const size = 5
    const seen: number[] = []
    const { pageCount } = p({ total, size })
    expect(pageCount).toBe(5)
    let pagesWalked = 0
    for (let i = 0; i < pageCount; i++) {
      const r = p({ total, size, page: i })
      expect(r.page).toBe(i) // never clamped away while inside range
      for (let n = r.start; n < r.end; n++) seen.push(n)
      pagesWalked++
    }
    // Guards the loop: a pageCount of 0 would make every assertion above unreachable.
    expect(pagesWalked).toBe(pageCount)
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i))
  })
})

describe('the "hidden on" cell never drops a machine silently', () => {
  test('a cell that fits shows everything and claims no overflow', () => {
    expect(machineCell([], 2)).toEqual({ shown: [], extra: 0 })
    expect(machineCell(['a'], 2)).toEqual({ shown: ['a'], extra: 0 })
    expect(machineCell(['a', 'b'], 2)).toEqual({ shown: ['a', 'b'], extra: 0 })
  })

  test('an overflowing cell reports EXACTLY how many it held back', () => {
    const r = machineCell(['a', 'b', 'c', 'd', 'e'], 2)
    expect(r.shown).toEqual(['a', 'b'])
    expect(r.extra).toBe(3)
    // The invariant that makes it honest: nothing vanishes.
    expect(r.shown.length + r.extra).toBe(5)
  })

  test('the accounting holds for every list length up to a wide cell', () => {
    let checked = 0
    for (let n = 0; n <= 12; n++) {
      const names = Array.from({ length: n }, (_, i) => `m${i}`)
      const r = machineCell(names, 3)
      expect(r.shown.length + r.extra).toBe(n)
      expect(r.shown.length).toBeLessThanOrEqual(3)
      // The names shown are the first ones, in order — not an arbitrary subset.
      expect(r.shown).toEqual(names.slice(0, r.shown.length))
      checked++
    }
    expect(checked).toBe(13)
  })

  test('a nonsense limit still shows at least one name rather than only "+N"', () => {
    expect(machineCell(['a', 'b'], 0).shown).toEqual(['a'])
    expect(machineCell(['a', 'b'], 0).extra).toBe(1)
  })
})
