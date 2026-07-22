import { test, expect } from 'bun:test'
import { visibleTeamIdsOf, scopeAppDataToTeams } from './team-scope'
import type { Principal } from './iam-types'
import type { AppData } from '@agentistics/core'

const principal: Principal = { accountId: 'p', role: 'member', memberships: [{ teamId: 'A', role: 'user' }] }

test('visibleTeamIdsOf collects membership team ids', () => {
  const s = visibleTeamIdsOf({ accountId: 'x', role: 'member', memberships: [{ teamId: 'A', role: 'user' }, { teamId: 'B', role: 'manager' }] })
  expect([...s].sort()).toEqual(['A', 'B'])
})

test('scopeAppDataToTeams keeps only sessions in visible teams and prunes derived data', () => {
  const data = {
    sessions: [
      { session_id: 's1', user: 'alice', project_path: '/a', teamId: 'A' },
      { session_id: 's2', user: 'bob', project_path: '/b', teamId: 'B' },
    ],
    projects: [
      { path: '/a', users: ['alice'] },
      { path: '/b', users: ['bob'] },
    ],
    workflows: [
      { runId: 'w1', sessionId: 's1', user: 'alice' },
      { runId: 'w2', sessionId: 's2', user: 'bob' },
    ],
    userStatsCaches: { alice: { x: 1 }, bob: { x: 2 } },
    presence: { alice: { online: true }, bob: { online: false } },
  } as unknown as AppData

  const scoped = scopeAppDataToTeams(data, new Set(['A']))
  expect(scoped.sessions.map(s => s.session_id)).toEqual(['s1'])
  expect((scoped.workflows ?? []).map(w => w.runId)).toEqual(['w1'])
  expect((scoped.projects ?? []).map(p => (p as { path: string }).path)).toEqual(['/a'])
  expect(Object.keys(scoped.userStatsCaches ?? {})).toEqual(['alice'])
  expect(Object.keys(scoped.presence ?? {})).toEqual(['alice'])
})

test('scopeAppDataToTeams drops sessions with no teamId (untagged) for a scoped principal', () => {
  const data = { sessions: [{ session_id: 's3', user: 'c', project_path: '/c' }] } as unknown as AppData
  expect(scopeAppDataToTeams(data, new Set(['A'])).sessions).toEqual([])
})
