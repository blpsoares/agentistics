// packages/server/server/iam-view.test.ts
import { test, expect } from 'bun:test'
import { publicAccount, accountVisibleTo, canCreateAccount, canDeleteAccount, teamVisibleTo, canManageMachineTeam } from './iam-view'
import type { AccountDoc, Principal } from './iam-types'

const owner: Principal = { accountId: 'o1', role: 'owner', memberships: [] }
const mgrA: Principal = { accountId: 'm1', role: 'member', memberships: [{ teamId: 'A', role: 'manager' }] }

function acc(id: string, over: Partial<AccountDoc> = {}): AccountDoc {
  return { _id: id, name: 'N', email: `${id}@x.co`, emailLower: `${id}@x.co`, passwordHash: '$argon2id$secret', role: 'member', memberships: [], sessionVersion: 0, createdAt: 't', updatedAt: 't', lastLoginAt: null, ...over }
}

test('publicAccount strips passwordHash and maps _id → id', () => {
  const p = publicAccount(acc('u1', { memberships: [{ teamId: 'A', role: 'user' }] }))
  expect(p).toEqual({ id: 'u1', name: 'N', email: 'u1@x.co', role: 'member', memberships: [{ teamId: 'A', role: 'user' }], createdAt: 't', lastLoginAt: null, mustChangePassword: false })
  expect((p as unknown as Record<string, unknown>).passwordHash).toBeUndefined()
})

test('accountVisibleTo: owner sees all; manager sees users in their team + self', () => {
  const uA = acc('u1', { memberships: [{ teamId: 'A', role: 'user' }] })
  const userB = acc('u2', { memberships: [{ teamId: 'B', role: 'user' }] })
  expect(accountVisibleTo(owner, userB)).toBe(true)
  expect(accountVisibleTo(mgrA, uA)).toBe(true)
  expect(accountVisibleTo(mgrA, userB)).toBe(false)
  expect(accountVisibleTo(mgrA, acc('m1'))).toBe(true) // self
})

test('canCreateAccount (member membership scope): owner any; manager only user-role in managed teams', () => {
  expect(canCreateAccount(owner, [{ teamId: 'Z', role: 'manager' }])).toBe(true)
  expect(canCreateAccount(mgrA, [{ teamId: 'A', role: 'user' }])).toBe(true)
  expect(canCreateAccount(mgrA, [{ teamId: 'A', role: 'manager' }])).toBe(false)
  expect(canCreateAccount(mgrA, [{ teamId: 'B', role: 'user' }])).toBe(false)
  expect(canCreateAccount(mgrA, [])).toBe(false)
})

test('canDeleteAccount: owner deletes anyone (last-owner guarded in handler); manager only managed user-members', () => {
  expect(canDeleteAccount(owner, acc('o2', { role: 'owner' }))).toBe(true)  // owner deletes owner
  expect(canDeleteAccount(owner, acc('u1', { memberships: [{ teamId: 'B', role: 'user' }] }))).toBe(true)
  expect(canDeleteAccount(mgrA, acc('u1', { memberships: [{ teamId: 'A', role: 'user' }] }))).toBe(true)
  expect(canDeleteAccount(mgrA, acc('u2', { memberships: [{ teamId: 'B', role: 'user' }] }))).toBe(false)
  expect(canDeleteAccount(mgrA, acc('x', { memberships: [{ teamId: 'A', role: 'manager' }] }))).toBe(false)
  expect(canDeleteAccount(mgrA, acc('o2', { role: 'owner' }))).toBe(false)  // manager never an owner
})

test('teamVisibleTo: owner all; member only their teams', () => {
  expect(teamVisibleTo(owner, 'Z')).toBe(true)
  expect(teamVisibleTo(mgrA, 'A')).toBe(true)
  expect(teamVisibleTo(mgrA, 'B')).toBe(false)
})

test('canManageMachineTeam: owner any team; manager own team only; user never', () => {
  const userA: Principal = { accountId: 'uu', role: 'member', memberships: [{ teamId: 'A', role: 'user' }] }
  expect(canManageMachineTeam(owner, 'Z')).toBe(true)
  expect(canManageMachineTeam(mgrA, 'A')).toBe(true)
  expect(canManageMachineTeam(mgrA, 'B')).toBe(false)
  expect(canManageMachineTeam(userA, 'A')).toBe(false)
  expect(canManageMachineTeam(mgrA, undefined)).toBe(false)
})
