import { test, expect } from 'bun:test'
import type { SessionMeta, HarnessId } from './types'
import { tagUser, distinctUsers, distinctHarnesses, filterByUsers, filterByHarnesses, clampPushInterval, PUSH_INTERVAL } from './team'

function session(id: string, user?: string): SessionMeta {
  return {
    session_id: id, project_path: '/p', start_time: '2026-06-01T00:00:00Z',
    duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    first_prompt: '', user_interruptions: 0, user_response_times: [],
    tool_errors: 0, tool_error_categories: {}, uses_task_agent: false,
    uses_mcp: false, uses_web_search: false, uses_web_fetch: false,
    lines_added: 0, lines_removed: 0, files_modified: 0, message_hours: [],
    user_message_timestamps: [], harness: 'claude', user,
  }
}

test('tagUser sets the user without mutating the input', () => {
  const s = session('a')
  const tagged = tagUser(s, 'devA')
  expect(tagged.user).toBe('devA')
  expect(s.user).toBeUndefined() // original untouched
})

test('distinctUsers returns sorted unique users and skips undefined', () => {
  const sessions = [session('1', 'devB'), session('2', 'devA'), session('3', 'devB'), session('4')]
  expect(distinctUsers(sessions)).toEqual(['devA', 'devB'])
})

test('filterByUsers with empty selection passes everything through', () => {
  const sessions = [session('1', 'devA'), session('2', 'devB')]
  expect(filterByUsers(sessions, [])).toHaveLength(2)
})

test('filterByUsers keeps only selected users and drops untagged sessions', () => {
  const sessions = [session('1', 'devA'), session('2', 'devB'), session('3')]
  const result = filterByUsers(sessions, ['devA'])
  expect(result.map(s => s.session_id)).toEqual(['1'])
})

test('filterByUsers supports multi-select (aggregate of a subset)', () => {
  const sessions = [session('1', 'devA'), session('2', 'devB'), session('3', 'devC')]
  const result = filterByUsers(sessions, ['devA', 'devB'])
  expect(result.map(s => s.session_id).sort()).toEqual(['1', '2'])
})

// distinctHarnesses

test('distinctHarnesses returns harnesses in canonical order, deduped', () => {
  const sessions = [
    harnessSession('1', 'copilot'),
    harnessSession('2', 'claude'),
    harnessSession('3', 'copilot'),
    harnessSession('4', 'gemini'),
  ]
  expect(distinctHarnesses(sessions)).toEqual(['claude', 'gemini', 'copilot'])
})

test('distinctHarnesses treats a missing harness field as claude', () => {
  const s = { ...session('1'), harness: undefined as unknown as 'claude' }
  expect(distinctHarnesses([s])).toEqual(['claude'])
})

test('distinctHarnesses on an empty list returns an empty array', () => {
  expect(distinctHarnesses([])).toEqual([])
})

// filterByHarnesses

function harnessSession(id: string, harness?: HarnessId): SessionMeta {
  return {
    ...session(id),
    harness: harness ?? 'claude',
  }
}

test('filterByHarnesses with empty selection passes everything through', () => {
  const sessions = [harnessSession('1', 'claude'), harnessSession('2', 'codex')]
  expect(filterByHarnesses(sessions, [])).toHaveLength(2)
})

test('filterByHarnesses with undefined treats missing harness as claude', () => {
  // A session created without explicit harness field (pre-team-mode legacy)
  const s: SessionMeta = { ...session('1'), harness: undefined as unknown as 'claude' }
  // Selecting 'claude' should include sessions with no harness field
  const result = filterByHarnesses([s], ['claude'])
  expect(result).toHaveLength(1)
})

test('filterByHarnesses keeps only selected harnesses', () => {
  const sessions = [
    harnessSession('1', 'claude'),
    harnessSession('2', 'codex'),
    harnessSession('3', 'gemini'),
  ]
  const result = filterByHarnesses(sessions, ['codex'])
  expect(result.map(s => s.session_id)).toEqual(['2'])
})

test('filterByHarnesses supports multi-select across a subset', () => {
  const sessions = [
    harnessSession('1', 'claude'),
    harnessSession('2', 'codex'),
    harnessSession('3', 'gemini'),
    harnessSession('4', 'copilot'),
  ]
  const result = filterByHarnesses(sessions, ['claude', 'copilot'])
  expect(result.map(s => s.session_id).sort()).toEqual(['1', '4'])
})

// clampPushInterval

test('clampPushInterval returns DEFAULT for NaN', () => {
  expect(clampPushInterval(NaN)).toBe(PUSH_INTERVAL.DEFAULT_SEC)
})

test('clampPushInterval returns DEFAULT for 0', () => {
  expect(clampPushInterval(0)).toBe(PUSH_INTERVAL.DEFAULT_SEC)
})

test('clampPushInterval returns DEFAULT for negative values', () => {
  expect(clampPushInterval(-10)).toBe(PUSH_INTERVAL.DEFAULT_SEC)
})

test('clampPushInterval returns DEFAULT for Infinity', () => {
  expect(clampPushInterval(Infinity)).toBe(PUSH_INTERVAL.DEFAULT_SEC)
})

test('clampPushInterval clamps below MIN to MIN', () => {
  expect(clampPushInterval(1)).toBe(PUSH_INTERVAL.MIN_SEC)
  expect(clampPushInterval(14)).toBe(PUSH_INTERVAL.MIN_SEC)
})

test('clampPushInterval clamps above MAX to MAX', () => {
  expect(clampPushInterval(9999)).toBe(PUSH_INTERVAL.MAX_SEC)
  expect(clampPushInterval(3601)).toBe(PUSH_INTERVAL.MAX_SEC)
})

test('clampPushInterval passes through in-range value', () => {
  expect(clampPushInterval(30)).toBe(30)
  expect(clampPushInterval(300)).toBe(300)
  expect(clampPushInterval(PUSH_INTERVAL.MIN_SEC)).toBe(PUSH_INTERVAL.MIN_SEC)
  expect(clampPushInterval(PUSH_INTERVAL.MAX_SEC)).toBe(PUSH_INTERVAL.MAX_SEC)
})

test('clampPushInterval with the express floor allows sub-15s values', () => {
  // Central express mode: the floor drops to EXPRESS_MIN_SEC.
  expect(clampPushInterval(5, PUSH_INTERVAL.EXPRESS_MIN_SEC)).toBe(5)
  expect(clampPushInterval(10, PUSH_INTERVAL.EXPRESS_MIN_SEC)).toBe(10)
  // Still floored at the express minimum, never below it.
  expect(clampPushInterval(2, PUSH_INTERVAL.EXPRESS_MIN_SEC)).toBe(PUSH_INTERVAL.EXPRESS_MIN_SEC)
  // MAX still enforced regardless of the floor.
  expect(clampPushInterval(9999, PUSH_INTERVAL.EXPRESS_MIN_SEC)).toBe(PUSH_INTERVAL.MAX_SEC)
})

test('clampPushInterval rounds fractional seconds', () => {
  expect(clampPushInterval(29.4)).toBe(29)
  expect(clampPushInterval(29.6)).toBe(30)
})

import { filterByTeams, filterByMachines } from './team'

test('filterByTeams: empty = all; matches teamId; drops missing', () => {
  const s = [{ teamId: 'A' }, { teamId: 'B' }, {}]
  expect(filterByTeams(s, [])).toHaveLength(3)
  expect(filterByTeams(s, ['A'])).toEqual([{ teamId: 'A' }])
  expect(filterByTeams(s, ['A', 'B']).length).toBe(2)
})

test('filterByMachines: empty = all; matches memberId; drops missing', () => {
  const s = [{ memberId: 'm1' }, { memberId: 'm2' }, {}]
  expect(filterByMachines(s, [])).toHaveLength(3)
  expect(filterByMachines(s, ['m2'])).toEqual([{ memberId: 'm2' }])
})

import { resolveMachineCacheScope } from './team'
import { emptyStatsCache } from './types'

const cache = () => emptyStatsCache()
const OWNERS = {
  alienware: { user: 'Bryan Soares', teamIds: ['dev'] },
  dellBryan: { user: 'Bryan Soares', teamIds: ['dev'] },
  thinkpadVini: { user: 'Vinicius Mostaço', teamIds: ['dev', 'ops'] },
}
const CACHES = { alienware: cache(), dellBryan: cache(), thinkpadVini: cache() }
const base = { machineOwners: OWNERS, machineStatsCaches: CACHES, users: [], teams: [], machines: [] }

test('resolveMachineCacheScope: no machine/team selection → null (member path answers it)', () => {
  expect(resolveMachineCacheScope(base)).toBeNull()
  expect(resolveMachineCacheScope({ ...base, users: ['Bryan Soares'] })).toBeNull()
})

test('resolveMachineCacheScope: selecting a member\'s machines resolves to exactly those caches', () => {
  const scope = resolveMachineCacheScope({ ...base, machines: ['alienware', 'dellBryan'] })
  expect(scope?.sort()).toEqual(['alienware', 'dellBryan'])
})

test('resolveMachineCacheScope: a team resolves to its machines; a member narrows it further', () => {
  expect(resolveMachineCacheScope({ ...base, teams: ['ops'] })).toEqual(['thinkpadVini'])
  expect(resolveMachineCacheScope({ ...base, teams: ['dev'], users: ['Bryan Soares'] })?.sort())
    .toEqual(['alienware', 'dellBryan'])
})

test('resolveMachineCacheScope: presence scope excludes machines of filtered-out members', () => {
  const scope = resolveMachineCacheScope({
    ...base, teams: ['dev'], allowedUsers: new Set(['Vinicius Mostaço']),
  })
  expect(scope).toEqual(['thinkpadVini'])
})

test('resolveMachineCacheScope: null (never a partial sum) when the caches cannot serve the scope', () => {
  // No machine maps at all — a solo instance, or a central that predates them.
  expect(resolveMachineCacheScope({ ...base, machineOwners: undefined, machines: ['alienware'] })).toBeNull()
  // A selected machine the tokens table does not know.
  expect(resolveMachineCacheScope({ ...base, machines: ['alienware', 'ghost'] })).toBeNull()
  // A machine in scope that has never pushed a statsCache would silently count as zero.
  const { dellBryan: _drop, ...partial } = CACHES
  expect(resolveMachineCacheScope({ ...base, machineStatsCaches: partial, machines: ['alienware', 'dellBryan'] })).toBeNull()
})

import {
  migrateTeamConfig, normalizeTeamConfig, connectionId, legacyConnectionId,
  readTeamConnections, NO_REPO_KEY, DEFAULT_TEAM, defaultTeam,
} from './team'

test('migrateTeamConfig: a legacy flat member config becomes one connection', () => {
  const out = migrateTeamConfig({
    mode: 'member', endpoint: 'https://central.example:48080/', org: 'acme',
    user: 'lucas', token: 'abc123', pushIntervalSec: 45,
  })
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.endpoint).toBe('https://central.example:48080')
  expect(out.connections[0]!.org).toBe('acme')
  expect(out.connections[0]!.user).toBe('lucas')
  expect(out.connections[0]!.token).toBe('abc123')
  expect(out.connections[0]!.pushIntervalSec).toBe(45)
  expect(out.connections[0]!.deniedRepos).toEqual([])
  expect(out.mode).toBe('member')
  expect(out.schema).toBe(2)
})

test('migrateTeamConfig: a solo config with empty strings fabricates NO connection', () => {
  const out = migrateTeamConfig({ mode: 'solo', endpoint: '', org: 'default', user: '', token: '' })
  expect(out.connections).toEqual([])
  expect(out.mode).toBe('solo')
})

test('migrateTeamConfig: an endpoint with no token still migrates (open/legacy central)', () => {
  const out = migrateTeamConfig({ mode: 'member', endpoint: 'http://c:48080', org: 'default', user: 'lucas' })
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.token).toBe('')
  expect(out.mode).toBe('member')
})

test('migrateTeamConfig: an already-migrated config is preserved, ids intact', () => {
  const first = migrateTeamConfig({ mode: 'member', endpoint: 'http://c:48080', token: 't' })
  const again = migrateTeamConfig(first)
  expect(again.connections[0]!.id).toBe(first.connections[0]!.id)
  expect(again.connections).toHaveLength(1)
})

test('migrateTeamConfig: junk input yields the default solo config', () => {
  for (const raw of [undefined, null, 'nope', 42, []]) {
    expect(migrateTeamConfig(raw).connections).toEqual([])
    expect(migrateTeamConfig(raw).mode).toBe('solo')
  }
})

test('migrateTeamConfig: two calls return distinct array instances (no shared aliasing)', () => {
  const raw = { mode: 'member', endpoint: 'http://c:48080', token: 't' }
  const a = migrateTeamConfig(raw)
  const b = migrateTeamConfig(raw)
  expect(a.connections).not.toBe(b.connections)
  a.connections[0]!.deniedRepos.push('github.com/o/r')
  expect(b.connections[0]!.deniedRepos).toEqual([])
})

test('migrateTeamConfig: the legacy id is deterministic across 100 calls', () => {
  const raw = { mode: 'member', endpoint: 'http://c:48080', token: 't' }
  const ids = new Set(Array.from({ length: 100 }, () => migrateTeamConfig(raw).connections[0]!.id))
  expect(ids.size).toBe(1)
  expect([...ids][0]).toMatch(/^c_[a-f0-9]{12}$/)
})

test('migrateTeamConfig: duplicate normalized endpoints collapse, first wins', () => {
  const out = migrateTeamConfig({
    mode: 'member',
    connections: [
      { id: 'c_aaaaaaaaaaaa', endpoint: 'http://c:48080', org: 'default', user: 'a', token: 't1', deniedRepos: [] },
      { id: 'c_bbbbbbbbbbbb', endpoint: 'http://c:48080/', org: 'default', user: 'b', token: 't2', deniedRepos: [] },
    ],
  })
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.id).toBe('c_aaaaaaaaaaaa')
})

test('migrateTeamConfig: an entry with no endpoint is dropped and deniedRepos defaults', () => {
  const out = migrateTeamConfig({
    mode: 'member',
    connections: [
      { id: 'c_aaaaaaaaaaaa', endpoint: '', org: 'default', user: 'a', token: 't' },
      { endpoint: 'http://c:48080', org: 'default', user: 'b', token: 't2' },
    ],
  })
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.deniedRepos).toEqual([])
  expect(out.connections[0]!.id).toMatch(/^c_[a-f0-9]{12}$/)
})

test('normalizeTeamConfig: mode follows connections.length in both directions', () => {
  const withOne = normalizeTeamConfig({
    mode: 'solo', connections: [{ id: 'c_aaaaaaaaaaaa', endpoint: 'http://c:48080', org: 'o', user: 'u', token: 't', deniedRepos: [] }],
  })
  expect(withOne.mode).toBe('member')
  expect(normalizeTeamConfig({ mode: 'member', connections: [] }).mode).toBe('solo')
})

test('normalizeTeamConfig: the legacy mirror tracks connections[0] and clears when empty', () => {
  const withOne = normalizeTeamConfig({
    mode: 'solo',
    connections: [{ id: 'c_aaaaaaaaaaaa', endpoint: 'http://c:48080', org: 'acme', user: 'lucas', token: 'tok', deniedRepos: [] }],
  })
  expect(withOne.endpoint).toBe('http://c:48080')
  expect(withOne.org).toBe('acme')
  expect(withOne.user).toBe('lucas')
  expect(withOne.token).toBe('tok')
  expect(withOne.schema).toBe(2)

  const emptied = normalizeTeamConfig({ mode: 'member', connections: [] })
  expect(emptied.endpoint).toBe('')
  expect(emptied.token).toBe('')
  expect(emptied.user).toBe('')
})

test('connectionId: format holds and 10000 calls collide zero times', () => {
  const ids = new Set(Array.from({ length: 10_000 }, () => connectionId()))
  expect(ids.size).toBe(10_000)
  for (const id of [...ids].slice(0, 50)) expect(id).toMatch(/^c_[a-f0-9]{12}$/)
})

test('legacyConnectionId: same inputs same id, different token different id', () => {
  expect(legacyConnectionId('http://c:48080', 't')).toBe(legacyConnectionId('http://c:48080', 't'))
  expect(legacyConnectionId('http://c:48080', 't')).not.toBe(legacyConnectionId('http://c:48080', 'u'))
  expect(legacyConnectionId('http://c:48080', '')).toMatch(/^c_[a-f0-9]{12}$/)
})

test('readTeamConnections: never throws on a prefs object missing the array', () => {
  expect(readTeamConnections(undefined)).toEqual([])
  expect(readTeamConnections(null)).toEqual([])
  expect(readTeamConnections({})).toEqual([])
  expect(readTeamConnections({ team: { mode: 'solo' } as never })).toEqual([])
})

test('NO_REPO_KEY is the exact sentinel and contains no slash', () => {
  expect(NO_REPO_KEY).toBe('__no_repo__')
  expect(NO_REPO_KEY.includes('/')).toBe(false)
})

test('DEFAULT_TEAM is solo with an empty connections array', () => {
  expect(DEFAULT_TEAM.mode).toBe('solo')
  expect(DEFAULT_TEAM.connections).toEqual([])
})

test('defaultTeam() hands out a FRESH array; DEFAULT_TEAM is frozen so it cannot be shared into', () => {
  const a = defaultTeam()
  const b = defaultTeam()
  expect(a.connections).not.toBe(b.connections)
  a.connections.push({ id: 'c_aaaaaaaaaaaa', endpoint: 'http://c:1', org: 'o', user: 'u', token: 't', deniedRepos: [] })
  expect(b.connections).toEqual([])
  expect(Object.isFrozen(DEFAULT_TEAM)).toBe(true)
  expect(Object.isFrozen(DEFAULT_TEAM.connections)).toBe(true)
})

// C1 (merge blocker): `agentop member connect` and the web "Connect to central" flow persist
// `{ ...defaultTeam(), mode:'member', endpoint, token }` — an EMPTY connections array alongside
// the legacy flat fields. Treating any array as authoritative read that back as solo: the
// uploader never pushed, no WebSocket ever opened, and the CLI still printed "connected as …".

test('migrateTeamConfig: an empty connections array WITH a flat endpoint still migrates (C1)', () => {
  const written = { ...defaultTeam(), mode: 'member' as const, endpoint: 'http://c:48080', token: 't', org: 'acme', user: 'lucas' }
  const out = migrateTeamConfig(written)
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.endpoint).toBe('http://c:48080')
  expect(out.connections[0]!.token).toBe('t')
  expect(out.connections[0]!.user).toBe('lucas')
  expect(out.mode).toBe('member')
})

test('migrateTeamConfig: an empty connections array with NO endpoint stays genuinely solo (C1)', () => {
  const out = migrateTeamConfig({ ...defaultTeam(), endpoint: '', token: '', user: '' })
  expect(out.connections).toEqual([])
  expect(out.mode).toBe('solo')
  expect(migrateTeamConfig(defaultTeam()).connections).toEqual([])
  expect(migrateTeamConfig(defaultTeam()).mode).toBe('solo')
})

test('migrateTeamConfig: a NON-empty connections array wins over a stale flat mirror (C1)', () => {
  const out = migrateTeamConfig({
    mode: 'member', endpoint: 'http://stale:48080', token: 'stale',
    connections: [{ id: 'c_aaaaaaaaaaaa', endpoint: 'http://real:48080', org: 'default', user: 'u', token: 'real', deniedRepos: [] }],
  })
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.endpoint).toBe('http://real:48080')
  expect(out.endpoint).toBe('http://real:48080')
})

test('legacyConnectionId needs no node:crypto — deterministic, well-formed and input-sensitive', () => {
  expect(legacyConnectionId('http://c:48080', 't')).toMatch(/^c_[a-f0-9]{12}$/)
  expect(legacyConnectionId('http://c:48080', 't')).toBe(legacyConnectionId('http://c:48080', 't'))
  expect(legacyConnectionId('http://c:48080', 't')).not.toBe(legacyConnectionId('http://d:48080', 't'))
  const ids = new Set(Array.from({ length: 2000 }, (_, i) => legacyConnectionId(`http://c${i}:48080`, `tok${i}`)))
  expect(ids.size).toBe(2000)
})
