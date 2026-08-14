import { readFile } from 'fs/promises'
import type { SessionMeta, SessionAgentMetrics } from '@agentistics/core'
import { parseSessionJsonl, activeMinutesFromClaudeJsonl } from './jsonl'
import { extractAgentMetrics } from './agent-metrics'
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
 * A file that cannot be stat-ed has no version to check freshness against — and this
 * cache is never a source of truth: every value it holds must be recomputable from
 * the file it names, so a slot cannot be served once that file is gone, no matter
 * what was cached the last time it existed. This is exactly the state Claude's own
 * 30-day transcript cleanup leaves a row in, but reviving a deleted transcript's
 * metrics is not this cache's job — it is the consolidate store's
 * (`~/.agentistics/sessions/<harness>/<id>.json`, gap-filled by `loadConsolidated()`),
 * which exists precisely to survive that cleanup and is the one place that decision
 * belongs. So an unstat-able file falls straight through to the live parser, which
 * answers with an empty session exactly as it does today.
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
    return parseSessionJsonl(filePath, sessionId, fallbackPath, source)
  }

  const hit = cache.get<SessionMeta>('session', stamp, source)
  if (hit) return hit

  const parsed = await parseSessionJsonl(filePath, sessionId, fallbackPath, source)
  cache.set('session', stamp, parsed, source)
  return parsed
}

/** Everything `scanProjectDir` needs from a transcript whose session already exists in
 *  Claude's own session-meta — which carries none of the three. */
export interface EnrichResult {
  /** The first assistant model id in the transcript, or null when there is none. */
  model: string | null
  /** Per-turn active time; null when the transcript has no usable timing. */
  activeMinutes: number | null
  /** Agent metrics, or null when the session invoked no agent. */
  agentMetrics: SessionAgentMetrics | null
}

/** The first `claude-*` model in the transcript's opening 200 lines — the same scan
 *  `scanProjectDir` did inline, kept identical on purpose. */
function deriveModel(lines: string[]): string | null {
  for (const raw of lines.slice(0, 200)) {
    const line = raw.trim()
    if (!line) continue
    try {
      const e = JSON.parse(line)
      const m = e.message?.model
      if (e.type === 'assistant' && typeof m === 'string' && m && m.startsWith('claude-')) return m
    } catch { /* skip */ }
  }
  return null
}

/**
 * The whole enrichment of one transcript, cached as a unit.
 *
 * All three values are computed on a miss even when the caller needs only one. That is
 * deliberate: the read and the `split('\n')` dominate, they happen once per file
 * VERSION rather than once per build, and computing the triple removes the three
 * separate cache identities the conditional version would need.
 *
 * `metaModel` is the VARIANT because `extractAgentMetrics` prices against it, so it
 * changes the result without being in the file. The effective id is `metaModel ||
 * derived`, preserving the inline order exactly: the old code set `metaEntry.model`
 * from the transcript BEFORE passing `metaEntry.model` to extractAgentMetrics.
 *
 * Returns null when the file is gone or empty — the same "nothing to say" the inline
 * block expressed by returning early, never a zeroed result that would read as a
 * measurement.
 */
export async function cachedEnrich(
  cache: ParseCache,
  filePath: string,
  metaModel: string,
): Promise<EnrichResult | null> {
  const stamp = await stampOf(filePath)
  if (!stamp) return null

  const hit = cache.get<EnrichResult>('enrich', stamp, metaModel)
  if (hit) return hit

  const content = await readFile(filePath, 'utf-8').catch(() => '')
  if (!content) return null

  const lines = content.split('\n')
  const model = deriveModel(lines)
  const metrics = extractAgentMetrics(lines, metaModel || model || '')
  const result: EnrichResult = {
    model,
    activeMinutes: activeMinutesFromClaudeJsonl(lines) ?? null,
    agentMetrics: metrics.totalInvocations > 0 ? metrics : null,
  }
  cache.set('enrich', stamp, result, metaModel)
  return result
}
