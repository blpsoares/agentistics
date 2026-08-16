import { describe, test, expect } from 'bun:test'
import { detectBilling, detectCodexBilling } from './billingDetect'
import type { BillingSignals, CodexSignals } from './billingDetect'
import { findPlan } from './plan-catalog'

const empty: BillingSignals = { env: {}, hasApiKeyHelper: false }
const signals = (patch: Partial<BillingSignals>): BillingSignals => ({ ...empty, ...patch })

describe('detectBilling — the chain', () => {
  test('1. third-party routing wins', () => {
    for (const key of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_BASE_URL'] as const) {
      const d = detectBilling(signals({ env: { [key]: key === 'ANTHROPIC_BASE_URL' ? 'https://gw.corp' : '1' } }))
      expect(d.mode).toBe('thirdparty')
      expect(d.source).toBe('env_thirdparty')
      expect(d.evidenceEn).toContain(key)
    }
  })

  test('1. first hit wins — routing beats a real subscription', () => {
    // The account may hold a perfectly valid Max plan that has nothing to do with the traffic
    // going through the gateway. Reading the subscription first would price a gateway's work
    // against a plan it never touched.
    const d = detectBilling(signals({
      env: { CLAUDE_CODE_USE_BEDROCK: '1' },
      oauth: { billingType: 'stripe_subscription', organizationRateLimitTier: 'default_claude_max_20x' },
    }))
    expect(d.mode).toBe('thirdparty')
  })

  test('1. a falsy env value is not a signal', () => {
    for (const value of ['', '0', 'false']) {
      expect(detectBilling(signals({ env: { CLAUDE_CODE_USE_BEDROCK: value } })).source).toBe('none')
    }
  })

  test('2. the oauth tier pins the exact plan', () => {
    const max20 = detectBilling(signals({ oauth: { billingType: 'stripe_subscription', organizationRateLimitTier: 'default_claude_max_20x' } }))
    expect(max20).toMatchObject({ mode: 'subscription', planId: 'anthropic-max-20x', source: 'claude_json_oauth', confidence: 'exact' })

    const max5 = detectBilling(signals({ oauth: { billingType: 'stripe_subscription', organizationRateLimitTier: 'default_claude_max_5x' } }))
    expect(max5.planId).toBe('anthropic-max-5x')
  })

  test('2. organizationType without a tier is only likely', () => {
    const d = detectBilling(signals({ oauth: { billingType: 'stripe_subscription', organizationType: 'claude_max' } }))
    expect(d).toMatchObject({ planId: 'anthropic-max-5x', confidence: 'likely' })
    expect(d.evidenceEn).toContain('confirm')

    const pro = detectBilling(signals({ oauth: { billingType: 'stripe_subscription', organizationType: 'claude_pro' } }))
    expect(pro).toMatchObject({ planId: 'anthropic-pro', confidence: 'exact' })
  })

  test('2. a subscription with no plan named proposes no plan id', () => {
    const d = detectBilling(signals({ oauth: { billingType: 'stripe_subscription' } }))
    expect(d.mode).toBe('subscription')
    expect(d.planId).toBeUndefined()
    expect(d.confidence).toBe('likely')
  })

  test('3. the credentials file corroborates, and macOS (absent) falls through', () => {
    const d = detectBilling(signals({ credentials: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } }))
    expect(d).toMatchObject({ source: 'credentials', planId: 'anthropic-max-20x', confidence: 'exact' })

    const noTier = detectBilling(signals({ credentials: { subscriptionType: 'max' } }))
    expect(noTier).toMatchObject({ planId: 'anthropic-max-5x', confidence: 'likely' })

    const pro = detectBilling(signals({ credentials: { subscriptionType: 'pro' } }))
    expect(pro.planId).toBe('anthropic-pro')

    // macOS keeps these in the Keychain, so the block is simply absent — and we never probe it.
    const macos = detectBilling(signals({ env: { ANTHROPIC_API_KEY: 'set' } }))
    expect(macos.source).toBe('env_api_key')
  })

  test('3. team and enterprise propose no invented price', () => {
    const team = detectBilling(signals({ credentials: { subscriptionType: 'team' } }))
    expect(team).toMatchObject({ mode: 'subscription', planId: 'anthropic-team', confidence: 'likely' })
    const ent = detectBilling(signals({ credentials: { subscriptionType: 'enterprise' } }))
    expect(ent.planId).toBeUndefined()
  })

  test('4. an api key or a helper means pay-as-you-go', () => {
    expect(detectBilling(signals({ env: { ANTHROPIC_API_KEY: 'set' } }))).toMatchObject({ mode: 'api', planId: 'api-payg', source: 'env_api_key' })
    expect(detectBilling(signals({ hasApiKeyHelper: true }))).toMatchObject({ mode: 'api', source: 'env_api_key' })
  })

  test('5. zero cost with real tokens is a guess, and says so', () => {
    const d = detectBilling(signals({ usage: { totalCostUSD: 0, totalTokens: 4_000_000 } }))
    expect(d).toMatchObject({ mode: 'subscription', source: 'zero_cost_heuristic', confidence: 'guess' })
    expect(d.planId).toBeUndefined()
    expect(d.evidenceEn).toContain('does not say which plan')
  })

  test('5. real cost is not a subscription signal', () => {
    expect(detectBilling(signals({ usage: { totalCostUSD: 12.5, totalTokens: 4_000_000 } })).source).toBe('none')
    expect(detectBilling(signals({ usage: { totalCostUSD: 0, totalTokens: 0 } })).source).toBe('none')
  })

  test('nothing at all yields unknown, never a default plan', () => {
    const d = detectBilling(empty)
    expect(d).toMatchObject({ mode: 'unknown', source: 'none' })
    expect(d.planId).toBeUndefined()
  })
})

describe('detectBilling — invariants', () => {
  const cases: BillingSignals[] = [
    empty,
    signals({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } }),
    signals({ oauth: { billingType: 'stripe_subscription', organizationRateLimitTier: 'default_claude_max_5x' } }),
    signals({ oauth: { billingType: 'stripe_subscription', organizationType: 'claude_pro' } }),
    signals({ credentials: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } }),
    signals({ env: { ANTHROPIC_API_KEY: 'set' } }),
    signals({ usage: { totalCostUSD: 0, totalTokens: 1 } }),
  ]

  test('every branch is a proposal and nothing else', () => {
    for (const c of cases) expect(detectBilling(c).proposalOnly).toBe(true)
  })

  test('every branch states its evidence in both languages', () => {
    for (const c of cases) {
      const d = detectBilling(c)
      expect(d.evidenceEn.length).toBeGreaterThan(0)
      expect(d.evidencePt.length).toBeGreaterThan(0)
      expect(d.evidencePt).not.toBe(d.evidenceEn)
    }
  })

  test('every proposed plan id exists in the catalog', () => {
    for (const c of cases) {
      const { planId } = detectBilling(c)
      if (planId) expect(findPlan(planId)).toBeDefined()
    }
  })

  test('detection never proposes a price — only the user sets one', () => {
    for (const c of cases) expect('price' in detectBilling(c)).toBe(false)
  })
})

describe('detectCodexBilling', () => {
  const codexCases: CodexSignals[] = [
    {},
    { apiKey: 'set' },
    { planType: 'free' },
    { planType: 'plus' },
    { planType: 'pro' },
    { planType: 'go' },
    { planType: 'business' },
    { planType: 'team' },
    { planType: 'enterprise' },
    { planType: 'a_tier_that_does_not_exist_yet' },
    { apiKey: 'set', planType: 'pro' },
  ]

  test('an api key wins over the plan claim — a key is what actually bills', () => {
    // Both signals can be present: someone on Plus who also configured a key for scripting. The
    // key is the one that produces an invoice per token, so it decides.
    const out = detectCodexBilling({ apiKey: 'set', planType: 'pro' })
    expect(out.mode).toBe('api')
    expect(out.planId).toBe('api-payg')
  })

  test('each named tier resolves to a catalog id that exists', () => {
    for (const plan of ['plus', 'pro', 'go', 'business', 'team', 'enterprise']) {
      const out = detectCodexBilling({ planType: plan })
      expect(out.mode).toBe('subscription')
      expect(out.planId).toBeDefined()
      // An id the catalog does not hold would render a blank plan name and prefill no price.
      expect(findPlan(out.planId!)).toBeDefined()
    }
  })

  test('an unknown tier is still a subscription, just without an id', () => {
    // OpenAI can name a tier tomorrow. Reporting "not detected" would be worse than reporting
    // "you are on a subscription, pick which" — the mode is the part that is certain.
    const out = detectCodexBilling({ planType: 'a_tier_that_does_not_exist_yet' })
    expect(out.mode).toBe('subscription')
    expect(out.planId).toBeUndefined()
    expect(out.confidence).toBe('likely')
  })

  test('the free tier is unknown, never a subscription priced at zero', () => {
    // A period priced at zero makes every value multiple infinite. There is nothing to register.
    const out = detectCodexBilling({ planType: 'free' })
    expect(out.mode).toBe('unknown')
    expect(out.planId).toBeUndefined()
  })

  test('no signal at all says so instead of guessing', () => {
    expect(detectCodexBilling({})).toMatchObject({ mode: 'unknown', source: 'none' })
  })

  test('every result is a codex proposal, bilingual, and carries no price', () => {
    for (const c of codexCases) {
      const out = detectCodexBilling(c)
      expect(out.harness).toBe('codex')
      expect(out.proposalOnly).toBe(true)
      expect('price' in out).toBe(false)
      expect(out.evidenceEn.length).toBeGreaterThan(0)
      expect(out.evidencePt.length).toBeGreaterThan(0)
    }
  })
})
