import { test, expect } from 'bun:test'
import { makeTeamDoc, makeOrgTeamDoc, DEFAULT_TEAM_ID } from './teams'

test('makeTeamDoc is deterministic', () => {
  expect(makeTeamDoc('Platform', 'tid1', new Date('2026-07-22T00:00:00.000Z'), 'owner1')).toEqual({
    _id: 'tid1',
    name: 'Platform',
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
    createdBy: 'owner1',
  })
})

test('the org team is an ordinary team doc plus its provenance mark — and carries NO members', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const doc = makeOrgTeamDoc('acme', 'tid2', now, 'owner1')
  expect(doc).toEqual({ _id: 'tid2', name: 'acme', createdAt: now, createdBy: 'owner1', orgTeam: true })
  // A team doc has no member list at all (accounts join through their own `memberships`), so the
  // "created empty" rule is structural: there is nothing here anyone could be joined into.
  expect(Object.keys(doc).sort()).toEqual(['_id', 'createdAt', 'createdBy', 'name', 'orgTeam'])
})

test('DEFAULT_TEAM_ID is the stable seed id', () => {
  expect(DEFAULT_TEAM_ID).toBe('default')
})
