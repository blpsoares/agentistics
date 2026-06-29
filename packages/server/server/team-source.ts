import { join } from 'path'
import type { SessionMeta } from '@agentistics/core'
import { tagUser } from '@agentistics/core'
import { safeReadDir, safeReadJson } from './utils'
import { TEAM_DIR } from './config'

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
