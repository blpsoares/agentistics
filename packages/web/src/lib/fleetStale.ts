/**
 * fleetStale.ts — PURE: is the fleet on screen still the truth, and how do we say it is not?
 *
 * `pollOnce` keeps the last known answer when a poll fails, and the instinct is right: reporting an
 * empty fleet because one request 502'd would say "nothing is running" about a machine with nine
 * live sessions. But the cockpit's own poller keeps the previous list **plus a reason**
 * (`sessions-host.ts`), and the web kept only the list — so with the server down the page went on
 * showing a fleet from minutes ago, rows and all, with nothing on screen saying so. Observed
 * directly: the API answered 502 for a dozen consecutive polls while the list sat there looking
 * live, and the only clue was a header count that no longer matched the rows beneath it.
 *
 * A stale list is worse than an empty one, because an empty one is obviously wrong. This module is
 * the sentence that closes that gap.
 *
 * ONE failure is not staleness. A single missed poll during a rebuild, a laptop waking up, or a
 * server restart is the normal noise of a 5s poll, and a warning that fires on it is a warning
 * people stop reading — the same argument `linkState` makes for not colouring `stale` red on the
 * cockpit's central pill.
 */

/** Consecutive failures before the list is called into question. Two misses is ~10s of silence. */
export const STALE_AFTER_FAILURES = 2

export interface FleetStaleState {
  /** How many polls in a row have failed. Reset to 0 by any success. */
  failures: number
  /** ms epoch of the last poll that answered, or null if none ever has. */
  lastOkMs: number | null
}

/**
 * Should the page say the list may be out of date?
 *
 * `false` while nothing has ever succeeded: that is the LOADING case, and it has its own words
 * already. Saying "this list may be out of date" about a list that was never fetched would name the
 * wrong problem.
 */
export function fleetIsStale(s: FleetStaleState): boolean {
  return s.lastOkMs !== null && s.failures >= STALE_AFTER_FAILURES
}

/**
 * The sentence, with how long it has been. The age is what makes it actionable — "a few seconds"
 * and "eleven minutes" call for different reactions, and a bare "may be out of date" leaves the
 * reader to guess which one they are in.
 */
export function fleetStaleNotice(s: FleetStaleState, now: number, lang: 'en' | 'pt'): string | null {
  if (!fleetIsStale(s)) return null
  const pt = lang === 'pt'
  const secs = Math.max(0, Math.floor((now - (s.lastOkMs ?? now)) / 1000))
  const age = secs < 90
    ? (pt ? `${secs}s` : `${secs}s`)
    : (pt ? `${Math.floor(secs / 60)} min` : `${Math.floor(secs / 60)} min`)
  return pt
    ? `Sem resposta da máquina há ${age}. Esta lista é a última que chegou, não o que está rodando agora.`
    : `No answer from this machine for ${age}. This list is the last one that arrived, not what is running now.`
}
