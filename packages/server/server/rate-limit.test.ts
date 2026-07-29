/**
 * rate-limit.test.ts — the window/lockout math, driven by an explicit clock so nothing
 * depends on wall time.
 */
import { describe, expect, it } from 'bun:test'
import {
  evaluate,
  registerFailure,
  MemoryLimiter,
  RULES,
  rateRuleFor,
  tooManyRequests,
  type Bucket,
  type RateRule,
} from './rate-limit'

const rule: RateRule = { limit: 3, windowMs: 60_000, blockMs: 300_000, backoff: true }
const t0 = 1_000_000

describe('evaluate', () => {
  it('allows the first request and starts a window', () => {
    const r = evaluate(undefined, rule, t0)
    expect(r.allowed).toBe(true)
    expect(r.next.count).toBe(1)
    expect(r.next.windowStart).toBe(t0)
  })

  it('allows up to the limit inside one window', () => {
    let b: Bucket | undefined
    for (let i = 0; i < rule.limit; i++) {
      const r = evaluate(b, rule, t0)
      expect(r.allowed).toBe(true)
      b = r.next
    }
    expect(b!.count).toBe(3)
  })

  it('blocks the request past the limit and reports Retry-After', () => {
    let b: Bucket | undefined
    for (let i = 0; i < rule.limit; i++) b = evaluate(b, rule, t0).next
    const r = evaluate(b, rule, t0)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThan(0)
  })

  it('starts a fresh window once the old one elapsed', () => {
    let b: Bucket | undefined
    for (let i = 0; i < rule.limit; i++) b = evaluate(b, rule, t0).next
    const r = evaluate(b, rule, t0 + rule.windowMs + 1)
    expect(r.allowed).toBe(true)
    expect(r.next.count).toBe(1)
  })

  it('keeps blocking while blockedUntil is in the future', () => {
    const blocked: Bucket = { count: 0, windowStart: t0, strikes: 1, blockedUntil: t0 + 10_000 }
    const r = evaluate(blocked, rule, t0 + 5_000)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBe(5)
  })

  it('releases the block once it expires', () => {
    const blocked: Bucket = { count: 99, windowStart: t0, strikes: 1, blockedUntil: t0 + 10_000 }
    const r = evaluate(blocked, rule, t0 + 10_001)
    expect(r.allowed).toBe(true)
  })

  it('never mutates the bucket it was given', () => {
    const b: Bucket = { count: 1, windowStart: t0, strikes: 0, blockedUntil: 0 }
    evaluate(b, rule, t0)
    expect(b.count).toBe(1)
  })
})

describe('registerFailure', () => {
  it('doubles the block on each strike when backoff is on', () => {
    let b: Bucket = { count: 0, windowStart: t0, strikes: 0, blockedUntil: 0 }
    b = registerFailure(b, rule, t0)
    const first = b.blockedUntil - t0
    b = registerFailure(b, rule, t0)
    const second = b.blockedUntil - t0
    expect(second).toBe(first * 2)
  })

  it('keeps a flat block when backoff is off', () => {
    const flat: RateRule = { ...rule, backoff: false }
    let b: Bucket = { count: 0, windowStart: t0, strikes: 0, blockedUntil: 0 }
    b = registerFailure(b, flat, t0)
    const first = b.blockedUntil - t0
    b = registerFailure(b, flat, t0)
    expect(b.blockedUntil - t0).toBe(first)
  })

  it('caps the block at 24h', () => {
    let b: Bucket = { count: 0, windowStart: t0, strikes: 0, blockedUntil: 0 }
    for (let i = 0; i < 40; i++) b = registerFailure(b, rule, t0)
    expect(b.blockedUntil - t0).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })
})

describe('MemoryLimiter', () => {
  it('isolates keys from each other', () => {
    const l = new MemoryLimiter()
    for (let i = 0; i < rule.limit; i++) l.check('a', rule, t0)
    expect(l.check('a', rule, t0).allowed).toBe(false)
    expect(l.check('b', rule, t0).allowed).toBe(true)
  })

  it('clears a key on reset (successful login)', () => {
    const l = new MemoryLimiter()
    l.fail('a', rule, t0)
    l.reset('a')
    expect(l.check('a', rule, t0).allowed).toBe(true)
  })

  it('sweeps expired buckets so memory cannot grow without bound', () => {
    const l = new MemoryLimiter()
    l.check('a', rule, t0)
    expect(l.size()).toBe(1)
    l.sweep(t0 + 25 * 60 * 60 * 1000)
    expect(l.size()).toBe(0)
  })

  it('never sweeps a bucket that is still blocked', () => {
    const l = new MemoryLimiter()
    l.fail('a', rule, t0 + 25 * 60 * 60 * 1000)
    l.sweep(t0 + 25 * 60 * 60 * 1000)
    expect(l.size()).toBe(1)
  })
})

describe('RULES', () => {
  it('uses OWASP-aligned login limits (5 attempts, 15m window, backoff on)', () => {
    expect(RULES.login.limit).toBe(5)
    expect(RULES.login.windowMs).toBe(15 * 60_000)
    expect(RULES.login.backoff).toBe(true)
  })

  it('keeps the generic api ceiling well above normal dashboard use', () => {
    expect(RULES.api.limit).toBeGreaterThanOrEqual(300)
  })
})

describe('rateRuleFor', () => {
  it('puts every credential endpoint under the login rule', () => {
    expect(rateRuleFor('/api/iam/login')).toBe(RULES.login)
    expect(rateRuleFor('/api/iam/login/mfa')).toBe(RULES.login)
    expect(rateRuleFor('/api/team/login')).toBe(RULES.login)
    expect(rateRuleFor('/api/iam/bootstrap')).toBe(RULES.login)
  })

  it('puts bearer-token endpoints under the token rule', () => {
    expect(rateRuleFor('/api/team/whoami')).toBe(RULES.token)
    expect(rateRuleFor('/api/team/agent')).toBe(RULES.token)
  })

  it('gives ingest its own machine-traffic rule', () => {
    expect(rateRuleFor('/api/team/ingest')).toBe(RULES.ingest)
  })

  it('falls back to the generic ceiling', () => {
    expect(rateRuleFor('/api/data')).toBe(RULES.api)
    expect(rateRuleFor('/api/tags/abc')).toBe(RULES.api)
  })
})

describe('tooManyRequests', () => {
  it('is a 429 carrying Retry-After and a stable code', async () => {
    const res = tooManyRequests(42)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(await res.json()).toEqual({ error: 'rate_limited', retryAfterSec: 42 })
  })
})
