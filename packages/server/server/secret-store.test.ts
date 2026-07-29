import { describe, expect, it } from 'bun:test'
import { validateSecret } from './secret-store'

describe('validateSecret', () => {
  it('rejects an unset secret', () => {
    const v = validateSecret(undefined, 'hunter2hunter2')
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('secret_missing')
  })

  it('rejects a secret equal to the dashboard password', () => {
    const shared = 'hunter2hunter2hunter2hunter2hunt'
    const v = validateSecret(shared, shared)
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('secret_equals_password')
  })

  it('rejects a secret shorter than 32 characters', () => {
    const v = validateSecret('short', undefined)
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('secret_too_short')
  })

  it('accepts a long, distinct secret', () => {
    expect(validateSecret('f'.repeat(64), 'some-password').ok).toBe(true)
  })

  it('accepts a long secret when no password is configured at all', () => {
    expect(validateSecret('f'.repeat(32), undefined).ok).toBe(true)
  })
})
