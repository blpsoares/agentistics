import { test, expect } from 'bun:test'
import {
  agentWsUrl, backoffDelay, BACKOFF_MS, fingerprintOf, shouldTeardown, decodeAgentFrame,
} from './team-agent-client'
import type { TeamConnection } from '@agentistics/core'

// ---------------------------------------------------------------------------
// agentWsUrl — pure URL builder
// ---------------------------------------------------------------------------

test('agentWsUrl maps http/https to ws/wss and appends the agent route', () => {
  expect(agentWsUrl('http://host.example.com')).toBe('ws://host.example.com/api/team/agent')
  expect(agentWsUrl('https://host.example.com')).toBe('wss://host.example.com/api/team/agent')
})

test('agentWsUrl trims a trailing slash — a bare trailing slash must not double the slash before the route', () => {
  // http://host/ naively becomes ws://host//api/team/agent, whose double slash misses the
  // server's exact-match upgrade route and the socket never connects.
  expect(agentWsUrl('http://host.example.com/')).toBe('ws://host.example.com/api/team/agent')
  expect(agentWsUrl('https://host.example.com/')).toBe('wss://host.example.com/api/team/agent')
})

test('agentWsUrl trims multiple trailing slashes', () => {
  expect(agentWsUrl('http://host.example.com///')).toBe('ws://host.example.com/api/team/agent')
})

test('agentWsUrl never produces a double slash before the route, for any input shape', () => {
  for (const endpoint of ['http://host', 'http://host/', 'https://host.example.com:8080', 'https://host.example.com:8080/']) {
    expect(agentWsUrl(endpoint)).not.toContain('//api/team/agent')
  }
})

test('agentWsUrl preserves a port and path prefix', () => {
  expect(agentWsUrl('http://host.example.com:48080')).toBe('ws://host.example.com:48080/api/team/agent')
})

// ---------------------------------------------------------------------------
// backoffDelay — pure exponential backoff schedule
// ---------------------------------------------------------------------------

test('backoffDelay follows BACKOFF_MS for in-range indices', () => {
  for (let i = 0; i < BACKOFF_MS.length; i++) {
    expect(backoffDelay(i)).toBe(BACKOFF_MS[i]!)
  }
})

test('backoffDelay clamps to the last entry once the index runs past the table', () => {
  const last = BACKOFF_MS[BACKOFF_MS.length - 1]!
  expect(backoffDelay(BACKOFF_MS.length)).toBe(last)
  expect(backoffDelay(BACKOFF_MS.length + 100)).toBe(last)
})

test('backoffDelay clamps a negative index to the first entry, never going out of bounds', () => {
  expect(backoffDelay(-1)).toBe(BACKOFF_MS[0]!)
  expect(backoffDelay(-100)).toBe(BACKOFF_MS[0]!)
})

test('backoffDelay is monotonically non-decreasing across the table', () => {
  for (let i = 1; i < BACKOFF_MS.length; i++) {
    expect(backoffDelay(i)).toBeGreaterThanOrEqual(backoffDelay(i - 1))
  }
})

// ---------------------------------------------------------------------------
// shouldTeardown — pure fingerprint-vs-connection decision
// ---------------------------------------------------------------------------

function makeConn(overrides?: Partial<TeamConnection>): TeamConnection {
  return {
    id: 'c_aaaaaaaaaaaa',
    endpoint: 'http://127.0.0.1:48001',
    org: 'default',
    user: 'alice',
    token: 'tok-1',
    deniedRepos: [],
    ...overrides,
  }
}

test('shouldTeardown is false when the stored fingerprint still matches the live connection', () => {
  const conn = makeConn()
  expect(shouldTeardown(fingerprintOf(conn), conn)).toBe(false)
})

test('shouldTeardown is true once the token rotates — the stored fingerprint no longer matches', () => {
  const before = makeConn({ token: 'tok-1' })
  const after = makeConn({ token: 'tok-2' })
  expect(shouldTeardown(fingerprintOf(before), after)).toBe(true)
})

test('shouldTeardown is true once the endpoint changes', () => {
  const before = makeConn({ endpoint: 'http://127.0.0.1:48001' })
  const after = makeConn({ endpoint: 'http://127.0.0.1:48002' })
  expect(shouldTeardown(fingerprintOf(before), after)).toBe(true)
})

test('shouldTeardown is true when the connection is gone from preferences (removed)', () => {
  expect(shouldTeardown(fingerprintOf(makeConn()), undefined)).toBe(true)
})

test('shouldTeardown is true when the connection lost its endpoint', () => {
  const conn = makeConn({ endpoint: '' })
  expect(shouldTeardown(fingerprintOf(makeConn()), conn)).toBe(true)
})

// ---------------------------------------------------------------------------
// decodeAgentFrame — pure inbound-frame decoder
// ---------------------------------------------------------------------------

const META = { connectionId: 'c_aaaaaaaaaaaa', central: 'central-1' }

test('decodeAgentFrame: junk / empty / unparseable input decodes to no-op', () => {
  for (const raw of ['', '{not json', '{}', '[]', '"just a string"']) {
    const d = decodeAgentFrame(raw, META)
    expect(d.notification).toBeNull()
    expect(d.userUpdate).toBeNull()
    expect(d.refreshDashboard).toBe(false)
  }
})

test('decodeAgentFrame: an unrecognized type decodes to no-op', () => {
  const d = decodeAgentFrame(JSON.stringify({ type: 'ping' }), META)
  expect(d.notification).toBeNull()
  expect(d.userUpdate).toBeNull()
})

test('decodeAgentFrame: renamed carries connectionId/central in meta and persists the new name', () => {
  const d = decodeAgentFrame(JSON.stringify({ type: 'renamed', name: 'shiny-laptop', actor: 'alice' }), META)
  expect(d.notification).toEqual({
    type: 'info', code: 'machine.renamed',
    meta: { name: 'shiny-laptop', actor: 'alice', connectionId: 'c_aaaaaaaaaaaa', central: 'central-1' },
  })
  expect(d.userUpdate).toBe('shiny-laptop')
  expect(d.refreshDashboard).toBe(false)
})

test('decodeAgentFrame: renamed with an empty/missing name notifies but does not update user', () => {
  const d = decodeAgentFrame(JSON.stringify({ type: 'renamed', actor: 'alice' }), META)
  expect(d.notification?.code).toBe('machine.renamed')
  expect(d.userUpdate).toBeNull()
})

test('decodeAgentFrame: reassigned to a named account persists that name directly, like a rename', () => {
  const d = decodeAgentFrame(JSON.stringify({ type: 'reassigned', account: 'bob@example.com', actor: 'admin' }), META)
  expect(d.notification).toEqual({
    type: 'info', code: 'machine.reassigned',
    meta: { account: 'bob@example.com', actor: 'admin', connectionId: 'c_aaaaaaaaaaaa', central: 'central-1' },
  })
  expect(d.userUpdate).toBe('bob@example.com')
  expect(d.refreshDashboard).toBe(true)
})

test('decodeAgentFrame: reassigned with a null account clears user (the fallback name is unknown locally) instead of leaving the stale one', () => {
  const d = decodeAgentFrame(JSON.stringify({ type: 'reassigned', account: null, actor: 'admin' }), META)
  expect(d.userUpdate).toBe('') // '' means "clear", not "no update" (null)
  expect(d.refreshDashboard).toBe(true)
})

// ---------------------------------------------------------------------------
// I1 / M6 — the socket 'close' ownership guard and teardown's backoff cleanup.
//
// A token rotation tears the old socket down while `reconcileConnection` opens the replacement in
// the same pass, so the OLD socket's 'close' fires when the map already holds the NEW one. Only
// the two map deletes used to be guarded: `stopLiveReporting` and `scheduleReconnect` ran
// unconditionally, so the old socket's close cleared the NEW socket's live-reporting timer, which
// nothing re-arms — that central's live-session panel went blank permanently while pushes and
// presence stayed green.
//
// Both paths exercised here are filesystem-free and timer-free by construction (a non-owning close
// returns immediately; teardown never reconnects), so nothing reads the real ~/.agentistics.
// ---------------------------------------------------------------------------

import { __socketStateForTests as S } from './team-agent-client'

/** The three WebSocket members these paths touch. `close()` records instead of networking. */
function fakeSocket(): { closed: number } & WebSocket {
  const rec = { closed: 0 }
  return Object.assign(rec, {
    readyState: 1,
    close() { rec.closed++ },
    addEventListener() { /* nothing subscribes in these tests */ },
  }) as unknown as { closed: number } & WebSocket
}

test('a superseded socket closing leaves the replacement socket, its fingerprint and its backoff untouched', () => {
  const id = 'c_aaaaaaaaaaa1'
  const oldSocket = fakeSocket()
  const newSocket = fakeSocket()
  // The state after a rotation: the NEW socket owns the id.
  S.activeWs.set(id, newSocket)
  S.credFingerprint.set(id, 'fingerprint-of-the-new-socket')
  S.backoffIdx.set(id, 2)

  S.handleSocketClose(id, oldSocket)

  expect(S.activeWs.get(id)).toBe(newSocket)
  expect(S.credFingerprint.get(id)).toBe('fingerprint-of-the-new-socket')
  // Unchanged: `scheduleReconnect` (which increments this) must not have run for the new socket.
  expect(S.backoffIdx.get(id)).toBe(2)

  S.activeWs.delete(id)
  S.credFingerprint.delete(id)
  S.backoffIdx.delete(id)
})

test('teardownSocket forgets the socket, its fingerprint AND its backoff index', () => {
  const id = 'c_aaaaaaaaaaa2'
  const socket = fakeSocket()
  S.activeWs.set(id, socket)
  S.credFingerprint.set(id, 'fp')
  // A connection that had been failing sits at the 30s backoff cap; a rotated connection must not
  // inherit it, and an id removed for good must not leave an entry behind.
  S.backoffIdx.set(id, BACKOFF_MS.length - 1)

  S.teardownSocket(id)

  expect(S.activeWs.has(id)).toBe(false)
  expect(S.credFingerprint.has(id)).toBe(false)
  expect(S.backoffIdx.has(id)).toBe(false)
  expect(socket.closed).toBe(1)
})

test('the socket state maps are left empty by these tests — no cross-test leakage', () => {
  // Order-independence guard: every id above is unique to its test and cleaned up, so a later
  // test (or a later run in a different order) can never observe another's socket state.
  expect([...S.activeWs.keys()].filter(k => k.startsWith('c_aaaaaaaaaaa'))).toEqual([])
  expect([...S.backoffIdx.keys()].filter(k => k.startsWith('c_aaaaaaaaaaa'))).toEqual([])
})
