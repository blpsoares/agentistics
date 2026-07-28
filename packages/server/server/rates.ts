import { MODEL_PRICING } from '@agentistics/core'
import type { PriceEntry, RatesCache } from '@agentistics/core'
import { fetchCommunityPricing, mergePricingLayers, type PriceOrigin } from './pricing-community'

// Use MODEL_PRICING from src/lib/types.ts as the canonical fallback
const FALLBACK_PRICING: Record<string, PriceEntry> = MODEL_PRICING

/** Model name (as shown in pricing table) → canonical model ID */
const PRICING_PAGE_MODEL_MAP: Record<string, string> = {
  // Newer rows first — the map is what lets the live scrape reach a model at all. Missing entries
  // are silent: `opus 4.8` and `opus 5` were absent, so the scrape never returned them and both
  // fell through to the shared fallback (Sonnet's $3/$15) instead of Opus's $5/$25.
  'fable 5':    'claude-fable-5',
  'mythos 5':   'claude-mythos-5',
  'opus 5':     'claude-opus-5',
  'opus 4.8':   'claude-opus-4-8',
  'opus 4.7':   'claude-opus-4-7',
  'sonnet 5':   'claude-sonnet-5',
  'opus 4.6':   'claude-opus-4-6',
  'opus 4.5':   'claude-opus-4-5-20251101',
  'opus 4.1':   'claude-opus-4-1-20250805',
  'opus 4':     'claude-opus-4-20250514',
  'sonnet 4.6': 'claude-sonnet-4-6',
  'sonnet 4.5': 'claude-sonnet-4-5-20250929',
  'sonnet 4':   'claude-sonnet-4-20250514',
  'haiku 4.5':  'claude-haiku-4-5-20251001',
  'haiku 3.5':  'claude-haiku-3-5-20241022',
  'haiku 3':    'claude-3-haiku-20240307',
}

export function parseAnthropicPricing(html: string): Record<string, PriceEntry> | null {
  const pricing: Record<string, PriceEntry> = {}

  // The pricing table has rows like:
  // <tr><td>Claude Opus 4.6</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
  // Columns: Model | Base Input | 5m Cache Write | 1h Cache Write | Cache Read | Output
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1]!
    const cells: string[] = []
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(row)) !== null) {
      cells.push(cellMatch[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    }
    if (cells.length < 5) continue

    const nameCell = cells[0]!.toLowerCase()
    if (!nameCell.includes('claude')) continue

    let modelId: string | null = null
    // Longer keys first so "opus 4.6" matches before "opus 4"
    const keys = Object.keys(PRICING_PAGE_MODEL_MAP).sort((a, b) => b.length - a.length)
    for (const key of keys) {
      if (nameCell.includes(key)) {
        modelId = PRICING_PAGE_MODEL_MAP[key] ?? null
        break
      }
    }
    if (!modelId) continue

    const price = (s: string) => parseFloat(s.replace(/[^0-9.]/g, ''))
    const input      = price(cells[1]!) // Base Input
    const cacheWrite = price(cells[2]!) // 5m Cache Write
    // cells[3] = 1h Cache Write (skip)
    const cacheRead  = price(cells[4]!) // Cache Read
    const output     = price(cells[5] ?? '') // Output (may be cells[4] if table only has 5 cols)

    if (!isNaN(input) && input > 0) {
      pricing[modelId] = {
        input,
        output:     isNaN(output)     ? input * 5  : output,
        cacheRead:  isNaN(cacheRead)  ? input * 0.1  : cacheRead,
        cacheWrite: isNaN(cacheWrite) ? input * 1.25 : cacheWrite,
      }
    }
  }

  return Object.keys(pricing).length >= 3 ? pricing : null
}

export async function fetchBrlRate(): Promise<number> {
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as Record<string, { bid: string }>
    const rate = parseFloat(json?.USDBRL?.bid ?? '')
    if (!isNaN(rate) && rate > 1 && rate < 20) return rate
  } catch (err) {
    console.warn('[rates] BRL fetch failed:', String(err))
  }
  return 5.70 // fallback
}

/** Anthropic's own page, for Claude models only. Returns just what it parsed — the layering below
 *  decides how it combines with the other sources. */
export async function fetchAnthropicPricing(): Promise<{ pricing: Record<string, PriceEntry>; source: 'live' | 'fallback' }> {
  try {
    const res = await fetch('https://platform.claude.com/docs/en/about-claude/pricing', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; agentistics/1.0; +https://github.com)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const parsed = parseAnthropicPricing(html)
    if (parsed) {
      console.log('[rates] Anthropic pricing fetched live:', Object.keys(parsed).join(', '))
      // ONLY what the page actually stated. Merging the built-in table in here used to relabel
      // every fallback row as "official", which is precisely the false confidence this whole
      // provenance chain exists to prevent.
      return { pricing: parsed, source: 'live' }
    }
    console.warn('[rates] Anthropic pricing parse returned no results, using fallback')
  } catch (err) {
    console.warn('[rates] Anthropic pricing fetch failed:', String(err))
  }
  return { pricing: FALLBACK_PRICING, source: 'fallback' }
}

let ratesCache: RatesCache | null = null
const RATES_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** Per-model provenance for the merged table, so the UI can show where each number came from
 *  instead of implying every row is equally fresh. Kept alongside the cache, not inside
 *  RatesCache, so the existing /api/rates shape is untouched. */
let originsCache: Record<string, PriceOrigin> = {}
let communityFetchedAt = 0
let communityOk = false

export function getPricingOrigins(): {
  origins: Record<string, PriceOrigin>
  communityFetchedAt: number
  communityOk: boolean
} {
  return { origins: originsCache, communityFetchedAt, communityOk }
}

export async function getRates(): Promise<RatesCache> {
  const now = Date.now()
  if (ratesCache && now - ratesCache.fetchedAt < RATES_TTL_MS) return ratesCache

  const [brlRate, anthropic, community] = await Promise.all([
    fetchBrlRate(),
    fetchAnthropicPricing(),
    fetchCommunityPricing(),
  ])

  // Trust order, lowest first. The built-in table is the floor and is always present, so a source
  // that fails or returns junk costs us freshness, never the ability to price anything.
  const merged = mergePricingLayers({
    builtin: FALLBACK_PRICING,
    community,
    official: anthropic.source === 'live' ? anthropic.pricing : null,
  })

  const pricing: Record<string, PriceEntry> = {}
  const origins: Record<string, PriceOrigin> = {}
  for (const [id, { price, origin }] of Object.entries(merged)) {
    pricing[id] = price
    origins[id] = origin
  }
  originsCache = origins
  communityOk = community !== null
  if (community) communityFetchedAt = now

  const pricingSource: 'live' | 'fallback' =
    anthropic.source === 'live' || community ? 'live' : 'fallback'

  ratesCache = { fetchedAt: now, brlRate, pricing, pricingSource }
  const counts = Object.values(origins).reduce<Record<string, number>>((a, o) => {
    a[o] = (a[o] ?? 0) + 1; return a
  }, {})
  console.log(`[rates] BRL=${brlRate.toFixed(2)} models=${Object.keys(pricing).length} `
    + `official=${counts.official ?? 0} community=${counts.community ?? 0} builtin=${counts.builtin ?? 0}`)
  return ratesCache
}
