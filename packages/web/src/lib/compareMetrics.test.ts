import { describe, test, expect } from 'bun:test'
import { COMPARE_METRICS, buildCompareRows, describeFilters, type CompareSide } from './compareMetrics'

const side = (patch: Partial<CompareSide> = {}): CompareSide => ({
  costUSD: 100, planCostUSD: 50, planMultiple: 2,
  tokens: 10_000_000, sessions: 20, messages: 200, cacheHitRate: 0.6,
  ...patch,
})

const row = (rows: ReturnType<typeof buildCompareRows>, key: string) => rows.find(r => r.metric.key === key)!

describe('buildCompareRows — deltas against the baseline', () => {
  test('every delta is against side 0, never the neighbour', () => {
    // With three or more sides this IS the meaning of the table; reordering changes the answer,
    // which is why the baseline is fixed at the first side.
    const rows = buildCompareRows([side({ costUSD: 100 }), side({ costUSD: 150 }), side({ costUSD: 80 })], 'api')
    const cost = row(rows, 'cost')
    expect(cost.cells[0]!.delta).toBeNull()
    expect(cost.cells[1]!.delta).toBe(50)
    expect(cost.cells[2]!.delta).toBe(-20)
    expect(cost.cells[1]!.deltaPct).toBeCloseTo(0.5, 9)
  })

  test('growth from zero has no percentage — never +Infinity, never +100%', () => {
    const rows = buildCompareRows([side({ costUSD: 0 }), side({ costUSD: 40 })], 'api')
    expect(row(rows, 'cost').cells[1]!.delta).toBe(40)
    expect(row(rows, 'cost').cells[1]!.deltaPct).toBeNull()
  })

  test('a missing side is not zero — delta and percentage are both null', () => {
    const rows = buildCompareRows([side({ sessions: null }), side({ sessions: 10 })], 'api')
    const cells = row(rows, 'sessions').cells
    expect(cells[0]!.value).toBeNull()
    expect(cells[1]!.delta).toBeNull()
    expect(cells[1]!.tone).toBe('na')
  })

  test('one side alone still renders, with no deltas to state', () => {
    const rows = buildCompareRows([side()], 'api')
    expect(row(rows, 'cost').cells).toHaveLength(1)
    expect(row(rows, 'cost').cells[0]!.delta).toBeNull()
  })

  test('no sides at all yields no rows', () => {
    expect(buildCompareRows([], 'api')).toEqual([])
  })
})

describe('buildCompareRows — tone and the winner', () => {
  test('cost down is good, cost up is bad', () => {
    expect(row(buildCompareRows([side({ costUSD: 100 }), side({ costUSD: 60 })], 'api'), 'cost').cells[1]!.tone).toBe('good')
    expect(row(buildCompareRows([side({ costUSD: 60 }), side({ costUSD: 100 })], 'api'), 'cost').cells[1]!.tone).toBe('bad')
  })

  test('sessions down is bad — the polarity is per metric, not global', () => {
    expect(row(buildCompareRows([side({ sessions: 30 }), side({ sessions: 10 })], 'api'), 'sessions').cells[1]!.tone).toBe('bad')
  })

  test('the winner is by polarity — cheapest for cost, most for sessions', () => {
    const rows = buildCompareRows([side({ costUSD: 100, sessions: 5 }), side({ costUSD: 40, sessions: 9 }), side({ costUSD: 70, sessions: 2 })], 'api')
    expect(row(rows, 'cost').bestIndex).toBe(1)
    expect(row(rows, 'sessions').bestIndex).toBe(1)
  })

  test('a neutral metric crowns nobody', () => {
    // Marking a "winner" where the metric supports no judgement invents one.
    expect(row(buildCompareRows([side({ tokens: 10 }), side({ tokens: 99 })], 'api'), 'tokens').bestIndex).toBeNull()
  })

  test('a single comparable side is not a winner over anything', () => {
    const rows = buildCompareRows([side({ costUSD: 100 }), side({ costUSD: null })], 'api')
    expect(row(rows, 'cost').bestIndex).toBeNull()
  })
})

describe('buildCompareRows — basis', () => {
  test('plan basis uses the plan cost on every side', () => {
    const rows = buildCompareRows([side({ planCostUSD: 40 }), side({ planCostUSD: 90 })], 'plan')
    expect(row(rows, 'cost').basis).toBe('plan')
    expect(row(rows, 'cost').cells.map(c => c.value)).toEqual([40, 90])
  })

  test('ANY side without a plan cost drops the WHOLE row to API', () => {
    // One plan-basis column beside an API-basis one is two different questions in one row, with a
    // delta between them that means nothing.
    const rows = buildCompareRows([side({ planCostUSD: 40 }), side({ planCostUSD: null }), side({ planCostUSD: 90 })], 'plan')
    expect(row(rows, 'cost').basis).toBe('api')
    expect(row(rows, 'cost').cells.every(c => c.value === 100)).toBe(true)
  })

  test('the cache row stays API basis whatever the comparison says', () => {
    expect(row(buildCompareRows([side(), side()], 'plan'), 'cacheHitRate').basis).toBe('api')
  })

  test('the plan multiple row stays plan basis whatever the comparison says', () => {
    expect(row(buildCompareRows([side(), side()], 'api'), 'planMultiple').basis).toBe('plan')
  })

  test('the plan multiple row disappears when NO side has one', () => {
    const rows = buildCompareRows([side({ planMultiple: null }), side({ planMultiple: null })], 'api')
    expect(rows.find(r => r.metric.key === 'planMultiple')).toBeUndefined()
  })

  test('it survives when one side has a multiple, so the difference is visible', () => {
    const rows = buildCompareRows([side({ planMultiple: null }), side({ planMultiple: 3 })], 'api')
    expect(row(rows, 'planMultiple').cells.map(c => c.value)).toEqual([null, 3])
  })
})

describe('buildCompareRows — derived values', () => {
  test('tokens per session divides, and refuses to divide by zero', () => {
    expect(row(buildCompareRows([side({ tokens: 100, sessions: 4 })], 'api'), 'tokensPerSession').cells[0]!.value).toBe(25)
    expect(row(buildCompareRows([side({ tokens: 100, sessions: 0 })], 'api'), 'tokensPerSession').cells[0]!.value).toBeNull()
  })

  test('the effective rate follows the basis in its NUMERATOR only', () => {
    // If the denominator moved too — the plan basis counts cache, this page's `tokens` does not —
    // the row would change for two reasons at once and compare nothing.
    const api = buildCompareRows([side({ costUSD: 50, tokens: 10_000_000 })], 'api')
    expect(row(api, 'effectiveCostPerMTokens').cells[0]!.value).toBeCloseTo(5, 9)
    const plan = buildCompareRows([side({ costUSD: 50, planCostUSD: 10, tokens: 10_000_000 })], 'plan')
    expect(row(plan, 'effectiveCostPerMTokens').cells[0]!.value).toBeCloseTo(1, 9)
  })
})

describe('describeFilters', () => {
  test('names the period and the harnesses, counts the rest', () => {
    const out = describeFilters(
      { dateRange: '30d', harnesses: ['claude'], projects: ['a', 'b'] },
      'en',
      id => (id === 'claude' ? 'Claude Code' : id),
    )
    expect(out).toContain('last 30 days')
    expect(out).toContain('Claude Code')
    expect(out).toContain('2 projects')
  })

  test('a custom range is shown as the range', () => {
    expect(describeFilters({ dateRange: 'all', customStart: '2026-01-01', customEnd: '2026-02-01' }, 'en'))
      .toContain('2026-01-01')
  })

  test('many harnesses are counted rather than listed', () => {
    const out = describeFilters({ dateRange: 'all', harnesses: ['a', 'b', 'c', 'd'] }, 'en')
    expect(out).toContain('4 harnesses')
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

  test('every value produced is finite or null — never NaN', () => {
    const rows = buildCompareRows([side({ tokens: 0, sessions: 0, costUSD: 0 }), side()], 'plan')
    for (const r of rows) {
      for (const c of r.cells) {
        for (const v of [c.value, c.delta, c.deltaPct]) {
          if (v !== null) expect(Number.isFinite(v)).toBe(true)
        }
      }
    }
  })
})
