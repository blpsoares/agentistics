import type { SessionMeta } from '@agentistics/core'
import { tagUser } from '@agentistics/core'

/** A team session as stored in Mongo: the SessionMeta plus identity + a stable _id. */
export type TeamSessionDoc = SessionMeta & { _id: string; org: string; user: string }

export interface IngestBody {
  org: string
  user: string
  sessions: SessionMeta[]
}

/** Stable, collision-safe Mongo _id. Mirrors the data.ts dedup key shape. */
export function teamDocId(org: string, user: string, harness: string, sessionId: string): string {
  return `${org}:${user}:${harness}:${sessionId}`
}

/** Map a SessionMeta + identity to a Mongo doc. Pure — does not mutate the input. */
export function toTeamDoc(session: SessionMeta, org: string, user: string): TeamSessionDoc {
  const tagged = tagUser(session, user)
  return {
    ...tagged,
    user,  // always string — overrides the optional user field from tagUser
    org,
    _id: teamDocId(org, user, tagged.harness ?? 'claude', tagged.session_id),
  }
}

/** Map a Mongo doc back to a plain SessionMeta (drops _id/org, keeps user). Pure. */
export function fromTeamDoc(doc: TeamSessionDoc): SessionMeta {
  const { _id, org, ...rest } = doc
  void _id; void org
  return rest
}

/** Validate an untrusted ingest request body. Pure. */
export function parseIngestBody(raw: unknown):
  | { ok: true; body: IngestBody }
  | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' }
  const r = raw as Record<string, unknown>
  if (typeof r.org !== 'string' || !r.org) return { ok: false, error: 'org is required' }
  if (typeof r.user !== 'string' || !r.user) return { ok: false, error: 'user is required' }
  if (!Array.isArray(r.sessions)) return { ok: false, error: 'sessions must be an array' }
  for (const s of r.sessions) {
    if (typeof s !== 'object' || s === null || typeof (s as Record<string, unknown>).session_id !== 'string') {
      return { ok: false, error: 'each session must have a session_id' }
    }
  }
  return { ok: true, body: { org: r.org, user: r.user, sessions: r.sessions as SessionMeta[] } }
}
