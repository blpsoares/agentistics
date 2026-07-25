/**
 * tags-resolve.ts — PURE resolution of a tag's sources to the sessions they cover.
 *
 * A tag's sources are an OR union: a session belongs to the tag if it matches ANY source.
 * Resolution returns a SET of sessions, which is what makes the aggregate dedupe-correct —
 * a session matching two sources is present once, never summed twice.
 *
 * `team` and `account` resolve dynamically (at query time), so a machine added to a team later
 * is automatically covered without editing the tag.
 *
 * No Mongo, no auth, no I/O — unit-tested with plain objects.
 */
import type { SessionMeta } from '@agentistics/core'

export type TagSourceType = 'repo' | 'project' | 'machine' | 'team' | 'account'

export interface TagSource {
  type: TagSourceType
  /** repo → normalized git remote; project → project path; machine → memberId (token hash);
   *  team → teamId; account → accountId. */
  value: string
}

export interface TagLookups {
  /** accountId → memberIds of every machine that account owns. Built by the caller from the
   *  tokens collection; an account contributes no sessions of its own. */
  machinesByAccount: Record<string, string[]>
}

/** All teams a session belongs to (multi-team machines), falling back to the legacy single id. */
function teamsOf(s: SessionMeta): string[] {
  if (s.teamIds && s.teamIds.length) return s.teamIds
  return s.teamId ? [s.teamId] : []
}

export function sessionMatchesTag(s: SessionMeta, sources: TagSource[], lookups: TagLookups): boolean {
  return sources.some(src => {
    switch (src.type) {
      case 'repo': return !!s.git_remote && s.git_remote === src.value
      case 'project': return s.project_path === src.value
      case 'machine': return !!s.memberId && s.memberId === src.value
      case 'team': return teamsOf(s).includes(src.value)
      case 'account': {
        const machines = lookups.machinesByAccount[src.value]
        return !!machines && !!s.memberId && machines.includes(s.memberId)
      }
      default: return false
    }
  })
}

export function resolveTagSessions(sessions: SessionMeta[], sources: TagSource[], lookups: TagLookups): SessionMeta[] {
  if (sources.length === 0) return []
  return sessions.filter(s => sessionMatchesTag(s, sources, lookups))
}
