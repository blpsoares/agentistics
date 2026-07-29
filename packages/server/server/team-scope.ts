/**
 * team-scope.ts — pure per-team filtering of an already-built AppData response.
 * Owner passthrough is the CALLER's responsibility; this filters to `visible` team ids.
 * Sessions are kept by their read-time `teamId` tag; workflows follow their session;
 * projects + user-keyed maps (userStatsCaches, presence) are pruned to visible users.
 */
import type { SessionMeta, StatsCache } from '@agentistics/core'
import { mergeStatsCaches, emptyStatsCache } from '@agentistics/core'
import type { ServerProject } from './data'
import type { WorkflowRun } from '@agentistics/core'
import type { Principal } from './iam-types'

/**
 * The teams whose DATA a principal may read — the teams they MANAGE, not merely belong to.
 *
 * Belonging to a team is not a licence to read every teammate's work. A manager is accountable for
 * the team and gets the team's numbers; a plain user gets their own machines (the caller passes
 * those separately as `ownedMachineIds`, so they never lose their own data by having no team).
 *
 * This used to return every membership regardless of role, which made "member of team A" and
 * "manager of team A" the same read scope. That was invisible while machines carried no team —
 * everyone effectively saw only themselves — and would have turned into "every member reads the
 * whole team" the moment machines started resolving to teams.
 *
 * NOTE this is deliberately narrower than `teamVisibleTo` in iam-view.ts: a plain user still SEES
 * their team exists (it is listed, they are in it), they just do not read its aggregate data.
 */
export function dataTeamIdsOf(principal: Principal): Set<string> {
  return new Set(principal.memberships.filter(m => m.role === 'manager').map(m => m.teamId))
}

function pickKeys<T>(obj: Record<string, T> | undefined, keep: Set<string>): Record<string, T> | undefined {
  if (!obj) return obj
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(obj)) if (keep.has(k)) out[k] = v
  return out
}

export function scopeAppDataToTeams<T extends {
  sessions?: SessionMeta[]
  workflows?: WorkflowRun[]
  projects?: ServerProject[]
  statsCache?: StatsCache
  userStatsCaches?: Record<string, StatsCache>
  machineStatsCaches?: Record<string, StatsCache>
  machineOwners?: Record<string, { user: string; teamIds: string[] }>
  presence?: Record<string, unknown>
}>(data: T, visible: Set<string>, ownedMachineIds: Set<string> = new Set()): T {
  // A session is visible if ANY of its machine's teams is visible to the principal (a machine can
  // belong to several teams; falls back to the single teamId on legacy data), OR the principal owns
  // the machine that produced it — so a loose machine (no team) is still visible to its owner.
  const sessions = (data.sessions ?? []).filter(s => {
    const ids = (s.teamIds && s.teamIds.length) ? s.teamIds : (s.teamId != null ? [s.teamId] : [])
    if (ids.some(t => visible.has(t))) return true
    return !!s.memberId && ownedMachineIds.has(s.memberId)
  })
  const visibleSessionIds = new Set(sessions.map(s => s.session_id))
  const visibleUsers = new Set(sessions.map(s => s.user).filter((u): u is string => Boolean(u)))
  const workflows = (data.workflows ?? []).filter(w => visibleSessionIds.has(w.sessionId))
  const projects = (data.projects ?? []).filter(p => (p.users ?? []).some(u => visibleUsers.has(u)))
  const userStatsCaches = pickKeys(data.userStatsCaches, visibleUsers)
  // Machine-keyed maps are scoped by the SAME rule as the sessions above (visible team, or owned
  // machine) rather than by `visibleUsers` — the machine id is the exact unit of visibility here,
  // so a principal never receives the cache of a machine whose sessions they cannot see.
  const visibleMachineIds = new Set(
    Object.entries(data.machineOwners ?? {})
      .filter(([id, m]) => m.teamIds.some(t => visible.has(t)) || ownedMachineIds.has(id))
      .map(([id]) => id),
  )
  const machineOwners = pickKeys(data.machineOwners, visibleMachineIds)
  const machineStatsCaches = pickKeys(data.machineStatsCaches, visibleMachineIds)
  // Rebuild statsCache from ONLY the visible members' caches. The top-level statsCache on a central
  // is the central machine's own history — exposing it to a scoped principal would leak every
  // member's totals (Cost/Tokens KPIs fall back to statsCache when no member cache matches). Merging
  // the visible caches mirrors the frontend's per-member merge; empty when nothing is visible.
  const visibleCaches = Object.values(userStatsCaches ?? {})
  const statsCache = visibleCaches.length ? mergeStatsCaches(visibleCaches) : emptyStatsCache()
  return {
    ...data,
    sessions,
    workflows,
    projects,
    statsCache,
    userStatsCaches,
    machineStatsCaches,
    machineOwners,
    presence: pickKeys(data.presence, visibleUsers),
  } as T
}
