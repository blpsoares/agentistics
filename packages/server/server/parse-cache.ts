import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import { PARSE_CACHE_FILE } from './config'
import { cacheKey, cacheSlot, type FileStamp, type ParseCacheKind } from './parse-cache-key'

export interface ParseCacheStats {
  hits: number
  misses: number
  writes: number
}

export interface ParseCache {
  /** The cached derivation of THIS version of the file, or null to recompute. */
  get<T>(kind: ParseCacheKind, stamp: FileStamp, variant?: string): T | null
  /** The most recently cached derivation for this slot, regardless of the version it
   *  was derived from — for when the source file is gone and there is nothing left
   *  to check freshness against. A slot never written returns null, exactly like
   *  `get`. Counts identically to `get` (a hit/miss and, on a hit, keeps the slot
   *  alive for `flush`), so callers do not need to reason about a second counter. */
  getAny<T>(kind: ParseCacheKind, path: string, variant?: string): T | null
  /** Store a derivation, replacing any earlier version of the same slot. */
  set(kind: ParseCacheKind, stamp: FileStamp, value: unknown, variant?: string): void
  /** Mark every slot READ this build as live, in one statement. Call once per build,
   *  before gc — without it, a row that is always hit and never rewritten ages out. */
  flush(): void
  /** Drop rows untouched since `cutoffMs`. Returns how many were dropped. */
  gc(cutoffMs: number): number
  stats(): ParseCacheStats
  /** Row count — used by gc() to report what it dropped, and by diagnostics. */
  rowCount(): number
  close(): void
}

/** The cache that is not there. Returned whenever the database cannot be opened, and
 *  used by callers that deliberately bypass it. Every method is a safe nothing. */
export const NOOP_PARSE_CACHE: ParseCache = {
  get: () => null,
  getAny: () => null,
  set: () => {},
  flush: () => {},
  gc: () => 0,
  stats: () => ({ hits: 0, misses: 0, writes: 0 }),
  rowCount: () => 0,
  close: () => {},
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS parse_cache (
  slot  TEXT PRIMARY KEY,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  used  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS parse_cache_used ON parse_cache(used);
`

/**
 * Open the parse cache, creating it if needed.
 *
 * EVERY failure path returns NOOP_PARSE_CACHE rather than throwing: an unwritable
 * home directory, a read-only container, a corrupt database and a non-Bun runtime are
 * all ordinary outcomes here, and none of them may stop a build. The cost of the
 * fallback is exactly the time this cache was meant to save — never a wrong number,
 * because every value in it is recomputable from the file it names.
 */
export async function openParseCache(
  file: string = PARSE_CACHE_FILE,
  /** Injected so gc/flush behaviour is testable without sleeping. Production passes none. */
  now: () => number = Date.now,
): Promise<ParseCache> {
  let db: any
  let selectStmt: any
  let upsertStmt: any
  let touchStmt: any
  let countStmt: any
  let gcStmt: any
  try {
    await mkdir(dirname(file), { recursive: true })
    // Dynamic import so a non-Bun runtime degrades instead of crashing at import time
    // (same guard as adapters/antigravity.ts).
    const { Database } = await import('bun:sqlite')
    db = new Database(file, { create: true })
    // WAL: the server and the otel-watcher are separate processes over one file, and
    // a reader must not block behind a writer holding the whole database.
    db.exec('PRAGMA journal_mode = WAL')
    // NORMAL is the right durability for derived state — a row lost to a power cut is
    // one file reparsed, and FULL would fsync on every transcript we cache.
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec(SCHEMA)

    // Prepared here, inside the same guard: `db.query()` COMPILES the statement
    // immediately, so a schema that doesn't match what we expect (a pre-existing
    // `parse_cache` table with different columns — `CREATE TABLE IF NOT EXISTS` only
    // matches on the table NAME, never the columns) throws right here, not later
    // unguarded. Falling into the catch below is exactly the degrade this cache promises.
    selectStmt = db.query('SELECT key, value FROM parse_cache WHERE slot = ?')
    upsertStmt = db.query(
      'INSERT INTO parse_cache (slot, key, value, used) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(slot) DO UPDATE SET key = excluded.key, value = excluded.value, used = excluded.used'
    )
    touchStmt = db.query('UPDATE parse_cache SET used = ? WHERE slot = ?')
    countStmt = db.query('SELECT COUNT(*) AS n FROM parse_cache')
    gcStmt = db.query('DELETE FROM parse_cache WHERE used < ?')
  } catch {
    try { db?.close() } catch { /* already gone */ }
    return NOOP_PARSE_CACHE
  }

  const stats: ParseCacheStats = { hits: 0, misses: 0, writes: 0 }
  // Slots READ this build. Touched in one transaction by flush() so a row that is
  // always hit and never rewritten does not age out under gc().
  const readSlots = new Set<string>()

  const store: ParseCache = {
    get<T>(kind: ParseCacheKind, stamp: FileStamp, variant = ''): T | null {
      const slot = cacheSlot(kind, stamp.path, variant)
      try {
        const row = selectStmt.get(slot) as { key: string; value: string } | null
        if (!row || row.key !== cacheKey(stamp)) { stats.misses++; return null }
        // A blob written by an older build may no longer parse or may no longer hold
        // the shape the caller expects. Both are a miss — recompute, never crash.
        const parsed = JSON.parse(row.value) as T
        readSlots.add(slot)
        stats.hits++
        return parsed
      } catch {
        stats.misses++
        return null
      }
    },

    getAny<T>(kind: ParseCacheKind, path: string, variant = ''): T | null {
      const slot = cacheSlot(kind, path, variant)
      try {
        const row = selectStmt.get(slot) as { key: string; value: string } | null
        if (!row) { stats.misses++; return null }
        const parsed = JSON.parse(row.value) as T
        readSlots.add(slot)
        stats.hits++
        return parsed
      } catch {
        stats.misses++
        return null
      }
    },

    set(kind: ParseCacheKind, stamp: FileStamp, value: unknown, variant = ''): void {
      try {
        const slot = cacheSlot(kind, stamp.path, variant)
        upsertStmt.run(slot, cacheKey(stamp), JSON.stringify(value), now())
        readSlots.add(slot)
        stats.writes++
      } catch { /* a cache that cannot store is still a correct cache */ }
    },

    flush(): void {
      if (readSlots.size === 0) return
      try {
        const at = now()
        const slots = [...readSlots]
        readSlots.clear()
        db.transaction(() => { for (const s of slots) touchStmt.run(at, s) })()
      } catch { /* the touch is an optimisation; losing it costs one reparse */ }
    },

    gc(cutoffMs: number): number {
      // Counted by difference rather than read off `run().changes`: the shape of that
      // return has moved between bun:sqlite versions, and a gc that silently reports 0
      // is indistinguishable from one that is not running at all.
      try {
        const before = store.rowCount()
        gcStmt.run(cutoffMs)
        return before - store.rowCount()
      } catch { return 0 }
    },

    stats: () => ({ ...stats }),

    rowCount(): number {
      try { return Number((countStmt.get() as { n: number } | null)?.n ?? 0) } catch { return 0 }
    },

    close(): void {
      try { store.flush(); db.close() } catch { /* already gone */ }
    },
  }

  return store
}
