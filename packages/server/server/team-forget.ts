/**
 * team-forget.ts — POST /api/team/forget (CENTRAL side): delete NAMED sessions of the
 * authenticated member.
 *
 * This is the retroactive half of per-connection repository rules. A member whose denylist grows
 * posts the ids it has already pushed and may no longer share; the central deletes exactly those
 * and their workflow runs, scoped to the memberId the TOKEN proves.
 *
 * MINTED TOKEN ONLY. No legacy `{org,user}` branch, no shared-secret path, no open fallback — and
 * that is not symmetry with `handleTeamLeave` being overlooked, it is a correction of it.
 * `handleTeamLeave` deletes by `memberId` on its minted branch and by `{org,user}` on its legacy
 * one and returns `{ok:true,deleted:N}` from BOTH, so a member cannot tell which identity acted;
 * on a central whose DB was wiped or restored, one machine's rules change would delete every
 * machine of the same person. A route that DELETES must never be reachable by an identity the
 * caller cannot prove.
 *
 * The `memberStats` document is deliberately NOT touched: the member replaces it in the same
 * cycle, which is what keeps `machineStatsCaches[memberId]` continuous and every other machine's
 * machine/team filter honest while this runs (§6.2). Deleting it here would reintroduce exactly
 * the window the scoped route exists to remove.
 *
 * Idempotent: deleting an unknown or already-deleted id is a no-op returning `deleted: 0`, which
 * is what makes the member's crash journal safely replayable.
 */
import { getTeamCollection } from './mongo'
import { validateIngestToken } from './team-tokens'
import { readJsonLimited, LIMITS } from './limits'
import { safeError } from './errors'
import { PROFILE } from './exposure'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** One request's cap. The member batches; a bigger body is a client bug, not a reason to
 *  truncate — truncating silently would make the member's journal record ids as acked that were
 *  never deleted. */
export const MAX_FORGET_IDS = 500

export function parseForgetBody(
  raw: unknown,
): { ok: true; sessionIds: string[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid body' }
  const ids = (raw as { sessionIds?: unknown }).sessionIds
  if (!Array.isArray(ids)) return { ok: false, error: 'sessionIds must be an array' }
  if (ids.length > MAX_FORGET_IDS) return { ok: false, error: `at most ${MAX_FORGET_IDS} sessionIds per request` }
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || id === '') return { ok: false, error: 'sessionIds must be non-empty strings' }
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return { ok: true, sessionIds: out }
}

export async function handleTeamForget(req: Request): Promise<Response> {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const minted = await validateIngestToken(bearer)
  if (!minted.ok) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS })
  }

  // readJsonLimited, not req.json(): the route is Bearer-authenticated inside the handler, so it
  // is in AUTH_PUBLIC and the body arrives before any cookie check — an oversized body must be
  // abandoned mid-stream rather than buffered first. `bodyBytes` (1 MiB) is the right cap: 500
  // session ids is ~20 KB, and `ingestBodyBytes` exists for a full-history push, not for this.
  const raw = await readJsonLimited<unknown>(req, LIMITS.bodyBytes)
  if (!raw.ok) return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400, headers: JSON_HEADERS })
  const parsed = parseForgetBody(raw.value)
  if (!parsed.ok) return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: JSON_HEADERS })
  if (parsed.sessionIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, deleted: 0, deletedRuns: 0 }), { status: 200, headers: JSON_HEADERS })
  }

  try {
    const col = await getTeamCollection()
    // `session_id` is the stored field name: TeamSessionDoc spreads SessionMeta's own fields
    // (`...rest` in toTeamDoc, team-store.ts) rather than renaming it, and SessionMeta carries
    // `session_id` (never `sessionId`) — confirmed by reading toTeamDoc directly.
    const res = await col.deleteMany({ memberId: minted.memberId, session_id: { $in: parsed.sessionIds } })
    const { deleteMemberWorkflowsBySession } = await import('./team-workflows')
    const deletedRuns = await deleteMemberWorkflowsBySession(minted.memberId, parsed.sessionIds)
    const { triggerSseNotification } = await import('./sse')
    triggerSseNotification()
    return new Response(
      JSON.stringify({ ok: true, deleted: res.deletedCount ?? 0, deletedRuns }),
      { status: 200, headers: JSON_HEADERS },
    )
  } catch (err) {
    // safeError returns { body, logLine } — it is NOT a Response. The client gets a code plus a
    // correlation ref; the message goes to the log and never to the wire.
    const safe = safeError(err, { verbose: PROFILE === 'local' })
    console.warn('[team-forget]', safe.logLine)
    return new Response(JSON.stringify(safe.body), { status: 500, headers: JSON_HEADERS })
  }
}
