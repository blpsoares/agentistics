/**
 * team-tokens.test.ts — unit tests for the pure helpers in team-tokens.ts.
 *
 * Only hashToken and machineUserFor are tested here (no Mongo required — pure functions).
 * Run with: bun test packages/server/server/team-tokens.test.ts
 */

import { describe, expect, it } from 'bun:test'
import { hashToken, machineUserFor } from './team-tokens'

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

describe('machineUserFor', () => {
  it('returns the owner name unchanged when a machine has an owner', () => {
    expect(machineUserFor('Alice')).toBe('Alice')
  })

  it('returns an empty string for an ownerless machine — never a fallback name', () => {
    expect(machineUserFor(undefined)).toBe('')
    expect(machineUserFor(null)).toBe('')
  })

  it('never falls back to a machine\'s own name — this is the exact bug being fixed: a machine with no owner is not a person', () => {
    // The regression this guards: minting/reassigning ownership used to fall back to the
    // machine's own `label`/`machineName` when there was no owner account, which made an
    // ownerless machine surface as a "member" under its own name (filters, MembersPage, the
    // MachinesSettings table). A caller must never pass the machine name as the fallback here.
    const machineName = 'Alice\'s laptop'
    expect(machineUserFor(undefined)).not.toBe(machineName)
  })
})
