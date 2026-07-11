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

import { listMembers, mintToken, revokeToken, rotateToken } from './team-tokens'
import { registerRepo, listRepos, unregisterRepo } from './team-repos'
import { getTeamCollection } from './mongo'

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
    const [members, presence] = await Promise.all([
      listMembers(),
      import('./team-presence').then(m => m.computePresence()).catch(() => ({} as Record<string, { online: boolean; latencyMs: number | null }>)),
    ])
    const enriched = members.map(m => {
      const p = presence[m.user]
      return { ...m, online: p?.online ?? false, latencyMs: p?.latencyMs ?? null }
    })
    return new Response(JSON.stringify({ members: enriched }), {
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
    const deleted = await revokeToken(id)
    // Cascade: remove the member's stored sessions too, so revoking a member also
    // removes them from the dashboard (their memberId == the token's hash id).
    let sessionsDeleted = 0
    try {
      const col = await getTeamCollection()
      const res = await col.deleteMany({ memberId: id })
      sessionsDeleted = res.deletedCount ?? 0
      const { deleteMemberStats } = await import('./team-stats')
      await deleteMemberStats(id)
      const { deleteMemberWorkflows } = await import('./team-workflows')
      await deleteMemberWorkflows(id)
    } catch { /* session cleanup is best-effort; the token is already revoked */ }
    return new Response(JSON.stringify({ ok: deleted, sessionsDeleted }), {
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
// POST /api/team/tokens/rotate  → { token: string }
// ---------------------------------------------------------------------------

/**
 * Rotate a member's token by its hash id. Mints a fresh token and migrates the
 * member's history (sessions + stats) to the new identity key.
 * Body: { id: string }  — `id` is the SHA-256 hash of the current token.
 * Response: { token: string }  — the new plaintext token; store it now, it is not saved.
 * Returns 404 { error: 'not found' } if no token with that id exists.
 */
export async function handleRotateToken(req: Request): Promise<Response> {
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
    const token = await rotateToken(id)
    if (token === null) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: JSON_CT,
      })
    }
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
// Repositories — GitHub Actions registration (central admin only)
// ---------------------------------------------------------------------------

/** GET /api/team/repos → { repos: RepoInfo[] } */
export async function handleListRepos(_req: Request): Promise<Response> {
  try {
    const repos = await listRepos()
    return new Response(JSON.stringify({ repos }), { status: 200, headers: JSON_CT })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: JSON_CT })
  }
}

/**
 * POST /api/team/repos — register a repository and mint its CI ingest token.
 * Body: { url: string, name?: string }  — `url` is any git remote form (https/ssh/scp).
 * Response: { token: string, remote: string } — the token is shown once; store it as the
 * repo's GitHub Actions secret. Re-registering an existing repo rotates its token.
 */
export async function handleRegisterRepo(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), { status: 400, headers: JSON_CT })
  }
  const raw = body as Record<string, unknown>
  const url = typeof raw?.url === 'string' ? raw.url.trim() : ''
  const name = typeof raw?.name === 'string' ? raw.name.trim() : undefined
  if (!url) {
    return new Response(JSON.stringify({ error: 'url required' }), { status: 400, headers: JSON_CT })
  }
  try {
    const result = await registerRepo(url, name)
    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), { status: 400, headers: JSON_CT })
    }
    return new Response(JSON.stringify({ token: result.token, remote: result.remote }), { status: 200, headers: JSON_CT })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: JSON_CT })
  }
}

/**
 * DELETE /api/team/repos — unregister a repository (revokes its CI token + CI sessions).
 * Body: { remote: string }  — any remote form; normalized server-side.
 * Response: { ok: boolean }
 */
export async function handleUnregisterRepo(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), { status: 400, headers: JSON_CT })
  }
  const raw = body as Record<string, unknown>
  const remote = typeof raw?.remote === 'string' ? raw.remote.trim() : ''
  if (!remote) {
    return new Response(JSON.stringify({ error: 'remote required' }), { status: 400, headers: JSON_CT })
  }
  try {
    const ok = await unregisterRepo(remote)
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 404, headers: JSON_CT })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: JSON_CT })
  }
}
