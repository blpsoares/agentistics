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

// --- the tag's period, and agreement with the server copy --------------------------------------

import { sessionInTagWindow, type TagWindow } from './tagMatch'
import { sessionInWindow, sessionMatchesTag } from '../../../server/server/tags-resolve'

const dated = (day: string, over: Partial<SessionMeta> = {}) =>
  s({ start_time: `${day}T12:00:00.000Z`, ...over })

function windowed(id: string, sources: TagSource[], window?: TagWindow): TagDef {
  return { _id: id, name: id, sources, ...(window ? { window } : {}) }
}

test('sessionInTagWindow: inclusive both ends, each side optional, undated belongs nowhere', () => {
  const w: TagWindow = { start: '2026-07-04', end: '2026-07-18' }
  expect(sessionInTagWindow(dated('2026-07-03'), w)).toBe(false)
  expect(sessionInTagWindow(dated('2026-07-04'), w)).toBe(true)
  expect(sessionInTagWindow(dated('2026-07-18'), w)).toBe(true)
  expect(sessionInTagWindow(dated('2026-07-19'), w)).toBe(false)
  expect(sessionInTagWindow(dated('2026-07-19'), { start: '2026-07-04' })).toBe(true)
  expect(sessionInTagWindow(dated('2026-07-03'), { end: '2026-07-18' })).toBe(true)
  expect(sessionInTagWindow(dated('2026-07-10'))).toBe(true)
  expect(sessionInTagWindow(s({}), w)).toBe(false)
})

test('makeTagFilter applies EACH tag its own period, not one flattened union', () => {
  // Two tags over the same repo, different months. A session in July belongs to the July tag only,
  // and flattening the sources first would have let the August tag admit it.
  const july = windowed('july', [{ type: 'repo', value: 'r1' }], { start: '2026-07-01', end: '2026-07-31' })
  const august = windowed('aug', [{ type: 'repo', value: 'r1' }], { start: '2026-08-01', end: '2026-08-31' })

  const inJuly = dated('2026-07-10', { git_remote: 'r1' })
  const inAugust = dated('2026-08-10', { git_remote: 'r1' })
  const inSeptember = dated('2026-09-10', { git_remote: 'r1' })

  const onlyJuly = makeTagFilter(['july'], [july, august], noLookups)!
  expect(onlyJuly(inJuly)).toBe(true)
  expect(onlyJuly(inAugust)).toBe(false)

  // Selecting both is a union of the two periods — and still excludes what neither covers.
  const both = makeTagFilter(['july', 'aug'], [july, august], noLookups)!
  expect(both(inJuly)).toBe(true)
  expect(both(inAugust)).toBe(true)
  expect(both(inSeptember)).toBe(false)
})

test('makeTagFilter: a tag with no period still covers everything from its sources', () => {
  const allTime = windowed('all', [{ type: 'repo', value: 'r1' }])
  const keep = makeTagFilter(['all'], [allTime], noLookups)!
  expect(keep(dated('2020-01-01', { git_remote: 'r1' }))).toBe(true)
  expect(keep(s({ git_remote: 'r1' }))).toBe(true)          // undated: no period to fail
  expect(keep(dated('2026-07-10', { git_remote: 'other' }))).toBe(false)
})

test('the browser mirror and the server resolver agree, session for session', () => {
  // The two copies are hand-kept in sync (the web bundle cannot import from packages/server at
  // runtime). This is the test that fails when only one of them is updated.
  const w: TagWindow = { start: '2026-07-04', end: '2026-07-18' }
  const sources: TagSource[] = [{ type: 'repo', value: 'r1' }, { type: 'machine', value: 'm1' }]
  const tagDef = windowed('t', sources, w)
  const filter = makeTagFilter(['t'], [tagDef], noLookups)!

  const corpus: SessionMeta[] = [
    dated('2026-07-03', { git_remote: 'r1' }),
    dated('2026-07-04', { git_remote: 'r1' }),
    dated('2026-07-18', { memberId: 'm1' }),
    dated('2026-07-19', { memberId: 'm1' }),
    dated('2026-07-10', { git_remote: 'other' }),
    s({ git_remote: 'r1' }),
    s({ git_remote: 'r1', start_time: 'garbage' }),
  ]
  for (const session of corpus) {
    expect(filter(session)).toBe(sessionMatchesTag(session, sources, noLookups, [], w))
    expect(sessionInTagWindow(session, w)).toBe(sessionInWindow(session, w))
  }
})
