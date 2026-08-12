import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { readBillingSignals, detectBillingLocal } from './billing-detect'
import { HARNESS_ORDER } from '@agentistics/core'

/**
 * The forbidden field names, assembled at runtime from fragments.
 *
 * Written this way on purpose: the guard below greps this module's SOURCE, and a test file that
 * spelled these out would be the very thing it is checking for if the two ever shared a file.
 * Keeping them un-spelled also means a careless copy-paste of a real payload into a fixture stays
 * detectable.
 */
const FORBIDDEN = [
  'access' + 'Token',
  'refresh' + 'Token',
  'email' + 'Address',
  'account' + 'Uuid',
  'organization' + 'Uuid',
  'display' + 'Name',
  'customApiKey' + 'Responses',
  'mcp' + 'OAuth',
]

describe('billing-detect — the whitelist is the security boundary', () => {
  test('the module never names a secret or identifying field', () => {
    // A field this module cannot name is a field it cannot read, log or return. This is the same
    // source-text technique capability-guard.test.ts uses, and it is deliberately cruder than a
    // behavioural test: it fails on a comment, a type, a fixture — anything that would let one of
    // these names get near this code path.
    const src = readFileSync(new URL('./billing-detect.ts', import.meta.url), 'utf-8')
    for (const field of FORBIDDEN) {
      expect(src).not.toContain(field)
    }
  })

  test('the pure detector never names one either', () => {
    const src = readFileSync(
      new URL('../../core/src/billingDetect.ts', import.meta.url),
      'utf-8',
    )
    for (const field of FORBIDDEN) {
      expect(src).not.toContain(field)
    }
  })

  test('the api key is reduced to presence, never carried as a value', () => {
    const src = readFileSync(new URL('./billing-detect.ts', import.meta.url), 'utf-8')
    // The only thing ever assigned for that key is the literal 'set'.
    expect(src).toContain("'set' as const")
    expect(src).not.toMatch(/ANTHROPIC_API_KEY\]?\s*:\s*(?!'set')[a-z]/i)
  })
})

describe('readBillingSignals', () => {
  test('reads without throwing and returns only whitelisted keys', async () => {
    // Runs against whatever this machine actually has — the point is the SHAPE, which must hold
    // whether the files are present, absent or malformed.
    const signals = await readBillingSignals()

    expect(Object.keys(signals).sort()).toEqual(
      expect.arrayContaining(['env', 'hasApiKeyHelper']),
    )
    for (const key of Object.keys(signals)) {
      expect(['env', 'hasApiKeyHelper', 'oauth', 'credentials', 'usage']).toContain(key)
    }

    for (const key of Object.keys(signals.env)) {
      expect([
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_USE_VERTEX',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_API_KEY',
      ]).toContain(key)
    }
    if (signals.env.ANTHROPIC_API_KEY !== undefined) {
      expect(signals.env.ANTHROPIC_API_KEY).toBe('set')
    }

    for (const key of Object.keys(signals.oauth ?? {})) {
      expect(['billingType', 'organizationType', 'organizationRateLimitTier']).toContain(key)
    }
    for (const key of Object.keys(signals.credentials ?? {})) {
      expect(['subscriptionType', 'rateLimitTier']).toContain(key)
    }
    for (const key of Object.keys(signals.usage ?? {})) {
      expect(['totalCostUSD', 'totalTokens']).toContain(key)
    }
  })

  test('no value anywhere in the result looks like a credential', async () => {
    // Belt and braces beside the source-text guard: even if a field slipped through, a long
    // opaque string reaching the wire would be caught here.
    const signals = await readBillingSignals()
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        expect(value.length).toBeLessThan(64)
        expect(value).not.toMatch(/^sk-|^sk_ant|^gho_|^ey[A-Za-z0-9]/)
        expect(value).not.toContain('@')
        return
      }
      if (value && typeof value === 'object') Object.values(value).forEach(walk)
    }
    walk(signals)
  })

  test('the usage tiebreaker is a pair of numbers, never a model breakdown', async () => {
    const signals = await readBillingSignals()
    if (!signals.usage) return
    expect(Number.isFinite(signals.usage.totalCostUSD)).toBe(true)
    expect(Number.isFinite(signals.usage.totalTokens)).toBe(true)
  })
})

describe('detectBillingLocal', () => {
  test('returns one proposal per harness asked for, in that order', async () => {
    const out = await detectBillingLocal(['claude', 'codex', 'gemini'])
    expect(out.map((d) => d.harness)).toEqual(['claude', 'codex', 'gemini'])
  })

  test('a harness with no detector says so instead of being omitted', async () => {
    // A silent gap reads as "already handled"; an explicit "nothing detected" tells the user the
    // timeline for that harness is theirs to fill in.
    const out = await detectBillingLocal(['codex'])
    expect(out[0]).toMatchObject({ harness: 'codex', mode: 'unknown', source: 'none' })
    expect(out[0]!.evidenceEn.length).toBeGreaterThan(0)
    expect(out[0]!.evidencePt.length).toBeGreaterThan(0)
  })

  test('every result is a proposal and none carries a price', async () => {
    for (const d of await detectBillingLocal(HARNESS_ORDER)) {
      expect(d.proposalOnly).toBe(true)
      expect('price' in d).toBe(false)
    }
  })

  test('an empty harness list yields nothing rather than a default', async () => {
    expect(await detectBillingLocal([])).toEqual([])
  })
})
