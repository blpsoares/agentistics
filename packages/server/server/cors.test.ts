import { test, expect } from 'bun:test'
import { allowedOrigin } from './cors'

const OURS = { ports: [47291, 47292] as const }

test('no Origin header yields no echo — same-origin and non-browser callers are unaffected', () => {
  expect(allowedOrigin(null, OURS)).toBeNull()
  expect(allowedOrigin(undefined, OURS)).toBeNull()
  expect(allowedOrigin('', OURS)).toBeNull()
})

test('a loopback origin on one of our ports is echoed back verbatim', () => {
  expect(allowedOrigin('http://localhost:47292', OURS)).toBe('http://localhost:47292')
  expect(allowedOrigin('http://127.0.0.1:47291', OURS)).toBe('http://127.0.0.1:47291')
  expect(allowedOrigin('http://[::1]:47292', OURS)).toBe('http://[::1]:47292')
})

test('a loopback origin on a FOREIGN port is refused — another local app is not us', () => {
  expect(allowedOrigin('http://localhost:3000', OURS)).toBeNull()
  expect(allowedOrigin('http://127.0.0.1:8080', OURS)).toBeNull()
})

test('an unrelated site is refused even on one of our ports', () => {
  expect(allowedOrigin('https://evil.example:47291', OURS)).toBeNull()
  expect(allowedOrigin('https://evil.example', OURS)).toBeNull()
})

test('the host the client actually used is honoured — LAN IP and hostname', () => {
  const lan = { ...OURS, host: '192.168.1.5:47292' }
  expect(allowedOrigin('http://192.168.1.5:47292', lan)).toBe('http://192.168.1.5:47292')
  const named = { ...OURS, host: 'desktop.tail1234.ts.net:47292' }
  expect(allowedOrigin('http://desktop.tail1234.ts.net:47292', named)).toBe('http://desktop.tail1234.ts.net:47292')
})

test('a Host header does NOT open the door to a different hostname', () => {
  const lan = { ...OURS, host: '192.168.1.5:47292' }
  expect(allowedOrigin('http://192.168.1.9:47292', lan)).toBeNull()
  expect(allowedOrigin('https://evil.example:47292', lan)).toBeNull()
})

test('a Host header with no port still matches its own hostname on our ports', () => {
  const named = { ...OURS, host: 'agentistics.local' }
  expect(allowedOrigin('http://agentistics.local:47291', named)).toBe('http://agentistics.local:47291')
})

test('non-http schemes are refused — a file:// or extension page is not an origin we serve', () => {
  expect(allowedOrigin('file://', OURS)).toBeNull()
  expect(allowedOrigin('null', OURS)).toBeNull()
  expect(allowedOrigin('chrome-extension://abcdef', OURS)).toBeNull()
})

test('junk never throws', () => {
  for (const junk of ['http://', '://x', 'not a url', '   ', 'http://localhost:notaport']) {
    expect(() => allowedOrigin(junk, OURS)).not.toThrow()
    expect(allowedOrigin(junk, OURS)).toBeNull()
  }
})

test('a case-different host still matches — hostnames are case-insensitive', () => {
  const named = { ...OURS, host: 'Desktop.Local:47292' }
  expect(allowedOrigin('http://desktop.local:47292', named)).toBe('http://desktop.local:47292')
})
