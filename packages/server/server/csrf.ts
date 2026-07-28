/**
 * csrf.ts — origin verification for state-changing requests.
 *
 * The session cookie is SameSite=Strict, which already prevents a cross-site POST from carrying
 * it. This module is the second line: it rejects any unsafe method that arrives with a session
 * cookie but cannot prove same-origin provenance — covering a browser that mishandles Strict and
 * any future regression that loosens the cookie.
 *
 * Non-browser clients (agentop member push, ci-push, MCP) authenticate with a Bearer token and
 * send no cookie. They are exempt, because CSRF is by definition a cookie-riding attack.
 */
import { originAllowed } from './cors'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

export function csrfVerdict(input: {
  method: string
  origin: string | null
  secFetchSite: string | null
  host: string
  hasCookie: boolean
  allowlist: string[]
  dev: boolean
}): { ok: true } | { ok: false; reason: string } {
  if (SAFE.has(input.method.toUpperCase())) return { ok: true }
  if (!input.hasCookie) return { ok: true } // token-authenticated, non-browser

  const site = input.secFetchSite
  if (site === 'cross-site') {
    // A modern browser told us this is cross-site. Only an explicit allowlist entry may pass.
    return originAllowed(input.origin, input.allowlist, input.dev)
      ? { ok: true }
      : { ok: false, reason: 'cross_site' }
  }
  if (site === 'same-origin' || site === 'same-site' || site === 'none') return { ok: true }

  // No Sec-Fetch-Site (older browser / non-fetch client). Fall back to Origin.
  if (!input.origin) return { ok: false, reason: 'missing_origin' }
  if (input.origin === `https://${input.host}` || input.origin === `http://${input.host}`) return { ok: true }
  return originAllowed(input.origin, input.allowlist, input.dev)
    ? { ok: true }
    : { ok: false, reason: 'origin_mismatch' }
}
