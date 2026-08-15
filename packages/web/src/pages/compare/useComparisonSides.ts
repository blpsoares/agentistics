import { useMemo } from 'react'
import type { BillingSettings, ComparisonSide, Filters } from '@agentistics/core'
import type { AppData } from '@agentistics/core'
import { totalTokens } from '@agentistics/core'
import { computeDerivedStats } from '../../hooks/useData'
import { computePlanBasisView } from '../../hooks/usePlanBasis'
import type { CompareSide } from '../../lib/compareMetrics'
import type { TagDef } from '../../lib/tagMatch'

/**
 * Derive one `CompareSide` per comparison side.
 *
 * ONE `useMemo` over N scopes, not N hooks: the number of sides is dynamic and the rules of hooks
 * forbid a varying call count. That is why `computeDerivedStats` was extracted from
 * `useDerivedStats` — the derivation is pure, so it can simply be mapped over.
 *
 * Each side computes its OWN plan basis. The two filters have different windows, so they cannot
 * share the app-level one, and a plan cost taken from the wrong window would be compared against
 * an API cost from the right one.
 */
export function useComparisonSides(args: {
  data: AppData
  sides: readonly ComparisonSide[]
  billing: BillingSettings
  brlRate: number
  tags: TagDef[]
}): CompareSide[] {
  const { data, sides, billing, brlRate, tags } = args
  return useMemo(
    () => sides.map(s => deriveSide(data, s.filters, billing, brlRate, tags)),
    [data, sides, billing, brlRate, tags],
  )
}

const EMPTY: CompareSide = {
  costUSD: null, planCostUSD: null, planMultiple: null,
  tokens: null, sessions: null, messages: null, cacheHitRate: null,
}

function deriveSide(
  data: AppData,
  filters: Filters,
  billing: BillingSettings,
  brlRate: number,
  tags: TagDef[],
): CompareSide {
  const derived = computeDerivedStats(data, filters, tags)
  if (!derived) return EMPTY

  const view = computePlanBasisView({
    apiCostByDay: derived.apiCostByDay,
    billing,
    brlRate,
    filters,
  })
  const usable = view.basis?.coverage.computable ? view.basis : null

  return {
    costUSD: derived.totalCostUSD,
    planCostUSD: usable ? usable.planCostUSD : null,
    planMultiple: usable?.multiple ?? null,
    // Every billed counter. Two of the four made each side of the comparison report ~0,3 % of its
    // real volume — and unequally, since how much a harness caches varies, so the comparison was
    // not even wrong by a constant factor.
    tokens: totalTokens(derived.tokenTotals),
    sessions: derived.totalSessions,
    messages: derived.totalMessages,
    cacheHitRate: derived.cacheHitRate,
  }
}
