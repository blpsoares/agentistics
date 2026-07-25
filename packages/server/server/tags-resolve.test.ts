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
