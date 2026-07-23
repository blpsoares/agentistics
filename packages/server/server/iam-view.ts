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

/** Owner/admin see all; a principal always sees itself; a manager sees accounts holding a
 *  membership in a team they manage. */
export function accountVisibleTo(principal: Principal, account: AccountDoc): boolean {
  if (principal.role === 'owner' || principal.role === 'admin') return true
  if (principal.accountId === account._id) return true
  const managed = managedTeams(principal)
  return account.memberships.some(m => managed.has(m.teamId))
}

/** Membership-scope check for creating/editing a MEMBER account: owner/admin may assign any
 *  memberships; a manager may assign only user-role memberships in teams they manage (≥1). */
export function canCreateAccount(p: Principal, memberships: Membership[]): boolean {
  if (p.role === 'owner' || p.role === 'admin') return true
  const managed = managedTeams(p)
  return memberships.length > 0 && memberships.every(m => m.role === 'user' && managed.has(m.teamId))
}

/** Which account roles a principal may mint/assign. Only an owner may create owners or admins;
 *  a member account may be created by an owner, an admin, or a manager (a principal managing ≥1 team). */
export function canAssignRole(p: Principal, role: Role): boolean {
  if (role === 'owner' || role === 'admin') return p.role === 'owner'
  return p.role === 'owner' || p.role === 'admin' || managedTeams(p).size > 0
}

/** Deletion follows the hierarchy owner > admin > member. Owner may delete anyone (the
 *  last-owner guard lives in the handler); admin may delete members only; a manager may delete a
 *  member whose every membership is a user-role in a team they manage. Never admin/owner via admin. */
export function canDeleteAccount(p: Principal, target: AccountDoc): boolean {
  if (target.role === 'owner') return p.role === 'owner'
  if (target.role === 'admin') return p.role === 'owner'
  // target is a member:
  if (p.role === 'owner' || p.role === 'admin') return true
  const managed = managedTeams(p)
  return target.memberships.length > 0 && target.memberships.every(m => m.role === 'user' && managed.has(m.teamId))
}

/** Owner/admin see every team; a member sees only teams they belong to. */
export function teamVisibleTo(p: Principal, teamId: string): boolean {
  if (p.role === 'owner' || p.role === 'admin') return true
  return p.memberships.some(m => m.teamId === teamId)
}

/** Owner/admin may manage machines in any team; a manager may manage only in teams
 *  they manage; users cannot manage machines. Undefined teamId → false for non-owner/admin. */
export function canManageMachineTeam(p: Principal, teamId: string | undefined): boolean {
  if (p.role === 'owner' || p.role === 'admin') return true
  if (!teamId) return false
  return p.memberships.some(m => m.teamId === teamId && m.role === 'manager')
}
