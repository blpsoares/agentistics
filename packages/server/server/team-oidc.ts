/**
 * team-oidc.ts — keyless CI auth via GitHub Actions OIDC.
 *
 * Instead of a long-lived static secret, a GitHub Actions runner requests a short-lived JWT that
 * GitHub itself signs, carrying the exact `repository` it ran in. The central verifies that JWT
 * against GitHub's public JWKS (issuer + audience + expiry) and trusts the `repository` claim —
 * so CI attribution is cryptographically authentic and nothing secret is ever stored or can leak.
 *
 * The JWT signature/JWKS verification is delegated to `jose` (audited; handles key-set caching and
 * rotation). The claim-shaping and cheap format checks are pure and unit-tested here.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose'
import { OIDC_ISSUER, OIDC_AUDIENCE } from './config'

export interface CiOidcClaims {
  repository: string          // 'org/repo'
  repositoryOwner?: string
  ref?: string
  sha?: string
  workflow?: string
  runId?: string
  actor?: string
}

/** Stable session-owner id for a repository's CI runs (OIDC or repo-token). Pure. */
export function ciMemberId(remote: string): string {
  return `repo:${remote}`
}

/** Cheap format gate: does a bearer look like a JWT (three non-empty base64url segments)? Pure.
 *  Our static ingest tokens are hex (no dots), so this cleanly distinguishes the two auth paths. */
export function looksLikeJwt(bearer: string | null | undefined): boolean {
  if (!bearer) return false
  const parts = bearer.split('.')
  return parts.length === 3 && parts.every(p => p.length > 0)
}

/** Extract + shallow-validate the CI claims we rely on. Returns null if the required
 *  `repository` claim (`org/repo`) is absent/malformed. Pure — testable without network. */
export function pickCiClaims(payload: Record<string, unknown>): CiOidcClaims | null {
  const repository = typeof payload.repository === 'string' ? payload.repository.trim() : ''
  // Must be exactly owner/repo (one slash) — guards against odd/spoofed shapes.
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) return null
  const str = (k: string) => (typeof payload[k] === 'string' ? (payload[k] as string) : undefined)
  return {
    repository,
    repositoryOwner: str('repository_owner'),
    ref: str('ref'),
    sha: str('sha'),
    workflow: str('workflow'),
    runId: str('run_id'),
    actor: str('actor'),
  }
}

// Lazily created remote JWKS — jose caches the key set in-memory and refetches on an unknown
// `kid`, so GitHub's periodic key rotation is handled transparently.
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function jwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`))
  return _jwks
}

/** True when keyless OIDC ingest is configured (an audience is required to enable it). */
export function oidcEnabled(): boolean {
  return !!OIDC_AUDIENCE
}

/**
 * Verify a GitHub Actions OIDC token. Fails closed on any problem (bad signature, wrong
 * issuer/audience, expired, missing repository). Returns the trusted claims on success.
 */
export async function verifyCiOidc(
  token: string,
): Promise<{ ok: true; claims: CiOidcClaims } | { ok: false; error: string }> {
  if (!OIDC_AUDIENCE) return { ok: false, error: 'oidc disabled' }
  try {
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: OIDC_ISSUER,
      audience: OIDC_AUDIENCE,
      clockTolerance: 30, // seconds of leeway for runner/central clock skew
    })
    const claims = pickCiClaims(payload as Record<string, unknown>)
    if (!claims) return { ok: false, error: 'missing or malformed repository claim' }
    return { ok: true, claims }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
