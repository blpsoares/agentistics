/**
 * team-admin.ts — Admin route handlers for Team Mode Phase 3.
 *
 * Exposes: handleMembers / handleMintToken / handleRevokeToken.
 *
 * IMPORTANT: These handlers assume the caller (index.ts) has already verified
 * that the request is authenticated via isAuthed(). They do NOT re-check auth.
 *
 * The caller in index.ts spreads CORS_HEADERS over the returned Response, so
 * each handler sets Content-Type only.
 */

import { listMembers, mintToken, revokeToken } from './team-tokens'

const JSON_CT = { 'Content-Type': 'application/json' } as const

// ---------------------------------------------------------------------------
// GET /api/team/members
// ---------------------------------------------------------------------------

/**
 * Return all minted tokens as safe member records (no plaintext tokens).
 * Response: { members: MemberInfo[] }
 */
export async function handleMembers(_req: Request): Promise<Response> {
  try {
    const members = await listMembers()
    return new Response(JSON.stringify({ members }), {
      status: 200,
      headers: JSON_CT,
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: JSON_CT },
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/team/tokens  → { token: string }
// ---------------------------------------------------------------------------

/**
 * Mint a new ingest token. Returns the plaintext token once.
 * Body: { user: string; label: string }
 * Response: { token: string }  — store it now; it is not saved server-side.
 */
export async function handleMintToken(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), {
      status: 400,
      headers: JSON_CT,
    })
  }

  const raw = body as Record<string, unknown>
  const user = typeof raw?.user === 'string' ? raw.user.trim() : ''
  const label = typeof raw?.label === 'string' ? raw.label.trim() : ''

  if (!user) {
    return new Response(JSON.stringify({ error: 'user required' }), {
      status: 400,
      headers: JSON_CT,
    })
  }
  if (!label) {
    return new Response(JSON.stringify({ error: 'label required' }), {
      status: 400,
      headers: JSON_CT,
    })
  }

  try {
    const token = await mintToken(user, label)
    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: JSON_CT,
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: JSON_CT },
    )
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/team/tokens  → { ok: true }
// ---------------------------------------------------------------------------

/**
 * Revoke a token by its hash id.
 * Body: { id: string }  — `id` is the SHA-256 hash, safe to transmit.
 * Response: { ok: true }
 */
export async function handleRevokeToken(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), {
      status: 400,
      headers: JSON_CT,
    })
  }

  const raw = body as Record<string, unknown>
  const id = typeof raw?.id === 'string' ? raw.id.trim() : ''

  if (!id) {
    return new Response(JSON.stringify({ error: 'id required' }), {
      status: 400,
      headers: JSON_CT,
    })
  }

  try {
    await revokeToken(id)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: JSON_CT,
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: JSON_CT },
    )
  }
}
