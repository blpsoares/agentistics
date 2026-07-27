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
import { canonicalProjectPath } from '@agentistics/core'

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

/** Does a session match one source? The building block for both the union and the filters. */
function matchesSource(s: SessionMeta, src: TagSource, lookups: TagLookups): boolean {
  switch (src.type) {
    case 'repo': return !!s.git_remote && s.git_remote === src.value
    // Compared canonically so a worktree counts as the project it belongs to, and so a tag written
    // against a worktree path still resolves after the picker stopped offering them.
    case 'project': return canonicalProjectPath(s.project_path) === canonicalProjectPath(src.value)
    case 'machine': return !!s.memberId && s.memberId === src.value
    case 'team': return teamsOf(s).includes(src.value)
    case 'account': {
      const machines = lookups.machinesByAccount[src.value]
      return !!machines && !!s.memberId && machines.includes(s.memberId)
    }
    default: return false
  }
}

/**
 * Filters narrow the union without widening it: grouped by type, OR within a type and AND across
 * types. "repo X, restricted to accounts {A,B} and projects {C,D}" is the union of X intersected
 * with (A or B) and with (C or D) — which is what "only these people, only in these folders" means.
 *
 * Grouping by type is what makes that read naturally. Flat AND over every filter would be
 * unsatisfiable the moment two values of the same type are listed, since one session cannot sit in
 * two projects at once. A type nobody filtered on places no constraint at all.
 */
export function sessionPassesFilters(s: SessionMeta, filters: TagSource[], lookups: TagLookups): boolean {
  if (filters.length === 0) return true
  const byType = new Map<TagSourceType, TagSource[]>()
  for (const f of filters) {
    const list = byType.get(f.type)
    if (list) list.push(f)
    else byType.set(f.type, [f])
  }
  for (const group of byType.values()) {
    if (!group.some(f => matchesSource(s, f, lookups))) return false
  }
  return true
}

export function sessionMatchesTag(
  s: SessionMeta,
  sources: TagSource[],
  lookups: TagLookups,
  filters: TagSource[] = [],
): boolean {
  return sources.some(src => matchesSource(s, src, lookups)) && sessionPassesFilters(s, filters, lookups)
}

export function resolveTagSessions(
  sessions: SessionMeta[],
  sources: TagSource[],
  lookups: TagLookups,
  filters: TagSource[] = [],
): SessionMeta[] {
  if (sources.length === 0) return []
  return sessions.filter(s => sessionMatchesTag(s, sources, lookups, filters))
}
