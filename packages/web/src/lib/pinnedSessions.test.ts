import { describe, expect, it } from 'bun:test'
import { planPinMoveTo, resolvePinnedRows } from './pinnedSessions'

describe('planPinMoveTo', () => {
  it('moves a pin down, by key', () => {
    expect(planPinMoveTo(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c'])
  })
  it('moves a pin up, by key', () => {
    expect(planPinMoveTo(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })
  it('is a no-op when dropped on itself', () => {
    expect(planPinMoveTo(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c'])
  })
  it('leaves the list untouched for a key that does not exist', () => {
    expect(planPinMoveTo(['a', 'b'], 'z', 'a')).toEqual(['a', 'b'])
    expect(planPinMoveTo(['a', 'b'], 'a', 'z')).toEqual(['a', 'b'])
    expect(planPinMoveTo([], 'a', 'b')).toEqual([])
  })
  it('never changes membership', () => {
    const out = planPinMoveTo(['a', 'b', 'c', 'd'], 'd', 'b')
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  // THE PLANTED-REVERT EXERCISE for the real §6 defect: an index-based reorder applied to a raw
  // list that holds entries the screen does not render (a pinned id that no longer resolves to any
  // row) moves the WRONG pair of entries whenever something ahead of the dragged/dropped items does
  // not resolve. The key-based version below is immune by construction — it locates each key by
  // identity, not by position, so ghost entries interleaved anywhere never change which two real
  // entries get reordered.
  it('[the §6 bug] reorders correctly across raw entries that never resolve to a visible row', () => {
    // two "ghost" pins (dead-1, dead-2) sit ahead of every live one in the RAW persisted list —
    // exactly the shape observed live: two probe-session ids from an earlier phase, still pinned,
    // whose sessions had since been fully removed from the fleet (not merely ended).
    const raw = ['dead-1', 'dead-2', 'live-a', 'live-b', 'live-c']
    // the user drags the first VISIBLE row (live-a) onto the third VISIBLE row (live-c) — the
    // component only ever has these two KEYS to offer, never their raw-array position.
    const next = planPinMoveTo(raw, 'live-a', 'live-c')
    expect(next.filter(k => k.startsWith('live-'))).toEqual(['live-b', 'live-a', 'live-c'])
    // the ghosts are neither lost nor duplicated.
    expect(next.filter(k => k.startsWith('dead-'))).toEqual(['dead-1', 'dead-2'])
  })
})

interface Row { id: string; state: string }
const keyOf = (r: Row) => r.id

describe('resolvePinnedRows', () => {
  it('finds a pinned row regardless of its state — a filter is never its job', () => {
    // The bug this pins: a pinned row that FINISHED is exactly the case that must still resolve.
    // If a caller pre-filters to "active only" before calling this, the row is gone from the
    // input and no amount of correctness here can bring it back — this asserts the function
    // itself does not add a second filter on top of whatever it is handed.
    const rows: Row[] = [{ id: 'a', state: 'working' }, { id: 'b', state: 'exited' }]
    expect(resolvePinnedRows(['a', 'b'], rows, keyOf)).toEqual(rows)
  })

  it('keeps pin order, not row order', () => {
    const rows: Row[] = [{ id: 'a', state: 'working' }, { id: 'b', state: 'working' }]
    expect(resolvePinnedRows(['b', 'a'], rows, keyOf).map(r => r.id)).toEqual(['b', 'a'])
  })

  it('drops a pinned key with no matching row, rather than inventing one', () => {
    const rows: Row[] = [{ id: 'a', state: 'working' }]
    expect(resolvePinnedRows(['a', 'gone'], rows, keyOf).map(r => r.id)).toEqual(['a'])
  })

  it('is empty for no pins or no rows', () => {
    expect(resolvePinnedRows([], [{ id: 'a', state: 'working' }], keyOf)).toEqual([])
    expect(resolvePinnedRows(['a'], [], keyOf)).toEqual([])
  })
})
