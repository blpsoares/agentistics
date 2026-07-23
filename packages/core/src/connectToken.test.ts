import { test, expect } from 'bun:test'
import { packConnectToken, unpackConnectToken } from './team'

const SECRET = '660d34249c6bafa337495112c7a17861db24c3c9c58de0362fdc787468402e00'

test('packConnectToken returns the raw secret when no endpoint', () => {
  expect(packConnectToken(SECRET)).toBe(SECRET)
  expect(packConnectToken(SECRET, '')).toBe(SECRET)
})

test('pack/unpack round-trips the endpoint and keeps the secret intact', () => {
  const packed = packConnectToken(SECRET, 'http://100.109.247.39:48080/')
  expect(packed).not.toBe(SECRET)
  const { endpoint, secret } = unpackConnectToken(packed)
  expect(endpoint).toBe('http://100.109.247.39:48080') // trailing slash stripped
  expect(secret).toBe(SECRET) // the bearer is always the raw secret
})

test('unpackConnectToken treats a raw secret as the secret with no endpoint', () => {
  const { endpoint, secret } = unpackConnectToken(SECRET)
  expect(endpoint).toBeUndefined()
  expect(secret).toBe(SECRET)
})

test('unpackConnectToken tolerates whitespace and malformed composites', () => {
  expect(unpackConnectToken(`  ${SECRET}  `).secret).toBe(SECRET)
  // malformed act1_ with bad base64 → falls back to treating the whole thing as the secret
  const bad = 'act1_@@@.abc'
  expect(unpackConnectToken(bad).secret).toBe(bad)
})
