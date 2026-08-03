// packages/server/server/passwords.test.ts
import { test, expect } from 'bun:test'
import { hashPassword, verifyPassword } from './passwords'

test('hashPassword produces an argon2id hash distinct from the plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple')
  expect(hash).not.toBe('correct horse battery staple')
  expect(hash.startsWith('$argon2id$')).toBe(true)
})

test('verifyPassword accepts the correct password and rejects wrong ones', async () => {
  const hash = await hashPassword('s3cret!')
  expect(await verifyPassword('s3cret!', hash)).toBe(true)
  expect(await verifyPassword('wrong', hash)).toBe(false)
})

test('verifyPassword returns false for an empty/garbage hash instead of throwing', async () => {
  expect(await verifyPassword('anything', '')).toBe(false)
  expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
})
