import { describe, expect, it } from 'bun:test'
import { planPinMove } from './pinnedSessions'

describe('planPinMove', () => {
  it('moves a pin down', () => {
    expect(planPinMove(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })
  it('moves a pin up', () => {
    expect(planPinMove(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })
  it('is a no-op when nothing moves', () => {
    expect(planPinMove(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })
  it('leaves the list untouched for an index that does not exist', () => {
    expect(planPinMove(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
    expect(planPinMove(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(planPinMove([], 0, 0)).toEqual([])
  })
  it('never changes membership', () => {
    const out = planPinMove(['a', 'b', 'c', 'd'], 3, 1)
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})
