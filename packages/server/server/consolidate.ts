import { join } from 'path'
import { mkdir, writeFile, readFile } from 'fs/promises'
import type { SessionMeta } from '@agentistics/core'
import { CONSOLIDATED_DIR } from './config'
import { createLimiter, safeReadDir, safeReadJson } from './utils'

const writeLimit = createLimiter(20)
let dirReady = false

async function ensureDir(): Promise<void> {
  if (dirReady) return
  await mkdir(CONSOLIDATED_DIR, { recursive: true })
  dirReady = true
}

/** Persist computed per-session metrics to ~/.agentistics/sessions/<id>.json.
 *  Skips writes when the stored copy is byte-identical to avoid churn. Entries
 *  are never deleted, so sessions removed by Claude's cleanup survive here. */
export async function writeConsolidated(sessions: SessionMeta[]): Promise<number> {
  if (sessions.length === 0) return 0
  await ensureDir()
  const counts = await Promise.all(
    sessions.map(s =>
      writeLimit(async () => {
        if (!s.session_id) return 0
        const dest = join(CONSOLIDATED_DIR, `${s.session_id}.json`)
        const next = JSON.stringify(s)
        const prev = await readFile(dest, 'utf-8').catch(() => null)
        if (prev === next) return 0
        await writeFile(dest, next)
        return 1
      })
    )
  )
  return counts.reduce<number>((a, b) => a + b, 0)
}

/** Load all consolidated sessions keyed by session_id. */
export async function loadConsolidated(): Promise<Map<string, SessionMeta>> {
  const map = new Map<string, SessionMeta>()
  const files = await safeReadDir(CONSOLIDATED_DIR)
  const limit = createLimiter(40)
  await Promise.all(
    files
      .filter(f => f.endsWith('.json'))
      .map(f =>
        limit(async () => {
          const s = await safeReadJson<SessionMeta>(join(CONSOLIDATED_DIR, f))
          if (s?.session_id) map.set(s.session_id, s)
        })
      )
  )
  return map
}
