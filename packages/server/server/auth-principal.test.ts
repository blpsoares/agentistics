import { test, expect } from 'bun:test'
import { signPrincipalSession, verifyPrincipalSession } from './auth'

const SECRET = 'test-secret'
const FUTURE = 10_000_000_000_000 // year 2286
const NOW = 1_000_000_000_000

test('sign→verify roundtrip returns accountId + sessionVersion', () => {
  const cookie = signPrincipalSession(FUTURE, 'acc123', 4, SECRET)
  expect(verifyPrincipalSession(cookie, SECRET, NOW)).toEqual({ accountId: 'acc123', sessionVersion: 4 })
})

test('rejects an expired cookie', () => {
  const cookie = signPrincipalSession(NOW - 1, 'acc123', 0, SECRET)
  expect(verifyPrincipalSession(cookie, SECRET, NOW)).toBeNull()
})

test('rejects a tampered payload or wrong secret', () => {
  const cookie = signPrincipalSession(FUTURE, 'acc123', 0, SECRET)
  expect(verifyPrincipalSession(cookie.replace('acc123', 'acc999'), SECRET, NOW)).toBeNull()
  expect(verifyPrincipalSession(cookie, 'other-secret', NOW)).toBeNull()
})

test('rejects malformed cookies', () => {
  expect(verifyPrincipalSession(undefined, SECRET, NOW)).toBeNull()
  expect(verifyPrincipalSession('garbage', SECRET, NOW)).toBeNull()
  expect(verifyPrincipalSession('a.b.c', SECRET, NOW)).toBeNull()
})
