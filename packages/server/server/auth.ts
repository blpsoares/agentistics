/**
 * auth.ts — stateless HMAC-signed session cookie auth for Team Mode Phase 3.
 *
 * Pure helpers (signSession, verifySession, parseCookies, constantTimeEqual)
 * carry no side effects and are unit-tested in auth.test.ts.
 *
 * Handlers (handleLogin, handleLogout, handleSession, isAuthed) are thin IO
 * wrappers; the caller in index.ts spreads CORS_HEADERS over their responses.
 *
 * Security guarantees:
 *   - Session cookie: HttpOnly, SameSite=Lax, Path=/, Max-Age 7d; Secure when
 *     AGENTISTICS_TEAM_TLS=1.
 *   - Cookie value: `${expiryMs}.${HMAC_SHA256(expiryMs, secret)}`.
 *   - HMAC verified with crypto.timingSafeEqual (constant-time).
 *   - Password compared with crypto.timingSafeEqual (constant-time).
 *   - Raw password and session secret are never logged.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { TEAM_PASSWORD, TEAM_SESSION_SECRET, TEAM_TLS } from './config'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'agentistics_session'
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_AGE_SECONDS = SESSION_DURATION_MS / 1000

// Content-Type only — callers spread CORS_HEADERS from index.ts.
const JSON_CT = { 'Content-Type': 'application/json' } as const

// ---------------------------------------------------------------------------
// PURE helpers (no side effects — safe to unit test without mocking)
// ---------------------------------------------------------------------------

/**
 * Sign a session: returns `${expiryMs}.${HMAC_SHA256(expiryMs, secret)}`.
 * The expiry timestamp is the data being signed; it is also included in the
 * cookie value so the server can verify it without any server-side state.
 */
export function signSession(expiryMs: number, secret: string): string {
  const payload = String(expiryMs)
  const mac = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}

/**
 * Verify a session cookie value:
 *   - Parses `expiryMs.hmacHex`.
 *   - Checks expiry > nowMs.
 *   - Verifies HMAC with constant-time compare.
 * Returns false for any malformed, expired, or tampered cookie.
 */
export function verifySession(
  cookieValue: string | undefined,
  secret: string,
  nowMs: number,
): boolean {
  if (!cookieValue) return false
  const dot = cookieValue.indexOf('.')
  if (dot === -1) return false
  const expiryStr = cookieValue.slice(0, dot)
  const mac = cookieValue.slice(dot + 1)
  const expiry = parseInt(expiryStr, 10)
  if (isNaN(expiry) || expiry <= nowMs) return false
  const expected = createHmac('sha256', secret).update(expiryStr).digest('hex')
  return constantTimeEqual(mac, expected)
}

/**
 * Minimal cookie header parser. Splits on `;` and on the first `=`.
 * Handles cookie values containing `=` (e.g. base64).
 */
export function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/**
 * Constant-time string comparison wrapping crypto.timingSafeEqual.
 * Length-safe: always does a full comparison before returning false for
 * length mismatches (a dummy same-length compare is done to equalize timing).
 * This prevents timing attacks that infer secret length from branch time.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Perform a dummy comparison of the same length to avoid a timing side
    // channel on the length check itself.
    timingSafeEqual(Buffer.alloc(bufA.length), Buffer.alloc(bufA.length))
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeCookieHeader(value: string, maxAge: number): string {
  const secure = TEAM_TLS ? '; Secure' : ''
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
}

// ---------------------------------------------------------------------------
// Route handlers (IO — each returns a Response; caller spreads CORS_HEADERS)
// ---------------------------------------------------------------------------

/**
 * POST /api/team/login
 * Body: { password: string }
 * On match → Set-Cookie + { ok: true }
 * On mismatch → 200 { ok: false, error: 'invalid password' }
 *   (200 so the login form doesn't trigger browser error interceptors)
 */
export async function handleLogin(req: Request): Promise<Response> {
  if (!TEAM_PASSWORD) {
    // No password configured → login is a no-op; behave as authed.
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_CT })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }), {
      status: 400,
      headers: JSON_CT,
    })
  }
  const password =
    typeof (body as Record<string, unknown>)?.password === 'string'
      ? ((body as Record<string, unknown>).password as string)
      : ''

  // Constant-time comparison — never branch on the raw match result early.
  if (!constantTimeEqual(password, TEAM_PASSWORD)) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid password' }), {
      status: 200,
      headers: JSON_CT,
    })
  }

  const expiryMs = Date.now() + SESSION_DURATION_MS
  const cookieValue = signSession(expiryMs, TEAM_SESSION_SECRET)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...JSON_CT,
      'Set-Cookie': makeCookieHeader(cookieValue, MAX_AGE_SECONDS),
    },
  })
}

/**
 * POST /api/team/logout
 * Clears the session cookie by setting Max-Age=0.
 */
export function handleLogout(_req: Request): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...JSON_CT,
      'Set-Cookie': makeCookieHeader('', 0),
    },
  })
}

/**
 * GET /api/team/session
 * Returns { authed: boolean, required: boolean }.
 * `required` = a password is configured (tells the web whether to show the login screen).
 * Public — never behind the gate.
 */
export function handleSession(req: Request): Response {
  const required = Boolean(TEAM_PASSWORD)
  const authed = isAuthed(req)
  return new Response(JSON.stringify({ authed, required }), {
    status: 200,
    headers: JSON_CT,
  })
}

/**
 * Returns true if the request carries a valid session cookie, or if no
 * password is configured (gate disabled → always authed).
 * Called by the request gate in index.ts.
 */
export function isAuthed(req: Request): boolean {
  if (!TEAM_PASSWORD) return true
  const cookieHeader = req.headers.get('cookie')
  const cookies = parseCookies(cookieHeader)
  return verifySession(cookies[COOKIE_NAME], TEAM_SESSION_SECRET, Date.now())
}
