import { test, expect } from 'bun:test'
import { hashBootstrapToken, bootstrapTokenMatches, validateOwnerInput } from './bootstrap'

test('hashBootstrapToken is sha256 hex and deterministic', () => {
  const h = hashBootstrapToken('abc')
  expect(h).toBe(hashBootstrapToken('abc'))
  expect(h).toMatch(/^[0-9a-f]{64}$/)
  expect(h).not.toBe('abc')
})

test('bootstrapTokenMatches compares against the stored hash', () => {
  const h = hashBootstrapToken('tok')
  expect(bootstrapTokenMatches('tok', h)).toBe(true)
  expect(bootstrapTokenMatches('wrong', h)).toBe(false)
  expect(bootstrapTokenMatches('tok', undefined)).toBe(false)
})

test('validateOwnerInput accepts a well-formed body', () => {
  const r = validateOwnerInput({ name: ' Alice ', email: ' Alice@Example.com ', password: 'Brisk-tundra-lantern', confirm: 'Brisk-tundra-lantern', token: 't' })
  expect(r.ok).toBe(true)
  if (r.ok) {
    expect(r.value.name).toBe('Alice')
    expect(r.value.email).toBe('Alice@Example.com')
    expect(r.value.token).toBe('t')
  }
})

test('validateOwnerInput rejects bad input with a specific error', () => {
  expect(validateOwnerInput({ email: 'a@b.co', password: 'Brisk-tundra-lantern', confirm: 'Brisk-tundra-lantern', token: 't' })).toEqual({ ok: false, error: 'name is required' })
  expect(validateOwnerInput({ name: 'A', email: 'nope', password: 'Brisk-tundra-lantern', confirm: 'Brisk-tundra-lantern', token: 't' })).toEqual({ ok: false, error: 'valid email is required' })
  expect(validateOwnerInput({ name: 'A', email: 'a@b.co', password: 'Sh0rt!', confirm: 'Sh0rt!', token: 't' }))
    .toEqual({ ok: false, error: 'password must be at least 8 characters, with one uppercase letter and one symbol' })
  expect(validateOwnerInput({ name: 'A', email: 'a@b.co', password: 'Brisk-tundra-lantern', confirm: 'Brisk-tundra-lantern-x', token: 't' })).toEqual({ ok: false, error: 'passwords do not match' })
  expect(validateOwnerInput({ name: 'A', email: 'a@b.co', password: 'Brisk-tundra-lantern', confirm: 'Brisk-tundra-lantern' })).toEqual({ ok: false, error: 'missing bootstrap token' })
})
