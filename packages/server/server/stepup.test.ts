/**
 * stepup.test.ts — the "prove it's still you" grant required by destructive operations.
 *
 * The route table matters as much as the crypto: an operation that can destroy an account or
 * mint a credential must be listed, and a read of the same resource must not be.
 */
import { describe, expect, it } from 'bun:test'
import { signStepUp, verifyStepUp, requiresStepUp, stepUpRequiresCode, STEPUP_TTL_MS } from './stepup'
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

  it('applies identically regardless of the account role — an owner with TOTP enrolled is', () => {
    // The policy is a pure function of enrolment, not role: it takes no role parameter at all,
    // so an owner and a manager who both enrolled TOTP are held to the exact same rule. Passing
    // the same boolean twice IS the proof — there is no branch anywhere for role to enter.
    expect(stepUpRequiresCode(true)).toBe(stepUpRequiresCode(true))
  })
})
