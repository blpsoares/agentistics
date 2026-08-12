import { describe, test, expect } from 'bun:test'
import {
  applyPlan,
  describeError,
  draftFromPeriod,
  draftMode,
  draftWantsPrice,
  emptyDraft,
  periodFromDraft,
  periodName,
  validateDraft,
} from './billingForm'
import { findPlan } from '@agentistics/core'
import type { BillingPeriod } from '@agentistics/core'

const id = () => 'bp_new'
const plan = (planId: string) => findPlan(planId)!

describe('applyPlan', () => {
  test('fills the amount from a verified catalog price', () => {
    const out = applyPlan(emptyDraft(), plan('anthropic-pro'))
    expect(out.planId).toBe('anthropic-pro')
    expect(out.amount).toBe('20')
    expect(out.currency).toBe('USD')
  })

  test('leaves the amount blank when the catalog has no verified price', () => {
    // The point of the provenance rule: a plan no vendor page prices must be typed from an
    // invoice, never inherited from a guess.
    const out = applyPlan(emptyDraft(), plan('anthropic-max-20x'))
    expect(out.planId).toBe('anthropic-max-20x')
    expect(out.amount).toBe('')
  })

  test('never overwrites an amount the user already typed', () => {
    // Re-picking the same plan to re-read its note must not discard their figure.
    const typed = { ...emptyDraft(), amount: '137.50' }
    expect(applyPlan(typed, plan('anthropic-pro')).amount).toBe('137.50')
  })

  test('picking pay-as-you-go clears the price entirely', () => {
    // An api period's cost is its API estimate; a monthly amount left on it would be added to a
    // cost that already contains it.
    const withPrice = { ...emptyDraft(), amount: '100', currency: 'BRL' as const }
    const out = applyPlan(withPrice, plan('api-payg'))
    expect(out.amount).toBe('')
    expect(out.currency).toBe('USD')
  })

  test('the label survives only for the "other" plan', () => {
    const named = { ...emptyDraft(), label: 'Corp gateway' }
    expect(applyPlan(named, plan('other')).label).toBe('Corp gateway')
    expect(applyPlan(named, plan('anthropic-pro')).label).toBe('')
  })
})

describe('draftMode / draftWantsPrice', () => {
  test('follows the catalog', () => {
    expect(draftMode({ ...emptyDraft(), planId: 'api-payg' })).toBe('api')
    expect(draftWantsPrice({ ...emptyDraft(), planId: 'api-payg' })).toBe(false)
    expect(draftWantsPrice({ ...emptyDraft(), planId: 'anthropic-pro' })).toBe(true)
  })

  test('an unknown id reads as a subscription', () => {
    // A period the user typed an amount for is one they pay monthly, whatever build wrote the id.
    expect(draftMode({ ...emptyDraft(), planId: 'from-a-newer-build' })).toBe('subscription')
  })
})

describe('periodFromDraft', () => {
  test('builds a complete subscription period', () => {
    const draft = { ...emptyDraft(), planId: 'anthropic-max-5x', amount: '100', from: '2026-01-01', ongoing: true }
    expect(periodFromDraft(draft, id)).toEqual({
      id: 'bp_new', mode: 'subscription', planId: 'anthropic-max-5x',
      from: '2026-01-01', price: { amount: 100, currency: 'USD' },
    })
  })

  test('editing preserves the id — an edit is never an insert', () => {
    const draft = { ...emptyDraft(), id: 'bp_existing', planId: 'anthropic-pro', amount: '20', from: '2026-01-01' }
    expect(periodFromDraft(draft, id).id).toBe('bp_existing')
  })

  test('ongoing omits `to` rather than resolving it to today', () => {
    const draft = { ...emptyDraft(), planId: 'anthropic-pro', amount: '20', from: '2026-01-01', to: '2026-05-05', ongoing: true }
    expect(periodFromDraft(draft, id).to).toBeUndefined()
  })

  test('a closed period keeps its end date', () => {
    const draft = { ...emptyDraft(), planId: 'anthropic-pro', amount: '20', from: '2026-01-01', to: '2026-05-05', ongoing: false }
    expect(periodFromDraft(draft, id).to).toBe('2026-05-05')
  })

  test('a comma decimal is read as a decimal, not truncated', () => {
    // pt-BR keyboards type 24,99 — reading that as 24 would silently under-price every month.
    const draft = { ...emptyDraft(), planId: 'other', label: 'X', amount: '24,99', from: '2026-01-01' }
    expect(periodFromDraft(draft, id).price?.amount).toBeCloseTo(24.99, 9)
  })

  test('an api period never carries a price, even if one was typed', () => {
    const draft = { ...emptyDraft(), planId: 'api-payg', amount: '100', from: '2026-01-01' }
    expect(periodFromDraft(draft, id).price).toBeUndefined()
  })

  test('a blank amount produces no price rather than a zero', () => {
    const draft = { ...emptyDraft(), planId: 'anthropic-pro', amount: '', from: '2026-01-01' }
    expect(periodFromDraft(draft, id).price).toBeUndefined()
  })
})

describe('validateDraft', () => {
  const existing: BillingPeriod[] = [
    { id: 'bp_a', mode: 'subscription', planId: 'anthropic-pro', from: '2026-01-01', to: '2026-03-31', price: { amount: 20, currency: 'USD' } },
  ]

  test('a sound draft has no issues', () => {
    const draft = { ...emptyDraft(), planId: 'anthropic-max-5x', amount: '100', from: '2026-04-01' }
    expect(validateDraft(draft, existing, id)).toEqual([])
  })

  test('an overlap with an existing period is reported', () => {
    const draft = { ...emptyDraft(), planId: 'anthropic-max-5x', amount: '100', from: '2026-03-01' }
    expect(validateDraft(draft, existing, id).map(e => e.code)).toEqual(['overlap'])
  })

  test('editing a period does not report it overlapping itself', () => {
    const draft = draftFromPeriod(existing[0]!)
    expect(validateDraft(draft, existing, id)).toEqual([])
  })

  test('a missing amount is reported, not defaulted', () => {
    const draft = { ...emptyDraft(), planId: 'anthropic-max-20x', amount: '', from: '2026-04-01' }
    expect(validateDraft(draft, existing, id).map(e => e.code)).toEqual(['missing_price'])
  })

  test('an empty draft asks for the start date and the plan', () => {
    expect(validateDraft(emptyDraft(), [], id).map(e => e.code).sort()).toEqual(['missing_from', 'missing_plan', 'missing_price'])
  })
})

describe('describeError', () => {
  test('an overlap names the other plan, never its index', () => {
    // A list the user just re-sorted makes "period 2" meaningless.
    const msg = describeError({ code: 'overlap', withId: 'bp_a' }, 'en', 'Claude Pro')
    expect(msg).toContain('Claude Pro')
    expect(msg).not.toMatch(/\b\d+\b/)
  })

  test('falls back to a generic sentence when the other plan has no name', () => {
    expect(describeError({ code: 'overlap', withId: 'bp_a' }, 'en')).toContain('overlaps another')
  })

  test('every code has a distinct sentence in both languages', () => {
    const codes = [
      { code: 'missing_from' as const },
      { code: 'bad_day' as const, field: 'from' as const, value: 'x' },
      { code: 'inverted_range' as const, from: 'a', to: 'b' },
      { code: 'missing_plan' as const },
      { code: 'missing_label' as const },
      { code: 'missing_price' as const },
      { code: 'non_positive_price' as const, amount: 0 },
      { code: 'price_on_non_subscription' as const, mode: 'api' as const },
      { code: 'overlap' as const, withId: 'x' },
    ]
    for (const c of codes) {
      const en = describeError(c, 'en')
      const ptText = describeError(c, 'pt')
      expect(en.length).toBeGreaterThan(0)
      expect(ptText.length).toBeGreaterThan(0)
      expect(en).not.toBe(ptText)
    }
  })
})

describe('periodName', () => {
  test('prefers the user label, then the catalog, then the raw id', () => {
    expect(periodName({ id: 'a', mode: 'subscription', from: '2026-01-01', label: 'Mine' })).toBe('Mine')
    expect(periodName({ id: 'a', mode: 'subscription', from: '2026-01-01', planId: 'anthropic-pro' })).toBe('Claude Pro')
    expect(periodName({ id: 'a', mode: 'subscription', from: '2026-01-01', planId: 'from-the-future' })).toBe('from-the-future')
  })
})
