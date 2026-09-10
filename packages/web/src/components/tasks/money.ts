/**
 * money.ts — the board prices in the reader's OWN currency AND basis, like every other screen.
 *
 * `fmtUSD` was the board's own formatter and it hardcoded a dollar sign, so a dashboard set to BRL
 * — the header, the cost page, the session cards, all of it in `R$` — answered `$12.07` on the one
 * screen whose entire subject is what work COST. Nothing was wrong with the number; it was labelled
 * with a currency the reader does not pay in, which is the same class of error as an unlabelled
 * total: it invites a comparison that is off by the exchange rate.
 *
 * The conversion is `@agentistics/core`'s `fmtCost` and the rate is the one `/api/rates` already
 * cached for the rest of the app, read off the page's own `AppContext`. Neither is re-derived here:
 * a second rate is a second answer, and the board would then disagree with the header above it.
 *
 * **The header's API/Plan switch used to do nothing here** — every figure on the board stayed in
 * API terms no matter which basis was selected, because this hook never read `costBasis` at all.
 * `viewCost` (`../../lib/costBasis`) is what every other screen applies before formatting, and the
 * factor is `planAllocation(...).aggregateFactor` — the CROSS-HARNESS one, never a single harness's
 * `byHarness[h]` — because a board row (a delivery, an attempt) sums sessions that can span several
 * harnesses, exactly the case `aggregateFactor` exists for (see `CostsPage`/`HomePage`/
 * `TopUsagePage`, which already apply it the same way). `viewCost` REFUSES rather than invents: a
 * plan basis with no usable factor comes back as the API figure, so a board with no registered plan
 * reads exactly as it did before this fix.
 *
 * `null` stays `N/A`. A delivery nobody could price is not a delivery that cost nothing, and the
 * conversion must not turn one into `R$0,00`.
 */

import { useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { fmtCost, planAllocation } from '@agentistics/core'
import { NA } from './board'
import { viewCost } from '../../lib/costBasis'
import type { AppContext } from '../../lib/app-context'

export type Money = (usd: number | null | undefined) => string

/** The formatter with nothing to read the preference from — dollars, unconverted. */
export const usdOnly: Money = n => (n === null || n === undefined ? NA : fmtCost(n))

/**
 * Every board surface renders under a route, so the page's context is there to be read.
 *
 * It is read DEFENSIVELY all the same: a component mounted outside a router (a test, a future
 * embed) gets dollars rather than a crash, which is the one behaviour that cannot mislead — an
 * unconverted figure under its own `USD` label is true.
 */
export function useMoney(): Money {
  const ctx = useOutletContext<AppContext | null>()
  const currency = ctx?.currency ?? 'USD'
  const rate = ctx?.brlRate ?? 1
  const costBasis = ctx?.costBasis ?? 'api'
  const planBasis = ctx?.planBasis?.basis ?? null
  const factor = costBasis === 'plan' && planBasis ? planAllocation(planBasis).aggregateFactor : null
  return useCallback(
    n => {
      if (n === null || n === undefined) return NA
      const view = viewCost(n, { basis: costBasis, factor, allocated: true })
      return fmtCost(view.usd, currency, rate)
    },
    [currency, rate, costBasis, factor],
  )
}
