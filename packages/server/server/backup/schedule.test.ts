import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  MIN_CUSTOM_HOURS, DEFAULT_HOUR, CATCH_UP_LEAD_MS, intervalMs, isDue, scheduleStatus, SCHEDULE_IDS,
  normalizeHour, hourAnchorOnLocalDay, nextRunMs, dayOfWeek, dayAllowed, gridSlotsInRange,
} from './schedule'

const DAY = 86_400_000
const HOUR = 3_600_000
const now = Date.parse('2026-09-04T12:00:00.000Z')

test('a schedule that is off is never due', () => {
  expect(isDue({ schedule: 'off', lastAt: null, nowMs: now, serverRunning: true }).due).toBe(false)
})

test('a daily schedule with no previous run is due immediately', () => {
  const v = isDue({ schedule: 'daily', lastAt: null, nowMs: now, serverRunning: true })
  expect(v.due).toBe(true)
})

test('a daily schedule is not due before the interval elapses', () => {
  const v = isDue({
    schedule: 'daily', lastAt: new Date(now - DAY / 2).toISOString(), nowMs: now, serverRunning: true,
  })
  expect(v.due).toBe(false)
  if (!v.due) expect(v.reason).toBe('not-yet')
})

test('a daily schedule is due once the interval has elapsed', () => {
  const v = isDue({
    schedule: 'daily', lastAt: new Date(now - DAY - 1).toISOString(), nowMs: now, serverRunning: true,
  })
  expect(v.due).toBe(true)
})

test('weekly is seven days, not seven of anything else', () => {
  const base = { schedule: 'weekly' as const, nowMs: now, serverRunning: true }
  expect(isDue({ ...base, lastAt: new Date(now - 6 * DAY).toISOString() }).due).toBe(false)
  expect(isDue({ ...base, lastAt: new Date(now - 8 * DAY).toISOString() }).due).toBe(true)
})

test('an unparseable lastAt is treated as never run, not as now', () => {
  expect(isDue({ schedule: 'daily', lastAt: 'garbage', nowMs: now, serverRunning: true }).due).toBe(true)
})

test('with the server stopped nothing is due and the status is `inactive`, with no next time', () => {
  const input = { schedule: 'daily' as const, lastAt: null, nowMs: now, serverRunning: false }
  expect(isDue(input).due).toBe(false)
  const s = scheduleStatus(input)
  expect(s.kind).toBe('inactive-no-server')
  expect(s.nextAtMs).toBeNull()
})

test('with the server running the status names the next anchored time', () => {
  const s = scheduleStatus({
    schedule: 'daily', atHour: 10, tzOffsetMinutes: 0,
    lastAt: new Date(now - DAY / 2).toISOString(), nowMs: now, serverRunning: true,
  })
  expect(s.kind).toBe('next')
  expect(s.nextAtMs).toBe(Date.parse('2026-09-05T10:00:00.000Z'))
})

test('an off schedule reports off, not a missing next time', () => {
  expect(scheduleStatus({ schedule: 'off', lastAt: null, nowMs: now, serverRunning: true }).kind).toBe('off')
})

test('the control center\'s BackupScheduleId union matches SCHEDULE_IDS, member for member', () => {
  const source = readFileSync(join(import.meta.dir, '..', '..', '..', 'tui', 'src', 'control', 'types.ts'), 'utf8')
  const decl = source.match(/export type BackupScheduleId = ([^\n]+)/)?.[1]
  expect(decl).toBeDefined()
  const members = [...decl!.matchAll(/'([a-z-]+)'/g)].map(m => m[1]!)
  expect(members.sort()).toEqual([...SCHEDULE_IDS].sort())
})

describe('custom — an interval the user picks', () => {
  test('custom uses customHours, and off/daily/weekly ignore it', () => {
    expect(intervalMs('custom', 6)).toBe(6 * 3_600_000)
    expect(intervalMs('custom', 72)).toBe(72 * 3_600_000)
    expect(intervalMs('daily', 6)).toBe(86_400_000)
    expect(intervalMs('off', 6)).toBe(null)
  })

  test('a custom interval below the floor is CLAMPED, never honoured', () => {
    expect(intervalMs('custom', 0)).toBe(MIN_CUSTOM_HOURS * 3_600_000)
    expect(intervalMs('custom', -5)).toBe(MIN_CUSTOM_HOURS * 3_600_000)
    expect(intervalMs('custom', 0.25)).toBe(MIN_CUSTOM_HOURS * 3_600_000)
  })

  test('a missing or unusable customHours falls back to daily, never to "never"', () => {
    expect(intervalMs('custom', undefined)).toBe(86_400_000)
    expect(intervalMs('custom', Number.NaN)).toBe(86_400_000)
  })

  test('custom is in SCHEDULE_IDS, so every surface offering the list offers it', () => {
    expect(SCHEDULE_IDS).toContain('custom')
  })
})

test('an hour outside the clock is clamped, never refused — a field is an intent', () => {
  expect(normalizeHour(undefined)).toBe(DEFAULT_HOUR)
  expect(normalizeHour(NaN)).toBe(DEFAULT_HOUR)
  expect(normalizeHour(-3)).toBe(0)
  expect(normalizeHour(99)).toBe(23)
  expect(normalizeHour(10.7)).toBe(10)
})

test('the anchor lands on the local clock, not on UTC', () => {
  const at = hourAnchorOnLocalDay(Date.parse('2026-09-04T12:00:00Z'), 1, 10, 180)
  expect(new Date(at).toISOString()).toBe('2026-09-05T13:00:00.000Z')
})

test('a daily run already taken today is not due again today', () => {
  const base = { schedule: 'daily' as const, atHour: 10, tzOffsetMinutes: 0, serverRunning: true }
  const v = isDue({ ...base, lastAt: '2026-09-04T09:00:00.000Z', nowMs: Date.parse('2026-09-04T11:00:00Z') })
  expect(v.due).toBe(false)
  if (v.due) return
  expect(v.reason).toBe('not-yet')
})

test('a daily run is due at the anchor hour the next day, and not before', () => {
  const base = { schedule: 'daily' as const, atHour: 10, tzOffsetMinutes: 0, serverRunning: true, lastAt: '2026-09-04T09:00:00.000Z' }
  expect(isDue({ ...base, nowMs: Date.parse('2026-09-05T09:59:00Z') }).due).toBe(false)
  expect(isDue({ ...base, nowMs: Date.parse('2026-09-05T10:00:00Z') }).due).toBe(true)
})

test('a missed window is owed on start, and the run after it is the next anchor', () => {
  const base = { schedule: 'daily' as const, atHour: 10, tzOffsetMinutes: 0, serverRunning: true }
  const bootedLate = Date.parse('2026-09-06T14:00:00Z')
  expect(isDue({ ...base, lastAt: '2026-09-04T10:00:00.000Z', nowMs: bootedLate }).due).toBe(true)
  const after = nextRunMs({ ...base, lastAt: null, nowMs: bootedLate }, bootedLate)
  expect(new Date(after!).toISOString()).toBe('2026-09-07T10:00:00.000Z')
})

test('a weekly run is anchored a week on, at the same hour', () => {
  const after = nextRunMs(
    { schedule: 'weekly', atHour: 8, tzOffsetMinutes: 0, lastAt: null, nowMs: now, serverRunning: true },
    Date.parse('2026-09-04T09:00Z'),
  )
  expect(new Date(after!).toISOString()).toBe('2026-09-11T08:00:00.000Z')
})

test('an owed run is reported as now, never as a time already past', () => {
  const s = scheduleStatus({
    schedule: 'daily', atHour: 10, tzOffsetMinutes: 0,
    lastAt: '2026-09-01T10:00:00.000Z', nowMs: now, serverRunning: true,
  })
  expect(s.kind).toBe('next')
  if (s.kind !== 'next') return
  expect(s.nextAtMs).toBe(now)
})

describe('custom now anchors to atHour — a fixed grid, never one that drifts to a late reconnect', () => {
  const GRID_AT_HOUR = 9
  const GRID_EVERY_HOURS = 8
  const base = {
    schedule: 'custom' as const, customHours: GRID_EVERY_HOURS, atHour: GRID_AT_HOUR,
    tzOffsetMinutes: 0, serverRunning: true,
  }

  test('an 8-in-8h grid anchored at 09h reads 09 / 17 / 01, every day, forever', () => {
    const slots = gridSlotsInRange(
      GRID_AT_HOUR, GRID_EVERY_HOURS, 0, undefined,
      Date.parse('2026-09-04T08:00:00.000Z'), Date.parse('2026-09-05T02:00:00.000Z'),
    )
    expect(slots.map(t => new Date(t).toISOString())).toEqual([
      '2026-09-04T09:00:00.000Z',
      '2026-09-04T17:00:00.000Z',
      '2026-09-05T01:00:00.000Z',
    ])
  })

  test('the grid does not reset phase at midnight — it keeps stepping across the day boundary', () => {
    // 01:00 the next day is a real grid slot (09 - 8 = 01, wrapping past midnight), not just 09/17.
    const slots = gridSlotsInRange(GRID_AT_HOUR, GRID_EVERY_HOURS, 0, undefined,
      Date.parse('2026-09-04T00:30:00.000Z'), Date.parse('2026-09-04T01:30:00.000Z'))
    expect(slots).toEqual([Date.parse('2026-09-04T01:00:00.000Z')])
  })

  test('nextRunMs never drifts: a `last` anywhere still lands on the fixed grid', () => {
    // `last` recorded at an arbitrary, off-grid instant (a late catch-up run) — the NEXT slot the
    // grid names is still 09/17/01, never "last + 8h" from the odd instant it actually ran.
    const late = Date.parse('2026-09-04T06:00:00.000Z')
    const next = nextRunMs({ ...base, lastAt: null, nowMs: late }, late)
    expect(new Date(next!).toISOString()).toBe('2026-09-04T09:00:00.000Z')
  })

  test('reconnecting 2h+ before the next grid slot runs the missed backup now (confirmed example: 06h, next at 09h)', () => {
    const v = isDue({
      ...base, lastAt: '2026-09-01T09:00:00.000Z', nowMs: Date.parse('2026-09-04T06:00:00.000Z'),
    })
    expect(v.due).toBe(true)
  })

  test('reconnecting less than 2h before the next grid slot waits instead (confirmed example: 07h, next at 09h)', () => {
    const v = isDue({
      ...base, lastAt: '2026-09-01T09:00:00.000Z', nowMs: Date.parse('2026-09-04T07:00:00.000Z'),
    })
    expect(v.due).toBe(false)
    if (v.due) return
    expect(v.reason).toBe('too-close-to-next')
  })

  test('the boundary is exclusive: a gap of exactly 2h still waits, a gap just over 2h runs', () => {
    expect(CATCH_UP_LEAD_MS).toBe(2 * HOUR)
    const lastAt = '2026-09-01T09:00:00.000Z'
    const exactlyTwoHours = isDue({ ...base, lastAt, nowMs: Date.parse('2026-09-04T09:00:00.000Z') - CATCH_UP_LEAD_MS })
    expect(exactlyTwoHours.due).toBe(false)
    const justOver = isDue({ ...base, lastAt, nowMs: Date.parse('2026-09-04T09:00:00.000Z') - CATCH_UP_LEAD_MS - 1 })
    expect(justOver.due).toBe(true)
  })

  test('never more than one catch-up: several missed slots still only ever ask about the one nearest to now', () => {
    // `last` is days behind — many grid slots were missed — but the verdict only ever depends on
    // the gap from `now` to the single next future slot, never on how many were skipped.
    const v = isDue({
      ...base, lastAt: '2026-08-20T09:00:00.000Z', nowMs: Date.parse('2026-09-04T06:00:00.000Z'),
    })
    expect(v.due).toBe(true)
  })

  test('an ordinary, on-time tick always fires — the 2h buffer never suppresses the routine trigger', () => {
    // Only ONE slot has elapsed since `last` (17h -> the very next slot, 01h) — this is the normal
    // periodic tick, not a reconnect, so it must fire even though the FOLLOWING slot (09h) is less
    // than 2h away from `now` at the moment it becomes due.
    const v = isDue({
      ...base, lastAt: '2026-09-03T17:00:00.000Z', nowMs: Date.parse('2026-09-04T01:00:00.000Z'),
    })
    expect(v.due).toBe(true)
  })

  test('a short custom interval (below the 2h buffer) still fires on its ordinary schedule', () => {
    // An hourly grid never has more than an hour to its next slot, so if the routine tick required
    // clearing the 2h buffer it could never fire at all. It must not.
    const hourly = { schedule: 'custom' as const, customHours: 1, atHour: 0, tzOffsetMinutes: 0, serverRunning: true }
    const v = isDue({ ...hourly, lastAt: '2026-09-04T03:00:00.000Z', nowMs: Date.parse('2026-09-04T04:05:00.000Z') })
    expect(v.due).toBe(true)
  })
})

describe('days — restricting a schedule to specific weekdays', () => {
  test('absent or empty `days` means every day (no regression for configs saved before the field existed)', () => {
    const at = Date.parse('2026-09-04T12:00:00.000Z')
    expect(dayAllowed(at, 0, undefined)).toBe(true)
    expect(dayAllowed(at, 0, [])).toBe(true)
  })

  test('a day outside the filter is skipped, even though the plain hour math lines up', () => {
    const lastAt = '2026-09-07T10:00:00.000Z'
    const allowedDay = dayOfWeek(Date.parse(lastAt), 0)
    // Exactly 24h later, same hour — due under no filter, but that next calendar day is a
    // DIFFERENT weekday, so restricting to `last`'s own weekday must push it out to next week.
    const v = isDue({
      schedule: 'daily', atHour: 10, tzOffsetMinutes: 0, days: [allowedDay],
      lastAt, nowMs: Date.parse(lastAt) + DAY, serverRunning: true,
    })
    expect(v.due).toBe(false)
    if (v.due) return
    expect(v.reason).toBe('not-yet')
    const next = nextRunMs({
      schedule: 'daily', atHour: 10, tzOffsetMinutes: 0, days: [allowedDay],
      lastAt, nowMs: Date.parse(lastAt) + DAY, serverRunning: true,
    }, Date.parse(lastAt))
    expect(next).toBe(Date.parse(lastAt) + 7 * DAY)
  })

  test('a matching weekday still fires normally', () => {
    const lastAt = '2026-09-07T10:00:00.000Z'
    const allowedDay = dayOfWeek(Date.parse(lastAt), 0)
    const v = isDue({
      schedule: 'daily', atHour: 10, tzOffsetMinutes: 0, days: [allowedDay],
      lastAt, nowMs: Date.parse(lastAt) + 7 * DAY, serverRunning: true,
    })
    expect(v.due).toBe(true)
  })

  test('weekly ignores `days` — it is already pinned to a single weekday by `lastAt`', () => {
    const after = nextRunMs(
      {
        schedule: 'weekly', atHour: 8, tzOffsetMinutes: 0, days: [1, 2, 3, 4, 5],
        lastAt: null, nowMs: now, serverRunning: true,
      },
      Date.parse('2026-09-04T09:00Z'),
    )
    expect(new Date(after!).toISOString()).toBe('2026-09-11T08:00:00.000Z')
  })
})
