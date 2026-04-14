import { MODEL_PRICING } from '../src/lib/types'
import type { PriceEntry, RatesCache } from '../src/lib/types'

// Use MODEL_PRICING from src/lib/types.ts as the canonical fallback
const FALLBACK_PRICING: Record<string, PriceEntry> = MODEL_PRICING

/** Model name (as shown in pricing table) → canonical model ID */
const PRICING_PAGE_MODEL_MAP: Record<string, string> = {
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
      return { pricing: { ...FALLBACK_PRICING, ...parsed }, source: 'live' }
    }
    console.warn('[rates] Anthropic pricing parse returned no results, using fallback')
  } catch (err) {
    console.warn('[rates] Anthropic pricing fetch failed:', String(err))
  }
  return { pricing: FALLBACK_PRICING, source: 'fallback' }
}

let ratesCache: RatesCache | null = null
const RATES_TTL_MS = 30 * 60 * 1000 // 30 minutes

export async function getRates(): Promise<RatesCache> {
  const now = Date.now()
  if (ratesCache && now - ratesCache.fetchedAt < RATES_TTL_MS) return ratesCache

  const [brlRate, { pricing, source: pricingSource }] = await Promise.all([
    fetchBrlRate(),
    fetchAnthropicPricing(),
  ])

  ratesCache = { fetchedAt: now, brlRate, pricing, pricingSource }
  console.log(`[rates] BRL=${brlRate.toFixed(2)} pricing=${pricingSource}`)
  return ratesCache
}
