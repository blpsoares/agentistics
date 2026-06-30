import { join } from 'path'
import type { SessionMeta } from '@agentistics/core'
import { tagUser } from '@agentistics/core'
import { safeReadDir, safeReadJson } from './utils'
import { TEAM_DIR } from './config'
import { getTeamCollection } from './mongo'
import { fromTeamDoc } from './team-store'
import { getMemberNameMap } from './team-tokens'

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
  const [docs, nameMap] = await Promise.all([
    col.find({}).toArray(),
    getMemberNameMap().catch(() => ({} as Record<string, string>)),
  ])
  return docs.map(doc => {
    // Resolve current name from the live tokens table; fall back to the cached value in the doc.
    const resolved = { ...doc, user: nameMap[doc.memberId] ?? doc.user }
    return fromTeamDoc(resolved)
  })
}
