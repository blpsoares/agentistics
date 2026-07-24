import { join } from 'path'
import type { SessionMeta, WorkflowRun } from '@agentistics/core'
import { tagUser } from '@agentistics/core'
import { safeReadDir, safeReadJson } from './utils'
import { TEAM_DIR } from './config'
import { getTeamCollection } from './mongo'
import { fromTeamDoc } from './team-store'
import { loadAllTeamWorkflows } from './team-workflows'
import { getMemberNameMap, getMemberTeamsMap, getLiveTokenIds } from './team-tokens'
import { DEFAULT_TEAM_ID } from './teams'

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
    getMemberTeamsMap().catch(() => ({} as Record<string, string[]>)),
    getLiveTokenIds().catch(() => null),
  ])
  // Drop orphaned sessions whose member token was revoked/deleted — otherwise a removed
  // machine keeps contributing metrics. Only filter when the live-token set loaded cleanly
  // (null = lookup failed → passthrough rather than hide everything on a transient error).
  const live = liveIds
  return docs
    .filter(doc => !live || live.has(doc.memberId))
    .map(doc => {
    // Resolve current name from the live tokens table; fall back to the cached value in the doc.
    const resolved = { ...doc, user: nameMap[doc.memberId] ?? doc.user }
    const meta = fromTeamDoc(resolved)
    const teamIds = teamMap[doc.memberId] ?? [DEFAULT_TEAM_ID]
    meta.teamIds = teamIds
    meta.teamId = teamIds[0] ?? DEFAULT_TEAM_ID // primary, for single-value consumers
    meta.memberId = doc.memberId // re-attach the machine id (fromTeamDoc strips it) for machine filtering
    return meta
  })
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
