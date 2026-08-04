import { test, expect } from 'bun:test'
import { tagSourceTypes } from './tagSourceTypes'

test('a machine offers only the dimensions that exist on it', () => {
  expect(tagSourceTypes(false)).toEqual(['repo', 'project'])
})

test('a central offers every dimension', () => {
  expect(tagSourceTypes(true)).toEqual(['repo', 'project', 'machine', 'team', 'account'])
})

test('repo and project lead, on both — they are the ones anyone actually picks', () => {
  expect(tagSourceTypes(true).slice(0, 2)).toEqual(['repo', 'project'])
  expect(tagSourceTypes(false).slice(0, 2)).toEqual(['repo', 'project'])
})
