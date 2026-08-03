import { test, expect } from 'bun:test'
import {
  signPrincipalSession,
  verifyPrincipalSession,
  cookieName,
  IDLE_TIMEOUT_MS,
  signMfaChallenge,
  verifyMfaChallenge,
} from './auth'

const SECRET = 'test-secret'
const FUTURE = 10_000_000_000_000 // year 2286
const NOW = 1_000_000_000_000

test('sign→verify roundtrip returns accountId + sessionVersion + issuedAt', () => {
  const cookie = signPrincipalSession(FUTURE, 'acc123', 4, SECRET, NOW)
  expect(verifyPrincipalSession(cookie, SECRET, NOW)).toEqual({
    accountId: 'acc123',
    sessionVersion: 4,
    issuedAtMs: NOW,
  })
})

test('rejects an expired cookie', () => {
  const cookie = signPrincipalSession(NOW - 1, 'acc123', 0, SECRET, NOW - 1000)
  expect(verifyPrincipalSession(cookie, SECRET, NOW)).toBeNull()
})

test('rejects a tampered payload or wrong secret', () => {
  const cookie = signPrincipalSession(FUTURE, 'acc123', 0, SECRET, NOW)
  expect(verifyPrincipalSession(cookie.replace('acc123', 'acc999'), SECRET, NOW)).toBeNull()
  expect(verifyPrincipalSession(cookie, 'other-secret', NOW)).toBeNull()
})

test('rejects malformed cookies', () => {
  expect(verifyPrincipalSession(undefined, SECRET, NOW)).toBeNull()
  expect(verifyPrincipalSession('garbage', SECRET, NOW)).toBeNull()
  expect(verifyPrincipalSession('a.b.c', SECRET, NOW)).toBeNull()
  // Three-part payload = the pre-idle-timeout format; it must not be accepted.
  expect(verifyPrincipalSession('a.b.c.d', SECRET, NOW)).toBeNull()
})

test('rejects a session idle beyond the idle timeout, even inside its absolute expiry', () => {
  const cookie = signPrincipalSession(FUTURE, 'acc123', 1, SECRET, NOW)
  expect(verifyPrincipalSession(cookie, SECRET, NOW + IDLE_TIMEOUT_MS - 1)).not.toBeNull()
  expect(verifyPrincipalSession(cookie, SECRET, NOW + IDLE_TIMEOUT_MS + 1)).toBeNull()
})

test('cookie name carries the __Host- prefix only when Secure', () => {
  expect(cookieName(true)).toBe('__Host-agentistics_session')
  expect(cookieName(false)).toBe('agentistics_session')
})

test('mfa challenge round-trips, expires, and rejects tampering', () => {
  const c = signMfaChallenge('acc123', 2, SECRET, NOW + 60_000)
  expect(verifyMfaChallenge(c, SECRET, NOW)).toEqual({ accountId: 'acc123', sessionVersion: 2 })
  expect(verifyMfaChallenge(c, SECRET, NOW + 60_001)).toBeNull()
  expect(verifyMfaChallenge(c.replace('acc123', 'acc999'), SECRET, NOW)).toBeNull()
  expect(verifyMfaChallenge(c, 'other-secret', NOW)).toBeNull()
  expect(verifyMfaChallenge(undefined, SECRET, NOW)).toBeNull()
})

test('a session cookie cannot be replayed as an mfa challenge, or vice versa', () => {
  // Both are HMACs over a dotted payload with the same secret; only domain separation stops
  // one from being accepted as the other.
  const session = signPrincipalSession(FUTURE, 'acc123', 1, SECRET, NOW)
  expect(verifyMfaChallenge(session, SECRET, NOW)).toBeNull()
  const challenge = signMfaChallenge('acc123', 1, SECRET, FUTURE)
  expect(verifyPrincipalSession(challenge, SECRET, NOW)).toBeNull()
})
