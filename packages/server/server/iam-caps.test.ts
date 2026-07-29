import { test, expect } from 'bun:test'
import { can, isManagerOf, isMemberOf } from './iam-caps'
import type { Principal } from './iam-types'

const owner: Principal = { accountId: 'o1', role: 'owner', memberships: [] }
const mgrA: Principal = { accountId: 'm1', role: 'member', memberships: [{ teamId: 'A', role: 'manager' }] }
const userA: Principal = { accountId: 'u1', role: 'member', memberships: [{ teamId: 'A', role: 'user' }] }

test('owner can do everything', () => {
  expect(can(owner, 'teams:write')).toBe(true)
  expect(can(owner, 'central:config')).toBe(true)
  expect(can(owner, 'tokens:write', { teamId: 'Z' })).toBe(true)
  expect(can(owner, 'accounts:manage', { teamId: 'Z', targetRole: 'owner' })).toBe(true)
})

test('owner-only actions are denied to managers and users', () => {
  expect(can(mgrA, 'teams:write')).toBe(false)
  expect(can(mgrA, 'central:config')).toBe(false)
  expect(can(userA, 'teams:write')).toBe(false)
})

test('team-scoped writes require managing that exact team', () => {
  expect(can(mgrA, 'tokens:write', { teamId: 'A' })).toBe(true)
  expect(can(mgrA, 'members:write', { teamId: 'A' })).toBe(true)
  expect(can(mgrA, 'tokens:write', { teamId: 'B' })).toBe(false) // cross-team
  expect(can(userA, 'tokens:write', { teamId: 'A' })).toBe(false) // users can't write
})

// Reading a team's metrics requires MANAGING it — belonging is not reading. Mirrors `dataTeamIdsOf`
// on /api/data and /api/tags; a plain user reads their own machines, not their teammates'.
test('team:view requires MANAGING that team, not merely belonging to it', () => {
  expect(can(userA, 'team:view', { teamId: 'A' })).toBe(false)
  expect(can(mgrA, 'team:view', { teamId: 'A' })).toBe(true)
  expect(can(mgrA, 'team:view', { teamId: 'B' })).toBe(false)
  expect(can(owner, 'team:view', { teamId: 'B' })).toBe(true) // owner short-circuits
})

test('accounts:manage — a manager may manage only user-role accounts in their team', () => {
  expect(can(mgrA, 'accounts:manage', { teamId: 'A', targetRole: 'user' })).toBe(true)
  expect(can(mgrA, 'accounts:manage', { teamId: 'A', targetRole: 'manager' })).toBe(false)
  expect(can(mgrA, 'accounts:manage', { teamId: 'B', targetRole: 'user' })).toBe(false)
  expect(can(userA, 'accounts:manage', { teamId: 'A', targetRole: 'user' })).toBe(false)
})

test('helpers', () => {
  expect(isManagerOf(mgrA, 'A')).toBe(true)
  expect(isManagerOf(userA, 'A')).toBe(false)
  expect(isMemberOf(userA, 'A')).toBe(true)
  expect(isMemberOf(userA, undefined)).toBe(false)
})

test('tags:write is open to every authenticated principal — the SOURCES are the real gate', () => {
  // owner: anything. manager: what their teams reach. user: what their own account owns.
  // All three differences live in canWriteTagSources (tags-authority.ts), which requires the
  // principal to already see EVERY source. Refusing a plain user here would have blocked the
  // legitimate "tag my own machines" case without adding any protection.
  const owner: Principal = { accountId: 'o1', role: 'owner', memberships: [] }
  const mgr: Principal = { accountId: 'm1', role: 'member', memberships: [{ teamId: 'A', role: 'manager' }] }
  const user: Principal = { accountId: 'u1', role: 'member', memberships: [{ teamId: 'A', role: 'user' }] }
  const loose: Principal = { accountId: 'u2', role: 'member', memberships: [] }
  expect(can(owner, 'tags:write')).toBe(true)
  expect(can(mgr, 'tags:write')).toBe(true)
  expect(can(user, 'tags:write')).toBe(true)
  expect(can(loose, 'tags:write')).toBe(true)
})
