import { test, expect } from 'bun:test'
import {
  sessionMatchesTagSources, selectedTagSources, makeTagFilter,
  type TagDef, type TagSource, type TagLookups,
} from './tagMatch'
import type { SessionMeta } from '@agentistics/core'

function s(over: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: 'x', project_path: '/p', harness: 'claude',
    ...over,
  } as SessionMeta
}

const noLookups: TagLookups = { machinesByAccount: {} }

function tag(id: string, sources: TagSource[]): TagDef {
  return { _id: id, name: id, sources }
}

test('repo and project sources match their session fields', () => {
  const repo: TagSource[] = [{ type: 'repo', value: 'github.com/org/a' }]
  expect(sessionMatchesTagSources(s({ git_remote: 'github.com/org/a' }), repo, noLookups)).toBe(true)
  expect(sessionMatchesTagSources(s({ git_remote: 'github.com/org/b' }), repo, noLookups)).toBe(false)
  expect(sessionMatchesTagSources(s({}), repo, noLookups)).toBe(false)

  const proj: TagSource[] = [{ type: 'project', value: '/home/me/app' }]
  expect(sessionMatchesTagSources(s({ project_path: '/home/me/app' }), proj, noLookups)).toBe(true)
  expect(sessionMatchesTagSources(s({ project_path: '/home/me/other' }), proj, noLookups)).toBe(false)
})

test('machine matches memberId; team matches ANY of teamIds (falling back to teamId)', () => {
  const mach: TagSource[] = [{ type: 'machine', value: 'hash1' }]
  expect(sessionMatchesTagSources(s({ memberId: 'hash1' }), mach, noLookups)).toBe(true)
  expect(sessionMatchesTagSources(s({ memberId: 'hash2' }), mach, noLookups)).toBe(false)

  const team: TagSource[] = [{ type: 'team', value: 'T1' }]
  expect(sessionMatchesTagSources(s({ teamIds: ['T0', 'T1'] }), team, noLookups)).toBe(true)
  expect(sessionMatchesTagSources(s({ teamId: 'T1' }), team, noLookups)).toBe(true)
  expect(sessionMatchesTagSources(s({ teamIds: ['T9'] }), team, noLookups)).toBe(false)
})

test('account resolves to every machine that account owns; unknown account matches nothing', () => {
  const lookups: TagLookups = { machinesByAccount: { acc1: ['hashA', 'hashB'] } }
  const src: TagSource[] = [{ type: 'account', value: 'acc1' }]
  expect(sessionMatchesTagSources(s({ memberId: 'hashB' }), src, lookups)).toBe(true)
  expect(sessionMatchesTagSources(s({ memberId: 'hashZ' }), src, lookups)).toBe(false)
  expect(sessionMatchesTagSources(s({ memberId: 'hashA' }), [{ type: 'account', value: 'ghost' }], lookups)).toBe(false)
  // No lookups supplied (the usual browser case) → an account source matches nothing.
  expect(sessionMatchesTagSources(s({ memberId: 'hashA' }), src)).toBe(false)
})

test('sources are an OR union', () => {
  const sources: TagSource[] = [
    { type: 'repo', value: 'github.com/org/a' },
    { type: 'machine', value: 'hash1' },
  ]
  expect(sessionMatchesTagSources(s({ git_remote: 'github.com/org/a' }), sources, noLookups)).toBe(true)
  expect(sessionMatchesTagSources(s({ memberId: 'hash1' }), sources, noLookups)).toBe(true)
  expect(sessionMatchesTagSources(s({ memberId: 'hash9' }), sources, noLookups)).toBe(false)
})

test('selectedTagSources flattens only the selected tags and ignores unknown ids', () => {
  const tags = [
    tag('t1', [{ type: 'repo', value: 'r1' }]),
    tag('t2', [{ type: 'team', value: 'T2' }, { type: 'project', value: '/p2' }]),
  ]
  expect(selectedTagSources(['t2'], tags)).toEqual([
    { type: 'team', value: 'T2' }, { type: 'project', value: '/p2' },
  ])
  expect(selectedTagSources(['t1', 'ghost'], tags)).toEqual([{ type: 'repo', value: 'r1' }])
  expect(selectedTagSources([], tags)).toEqual([])
})

test('makeTagFilter is inert (null) when nothing selectable resolves', () => {
  const tags = [tag('t1', [{ type: 'repo', value: 'r1' }])]
  expect(makeTagFilter([], tags)).toBeNull()
  expect(makeTagFilter(['ghost'], tags)).toBeNull()
  // A selected tag with no sources cannot narrow anything either.
  expect(makeTagFilter(['empty'], [tag('empty', [])])).toBeNull()
})

test('makeTagFilter keeps sessions matching ANY source of ANY selected tag', () => {
  const tags = [
    tag('t1', [{ type: 'repo', value: 'github.com/org/a' }]),
    tag('t2', [{ type: 'machine', value: 'hash1' }]),
  ]
  const keep = makeTagFilter(['t1', 't2'], tags, noLookups)!
  const sessions = [
    s({ session_id: '1', git_remote: 'github.com/org/a' }),
    s({ session_id: '2', memberId: 'hash1' }),
    s({ session_id: '3', memberId: 'hash9' }),
  ]
  expect(sessions.filter(keep).map(x => x.session_id)).toEqual(['1', '2'])
})
