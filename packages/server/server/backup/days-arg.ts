/**
 * days-arg.ts — PURE. Parsing a `--days` flag's value into `schedule.ts`'s `days: number[]`
 * (0=Sunday…6=Saturday), shared by every surface that reads it off a command line.
 *
 * Accepts either the digit or a three-letter English weekday name (`mon`, `tue`, …), case-
 * insensitively, comma-separated — the CLI already spells out `SCHEDULE_IDS` and `HARNESS_ORDER`
 * the same way, so a schedule day is typed the same way as everything else it sits beside on that
 * line. Digits are accepted too because a hand-written preferences file or a script generating the
 * flag has no reason to spell out a name for what `schedule.ts` itself always stores as a number.
 */

/** Index-matches `dayOfWeek`'s 0=Sunday…6=Saturday convention. */
export const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** `mon,wed,fri` or `1,3,5` (or a mix) -> `[1,3,5]`, sorted and deduplicated — or the bad token(s)
 *  named so the CLI can refuse with a sentence rather than a silently-wrong schedule. An empty
 *  string parses to `[]`, which reads as "every day" downstream — the same as never passing `--days`
 *  at all, but explicit, which is what lets a picker CLEAR a previously-narrowed schedule. */
export function parseDaysArg(raw: string): number[] | { error: string } {
  const tokens = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const days = new Set<number>()
  const bad: string[] = []
  for (const token of tokens) {
    const asNumber = Number(token)
    if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber <= 6) { days.add(asNumber); continue }
    const named = DAY_NAMES.indexOf(token as (typeof DAY_NAMES)[number])
    if (named !== -1) { days.add(named); continue }
    bad.push(token)
  }
  if (bad.length) {
    return { error: `unknown day: ${bad.join(', ')} (known: ${DAY_NAMES.join(', ')}, or 0-6)` }
  }
  return [...days].sort((a, b) => a - b)
}
