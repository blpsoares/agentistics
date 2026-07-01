import type { SessionMeta, StatsCache } from '@agentistics/core'
import { tagUser } from '@agentistics/core'

/**
 * A team session as stored in Mongo: the SessionMeta plus identity fields and a stable _id.
 *
 * `memberId` is the SHA-256 hash of the member's ingest token (the token doc's `_id`).
 * Keying by `memberId` (not `user`) makes the document stable across member renames:
 * changing the display name never creates a duplicate session in the collection.
 *
 * MIGRATION NOTE: The `_id` scheme changed from `org:user:harness:sessionId` (name-based)
 * to `org:memberId:harness:sessionId` (token-hash-based). Operators must clear stale data
 * once after upgrading: `db.sessions.deleteMany({})`. Legacy sessions are re-ingested on the
 * next uploader push.
 */
export type TeamSessionDoc = SessionMeta & {
  _id: string
  org: string
  /** Stable token identity key (SHA-256 hash of the bearer token, or `legacy:<user>`). */
  memberId: string
  /** Cached display name as of the last ingest; overridden at read time by getMemberNameMap(). */
  user: string
}

export interface IngestBody {
  org: string
  user: string
  sessions: SessionMeta[]
  /** Optional: the member's own raw statsCache (aggregated Claude history). Stored per
   *  member so the central can reproduce the member's exact totals. */
  statsCache?: StatsCache
}

/**
 * Stable, collision-safe Mongo _id keyed by `memberId` (token hash) rather than by the
 * display name. This means member renames never create duplicate documents.
 */
export function teamDocId(org: string, memberId: string, harness: string, sessionId: string): string {
  return `${org}:${memberId}:${harness}:${sessionId}`
}

/**
 * Map a SessionMeta + identity to a Mongo doc. Pure — does not mutate the input.
 *
 * @param memberId - Stable member identity key (token hash or `legacy:<user>` for unauthenticated ingests).
 * @param user - Display name cached in the doc; overridden at read time by getMemberNameMap().
 */
export function toTeamDoc(session: SessionMeta, org: string, memberId: string, user: string): TeamSessionDoc {
  const tagged = tagUser(session, user)
  return {
    ...tagged,
    user,      // always string — overrides the optional user field from tagUser
    org,
    memberId,
    _id: teamDocId(org, memberId, tagged.harness ?? 'claude', tagged.session_id),
  }
}

/** Map a Mongo doc back to a plain SessionMeta (drops _id/org/memberId, keeps user). Pure. */
export function fromTeamDoc(doc: TeamSessionDoc): SessionMeta {
  const { _id, org, memberId, ...rest } = doc
  void _id; void org; void memberId
  return rest
}

/** Validate an untrusted ingest request body. Pure. */
export function parseIngestBody(raw: unknown):
  | { ok: true; body: IngestBody }
  | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' }
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.sessions)) return { ok: false, error: 'sessions must be an array' }
  for (const s of r.sessions) {
    if (typeof s !== 'object' || s === null || typeof (s as Record<string, unknown>).session_id !== 'string') {
      return { ok: false, error: 'each session must have a session_id' }
    }
  }
  const org = typeof r.org === 'string' ? r.org : ''
  const user = typeof r.user === 'string' ? r.user : ''
  // A body with no sessions is a connectivity ping — nothing is stored, so identity is not
  // required. Real pushes (≥1 session) must carry both org and user.
  if (r.sessions.length > 0) {
    if (!org) return { ok: false, error: 'org is required' }
    if (!user) return { ok: false, error: 'user is required' }
  }
  // statsCache is optional and passed through as-is (stored verbatim, not re-validated here).
  const statsCache = (typeof r.statsCache === 'object' && r.statsCache !== null)
    ? (r.statsCache as StatsCache)
    : undefined
  return { ok: true, body: { org, user, sessions: r.sessions as SessionMeta[], statsCache } }
}
