import type { SessionMeta } from '@agentistics/core'
import { getTeamCollection } from './mongo'
import { parseIngestBody, toTeamDoc } from './team-store'
import { TEAM_INGEST_TOKEN, TEAM_PASSWORD } from './config'
import { validateIngestToken, hasAnyTokens } from './team-tokens'
import { constantTimeEqual } from './auth'

// CORS headers are defined in index.ts; this module returns plain JSON and the
// caller in index.ts spreads CORS_HEADERS, so we only set Content-Type here.
const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** Upsert every session as a team doc keyed by org:user:harness:sessionId.
 *  Idempotent: re-posting an identical session is a no-op write. Returns count. */
export async function ingestSessions(org: string, user: string, sessions: SessionMeta[]): Promise<number> {
  if (sessions.length === 0) return 0
  const col = await getTeamCollection()
  const ops = sessions.map(s => {
    const doc = toTeamDoc(s, org, user)
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
  //    The token's user is AUTHORITATIVE — sessions are attributed to it, ignoring the
  //    member's self-declared name. This keeps identity stable (renaming the local name
  //    never creates a duplicate user) and prevents one member impersonating another.
  const mintedResult = await validateIngestToken(bearer)
  if (mintedResult.ok) {
    return handleIngestBody(req, mintedResult.user)
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

/** Parse and upsert the ingest body after authorization has been verified.
 *  When `overrideUser` is provided (the user a minted token belongs to), it is used
 *  instead of the self-declared `body.user` so identity is authoritative. */
async function handleIngestBody(req: Request, overrideUser?: string): Promise<Response> {
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
    const count = await ingestSessions(parsed.body.org, user, parsed.body.sessions)
    return new Response(JSON.stringify({ ok: true, count }), { status: 200, headers: JSON_HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: JSON_HEADERS })
  }
}
