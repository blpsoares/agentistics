/**
 * rate-limit.ts — fixed-window counters plus a progressive-backoff block, in memory.
 *
 * The math (evaluate / registerFailure) is pure and unit-tested; MemoryLimiter is the thin
 * process-local store. Process-local is deliberate: a central is a single container, and a
 * shared store would add a Mongo round-trip to every request on the hot path. If the central is
 * ever scaled horizontally, the edge limiter (Cloudflare WAF) is the front line — see
 * docs/exposure.md; this one is the backstop.
 *
 * Two key shapes are used by callers:
 *   ip:<addr>:<route>  — hard blocking; stops one source from guessing at all.
 *   acct:<emailLower>  — soft backoff; slows credential stuffing across rotating IPs without
 *                        letting an attacker lock a colleague out permanently (the OWASP
 *                        lockout-as-DoS caveat: the block always expires on its own).
 */

export interface Bucket {
  /** Requests seen in the current window — the ceiling, not the failure count. */
  count: number
  windowStart: number
  /** How many times this key has been blocked; drives the doubling backoff. */
  strikes: number
  blockedUntil: number
  /** FAILURES inside the current failure window. Kept apart from `count` deliberately: one is
   *  "how much are you calling", the other is "how often are you wrong", and conflating them is
   *  what let a single mistyped password read as an attack. */
  fails?: number
  failWindowStart?: number
}

export interface RateRule {
  /** Allowed events per window. */
  limit: number
  /** Window length in ms. */
  windowMs: number
  /** Base block length in ms applied on the first strike. */
  blockMs: number
  /** Double the block on each subsequent strike (capped at 24h). */
  backoff: boolean
}

const MAX_BLOCK_MS = 24 * 60 * 60 * 1000

/** After this long without a failure, the strike history is forgotten. Backoff exists to punish
 *  a BURST of guesses; without decay, a typo last Tuesday still doubles today's block. */
const STRIKE_DECAY_MS = 24 * 60 * 60 * 1000

export const RULES: Record<'login' | 'loginAttempts' | 'token' | 'api' | 'ingest', RateRule> = {
  // 5 failed logins per 15 minutes, then a 15-minute block that doubles per strike.
  login: { limit: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000, backoff: true },
  // The per-IP ATTEMPT ceiling for the same routes. It counts calls, not failures, so it must
  // not be the same number as the failure allowance above: at 5 it ran out at the same moment,
  // and behind a reverse proxy — where every member shares one source address — it was five
  // sign-ins per quarter hour for the whole team.
  loginAttempts: { limit: 30, windowMs: 15 * 60_000, blockMs: 15 * 60_000, backoff: true },
  // Bearer-token guessing (whoami / agent upgrade): tighter, longer block.
  token: { limit: 10, windowMs: 5 * 60_000, blockMs: 30 * 60_000, backoff: true },
  // Generic authenticated API ceiling — generous; exists only to blunt scraping.
  api: { limit: 600, windowMs: 60_000, blockMs: 60_000, backoff: false },
  // Ingest is machine traffic; the central owns the push interval (>=5s), so 60/min is ample.
  ingest: { limit: 60, windowMs: 60_000, blockMs: 5 * 60_000, backoff: false },
}

/** Routes where a wrong guess is the attack: credentials and bearer tokens. */
const LOGIN_PATHS = new Set(['/api/iam/login', '/api/iam/login/mfa', '/api/team/login', '/api/iam/bootstrap'])
const TOKEN_PATHS = new Set(['/api/team/whoami', '/api/team/agent'])

/** Which rule governs a path. Pure so the routing policy is testable without a server. */
export function rateRuleFor(pathname: string): RateRule {
  if (LOGIN_PATHS.has(pathname)) return RULES.loginAttempts
  if (TOKEN_PATHS.has(pathname)) return RULES.token
  if (pathname === '/api/team/ingest') return RULES.ingest
  return RULES.api
}

function emptyBucket(nowMs: number): Bucket {
  return { count: 0, windowStart: nowMs, strikes: 0, blockedUntil: 0, fails: 0, failWindowStart: nowMs }
}

export function evaluate(
  bucket: Bucket | undefined,
  rule: RateRule,
  nowMs: number,
): { allowed: boolean; retryAfterSec: number; next: Bucket } {
  const b = bucket ? { ...bucket } : emptyBucket(nowMs)

  if (b.blockedUntil > nowMs) {
    return { allowed: false, retryAfterSec: Math.ceil((b.blockedUntil - nowMs) / 1000), next: b }
  }
  // A block that has just expired clears the counter with it. Without this the stale count
  // keeps the caller locked out until the window ALSO elapses, so the advertised block length
  // would be a lie and a legitimate user would be punished twice for one strike.
  if (b.blockedUntil !== 0) {
    b.blockedUntil = 0
    b.windowStart = nowMs
    b.count = 0
    // The failure tally goes with it: a served block is the punishment, and keeping the count
    // would re-block on the next single mistake.
    b.fails = 0
    b.failWindowStart = nowMs
  }
  if (nowMs - b.windowStart >= rule.windowMs) {
    b.windowStart = nowMs
    b.count = 0
  }
  if (b.count >= rule.limit) {
    const retryMs = rule.windowMs - (nowMs - b.windowStart)
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)), next: b }
  }
  b.count += 1
  return { allowed: true, retryAfterSec: 0, next: b }
}

/**
 * Record one failed attempt, blocking only once `rule.limit` of them land inside the window.
 *
 * It used to block on the FIRST failure: `limit` was consulted by the request counter and
 * ignored here, so the rule that reads "5 failed logins per 15 minutes, then a 15-minute
 * block" actually meant "one typo, fifteen minutes" — and since strikes never decayed, the
 * second typo cost half an hour, the third an hour, doubling to a day. A password field the
 * owner cannot get wrong twice is not a security control; it is a lockout.
 */
export function registerFailure(bucket: Bucket, rule: RateRule, nowMs: number): Bucket {
  const b = { ...bucket }
  const failWindowStart = b.failWindowStart ?? b.windowStart
  const sinceLast = nowMs - failWindowStart

  if (b.strikes > 0 && sinceLast >= STRIKE_DECAY_MS) b.strikes = 0
  b.fails = sinceLast >= rule.windowMs ? 0 : (b.fails ?? 0)
  if (sinceLast >= rule.windowMs) b.failWindowStart = nowMs
  else b.failWindowStart = failWindowStart
  b.fails += 1

  // Under the allowance: remember the failure, block nothing.
  if (b.fails < rule.limit) return b

  b.strikes += 1
  b.fails = 0
  b.failWindowStart = nowMs
  const factor = rule.backoff ? 2 ** (b.strikes - 1) : 1
  b.blockedUntil = nowMs + Math.min(rule.blockMs * factor, MAX_BLOCK_MS)
  return b
}

export class MemoryLimiter {
  private buckets = new Map<string, Bucket>()

  check(key: string, rule: RateRule, nowMs: number = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const r = evaluate(this.buckets.get(key), rule, nowMs)
    this.buckets.set(key, r.next)
    return { allowed: r.allowed, retryAfterSec: r.retryAfterSec }
  }

  fail(key: string, rule: RateRule, nowMs: number = Date.now()): void {
    this.buckets.set(key, registerFailure(this.buckets.get(key) ?? emptyBucket(nowMs), rule, nowMs))
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  size(): number {
    return this.buckets.size
  }

  /** Drop buckets that are neither blocked nor inside a live window. Called on an interval. */
  sweep(nowMs: number = Date.now()): void {
    for (const [key, b] of this.buckets) {
      const idle = nowMs - b.windowStart > MAX_BLOCK_MS
      if (b.blockedUntil <= nowMs && idle) this.buckets.delete(key)
    }
  }
}

/** Canonical 429. Callers spread CORS_HEADERS over it. */
export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: 'rate_limited', retryAfterSec }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) },
  })
}

/** Process-wide limiter shared by every route. */
export const limiter = new MemoryLimiter()
setInterval(() => limiter.sweep(), 10 * 60_000).unref?.()
