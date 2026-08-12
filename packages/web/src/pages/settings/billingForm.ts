/**
 * billingForm.ts — PURE: the billing period form's draft shape, its prefill and its refusals.
 *
 * Extracted from `BillingSettings.tsx` so the rules can be tested without mounting a drawer, the
 * same split `accountForm.ts` uses. The SEMANTICS live in `@agentistics/core/billing`
 * (`validatePeriod`); this file only maps a form's strings to and from a `BillingPeriod` and
 * decides what the catalog contributes.
 */
import {
  findPlan,
  validatePeriod,
  type BillingCurrency,
  type BillingMode,
  type BillingPeriod,
  type BillingPeriodError,
  type PlanCatalogEntry,
} from '@agentistics/core'

export interface PeriodDraft {
  /** Empty for a new period; the existing id when editing, so an edit never becomes an insert. */
  id: string
  planId: string
  /** Only meaningful for `planId === 'other'`. */
  label: string
  /** As typed. Kept as a string so a half-typed "1" is not read as one dollar. */
  amount: string
  currency: BillingCurrency
  from: string
  to: string
  /** `to` is empty AND the period is declared open-ended. Distinct from "the user has not typed
   *  the end date yet", which must not silently become "this plan is still active". */
  ongoing: boolean
}

export function emptyDraft(): PeriodDraft {
  return { id: '', planId: '', label: '', amount: '', currency: 'USD', from: '', to: '', ongoing: true }
}

export function draftFromPeriod(period: BillingPeriod): PeriodDraft {
  return {
    id: period.id,
    planId: period.planId ?? '',
    label: period.label ?? '',
    amount: period.price ? String(period.price.amount) : '',
    currency: period.price?.currency ?? 'USD',
    from: period.from,
    to: period.to ?? '',
    ongoing: period.to === undefined,
  }
}

/**
 * Apply a catalog choice to the draft.
 *
 * The amount is filled ONLY when the catalog actually has a verified figure. An entry without one
 * leaves the field blank and required, which is the whole point of the catalog's provenance rule:
 * a plan whose price no vendor page states must be typed from an invoice, not inherited from a
 * guess. An amount the user has ALREADY typed is never overwritten — re-picking the same plan to
 * re-read its note would otherwise silently discard their figure.
 */
export function applyPlan(draft: PeriodDraft, entry: PlanCatalogEntry): PeriodDraft {
  const next: PeriodDraft = { ...draft, planId: entry.id }

  if (entry.mode !== 'subscription') {
    // A non-subscription period has no monthly price by definition; carrying one over from a
    // previous choice would be stored and then double-counted.
    return { ...next, amount: '', currency: 'USD', label: '' }
  }

  if (entry.monthly && draft.amount.trim() === '') {
    next.amount = String(entry.monthly.amount)
    next.currency = entry.monthly.currency
  }
  if (entry.id !== 'other') next.label = ''
  return next
}

/** The mode a draft's plan implies. Unknown ids read as a subscription: a period the user typed
 *  an amount for is one they pay monthly, whatever build wrote the id. */
export function draftMode(draft: PeriodDraft): BillingMode {
  return findPlan(draft.planId)?.mode ?? 'subscription'
}

/** True when the amount field should be shown at all. */
export function draftWantsPrice(draft: PeriodDraft): boolean {
  return draftMode(draft) === 'subscription'
}

/**
 * The draft as a period. Always produces one — validation is a separate question, so the form can
 * show errors against a half-filled row rather than refusing to represent it.
 */
export function periodFromDraft(draft: PeriodDraft, newId: () => string): BillingPeriod {
  const mode = draftMode(draft)
  const amount = Number(draft.amount.replace(',', '.'))
  const period: BillingPeriod = {
    id: draft.id || newId(),
    mode,
    from: draft.from,
  }
  if (draft.planId) period.planId = draft.planId
  if (draft.planId === 'other' && draft.label.trim()) period.label = draft.label.trim()
  if (!draft.ongoing && draft.to) period.to = draft.to
  if (mode === 'subscription' && draft.amount.trim() !== '' && Number.isFinite(amount)) {
    period.price = { amount, currency: draft.currency }
  }
  return period
}

/**
 * Everything wrong with the draft, in the context of the timeline it is joining.
 *
 * `others` is the FULL period list; `validatePeriod` skips the draft's own id, so editing a period
 * never reports it overlapping its previous self.
 */
export function validateDraft(
  draft: PeriodDraft,
  others: readonly BillingPeriod[],
  newId: () => string = () => 'draft',
): BillingPeriodError[] {
  return validatePeriod(periodFromDraft(draft, newId), others)
}

/**
 * One sentence per error, in the user's language.
 *
 * Rendered INLINE under the offending field, never as a toast: on a phone the form is a
 * full-screen drawer, and a toast over it is a message read once and impossible to re-read.
 */
export function describeError(error: BillingPeriodError, lang: 'pt' | 'en', planName?: string): string {
  const pt = lang === 'pt'
  switch (error.code) {
    case 'missing_from':
      return pt ? 'Informe a data de início.' : 'Enter the start date.'
    case 'bad_day':
      return pt
        ? `"${error.value}" não é uma data válida.`
        : `"${error.value}" is not a valid date.`
    case 'inverted_range':
      return pt
        ? 'A data de término é anterior à de início.'
        : 'The end date comes before the start date.'
    case 'missing_plan':
      return pt ? 'Escolha um plano.' : 'Choose a plan.'
    case 'missing_label':
      return pt ? 'Dê um nome a este plano.' : 'Give this plan a name.'
    case 'missing_price':
      return pt
        ? 'Informe quanto você paga por mês.'
        : 'Enter what you pay per month.'
    case 'non_positive_price':
      return pt ? 'O valor precisa ser maior que zero.' : 'The amount must be greater than zero.'
    case 'price_on_non_subscription':
      return pt
        ? 'Este tipo de cobrança não tem valor mensal.'
        : 'This billing type has no monthly amount.'
    case 'overlap':
      // Named by plan, never by index: a list the user just re-sorted makes "period 2" meaningless.
      return planName
        ? (pt
            ? `Este período se sobrepõe a "${planName}". Dois planos não podem cobrir o mesmo dia.`
            : `This period overlaps "${planName}". Two plans cannot cover the same day.`)
        : (pt
            ? 'Este período se sobrepõe a outro. Dois planos não podem cobrir o mesmo dia.'
            : 'This period overlaps another. Two plans cannot cover the same day.')
  }
}

/** The display name of a period: its own label, else the catalog's, else the raw id. */
export function periodName(period: BillingPeriod): string {
  if (period.label) return period.label
  const entry = period.planId ? findPlan(period.planId) : undefined
  return entry?.label ?? period.planId ?? ''
}
