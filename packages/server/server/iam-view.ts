/**
 * iam-view.ts — pure helpers for the IAM API: safe account serialization (never leaks
 * passwordHash) + account/team visibility & management capability checks.
 */
import type { AccountDoc, Principal, Membership, Role } from './iam-types'

export interface PublicAccount {
  id: string
  name: string
  email: string
  role: Role
  memberships: Membership[]
  createdAt: string
  lastLoginAt?: string | null
  mustChangePassword: boolean
}

/** Client-safe view of an account — drops passwordHash/emailLower/sessionVersion. */
export function publicAccount(a: AccountDoc): PublicAccount {
  return {
    id: a._id,
    name: a.name,
    email: a.email,
    role: a.role,
    memberships: a.memberships,
    createdAt: a.createdAt,
    lastLoginAt: a.lastLoginAt ?? null,
    mustChangePassword: a.mustChangePassword ?? false,
  }
}

function managedTeams(p: Principal): Set<string> {
  return new Set(p.memberships.filter(m => m.role === 'manager').map(m => m.teamId))
}

/** Owner sees all; a principal always sees itself; a manager sees accounts holding a
 *  membership in a team they manage. */
export function accountVisibleTo(principal: Principal, account: AccountDoc): boolean {
  if (principal.role === 'owner') return true
  if (principal.accountId === account._id) return true
  const managed = managedTeams(principal)
  return account.memberships.some(m => managed.has(m.teamId))
}

/** Membership-scope check for creating/editing a MEMBER account: owner may assign any memberships;
 *  a manager may assign only user-role memberships in teams they manage (≥1). */
export function canCreateAccount(p: Principal, memberships: Membership[]): boolean {
  if (p.role === 'owner') return true
  const managed = managedTeams(p)
  return memberships.length > 0 && memberships.every(m => m.role === 'user' && managed.has(m.teamId))
}

/** Deletion: owner may delete anyone (the last-owner guard lives in the handler); a manager may
 *  delete a member whose every membership is a user-role in a team they manage. */
export function canDeleteAccount(p: Principal, target: AccountDoc): boolean {
  if (target.role === 'owner') return p.role === 'owner'
  // target is a member:
  if (p.role === 'owner') return true
  const managed = managedTeams(p)
  return target.memberships.length > 0 && target.memberships.every(m => m.role === 'user' && managed.has(m.teamId))
}

/** Which membership sets a principal may assign to another account.
 *
 *  Owner: anything. Manager: any role — `user` OR `manager` — but only inside teams they manage.
 *  Promoting a peer to manager of a team you already manage is delegation *within* your own scope,
 *  not escalation beyond it, so it is allowed. Assigning a membership in a team you do not manage
 *  never is. A plain user may assign nothing.
 *
 *  Note the one-way door this creates for a manager: once the target holds a manager membership,
 *  `canDeleteAccount` no longer matches them, so the promoter can no longer edit that account.
 */
export function canAssignMemberships(p: Principal, memberships: Membership[]): boolean {
  if (p.role === 'owner') return true
  const managed = new Set(p.memberships.filter(m => m.role === 'manager').map(m => m.teamId))
  if (managed.size === 0) return false
  return memberships.every(m => managed.has(m.teamId))
}

/** Owner sees every team; a member sees only teams they belong to. */
export function teamVisibleTo(p: Principal, teamId: string): boolean {
  if (p.role === 'owner') return true
  return p.memberships.some(m => m.teamId === teamId)
}

/** Owner may manage machines in any team; a manager may manage only in teams they manage;
 *  users cannot manage machines. Undefined teamId → false for non-owner. */
export function canManageMachineTeam(p: Principal, teamId: string | undefined): boolean {
  if (p.role === 'owner') return true
  if (!teamId) return false
  return p.memberships.some(m => m.teamId === teamId && m.role === 'manager')
}

/** Canonical owner-account ids of a machine (handles the legacy single-`accountId` shape). */
export function machineOwnerIds(machine: { accountId?: string; accountIds?: string[] }): string[] {
  return machine.accountIds && machine.accountIds.length
    ? machine.accountIds
    : (machine.accountId ? [machine.accountId] : [])
}

/**
 * The teams a machine effectively belongs to: the teams stamped on the machine token UNION the
 * teams of every account that owns it.
 *
 * WHY the union: team membership is stored on ACCOUNTS, but both session visibility
 * (`scopeAppDataToTeams`) and machine visibility (`canManageMachine`) key off the MACHINE's
 * `teamIds`. Nothing ever connected the two — adding an account to a team as manager left that
 * account's machines loose, so the team's own manager saw an empty machine list and an empty
 * dashboard, with no hint that a second, separate linking step existed. Deriving the union here
 * fixes that without mutating any token: explicit per-machine assignment still works and still
 * widens reach, and revoking a membership narrows visibility again immediately, with no stored
 * state left to drift.
 *
 * `accountTeams` maps accountId → that account's team ids. Pure.
 */
export function effectiveMachineTeams(
  machine: { teamId?: string; teamIds?: string[]; accountId?: string; accountIds?: string[] },
  accountTeams: Record<string, string[]> = {},
): string[] {
  const stored = machine.teamIds && machine.teamIds.length
    ? machine.teamIds
    : (machine.teamId ? [machine.teamId] : [])
  const out = new Set(stored)
  for (const id of machineOwnerIds(machine)) {
    for (const t of accountTeams[id] ?? []) out.add(t)
  }
  return [...out]
}

/** Whether a principal may view/manage a specific machine: owner, a manager of ANY of the machine's
 *  effective teams (see `effectiveMachineTeams` — includes the teams of its owner accounts), OR one
 *  of the machine's owner accounts (a user managing a machine they own). A machine may have several
 *  owner accounts AND belong to several teams. */
export function canManageMachine(
  p: Principal,
  machine: { teamId?: string; teamIds?: string[]; accountId?: string; accountIds?: string[] },
  accountTeams: Record<string, string[]> = {},
): boolean {
  // An owner manages every machine, including a LOOSE one (no teams, no owner accounts). Without
  // this the team check below (`[].some(...)` → false) locked owners out of exactly the machines
  // that need re-linking — the ones orphaned when their owning account was deleted.
  if (p.role === 'owner') return true
  if (machineOwnerIds(machine).includes(p.accountId)) return true
  return effectiveMachineTeams(machine, accountTeams).some(t => canManageMachineTeam(p, t))
}
