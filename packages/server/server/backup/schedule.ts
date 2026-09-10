/**
 * schedule.ts — PURE. Whether a scheduled backup is due, and what a surface is allowed to say.
 *
 * The scheduled run rides along with the daemon `agentop server` already starts — the argument
 * `events/daemon.ts` records, applied to a second job: it is the long-lived thing that already
 * exists, is already covered by `agentop autostart`, and is never a process the user has to
 * remember to start. A backup is not itself long-lived, so a system timer would also have worked;
 * riding along wins because it is ONE mechanism on every platform, and because the server is what
 * produces the metrics — stopped, there is nothing new to save.
 *
 * That choice has a cost, and `scheduleStatus` is where the product pays it honestly: with the
 * server stopped there is no next run, and the status says `inactive-no-server` rather than
 * printing a time that will not arrive. The same N/A-versus-a-confident-0 rule
 * `HARNESS_CAPABILITIES` applies to metrics, applied to a promise.
 */

export type ScheduleId = 'off' | 'daily' | 'weekly' | 'custom'

export const SCHEDULE_IDS: ScheduleId[] = ['off', 'daily', 'weekly', 'custom']

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/**
 * The floor for a custom interval, in hours.
 *
 * A backup here is 112 MB and confirming its upload RE-DOWNLOADS the whole file to hash it. Hourly
 * is already a lot; anything under that is a machine that spends its day backing itself up. The
 * value is CLAMPED rather than refused — a number typed into a field is an intent, and rejecting
 * it outright would leave the schedule on whatever it was.
 */
export const MIN_CUSTOM_HOURS = 1

/**
 * The hour of the local day a `daily` / `weekly` / `custom` run is anchored to.
 *
 * A cadence with no time of day is a cadence anchored to whenever the machine last happened to run
 * one, which drifts and lands in the middle of the working day. Mid-morning is the default because
 * the machine is on by then and the run is not competing with a login.
 */
export const DEFAULT_HOUR = 10

/**
 * How long the next scheduled slot must still be away for a missed one to be worth catching up on
 * right now (`isDue`'s `'too-close-to-next'` reason).
 *
 * Confirmed with the user against a concrete pair: reconnecting at 06h with an 8-in-8h grid
 * anchored at 09h (so the grid is 01/09/17) runs the missed backup immediately, because the next
 * normal slot (09h) is still 3h away — but reconnecting at 07h, with that same 09h only 2h away,
 * waits for it instead of running two backups within the hour of each other. The boundary is
 * therefore EXCLUSIVE on the "run now" side: a gap of exactly two hours still waits, only a gap
 * that exceeds two hours triggers the catch-up. Never reopen this — see the task's confirmed
 * decision.
 */
export const CATCH_UP_LEAD_MS = 2 * HOUR_MS

/** An hour outside 0–23 is not an hour. Clamped, never refused: a field is an intent. */
export function normalizeHour(h: number | undefined): number {
  if (h === undefined || !Number.isFinite(h)) return DEFAULT_HOUR
  return Math.min(23, Math.max(0, Math.trunc(h)))
}

/**
 * `hour:00:00` local, on the local day `dayOffset` days after the one holding `ms`.
 *
 * Anchoring to the DAY rather than to "the next time that hour comes round" is what makes `daily`
 * mean AT MOST ONE PER DAY. The other reading fires an hour after a manual backup taken at 09:00
 * with the anchor at 10:00 — two runs in a morning, from a setting that says "daily".
 *
 * The offset is passed in rather than read here so the module stays pure and testable: the caller
 * hands it `new Date().getTimezoneOffset()`, the same local-clock convention the harness adapters
 * use for activity hours. Sub-hour precision is deliberately dropped — a backup is not a cron job,
 * and "10am" is the whole of what anyone asked for.
 */
export function hourAnchorOnLocalDay(
  ms: number, dayOffset: number, hour: number, tzOffsetMinutes: number,
): number {
  const offset = tzOffsetMinutes * 60_000
  // Shift into a frame where plain arithmetic reads the local clock.
  const local = ms - offset
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS
  return dayStart + dayOffset * DAY_MS + normalizeHour(hour) * HOUR_MS + offset
}

/** null = never fires. A Record so a new id cannot be added without giving it an interval.
 *  `custom` is null HERE because its interval is not a constant — see `intervalMs`. */
export const SCHEDULE_MS: Record<ScheduleId, number | null> = {
  off: null,
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
  custom: null,
}

/**
 * How long between runs, for a schedule that may carry its own number.
 *
 * In HOURS, which is the one unit that serves both ends of what people actually ask for: "every 6
 * hours" and "every 3 days" are then the same field. Days alone cannot express the first, and
 * minutes would invite a value that runs a 112 MB backup every five of them.
 *
 * An absent or unusable `customHours` falls back to DAILY, never to "never": a schedule the user
 * deliberately switched on must not silently become one that never fires — that breaks the promise
 * in the direction where nobody notices until they need the backup.
 */
export function intervalMs(schedule: ScheduleId, customHours?: number): number | null {
  if (schedule !== 'custom') return SCHEDULE_MS[schedule]
  if (customHours === undefined || !Number.isFinite(customHours)) return DAY_MS
  return Math.max(MIN_CUSTOM_HOURS, customHours) * HOUR_MS
}

/**
 * 0 = Sunday … 6 = Saturday, the local day-of-week `ms` falls on.
 *
 * 1970-01-01 (epoch day 0) was a Thursday (weekday 4), so an arbitrary day index is folded back to
 * that reference rather than trusting `Date`'s own day-of-week reader — which would need a `Date`
 * object per call for what is otherwise integer arithmetic identical to every other local-frame
 * computation in this file.
 */
export function dayOfWeek(ms: number, tzOffsetMinutes: number): number {
  const offset = tzOffsetMinutes * 60_000
  const local = ms - offset
  const dayIndex = Math.floor(local / DAY_MS)
  return (((dayIndex + 4) % 7) + 7) % 7
}

/**
 * Is `ms` on one of the allowed weekdays? Absent or empty `days` means every day — the same
 * "absence is not a more restrictive value" convention the rest of the product follows (never
 * invert this: a config saved before `days` existed must keep running every day it always did).
 */
export function dayAllowed(ms: number, tzOffsetMinutes: number, days: number[] | undefined): boolean {
  if (!days || days.length === 0) return true
  return days.includes(dayOfWeek(ms, tzOffsetMinutes))
}

export interface ScheduleInput {
  schedule: ScheduleId
  /** Only read when `schedule` is `'custom'`. See `intervalMs`. */
  customHours?: number
  /** The local hour a daily/weekly/custom run is anchored to. Absent reads as `DEFAULT_HOUR`.
   *  For `custom` this is the grid's own anchor (see `nextRunMs`), not a per-day time of day — the
   *  grid steps by `customHours` from this hour indefinitely, never resetting phase at midnight. */
  atHour?: number
  /** `new Date().getTimezoneOffset()` from the caller — see `hourAnchorAfter`. */
  tzOffsetMinutes?: number
  /** Which local weekdays (0=Sunday…6=Saturday) the schedule may run on. Absent or empty means
   *  every day — this is the DEFAULT, never a more restrictive reading, so a config saved before
   *  this field existed keeps running every day it always did. Applies to `daily` and `custom`;
   *  `weekly` ignores it — it is already pinned to a single day of the week, the one `lastAt` fell
   *  on, and a second day-of-week filter on top of that would just be a more confusing way to
   *  express the same "one day a week" idea. */
  days?: number[]
  /** ISO of the last run, or null. Unparseable reads as never — a corrupt timestamp must not
   *  suppress backups forever, which is what treating it as "now" would do. */
  lastAt: string | null
  nowMs: number
  serverRunning: boolean
}

export type ScheduleVerdict =
  | { due: true }
  | { due: false; reason: 'off' | 'not-yet' | 'no-server' | 'too-close-to-next' }

export type ScheduleStatus =
  | { kind: 'off'; nextAtMs: null }
  | { kind: 'inactive-no-server'; nextAtMs: null }
  | { kind: 'next'; nextAtMs: number }

function lastMs(lastAt: string | null): number | null {
  if (!lastAt) return null
  const t = Date.parse(lastAt)
  return Number.isFinite(t) ? t : null
}

/**
 * The smallest `daily` grid slot that is strictly after `ms`, honouring `days`.
 *
 * `minOffsetDays` is what makes the SAME stepping function serve two different questions: called
 * with `1` (from `last`) it enforces "never the same calendar day as `last`", which is the
 * invariant that makes `daily` mean at most once a day rather than "an hour after whatever last
 * happened to run". Called with `0` (from `now`, for the catch-up check below) it allows TODAY's
 * slot if the anchor hour has not passed yet — a different question ("when does the grid next
 * fire from here"), asked with no `last` in the picture at all.
 *
 * Bounded at 7 days past the starting offset: `days` names at most 7 distinct weekdays, so an
 * allowed one is always found within one full week of stepping, and the loop cannot run away on a
 * config that (incorrectly) names no valid day at all.
 */
function dailyNextAllowed(
  ms: number, atHour: number, tzOffsetMinutes: number, days: number[] | undefined, minOffsetDays: number,
): number {
  for (let offset = minOffsetDays; offset <= minOffsetDays + 7; offset++) {
    const candidate = hourAnchorOnLocalDay(ms, offset, atHour, tzOffsetMinutes)
    if (candidate > ms && dayAllowed(candidate, tzOffsetMinutes, days)) return candidate
  }
  // Unreachable while `days` names at least one valid weekday (the loop above always finds one
  // within 7 days); kept as a total fallback rather than letting the function ever return undefined.
  return hourAnchorOnLocalDay(ms, minOffsetDays + 8, atHour, tzOffsetMinutes)
}

/**
 * The instant a `custom` grid is anchored to: `atHour` local, on the local day holding the epoch.
 *
 * Any instant at local-hour `atHour` works as the anchor — grid slots are this plus any whole
 * multiple of the interval, forever in both directions — so the epoch is just a fixed, arbitrary
 * reference that never moves. This is the fix for the bug the redesign exists to close: the OLD
 * `custom` anchored to `last`, so a late reconnect slid the whole grid to the reconnect time
 * instead of keeping it at the fixed 09/17/01 (or whatever hours) the user configured.
 */
function customGridAnchorMs(atHour: number, tzOffsetMinutes: number): number {
  return hourAnchorOnLocalDay(0, 0, atHour, tzOffsetMinutes)
}

/**
 * The smallest `custom` grid slot that is strictly after `ms`, honouring `days`.
 *
 * `everyMs` is the ALREADY-CLAMPED interval (`intervalMs`'s return value) — this function never
 * re-derives the floor or the "unusable falls back to daily" rule, so there is exactly one place
 * that decides what a custom interval means in milliseconds.
 *
 * Bounded the same way `dailyNextAllowed` is: at most 7 days' worth of slots need scanning before
 * an allowed weekday repeats, however short the interval.
 */
function customNextAllowed(
  ms: number, atHour: number, everyMs: number, tzOffsetMinutes: number, days: number[] | undefined,
): number {
  const anchor = customGridAnchorMs(atHour, tzOffsetMinutes)
  let index = Math.floor((ms - anchor) / everyMs) + 1
  const maxSteps = Math.ceil((7 * DAY_MS) / everyMs) + 1
  for (let i = 0; i < maxSteps; i++) {
    const candidate = anchor + index * everyMs
    if (dayAllowed(candidate, tzOffsetMinutes, days)) return candidate
    index++
  }
  // Same total-fallback rationale as `dailyNextAllowed`.
  return anchor + index * everyMs
}

/**
 * Every `custom` grid slot in `[fromMs, toMs)`, honouring `days`.
 *
 * Not read by `isDue`/`nextRunMs` — those only ever need ONE slot at a time — but exposed for a
 * surface that wants to preview the grid a schedule describes (and for tests to pin the exact
 * example the catch-up rule was confirmed against: an 8-hour grid anchored at 09h reads 09/17/01,
 * every day, forever).
 */
export function gridSlotsInRange(
  atHour: number, everyHours: number, tzOffsetMinutes: number,
  days: number[] | undefined, fromMs: number, toMs: number,
): number[] {
  const anchor = customGridAnchorMs(normalizeHour(atHour), tzOffsetMinutes)
  const everyMs = Math.max(MIN_CUSTOM_HOURS, everyHours) * HOUR_MS
  const out: number[] = []
  let index = Math.ceil((fromMs - anchor) / everyMs)
  for (let t = anchor + index * everyMs; t < toMs; index++, t = anchor + index * everyMs) {
    if (t >= fromMs && dayAllowed(t, tzOffsetMinutes, days)) out.push(t)
  }
  return out
}

/**
 * When the run AFTER `last` is owed — the single "next scheduled slot" a status display shows.
 *
 * One rule per schedule kind: `weekly` keeps the exact anchor-a-week-on reading it always had
 * (untouched by this file's redesign — see `ScheduleInput.days`); `daily` and `custom` both go
 * through their own grid-stepping function, which is where the catch-up-related behaviour below
 * (`isDue`) also gets its grid slots from, so the two can never disagree about what the next slot
 * after any given instant is.
 *
 * A machine that was off through its hour comes back with the run already OWED; whether it is
 * worth running THAT SPECIFIC missed run right now, or waiting for the grid's own next slot, is
 * `isDue`'s job, not this function's — `nextRunMs` only ever answers "what slot comes after this
 * one", which is exactly what a status display needs regardless of the catch-up question.
 */
export function nextRunMs(input: ScheduleInput, last: number): number | null {
  const every = intervalMs(input.schedule, input.customHours)
  if (every === null) return null
  const tz = input.tzOffsetMinutes ?? 0
  if (input.schedule === 'weekly') {
    return hourAnchorOnLocalDay(last, 7, normalizeHour(input.atHour), tz)
  }
  const atHour = normalizeHour(input.atHour)
  if (input.schedule === 'daily') return dailyNextAllowed(last, atHour, tz, input.days, 1)
  return customNextAllowed(last, atHour, every, tz, input.days)
}

export function isDue(input: ScheduleInput): ScheduleVerdict {
  const every = intervalMs(input.schedule, input.customHours)
  if (every === null) return { due: false, reason: 'off' }
  if (!input.serverRunning) return { due: false, reason: 'no-server' }
  const last = lastMs(input.lastAt)
  if (last === null) return { due: true }

  if (input.schedule === 'weekly') {
    const next = nextRunMs(input, last)
    if (next === null) return { due: false, reason: 'off' }
    return input.nowMs >= next ? { due: true } : { due: false, reason: 'not-yet' }
  }

  const tz = input.tzOffsetMinutes ?? 0
  const atHour = normalizeHour(input.atHour)
  const isDaily = input.schedule === 'daily'
  const slotAfter = (ms: number, minOffsetDays: number) => isDaily
    ? dailyNextAllowed(ms, atHour, tz, input.days, minOffsetDays)
    : customNextAllowed(ms, atHour, every, tz, input.days)

  const nextAfterLast = slotAfter(last, 1)
  if (input.nowMs < nextAfterLast) return { due: false, reason: 'not-yet' }

  // More than one grid slot has passed since `last` only when the slot AFTER the owed one has
  // also already gone by. That is the one thing distinguishing a genuine reconnect-after-being-off
  // from the ordinary, on-time tick every schedule reaches once per interval — an ordinary tick
  // always finds `nextAfterLast` still ahead of the FOLLOWING slot, so it fires unconditionally
  // here, with no 2h consideration at all. Skipping this distinction would apply the 2h buffer to
  // every trigger, which quietly disables any interval of 2h or under (its own gap to the next
  // slot is never more than 2h even when firing exactly on schedule).
  const followingSlot = slotAfter(nextAfterLast, 1)
  if (input.nowMs < followingSlot) return { due: true }

  // Genuine catch-up territory: at least one whole slot has been skipped. Whether to run the
  // overdue one now or just wait for the grid's own next occurrence turns on how soon that next
  // occurrence is — see `CATCH_UP_LEAD_MS`'s doc comment for the confirmed boundary.
  const nextFutureSlot = slotAfter(input.nowMs, 0)
  const gap = nextFutureSlot - input.nowMs
  return gap > CATCH_UP_LEAD_MS ? { due: true } : { due: false, reason: 'too-close-to-next' }
}

export function scheduleStatus(input: ScheduleInput): ScheduleStatus {
  const every = intervalMs(input.schedule, input.customHours)
  if (every === null) return { kind: 'off', nextAtMs: null }
  if (!input.serverRunning) return { kind: 'inactive-no-server', nextAtMs: null }
  const last = lastMs(input.lastAt)
  if (last === null) return { kind: 'next', nextAtMs: input.nowMs }
  const next = nextRunMs(input, last)
  // An owed run is reported as NOW, not as a time in the past: the schedule says when the next one
  // happens, and "it is already owed" is answered by the next tick, seconds away.
  return { kind: 'next', nextAtMs: next === null ? input.nowMs : Math.max(next, input.nowMs) }
}
