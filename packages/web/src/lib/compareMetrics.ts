/**
 * compareMetrics.ts — PURE: the curated A / B / Δ row set for the compare page's filter mode.
 *
 * Curated on purpose. `useDerivedStats` returns ~48 fields and a table of all of them is a data
 * dump, not a comparison; these are the ones that answer "which of these two is better, and by how
 * much". Everything here is arithmetic and labelling — no React, fully tested.
 *
 * ── THE TWO RULES THAT MATTER ────────────────────────────────────────────────────────────────
 * 1. A ROW HAS ONE BASIS. If the plan basis is on but only one side has a usable plan cost, the
 *    cost row falls back to API for BOTH columns. One column in plan basis beside one in API basis
 *    is not a comparison — it is two different questions in the same row, with a Δ between them
 *    that means nothing.
 * 2. A DELTA THAT CANNOT BE STATED IS `null`, NEVER A NUMBER. Growing from zero is not "+∞%" and
 *    not "+100%"; a missing side is not zero. Both come out as `null`, which the UI renders as a
 *    dash — the same N/A-versus-a-confident-0 discipline the rest of the product applies.
 */

export type MetricPolarity = 'lower-better' | 'higher-better' | 'neutral'
export type DeltaTone = 'good' | 'bad' | 'flat' | 'na'
export type MetricFormat = 'cost' | 'count' | 'tokens' | 'percent' | 'multiple' | 'rate'
export type MetricBasis = 'api' | 'plan'

export interface CompareMetricDef {
  key: string
  labelEn: string
  labelPt: string
  polarity: MetricPolarity
  format: MetricFormat
  /** A row pinned to one basis whatever the page toggle says. */
  fixedBasis?: MetricBasis
}

/** Everything one side of the comparison contributes. `null` means "not available for this side". */
export interface CompareSide {
  costUSD: number | null
  /** C for this side's filter. `null` when the plan basis is not computable there. */
  planCostUSD: number | null
  planMultiple: number | null
  effectiveCostPerMTokens: number | null
  tokens: number | null
  sessions: number | null
  messages: number | null
  cacheHitRate: number | null
}

export interface CompareRow {
  metric: CompareMetricDef
  a: number | null
  b: number | null
  /** `b - a`. `null` when either side is missing. */
  delta: number | null
  /** `(b - a) / a`. `null` when either side is missing OR `a` is zero — growth from nothing has
   *  no percentage, and printing one would be inventing a denominator. */
  deltaPct: number | null
  tone: DeltaTone
  /** The basis this row was actually rendered in. */
  basis: MetricBasis
}

export const COMPARE_METRICS: readonly CompareMetricDef[] = [
  { key: 'cost', labelEn: 'Cost', labelPt: 'Custo', polarity: 'lower-better', format: 'cost' },
  { key: 'planMultiple', labelEn: 'Plan value multiple', labelPt: 'Múltiplo do plano', polarity: 'higher-better', format: 'multiple', fixedBasis: 'plan' },
  { key: 'effectiveCostPerMTokens', labelEn: 'Effective $/1M tokens', labelPt: 'Custo efetivo por 1M tokens', polarity: 'lower-better', format: 'rate' },
  { key: 'tokens', labelEn: 'Tokens', labelPt: 'Tokens', polarity: 'neutral', format: 'tokens' },
  { key: 'sessions', labelEn: 'Sessions', labelPt: 'Sessões', polarity: 'higher-better', format: 'count' },
  { key: 'messages', labelEn: 'Messages', labelPt: 'Mensagens', polarity: 'neutral', format: 'count' },
  { key: 'tokensPerSession', labelEn: 'Tokens per session', labelPt: 'Tokens por sessão', polarity: 'neutral', format: 'tokens' },
  // Cache is always an API-basis fact: it does not reduce a subscription bill, it extends a rate
  // limit. Same reason CacheHitRatePanel never converts.
  { key: 'cacheHitRate', labelEn: 'Cache hit rate', labelPt: 'Taxa de acerto do cache', polarity: 'higher-better', format: 'percent', fixedBasis: 'api' },
]

const ratio = (n: number | null, d: number | null): number | null =>
  n === null || d === null || d === 0 ? null : n / d

function valueFor(side: CompareSide, key: string, basis: MetricBasis): number | null {
  switch (key) {
    case 'cost': return basis === 'plan' ? side.planCostUSD : side.costUSD
    case 'planMultiple': return side.planMultiple
    case 'effectiveCostPerMTokens':
      return basis === 'plan'
        ? side.effectiveCostPerMTokens
        : ratio(side.costUSD, side.tokens === null ? null : side.tokens / 1_000_000)
    case 'tokens': return side.tokens
    case 'sessions': return side.sessions
    case 'messages': return side.messages
    case 'tokensPerSession': return ratio(side.tokens, side.sessions)
    case 'cacheHitRate': return side.cacheHitRate
    default: return null
  }
}

function toneFor(delta: number | null, polarity: MetricPolarity): DeltaTone {
  if (delta === null) return 'na'
  if (delta === 0) return 'flat'
  if (polarity === 'neutral') return 'flat'
  const better = polarity === 'lower-better' ? delta < 0 : delta > 0
  return better ? 'good' : 'bad'
}

/**
 * Build the table.
 *
 * `basis` is the page's toggle. A row whose `fixedBasis` disagrees keeps its own, and the cost
 * row degrades to API when either side cannot produce a plan cost — see rule 1 in the header.
 */
export function buildCompareRows(a: CompareSide, b: CompareSide, basis: MetricBasis): CompareRow[] {
  const rows: CompareRow[] = []

  for (const metric of COMPARE_METRICS) {
    let rowBasis: MetricBasis = metric.fixedBasis ?? basis

    // The whole row falls back together, never one column at a time.
    if (rowBasis === 'plan' && metric.key !== 'planMultiple') {
      if (a.planCostUSD === null || b.planCostUSD === null) rowBasis = 'api'
    }

    const va = valueFor(a, metric.key, rowBasis)
    const vb = valueFor(b, metric.key, rowBasis)

    // A row pinned to the plan basis is simply absent when neither side has one — showing it
    // empty in every column is a row that only ever says "no".
    if (metric.fixedBasis === 'plan' && va === null && vb === null) continue

    const delta = va === null || vb === null ? null : vb - va
    const deltaPct = delta === null || va === null || va === 0 ? null : delta / va

    rows.push({ metric, a: va, b: vb, delta, deltaPct, tone: toneFor(delta, metric.polarity), basis: rowBasis })
  }

  return rows
}
