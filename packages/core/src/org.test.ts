import { test, expect } from 'bun:test'
import { isNamedOrg, PLACEHOLDER_ORG } from './org'

test('the literal placeholder is never a name, however it is typed', () => {
  expect(isNamedOrg('default')).toBe(false)
  expect(isNamedOrg('Default')).toBe(false)
  expect(isNamedOrg('DEFAULT')).toBe(false)
  expect(isNamedOrg('  default  ')).toBe(false)
})

test('absent or blank is never a name', () => {
  expect(isNamedOrg(undefined)).toBe(false)
  expect(isNamedOrg(null)).toBe(false)
  expect(isNamedOrg('')).toBe(false)
  expect(isNamedOrg('   ')).toBe(false)
})

test('anything someone actually chose is a name — including one that merely contains the placeholder', () => {
  expect(isNamedOrg('acme')).toBe(true)
  expect(isNamedOrg('siths')).toBe(true)
  expect(isNamedOrg('default-team')).toBe(true)
  expect(isNamedOrg('Acme Default')).toBe(true)
})

test('PLACEHOLDER_ORG is the value config.ts defaults TEAM_ORG to', () => {
  expect(PLACEHOLDER_ORG).toBe('default')
})
