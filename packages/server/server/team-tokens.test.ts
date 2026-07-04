/**
 * team-tokens.test.ts — unit tests for the pure helper in team-tokens.ts.
 *
 * Only hashToken is tested here (no Mongo required — pure function).
 * Run with: bun test packages/server/server/team-tokens.test.ts
 */

import { describe, expect, it } from 'bun:test'
import { hashToken } from './team-tokens'

describe('hashToken', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = hashToken('some-token-value')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same input always yields the same hash', () => {
    const token = 'deterministic-test-token'
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('distinct inputs produce distinct hashes (collision resistance)', () => {
    const h1 = hashToken('token-a')
    const h2 = hashToken('token-b')
    expect(h1).not.toBe(h2)
  })

  it('works on an empty string (edge case)', () => {
    const hash = hashToken('')
    // SHA-256 of '' is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes look like 64-char lowercase hex (no uppercase, no extra chars)', () => {
    const hash = hashToken('another-test-token-xyz')
    expect(hash).toMatch(/^[a-f0-9]+$/)
    expect(hash).toHaveLength(64)
  })

  it('a typical minted token (64-char hex from randomBytes(32)) hashes correctly', () => {
    // Simulate what mintToken generates
    const fakeToken = 'a'.repeat(64)
    const hash = hashToken(fakeToken)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
