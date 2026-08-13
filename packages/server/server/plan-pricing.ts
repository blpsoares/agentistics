/**
 * plan-pricing.ts — read SUBSCRIPTION prices off the vendors' own pages.
 *
 * The sibling of `pricing-official.ts`, which does this for per-token model rates, and it inherits
 * that module's hard-won rule verbatim:
 *
 * ── ANCHORED, OR NOTHING ─────────────────────────────────────────────────────────────────────
 * A vendor page is marketing, not an API. Prices appear several times (monthly beside annual,
 * per-seat beside per-org, a promotional figure beside the real one) with nothing in the markup
 * reliably marking which is which. So a parsed block is adopted ONLY IF a plan whose price was
 * verified by hand comes out at the expected figure. A redesign then yields NOTHING and the
 * built-in catalog stands, instead of yielding numbers that look right and are half wrong.
 *
 * This cannot guarantee a correct price. It guarantees the absence of a wrong one, which is the
 * only guarantee scraping can honestly make. Three reasons the distinction matters here:
 *
 *   • A price that is not published cannot be read. claude.com/pricing states "From $100 per
 *     month" for Max as a whole and never breaks out 5x from 20x — no parser extracts what is not
 *     written, so that entry stays blank by design.
 *   • These pages are GEOLOCALIZED. gemini.google/subscriptions serves Brazilian real to a
 *     Brazilian IP. That is arguably the right number for that user and definitely the wrong one
 *     to ship as "the" price, so the currency is read from the page rather than assumed.
 *   • A list price is not an invoice. Annual billing, grandfathered plans, team seats and tax all
 *     move it. Whatever the user types always wins over whatever this returns.
 *
 * Everything here is PURE except `fetchPlanPrices`. The parsers take a string and return a result
 * or null; they never throw, and they are tested against fixture markup.
 */

import type { BillingCurrency } from '@agentistics/core'

export interface ScrapedPlanPrice {
  planId: string
  amount: number
  currency: BillingCurrency
  /** The page it was read from — shown to the user beside the figure. */
  source: string
}

/** A plan whose price is known by hand. If the parse disagrees with it, the whole page is rejected. */
interface Anchor {
  planId: string
  amount: number
  currency: BillingCurrency
}

export const ANTHROPIC_PLANS_URL = 'https://claude.com/pricing'
export const COPILOT_PLANS_URL = 'https://github.com/features/copilot/plans'

/**
 * Verified by hand on 2026-08-12 against the pages above. These are the ONLY figures that decide
 * whether a scrape is trusted, so changing one is a deliberate act: re-check the page first.
 */
const ANTHROPIC_ANCHOR: Anchor = { planId: 'anthropic-pro', amount: 20, currency: 'USD' }
const COPILOT_ANCHOR: Anchor = { planId: 'copilot-pro', amount: 10, currency: 'USD' }

/** Tags out, entities decoded, whitespace collapsed. Vendor pages are markup soup; the price is
 *  in the TEXT, and matching against text is the only thing stable across a restyle. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim()
}

const CURRENCY_BY_SYMBOL: Record<string, BillingCurrency> = { 'R$': 'BRL', '$': 'USD', 'US$': 'USD' }

/** `$1.234,56` and `$1,234.56` are both understood — the same vendor serves both depending on
 *  where the request came from. Last separator is decimal only when 1-2 digits follow it. */
function toAmount(raw: string): number {
  const cleaned = raw.replace(/[.,]$/, '')
  const lastSep = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','))
  const tail = lastSep === -1 ? '' : cleaned.slice(lastSep + 1)
  return lastSep === -1 || tail.length > 2
    ? Number(cleaned.replace(/[.,]/g, ''))
    : Number(`${cleaned.slice(0, lastSep).replace(/[.,]/g, '')}.${tail}`)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Both languages, because the page is geolocalized and a Brazilian request gets Portuguese. */
const MONTHLY_RE = /month|m[êe]s|mensal/i
const ANNUAL_RE = /annual|anual|year|ano\b/i

/**
 * The MONTHLY price for `label`, or null.
 *
 * Three rules, every one of them put there by what these pages actually do:
 *
 *  1. THE LABEL MATCHES ON WORD BOUNDARIES. A bare substring search for "Pro" hits "Product" in
 *     GitHub's navigation, hundreds of characters before any plan card.
 *  2. THE FIRST PRICE IS OFTEN THE ANNUAL ONE. claude.com writes "Pro … $17 Per month with annual
 *     subscription discount ($200 billed up front). $20 if billed monthly" — taking the first
 *     amount reports $17 as the monthly price. So an amount is only a candidate when a monthly
 *     qualifier follows it, and never when an annual one does.
 *  3. THE QUALIFIER MUST COME BEFORE THE NEXT `$`. Without that, the "$200 billed up front" above
 *     sees the "$20 if billed monthly" that follows it and claims the qualifier as its own —
 *     reporting the up-front annual total as the monthly price, which is ten times over.
 */
export function monthlyPriceNear(
  text: string,
  label: string,
  window = 300,
): { amount: number; currency: BillingCurrency } | null {
  const labelRe = new RegExp(`\\b${escapeRe(label)}(?![\\w-])`, 'i')
  const found = labelRe.exec(text)
  if (!found) return null

  const slice = text.slice(found.index + found[0].length, found.index + found[0].length + window)
  const money = /(R\$|US\$|\$)\s*([\d.,]+)/g
  let m: RegExpExecArray | null
  while ((m = money.exec(slice)) !== null) {
    const after = slice.slice(m.index + m[0].length)
    const nextMoney = after.search(/(R\$|US\$|\$)\s*[\d.,]/)
    // Only the text belonging to THIS amount, never the next one's.
    const qualifier = after.slice(0, nextMoney === -1 ? 60 : Math.min(nextMoney, 60))
    if (ANNUAL_RE.test(qualifier)) continue
    if (!MONTHLY_RE.test(qualifier)) continue

    const amount = toAmount(m[2] as string)
    if (!Number.isFinite(amount) || amount <= 0) continue
    return { amount, currency: CURRENCY_BY_SYMBOL[m[1] as string] ?? 'USD' }
  }
  return null
}

/** Adopt the parsed set only when the anchor reproduces exactly. */
function anchored(
  found: Map<string, { amount: number; currency: BillingCurrency }>,
  anchor: Anchor,
  source: string,
): ScrapedPlanPrice[] {
  const got = found.get(anchor.planId)
  if (!got || got.amount !== anchor.amount || got.currency !== anchor.currency) return []
  return [...found].map(([planId, p]) => ({ planId, amount: p.amount, currency: p.currency, source }))
}

/**
 * claude.com/pricing.
 *
 * Max is deliberately absent: the page gives one "From $100" for the whole tier and never names
 * 5x or 20x beside a figure. Reading that floor as the 5x price would be an inference the user
 * cannot audit, and attaching it to 20x would simply be wrong.
 */
export function parseAnthropicPlans(html: string): ScrapedPlanPrice[] {
  const text = htmlToText(html)
  const found = new Map<string, { amount: number; currency: BillingCurrency }>()
  for (const [planId, label] of [
    ['anthropic-pro', 'Pro'],
    // NOT "Team": the page's navigation says "Team & Enterprise" long before the plan card, and
    // the seat price sits under this heading instead.
    ['anthropic-team', 'Standard seat'],
  ] as const) {
    const p = monthlyPriceNear(text, label)
    if (p) found.set(planId, p)
  }
  return anchored(found, ANTHROPIC_ANCHOR, ANTHROPIC_PLANS_URL)
}

/** github.com/features/copilot/plans. Business and Enterprise are absent from the page itself. */
export function parseCopilotPlans(html: string): ScrapedPlanPrice[] {
  const text = htmlToText(html)
  const found = new Map<string, { amount: number; currency: BillingCurrency }>()
  // Longest label first: "Pro+" contains "Pro", and matching the short one first would give both
  // ids the same figure.
  for (const [planId, label] of [
    ['copilot-pro-plus', 'Pro+'],
    ['copilot-max', 'Max'],
    ['copilot-pro', 'Pro'],
  ] as const) {
    const p = monthlyPriceNear(text, label)
    if (p) found.set(planId, p)
  }
  return anchored(found, COPILOT_ANCHOR, COPILOT_PLANS_URL)
}

export interface PlanPriceResult {
  prices: ScrapedPlanPrice[]
  fetchedAt: number
  /** Vendors whose page could not be read or failed their anchor. Named so the UI can say the
   *  figure is the built-in one rather than implying it is live. */
  failed: string[]
}

let cache: PlanPriceResult | null = null
const TTL_MS = 6 * 60 * 60 * 1000

/**
 * Fetch both pages. A failure of either is a missing price, never an error: the built-in catalog
 * is the floor and the user's own figure is above both.
 */
export async function fetchPlanPrices(now: number = Date.now()): Promise<PlanPriceResult> {
  if (cache && now - cache.fetchedAt < TTL_MS) return cache

  const sources: { url: string; parse: (html: string) => ScrapedPlanPrice[] }[] = [
    { url: ANTHROPIC_PLANS_URL, parse: parseAnthropicPlans },
    { url: COPILOT_PLANS_URL, parse: parseCopilotPlans },
  ]

  const prices: ScrapedPlanPrice[] = []
  const failed: string[] = []
  await Promise.all(sources.map(async ({ url, parse }) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(String(res.status))
      const got = parse(await res.text())
      if (got.length === 0) failed.push(url)
      else prices.push(...got)
    } catch {
      failed.push(url)
    }
  }))

  cache = { prices, fetchedAt: now, failed }
  return cache
}

/** Testing seam — the cache is module-level so a test can start from a known state. */
export function resetPlanPriceCache(): void {
  cache = null
}
