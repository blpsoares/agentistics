import type { SessionMeta } from '@agentistics/core'

/**
 * Merge a machine's LOCAL session read with the sessions INGESTED from the team store.
 *
 * ## Why this exists
 *
 * A central that is also a member of itself (the very common "I run the central on my dev box"
 * setup) sees each of its own sessions TWICE: once from its live read of `~/.claude`, and once
 * from Mongo, because the same physical machine pushes to the central it hosts. The two copies
 * carry the same `session_id`, so every per-session aggregate (tokens, cost, repo/tag buckets,
 * project rollups) counted that machine twice, and the members view grew a phantom row for the
 * untagged local copy.
 *
 * The previous dedup keyed on `user` as well as `session_id`, which is exactly what let the pair
 * through: the local copy has no `user`/`memberId` (nothing tagged it) while the ingested copy is
 * tagged with the member's display name, so the two keys differed and both rows survived.
 *
 * ## Precedence: local data + ingested identity
 *
 * `session_id`s are UUIDs, so the same id appearing in both lists means one thing: it is the same
 * machine on both sides. Neither copy is uniformly better, so each side wins where it is
 * authoritative:
 *
 * - **The LOCAL copy wins for session data.** It is read from disk during THIS request, whereas
 *   the ingested copy is a snapshot from the member's last push and can lag by a whole push
 *   interval (a session still being written grows between pushes). Local is never staler.
 * - **The INGESTED copy wins for identity/scoping** (`memberId`, `teamId`, `teamIds`, `user`,
 *   `ci`). These are stamped by the central at read/ingest time and cannot be derived locally.
 *   Everything downstream — the members view, machine and team filters, per-team scoping, CI
 *   attribution — keys off them; a row without `memberId` is unattributable and falls into a
 *   phantom "(local)" bucket. Dropping the ingested copy in favour of the local one would fix the
 *   double-count but break scoping, so identity always survives.
 * - Any other field missing from the local copy is filled from the ingested one, so the merge can
 *   only ever add information.
 *
 * The result contains every session exactly once, keyed by (harness, session_id).
 */

/**
 * Fields the central owns. They are stamped at ingest/read time from the member token and team
 * registry, are absent from a purely local read, and are load-bearing for filtering and scoping —
 * so the ingested value always wins over the local one.
 */
export const INGEST_IDENTITY_FIELDS = ['memberId', 'teamId', 'teamIds', 'user', 'ci'] as const

/** Identity key for a session row. Harness is part of it so ids never collide across harnesses. */
export function sessionKey(s: SessionMeta): string {
  return `${s.harness ?? 'claude'}:${s.session_id}`
}

/**
 * Overlay the ingested copy's identity onto the local copy, and fill any field the local copy
 * lacks. Returns a new object — neither input is mutated.
 */
export function mergeSessionPair(local: SessionMeta, ingested: SessionMeta): SessionMeta {
  const merged = { ...local } as Record<string, unknown>
  // Fill holes: anything the local read did not produce but the ingested copy has.
  for (const [key, value] of Object.entries(ingested)) {
    if (value === undefined) continue
    if (merged[key] === undefined) merged[key] = value
  }
  // Identity always comes from the central-side copy, even if the local read had a value.
  for (const field of INGEST_IDENTITY_FIELDS) {
    const value = ingested[field]
    if (value !== undefined) merged[field] = value
  }
  return merged as unknown as SessionMeta
}

export interface MergedSessions {
  /** Every session exactly once: local rows (identity-enriched) followed by ingest-only rows. */
  sessions: SessionMeta[]
  /**
   * The ingested sessions that had NO local counterpart. These are the only ones the caller still
   * has to surface as projects — rows that merged into a local session were already surfaced when
   * the local session was scanned.
   */
  ingestOnly: SessionMeta[]
}

/**
 * Pure merge of the two session lists. See the module doc for the precedence rules.
 *
 * Duplicates WITHIN either list are collapsed too (first occurrence wins for local, last wins for
 * ingested — the ingest list is a Mongo read where a later doc is the fresher upsert).
 */
export function mergeLocalAndIngestedSessions(
  local: readonly SessionMeta[],
  ingested: readonly SessionMeta[],
): MergedSessions {
  const localByKey = new Map<string, SessionMeta>()
  const order: string[] = []
  for (const s of local) {
    const key = sessionKey(s)
    if (!localByKey.has(key)) order.push(key)
    else continue // a local list duplicate — first occurrence already won
    localByKey.set(key, s)
  }

  const ingestByKey = new Map<string, SessionMeta>()
  for (const s of ingested) ingestByKey.set(sessionKey(s), s)

  const sessions: SessionMeta[] = []
  for (const key of order) {
    const localSession = localByKey.get(key) as SessionMeta
    const ingestedSession = ingestByKey.get(key)
    sessions.push(ingestedSession ? mergeSessionPair(localSession, ingestedSession) : localSession)
  }

  const ingestOnly: SessionMeta[] = []
  for (const [key, s] of ingestByKey) {
    if (localByKey.has(key)) continue
    ingestOnly.push(s)
    sessions.push(s)
  }

  return { sessions, ingestOnly }
}
