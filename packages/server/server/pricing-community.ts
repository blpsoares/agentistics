/**
 * pricing-community.ts — the community pricing dataset, treated as a SUGGESTION, never authority.
 *
 * LiteLLM publishes one JSON keyed by model id with per-token costs. It is the only source that
 * covers every harness agentistics reads (Claude, OpenAI, Gemini and Moonshot/Kimi all appear), and
 * spot-checking it against the vendors' own pricing pages matched on 13 of 13 models.
 *
 * It is also community-maintained and demonstrably imperfect: `kimi-k2-thinking-251104` is listed at
 * a cost of ZERO. Importing that verbatim would silently make those sessions free. So every row is
 * validated before it is allowed anywhere near a total, and anything that fails is dropped rather
 * than trusted — a missing price falls back to the table compiled into the binary, which is the one
 * source that cannot fail.
 */
import { MODEL_PRICING } from '@agentistics/core'
import type { PriceEntry } from '@agentistics/core'

export const COMMUNITY_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

/** Where a given model's price came from. Shown per row so staleness is visible, not assumed. */
export type PriceOrigin = 'official' | 'community' | 'builtin'

export interface PricedModel {
  price: PriceEntry
  origin: PriceOrigin
}

/** No real model costs this much per 1M tokens; a value above it means the units changed. */
const MAX_PER_1M = 1000
/** A live price this far from the built-in one is a unit change or a bad row, not a price change. */
const MAX_DRIFT_FACTOR = 10

export interface RawCommunityEntry {
  input_cost_per_token?: unknown
  output_cost_per_token?: unknown
  cache_read_input_token_cost?: unknown
  cache_creation_input_token_cost?: unknown
  litellm_provider?: unknown
  mode?: unknown
}

const per1M = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null
  const scaled = v * 1e6
  if (scaled > MAX_PER_1M) return null
  // Round away the float noise of a per-token figure scaled by a million (0.025 arrives as
  // 0.024999999999999998), which would otherwise be rendered verbatim in a price table.
  return Math.round(scaled * 1e6) / 1e6
}

/**
 * Validate and convert one dataset row. Returns null — meaning "keep whatever we already had" — for
 * anything that cannot be trusted: a zero or negative cost, a missing input/output pair, a value
 * large enough to imply the units changed, or a price that has drifted implausibly far from the
 * built-in one for a model we already know.
 */
export function normalizeCommunityEntry(id: string, raw: RawCommunityEntry): PriceEntry | null {
  if (raw.mode !== undefined && raw.mode !== 'chat' && raw.mode !== 'responses') return null

  const input = per1M(raw.input_cost_per_token)
  const output = per1M(raw.output_cost_per_token)
  if (input === null || output === null) return null

  // Cache costs are optional: Google and OpenAI charge nothing to write a cache entry, and a
  // missing cache-read simply means the vendor does not bill it separately.
  const cacheRead = per1M(raw.cache_read_input_token_cost) ?? input * 0.1
  const cacheWrite = per1M(raw.cache_creation_input_token_cost) ?? input

  const known = MODEL_PRICING[id]
  if (known) {
    const drifted = (live: number, base: number): boolean =>
      base > 0 && (live > base * MAX_DRIFT_FACTOR || live < base / MAX_DRIFT_FACTOR)
    if (drifted(input, known.input) || drifted(output, known.output)) return null
  }

  return { input, output, cacheRead, cacheWrite }
}

/**
 * Convert the whole dataset. Keys are also registered without their provider prefix
 * (`moonshot/kimi-k2.6` → `kimi-k2.6`) because that is the form the harnesses report; the prefixed
 * key wins if both exist, since it is the more specific statement about the same model.
 */
export function normalizeCommunityDataset(data: Record<string, RawCommunityEntry>): Record<string, PriceEntry> {
  const out: Record<string, PriceEntry> = {}
  const bare: Record<string, PriceEntry> = {}
  for (const [id, raw] of Object.entries(data)) {
    if (!raw || typeof raw !== 'object') continue
    const price = normalizeCommunityEntry(id, raw)
    if (!price) continue
    const slash = id.lastIndexOf('/')
    if (slash > 0) {
      const stripped = id.slice(slash + 1)
      if (stripped && !bare[stripped]) bare[stripped] = price
    } else {
      out[id] = price
    }
  }
  // Unprefixed ids win: `gpt-5.5` stated directly beats `azure/gpt-5.5`.
  return { ...bare, ...out }
}

/**
 * Layer the sources. Later layers override earlier ones, so the order is a statement about trust:
 * the built-in table is the floor that always exists, the community dataset fills the gaps it does
 * not cover, and the vendor's own page wins for the models it actually lists.
 */
export function mergePricingLayers(layers: {
  builtin: Record<string, PriceEntry>
  community?: Record<string, PriceEntry> | null
  official?: Record<string, PriceEntry> | null
}): Record<string, PricedModel> {
  const merged: Record<string, PricedModel> = {}
  for (const [id, price] of Object.entries(layers.builtin)) merged[id] = { price, origin: 'builtin' }
  for (const [id, price] of Object.entries(layers.community ?? {})) merged[id] = { price, origin: 'community' }
  for (const [id, price] of Object.entries(layers.official ?? {})) merged[id] = { price, origin: 'official' }
  return merged
}

/** Fetch the dataset. Any failure returns null so the caller keeps its last good result. */
export async function fetchCommunityPricing(): Promise<Record<string, PriceEntry> | null> {
  try {
    const res = await fetch(COMMUNITY_PRICING_URL, {
      headers: { 'User-Agent': 'agentistics/1.0' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const data = await res.json() as Record<string, RawCommunityEntry>
    if (!data || typeof data !== 'object') return null
    const normalized = normalizeCommunityDataset(data)
    // A dataset that suddenly yields almost nothing means the shape changed; do not adopt it.
    return Object.keys(normalized).length < 50 ? null : normalized
  } catch {
    return null
  }
}
