/**
 * team-scope.ts — pure per-team filtering of an already-built AppData response.
 * Owner passthrough is the CALLER's responsibility; this filters to `visible` team ids.
 * Sessions are kept by their read-time `teamId` tag; workflows follow their session;
 * projects + user-keyed maps (userStatsCaches, presence) are pruned to visible users.
 */
import type { SessionMeta } from '@agentistics/core'
import type { ServerProject } from './data'
import type { WorkflowRun } from '@agentistics/core'
import type { Principal } from './iam-types'

export function visibleTeamIdsOf(principal: Principal): Set<string> {
  return new Set(principal.memberships.map(m => m.teamId))
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
  userStatsCaches?: Record<string, unknown>
  presence?: Record<string, unknown>
}>(data: T, visible: Set<string>): T {
  // A session is visible if ANY of its machine's teams is visible to the principal (a machine can
  // belong to several teams); falls back to the single teamId on legacy data.
  const sessions = (data.sessions ?? []).filter(s => {
    const ids = (s.teamIds && s.teamIds.length) ? s.teamIds : (s.teamId != null ? [s.teamId] : [])
    return ids.some(t => visible.has(t))
  })
  const visibleSessionIds = new Set(sessions.map(s => s.session_id))
  const visibleUsers = new Set(sessions.map(s => s.user).filter((u): u is string => Boolean(u)))
  const workflows = (data.workflows ?? []).filter(w => visibleSessionIds.has(w.sessionId))
  const projects = (data.projects ?? []).filter(p => (p.users ?? []).some(u => visibleUsers.has(u)))
  return {
    ...data,
    sessions,
    workflows,
    projects,
    userStatsCaches: pickKeys(data.userStatsCaches, visibleUsers),
    presence: pickKeys(data.presence, visibleUsers),
  } as T
}
