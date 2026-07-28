import { describe, expect, it } from 'bun:test'
import { validatePasswordPolicy, PASSWORD_MIN_LENGTH } from './password-policy'

describe('validatePasswordPolicy', () => {
  it('requires at least 12 characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12)
    expect(validatePasswordPolicy('short1234', {}).ok).toBe(false)
    expect(validatePasswordPolicy('a-perfectly-fine-passphrase', {}).ok).toBe(true)
  })

  it('rejects a password on the common list regardless of length', () => {
    expect(validatePasswordPolicy('password123456', {}).ok).toBe(false)
    expect(validatePasswordPolicy('qwertyuiop1234', {}).ok).toBe(false)
  })

  it('rejects a common password with a couple of characters tacked on', () => {
    expect(validatePasswordPolicy('password123456!!', {}).ok).toBe(false)
  })

  it('rejects a password containing the local part of the email', () => {
    expect(validatePasswordPolicy('vinicius-super-secret', { email: 'vinicius@example.com' }).ok).toBe(false)
  })

  it('rejects a password containing the account name, case-insensitively', () => {
    expect(validatePasswordPolicy('Agentistics-central-2026', { name: 'agentistics' }).ok).toBe(false)
  })

  it('ignores a name or email fragment too short to be meaningful', () => {
    expect(validatePasswordPolicy('correct-horse-battery', { name: 'Al', email: 'al@x.io' }).ok).toBe(true)
  })

  it('rejects a single repeated character', () => {
    expect(validatePasswordPolicy('aaaaaaaaaaaaaaaa', {}).ok).toBe(false)
  })

  it('accepts a long random passphrase', () => {
    expect(validatePasswordPolicy('correct horse battery staple 42', { email: 'x@y.z', name: 'X' }).ok).toBe(true)
  })

  it('rejects an over-long password (argon2 CPU-exhaustion guard)', () => {
    expect(validatePasswordPolicy('x'.repeat(1025), {}).ok).toBe(false)
  })

  it('explains why it rejected', () => {
    const v = validatePasswordPolicy('short', {})
    expect(v.ok === false && v.error).toContain('12 characters')
  })
})
