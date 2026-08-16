import { test, expect } from 'bun:test'
import { tagSourceTypes } from './tagSourceTypes'

test('a machine offers only the dimensions that exist on it', () => {
  expect(tagSourceTypes(false)).toEqual(['repo', 'project', 'harness', 'model'])
})

test('a central offers every dimension', () => {
  expect(tagSourceTypes(true)).toEqual(['repo', 'project', 'harness', 'model', 'user', 'machine', 'team', 'account'])
})

test('user is central-only: SessionMeta.user is never set on a solo/local session', () => {
  expect(tagSourceTypes(false)).not.toContain('user')
  expect(tagSourceTypes(true)).toContain('user')
})

test('harness and model are offered on both — session attributes, not identity', () => {
  for (const central of [true, false]) {
    expect(tagSourceTypes(central)).toContain('harness')
    expect(tagSourceTypes(central)).toContain('model')
  }
})

test('repo and project lead, on both — they are the ones anyone actually picks', () => {
  expect(tagSourceTypes(true).slice(0, 2)).toEqual(['repo', 'project'])
  expect(tagSourceTypes(false).slice(0, 2)).toEqual(['repo', 'project'])
})
