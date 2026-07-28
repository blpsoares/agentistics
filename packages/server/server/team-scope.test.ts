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

test('scopeAppDataToTeams: a multi-team session is visible if ANY of its teamIds is visible', () => {
  const data = {
    sessions: [
      { session_id: 'm1', user: 'alice', project_path: '/a', teamIds: ['A', 'B'] }, // A visible → kept
      { session_id: 'm2', user: 'bob', project_path: '/b', teamIds: ['B', 'C'] },   // neither visible → dropped
    ],
    projects: [{ path: '/a', users: ['alice'] }, { path: '/b', users: ['bob'] }],
  } as unknown as AppData
  const scoped = scopeAppDataToTeams(data, new Set(['A']))
  expect(scoped.sessions.map(s => s.session_id)).toEqual(['m1'])
})

test('scopeAppDataToTeams: a loose session on an OWNED machine stays visible (no team needed)', () => {
  const data = {
    sessions: [
      { session_id: 'own', user: 'me', project_path: '/a', teamIds: [], memberId: 'mine' },   // loose, my machine
      { session_id: 'other', user: 'x', project_path: '/b', teamIds: [], memberId: 'theirs' }, // loose, not mine
    ],
    projects: [{ path: '/a', users: ['me'] }, { path: '/b', users: ['x'] }],
    userStatsCaches: { me: { x: 1 }, x: { x: 2 } },
  } as unknown as AppData
  const scoped = scopeAppDataToTeams(data, new Set<string>(), new Set(['mine']))
  expect(scoped.sessions.map(s => s.session_id)).toEqual(['own'])
  expect(Object.keys(scoped.userStatsCaches ?? {})).toEqual(['me'])
})

test('scopeAppDataToTeams: statsCache is rebuilt from visible member caches, never the global one', () => {
  const global = { version: 1, totalSessions: 9999, totalMessages: 9999, modelUsage: {}, dailyActivity: [], dailyModelTokens: [], hourCounts: {} }
  const data = {
    sessions: [{ session_id: 's1', user: 'alice', project_path: '/a', teamId: 'A' }],
    projects: [{ path: '/a', users: ['alice'] }],
    statsCache: global,
    userStatsCaches: {
      alice: { version: 1, totalSessions: 5, totalMessages: 50, modelUsage: {}, dailyActivity: [], dailyModelTokens: [], hourCounts: {} },
      bob: { version: 1, totalSessions: 100, totalMessages: 100, modelUsage: {}, dailyActivity: [], dailyModelTokens: [], hourCounts: {} },
    },
  } as unknown as AppData
  const scoped = scopeAppDataToTeams(data, new Set(['A']))
  // The central's own global statsCache (9999) must NOT leak; only alice's cache is visible.
  expect(scoped.statsCache.totalSessions).toBe(5)
  expect(scoped.statsCache.totalMessages).toBe(50)
})

test('scopeAppDataToTeams: statsCache is empty when nothing is visible (no leak, no crash)', () => {
  const global = { version: 1, totalSessions: 9999, totalMessages: 9999, modelUsage: {}, dailyActivity: [], dailyModelTokens: [], hourCounts: {} }
  const data = {
    sessions: [{ session_id: 's1', user: 'alice', project_path: '/a', teamId: 'A' }],
    statsCache: global,
    userStatsCaches: { alice: { version: 1, totalSessions: 5, totalMessages: 50, modelUsage: {}, dailyActivity: [], dailyModelTokens: [], hourCounts: {} } },
  } as unknown as AppData
  const scoped = scopeAppDataToTeams(data, new Set(['ZZZ']))
  expect(scoped.sessions).toEqual([])
  expect(scoped.statsCache.totalSessions).toBe(0)
})

test('scopeAppDataToTeams prunes the machine-keyed caches by machine, not by user', () => {
  // A member can own machines in several teams. Scoping their caches by `visibleUsers` (as the
  // display-name-keyed userStatsCaches are) would hand over the cache of a machine whose sessions
  // the principal cannot see — the machine id is the exact unit of visibility here.
  const data = {
    sessions: [{ session_id: 's1', user: 'alice', project_path: '/a', memberId: 'mA', teamIds: ['A'] }],
    machineStatsCaches: { mA: { x: 1 }, mB: { x: 2 }, mOwned: { x: 3 } },
    machineOwners: {
      mA: { user: 'alice', teamIds: ['A'] },
      mB: { user: 'alice', teamIds: ['B'] },       // same owner, invisible team
      mOwned: { user: 'carol', teamIds: [] },      // loose machine, owned by the principal
    },
  } as unknown as AppData

  const scoped = scopeAppDataToTeams(data, new Set(['A']), new Set(['mOwned']))
  expect(Object.keys(scoped.machineStatsCaches ?? {}).sort()).toEqual(['mA', 'mOwned'])
  expect(Object.keys(scoped.machineOwners ?? {}).sort()).toEqual(['mA', 'mOwned'])
})
