/**
 * tags-authority.ts — PURE enforcement of Rule 1: a principal may create or edit a tag only if it
 * can already see EVERY one of its sources.
 *
 * Without this a manager could compose a tag over another team's machines and grant it to
 * themselves — privilege escalation in two steps, since a grantee sees a tag's FULL numbers.
 *
 * The caller builds the visibility context from the DB; this module only decides.
 */
import type { Principal } from './iam-types'
import type { TagSource } from './tags-resolve'

export interface TagAuthorityContext {
  visibleTeamIds: Set<string>
  visibleMachineIds: Set<string>
  visibleAccountIds: Set<string>
  visibleRepos: Set<string>
  visibleProjects: Set<string>
  /** accountId → memberIds of every machine that account owns. An `account` source expands to all
   *  of them at resolution time, so seeing the account is NOT enough — see canSeeSource. */
  machinesByAccount: Record<string, string[]>
}

export function canSeeSource(p: Principal, src: TagSource, ctx: TagAuthorityContext): boolean {
  if (p.role === 'owner') return true
  switch (src.type) {
    case 'team': return ctx.visibleTeamIds.has(src.value)
    case 'machine': return ctx.visibleMachineIds.has(src.value)
    case 'account': {
      // Seeing the ACCOUNT is not enough. The source expands to every machine that account owns
      // (tags-resolve.ts), and account memberships and machine teams are independent — so a
      // manager could tag a teammate whose laptop lives in a team they cannot see, and read that
      // team's metrics. Require the whole expansion to be visible.
      if (!ctx.visibleAccountIds.has(src.value)) return false
      const machines = ctx.machinesByAccount[src.value] ?? []
      return machines.every(id => ctx.visibleMachineIds.has(id))
    }
    case 'repo': return ctx.visibleRepos.has(src.value)
    case 'project': return ctx.visibleProjects.has(src.value)
    default: return false
  }
}

export function canWriteTagSources(p: Principal, sources: TagSource[], ctx: TagAuthorityContext): boolean {
  return sources.every(src => canSeeSource(p, src, ctx))
}
