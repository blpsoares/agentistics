import { test, expect } from 'bun:test'
import type { TeamConnection } from '@agentistics/core'
import { decideLeaveTarget } from './cli-member'

function conn(id: string, endpoint: string): TeamConnection {
  return { id, endpoint, org: 'default', user: 'u', token: 't', deniedRepos: [] }
}

// ---------------------------------------------------------------------------
// decideLeaveTarget — the 0/1/N × --endpoint/--all × TTY decision behind `agentop member leave`
// (spec §8). Never guesses `connections[0]` in the ambiguous case — a silent guess there is data
// loss, so this is exhaustively covered rather than only smoke-tested.
// ---------------------------------------------------------------------------

test('0 connections: nothing to leave, regardless of flags or TTY', () => {
  expect(decideLeaveTarget([], { isTTY: true })).toEqual({ type: 'none' })
  expect(decideLeaveTarget([], { isTTY: false })).toEqual({ type: 'none' })
  expect(decideLeaveTarget([], { all: true, isTTY: true })).toEqual({ type: 'none' })
})

test('1 connection, no flags: leaves it directly, no prompt — TTY does not matter', () => {
  const only = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  expect(decideLeaveTarget([only], { isTTY: true })).toEqual({ type: 'single', conn: only })
  expect(decideLeaveTarget([only], { isTTY: false })).toEqual({ type: 'single', conn: only })
})

test('N connections, --all: leaves every one regardless of TTY', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { all: true, isTTY: true })).toEqual({ type: 'all' })
  expect(decideLeaveTarget([a, b], { all: true, isTTY: false })).toEqual({ type: 'all' })
})

test('N connections, --endpoint matching one: leaves just that one', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { endpoint: 'http://b:48080', isTTY: false })).toEqual({ type: 'single', conn: b })
})

test('--endpoint tolerates a trailing slash on either side', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  expect(decideLeaveTarget([a], { endpoint: 'http://a:48080/', isTTY: false })).toEqual({ type: 'single', conn: a })
})

test('N connections, --endpoint matching none: not-found, never falls back to a guess', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { endpoint: 'http://nope:1', isTTY: true })).toEqual({ type: 'not-found' })
})

test('N connections, no flag, TTY: prompts — never silently picks connections[0]', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { isTTY: true })).toEqual({ type: 'prompt' })
})

test('N connections, no flag, non-TTY: ambiguous — refuses to guess, exit-1 territory', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  const c = conn('c_cccccccccccc', 'http://c:48080')
  expect(decideLeaveTarget([a, b, c], { isTTY: false })).toEqual({ type: 'ambiguous' })
})

test('--endpoint wins over an implicit N-connection prompt even on a TTY', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { endpoint: 'http://a:48080', isTTY: true })).toEqual({ type: 'single', conn: a })
})

test('--all wins over --endpoint when both are somehow set', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { all: true, endpoint: 'http://a:48080', isTTY: false })).toEqual({ type: 'all' })
})
