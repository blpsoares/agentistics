/**
 * cors.ts — PURE. Decides whether a cross-origin browser request may READ a response
 * from a route that carries secrets.
 *
 * Why this exists: the API binds to localhost, which feels private and is not. Any page the
 * user visits can `fetch('http://localhost:47291/api/preferences')`, and with a wildcard
 * `Access-Control-Allow-Origin` the browser hands that page the response — including every
 * central token. Omitting the header does not stop the request from being SENT (nothing can),
 * but it stops the page from reading the answer, which is the half that leaks.
 *
 * The rule is deliberately narrow: echo the Origin only when it is this server, reached at one
 * of this server's own ports. Everything else gets no header at all. Same-origin requests carry
 * no Origin and are unaffected, which covers the dashboard, the Vite dev proxy and every
 * non-browser caller (curl, the TUI, the CLI).
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export interface OriginPolicy {
  /** Ports this server binds — typically PORT (api) and WEB_PORT (dashboard). */
  ports: readonly number[]
  /** The request's `Host` header, so the address the client actually used is honoured
   *  (a LAN IP, a Tailscale name). Its hostname must match the Origin's exactly. */
  host?: string | null
}

/** The hostname of a `Host` header value, lowercased, without its port. `''` when absent. */
function hostnameOf(host: string | null | undefined): string {
  if (!host) return ''
  const value = host.trim().toLowerCase()
  if (!value) return ''
  // IPv6 literals are bracketed: [::1]:47292
  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    return close === -1 ? value : value.slice(0, close + 1)
  }
  const colon = value.lastIndexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

/**
 * The value to echo in `Access-Control-Allow-Origin`, or `null` to send no header.
 * Never throws: a malformed Origin is refused, not propagated.
 */
export function allowedOrigin(
  origin: string | null | undefined,
  policy: OriginPolicy,
): string | null {
  if (!origin || !origin.trim()) return null

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null

  // An Origin always carries an explicit port unless it is the scheme default; require one of
  // ours either way, so a page on another local port is not treated as us.
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)
  if (!Number.isInteger(port) || !policy.ports.includes(port)) return null

  const hostname = url.hostname.toLowerCase()
  if (LOOPBACK.has(hostname)) return origin
  if (hostname && hostname === hostnameOf(policy.host)) return origin
  return null
}

/**
 * CORS headers for a route that carries secrets. Same shape as the wildcard set, minus the
 * wildcard: `Access-Control-Allow-Origin` appears only for an origin that is this server.
 * `Vary: Origin` is mandatory — without it a cache can serve one origin's allowed response
 * to another.
 */
export function sensitiveCorsHeaders(
  origin: string | null | undefined,
  policy: OriginPolicy,
): Record<string, string> {
  const allowed = allowedOrigin(origin, policy)
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed } : {}),
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
}
