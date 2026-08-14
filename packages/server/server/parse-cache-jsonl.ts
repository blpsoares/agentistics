import type { SessionMeta } from '@agentistics/core'
import { parseSessionJsonl } from './jsonl'
import { safeStat } from './utils'
import type { ParseCache } from './parse-cache'
import type { FileStamp } from './parse-cache-key'

/** The file's version, or null when it cannot be stat-ed — in which case there is
 *  nothing to key on and the caller must go to the live parser. */
export async function stampOf(filePath: string): Promise<FileStamp | null> {
  const st = await safeStat(filePath)
  if (!st?.isFile()) return null
  return { path: filePath, mtimeMs: st.mtimeMs, size: st.size }
}

/**
 * `parseSessionJsonl`, through the cache.
 *
 * `source` is part of the VARIANT, not merely a parser argument: it changes the
 * SessionMeta produced, and Format A and Format B in `scanProjectDir` can name the
 * same transcript. `sessionId` and `fallbackPath` are NOT — both are derived
 * deterministically from the path the key already carries.
 *
 * A file that cannot be stat-ed has no version to check freshness against, which is
 * exactly the state Claude's own 30-day transcript cleanup leaves a cached row in —
 * the file is deleted, but the row this build wants is still sitting in the cache
 * from before. `getAny` serves that last-known parse rather than losing it; only a
 * slot that was NEVER cached falls through to the live parser, which answers with an
 * empty session exactly as it does today.
 */
export async function cachedParseSession(
  cache: ParseCache,
  filePath: string,
  sessionId: string,
  fallbackPath: string,
  source: 'jsonl' | 'subdir',
): Promise<SessionMeta> {
  const stamp = await stampOf(filePath)
  if (!stamp) {
    const stale = cache.getAny<SessionMeta>('session', filePath, source)
    if (stale) return stale
    return parseSessionJsonl(filePath, sessionId, fallbackPath, source)
  }

  const hit = cache.get<SessionMeta>('session', stamp, source)
  if (hit) return hit

  const parsed = await parseSessionJsonl(filePath, sessionId, fallbackPath, source)
  cache.set('session', stamp, parsed, source)
  return parsed
}
