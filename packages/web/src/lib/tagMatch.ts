/**
 * tagMatch.ts — browser-side mirror of the tag source rule.
 *
 * MUST STAY IN SYNC WITH `packages/server/server/tags-resolve.ts` (`sessionMatchesTag`).
 * The web bundle may never import from `packages/server/*` (Vite would try to bundle Bun/Node
 * APIs), which is exactly why this tiny pure predicate is duplicated here instead of shared.
 * Any change to the server rule must be reflected here and in `tagMatch.test.ts`.
 *
 * A session belongs to a tag when it matches ANY of the tag's sources (OR union):
 *   repo → git_remote, project → project_path, machine → memberId, team → any of
 *   teamIds/teamId, account → any machine that account owns.
 *
 * Caveat: `account` sources need an accountId → memberIds map, which the browser only has when
 * the caller supplies it. Without it an `account` source matches nothing client-side — the
 * authoritative numbers always come from the server's `/api/tags` aggregate.
 */
import type { SessionMeta } from '@agentistics/core'

export type TagSourceType = 'repo' | 'project' | 'machine' | 'team' | 'account'

export interface TagSource {
  type: TagSourceType
  value: string
}

/** Minimal shape of a tag needed to filter — matches what `GET /api/tags` returns. */
export interface TagDef {
  _id: string
  name: string
  color?: string
  sources: TagSource[]
}

export interface TagLookups {
  /** accountId → memberIds of every machine that account owns. Empty when unknown. */
  machinesByAccount: Record<string, string[]>
}

export const EMPTY_TAG_LOOKUPS: TagLookups = { machinesByAccount: {} }

/** All teams a session belongs to (multi-team machines), falling back to the legacy single id. */
function teamsOf(s: SessionMeta): string[] {
  if (s.teamIds && s.teamIds.length) return s.teamIds
  return s.teamId ? [s.teamId] : []
}

/** True when the session matches ANY of the given sources. Mirrors the server rule. */
export function sessionMatchesTagSources(
  s: SessionMeta,
  sources: TagSource[],
  lookups: TagLookups = EMPTY_TAG_LOOKUPS,
): boolean {
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

/**
 * Flatten the sources of the selected tags into one OR-union list.
 * Unknown ids (a tag the viewer can no longer see) contribute nothing.
 */
export function selectedTagSources(selected: string[], tags: TagDef[]): TagSource[] {
  if (selected.length === 0 || tags.length === 0) return []
  const wanted = new Set(selected)
  const out: TagSource[] = []
  for (const t of tags) {
    if (!wanted.has(t._id)) continue
    for (const src of t.sources) out.push(src)
  }
  return out
}

/**
 * Predicate for the `tags` filter dimension: keep a session when it matches ANY source of ANY
 * selected tag. Returns `null` when the filter is inert (nothing selected, or no selected tag
 * resolves to a known definition with sources) so callers can skip filtering entirely instead of
 * blanking the dashboard.
 */
export function makeTagFilter(
  selected: string[],
  tags: TagDef[],
  lookups: TagLookups = EMPTY_TAG_LOOKUPS,
): ((s: SessionMeta) => boolean) | null {
  const sources = selectedTagSources(selected, tags)
  if (sources.length === 0) return null
  return (s: SessionMeta) => sessionMatchesTagSources(s, sources, lookups)
}
