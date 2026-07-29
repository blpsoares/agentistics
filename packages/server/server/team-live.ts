/**
 * team-live.ts — central-side registry of the members' LIVE sessions.
 *
 * WHY this exists: `live-sessions.ts` detects open assistants by reading `/proc` on the machine
 * serving the request. That works on a solo machine, but a central has no visibility into a
 * member's processes, so "Open now" was necessarily empty there and the panel was hidden outright.
 *
 * Members now report their own snapshot over the existing reverse-channel WebSocket
 * (`team-agent.ts`), and the central merges those reports. Nothing is persisted: a live session is
 * true only for the next few seconds, so this is deliberately in-memory and expires on its own —
 * a member that dies stops reporting and its rows vanish without any cleanup path to get wrong.
 *
 * Reports are keyed by the member's resolved display name, exactly like presence, so the caller can
 * scope them to the members a principal may actually see.
 */

import type { LiveProcess } from '@agentistics/core'

/**
 * How long a member's report stays valid. Must comfortably exceed the member's send interval
 * (LIVE_REPORT_INTERVAL_MS in team-agent-client.ts) so a single dropped frame does not blink the
 * panel, while still expiring fast enough that a hard-killed machine clears within seconds.
 */
export const LIVE_REPORT_TTL_MS = 25_000

export interface MemberLiveReport {
  sessionIds: string[]
  processes: LiveProcess[]
  /** Epoch ms the report arrived. */
  at: number
}

/** user (display name) → their most recent report. */
const reports = new Map<string, MemberLiveReport>()

/** Record a member's live snapshot. Later reports replace earlier ones outright — a snapshot is a
 *  complete statement of what is open, so merging would resurrect closed sessions. */
export function recordMemberLive(
  user: string,
  sessionIds: string[],
  processes: LiveProcess[],
  now: number = Date.now(),
): void {
  reports.set(user, { sessionIds, processes, at: now })
}

/** Drop a member's report immediately — used when its socket closes, so the panel does not wait
 *  out the TTL after a clean disconnect. */
export function clearMemberLive(user: string): void {
  reports.delete(user)
}

/**
 * The union of every non-expired report, optionally narrowed to `visibleUsers`.
 *
 * `visibleUsers` is the scoping hook: a principal must never learn that a machine they cannot see
 * is running, nor read its `cwd` off an unmatched process. `null` means no scoping (an owner).
 * Pure apart from reading the module registry; `now` is injectable for tests.
 */
export function collectMemberLive(
  visibleUsers: Set<string> | null = null,
  now: number = Date.now(),
): { liveSessionIds: string[]; liveProcesses: LiveProcess[] } {
  const ids = new Set<string>()
  const processes: LiveProcess[] = []
  for (const [user, r] of reports) {
    if (now - r.at > LIVE_REPORT_TTL_MS) continue
    if (visibleUsers && !visibleUsers.has(user)) continue
    for (const id of r.sessionIds) ids.add(id)
    for (const p of r.processes) processes.push({ ...p, user })
  }
  return { liveSessionIds: [...ids], liveProcesses: processes }
}

/** Test seam — drops every stored report. */
export function resetMemberLive(): void {
  reports.clear()
}
