import { readFile } from 'fs/promises'
import type { SessionMeta, SessionAgentMetrics } from '@agentistics/core'
import { parseSessionJsonl, activeMinutesFromClaudeJsonl, contextTokensFromClaudeJsonl } from './jsonl'
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
    return completeSessionAgents(
      await parseSessionJsonl(filePath, sessionId, fallbackPath, source), filePath, cache)
  }

  const variant = `${SESSION_SHAPE}:${source}`
  const hit = cache.get<SessionMeta>('session', stamp, variant)
  // A HIT IS STILL COMPLETED, for the same reason `cachedEnrich`'s is: the agents' numbers are not
  // in this file and not in this row.
  if (hit) return completeSessionAgents(hit, filePath, cache)

  const parsed = await parseSessionJsonl(filePath, sessionId, fallbackPath, source)
  cache.set('session', stamp, parsed, variant)
  return completeSessionAgents(parsed, filePath, cache)
}

/**
 * The SHAPE of a stored `session` row, in its variant.
 *
 * A stored row is only readable by the code that wrote it — the same reason `ENRICH_SHAPE` exists,
 * which this kind was missing. Without it a change to what `parseSessionJsonl` PRODUCES serves the
 * old shape from before the change, for every file that has not been appended to since. That is not
 * hypothetical: it is how 74 sessions kept reporting agent invocations in the pre-`measured` shape
 * after the reader that produced them had been replaced. Bump this whenever `SessionMeta` gains,
 * loses or re-means a field this parser fills.
 */
const SESSION_SHAPE = 'v2'

/** `withSubagentMetrics` over a whole session, or the session untouched when it has no agents. */
async function completeSessionAgents(
  meta: SessionMeta, filePath: string, cache: ParseCache,
): Promise<SessionMeta> {
  if (!meta.agentMetrics) return meta
  const { withSubagentMetrics } = await import('./agent-metrics')
  return { ...meta, agentMetrics: await withSubagentMetrics(meta.agentMetrics, filePath, cache) }
}

/** Everything `scanProjectDir` needs from a transcript whose session already exists in
 *  Claude's own session-meta — which carries none of it. */
export interface EnrichResult {
  /** The first assistant model id in the transcript, or null when there is none. */
  model: string | null
  /** Per-turn active time; null when the transcript has no usable timing. */
  activeMinutes: number | null
  /** Context-window gauge at the last turn; null when the transcript has none. */
  contextTokens: number | null
  /** Agent metrics, or null when the session invoked no agent. */
  agentMetrics: SessionAgentMetrics | null
}

/**
 * The SHAPE of `EnrichResult`, folded into the cache variant.
 *
 * A stored row is a JSON blob of whatever `EnrichResult` looked like when it was
 * written. Adding a field — `contextTokens` was added exactly this way, when
 * `contextTokensFromClaudeJsonl` landed on dev — leaves every existing row missing it,
 * and those rows keep HITTING because the file they name has not changed. For a
 * finished session the transcript never changes again, so the new metric would read as
 * blank forever on precisely the sessions that already have data.
 *
 * Bumping this retires every old row at once: they stop matching, get recomputed, and
 * `gc()` drops the originals. **Bump it whenever a field is added to, removed from, or
 * changed in `EnrichResult`.** Costs one slow build; the alternative is a metric that
 * is silently blank and looks like missing data rather than a stale cache.
 */
const ENRICH_SHAPE = 'v2'

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
 * Every value is computed on a miss even when the caller needs only one. That is
 * deliberate: the read and the `split('\n')` dominate, they happen once per file
 * VERSION rather than once per build, and computing them together removes the separate
 * cache identities the conditional version would need.
 *
 * The VARIANT is `ENRICH_SHAPE` plus `metaModel`. `metaModel` belongs there because
 * `extractAgentMetrics` prices against it, so it changes the result without being in
 * the file; the effective id is `metaModel || derived`, preserving the inline order
 * exactly (the old code set `metaEntry.model` from the transcript BEFORE passing
 * `metaEntry.model` to extractAgentMetrics). `ENRICH_SHAPE` belongs there because a
 * stored row is only readable by the code that wrote it — see its comment.
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

  const variant = `${ENRICH_SHAPE}:${metaModel}`
  const hit = cache.get<EnrichResult>('enrich', stamp, variant)
  // A HIT IS STILL COMPLETED. The agents' numbers are not in this file and not in this row; a
  // cached row carries their invocations UNMEASURED, and filling them costs a stat per agent plus a
  // cache hit each, since `withSubagentMetrics` keys them on their own stamps. Returning the row
  // as-is would make a running agent's numbers freeze until something wrote to the parent.
  if (hit) return completeAgents(hit, filePath, cache)

  const content = await readFile(filePath, 'utf-8').catch(() => '')
  if (!content) return null

  const lines = content.split('\n')
  const model = deriveModel(lines)
  // The parent half is cached HERE, against this file's stamp. The agents' own numbers are NOT:
  // `withSubagentMetrics` caches each agent transcript against its own stamp, because those files
  // change while this one does not — see `agent-metrics.ts`. So this row is completed on every
  // read, and the completion is itself cached one level down.
  const metrics = extractAgentMetrics(lines, metaModel || model || '')
  const result: EnrichResult = {
    model,
    activeMinutes: activeMinutesFromClaudeJsonl(lines) ?? null,
    contextTokens: contextTokensFromClaudeJsonl(lines) ?? null,
    agentMetrics: metrics.totalInvocations > 0 ? metrics : null,
  }
  cache.set('enrich', stamp, result, variant)
  return completeAgents(result, filePath, cache)
}

/**
 * Fill in what the agents' OWN transcripts know, on whichever copy of the row we are holding.
 *
 * Stored UNCOMPLETED on purpose: the row is keyed on the parent's stamp, so a completion written
 * into it would be a number cached under a key that does not name where it came from.
 */
async function completeAgents(
  result: EnrichResult, filePath: string, cache: ParseCache,
): Promise<EnrichResult> {
  if (!result.agentMetrics) return result
  const { withSubagentMetrics } = await import('./agent-metrics')
  return { ...result, agentMetrics: await withSubagentMetrics(result.agentMetrics, filePath, cache) }
}
