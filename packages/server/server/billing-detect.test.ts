import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { readBillingSignals, detectBillingLocal, readCodexSignals, readJwtClaim } from './billing-detect'
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
  // Codex's `~/.codex/auth.json` holds the OAuth pair beside the plan claim. The module reads the
  // ID token (it is the only place the tier is written) and must never so much as name these two.
  'access' + '_token',
  'refresh' + '_token',
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
    // timeline for that harness is theirs to fill in. Gemini, not Codex: Codex HAS a detector now,
    // so on a machine that is logged into it this assertion would be about the machine, not the code.
    const out = await detectBillingLocal(['gemini'])
    expect(out[0]).toMatchObject({ harness: 'gemini', mode: 'unknown', source: 'none' })
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

describe('readJwtClaim — the payload, and only the named claim', () => {
  /** Build a JWT-shaped string. The signature segment is deliberate junk: it is never read. */
  function jwt(payload: unknown): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')
    return `${b64({ alg: 'RS256' })}.${b64(payload)}.not-a-signature`
  }

  test('returns the claim asked for and nothing beside it', () => {
    const token = jwt({ plan: { tier: 'pro' }, sub: 'someone' })
    expect(readJwtClaim(token, 'plan')).toEqual({ tier: 'pro' })
  })

  test('a claim that is not there is null, not undefined and not a throw', () => {
    expect(readJwtClaim(jwt({ a: 1 }), 'b')).toBeNull()
  })

  test('base64url is decoded — the - and _ alphabet, not standard base64', () => {
    // A payload whose encoding contains both substituted characters. Decoded as plain base64 it
    // yields mojibake and then a parse error, i.e. a silently absent plan rather than a loud one.
    const token = jwt({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' }, x: '?>>?~~' })
    expect(readJwtClaim(token, 'https://api.openai.com/auth')).toEqual({ chatgpt_plan_type: 'plus' })
  })

  test('junk in every shape yields null rather than throwing', () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c', '..', 'x.!!!!.z']) {
      expect(readJwtClaim(bad, 'anything')).toBeNull()
    }
  })
})

describe('readCodexSignals', () => {
  test('reads this machine without throwing and carries only the two whitelisted fields', async () => {
    // Runs against whatever this machine actually has — the point is the SHAPE, which must hold
    // whether the file is present, absent or malformed.
    const signals = await readCodexSignals()
    for (const key of Object.keys(signals)) {
      expect(['planType', 'apiKey']).toContain(key)
    }
    if (signals.apiKey !== undefined) expect(signals.apiKey).toBe('set')
    if (signals.planType !== undefined) {
      expect(typeof signals.planType).toBe('string')
      // Lowercased on the way in, so the pure detector matches on one spelling.
      expect(signals.planType).toBe(signals.planType.toLowerCase())
    }
  })
})
