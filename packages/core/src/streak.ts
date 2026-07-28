/**
 * streak.ts — consecutive-activity-day math, shared by the web dashboard and the terminal UI.
 *
 * Lives in core because both surfaces show a streak KPI and two implementations would drift.
 */

import { format, subDays } from 'date-fns'

/**
 * Consecutive days of activity, counting backwards from today.
 *
 * If today has no activity the count starts from yesterday — deliberate, so nobody is penalised
 * for not having worked *yet* today. Two silent days in a row do end the streak.
 */
export function calcStreak(activeDates: Set<string>, today: Date = new Date()): number {
  let streak = 0
  for (let i = 0; i <= 365; i++) {
    const dateStr = format(subDays(today, i), 'yyyy-MM-dd')
    if (activeDates.has(dateStr)) streak++
    else if (i > 0) break
  }
  return streak
}
