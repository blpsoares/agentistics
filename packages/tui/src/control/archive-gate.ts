/** PURE: should the control center ask the history question the moment it opens?
 *
 *  The consent used to be asked only on the path that STARTS a service from the cockpit. A machine
 *  enabled at boot — the one people actually set up and forget — never crosses that path, so it ran
 *  for weeks preserving nothing while its owner had never been asked anything. The dashboard would
 *  eventually ask, but only when someone opened it; the CLI is where that machine was configured,
 *  so the CLI is where the question belongs.
 *
 *  Two rules, and they are the whole module:
 *  - `pending === null` means the answer is already on record. Never ask again — a machine coming
 *    back up must not re-litigate a decision its owner already made.
 *  - a skip holds for the rest of this run. The user is allowed to decline to decide now; re-opening
 *    the gate behind them would make the skip a lie and the question a nag. The next launch asks
 *    again, and the dashboard still gates on it, so nothing is silently left unanswered. */
import type { ArchiveMode } from './types'

export type ArchiveGate = { ask: false } | { ask: true; suggested: ArchiveMode }

const NO: ArchiveGate = { ask: false }

export function archiveGateOnOpen(
  /** The host's answer: the recommended mode when the question is open, `null` when it is settled. */
  pending: ArchiveMode | null,
  askedThisSession: boolean,
): ArchiveGate {
  if (pending === null || askedThisSession) return NO
  return { ask: true, suggested: pending }
}
