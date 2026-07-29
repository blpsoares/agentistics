/**
 * cors.ts — explicit origin allowlist.
 *
 * The dashboard is same-origin (the SPA is served by this very process), so in production NO
 * cross-origin browser access is needed at all: the correct answer for an unknown origin is to
 * emit no Access-Control-Allow-Origin header. Non-browser clients (agentop member push,
 * ci-push, the MCP server) never send an Origin and are unaffected by CORS.
 *
 * Configure extra origins with AGENTISTICS_ALLOWED_ORIGINS (comma-separated, scheme+host+port).
 * Matching is exact — never a suffix test, which is how `evil-metrics.example.com` sneaks in.
 */

const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function originAllowed(origin: string | null, allowlist: string[], dev: boolean): boolean {
  if (!origin || origin === 'null') return false
  if (allowlist.includes(origin)) return true
  if (dev && DEV_ORIGIN.test(origin)) return true
  return false
}

export function corsHeadersFor(
  origin: string | null,
  allowlist: string[],
  dev: boolean,
): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, PUT, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (!originAllowed(origin, allowlist, dev)) return base
  return { ...base, 'Access-Control-Allow-Origin': origin!, 'Access-Control-Allow-Credentials': 'true' }
}
