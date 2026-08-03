import { test, expect } from 'bun:test'
import { normalizeEmail } from './iam-types'

test('normalizeEmail lowercases and trims', () => {
  expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com')
})

test('normalizeEmail is idempotent', () => {
  const once = normalizeEmail('Bob@Foo.io')
  expect(normalizeEmail(once)).toBe(once)
})
