/**
 * stepup.ts — re-authentication for destructive operations ("sudo mode").
 *
 * A session cookie proves who you are; it does not prove you are still at the keyboard. Without
 * this, a stolen cookie inside its 12-hour idle window could delete accounts and mint machine
 * tokens with no further proof. Requiring a fresh password or TOTP for those operations does not
 * prevent the theft — it bounds what the theft is worth.
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
 * Operations that destroy data or mint a credential. Read methods on the same paths are absent
 * on purpose — the point is to gate the damage, not to make the dashboard tiresome.
 *
 * PATCH on an account is included because that is where role and team memberships are edited:
 * promoting an account is as dangerous as deleting one. POST on an account is included because
 * an account IS a credential — a quiet extra owner is the escalation this exists to bound.
 *
 * CREATING a team is deliberately NOT here. It destroys nothing and grants nobody anything: an
 * empty team is a label until an account is put in it, and putting one in goes through the
 * account PATCH above, which is gated. Asking for the password to name a team is the kind of
 * prompt that teaches people to type their password without reading why — which makes every
 * OTHER prompt weaker. Gate the damage, not the paperwork.
 */
const PROTECTED: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ['/api/iam/accounts', ['POST', 'PATCH', 'DELETE']],
  ['/api/iam/teams', ['DELETE']],
  ['/api/team/tokens', ['POST', 'DELETE']],
  ['/api/team/tokens/rotate', ['POST']],
  ['/api/team/repos', ['POST', 'DELETE']],
]

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
