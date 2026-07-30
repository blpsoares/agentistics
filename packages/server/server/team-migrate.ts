/**
 * team-migrate.ts — the once-per-install move from single-connection state files to the
 * per-connection layout. Impure by design; the conversion itself is pure and tested.
 *
 * Nothing here may run from `readPreferencesFrom`: that function is exported for tests with tmp
 * paths while these paths are module constants, so a rename there would touch the developer's
 * real ~/.agentistics — and since a pure read persists nothing, it would re-run on every read
 * forever.
 */
import { rename, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readPreferences, writePreferences } from './preferences'
import { TEAM_CONN_DIR, teamSentFile, teamSyncFile, teamRulesFile, TEAM_SENT_FILE, TEAM_SYNC_FILE } from './config'
import { safeReadJson } from './utils'
import { denialSignature } from './share-rules'

export interface SentStateV2 {
  version: 2
  hashes: Record<string, string>
  runIds: string[]
}

/**
 * v1 → v2, offline and exact: the v1 value IS `JSON.stringify(session)`, which is precisely the
 * input to v2's digest. Returns null for anything that is neither a v1 map of string→string nor
 * an already-v2 file — a half-converted file would make two code versions re-push forever.
 */
export function convertSentStateV1(raw: unknown): SentStateV2 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.version === 2) {
    const hashes = r.hashes
    if (!hashes || typeof hashes !== 'object') return null
    return {
      version: 2,
      hashes: hashes as Record<string, string>,
      runIds: Array.isArray(r.runIds) ? (r.runIds as string[]) : [],
    }
  }
  if ('version' in r) return null
  const hashes: Record<string, string> = {}
  for (const [id, value] of Object.entries(r)) {
    if (typeof value !== 'string') return null
    hashes[id] = createHash('sha256').update(value).digest('hex')
  }
  return { version: 2, hashes, runIds: [] }
}

/**
 * The marker path is resolved on every call, NEVER frozen at module load: `TEAM_CONN_DIR` is a
 * live binding that `__setTeamConnDirForTests` reassigns, and a constant captured at import time
 * would keep pointing at the developer's real `~/.agentistics/connections` — so a future test of
 * this function would write there while every other path it touches went to the tmp dir.
 */
export function markerFile(): string {
  return join(TEAM_CONN_DIR, '.migrated-v2')
}
let inflight: Promise<void> | null = null

/** Idempotent, single-flight, marker-guarded. Safe to call from boot and from startUploader. */
export async function migrateTeamStateOnce(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    if (await Bun.file(markerFile()).exists()) return
    await mkdir(TEAM_CONN_DIR, { recursive: true })

    // Persisting the migrated config makes the stored id authoritative, so no later read ever
    // re-derives it. writePreferences runs the shape migration on the way in.
    const prefs = await readPreferences()
    await writePreferences({ team: prefs.team })

    const connections = prefs.team?.connections ?? []
    if (connections.length === 1) {
      const id = connections[0]!.id
      const legacySent = await safeReadJson<unknown>(TEAM_SENT_FILE)
      const converted = convertSentStateV1(legacySent)
      if (converted) {
        await writeFile(teamSentFile(id), JSON.stringify(converted, null, 2), 'utf-8')
        try { await rename(TEAM_SENT_FILE, `${TEAM_SENT_FILE}.migrated`) } catch { /* best-effort */ }
      }
      const legacySync = await safeReadJson<{ sig?: string }>(TEAM_SYNC_FILE)
      if (legacySync?.sig) {
        try { await rename(TEAM_SYNC_FILE, teamSyncFile(id)) } catch { /* best-effort */ }
      }
      // Seed the rules file so the first post-upgrade cycle does not read a missing rulesHash as
      // a rules change — that would make the whole fleet run a removal on upgrade day.
      await writeFile(
        teamRulesFile(id),
        JSON.stringify({ rulesHash: denialSignature([]), sharedIds: [], boundary: '', sealed: {}, pending: {} }, null, 2),
        'utf-8',
      )
    }
    await writeFile(markerFile(), new Date().toISOString(), 'utf-8')
  })()
  return inflight
}
