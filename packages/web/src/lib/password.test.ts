import { test, expect } from 'bun:test'
import { generatePassword } from './password'

test('generatePassword returns the requested length', () => {
  expect(generatePassword(16)).toHaveLength(16)
  expect(generatePassword(24)).toHaveLength(24)
})

test('generatePassword defaults to 16 chars', () => {
  expect(generatePassword()).toHaveLength(16)
})

test('generatePassword enforces a 12-char floor', () => {
  expect(generatePassword(4).length).toBeGreaterThanOrEqual(12)
})

test('generatePassword uses only the unambiguous alphabet', () => {
  const pw = generatePassword(200)
  expect(/^[A-HJ-NP-Za-hj-km-z2-9!@#$%^&*_-]+$/.test(pw)).toBe(true)
  // no ambiguous chars
  expect(/[0O1lI]/.test(pw)).toBe(false)
})

test('generatePassword is effectively unique across calls', () => {
  const seen = new Set(Array.from({ length: 50 }, () => generatePassword(16)))
  expect(seen.size).toBe(50)
})
