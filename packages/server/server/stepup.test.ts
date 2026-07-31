/**
 * stepup.test.ts — the "prove it's still you" grant required by destructive operations.
 *
 * The route table matters as much as the crypto: an operation that can destroy an account or
 * mint a credential must be listed, and a read of the same resource must not be.
 */
import { describe, expect, it } from 'bun:test'
import { signStepUp, verifyStepUp, requiresStepUp, stepUpRequiresCode, proveStepUp, STEPUP_TTL_MS } from './stepup'
import type { StepUpVerifiers } from './stepup'
import { signPrincipalSession } from './auth'

const SECRET = 'a-test-secret-at-least-32-chars!!'
const NOW = 1_700_000_000_000

describe('requiresStepUp', () => {
  it('demands it for account and team deletion', () => {
    expect(requiresStepUp('DELETE', '/api/iam/accounts')).toBe(true)
    expect(requiresStepUp('DELETE', '/api/iam/teams')).toBe(true)
  })

  it('demands it for anything that mints or rotates a credential', () => {
    expect(requiresStepUp('POST', '/api/team/tokens')).toBe(true)
    expect(requiresStepUp('POST', '/api/team/tokens/rotate')).toBe(true)
    expect(requiresStepUp('DELETE', '/api/team/tokens')).toBe(true)
    // Registering a repo mints a repo-bound CI token as a side effect.
    expect(requiresStepUp('POST', '/api/team/repos')).toBe(true)
  })

  it('covers the machines route, which mints/rotates/revokes the SAME token as /api/team/tokens', () => {
    // POST mints a machine token (and rotates one via { rotateId }); DELETE revokes it. Both write
    // the same `tokens` collection as the sibling route above, so leaving them ungated made the
    // gate on that sibling a formality — a stolen cookie just used this door instead.
    expect(requiresStepUp('POST', '/api/iam/machines')).toBe(true)
    expect(requiresStepUp('DELETE', '/api/iam/machines')).toBe(true)
    expect(requiresStepUp('GET', '/api/iam/machines')).toBe(false)
  })

  it('demands it when an account is edited, since that includes role and memberships', () => {
    expect(requiresStepUp('PATCH', '/api/iam/accounts')).toBe(true)
  })

  it('does not demand it for CREATING a team — nothing is destroyed and nobody is granted anything', () => {
    // An empty team is a label; membership is an account edit, which IS gated (below). A prompt
    // here trains people to type their password on sight, devaluing the prompts that matter.
    expect(requiresStepUp('POST', '/api/iam/teams')).toBe(false)
    expect(requiresStepUp('PATCH', '/api/iam/accounts')).toBe(true)
  })

  it('does not demand it for reads', () => {
    expect(requiresStepUp('GET', '/api/iam/accounts')).toBe(false)
    expect(requiresStepUp('GET', '/api/team/tokens')).toBe(false)
    expect(requiresStepUp('GET', '/api/team/repos')).toBe(false)
  })

  it('does not demand it for ordinary data or tag traffic', () => {
    expect(requiresStepUp('GET', '/api/data')).toBe(false)
    expect(requiresStepUp('POST', '/api/tags')).toBe(false)
    expect(requiresStepUp('PUT', '/api/preferences')).toBe(false)
  })

  it('covers nested detail routes under a protected path', () => {
    expect(requiresStepUp('DELETE', '/api/team/repos/github.com%2Forg%2Frepo')).toBe(true)
    expect(requiresStepUp('DELETE', '/api/iam/accounts/abc123')).toBe(true)
  })

  it('is not fooled by a path that merely shares a prefix', () => {
    expect(requiresStepUp('DELETE', '/api/team/tokensearch')).toBe(false)
  })
})

describe('signStepUp + verifyStepUp', () => {
  it('round-trips within its TTL', () => {
    const t = signStepUp('acc1', 3, SECRET, NOW + STEPUP_TTL_MS)
    expect(verifyStepUp(t, 'acc1', 3, SECRET, NOW)).toBe(true)
  })

  it('expires', () => {
    const t = signStepUp('acc1', 3, SECRET, NOW + 1000)
    expect(verifyStepUp(t, 'acc1', 3, SECRET, NOW + 1001)).toBe(false)
  })

  it('is bound to the account — another account cannot present it', () => {
    const t = signStepUp('acc1', 3, SECRET, NOW + STEPUP_TTL_MS)
    expect(verifyStepUp(t, 'acc2', 3, SECRET, NOW)).toBe(false)
  })

  it('dies with the session generation, so a password change revokes it', () => {
    const t = signStepUp('acc1', 3, SECRET, NOW + STEPUP_TTL_MS)
    expect(verifyStepUp(t, 'acc1', 4, SECRET, NOW)).toBe(false)
  })

  it('rejects tampering, a wrong secret, and junk', () => {
    const t = signStepUp('acc1', 3, SECRET, NOW + STEPUP_TTL_MS)
    expect(verifyStepUp(t.replace('acc1', 'acc9'), 'acc9', 3, SECRET, NOW)).toBe(false)
    expect(verifyStepUp(t, 'acc1', 3, 'other-secret-at-least-32-chars!!', NOW)).toBe(false)
    expect(verifyStepUp('garbage', 'acc1', 3, SECRET, NOW)).toBe(false)
    expect(verifyStepUp(undefined, 'acc1', 3, SECRET, NOW)).toBe(false)
  })

  it('cannot be forged from a session cookie, which is signed over a similar payload', () => {
    const session = signPrincipalSession(NOW + 60_000, 'acc1', 3, SECRET, NOW)
    expect(verifyStepUp(session, 'acc1', 3, SECRET, NOW)).toBe(false)
  })

  it('grants a short window — long enough to act, short enough not to be a second session', () => {
    expect(STEPUP_TTL_MS).toBeLessThanOrEqual(10 * 60 * 1000)
  })
})

describe('stepUpRequiresCode', () => {
  it('demands the second factor once it is enrolled — a password alone is no longer enough', () => {
    expect(stepUpRequiresCode(true)).toBe(true)
  })

  it('accepts the password when no second factor is enrolled — enrolment stays optional', () => {
    expect(stepUpRequiresCode(false)).toBe(false)
  })
})

/**
 * proveStepUp is where the whole risk of the second-factor rule lives: which credential is even
 * CONSULTED. The verifiers are injected, so every case below is exercised against the real
 * decision, with no database and no clock.
 */
describe('proveStepUp', () => {
  const TOTP = '123456'
  const RECOVERY = 'aaaa-bbbb-cccc'

  /** Records what was asked, so "was the password even consulted?" is an assertable fact. */
  function verifiers(opts: { password?: string; totp?: string; recovery?: string[] } = {}) {
    const calls: string[] = []
    const remaining = new Set(opts.recovery ?? [])
    const v: StepUpVerifiers = {
      verifyPassword: async (p: string) => { calls.push('password'); return !!opts.password && p === opts.password },
      verifyTotp: (c: string) => { calls.push('totp'); return !!opts.totp && c === opts.totp },
      consumeRecoveryCode: async (c: string) => {
        calls.push('recovery')
        if (!remaining.has(c)) return false
        remaining.delete(c) // single-use: spent as it is consumed, exactly like the store
        return true
      },
    }
    return { v, calls, remaining }
  }

  it('refuses the correct password once a second factor is enrolled — and never even checks it', () => {
    // The scenario this exists for: a thief holding both the cookie and the password. If the
    // password were merely "also accepted", MFA would be decorative on this path.
    const { v, calls } = verifiers({ password: 'correct horse battery staple', totp: TOTP })
    return proveStepUp({ password: 'correct horse battery staple' }, true, v).then(r => {
      expect(r.ok).toBe(false)
      expect(r.factor).toBe(null)
      expect(calls).not.toContain('password')
    })
  })

  it('accepts a live authenticator code when enrolled, without spending a recovery code', async () => {
    const { v, calls } = verifiers({ totp: TOTP, recovery: [RECOVERY] })
    const r = await proveStepUp({ code: TOTP }, true, v)
    expect(r).toEqual({ ok: true, factor: 'totp' })
    expect(calls).not.toContain('recovery')
  })

  it('accepts a recovery code when the authenticator is gone — the alternative is a total lockout', async () => {
    // An enrolled owner who lost their phone can still LOG IN with a recovery code. Without this
    // they could then do nothing that matters: no password reset, no credential, not even
    // disabling MFA — an instance rescuable only with shell access to the central.
    const { v } = verifiers({ totp: TOTP, recovery: [RECOVERY] })
    const r = await proveStepUp({ code: RECOVERY }, true, v)
    expect(r).toEqual({ ok: true, factor: 'recovery' })
  })

  it('spends a recovery code exactly once — a replay of the same code fails', async () => {
    const { v, remaining } = verifiers({ totp: TOTP, recovery: [RECOVERY] })
    expect((await proveStepUp({ code: RECOVERY }, true, v)).ok).toBe(true)
    expect(remaining.size).toBe(0)
    const replay = await proveStepUp({ code: RECOVERY }, true, v)
    expect(replay).toEqual({ ok: false, factor: null })
  })

  it('refuses an empty code when enrolled, and asks nothing of the store', async () => {
    const { v, calls } = verifiers({ password: 'pw', totp: TOTP, recovery: [RECOVERY] })
    const r = await proveStepUp({ code: '', password: 'pw' }, true, v)
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('takes the password when NO second factor is enrolled — enrolment stays optional', async () => {
    const { v } = verifiers({ password: 'pw' })
    expect(await proveStepUp({ password: 'pw' }, false, v)).toEqual({ ok: true, factor: 'password' })
    expect(await proveStepUp({ password: 'nope' }, false, v)).toEqual({ ok: false, factor: null })
    expect(await proveStepUp({ password: '' }, false, v)).toEqual({ ok: false, factor: null })
  })

  it('never accepts a code as a substitute for the password when nothing is enrolled', async () => {
    // There is no secret to check it against; accepting one would mean accepting anything.
    const { v } = verifiers({ password: 'pw', totp: TOTP })
    expect(await proveStepUp({ code: TOTP }, false, v)).toEqual({ ok: false, factor: null })
  })
})
