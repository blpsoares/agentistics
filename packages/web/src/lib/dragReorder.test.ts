import { describe, expect, test } from 'bun:test'
import { reorderByDrag, stepOrder } from './dragReorder'

// ---------------------------------------------------------------------------------------------
// reorderByDrag
// ---------------------------------------------------------------------------------------------

describe('reorderByDrag', () => {
  test('moves the dragged key to just before the drop target, forward', () => {
    expect(reorderByDrag(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'a', 'c', 'd'])
  })

  test('moves the dragged key to just before the drop target, backward', () => {
    expect(reorderByDrag(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })

  test('adjacent swap', () => {
    expect(reorderByDrag(['a', 'b', 'c'], 'b', 'a')).toEqual(['b', 'a', 'c'])
  })

  test('dropping a key onto itself changes nothing but the identity', () => {
    const order = ['a', 'b', 'c']
    const next = reorderByDrag(order, 'b', 'b')
    expect(next).toEqual(order)
    expect(next).not.toBe(order)
  })

  test('a drop target absent from the list is refused — order unchanged', () => {
    expect(reorderByDrag(['a', 'b', 'c'], 'a', 'z')).toEqual(['a', 'b', 'c'])
  })

  test('a dragged key absent from the list is refused — order unchanged', () => {
    expect(reorderByDrag(['a', 'b', 'c'], 'z', 'b')).toEqual(['a', 'b', 'c'])
  })

  test('is total over every (from, to) pair of a five-item list — every result is a permutation', () => {
    const base = ['a', 'b', 'c', 'd', 'e']
    for (const from of base) {
      for (const to of base) {
        const next = reorderByDrag(base, from, to)
        expect(next.slice().sort()).toEqual(base.slice().sort())
      }
    }
  })

  test('never mutates the input array', () => {
    const order = ['a', 'b', 'c']
    const frozen = Object.freeze([...order])
    expect(() => reorderByDrag(frozen, 'a', 'c')).not.toThrow()
    expect(frozen).toEqual(['a', 'b', 'c'])
  })

  // THE PLANTED-REVERT EXERCISE — the exact shape of the real defect this module fixes.
  //
  // The bug this replaces: a drag was resolved against the VISIBLE (filtered) list's index, then
  // that same index was used to splice the RAW (unfiltered) list — the two only agree when nothing
  // is filtered out. Reproduced here with a stand-in for "raw pins with a dead entry that does not
  // resolve to a visible row": dragging the first VISIBLE item onto the third VISIBLE item must
  // reorder by KEY in the raw array, not by the visible position.
  test('a raw list with unresolvable entries interleaved still reorders by KEY, not by filtered position', () => {
    // raw pins: two "dead" ids (x, y) sit ahead of the live ones.
    const raw = ['x', 'y', 'live-a', 'live-b', 'live-c']
    const isLive = (k: string) => k.startsWith('live-')
    const visible = raw.filter(isLive) // ['live-a', 'live-b', 'live-c']

    // The user sees live-a first and live-c third, and drags live-a onto live-c.
    const dragKey = visible[0]!
    const dropKey = visible[2]!

    const next = reorderByDrag(raw, dragKey, dropKey)
    // live-a must land immediately before live-c among the LIVE entries, and the dead entries must
    // survive untouched (the bug this replaces would have spliced against raw[0]/raw[2], i.e.
    // 'x' and 'live-a', producing something with no relation to what the user pointed at).
    expect(next.filter(isLive)).toEqual(['live-b', 'live-a', 'live-c'])
    expect(next.includes('x')).toBe(true)
    expect(next.includes('y')).toBe(true)
  })

  // PLANTED-REVERT: introduce the exact defect (splice by filtered index against the raw array),
  // confirm this test distinguishes correct from broken, then restore.
  test('[planted-revert] the index-based version this replaces fails the KEY-based assertion above', () => {
    function brokenIndexReorder<K>(raw: readonly K[], fromIdx: number, toIdx: number): K[] {
      const next = [...raw]
      if (fromIdx < 0 || fromIdx >= next.length) return next
      if (toIdx < 0 || toIdx >= next.length) return next
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved as K)
      return next
    }
    const raw = ['x', 'y', 'live-a', 'live-b', 'live-c']
    // user thinks they dragged visible index 0 onto visible index 2 (live-a onto live-c), but the
    // broken implementation splices raw index 0 (x) onto raw index 2 (live-a) — the actual defect.
    const broken = brokenIndexReorder(raw, 0, 2)
    expect(broken.filter(k => (k as string).startsWith('live-'))).not.toEqual(['live-b', 'live-a', 'live-c'])
  })
})

// ---------------------------------------------------------------------------------------------
// stepOrder
// ---------------------------------------------------------------------------------------------

describe('stepOrder', () => {
  test('moves one place later', () => {
    expect(stepOrder(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
  })

  test('moves one place earlier', () => {
    expect(stepOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
  })

  test('refuses to step the first item earlier', () => {
    expect(stepOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
  })

  test('refuses to step the last item later', () => {
    expect(stepOrder(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  })

  test('a key not present is a no-op', () => {
    expect(stepOrder(['a', 'b', 'c'], 'z', 1)).toEqual(['a', 'b', 'c'])
  })
})
