import { describe, test, expect } from 'bun:test'
import { fitColumns, type Column } from './Primitives'
import { sparkline } from './Sparkline'
import { fitKpis } from '../screens/Overview'

interface Row { a: string }

function col(key: string, width: number): Column<Row> {
  return { key, header: key, width, render: r => r.a }
}

describe('fitColumns', () => {
  test('drops columns from the right until the table fits', () => {
    // 5 columns of 20 (+1 margin each) = 105, far past a 60-column terminal.
    const cols = ['a', 'b', 'c', 'd', 'e'].map(k => col(k, 20))
    const fitted = fitColumns(cols, 60)
    expect(fitted.length).toBeLessThan(cols.length)
    expect(fitted.map(c => c.key)).toEqual(['a', 'b'])
  })

  test('never drops the identity column, however narrow the terminal', () => {
    const cols = ['a', 'b', 'c'].map(k => col(k, 40))
    const fitted = fitColumns(cols, 10)
    expect(fitted).toHaveLength(1)
    expect(fitted[0]!.key).toBe('a')
  })

  test('gives leftover width to the first column instead of leaving a ragged edge', () => {
    const cols = [col('name', 10), col('cost', 10)]
    const fitted = fitColumns(cols, 60)
    // 60 - (10 + 1 margin for cost) - 1 own margin = 48
    expect(fitted[0]!.width).toBe(48)
    expect(fitted[1]!.width).toBe(10)
  })

  test('total rendered width never exceeds the terminal', () => {
    const cols = ['a', 'b', 'c', 'd', 'e', 'f'].map(k => col(k, 14))
    for (const width of [40, 60, 80, 120, 200]) {
      const total = fitColumns(cols, width).reduce((n, c) => n + c.width + 1, 0)
      expect(total).toBeLessThanOrEqual(width)
    }
  })

  test('returns an empty list unchanged', () => {
    expect(fitColumns([] as Column<Row>[], 80)).toEqual([])
  })
})

describe('fitKpis', () => {
  const kpis = [
    { label: 'cost', value: '$1', width: 18 },
    { label: 'tokens', value: '2', width: 12 },
    { label: 'sessions', value: '3', width: 12 },
    { label: 'messages', value: '4', width: 12 },
    { label: 'streak', value: '5', width: 10 },
  ]

  test('keeps every KPI when the terminal is wide', () => {
    expect(fitKpis(kpis, 200)).toHaveLength(5)
  })

  test('drops trailing KPIs rather than wrapping the row', () => {
    const fitted = fitKpis(kpis, 60)
    expect(fitted.length).toBeLessThan(5)
    expect(fitted.reduce((n, k) => n + k.width + 2, 0)).toBeLessThanOrEqual(60)
  })

  test('always keeps cost, even in a terminal too narrow for it', () => {
    const fitted = fitKpis(kpis, 5)
    expect(fitted).toHaveLength(1)
    expect(fitted[0]!.label).toBe('cost')
  })
})

describe('sparkline', () => {
  test('renders one block per value', () => {
    expect(sparkline([1, 2, 3, 4])).toHaveLength(4)
  })

  test('scales the largest value to the tallest block', () => {
    expect(sparkline([0, 10]).at(-1)).toBe('█')
  })

  test('renders a silent day as the shortest block, never a blank', () => {
    // A blank would collapse the gap and misrepresent the rhythm.
    expect(sparkline([0, 5])[0]).toBe('▁')
  })

  test('renders an all-zero series flat instead of dividing by zero', () => {
    expect(sparkline([0, 0, 0])).toBe('▁▁▁')
  })

  test('returns an empty string for an empty series', () => {
    expect(sparkline([])).toBe('')
  })
})

