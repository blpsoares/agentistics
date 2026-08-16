/**
 * C1 — the Settings Disconnect button must remove ONE central, and `findPanelConnection` is how it
 * knows which. Getting this wrong is unrecoverable data loss: a connection's token exists nowhere
 * else on the machine.
 */

import { test, expect } from 'bun:test'
import { normalizeTeamConfig, defaultTeam, type TeamConfig, type TeamConnection } from '@agentistics/core'
import { findPanelConnection } from './teamConnections'

function conn(id: string, endpoint: string): TeamConnection {
  return { id, endpoint, org: 'default', user: 'lucas', token: `tok-${id}`, deniedRepos: [] }
}

function cfg(...connections: TeamConnection[]): TeamConfig {
  // Built through the real normalizer, so the flat mirror under test is the one the server stores.
  return normalizeTeamConfig({ ...defaultTeam(), connections })
}

test('the panel resolves the connection behind the flat mirror it renders', () => {
  const a = conn('c_0123456789ab', 'http://a:48080')
  const b = conn('c_ba9876543210', 'http://b:48080')
  const config = cfg(a, b)
  // normalizeTeamConfig mirrors connections[0], which is what the panel displays.
  expect(config.endpoint).toBe('http://a:48080')
  expect(findPanelConnection(config, config.endpoint!)!.id).toBe(a.id)
  // And an explicitly named second endpoint resolves to ITS entry, not to the mirror.
  expect(findPanelConnection(config, 'http://b:48080')!.id).toBe(b.id)
})

test('matching is by the shared endpoint identity rule, not a string compare', () => {
  const config = cfg(conn('c_0123456789ab', 'https://central.example.com'))
  for (const typed of [
    'https://Central.Example.com',
    'https://central.example.com/',
    'https://central.example.com:443',
  ]) {
    expect(findPanelConnection(config, typed)!.id).toBe('c_0123456789ab')
  }
})

test('with exactly one connection, an empty or unknown endpoint still resolves it', () => {
  const config = cfg(conn('c_0123456789ab', 'http://a:48080'))
  expect(findPanelConnection(config, '')!.id).toBe('c_0123456789ab')
  expect(findPanelConnection(config, 'http://typo:48080')!.id).toBe('c_0123456789ab')
})

test('with several connections and no match it refuses to guess', () => {
  const config = cfg(conn('c_0123456789ab', 'http://a:48080'), conn('c_ba9876543210', 'http://b:48080'))
  // Returning connections[0] here would disconnect a central the user is not looking at — the
  // caller shows an error and points at `agentop member leave --endpoint <url>` instead.
  expect(findPanelConnection(config, 'http://elsewhere:48080')).toBeUndefined()
  expect(findPanelConnection(config, '')).toBeUndefined()
})

test('a solo config has nothing to disconnect', () => {
  expect(findPanelConnection(defaultTeam(), '')).toBeUndefined()
  expect(findPanelConnection({} as TeamConfig, 'http://a:48080')).toBeUndefined()
})
