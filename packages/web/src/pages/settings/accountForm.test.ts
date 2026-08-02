import { test, expect } from 'bun:test'
import { validateAccountDraft, showsTeamlessHint, initialMembershipRows, type AccountDraft } from './accountForm'
import { canCreateAccountWith, type IamScope } from '@agentistics/core'

const owner: IamScope = { role: 'owner', memberships: [] }
const manager: IamScope = { role: 'member', memberships: [{ teamId: 'T1', role: 'manager' }] }

function draft(over: Partial<AccountDraft>): AccountDraft {
  return {
    scope: owner,
    accountType: 'member',
    name: 'Ada',
    email: 'ada@example.com',
    password: 'correct-horse',
    memberships: [],
    ...over,
  }
}

test('missing name, email or a short password is refused before anything else', () => {
  expect(validateAccountDraft(draft({ name: '  ' }))).toBe('incomplete-fields')
  expect(validateAccountDraft(draft({ email: '' }))).toBe('incomplete-fields')
  expect(validateAccountDraft(draft({ password: 'short' }))).toBe('incomplete-fields')
})

test('an OWNER may create a member account with no team at all', () => {
  expect(validateAccountDraft(draft({ scope: owner, memberships: [] }))).toBeNull()
})

test('a MANAGER must place the account in a team they manage', () => {
  expect(validateAccountDraft(draft({ scope: manager, memberships: [] }))).toBe('team-required')
  expect(validateAccountDraft(draft({ scope: manager, memberships: [{ teamId: 'T2', role: 'user' }] })))
    .toBe('team-required')
  expect(validateAccountDraft(draft({ scope: manager, memberships: [{ teamId: 'T1', role: 'user' }] })))
    .toBeNull()
})

test('an owner-type account carries no memberships and is still accepted', () => {
  expect(validateAccountDraft(draft({ accountType: 'owner', memberships: [] }))).toBeNull()
})

/**
 * The form must never refuse what the server would accept, nor accept what it would refuse: both
 * sides read `canCreateAccountWith`. This is the cross-check that fails if the form ever grows a
 * second, private rule.
 */
test('the form agrees with the shared server predicate on every scope x membership combination', () => {
  const scopes: IamScope[] = [
    owner,
    manager,
    { role: 'member', memberships: [{ teamId: 'T1', role: 'user' }] },
    { role: 'member', memberships: [] },
  ]
  const sets: IamMembershipList[] = [
    [],
    [{ teamId: 'T1', role: 'user' }],
    [{ teamId: 'T1', role: 'manager' }],
    [{ teamId: 'T2', role: 'user' }],
    [{ teamId: 'T1', role: 'user' }, { teamId: 'T2', role: 'user' }],
  ]
  let checked = 0
  for (const scope of scopes) {
    for (const memberships of sets) {
      const issue = validateAccountDraft(draft({ scope, memberships }))
      expect(issue === null).toBe(canCreateAccountWith(scope, memberships))
      checked++
    }
  }
  expect(checked).toBe(scopes.length * sets.length)
})

test('the teamless hint appears exactly when an owner is about to create a teamless member', () => {
  expect(showsTeamlessHint(draft({ scope: owner, memberships: [] }))).toBe(true)
})

test('the teamless hint stays away when the account HAS a team', () => {
  expect(showsTeamlessHint(draft({ scope: owner, memberships: [{ teamId: 'T1', role: 'user' }] }))).toBe(false)
})

test('the teamless hint stays away for an owner-TYPE account (it has every team by definition)', () => {
  expect(showsTeamlessHint(draft({ accountType: 'owner', memberships: [] }))).toBe(false)
})

test('a manager is never shown the hint — they are shown the error instead', () => {
  expect(showsTeamlessHint(draft({ scope: manager, memberships: [] }))).toBe(false)
  expect(validateAccountDraft(draft({ scope: manager, memberships: [] }))).toBe('team-required')
})

test('the org team is pre-selected when the form opens', () => {
  expect(initialMembershipRows(owner, [{ _id: 'A' }, { _id: 'ORG', orgTeam: true }]))
    .toEqual([{ teamId: 'ORG', role: 'user' }])
})

test('a manager gets the org team pre-selected too — when it is one they may assign', () => {
  expect(initialMembershipRows(manager, [{ _id: 'ORG', orgTeam: true }]))
    .toEqual([{ teamId: 'ORG', role: 'user' }])
  // Scoped out (not among the teams they manage) → no row naming it.
  expect(initialMembershipRows(manager, [{ _id: 'T1' }]))
    .toEqual([{ teamId: '', role: 'user' }])
})

test('with no org team an OWNER opens on no membership row at all', () => {
  expect(initialMembershipRows(owner, [{ _id: 'A' }, { _id: 'B' }])).toEqual([])
  expect(initialMembershipRows(owner, [])).toEqual([])
})

test('with no org team a MANAGER opens on the one blank row they must fill', () => {
  expect(initialMembershipRows(manager, [{ _id: 'T1' }])).toEqual([{ teamId: '', role: 'user' }])
})

test('pre-selected is not forced: the seeded org row can be cleared back to a valid teamless draft', () => {
  const seeded = initialMembershipRows(owner, [{ _id: 'ORG', orgTeam: true }])
  expect(validateAccountDraft(draft({ scope: owner, memberships: seeded }))).toBeNull()
  const cleared = seeded.slice(1)
  expect(cleared).toEqual([])
  expect(validateAccountDraft(draft({ scope: owner, memberships: cleared }))).toBeNull()
  expect(showsTeamlessHint(draft({ scope: owner, memberships: cleared }))).toBe(true)
})

type IamMembershipList = AccountDraft['memberships']
