import { test, expect } from 'bun:test'
import { sessionMatchesTag, resolveTagSessions, type TagSource, type TagLookups } from './tags-resolve'
import type { SessionMeta } from '@agentistics/core'

function s(over: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: 'x', project_path: '/p', harness: 'claude',
    ...over,
  } as SessionMeta
}

const noLookups: TagLookups = { machinesByAccount: {} }

test('repo and project sources match their session fields', () => {
  const src: TagSource[] = [{ type: 'repo', value: 'github.com/org/a' }]
  expect(sessionMatchesTag(s({ git_remote: 'github.com/org/a' }), src, noLookups)).toBe(true)
  expect(sessionMatchesTag(s({ git_remote: 'github.com/org/b' }), src, noLookups)).toBe(false)
  expect(sessionMatchesTag(s({}), src, noLookups)).toBe(false)

  const proj: TagSource[] = [{ type: 'project', value: '/home/me/app' }]
  expect(sessionMatchesTag(s({ project_path: '/home/me/app' }), proj, noLookups)).toBe(true)
  expect(sessionMatchesTag(s({ project_path: '/home/me/other' }), proj, noLookups)).toBe(false)
})

test('machine matches memberId; team matches ANY of teamIds (falling back to teamId)', () => {
  const mach: TagSource[] = [{ type: 'machine', value: 'hash1' }]
  expect(sessionMatchesTag(s({ memberId: 'hash1' }), mach, noLookups)).toBe(true)
  expect(sessionMatchesTag(s({ memberId: 'hash2' }), mach, noLookups)).toBe(false)

  const team: TagSource[] = [{ type: 'team', value: 'T1' }]
  expect(sessionMatchesTag(s({ teamIds: ['T0', 'T1'] }), team, noLookups)).toBe(true)
  expect(sessionMatchesTag(s({ teamId: 'T1' }), team, noLookups)).toBe(true)
  expect(sessionMatchesTag(s({ teamIds: ['T9'] }), team, noLookups)).toBe(false)
})

test('account resolves to every machine that account owns', () => {
  const lookups: TagLookups = { machinesByAccount: { acc1: ['hashA', 'hashB'] } }
  const src: TagSource[] = [{ type: 'account', value: 'acc1' }]
  expect(sessionMatchesTag(s({ memberId: 'hashB' }), src, lookups)).toBe(true)
  expect(sessionMatchesTag(s({ memberId: 'hashZ' }), src, lookups)).toBe(false)
  // Unknown account → matches nothing rather than throwing.
  expect(sessionMatchesTag(s({ memberId: 'hashA' }), [{ type: 'account', value: 'ghost' }], lookups)).toBe(false)
})

test('sources are an OR union and a session matching two sources is returned ONCE', () => {
  const sessions = [
    s({ session_id: '1', git_remote: 'github.com/org/a', memberId: 'hash1' }), // matches both
    s({ session_id: '2', git_remote: 'github.com/org/a' }),
    s({ session_id: '3', memberId: 'hash9' }),
  ]
  const sources: TagSource[] = [
    { type: 'repo', value: 'github.com/org/a' },
    { type: 'machine', value: 'hash1' },
  ]
  const out = resolveTagSessions(sessions, sources, noLookups)
  expect(out.map(x => x.session_id)).toEqual(['1', '2'])
})

test('a tag with no sources resolves to no sessions', () => {
  expect(resolveTagSessions([s({ git_remote: 'r' })], [], noLookups)).toEqual([])
})

// --- filters: narrow the union, never widen it --------------------------------------------------

const NO_LOOKUPS = { machinesByAccount: {} }

function sess(over: Partial<SessionMeta>): SessionMeta {
  return { session_id: 'x', project_path: '', harness: 'claude', ...over } as SessionMeta
}

test('filters of one type are an OR', () => {
  const sessions = [
    sess({ session_id: 'a', git_remote: 'host/o/r', project_path: '/c' }),
    sess({ session_id: 'b', git_remote: 'host/o/r', project_path: '/d' }),
    sess({ session_id: 'e', git_remote: 'host/o/r', project_path: '/other' }),
  ]
  const out = resolveTagSessions(sessions, [{ type: 'repo', value: 'host/o/r' }], NO_LOOKUPS,
    [{ type: 'project', value: '/c' }, { type: 'project', value: '/d' }])
  expect(out.map(s => s.session_id)).toEqual(['a', 'b'])
})

test('filters of different types are an AND', () => {
  // "only machine m1, and only in /c" — a session must satisfy both to survive.
  const sessions = [
    sess({ session_id: 'both', git_remote: 'host/o/r', project_path: '/c', memberId: 'm1' }),
    sess({ session_id: 'wrong-path', git_remote: 'host/o/r', project_path: '/z', memberId: 'm1' }),
    sess({ session_id: 'wrong-machine', git_remote: 'host/o/r', project_path: '/c', memberId: 'm2' }),
  ]
  const out = resolveTagSessions(sessions, [{ type: 'repo', value: 'host/o/r' }], NO_LOOKUPS,
    [{ type: 'machine', value: 'm1' }, { type: 'project', value: '/c' }])
  expect(out.map(s => s.session_id)).toEqual(['both'])
})

test('a filter can only remove sessions, never add one outside the union', () => {
  const sessions = [
    sess({ session_id: 'in', git_remote: 'host/o/r', project_path: '/c' }),
    sess({ session_id: 'out', git_remote: 'host/o/other', project_path: '/c' }),
  ]
  // /c also names a session of a repo that is NOT a source; it must stay out.
  const out = resolveTagSessions(sessions, [{ type: 'repo', value: 'host/o/r' }], NO_LOOKUPS,
    [{ type: 'project', value: '/c' }])
  expect(out.map(s => s.session_id)).toEqual(['in'])
})

test('no filters means no constraint', () => {
  const sessions = [sess({ session_id: 'a', git_remote: 'host/o/r' })]
  expect(resolveTagSessions(sessions, [{ type: 'repo', value: 'host/o/r' }], NO_LOOKUPS, []).length).toBe(1)
  expect(resolveTagSessions(sessions, [{ type: 'repo', value: 'host/o/r' }], NO_LOOKUPS).length).toBe(1)
})

test('an untouched type places no constraint even when other types are filtered', () => {
  const sessions = [sess({ session_id: 'a', git_remote: 'host/o/r', project_path: '/c', memberId: 'm9' })]
  // Filtering only on project must not require a machine filter to match too.
  const out = resolveTagSessions(sessions, [{ type: 'repo', value: 'host/o/r' }], NO_LOOKUPS,
    [{ type: 'project', value: '/c' }])
  expect(out.length).toBe(1)
})
