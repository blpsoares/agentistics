/**
 * team-scope.ts — pure per-team filtering of an already-built AppData response.
 * Owner passthrough is the CALLER's responsibility; this filters to `visible` team ids.
 * Sessions are kept by their read-time `teamId` tag; workflows follow their session;
 * projects + user-keyed maps (userStatsCaches, presence) are pruned to visible users.
 */
import type { AppData } from '@agentistics/core'
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

export function scopeAppDataToTeams(data: AppData, visible: Set<string>): AppData {
  const sessions = (data.sessions ?? []).filter(s => s.teamId != null && visible.has(s.teamId))
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
  }
}
