import { describe, test, expect } from 'bun:test'
import { PLAN_CATALOG, SENTINEL_PLAN_IDS, findPlan, plansForHarness } from './plan-catalog'
import { HARNESS_ORDER } from './types'
import { isBillingDay, dayIndex } from './billing'

describe('PLAN_CATALOG', () => {
  test('ids are unique', () => {
    const ids = PLAN_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every price states when it was checked and where it came from', () => {
    // The MODEL_PRICING rule, enforced mechanically: a wrong monthly price silently scales EVERY
    // cost on the dashboard, so a figure with no provenance must not exist.
    const today = dayIndex('2026-08-12') as number
    for (const entry of PLAN_CATALOG) {
      if (!entry.monthly) continue
      expect(entry.monthly.amount).toBeGreaterThan(0)
      expect(Number.isFinite(entry.monthly.amount)).toBe(true)
      expect(entry.monthly.source.length).toBeGreaterThan(0)
      expect(entry.monthly.source.startsWith('http')).toBe(true)
      expect(isBillingDay(entry.monthly.verifiedAt)).toBe(true)
      expect(dayIndex(entry.monthly.verifiedAt)).toBeLessThanOrEqual(today)
    }
  })

  test('an entry without a price explains itself', () => {
    // A blank amount with no note reads as an oversight; the note is what tells the user the
    // vendor's page does not state the figure, so typing it is expected rather than a workaround.
    for (const entry of PLAN_CATALOG) {
      if (entry.monthly) continue
      expect(entry.noteEn && entry.noteEn.length > 0).toBe(true)
      expect(entry.notePt && entry.notePt.length > 0).toBe(true)
    }
  })

  test('every suggested harness is a real harness', () => {
    // Never a hardcoded harness list: a typo here would silently mis-sort the picker forever.
    for (const entry of PLAN_CATALOG) {
      for (const harness of entry.suggestedHarnesses) {
        expect(HARNESS_ORDER).toContain(harness)
      }
    }
  })

  test('the sentinels exist and behave', () => {
    const payg = findPlan('api-payg')
    expect(payg?.mode).toBe('api')
    expect(payg?.monthly).toBeUndefined()
    expect(findPlan('other')?.mode).toBe('subscription')
    expect(findPlan('other')?.monthly).toBeUndefined()
    for (const id of SENTINEL_PLAN_IDS) expect(findPlan(id)).toBeDefined()
  })

  test('a subscription entry is never mode api and vice versa', () => {
    for (const entry of PLAN_CATALOG) {
      if (entry.monthly) expect(entry.mode).toBe('subscription')
    }
  })
})

describe('findPlan', () => {
  test('an unknown id yields undefined rather than throwing', () => {
    // A timeline written by a newer build must render as an unknown plan, not crash the page.
    expect(findPlan('from-the-future')).toBeUndefined()
    expect(findPlan('')).toBeUndefined()
  })
})

describe('plansForHarness', () => {
  test('orders but never filters — every entry is always returned', () => {
    // Antigravity runs Anthropic models, Kimi routes anywhere, and a gateway can put any model
    // behind any subscription. Hiding the "wrong" plan would be a guess dressed as simplification.
    for (const harness of HARNESS_ORDER) {
      expect(plansForHarness(harness)).toHaveLength(PLAN_CATALOG.length)
    }
  })

  test('suggested plans lead and sentinels trail', () => {
    const claude = plansForHarness('claude')
    expect(claude[0]!.id).toBe('anthropic-pro')
    expect(claude.slice(0, 4).every((e) => e.provider === 'anthropic')).toBe(true)
    expect(claude.slice(-2).map((e) => e.id)).toEqual(['api-payg', 'other'])

    const copilot = plansForHarness('copilot')
    expect(copilot[0]!.provider).toBe('github')
    expect(copilot.slice(-2).map((e) => e.id)).toEqual(['api-payg', 'other'])
  })

  test('a harness with no suggested plan still gets the full list, sentinels last', () => {
    const kimi = plansForHarness('kimi')
    expect(kimi[0]!.id).toBe('kimi-plus')
    expect(kimi.slice(-2).map((e) => e.id)).toEqual(['api-payg', 'other'])
  })
})
