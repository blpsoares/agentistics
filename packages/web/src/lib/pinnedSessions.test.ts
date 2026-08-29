import { describe, it, expect } from 'bun:test'
import { planPinToggle, MAX_PINNED } from './pinnedSessions'

describe('planPinToggle', () => {
  it('pins a new id below the limit', () => {
    const r = planPinToggle(['a'], 'b')
    expect(r.ok).toBe(true)
    expect(r.next).toEqual(['a', 'b'])
    expect(r.reason).toBeUndefined()
  })

  it('unpins an id that is already pinned (always succeeds, even at the limit)', () => {
    const r = planPinToggle(['a', 'b', 'c'], 'b')
    expect(r.ok).toBe(true)
    expect(r.next).toEqual(['a', 'c'])
  })

  it('REFUSES the fourth pin and leaves the set unchanged', () => {
    const r = planPinToggle(['a', 'b', 'c'], 'd')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('limit')
    expect(r.next).toEqual(['a', 'b', 'c'])
  })

  it('keeps pin order (a swap would surprise; order is stable)', () => {
    let s: string[] = []
    s = planPinToggle(s, 'x').next
    s = planPinToggle(s, 'y').next
    s = planPinToggle(s, 'z').next
    expect(s).toEqual(['x', 'y', 'z'])
    // unpin the middle, then pin a new one — it goes to the end, the others keep their place
    s = planPinToggle(s, 'y').next
    s = planPinToggle(s, 'w').next
    expect(s).toEqual(['x', 'z', 'w'])
  })

  it('respects a custom max', () => {
    expect(planPinToggle(['a'], 'b', 1).ok).toBe(false)
    expect(MAX_PINNED).toBe(3)
  })
})
