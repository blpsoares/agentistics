import { join } from 'path'
import { mkdir, writeFile, readFile } from 'fs/promises'
import type { SessionMeta, HarnessId } from '@agentistics/core'
import { CONSOLIDATED_DIR } from './config'
import { createLimiter, safeReadDir, safeReadJson } from './utils'

const writeLimit = createLimiter(20)
const readyDirs = new Set<string>()

export function consolidatedPath(harness: HarnessId, sessionId: string): string {
  return join(CONSOLIDATED_DIR, harness, `${sessionId}.json`)
}

async function ensureDir(harness: HarnessId): Promise<void> {
  if (readyDirs.has(harness)) return
  await mkdir(join(CONSOLIDATED_DIR, harness), { recursive: true })
  readyDirs.add(harness)
}

/** Persist computed per-session metrics to ~/.agentistics/sessions/<harness>/<id>.json.
 *  Skips writes when the stored copy is byte-identical to avoid churn. Entries
 *  are never deleted, so sessions removed by Claude's cleanup survive here. */
export async function writeConsolidated(sessions: SessionMeta[]): Promise<number> {
  if (sessions.length === 0) return 0
  const counts = await Promise.all(sessions.map(s => writeLimit(async () => {
    if (!s.session_id) return 0
    const harness = s.harness ?? 'claude'
    await ensureDir(harness)
    const dest = consolidatedPath(harness, s.session_id)
    const next = JSON.stringify(s)
    const prev = await readFile(dest, 'utf-8').catch(() => null)
    if (prev === next) return 0
    await writeFile(dest, next)
    return 1
  })))
  return counts.reduce<number>((a, b) => a + b, 0)
}

/** Load all consolidated sessions keyed by session_id.
 *  Reads per-harness subdirs plus legacy flat files at the root (treated as claude).
 *  De-duplicates by (harness, session_id), then collapses to an id-keyed Map. */
export async function loadConsolidated(): Promise<Map<string, SessionMeta>> {
  const map = new Map<string, SessionMeta>()
  const limit = createLimiter(40)
  // Per-harness subdirs + legacy flat files (treated as claude)
  const harnesses: HarnessId[] = ['claude', 'codex', 'gemini', 'copilot']
  const roots = [
    ...harnesses.map(h => ({ dir: join(CONSOLIDATED_DIR, h), legacy: false })),
    { dir: CONSOLIDATED_DIR, legacy: true },
  ]
  for (const { dir, legacy } of roots) {
    const files = await safeReadDir(dir)
    await Promise.all(files.filter(f => f.endsWith('.json')).map(f => limit(async () => {
      const s = await safeReadJson<SessionMeta>(join(dir, f))
      if (!s?.session_id) return
      if (!s.harness) s.harness = 'claude'
      // (harness, id) key; first writer wins per key
      const key = `${s.harness}:${s.session_id}`
      if (!map.has(key)) map.set(key, s)
    })))
    if (legacy) break
  }
  // Caller expects id-keyed map; collapse to id (live merge re-dedups by id anyway)
  const byId = new Map<string, SessionMeta>()
  for (const s of map.values()) if (!byId.has(s.session_id)) byId.set(s.session_id, s)
  return byId
}
