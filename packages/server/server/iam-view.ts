/**
 * iam-view.ts — pure helpers for the IAM API: safe account serialization (never leaks
 * passwordHash) + account/team visibility & management capability checks.
 */
import type { AccountDoc, Principal, Membership } from './iam-types'

export interface PublicAccount {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  memberships: Membership[]
  createdAt: string
  lastLoginAt?: string | null
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

/** Owner may create any account; a manager may create only user-role memberships in teams
 *  they manage (and at least one membership). */
export function canCreateAccount(p: Principal, memberships: Membership[]): boolean {
  if (p.role === 'owner') return true
  const managed = managedTeams(p)
  return memberships.length > 0 && memberships.every(m => m.role === 'user' && managed.has(m.teamId))
}

/** Never delete an owner via the API. Owner may delete any non-owner; a manager may delete an
 *  account whose every membership is a user-role in a team they manage. */
export function canDeleteAccount(p: Principal, target: AccountDoc): boolean {
  if (target.role === 'owner') return false
  if (p.role === 'owner') return true
  const managed = managedTeams(p)
  return target.memberships.length > 0 && target.memberships.every(m => m.role === 'user' && managed.has(m.teamId))
}

/** Owner sees every team; a member sees only teams they belong to. */
export function teamVisibleTo(p: Principal, teamId: string): boolean {
  if (p.role === 'owner') return true
  return p.memberships.some(m => m.teamId === teamId)
}

/** Owner may manage machines in any team; a manager may manage only in teams
 *  they manage; users cannot manage machines. Undefined teamId always returns false. */
export function canManageMachineTeam(p: Principal, teamId: string | undefined): boolean {
  if (p.role === 'owner') return true
  if (!teamId) return false
  return p.memberships.some(m => m.teamId === teamId && m.role === 'manager')
}
