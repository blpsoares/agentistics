/**
 * iam-caps.ts — the pure authorization matrix. `can(principal, action, ctx)` is the
 * single source of truth for role × action decisions; API routes call it at the gate.
 * owner is all-powerful; manager/user are scoped to their team memberships.
 */
import type { Principal } from './iam-types'

export type IamAction =
  | 'teams:write'      // create/edit/delete teams — owner only
  | 'central:config'   // central settings (interval, offline policy) — owner only
  | 'tokens:write'     // mint/rotate/revoke machine tokens — owner or manager of ctx.teamId
  | 'members:write'    // add/remove members in a team — owner or manager of ctx.teamId
  | 'tags:write'       // create/edit tags (B5) — owner or any manager; sources gated separately
  | 'team:view'        // read a team's metrics — owner or any membership of ctx.teamId
  | 'accounts:manage'  // create/edit/delete accounts — owner (any), manager (user-role, own team)

export interface IamContext {
  teamId?: string
  targetRole?: 'owner' | 'manager' | 'user'
}

export function isManagerOf(p: Principal, teamId: string | undefined): boolean {
  if (!teamId) return false
  return p.memberships.some(m => m.teamId === teamId && m.role === 'manager')
}

export function isMemberOf(p: Principal, teamId: string | undefined): boolean {
  if (!teamId) return false
  return p.memberships.some(m => m.teamId === teamId)
}

export function can(p: Principal, action: IamAction, ctx: IamContext = {}): boolean {
  if (p.role === 'owner') return true
  switch (action) {
    case 'teams:write':
    case 'central:config':
      return false // owner-only
    case 'tokens:write':
    case 'members:write':
      return isManagerOf(p, ctx.teamId)
    case 'tags:write':
      // Tag authority is SOURCE-derived, never role-derived: this only answers "may create tags at
      // all", and the answer is yes for anyone signed in. What differs by role is the REACH, and
      // that is decided by canWriteTagSources() — an owner may use any source, a manager only what
      // their teams reach, and a plain user only what their own account owns. Refusing a user here
      // would have blocked the legitimate "tag my own machines" case while adding no protection,
      // since the source check already stops them touching anything else.
      return true
    case 'team:view':
      return isMemberOf(p, ctx.teamId)
    case 'accounts:manage':
      // A manager may manage only 'user'-role accounts within a team they manage.
      return ctx.targetRole === 'user' && isManagerOf(p, ctx.teamId)
    default:
      return false
  }
}
