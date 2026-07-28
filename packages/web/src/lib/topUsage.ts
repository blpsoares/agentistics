import { canonicalProjectPath, sessionCostUSD, sessionModelUsage, calcCost } from '@agentistics/core'
import type { SessionMeta, StatsCache, Filters } from '@agentistics/core'

/** What the podium is ranked by. Cost answers "where is the money", tokens "where is the volume",
 *  sessions "where do I actually spend my days" — and they routinely disagree, which is the point
 *  of offering all three rather than picking one and calling it "usage". */
export type TopMetric = 'cost' | 'tokens' | 'sessions'

export type TopDimension = 'harness' | 'model' | 'project' | 'repo' | 'user' | 'machine'

export interface TopEntry {
  key: string
  cost: number
  tokens: number
  sessions: number
}

export interface TopResult {
  entries: TopEntry[]
  /** Total across EVERY entry, not just the ones shown — the share of a podium place is only
   *  meaningful against the whole. */
  total: number
  /** How many distinct entries existed before taking the top N. */
  distinct: number
}

const tokensOf = (s: SessionMeta): number =>
  (s.input_tokens ?? 0) + (s.output_tokens ?? 0)
  + (s.cache_read_input_tokens ?? 0) + (s.cache_creation_input_tokens ?? 0)

/**
 * Split a session into the keys it contributes to.
 *
 * Every dimension but `model` yields exactly one key, so the session's whole cost lands there. A
 * session CAN span several models (an Antigravity parent with its sub-agents folded in runs Opus
 * and Gemini Flash), so the model dimension splits it per model rather than filing the entire
 * session under one label — otherwise the cheaper model inherits the expensive one's spend.
 */
function contributions(s: SessionMeta, dim: TopDimension): Array<{ key: string; cost: number; tokens: number }> {
  if (dim === 'model') {
    const entries = sessionModelUsage(s)
    if (entries.length === 0) return []
    return entries.map(([model, usage]) => ({
      key: model,
      cost: calcCost(usage, model),
      tokens: usage.inputTokens + usage.outputTokens
        + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
    }))
  }

  const key =
    dim === 'harness' ? s.harness
    : dim === 'project' ? canonicalProjectPath(s.project_path ?? '')
    : dim === 'repo' ? (s.git_remote ?? '')
    : dim === 'user' ? (s.user ?? '')
    : (s.memberId ?? '')

  if (!key) return []
  return [{ key, cost: sessionCostUSD(s) ?? 0, tokens: tokensOf(s) }]
}

/**
 * Rank one dimension. Ties break on the runner-up metrics and then the key, so the same data always
 * produces the same podium instead of shuffling between renders.
 */
export function rankTop(
  sessions: SessionMeta[],
  dim: TopDimension,
  metric: TopMetric,
  limit = 3,
): TopResult {
  const acc = new Map<string, TopEntry>()
  for (const s of sessions) {
    for (const c of contributions(s, dim)) {
      const e = acc.get(c.key) ?? { key: c.key, cost: 0, tokens: 0, sessions: 0 }
      e.cost += c.cost
      e.tokens += c.tokens
      // A session spanning two models counts once for each: the question is how many sessions
      // touched that model, and a session that used both really did touch both.
      e.sessions += 1
      acc.set(c.key, e)
    }
  }

  const all = [...acc.values()]
  const value = (e: TopEntry): number => (metric === 'cost' ? e.cost : metric === 'tokens' ? e.tokens : e.sessions)
  all.sort((a, b) =>
    value(b) - value(a)
    || b.cost - a.cost
    || b.tokens - a.tokens
    || a.key.localeCompare(b.key))

  return {
    entries: all.slice(0, limit),
    total: all.reduce((sum, e) => sum + value(e), 0),
    distinct: all.length,
  }
}

/**
 * True when the podium may be built from the per-member/-machine statsCaches instead of from the
 * sessions.
 *
 * Those caches are the authoritative deep history — the sessions are only what still exists as
 * individual documents, which is a fraction of it (a real machine showed R$54.5k of history against
 * R$19.3k of surviving session docs, so its person and machine podiums under-reported by 65%). The
 * caches are all-time totals with no project / repo / tag / model granularity, so ANY filter along
 * one of those dimensions — or a date range — makes them the wrong answer and the per-session sum
 * the right one, undercount and all. Member / machine / team / presence filters are fine: they
 * select WHICH caches to read, not a slice inside them. Pure.
 */
export function cacheTotalsUsable(filters: Filters): boolean {
  return (filters.projects?.length ?? 0) === 0
    && (filters.repos?.length ?? 0) === 0
    && (filters.tags?.length ?? 0) === 0
    && (filters.models?.length ?? 0) === 0
    && (filters.harnesses?.length ?? 0) === 0   // statsCache is Claude-only
    && !filters.harness
    && filters.dateRange === 'all'
    && !filters.customStart
    && !filters.customEnd
}

/** One podium entry's totals, read from a statsCache rather than summed from sessions. */
function entryFromCache(key: string, c: StatsCache): TopEntry {
  let cost = 0, tokens = 0
  for (const [model, u] of Object.entries(c.modelUsage ?? {})) {
    cost += calcCost(u, model)
    // Every billed counter, same as tokensOf — cache reads are ~96% of the volume, so leaving
    // them out would rank the podium by the 4% that barely costs anything.
    tokens += (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
      + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0)
  }
  const sessions = (c.dailyActivity ?? []).reduce((s, d) => s + (d.sessionCount ?? 0), 0)
  return { key, cost, tokens, sessions }
}

/**
 * Rank a dimension from per-key statsCaches (person → display name, machine → machine id).
 *
 * `inScope` is the set of keys the active filters left standing, taken from the already-filtered
 * session set: the sessions are trustworthy about WHO is in scope (they went through every filter,
 * presence and teams included), the caches about HOW MUCH. A key with no surviving session is left
 * out rather than guessed at.
 */
export function rankTopFromCaches(
  caches: Record<string, StatsCache>,
  inScope: Set<string>,
  metric: TopMetric,
  limit = 3,
): TopResult {
  const all = Object.entries(caches)
    .filter(([key]) => inScope.has(key))
    .map(([key, c]) => entryFromCache(key, c))
  const value = (e: TopEntry): number => (metric === 'cost' ? e.cost : metric === 'tokens' ? e.tokens : e.sessions)
  all.sort((a, b) =>
    value(b) - value(a)
    || b.cost - a.cost
    || b.tokens - a.tokens
    || a.key.localeCompare(b.key))
  return {
    entries: all.slice(0, limit),
    total: all.reduce((sum, e) => sum + value(e), 0),
    distinct: all.length,
  }
}

/** Share of the whole, 0–1. Zero when there is nothing to take a share of. */
export function shareOf(entry: TopEntry, result: TopResult, metric: TopMetric): number {
  if (result.total <= 0) return 0
  const v = metric === 'cost' ? entry.cost : metric === 'tokens' ? entry.tokens : entry.sessions
  return v / result.total
}
