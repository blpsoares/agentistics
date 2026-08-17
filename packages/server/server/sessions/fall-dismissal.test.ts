/**
 * The rule behind `ControlHost.dismissFall` — see `cli-start.ts`.
 *
 * The host holds one number and compares it with `>`; these pin what that number has to mean,
 * because the whole reported bug is the offer coming back after an attach/detach with a DIFFERENT
 * set of rows. The host's own copy is a closure over `createControlHost`, so the decision is
 * restated here in the one line it is, and asserted against the sequences that actually happen.
 */
import { describe, expect, it } from 'bun:test'

/** Exactly the host's rule: a fall is withheld once it is not newer than what was dismissed. */
function offerWithheld(fellAtMs: number | undefined, dismissedFallMs: number | null): boolean {
  return fellAtMs !== undefined && dismissedFallMs !== null && fellAtMs <= dismissedFallMs
}

/** Exactly the host's write: monotonic, so an older cluster can never lower the watermark. */
function dismiss(current: number | null, atMs: number): number {
  return current === null ? atMs : Math.max(current, atMs)
}

describe('dismissFall — the offer is asked once per fall, not once per mount', () => {
  it('asks the first time', () => {
    expect(offerWithheld(1000, null)).toBe(false)
  })

  it('does NOT ask again for the same fall — the attach/detach case', () => {
    // Attaching unmounts the cockpit and `runStart` mounts a fresh one on the sessions tab, so the
    // screen's own `restoreAsked` is back to false. The host is what remembers.
    const dismissed = dismiss(null, 1000)
    expect(offerWithheld(1000, dismissed)).toBe(true)
  })

  it('does not ask when the poll re-anchors onto the REMAINDER of the same fall', () => {
    // The offer is capped at 8 rows and only the shown ids are retired, so the next poll finds the
    // rest of the cluster with an anchor at or below the one just answered.
    const dismissed = dismiss(null, 1000)
    expect(offerWithheld(980, dismissed)).toBe(true)
  })

  it('does not resurrect an OLDER cluster — the "sessions that make no sense" half', () => {
    // `planCrashGroup` re-anchors on `max(lastSeenMs)` of whatever is left and deliberately allows
    // that to be days old. Presented as a fresh offer it names sessions from a different event.
    const dismissed = dismiss(null, 1000)
    const threeDaysEarlier = 1000 - 3 * 24 * 60 * 60 * 1000
    expect(offerWithheld(threeDaysEarlier, dismissed)).toBe(true)
    // …and answering it could never lower the watermark either.
    expect(dismiss(dismissed, threeDaysEarlier)).toBe(1000)
  })

  it('DOES ask about a genuinely new crash while the cockpit is open', () => {
    const dismissed = dismiss(null, 1000)
    expect(offerWithheld(2000, dismissed)).toBe(false)
  })

  it('a host that has never been told still asks — a fresh agentop must offer', () => {
    // In memory on purpose: closing the terminal and coming back is the moment the offer exists for.
    expect(offerWithheld(1000, null)).toBe(false)
  })

  it('says nothing about a fleet with no fall at all', () => {
    expect(offerWithheld(undefined, 1000)).toBe(false)
  })
})
