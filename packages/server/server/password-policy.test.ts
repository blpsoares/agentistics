/**
 * password-policy.test.ts — the rule the product asks for: 8 characters, an uppercase letter
 * and a symbol. Nothing else. A hidden extra rule is what made a password get refused fifteen
 * times with a three-word explanation.
 */
import { describe, expect, it } from 'bun:test'
import { validatePasswordPolicy, passwordChecks, PASSWORD_MIN_LENGTH } from './password-policy'

const ctx = { email: 'ana@example.com', name: 'Ana Souza' }

describe('validatePasswordPolicy', () => {
  it('states the floor it enforces', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8)
  })

  it('accepts the shortest password that satisfies every rule', () => {
    expect(validatePasswordPolicy('Abcdefg!', ctx).ok).toBe(true)
  })

  it('rejects one character short of the floor, and says the whole rule', () => {
    const r = validatePasswordPolicy('Abcdef!', ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('too_short')
      // The message must carry all three requirements: being told only about length is how a
      // second attempt fails on a rule nobody mentioned.
      expect(r.error).toContain('8')
      expect(r.error).toContain('uppercase')
      expect(r.error).toContain('symbol')
    }
  })

  it('names the missing requirement when only one is missing', () => {
    const noUpper = validatePasswordPolicy('abcdefg!', ctx)
    expect(noUpper.ok).toBe(false)
    if (!noUpper.ok) expect(noUpper.reason).toBe('no_uppercase')

    const noSymbol = validatePasswordPolicy('Abcdefgh', ctx)
    expect(noSymbol.ok).toBe(false)
    if (!noSymbol.ok) expect(noSymbol.reason).toBe('no_symbol')
  })

  it('accepts a password containing the product name — the "too common" rule is gone', () => {
    // `agentistics@123!` was refused as "too common" because a stem list matched the product's
    // own name by prefix: correct by the old rule, and impossible to act on from the message.
    expect(validatePasswordPolicy('Agentistics@123!', ctx).ok).toBe(true)
  })

  it('still refuses that exact password for the ONE reason that remains, and names it', () => {
    // Lowercase throughout. It fails the uppercase rule — the product's own rule — and the
    // message now says so instead of calling it common.
    const r = validatePasswordPolicy('agentistics@123!', ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('no_uppercase')
      expect(r.error).toContain('uppercase')
    }
  })

  it('accepts a password containing the account name or e-mail', () => {
    expect(validatePasswordPolicy('Ana Souza!1', ctx).ok).toBe(true)
    expect(validatePasswordPolicy('Ana@example1', ctx).ok).toBe(true)
  })

  it('still bounds the length, because hashing cost grows with input', () => {
    const r = validatePasswordPolicy('A!' + 'x'.repeat(2000), ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too_long')
  })

  it('reports each check independently, for a form that highlights what is missing', () => {
    expect(passwordChecks('abc')).toEqual({ too_short: true, no_uppercase: true, no_symbol: true })
    expect(passwordChecks('Abcdefg!')).toEqual({ too_short: false, no_uppercase: false, no_symbol: false })
  })
})
