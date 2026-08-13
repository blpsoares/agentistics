import { describe, test, expect } from 'bun:test'
import { COMPARE_METRICS, buildCompareRows, type CompareSide } from './compareMetrics'

const side = (patch: Partial<CompareSide> = {}): CompareSide => ({
  costUSD: 100, planCostUSD: 50, planMultiple: 2,
  tokens: 10_000_000, sessions: 20, messages: 200, cacheHitRate: 0.6,
  ...patch,
})

const row = (rows: ReturnType<typeof buildCompareRows>, key: string) => rows.find(r => r.metric.key === key)!

describe('buildCompareRows — deltas', () => {
  test('delta is b minus a, and the percentage is relative to a', () => {
    const rows = buildCompareRows(side({ costUSD: 100 }), side({ costUSD: 150 }), 'api')
    const cost = row(rows, 'cost')
    expect(cost.delta).toBe(50)
    expect(cost.deltaPct).toBeCloseTo(0.5, 9)
  })

  test('growth from zero has no percentage — never +Infinity, never +100%', () => {
    const rows = buildCompareRows(side({ costUSD: 0 }), side({ costUSD: 40 }), 'api')
    const cost = row(rows, 'cost')
    expect(cost.delta).toBe(40)
    expect(cost.deltaPct).toBeNull()
  })

  test('a missing side is not zero — both delta and percentage are null', () => {
    const rows = buildCompareRows(side({ sessions: null }), side({ sessions: 10 }), 'api')
    const sessions = row(rows, 'sessions')
    expect(sessions.a).toBeNull()
    expect(sessions.delta).toBeNull()
    expect(sessions.deltaPct).toBeNull()
    expect(sessions.tone).toBe('na')
  })
})

describe('buildCompareRows — tone', () => {
  test('cost down is good, cost up is bad', () => {
    expect(row(buildCompareRows(side({ costUSD: 100 }), side({ costUSD: 60 }), 'api'), 'cost').tone).toBe('good')
    expect(row(buildCompareRows(side({ costUSD: 60 }), side({ costUSD: 100 }), 'api'), 'cost').tone).toBe('bad')
  })

  test('sessions down is bad — the polarity is per metric, not global', () => {
    expect(row(buildCompareRows(side({ sessions: 30 }), side({ sessions: 10 }), 'api'), 'sessions').tone).toBe('bad')
    expect(row(buildCompareRows(side({ sessions: 10 }), side({ sessions: 30 }), 'api'), 'sessions').tone).toBe('good')
  })

  test('a neutral metric is never coloured, and no change is flat', () => {
    expect(row(buildCompareRows(side({ tokens: 10 }), side({ tokens: 99 }), 'api'), 'tokens').tone).toBe('flat')
    expect(row(buildCompareRows(side({ costUSD: 100 }), side({ costUSD: 100 }), 'api'), 'cost').tone).toBe('flat')
  })
})

describe('buildCompareRows — basis', () => {
  test('plan basis uses the plan cost on both sides', () => {
    const rows = buildCompareRows(side({ planCostUSD: 40 }), side({ planCostUSD: 90 }), 'plan')
    const cost = row(rows, 'cost')
    expect(cost.basis).toBe('plan')
    expect(cost.a).toBe(40)
    expect(cost.b).toBe(90)
  })

  test('one side without a plan cost drops the WHOLE row to API — never one column each', () => {
    // A plan figure beside an API figure is two different questions in one row, with a delta
    // between them that means nothing.
    const rows = buildCompareRows(side({ planCostUSD: null }), side({ planCostUSD: 90 }), 'plan')
    const cost = row(rows, 'cost')
    expect(cost.basis).toBe('api')
    expect(cost.a).toBe(100)
    expect(cost.b).toBe(100)
  })

  test('the cache row stays API basis whatever the toggle says', () => {
    const rows = buildCompareRows(side(), side(), 'plan')
    expect(row(rows, 'cacheHitRate').basis).toBe('api')
  })

  test('the plan multiple row stays plan basis whatever the toggle says', () => {
    const rows = buildCompareRows(side(), side(), 'api')
    expect(row(rows, 'planMultiple').basis).toBe('plan')
  })

  test('the plan multiple row disappears when neither side has one', () => {
    // A row that can only ever say "no" is noise, not information.
    const rows = buildCompareRows(side({ planMultiple: null }), side({ planMultiple: null }), 'api')
    expect(rows.find(r => r.metric.key === 'planMultiple')).toBeUndefined()
  })

  test('it survives when only one side has a multiple, so the difference is visible', () => {
    const rows = buildCompareRows(side({ planMultiple: null }), side({ planMultiple: 3 }), 'api')
    const m = row(rows, 'planMultiple')
    expect(m.a).toBeNull()
    expect(m.b).toBe(3)
    expect(m.tone).toBe('na')
  })
})

describe('buildCompareRows — derived values', () => {
  test('tokens per session divides, and refuses to divide by zero', () => {
    expect(row(buildCompareRows(side({ tokens: 100, sessions: 4 }), side(), 'api'), 'tokensPerSession').a).toBe(25)
    expect(row(buildCompareRows(side({ tokens: 100, sessions: 0 }), side(), 'api'), 'tokensPerSession').a).toBeNull()
  })

  test('the effective rate is computed from the API cost in API basis', () => {
    const rows = buildCompareRows(side({ costUSD: 50, tokens: 10_000_000 }), side(), 'api')
    expect(row(rows, 'effectiveCostPerMTokens').a).toBeCloseTo(5, 9)
  })

  test('the effective rate uses the plan cost in plan basis, over the SAME tokens', () => {
    // Only the numerator may move with the basis. If the denominator moved too — the plan basis
    // counts cache, this page's `tokens` does not — the row would change for two reasons at once
    // and compare nothing.
    const rows = buildCompareRows(
      side({ costUSD: 50, planCostUSD: 10, tokens: 10_000_000 }),
      side({ costUSD: 50, planCostUSD: 30, tokens: 10_000_000 }),
      'plan',
    )
    const r = row(rows, 'effectiveCostPerMTokens')
    expect(r.a).toBeCloseTo(1, 9)
    expect(r.b).toBeCloseTo(3, 9)

    const api = row(buildCompareRows(side({ costUSD: 50, tokens: 10_000_000 }), side(), 'api'), 'effectiveCostPerMTokens')
    expect(api.a).toBeCloseTo(5, 9) // same denominator, API numerator
  })
})

describe('COMPARE_METRICS', () => {
  test('keys are unique and every metric is bilingual', () => {
    const keys = COMPARE_METRICS.map(m => m.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const m of COMPARE_METRICS) {
      expect(m.labelEn.length).toBeGreaterThan(0)
      expect(m.labelPt.length).toBeGreaterThan(0)
    }
  })

  test('every row produced is finite or null — never NaN', () => {
    const rows = buildCompareRows(side({ tokens: 0, sessions: 0, costUSD: 0 }), side(), 'plan')
    for (const r of rows) {
      for (const v of [r.a, r.b, r.delta, r.deltaPct]) {
        if (v !== null) expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})
