import { describe, test, expect } from 'bun:test'
import {
  pickLensesToSync,
  nextMinInterval,
  MIRROR_DEFAULTS,
  MIRROR_BUDGET_MS,
  MIRROR_MAX_INTERVAL_MS,
  type MirrorLensState,
} from './mirrorSchedule'

const state = (over: Partial<MirrorLensState> & { id: string }): MirrorLensState => ({
  dirty: false, onScreen: true, lastSyncMs: 0, ...over,
})

describe('pickLensesToSync', () => {
  test('never picks more than maxPerFrame, so twenty lenses cost ten frames, not one', () => {
    const many = Array.from({ length: 20 }, (_, i) => state({ id: `l${i}`, dirty: true, lastSyncMs: 0 }))
    expect(pickLensesToSync(many, 1000, MIRROR_DEFAULTS)).toHaveLength(MIRROR_DEFAULTS.maxPerFrame)
  })

  test('picks the least recently synced first — that is the round robin', () => {
    const lenses = [
      state({ id: 'new', dirty: true, lastSyncMs: 900 }),
      state({ id: 'old', dirty: true, lastSyncMs: 100 }),
      state({ id: 'mid', dirty: true, lastSyncMs: 500 }),
    ]
    expect(pickLensesToSync(lenses, 2000, MIRROR_DEFAULTS)).toEqual(['old', 'mid'])
  })

  test('an off-screen lens is never synced, however dirty', () => {
    const lenses = [state({ id: 'hidden', dirty: true, onScreen: false, lastSyncMs: 0 })]
    expect(pickLensesToSync(lenses, 10_000, MIRROR_DEFAULTS)).toEqual([])
  })

  test('a dirty lens waits out the minimum interval', () => {
    const lenses = [state({ id: 'a', dirty: true, lastSyncMs: 1000 })]
    expect(pickLensesToSync(lenses, 1000 + MIRROR_DEFAULTS.minIntervalMs - 1, MIRROR_DEFAULTS)).toEqual([])
    expect(pickLensesToSync(lenses, 1000 + MIRROR_DEFAULTS.minIntervalMs, MIRROR_DEFAULTS)).toEqual(['a'])
  })

  test('a clean lens still syncs on the heartbeat — canvas paint moves no DOM', () => {
    const lenses = [state({ id: 'a', dirty: false, lastSyncMs: 0 })]
    expect(pickLensesToSync(lenses, MIRROR_DEFAULTS.heartbeatMs - 1, MIRROR_DEFAULTS)).toEqual([])
    expect(pickLensesToSync(lenses, MIRROR_DEFAULTS.heartbeatMs, MIRROR_DEFAULTS)).toEqual(['a'])
  })
})

describe('nextMinInterval', () => {
  test('a cycle over budget doubles the interval', () => {
    expect(nextMinInterval(MIRROR_BUDGET_MS + 1, 100)).toBe(200)
  })
  test('the backoff is capped', () => {
    expect(nextMinInterval(999, MIRROR_MAX_INTERVAL_MS)).toBe(MIRROR_MAX_INTERVAL_MS)
  })
  test('a cheap cycle recovers gradually, never below the floor', () => {
    expect(nextMinInterval(1, 400)).toBe(300)
    expect(nextMinInterval(1, MIRROR_DEFAULTS.minIntervalMs)).toBe(MIRROR_DEFAULTS.minIntervalMs)
  })
})
