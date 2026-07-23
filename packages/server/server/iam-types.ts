/**
 * iam-types.ts — shared governance/IAM types (server-only) + pure helpers.
 * `role: 'owner'` is the instance-global owner (full access); everyone else is `'member'` whose
 * effective rights come from `memberships` (per-team manager/user). Owner may delete anyone
 * (last-owner protected); a team `manager` manages/creates `user` accounts within their teams.
 */

export type Role = 'owner' | 'member'
export type TeamRole = 'manager' | 'user'

export interface Membership {
  teamId: string
  role: TeamRole
}

/** The authenticated caller, resolved fresh from the DB on every request. */
export interface Principal {
  accountId: string
  role: Role
  memberships: Membership[]
}

/** Mongo doc in the `accounts` collection. */
export interface AccountDoc {
  _id: string
  name: string
  email: string
  emailLower: string
  passwordHash: string
  role: Role
  memberships: Membership[]
  sessionVersion: number
  createdAt: string
  updatedAt: string
  createdBy?: string
  lastLoginAt?: string | null
  mustChangePassword?: boolean
}

/** Mongo doc in the `teams` collection. */
export interface TeamDoc {
  _id: string
  name: string
  createdAt: string
  createdBy?: string
}

/** Canonical email form for storage + uniqueness + lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
