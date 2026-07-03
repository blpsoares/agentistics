import type { SessionMeta } from '@agentistics/core'
import { getTeamCollection } from './mongo'
import { parseIngestBody, toTeamDoc } from './team-store'
import { TEAM_INGEST_TOKEN, TEAM_PASSWORD } from './config'
import { validateIngestToken, hasAnyTokens } from './team-tokens'
import { constantTimeEqual } from './auth'

// CORS headers are defined in index.ts; this module returns plain JSON and the
// caller in index.ts spreads CORS_HEADERS, so we only set Content-Type here.
const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * Upsert every session as a team doc keyed by org:memberId:harness:sessionId.
 * Idempotent: re-posting an identical session is a no-op write. Returns count.
 *
 * @param memberId - Stable member identity key (token hash from `validateIngestToken`,
 *   or `legacy:<user>` for unauthenticated ingests which cannot benefit from rename-safety).
 * @param user - Display name cached in the doc; read-time resolution via getMemberNameMap()
 *   always takes precedence for minted-token members.
 */
export async function ingestSessions(org: string, memberId: string, user: string, sessions: SessionMeta[]): Promise<number> {
  if (sessions.length === 0) return 0
  const col = await getTeamCollection()
  const ops = sessions.map(s => {
    const doc = toTeamDoc(s, org, memberId, user)
    return { replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }
  })
  await col.bulkWrite(ops, { ordered: false })
  return ops.length
}

/** Route handler for POST /api/team/ingest.
 *
 *  Authorization order (Phase 3):
 *  1. Bearer matches a minted token in Mongo → authorized (lastSeenAt updated).
 *  2. Legacy TEAM_INGEST_TOKEN set AND bearer matches (constant-time) → authorized.
 *  3. Open fallback (Phase-2a behavior): no TEAM_PASSWORD, no TEAM_INGEST_TOKEN, and
 *     no minted tokens in DB → authorized (open, as Phase 2a).
 *  4. Otherwise → 401.
 */
export async function handleTeamIngest(req: Request): Promise<Response> {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  // 1. Try minted token lookup (hashes bearer, looks up in Mongo, updates lastSeenAt).
  //    The token's memberId (hash) + user are AUTHORITATIVE — sessions are keyed by the
  //    stable memberId, and the authoritative user name prevents one member impersonating
  //    another. Renaming via PUT /api/team/members updates only the token doc; session
  //    docs are resolved at read time by getMemberNameMap(), so no re-ingest is needed.
  const mintedResult = await validateIngestToken(bearer)
  if (mintedResult.ok) {
    return handleIngestBody(req, mintedResult.memberId, mintedResult.user)
  }

  // 2. Legacy shared-secret fallback (constant-time compare).
  if (TEAM_INGEST_TOKEN && bearer !== null && constantTimeEqual(bearer, TEAM_INGEST_TOKEN)) {
    return handleIngestBody(req)
  }

  // 3. Phase-2a open fallback: no auth mechanism configured at all.
  //    Open only when: no password gate, no legacy token, AND no minted tokens in DB.
  if (!TEAM_PASSWORD && !TEAM_INGEST_TOKEN) {
    try {
      const hasTokens = await hasAnyTokens()
      if (!hasTokens) {
        return handleIngestBody(req)
      }
    } catch {
      // If Mongo is unreachable for the count check, fall through to 401 (safe default).
    }
  }

  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: JSON_HEADERS,
  })
}

/** Route handler for POST /api/team/leave — a member removes ITS OWN data from the central.
 *
 *  Auth mirrors ingest:
 *  1. Minted token → delete by the stable memberId (authoritative — a member can only ever
 *     delete its own sessions, regardless of what the body claims).
 *  2. Legacy shared secret OR open fallback → delete by the self-declared {org, user} from
 *     the body (shared-secret trust model: the caller already holds the shared token).
 */
export async function handleTeamLeave(req: Request): Promise<Response> {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  let body: { org?: unknown; user?: unknown } = {}
  try { body = (await req.json()) as { org?: unknown; user?: unknown } } catch { /* empty body ok */ }
  const col = await getTeamCollection()

  // 1. Minted token → memberId is authoritative.
  const { deleteMemberStats } = await import('./team-stats')
  const minted = await validateIngestToken(bearer)
  if (minted.ok) {
    const res = await col.deleteMany({ memberId: minted.memberId })
    await deleteMemberStats(minted.memberId)
    return new Response(JSON.stringify({ ok: true, deleted: res.deletedCount ?? 0 }), { status: 200, headers: JSON_HEADERS })
  }

  // 2. Legacy shared secret or open fallback → identify the member by {org, user}.
  const org = typeof body.org === 'string' ? body.org.trim() : ''
  const user = typeof body.user === 'string' ? body.user.trim() : ''
  const legacyAuthed = TEAM_INGEST_TOKEN && bearer !== null && constantTimeEqual(bearer, TEAM_INGEST_TOKEN)
  let open = false
  if (!TEAM_PASSWORD && !TEAM_INGEST_TOKEN) {
    try { open = !(await hasAnyTokens()) } catch { /* DB down → not open */ }
  }
  if (!legacyAuthed && !open) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS })
  }
  if (!org || !user) {
    return new Response(JSON.stringify({ error: 'org and user are required' }), { status: 400, headers: JSON_HEADERS })
  }
  const res = await col.deleteMany({ org, user })
  await deleteMemberStats(`legacy:${user}`)
  return new Response(JSON.stringify({ ok: true, deleted: res.deletedCount ?? 0 }), { status: 200, headers: JSON_HEADERS })
}

/**
 * Parse and upsert the ingest body after authorization has been verified.
 *
 * @param overrideMemberId - Stable token hash from `validateIngestToken`. When absent (legacy
 *   shared-secret or open fallback), a synthetic `legacy:<user>` memberId is used. Note:
 *   legacy sessions keyed by `legacy:<user>` cannot benefit from rename-safety — changing the
 *   self-declared user name in the uploader config creates a new identity in Mongo.
 * @param overrideUser - Authoritative display name from the minted token. When absent, the
 *   self-declared `body.user` is used (legacy/open paths only).
 */
async function handleIngestBody(req: Request, overrideMemberId?: string, overrideUser?: string): Promise<Response> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), { status: 400, headers: JSON_HEADERS })
  }
  const parsed = parseIngestBody(raw)
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: JSON_HEADERS })
  }
  try {
    const user = (overrideUser && overrideUser.trim()) || parsed.body.user
    // For legacy/open ingest (no minted token), use a synthetic memberId so the session
    // document is still structured consistently. These sessions cannot benefit from
    // rename-safety: a different self-declared user creates a new memberId → new docs.
    const memberId = overrideMemberId ?? `legacy:${user}`
    const count = await ingestSessions(parsed.body.org, memberId, user, parsed.body.sessions)
    // Store the member's own statsCache (aggregated Claude history) so the central can
    // reproduce its exact totals — the deep history is never present as individual sessions.
    if (parsed.body.statsCache) {
      const { upsertMemberStats } = await import('./team-stats')
      await upsertMemberStats(parsed.body.org, memberId, user, parsed.body.statsCache).catch(() => {})
    }
    // Real-time central: a member push changed the aggregate → nudge the central's dashboards
    // via SSE (debounced) so they refresh live, without the viewer polling. This is what makes
    // the "Live" toggle unnecessary on a central.
    try { (await import('./sse')).triggerSseNotification() } catch { /* best-effort */ }
    return new Response(JSON.stringify({ ok: true, count }), { status: 200, headers: JSON_HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: JSON_HEADERS })
  }
}
