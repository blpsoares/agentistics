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
 * Reports are keyed by MACHINE (the token hash, i.e. `memberId`), never by display name. A snapshot
 * is a complete statement of what is open ON THE MACHINE THAT SENT IT, so two machines belonging to
 * the same person are two independent statements: keying by name made the second one overwrite the
 * first, and an idle laptop reporting `[]` every 8s erased the desktop's open sessions — the panel
 * read "no sessions open right now" while work was visibly in progress. The display name still
 * travels on the value, because SCOPING is per person (`visibleUsers`) even though the snapshot is
 * per machine.
 */

import type { LiveProcess } from '@agentistics/core'

/**
 * How long a member's report stays valid. Must comfortably exceed the member's send interval
 * (LIVE_REPORT_INTERVAL_MS in team-agent-client.ts) so a single dropped frame does not blink the
 * panel, while still expiring fast enough that a hard-killed machine clears within seconds.
 */
export const LIVE_REPORT_TTL_MS = 25_000

export interface MemberLiveReport {
  /** Display name of the machine's owner — the scoping key, and what each process is stamped with. */
  user: string
  sessionIds: string[]
  processes: LiveProcess[]
  /** Epoch ms the report arrived. */
  at: number
}

/** machineId (token hash) → that machine's most recent report. */
const reports = new Map<string, MemberLiveReport>()

/** Record ONE MACHINE's live snapshot. A later report from the SAME machine replaces the earlier
 *  one outright (a snapshot is complete, so merging would resurrect closed sessions); a report from
 *  a DIFFERENT machine of the same person is additive, because it describes different processes. */
export function recordMemberLive(
  machineId: string,
  user: string,
  sessionIds: string[],
  processes: LiveProcess[],
  now: number = Date.now(),
): void {
  reports.set(machineId, { user, sessionIds, processes, at: now })
}

/** Drop ONE MACHINE's report immediately — used when its socket closes, so the panel does not wait
 *  out the TTL after a clean disconnect. The person's other machines keep reporting. */
export function clearMemberLive(machineId: string): void {
  reports.delete(machineId)
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
  for (const r of reports.values()) {
    if (now - r.at > LIVE_REPORT_TTL_MS) continue
    if (visibleUsers && !visibleUsers.has(r.user)) continue
    for (const id of r.sessionIds) ids.add(id)
    for (const p of r.processes) processes.push({ ...p, user: r.user })
  }
  return { liveSessionIds: [...ids], liveProcesses: processes }
}

/** Test seam — drops every stored report. */
export function resetMemberLive(): void {
  reports.clear()
}
