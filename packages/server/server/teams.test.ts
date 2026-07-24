import { test, expect } from 'bun:test'
import { makeTeamDoc, DEFAULT_TEAM_ID } from './teams'

test('makeTeamDoc is deterministic', () => {
  expect(makeTeamDoc('Platform', 'tid1', '2026-07-22T00:00:00.000Z', 'owner1')).toEqual({
    _id: 'tid1',
    name: 'Platform',
    createdAt: '2026-07-22T00:00:00.000Z',
    createdBy: 'owner1',
  })
})

test('DEFAULT_TEAM_ID is the stable seed id', () => {
  expect(DEFAULT_TEAM_ID).toBe('default')
})
