/**
 * cli-status.test.ts — the pure config-block renderer behind `agentop status`.
 *
 * `cliStrings(lang)` is called with an EXPLICIT language: `resolveLang()` reads preferences (an
 * ambient dependency this suite must never take), and the strings themselves are pure.
 */

import { test, expect } from 'bun:test'
import { configLines } from './cli-status'
import { cliStrings } from './cli-i18n'
import type { TeamConnection } from '@agentistics/core'

const s = cliStrings('en')

function conn(endpoint: string, deniedRepos: string[] = []): TeamConnection {
  return { id: 'c_0123456789ab', endpoint, org: 'default', user: 'lucas', token: 't', deniedRepos }
}

/** ANSI-free view of a rendered line, so assertions read as text. */
function plain(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, '')
}

test('solo and central render their own single line', () => {
  expect(configLines(s, 'solo', []).map(plain)).toEqual(['solo'])
  expect(configLines(s, 'central', []).map(plain)).toEqual(['central'])
  // Member mode with nothing connected is solo in substance, and says so.
  expect(configLines(s, 'member', []).map(plain)).toEqual(['solo'])
})

test('one connection renders its endpoint', () => {
  expect(plain(configLines(s, 'member', [conn('http://central:48080')])[0]!)).toBe('member → http://central:48080')
})

test('M8: an empty endpoint prints the (?) placeholder, never a blank', () => {
  // `endpoint` is a non-optional string, so the old `?? '(?)'` could never fire — a connection
  // whose endpoint is '' (a shape migrateTeamConfig can produce) rendered "member → ". The
  // N-connection branch below and cli-start.ts both use `||`; this line was the one out of step.
  expect(plain(configLines(s, 'member', [conn('')])[0]!)).toBe('member → (?)')
  expect(plain(configLines(s, 'member', [conn(''), conn('http://b:48080')])[1]!)).toContain('(?)')
})

test('N connections render a count header plus one indented line each, never just the first', () => {
  const lines = configLines(s, 'member', [conn('http://a:48080'), conn('http://b:48080', ['github.com/o/r'])]).map(plain)
  expect(lines).toHaveLength(3)
  expect(lines[0]).toBe('member → 2 centrals')
  expect(lines[1]).toContain('http://a:48080')
  expect(lines[2]).toContain('http://b:48080')
  // The blocked-repo suffix comes from the SHARED string (no hand-copied English literal) and
  // brings its own leading separator — no double space.
  expect(lines[2]).toBe(`      ↳ http://b:48080${s.deniedSuffix(1)}`)
  expect(lines[2]).not.toContain('  ·')
})
