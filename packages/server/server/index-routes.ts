/**
 * index-routes.ts — the route tables the auth gate in index.ts consults.
 *
 * Extracted so they can be unit-tested (authz-gate.test.ts) without importing index.ts, which
 * would boot the server. The gate is deny-by-default: every `/api/*` path on a central needs a
 * valid account session unless it appears in AUTH_PUBLIC, so adding a route to that Set is a
 * security decision and the test asserts the exact contents.
 */

/** Routes that must answer before the caller can possibly be authenticated. */
export const AUTH_PUBLIC = new Set([
  '/api/health',
  '/api/team/login',
  '/api/team/logout',
  '/api/team/session',
  // Machine/CI traffic: authenticated by Bearer token inside the handler, not by cookie.
  '/api/team/ingest',
  '/api/team/leave',
  '/api/team/forget',
  // Machine-to-machine, Bearer-authenticated inside the handler and scoped to the token's own
  // owner accounts. Returns repository KEYS and the caller's own machines' names — never a
  // session, never another account.
  '/api/team/account-repos',
  // The sealed-envelope channel: both Bearer-authenticated inside their handlers and scoped to the
  // token's owner accounts. `/keys` serves public keys only; `/envelopes` serves ciphertext the
  // central cannot open, scoped to the recipient the token proves.
  '/api/team/keys',
  '/api/team/envelopes',
  '/api/team/policy',
  '/api/team/whoami',
  '/api/team/agent',
  '/api/iam/status',
  '/api/iam/bootstrap',
  '/api/iam/login',
  // Forgot-password for an owner: proven with the second factor, so no session exists yet.
  '/api/iam/recover',
  // A member who cannot sign in asking to BE reset. Grants nothing, changes nothing, and
  // answers identically for an address that has no account.
  '/api/iam/reset-request',
  // Second login stage: the caller holds a challenge, not yet a session.
  '/api/iam/login/mfa',
  '/api/iam/logout',
  // Reports { authed: false } for an anonymous caller — the SPA's bootstrap probe.
  '/api/iam/me',
])

/**
 * Routes that require the instance owner.
 * `/api/tags` is deliberately absent — tags are readable by any authed principal and writable
 * by managers (authority is source-derived, see tags-handlers.ts). It is still gated: the auth
 * check 401s every `/api/*` path outside AUTH_PUBLIC, `/api/tags/<id>` included.
 */
export const ADMIN_PATHS = new Set([
  '/api/team/members',
  '/api/team/tokens',
  '/api/team/tokens/rotate',
  '/api/team/repos',
  '/api/team/config',
  '/api/iam/audit',
])

/**
 * ADMIN_PATHS is an exact-match Set, so a nested detail route (`/api/team/repos/<id>`) would
 * otherwise escape the owner gate the moment one is added. Treat any path *under* an admin
 * path as admin too — but only on a `/` boundary, so `/api/team/membersearch` is not swallowed.
 */
export function isAdminPath(pathname: string): boolean {
  if (ADMIN_PATHS.has(pathname)) return true
  for (const p of ADMIN_PATHS) if (pathname.startsWith(p + '/')) return true
  return false
}

/**
 * Routes an owner may still use while they have no second factor enrolled, on a profile that
 * demands one. Anything outside this set answers 403 mfa_enrollment_required, so the account
 * can finish enrolling (or sign out) and nothing else.
 */
export const MFA_EXEMPT = new Set([
  '/api/iam/me',
  '/api/iam/stepup',
  '/api/iam/logout',
  '/api/iam/mfa',
  '/api/iam/mfa/start',
  '/api/iam/mfa/enable',
  '/api/iam/mfa/recovery-codes',
  '/api/team/session',
  '/api/iam/status',
])
