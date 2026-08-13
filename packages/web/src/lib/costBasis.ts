/**
 * costBasis.ts — the one place a cost figure is converted for display.
 *
 * All arithmetic lives in `@agentistics/core/billing`; this is wiring plus one multiply. What it
 * really carries is a REFUSAL: asking for the plan basis when there is no usable plan cost does
 * NOT produce a number. It returns the API figure, flagged, so the surface can render N/A or say
 * which basis it actually used — a surface must never be able to fabricate a plan number by
 * passing the wrong argument.
 *
 * `allocated` travels with the value rather than being decided per call site, because a per-row
 * plan figure is an ALLOCATION — no row was individually billed — and a label that can be
 * forgotten will be.
 */
import type { CostBasis } from '@agentistics/core'

export interface CostView {
  usd: number
  /** The basis actually applied. May be `'api'` even when `'plan'` was requested. */
  basis: CostBasis
  /** The figure is a share of a plan cost, not a measurement of this row. */
  allocated: boolean
  /** The plan basis was requested and could not be produced. Render N/A, never this number. */
  unavailable: boolean
}

/**
 * Express one cost in the requested basis.
 *
 * `factor` is `C/A` for the scope this figure belongs to (`planAllocation`'s per-harness value, or
 * its aggregate). `null` means the plan cost is not computable there.
 */
export function viewCost(
  usd: number,
  opts: { basis: CostBasis; factor: number | null; allocated?: boolean },
): CostView {
  if (opts.basis === 'api') {
    return { usd, basis: 'api', allocated: false, unavailable: false }
  }
  if (opts.factor === null || !Number.isFinite(opts.factor)) {
    // The requested basis cannot be produced. Hand back the API figure AND say so — a caller that
    // ignores `unavailable` shows a real number under the wrong label, which is bad; one that
    // received a silent 0 would show a confident lie, which is worse.
    return { usd, basis: 'api', allocated: false, unavailable: true }
  }
  return {
    usd: usd * opts.factor,
    basis: 'plan',
    allocated: opts.allocated ?? false,
    unavailable: false,
  }
}

/**
 * The short marker a surface puts beside a converted figure.
 *
 * `null` when nothing needs saying — an API-basis figure on a page whose basis is API is simply
 * the number, and marking it would train people to ignore the marker that matters.
 */
export function costBasisMarker(view: CostView, lang: 'pt' | 'en'): string | null {
  const pt = lang === 'pt'
  if (view.unavailable) return pt ? 'sem plano cadastrado' : 'no registered plan'
  if (view.basis === 'api') return null
  if (view.allocated) return pt ? 'rateado' : 'allocated'
  return null
}

/**
 * The sentence under a plan-cost headline.
 *
 * It always names the WINDOW that was measured. That is the whole job: a user who filtered
 * "all time" and got a figure covering the last 90 days — because that is as far back as the
 * daily series reaches — has a correct number under a misleading heading, and only the window
 * corrects it. Partial coverage is stated in the same breath, in days, because "82%" of an
 * unstated period tells nobody anything.
 */
export function planCostSubtitle(args: {
  multiple: number | null
  window: { from: string; to: string } | null
  /** Days the plan actually covered. Named because it is what makes the figure non-round. */
  coveredDays: number
  uncoveredDays: number
  lang: 'pt' | 'en'
}): string {
  const { multiple, window, coveredDays, uncoveredDays, lang } = args
  const pt = lang === 'pt'
  const parts: string[] = []

  const mult = formatMultiple(multiple, lang)
  if (mult) parts.push(pt ? `${mult} o valor de API` : `${mult} the API value`)

  // "Why is a fixed monthly price showing R$2.069,65?" is the first question this figure raises,
  // and the answer is that the window is 126 days — not a whole number of months. Saying
  // "prorated" beside the day count answers it before it is asked; the window alone did not.
  if (coveredDays > 0) {
    parts.push(pt
      ? `${coveredDays} dia${coveredDays === 1 ? '' : 's'} rateados do seu mensal`
      : `${coveredDays} day${coveredDays === 1 ? '' : 's'} prorated from your monthly`)
  }
  if (window) {
    parts.push(pt ? `${window.from} a ${window.to}` : `${window.from} → ${window.to}`)
  }
  if (uncoveredDays > 0) {
    parts.push(pt
      ? `${uncoveredDays} sem plano cadastrado`
      : `${uncoveredDays} with no registered plan`)
  }

  return parts.join(' · ')
}

/** A multiple, for display. `null` stays `null` — an absent multiple is not "1×". */
export function formatMultiple(multiple: number | null, lang: 'pt' | 'en'): string | null {
  if (multiple === null || !Number.isFinite(multiple)) return null
  const decimals = multiple >= 100 ? 0 : multiple >= 10 ? 1 : 2
  const value = multiple.toFixed(decimals)
  return lang === 'pt' ? `${value.replace('.', ',')}×` : `${value}×`
}
