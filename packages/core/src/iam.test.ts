import { test, expect } from 'bun:test'
import { canCreateAccountWith, isOwnerOnlyAccount, managedTeamIds, type IamScope } from './iam'

const owner: IamScope = { role: 'owner', memberships: [] }
const manager: IamScope = { role: 'member', memberships: [{ teamId: 'T1', role: 'manager' }] }
const plainUser: IamScope = { role: 'member', memberships: [{ teamId: 'T1', role: 'user' }] }

test('an owner may create an account with NO team at all', () => {
  expect(canCreateAccountWith(owner, [])).toBe(true)
})

test('an owner may still create an account in any team', () => {
  expect(canCreateAccountWith(owner, [{ teamId: 'T9', role: 'manager' }])).toBe(true)
})

test('a manager may NOT create a teamless account — the team IS their scope boundary', () => {
  expect(canCreateAccountWith(manager, [])).toBe(false)
})

test('a manager may create a user-role account inside a team they manage', () => {
  expect(canCreateAccountWith(manager, [{ teamId: 'T1', role: 'user' }])).toBe(true)
})

test('a manager may not place an account in a team they do not manage', () => {
  expect(canCreateAccountWith(manager, [{ teamId: 'T2', role: 'user' }])).toBe(false)
  // ...not even alongside one they do manage.
  expect(canCreateAccountWith(manager, [
    { teamId: 'T1', role: 'user' },
    { teamId: 'T2', role: 'user' },
  ])).toBe(false)
})

test('a manager may not mint another manager through the create path', () => {
  expect(canCreateAccountWith(manager, [{ teamId: 'T1', role: 'manager' }])).toBe(false)
})

test('a plain user may create nothing, teamless or otherwise', () => {
  expect(canCreateAccountWith(plainUser, [])).toBe(false)
  expect(canCreateAccountWith(plainUser, [{ teamId: 'T1', role: 'user' }])).toBe(false)
})

test('managedTeamIds counts only manager memberships', () => {
  const mixed: IamScope = {
    role: 'member',
    memberships: [
      { teamId: 'A', role: 'manager' },
      { teamId: 'B', role: 'user' },
      { teamId: 'C', role: 'manager' },
    ],
  }
  expect([...managedTeamIds(mixed)].sort()).toEqual(['A', 'C'])
})

test('isOwnerOnlyAccount is true for exactly the empty membership list', () => {
  expect(isOwnerOnlyAccount([])).toBe(true)
  expect(isOwnerOnlyAccount([{ teamId: 'T1', role: 'user' }])).toBe(false)
})
