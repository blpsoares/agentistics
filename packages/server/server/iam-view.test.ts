// packages/server/server/iam-view.test.ts
import { test, expect } from 'bun:test'
import { publicAccount, accountVisibleTo, canCreateAccount, canAssignRole, canDeleteAccount, teamVisibleTo, canManageMachineTeam } from './iam-view'
import type { AccountDoc, Principal } from './iam-types'

const owner: Principal = { accountId: 'o1', role: 'owner', memberships: [] }
const admin: Principal = { accountId: 'a1', role: 'admin', memberships: [] }
const mgrA: Principal = { accountId: 'm1', role: 'member', memberships: [{ teamId: 'A', role: 'manager' }] }
const userA: Principal = { accountId: 'uu', role: 'member', memberships: [{ teamId: 'A', role: 'user' }] }

function acc(id: string, over: Partial<AccountDoc> = {}): AccountDoc {
  return { _id: id, name: 'N', email: `${id}@x.co`, emailLower: `${id}@x.co`, passwordHash: '$argon2id$secret', role: 'member', memberships: [], sessionVersion: 0, createdAt: 't', updatedAt: 't', lastLoginAt: null, ...over }
}

test('publicAccount strips passwordHash and maps _id → id', () => {
  const p = publicAccount(acc('u1', { memberships: [{ teamId: 'A', role: 'user' }] }))
  expect(p).toEqual({ id: 'u1', name: 'N', email: 'u1@x.co', role: 'member', memberships: [{ teamId: 'A', role: 'user' }], createdAt: 't', lastLoginAt: null, mustChangePassword: false })
  expect((p as unknown as Record<string, unknown>).passwordHash).toBeUndefined()
})

test('accountVisibleTo: owner + admin see all; manager sees users in their team + self', () => {
  const uA = acc('u1', { memberships: [{ teamId: 'A', role: 'user' }] })
  const userB = acc('u2', { memberships: [{ teamId: 'B', role: 'user' }] })
  expect(accountVisibleTo(owner, userB)).toBe(true)
  expect(accountVisibleTo(admin, userB)).toBe(true) // admin is global
  expect(accountVisibleTo(mgrA, uA)).toBe(true)
  expect(accountVisibleTo(mgrA, userB)).toBe(false)
  expect(accountVisibleTo(mgrA, acc('m1'))).toBe(true) // self
})

test('canCreateAccount (member membership scope): owner + admin any; manager only user-role in managed teams', () => {
  expect(canCreateAccount(owner, [{ teamId: 'Z', role: 'manager' }])).toBe(true)
  expect(canCreateAccount(admin, [{ teamId: 'Z', role: 'manager' }])).toBe(true)
  expect(canCreateAccount(mgrA, [{ teamId: 'A', role: 'user' }])).toBe(true)
  expect(canCreateAccount(mgrA, [{ teamId: 'A', role: 'manager' }])).toBe(false)
  expect(canCreateAccount(mgrA, [{ teamId: 'B', role: 'user' }])).toBe(false)
  expect(canCreateAccount(mgrA, [])).toBe(false)
})

test('canAssignRole: only owner mints owner/admin; member creatable by owner/admin/manager, not a plain user', () => {
  expect(canAssignRole(owner, 'owner')).toBe(true)
  expect(canAssignRole(owner, 'admin')).toBe(true)
  expect(canAssignRole(admin, 'admin')).toBe(false) // admin cannot mint admins
  expect(canAssignRole(admin, 'owner')).toBe(false)
  expect(canAssignRole(admin, 'member')).toBe(true)
  expect(canAssignRole(mgrA, 'member')).toBe(true)
  expect(canAssignRole(mgrA, 'admin')).toBe(false)
  expect(canAssignRole(userA, 'member')).toBe(false) // a plain user manages nothing
})

test('canDeleteAccount: hierarchy owner>admin>member; owner deletes owners; admin deletes members only', () => {
  // owner deletes anyone (last-owner guard is in the handler, not here)
  expect(canDeleteAccount(owner, acc('o2', { role: 'owner' }))).toBe(true)
  expect(canDeleteAccount(owner, acc('a2', { role: 'admin' }))).toBe(true)
  expect(canDeleteAccount(owner, acc('u1', { memberships: [{ teamId: 'B', role: 'user' }] }))).toBe(true)
  // admin deletes members but NOT owners/admins
  expect(canDeleteAccount(admin, acc('u1', { memberships: [{ teamId: 'B', role: 'user' }] }))).toBe(true)
  expect(canDeleteAccount(admin, acc('o2', { role: 'owner' }))).toBe(false)
  expect(canDeleteAccount(admin, acc('a2', { role: 'admin' }))).toBe(false)
  // manager deletes only user-members in managed teams
  expect(canDeleteAccount(mgrA, acc('u1', { memberships: [{ teamId: 'A', role: 'user' }] }))).toBe(true)
  expect(canDeleteAccount(mgrA, acc('u2', { memberships: [{ teamId: 'B', role: 'user' }] }))).toBe(false)
  expect(canDeleteAccount(mgrA, acc('x', { memberships: [{ teamId: 'A', role: 'manager' }] }))).toBe(false)
  expect(canDeleteAccount(mgrA, acc('a2', { role: 'admin' }))).toBe(false)
})

test('teamVisibleTo: owner + admin all; member only their teams', () => {
  expect(teamVisibleTo(owner, 'Z')).toBe(true)
  expect(teamVisibleTo(admin, 'Z')).toBe(true)
  expect(teamVisibleTo(mgrA, 'A')).toBe(true)
  expect(teamVisibleTo(mgrA, 'B')).toBe(false)
})

test('canManageMachineTeam: owner + admin any team; manager own team only; user never', () => {
  expect(canManageMachineTeam(owner, 'Z')).toBe(true)
  expect(canManageMachineTeam(admin, 'Z')).toBe(true)
  expect(canManageMachineTeam(admin, undefined)).toBe(true)
  expect(canManageMachineTeam(mgrA, 'A')).toBe(true)
  expect(canManageMachineTeam(mgrA, 'B')).toBe(false)
  expect(canManageMachineTeam(userA, 'A')).toBe(false)
  expect(canManageMachineTeam(mgrA, undefined)).toBe(false)
})
