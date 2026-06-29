import type { SessionMeta } from '@agentistics/core'
import { getTeamCollection } from './mongo'
import { parseIngestBody, toTeamDoc } from './team-store'
import { TEAM_INGEST_TOKEN } from './config'

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

/** Route handler for POST /api/team/ingest. Validates an optional bearer token,
 *  parses the body, upserts, and returns { ok, count } or an error status. */
export async function handleTeamIngest(req: Request): Promise<Response> {
  // Optional shared-secret gate (Phase 3 replaces this with minted per-user tokens).
  if (TEAM_INGEST_TOKEN) {
    const auth = req.headers.get('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (token !== TEAM_INGEST_TOKEN) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS })
    }
  }
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
    const count = await ingestSessions(parsed.body.org, parsed.body.user, parsed.body.sessions)
    return new Response(JSON.stringify({ ok: true, count }), { status: 200, headers: JSON_HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: JSON_HEADERS })
  }
}
