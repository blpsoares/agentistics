import { test, expect } from 'bun:test'
import { activityTrend, trendPeak } from './activityTrend'

const d = (date: string, sessions: number, value = sessions * 10) => ({ date, sessions, value })

test('the series is oldest first, whatever order it arrives in', () => {
  const out = activityTrend([d('2026-09-03', 2), d('2026-09-01', 1)])
  expect(out.map(x => x.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
})

test('a quiet day is a ZERO, not a gap', () => {
  // A line that skips a day draws a segment between two dates that are not adjacent, which reads
  // as a slope that never happened.
  const out = activityTrend([d('2026-09-01', 1), d('2026-09-04', 3)])
  expect(out).toHaveLength(4)
  expect(out[1]).toEqual({ date: '2026-09-02', sessions: 0, messages: 0 })
})

test('two entries for one day are summed, not one dropped', () => {
  const out = activityTrend([d('2026-09-01', 1, 10), d('2026-09-01', 2, 20)])
  expect(out).toEqual([{ date: '2026-09-01', sessions: 3, messages: 30 }])
})

test('nothing in yields nothing out — never a flat line across an invented range', () => {
  // A chart of zeroes looks like a measurement that came back all zero; an empty one is visibly
  // empty.
  expect(activityTrend([])).toEqual([])
  expect(activityTrend([{ date: 'not-a-day', sessions: 1, value: 1 }])).toEqual([])
})

test('a long window keeps its RECENT end — the far past is what a live fleet cares least about', () => {
  const many = Array.from({ length: 200 }, (_, i) => {
    const t = Date.parse('2026-01-01T00:00:00Z') + i * 86_400_000
    return d(new Date(t).toISOString().slice(0, 10), i)
  })
  const out = activityTrend(many, 30)
  expect(out).toHaveLength(30)
  expect(out[out.length - 1]!.sessions).toBe(199)
})

test('the peak is the tallest bar, and zero when there is nothing to divide by', () => {
  expect(trendPeak([{ date: 'a', sessions: 3, messages: 0 }, { date: 'b', sessions: 7, messages: 0 }])).toBe(7)
  expect(trendPeak([])).toBe(0)
})
