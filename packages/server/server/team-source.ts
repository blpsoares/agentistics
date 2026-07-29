import { join } from 'path'
import type { SessionMeta, WorkflowRun } from '@agentistics/core'
import { tagUser } from '@agentistics/core'
import { safeReadDir, safeReadJson } from './utils'
import { TEAM_DIR } from './config'
import { getTeamCollection } from './mongo'
import { sessionKey } from './session-merge'
import { fromTeamDoc } from './team-store'
import { loadAllTeamWorkflows } from './team-workflows'
import { getMemberNameMap, getEffectiveMemberTeamsMap, getLiveTokenIds } from './team-tokens'
import { getCentralConfig } from './central-config'

/**
 * The set of member ids whose sessions still count, or `null` for "keep everything".
 *
 * By default a revoked/deleted machine stops contributing — deleting something should make it stop
 * counting. With `includeDeletedMembers` on, the history is kept instead, so past totals do not
 * shrink when someone is offboarded. A failed lookup returns null (passthrough) rather than hiding
 * every session on a transient error.
 */
async function liveMemberFilter(): Promise<Set<string> | null> {
  try {
    const cfg = await getCentralConfig()
    if (cfg.includeDeletedMembers) return null
  } catch { /* config unreachable → fall through to the default filter */ }
  return getLiveTokenIds().catch(() => null)
}

/**
 * Phase-1 "folder union" transport. Reads consolidated SessionMeta JSONs from
 * `root/<user>/sessions/*.json` and tags each with its owning user. Missing
 * dirs are tolerated (safeReadDir returns []). No raw transcript data — these
 * are the same metrics-only docs the consolidate mode already produces.
 */
export async function loadTeamSessions(root: string = TEAM_DIR): Promise<SessionMeta[]> {
  const out: SessionMeta[] = []
  const users = await safeReadDir(root)
  for (const user of users) {
    const dir = join(root, user, 'sessions')
    const files = await safeReadDir(dir)
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const data = await safeReadJson<SessionMeta>(join(dir, f))
      if (data && data.session_id) out.push(tagUser(data, user))
    }
  }
  return out
}

/**
 * Phase 2 central read: load every team session from Mongo, mapped back to plain SessionMeta.
 *
 * The `user` field on each session is resolved at read time:
 *   1. `nameMap[doc.memberId]` — current display name from the tokens collection (live rename).
 *   2. `doc.user` — cached display name stored in the session doc at ingest time (fallback for
 *      revoked tokens or legacy sessions where getMemberNameMap() has no entry).
 *
 * This means calling PUT /api/team/members to rename a member is reflected immediately in the
 * dashboard without requiring any re-ingest of sessions.
 */
export async function loadTeamSessionsFromMongo(): Promise<SessionMeta[]> {
  const col = await getTeamCollection()
  const [docs, nameMap, teamMap, liveIds] = await Promise.all([
    col.find({}).toArray(),
    getMemberNameMap().catch(() => ({} as Record<string, string>)),
    getEffectiveMemberTeamsMap().catch(() => ({} as Record<string, string[]>)),
    liveMemberFilter(),
  ])
  // null = keep everything (either the central opted into showing deleted members' history, or the
  // lookup failed and we would rather show too much than blank the dashboard).
  const live = liveIds
  return docs
    .filter(doc => !live || live.has(doc.memberId))
    .map(doc => {
    // Resolve current name from the live tokens table; fall back to the cached value in the doc.
    const resolved = { ...doc, user: nameMap[doc.memberId] ?? doc.user }
    const meta = fromTeamDoc(resolved)
    const teamIds = teamMap[doc.memberId] ?? [] // loose (no team) → visible only to an owner
    meta.teamIds = teamIds
    meta.teamId = teamIds[0] // primary, for single-value consumers (undefined when loose)
    meta.memberId = doc.memberId // re-attach the machine id (fromTeamDoc strips it) for machine filtering
    return meta
  })
}

/**
 * The only session fields the /api/tags pipeline reads: `tags-resolve` (git_remote, project_path,
 * memberId, teamId, teamIds), `tags-aggregate` / `tags-detail` (model, harness, start_time, token
 * counts) and `tags-handlers`' buildContext (git_remote, project_path, memberId, teamIds).
 * Anything a tag aggregator starts reading must be added here first, or it silently reads
 * `undefined`. `session_id` is kept as the row identity.
 */
const TAG_SESSION_PROJECTION = {
  session_id: 1,
  // `user` backs the distinct-member count on the tag detail. Omitting it made that count read 0
  // while the machine count was right — the silent-undefined failure this comment warns about.
  user: 1,
  project_path: 1,
  start_time: 1,
  harness: 1,
  model: 1,
  git_remote: 1,
  memberId: 1,
  teamId: 1,
  teamIds: 1,
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 1,
  cache_creation_input_tokens: 1,
} as const

/**
 * Central read for /api/tags: the same session set as `loadTeamSessionsFromMongo`, narrowed to the
 * fields the tag aggregators consume. Session docs average ~5 KB and only a few hundred bytes of
 * that is aggregatable — over a remote Mongo the unprojected read is bandwidth-bound and dominates
 * the request. Everything correctness-relevant is preserved: revoked-token sessions are dropped via
 * `getLiveTokenIds` (null = lookup failed → passthrough, same as above) and team ids are resolved
 * at read time from the tokens collection.
 *
 * The display name IS resolved here: the member ranking on the tag detail groups by `session.user`,
 * so reading the doc's cached name would split a renamed or re-owned machine into two people.
 * The returned objects are otherwise PARTIAL SessionMeta: fields outside the projection are
 * `undefined`. Do not feed them to anything but the tag pipeline.
 */
export async function loadTagSessionsFromMongo(): Promise<SessionMeta[]> {
  const col = await getTeamCollection()
  const [docs, nameMap, teamMap, liveIds] = await Promise.all([
    col.find({}, { projection: TAG_SESSION_PROJECTION }).toArray(),
    // The name MUST be resolved from the live tokens, not read from the doc's cache. A session doc
    // keeps whatever display name was current at ingest, so a renamed (or re-owned) machine kept
    // reporting its old owner — which split ONE person into two rows in the member ranking and
    // inflated the distinct-member count.
    getMemberNameMap().catch(() => ({} as Record<string, string>)),
    getEffectiveMemberTeamsMap().catch(() => ({} as Record<string, string[]>)),
    liveMemberFilter(),
  ])
  const live = liveIds
  const rows = docs
    .filter(doc => !live || live.has(doc.memberId))
    .map(doc => {
      const meta = fromTeamDoc({ ...doc, user: nameMap[doc.memberId] ?? doc.user })
      const teamIds = teamMap[doc.memberId] ?? [] // loose (no team) → visible only to an owner
      meta.teamIds = teamIds
      meta.teamId = teamIds[0]
      meta.memberId = doc.memberId
      return meta
    })

  // Collapse rows that describe the SAME session. `/api/data` already does this (session-merge.ts);
  // without the same step here the two endpoints disagree — a tag whose sources cover a machine
  // with duplicate docs would report double its tokens, cost and sessions, and emit two `members`
  // buckets, while the dashboard reported the session once. Keep the first occurrence so the
  // surviving row keeps a memberId/teamIds pair that scoping and the member buckets rely on.
  const byKey = new Map<string, SessionMeta>()
  for (const s of rows) {
    const key = sessionKey(s)
    if (!byKey.has(key)) byKey.set(key, s)
  }
  return [...byKey.values()]
}

/**
 * Phase 2 central read: load every team workflow run from Mongo. Mirrors
 * loadTeamSessionsFromMongo — same live-name resolution via getMemberNameMap(), so
 * renaming a member (PUT /api/team/members) is reflected immediately without re-ingest.
 * Never throws (best-effort — name-map lookup falls back to {} on failure).
 */
export async function loadTeamWorkflowsFromMongo(): Promise<WorkflowRun[]> {
  const [nameMap, liveIds] = await Promise.all([
    getMemberNameMap().catch(() => ({} as Record<string, string>)),
    getLiveTokenIds().catch(() => null),
  ])
  return loadAllTeamWorkflows(nameMap, liveIds)
}
