import { test, expect } from 'bun:test'
import { agentWsUrl, backoffDelay, BACKOFF_MS } from './team-agent-client'

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
