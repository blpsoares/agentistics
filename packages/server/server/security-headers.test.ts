/**
 * security-headers.test.ts — the OWASP Secure Headers baseline and the CSP string.
 */
import { describe, expect, it } from 'bun:test'
import { buildCsp, securityHeaders } from './security-headers'

describe('buildCsp', () => {
  const csp = buildCsp({ dev: false })

  it('locks the default source to self', () => {
    expect(csp).toContain("default-src 'self'")
  })

  it('forbids inline and eval scripts', () => {
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('allows inline style, which React style props require', () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('forbids framing entirely', () => {
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('pins base-uri, form-action and object-src', () => {
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it('allows no external font or style origin (fonts are self-hosted)', () => {
    expect(csp).not.toContain('fonts.googleapis.com')
    expect(csp).not.toContain('fonts.gstatic.com')
  })

  it('relaxes connect-src for the Vite dev server only in dev', () => {
    expect(buildCsp({ dev: true })).toContain('ws:')
    expect(buildCsp({ dev: false })).not.toContain('ws:')
  })
})

describe('securityHeaders', () => {
  it('emits HSTS only when TLS is on', () => {
    expect(securityHeaders({ tls: true, dev: false, isApi: false })['Strict-Transport-Security'])
      .toBe('max-age=31536000; includeSubDomains')
    expect(securityHeaders({ tls: false, dev: false, isApi: false })['Strict-Transport-Security'])
      .toBeUndefined()
  })

  it('always emits the baseline set', () => {
    const h = securityHeaders({ tls: false, dev: false, isApi: false })
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('same-origin')
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin')
    expect(h['Permissions-Policy']).toContain('camera=()')
    expect(h['Content-Security-Policy']).toContain("default-src 'self'")
  })

  it('marks API responses no-store so credentials never land in a shared cache', () => {
    expect(securityHeaders({ tls: true, dev: false, isApi: true })['Cache-Control']).toBe('no-store')
    expect(securityHeaders({ tls: true, dev: false, isApi: false })['Cache-Control']).toBeUndefined()
  })
})
