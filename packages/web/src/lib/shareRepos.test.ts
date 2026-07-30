import { test, expect } from 'bun:test'
import {
  buildShareTargets, countDenied, hostOf, plural, buildDeniedRepoLabels,
  type ShareTarget, type ServerProject, type DeniedRepoSource,
} from './shareRepos'
import type { SessionMeta } from '@agentistics/core'
import { NO_REPO_KEY } from '@agentistics/core'

function s(over: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: 'x', project_path: '/p', harness: 'claude',
    start_time: '', duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    ...over,
  } as SessionMeta
}

function project(path: string, gitRemote?: string): ServerProject {
  return { path, ...(gitRemote ? { gitRemote } : {}) }
}

// --- grouping --------------------------------------------------------------------------------

test('exactly one kind:none entry regardless of how many remote-less folders exist', () => {
  const sessions = [
    s({ session_id: '1', project_path: '/a', start_time: '2026-01-01T00:00:00.000Z' }),
    s({ session_id: '2', project_path: '/b', start_time: '2026-01-02T00:00:00.000Z' }),
    s({ session_id: '3', project_path: '/c', start_time: '2026-01-03T00:00:00.000Z' }),
  ]
  const targets = buildShareTargets(sessions, [], [])
  const noneEntries = targets.filter(t => t.kind === 'none')
  expect(noneEntries.length).toBe(1)
  expect(noneEntries[0]!.key).toBe(NO_REPO_KEY)
  expect(noneEntries[0]!.sessions).toBe(3)
})

test('case and ssh./altssh. variants of one remote collapse into one row summing sessions', () => {
  const sessions = [
    s({ session_id: '1', git_remote: 'github.com/Acme/API', start_time: '2026-01-01T00:00:00.000Z' }),
    s({ session_id: '2', git_remote: 'GitHub.com/Acme/API', start_time: '2026-01-02T00:00:00.000Z' }),
    s({ session_id: '3', git_remote: 'ssh.github.com/Acme/API', start_time: '2026-01-03T00:00:00.000Z' }),
    s({ session_id: '4', git_remote: 'altssh.github.com/Acme/API', start_time: '2026-01-04T00:00:00.000Z' }),
  ]
  const targets = buildShareTargets(sessions, [], [])
  const repoTargets = targets.filter(t => t.kind === 'repo')
  expect(repoTargets.length).toBe(1)
  expect(repoTargets[0]!.sessions).toBe(4)
  expect(repoTargets[0]!.key).toBe('github.com/acme/api')
})

test('sorted sessions desc then name asc; the none bucket obeys the same rule', () => {
  const sessions = [
    // 1 session, no repo
    s({ session_id: '1', project_path: '/none', start_time: '2026-01-01T00:00:00.000Z' }),
    // 3 sessions, repo "zzz/last"
    s({ session_id: '2', git_remote: 'github.com/zzz/last', start_time: '2026-01-01T00:00:00.000Z' }),
    s({ session_id: '3', git_remote: 'github.com/zzz/last', start_time: '2026-01-02T00:00:00.000Z' }),
    s({ session_id: '4', git_remote: 'github.com/zzz/last', start_time: '2026-01-03T00:00:00.000Z' }),
    // 3 sessions, repo "aaa/first" — same count, earlier name
    s({ session_id: '5', git_remote: 'github.com/aaa/first', start_time: '2026-01-01T00:00:00.000Z' }),
    s({ session_id: '6', git_remote: 'github.com/aaa/first', start_time: '2026-01-02T00:00:00.000Z' }),
    s({ session_id: '7', git_remote: 'github.com/aaa/first', start_time: '2026-01-03T00:00:00.000Z' }),
  ]
  const targets = buildShareTargets(sessions, [], [])
  expect(targets.map(t => t.name)).toEqual(['aaa/first', 'zzz/last', 'No repository'])
})

test('a denied key with zero sessions is emitted with orphan: true', () => {
  const sessions = [s({ session_id: '1', git_remote: 'github.com/org/active', start_time: '2026-01-01T00:00:00.000Z' })]
  const targets = buildShareTargets(sessions, [], ['github.com/org/gone'])
  const gone = targets.find(t => t.key === 'github.com/org/gone')
  expect(gone).toBeDefined()
  expect(gone!.sessions).toBe(0)
  expect(gone!.orphan).toBe(true)
  const active = targets.find(t => t.key === 'github.com/org/active')
  expect(active!.orphan).toBe(false)
})

test('a kind:none entry with zero sessions and not denied is omitted', () => {
  const sessions = [s({ session_id: '1', git_remote: 'github.com/org/active', start_time: '2026-01-01T00:00:00.000Z' })]
  const targets = buildShareTargets(sessions, [], [])
  expect(targets.some(t => t.kind === 'none')).toBe(false)
})

test('a kind:none entry with zero sessions but denied is NOT omitted, and is orphan', () => {
  const sessions = [s({ session_id: '1', git_remote: 'github.com/org/active', start_time: '2026-01-01T00:00:00.000Z' })]
  const targets = buildShareTargets(sessions, [], [NO_REPO_KEY])
  const none = targets.find(t => t.kind === 'none')
  expect(none).toBeDefined()
  expect(none!.sessions).toBe(0)
  expect(none!.orphan).toBe(true)
})

test('a path seen with two remotes surfaces as conflictPaths on both rows', () => {
  const sessions = [
    s({ session_id: '1', project_path: '/workspace', git_remote: 'github.com/org/one', start_time: '2026-01-01T00:00:00.000Z' }),
    s({ session_id: '2', project_path: '/workspace', git_remote: 'github.com/org/two', start_time: '2026-01-02T00:00:00.000Z' }),
  ]
  const targets = buildShareTargets(sessions, [], [])
  const one = targets.find(t => t.key === 'github.com/org/one')!
  const two = targets.find(t => t.key === 'github.com/org/two')!
  expect(one.conflictPaths).toEqual(['/workspace'])
  expect(two.conflictPaths).toEqual(['/workspace'])
})

test('a remote-less session resolves through projects[].gitRemote; with neither source it lands in NO_REPO_KEY', () => {
  const sessions = [
    s({ session_id: '1', project_path: '/via-project', start_time: '2026-01-01T00:00:00.000Z' }),
    s({ session_id: '2', project_path: '/nowhere', start_time: '2026-01-02T00:00:00.000Z' }),
  ]
  const projects = [project('/via-project', 'github.com/org/viaproj')]
  const targets = buildShareTargets(sessions, projects, [])
  const viaProject = targets.find(t => t.key === 'github.com/org/viaproj')
  expect(viaProject).toBeDefined()
  expect(viaProject!.sessions).toBe(1)
  const none = targets.find(t => t.kind === 'none')
  expect(none!.sessions).toBe(1)
})

test('countDenied over a mixed list', () => {
  const targets: ShareTarget[] = [
    { key: 'github.com/org/a', kind: 'repo', name: 'org/a', host: 'github.com', sessions: 3, lastActive: '', orphan: false, conflictPaths: [] },
    { key: 'github.com/org/b', kind: 'repo', name: 'org/b', host: 'github.com', sessions: 1, lastActive: '', orphan: false, conflictPaths: [] },
    { key: NO_REPO_KEY, kind: 'none', name: 'No repository', host: '', sessions: 2, lastActive: '', orphan: false, conflictPaths: [] },
  ]
  expect(countDenied(targets, ['github.com/org/a', NO_REPO_KEY])).toBe(2)
  expect(countDenied(targets, [])).toBe(0)
  expect(countDenied(targets, ['github.com/org/does-not-exist'])).toBe(0)
})

// --- hostOf ------------------------------------------------------------------------------------

test('hostOf returns the host for a valid URL, the raw string for junk, — for empty, and never throws', () => {
  expect(hostOf('https://central.example.com:8443')).toBe('central.example.com:8443')
  expect(hostOf('not a url at all')).toBe('not a url at all')
  expect(hostOf('')).toBe('—')
  expect(() => hostOf('http://')).not.toThrow()
  expect(() => hostOf('::::')).not.toThrow()
})

// --- plural --------------------------------------------------------------------------------

test('plural picks one at 1 and other at 0 and 2', () => {
  const entry = { one: 'session', other: 'sessions' }
  expect(plural(entry, 1)).toBe('session')
  expect(plural(entry, 0)).toBe('sessions')
  expect(plural(entry, 2)).toBe('sessions')
})

// --- lastActive ----------------------------------------------------------------------------

test('lastActive is the max start_time, and empty when the target has no sessions', () => {
  const sessions = [
    s({ session_id: '1', git_remote: 'github.com/org/a', start_time: '2026-01-01T00:00:00.000Z' }),
    s({ session_id: '2', git_remote: 'github.com/org/a', start_time: '2026-03-01T00:00:00.000Z' }),
    s({ session_id: '3', git_remote: 'github.com/org/a', start_time: '2026-02-01T00:00:00.000Z' }),
  ]
  const targets = buildShareTargets(sessions, [], ['github.com/org/orphan'])
  const a = targets.find(t => t.key === 'github.com/org/a')!
  expect(a.lastActive).toBe('2026-03-01T00:00:00.000Z')
  const orphan = targets.find(t => t.key === 'github.com/org/orphan')!
  expect(orphan.lastActive).toBe('')
})

// --- labels ----------------------------------------------------------------------------------

test('labels.noRepo overrides the localized "No repository" name', () => {
  const sessions = [s({ session_id: '1', project_path: '/x', start_time: '2026-01-01T00:00:00.000Z' })]
  const targets = buildShareTargets(sessions, [], [], { noRepo: 'Sem repositório' })
  expect(targets.find(t => t.kind === 'none')!.name).toBe('Sem repositório')
})

// --- purity ------------------------------------------------------------------------------------

test('buildShareTargets does not mutate its inputs', () => {
  const sessions = [
    s({ session_id: '1', git_remote: 'github.com/org/a', project_path: '/a', start_time: '2026-01-01T00:00:00.000Z' }),
    s({ session_id: '2', project_path: '/b', start_time: '2026-01-02T00:00:00.000Z' }),
  ]
  const projects = [project('/a', 'github.com/org/a')]
  const denied = ['github.com/org/gone']
  const sessionsCopy = JSON.parse(JSON.stringify(sessions))
  const projectsCopy = JSON.parse(JSON.stringify(projects))
  const deniedCopy = JSON.parse(JSON.stringify(denied))

  buildShareTargets(sessions, projects, denied)

  expect(sessions).toEqual(sessionsCopy)
  expect(projects).toEqual(projectsCopy)
  expect(denied).toEqual(deniedCopy)
})

// --- the cross-check: mirrored canonicalRepoKey agrees with the server's -----------------------

import { canonicalRepoKey as serverCanonicalRepoKey, normalizeDenied as serverNormalizeDenied } from '../../../server/server/share-rules'
import { canonicalRepoKey as webCanonicalRepoKey } from './shareRepos'

test('the mirrored canonicalRepoKey agrees with the server over adversarial spellings', () => {
  const table = [
    'GitHub.com/Org/Repo',
    'ssh.github.com/o/r',
    'altssh.bitbucket.org/o/r',
    '',
    'nokeyhasnoslash',
    'github.com/o/r',
  ]
  for (const value of table) {
    expect(webCanonicalRepoKey(value)).toBe(serverCanonicalRepoKey(value))
  }
})

test('buildShareTargets groups sessions using the same key the server denylist would use', () => {
  // The server's normalizeDenied([raw]) resolves a raw remote to the canonical key it would
  // deny by. If buildShareTargets grouped by a different key, blocking the row the user
  // recognizes would leave sessions under the server's key still shared.
  const rawVariants = ['git@github.com:Acme/API.git', 'https://github.com/acme/api', 'ssh://git@ssh.github.com/Acme/API.git']
  const serverKeys = new Set([...serverNormalizeDenied(rawVariants)])
  expect(serverKeys.size).toBe(1)
  const serverKey = [...serverKeys][0]!

  const sessions = rawVariants.map((remote, i) =>
    s({ session_id: String(i), git_remote: remote, start_time: '2026-01-01T00:00:00.000Z' }))
  const targets = buildShareTargets(sessions, [], [])
  const repoTargets = targets.filter(t => t.kind === 'repo')
  expect(repoTargets.length).toBe(1)
  expect(repoTargets[0]!.key).toBe(serverKey)
})

// --- buildDeniedRepoLabels (Task 13's hidden-repo badge) --------------------------------------

function conn(over: Partial<DeniedRepoSource>): DeniedRepoSource {
  return { deniedRepos: [], endpoint: 'https://central.example.com', ...over }
}

test('a repo denied by one connection maps to that connection\'s label', () => {
  const map = buildDeniedRepoLabels([
    conn({ deniedRepos: ['github.com/acme/api'], label: 'Work HQ' }),
  ])
  expect(map.get('github.com/acme/api')).toEqual(['Work HQ'])
})

test('a repo denied by two connections lists both labels', () => {
  const map = buildDeniedRepoLabels([
    conn({ deniedRepos: ['github.com/acme/api'], label: 'Work HQ' }),
    conn({ deniedRepos: ['github.com/acme/api'], label: 'Side Project Central' }),
  ])
  expect(map.get('github.com/acme/api')).toEqual(['Work HQ', 'Side Project Central'])
})

test('a connection with no label falls back to the endpoint host', () => {
  const map = buildDeniedRepoLabels([
    conn({ deniedRepos: ['github.com/acme/api'], endpoint: 'https://hq.example.com' }),
  ])
  expect(map.get('github.com/acme/api')).toEqual(['hq.example.com'])
})

test('a different spelling of the same repo keys to the same canonical entry', () => {
  const map = buildDeniedRepoLabels([
    conn({ deniedRepos: ['git@ssh.github.com:Acme/API.git'], label: 'A' }),
  ])
  // Same canonical key buildShareTargets would produce for this remote family.
  expect(map.get('github.com/acme/api')).toEqual(['A'])
  expect(map.has('git@ssh.github.com:Acme/API.git')).toBe(false)
})

test('NO_REPO_KEY denials are preserved as their own bucket', () => {
  const map = buildDeniedRepoLabels([conn({ deniedRepos: [NO_REPO_KEY], label: 'Work HQ' })])
  expect(map.get(NO_REPO_KEY)).toEqual(['Work HQ'])
})

test('a connection sharing everything (empty deniedRepos) contributes nothing', () => {
  const map = buildDeniedRepoLabels([conn({ deniedRepos: [] })])
  expect(map.size).toBe(0)
})

test('no connections at all is an empty map, not a throw', () => {
  expect(buildDeniedRepoLabels([]).size).toBe(0)
})
