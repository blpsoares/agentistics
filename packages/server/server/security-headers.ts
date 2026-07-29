/**
 * security-headers.ts — the OWASP Secure Headers baseline, built per response.
 *
 * The SPA ships zero inline scripts (Vite emits module files and the PWA registration is an
 * external /registerSW.js), so script-src stays 'self' with no nonce machinery. Inline STYLE is
 * still required: React style props render as style attributes.
 *
 * Fonts are self-hosted (packages/web/public/fonts) precisely so no external origin needs to
 * appear here — a third-party font host both loosens the policy and leaks visitor IPs.
 */

export function buildCsp(opts: { dev: boolean }): string {
  // Dev runs the SPA on Vite's port talking to this server, with an HMR websocket.
  const connect = opts.dev ? "'self' ws: http://localhost:* http://127.0.0.1:*" : "'self'"
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

export function securityHeaders(opts: {
  tls: boolean
  dev: boolean
  isApi: boolean
}): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy': buildCsp({ dev: opts.dev }),
    'X-Content-Type-Options': 'nosniff',
    // frame-ancestors above is the modern control; X-Frame-Options covers older browsers.
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  }
  if (opts.tls) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  // API responses carry account-scoped data; a shared cache must never hold them.
  if (opts.isApi) h['Cache-Control'] = 'no-store'
  return h
}
