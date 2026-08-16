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

// A hex setup token is copied out of a terminal, so a paste routinely carries a trailing newline
// or space. Untrimmed, the hash misses and the operator is told the token is invalid when it is
// the correct one — indistinguishable, on screen and in the log, from a genuinely wrong token.
test('the setup token is trimmed — a pasted trailing newline or space still matches', () => {
  const token = 'de8d546e0d7f1e0cf5f0d5028b70cbd55b3c5d23c6893c63'
  const stored = hashBootstrapToken(token)
  const base = { name: 'Alice', email: 'alice@example.com', password: 'Brisk-tundra-lantern', confirm: 'Brisk-tundra-lantern' }

  const pastes = [`${token} `, `${token}\n`, ` ${token}`, `  ${token}\r\n`]
  expect(pastes.length).toBe(4) // guard: the loop below must actually assert something
  for (const pasted of pastes) {
    const r = validateOwnerInput({ ...base, token: pasted })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.value.token).toBe(token)
    expect(bootstrapTokenMatches(r.value.token, stored)).toBe(true)
  }

  // The untrimmed value is exactly what used to be sent, and it does NOT match — this is the
  // regression, stated as the reason the trim exists.
  expect(bootstrapTokenMatches(`${token} `, stored)).toBe(false)
})

test('a genuinely wrong token is still refused after trimming', () => {
  const stored = hashBootstrapToken('de8d546e0d7f1e0cf5f0d5028b70cbd55b3c5d23c6893c63')
  const r = validateOwnerInput({
    name: 'Alice', email: 'alice@example.com',
    password: 'Brisk-tundra-lantern', confirm: 'Brisk-tundra-lantern',
    token: '  0000000000000000000000000000000000000000000000ff  ',
  })
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error('unreachable')
  expect(bootstrapTokenMatches(r.value.token, stored)).toBe(false)
})

test('a token of only whitespace is missing, not present-and-wrong', () => {
  const r = validateOwnerInput({
    name: 'Alice', email: 'alice@example.com',
    password: 'Brisk-tundra-lantern', confirm: 'Brisk-tundra-lantern', token: '   ',
  })
  expect(r.ok).toBe(false)
  if (r.ok) throw new Error('unreachable')
  expect(r.error).toBe('missing bootstrap token')
})
