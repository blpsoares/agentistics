/**
 * activityTrend.ts — PURE: the days a filtered window actually covers, in order, with nothing
 * invented for the days it does not.
 *
 * The calendar beside this answers "which days had activity, over half a year". This answers a
 * different question about a narrower thing: "how did the window I am LOOKING at move" — the range
 * the date filter selected, day by day. They sit side by side because a heatmap is read as texture
 * and a line is read as a shape, and the same numbers say different things in the two.
 *
 * A DAY WITH NO ACTIVITY IS A ZERO, NOT A GAP. The calendar can leave a cell pale and be understood;
 * a line that skips a day draws a segment between two dates that are not adjacent, which reads as a
 * slope that never happened. So the range is filled — every day between the first and the last gets
 * a point, and the quiet ones get zero, which is what they were.
 *
 * IT NEVER INVENTS A RANGE. Given nothing, it returns nothing rather than a flat line across an
 * arbitrary fortnight: an empty chart is visibly empty, while a chart of zeroes looks like a
 * measurement that came back all zero.
 */

export interface TrendDay {
  /** `yyyy-MM-dd`, the same day key the heatmap uses. */
  date: string
  sessions: number
  messages: number
}

interface HeatDay { date: string; value: number; sessions: number }

/** Days between two `yyyy-MM-dd` keys, inclusive. UTC arithmetic, matching `tagSessionDay`. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return out
  for (let t = a; t <= b; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/**
 * The window's daily series, oldest first.
 *
 * `cap` bounds the number of points: a year of days is 365 marks in a strip a few hundred pixels
 * wide, which is a smear rather than a shape. Past it the OLDEST days are dropped, because the
 * question a trend beside a live fleet answers is about the recent end of the window.
 */
export function activityTrend(days: readonly HeatDay[], cap = 90): TrendDay[] {
  const seen = new Map<string, { sessions: number; messages: number }>()
  for (const d of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue
    const prev = seen.get(d.date)
    if (prev) { prev.sessions += d.sessions; prev.messages += d.value }
    else seen.set(d.date, { sessions: d.sessions, messages: d.value })
  }
  const keys = [...seen.keys()].sort()
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (first === undefined || last === undefined) return []

  const filled = daysBetween(first, last).map(date => ({
    date,
    sessions: seen.get(date)?.sessions ?? 0,
    messages: seen.get(date)?.messages ?? 0,
  }))
  return filled.length > cap ? filled.slice(filled.length - cap) : filled
}

/** The tallest value in the series, for scaling. `0` when there is nothing — never a divide by it. */
export function trendPeak(series: readonly TrendDay[]): number {
  return series.reduce((m, d) => Math.max(m, d.sessions), 0)
}
