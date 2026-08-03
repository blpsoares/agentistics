/**
 * stepup.ts — re-authentication for destructive operations ("sudo mode").
 *
 * A session cookie proves who you are; it does not prove you are still at the keyboard. Without
 * this, a stolen cookie inside its 12-hour idle window could promote itself to owner or change the
 * account's password with no further proof. Requiring a fresh password or TOTP for those
 * operations does not prevent the theft — it bounds what the theft is worth.
 *
 * The grant is a short-lived HMAC token, bound to the account AND its session generation, so a
 * password change or a logout-all revokes any outstanding grant along with the session. It is
 * domain-separated from session cookies and MFA challenges: the three are signed with the same
 * key over similar payloads, and only the domain prefix stops one being replayed as another.
 *
 * Delivered in the `X-Stepup` header rather than a cookie, deliberately: a cookie would ride
 * along automatically on every request, which is exactly the property we are trying not to have.
 */
import { createHmac } from 'node:crypto'
import { constantTimeEqual } from './auth'

/** Long enough to finish an admin task, short enough not to be a second session. */
export const STEPUP_TTL_MS = 5 * 60 * 1000
export const STEPUP_HEADER = 'x-stepup'
const DOMAIN = 'stepup-grant'

/**
 * WHERE THE SECOND FACTOR IS DEMANDED — three operations, and the reasoning for each.
 *
 * The list is short on purpose. A prompt people meet on routine work is a prompt they learn to
 * clear without reading, and that habit is paid for by every OTHER prompt. So this gates the two
 * things a stolen cookie could turn into permanent access, and nothing else.
 *
 * - **Accounts (POST / PATCH / DELETE)** — role and team membership are assigned here, so this is
 *   where a session becomes an owner. Gating the DELETE of an owner while leaving BECOMING one
 *   open is not a boundary; an account IS a credential, and a quiet extra owner is exactly the
 *   escalation this exists to bound.
 * - **Teams (DELETE)** — it destroys data. CREATING one is deliberately absent: an empty team is a
 *   label until an account is put in it, and putting one in goes through the account PATCH above.
 * - **Changing a password (POST)** — it is the credential every session rests on, and it accepted
 *   the current password alone, which a thief holding the browser profile usually also has. This
 *   is the one place enrolled MFA turns "cookie plus password" back into nothing. The forced
 *   first-login change goes through the same gate and is proven with the temporary password the
 *   user just signed in with; `App.tsx` mounts the step-up prompt on that screen for that reason.
 *
 * DELIBERATELY NOT HERE, after review: `/api/iam/machines`, `/api/team/tokens`,
 * `/api/team/tokens/rotate` and `/api/team/repos`. Enrolling a machine or a repository is routine
 * work on a growing fleet — daily, expected, and reversible by revoking the token it minted. The
 * prompt bought little and cost a lot of friction. What a machine token can reach is bounded by
 * the account it belongs to, and moving an account between roles or teams is still gated above.
 *
 * Read methods are absent throughout: the point is to gate the damage, not the dashboard.
 * `stepup.test.ts` asserts this table EXACTLY, so re-adding a path fails a test rather than
 * quietly costing every user a prompt.
 */
export const PROTECTED: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ['/api/iam/accounts', ['POST', 'PATCH', 'DELETE']],
  ['/api/iam/teams', ['DELETE']],
  ['/api/iam/change-password', ['POST']],
]

/**
 * Whether a step-up attempt must present the second factor rather than the password.
 *
 * A cookie thief who also captured the password (the common case — password managers and
 * cookies both live in the same browser profile) would otherwise sail through step-up on the
 * password alone, exactly as if MFA did not exist. Once an account has enrolled a second factor,
 * step-up MUST be proven with it — for a manager and an owner alike, since both can now reset
 * somebody else's password through this same grant. This never makes enrolment itself mandatory:
 * an account with no second factor still steps up on its password, same as before.
 */
export function stepUpRequiresCode(mfaEnrolled: boolean): boolean {
  return mfaEnrolled
}

/** Which credential actually proved the attempt. `null` when none did. */
export type StepUpFactor = 'password' | 'totp' | 'recovery'

/**
 * The credential checks, injected: the decision below is about WHICH of them may be consulted,
 * and that is the part worth testing without a database, a clock or a live TOTP secret.
 */
export interface StepUpVerifiers {
  verifyPassword(password: string): Promise<boolean>
  verifyTotp(code: string): boolean
  /** Single-use — spends the code when it matches, exactly as the store does. */
  consumeRecoveryCode(code: string): Promise<boolean>
}

export interface StepUpResult {
  ok: boolean
  factor: StepUpFactor | null
}

/**
 * Decides a step-up attempt.
 *
 * Enrolled: the second factor is the ONLY thing consulted — the password is not merely rejected,
 * it is never checked, which is what makes "a stolen cookie plus a stolen password" worthless
 * here. The factor may be a live authenticator code OR one of the single-use recovery codes,
 * the same pair login accepts: an owner who lost their phone can already sign in with a recovery
 * code, and refusing it here would leave them signed in and unable to do anything that matters —
 * no password reset, no credential, not even disabling MFA — with shell access to the central as
 * the only way back.
 *
 * Not enrolled: the password, and nothing else. There is no secret a code could be checked
 * against, so accepting one would be accepting anything.
 */
export async function proveStepUp(
  attempt: { password?: string; code?: string },
  mfaEnrolled: boolean,
  v: StepUpVerifiers,
): Promise<StepUpResult> {
  const code = (attempt.code ?? '').trim()
  if (stepUpRequiresCode(mfaEnrolled)) {
    if (!code) return { ok: false, factor: null }
    if (v.verifyTotp(code)) return { ok: true, factor: 'totp' }
    if (await v.consumeRecoveryCode(code)) return { ok: true, factor: 'recovery' }
    return { ok: false, factor: null }
  }
  const password = attempt.password ?? ''
  if (!password) return { ok: false, factor: null }
  return (await v.verifyPassword(password)) ? { ok: true, factor: 'password' } : { ok: false, factor: null }
}

export function requiresStepUp(method: string, pathname: string): boolean {
  const m = method.toUpperCase()
  for (const [prefix, methods] of PROTECTED) {
    const matches = pathname === prefix || pathname.startsWith(prefix + '/')
    if (matches && methods.includes(m)) return true
  }
  return false
}

export function signStepUp(
  accountId: string,
  sessionVersion: number,
  secret: string,
  expiryMs: number,
): string {
  const payload = `${expiryMs}.${accountId}.${sessionVersion}`
  const mac = createHmac('sha256', secret).update(`${DOMAIN}.${payload}`).digest('hex')
  return `${payload}.${mac}`
}

export function verifyStepUp(
  value: string | undefined | null,
  accountId: string,
  sessionVersion: number,
  secret: string,
  nowMs: number,
): boolean {
  if (!value) return false
  const lastDot = value.lastIndexOf('.')
  if (lastDot === -1) return false
  const payload = value.slice(0, lastDot)
  const mac = value.slice(lastDot + 1)
  const expected = createHmac('sha256', secret).update(`${DOMAIN}.${payload}`).digest('hex')
  if (!constantTimeEqual(mac, expected)) return false
  const parts = payload.split('.')
  if (parts.length !== 3) return false
  const expiry = parseInt(parts[0]!, 10)
  if (isNaN(expiry) || expiry <= nowMs) return false
  // Bound to the presenting identity: a grant is not transferable, and it dies with the
  // session generation it was minted under.
  if (parts[1] !== accountId) return false
  if (parseInt(parts[2]!, 10) !== sessionVersion) return false
  return true
}
