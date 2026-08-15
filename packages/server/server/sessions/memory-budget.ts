/**
 * memory-budget.ts — PURE. How much room this machine has left, and how many assistants fit in it.
 *
 * The question this answers is not "how much RAM is used" — every OS already has a tool for that.
 * It is **"can I open another session"**, which is a different question with a different unit, and
 * the only one anybody actually asks before opening one.
 *
 * ## Why the answer is a DISTANCE and not a percentage
 *
 * The colour is decided by how many sessions are left, never by a fraction. Three left out of
 * thirty is comfortable; three left out of fourteen is the last warning you get. Percentages
 * collapse those into the same number, and the thing being spent is a session at a time.
 *
 * ## Two numbers that are easy to confuse, and only one of them is right
 *
 * `MemAvailable` is what the kernel says can be handed out without swapping — it counts the page
 * cache the kernel would happily drop. `MemFree` counts only untouched pages. Measured on this
 * machine at one moment: free 5.7 GB, available 9.7 GB. Using `MemFree` would declare a machine
 * with 4 GB of headroom to be nearly out, and every warning after that is noise the user learns to
 * ignore. So: available, always.
 *
 * ## Swap is part of the answer, not a footnote
 *
 * The freeze this feature exists to prevent was not a RAM shortage: RAM looked fine at 3.6 GB free
 * while SWAP sat at 97% used, and it is the swap thrash that stops a machine responding. A budget
 * that only reads RAM would have said everything was fine at the exact moment the laptop locked up.
 */

/** What the platform could read. Every field is in BYTES. */
export interface MemorySample {
  total: number
  /** `MemAvailable` — reclaimable cache included. Never `MemFree`; see the header. */
  available: number
  swapTotal: number
  swapUsed: number
}

/** One session's measured cost, and how it was arrived at. */
export interface SessionCost {
  bytes: number
  /**
   * `measured` — averaged over the sessions actually running here.
   * `assumed` — nothing was running, so the declared default was used, and the UI must SAY so.
   */
  basis: 'measured' | 'assumed'
}

/**
 * What one assistant costs when none is running to measure.
 *
 * The median of the claude processes on this machine on 2026-08-15, which ranged 162–442 MB. It is
 * a starting point that gets replaced by measurement the moment there is anything to measure, and
 * `basis: 'assumed'` exists so no surface can present it as a reading.
 */
export const ASSUMED_SESSION_BYTES = 250 * 1024 * 1024

/**
 * Held back for everything that is not an assistant — the desktop, the browser, the server, a build.
 *
 * A budget that lets sessions consume every last byte is arithmetically correct and useless: the
 * machine dies before the last one starts. This is the floor the count is computed above.
 */
export const RESERVED_BYTES = 2 * 1024 * 1024 * 1024

/** Swap this full means the machine is already thrashing, whatever the RAM figure says. */
export const SWAP_ALARM_FRACTION = 0.85

/** How many sessions may remain before the number turns red. Three, two, one, none — see header. */
export const RED_WITHIN = 3

export interface MemoryBudget {
  /** How many sessions this machine can hold in total, at the measured cost. */
  max: number
  /** How many are running now. */
  used: number
  /** `max - used`, floored at zero. */
  left: number
  cost: SessionCost
  /** True once `left` is inside `RED_WITHIN`, or the swap alarm has tripped. */
  red: boolean
  /**
   * Why the budget is alarming, or `undefined` when it is not. Distinguished because they call for
   * different actions: `sessions` means close one, `swap` means the machine is ALREADY struggling
   * and closing one may not be enough.
   */
  alarm?: 'sessions' | 'swap'
}

/**
 * The budget — PURE.
 *
 * `sessionBytes` is the total RSS of the assistant processes, and `sessions` how many there were.
 * Both come from the caller because reading them is a platform act.
 */
export function memoryBudget(o: {
  sample: MemorySample
  sessionBytes: number
  sessions: number
  reservedBytes?: number
  assumedBytes?: number
}): MemoryBudget {
  const reserved = o.reservedBytes ?? RESERVED_BYTES
  const cost: SessionCost = o.sessions > 0 && o.sessionBytes > 0
    ? { bytes: Math.round(o.sessionBytes / o.sessions), basis: 'measured' }
    : { bytes: o.assumedBytes ?? ASSUMED_SESSION_BYTES, basis: 'assumed' }

  // What the sessions ALREADY hold is part of the room for sessions: they are the thing being
  // counted. Measuring only what is free would report a ceiling that shrinks as the machine is used
  // correctly — four sessions running would claim a smaller total than the same machine with none.
  //
  // So `room` is the whole envelope and `floor(room / cost)` is the TOTAL, not the remainder. Adding
  // `sessions` on top of it was double counting, caught by the test above: the same machine reported
  // 32 empty and 36 with four running.
  const room = o.sample.available + o.sessionBytes - reserved
  // Never below what is already up: an over-committed machine is a real state, and "2 of 4" is a
  // number nobody can act on. It says 4 of 4, none left.
  const max = Math.max(o.sessions, Math.floor(room / Math.max(1, cost.bytes)))
  const left = Math.max(0, max - o.sessions)

  const swapping = o.sample.swapTotal > 0
    && o.sample.swapUsed / o.sample.swapTotal >= SWAP_ALARM_FRACTION
  // Swap is named FIRST when both trip: it is the more urgent fact and the one closing a session
  // may not fix.
  const alarm = swapping ? 'swap' as const : left <= RED_WITHIN ? 'sessions' as const : undefined
  return { max, used: o.sessions, left, cost, red: alarm !== undefined, ...(alarm ? { alarm } : {}) }
}

/**
 * `MemAvailable` and friends out of `/proc/meminfo` — PURE over the text.
 *
 * Returns `null` when the required fields are not all present, which is how a non-Linux machine and
 * a truncated read reach the same honest answer: **no gauge**, rather than a gauge built on a zero.
 * Same rule as `ControlService.boot` and `HARNESS_CAPABILITIES` — an absent measurement is shown as
 * absent, never as a confident number.
 */
export function parseMeminfo(text: string): MemorySample | null {
  const kb = (key: string): number | undefined => {
    const m = new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm').exec(text)
    return m ? Number(m[1]) * 1024 : undefined
  }
  const total = kb('MemTotal')
  const available = kb('MemAvailable')
  const swapTotal = kb('SwapTotal')
  const swapFree = kb('SwapFree')
  if (total === undefined || available === undefined) return null
  // Swap is optional: a machine with none is not a machine that failed to report. It reads as zero
  // of zero, and `memoryBudget` guards the division.
  return {
    total,
    available,
    swapTotal: swapTotal ?? 0,
    swapUsed: swapTotal !== undefined && swapFree !== undefined ? swapTotal - swapFree : 0,
  }
}
