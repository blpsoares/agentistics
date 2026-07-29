/**
 * cors.test.ts — the origin allowlist. The suffix-confusion cases are the point: a naive
 * `endsWith` check is how wildcard-by-accident happens.
 */
import { describe, expect, it } from 'bun:test'
import { originAllowed, corsHeadersFor } from './cors'

describe('originAllowed', () => {
  it('allows an exact allowlist match', () => {
    expect(originAllowed('https://metrics.example.com', ['https://metrics.example.com'], false)).toBe(true)
  })

  it('rejects a different scheme or port', () => {
    expect(originAllowed('http://metrics.example.com', ['https://metrics.example.com'], false)).toBe(false)
    expect(originAllowed('https://metrics.example.com:8443', ['https://metrics.example.com'], false)).toBe(false)
  })

  it('rejects a suffix-confusion attempt', () => {
    expect(originAllowed('https://evil-metrics.example.com', ['https://metrics.example.com'], false)).toBe(false)
    expect(originAllowed('https://metrics.example.com.evil.tld', ['https://metrics.example.com'], false)).toBe(false)
  })

  it('rejects a null or missing origin', () => {
    expect(originAllowed(null, ['https://metrics.example.com'], false)).toBe(false)
    expect(originAllowed('null', ['https://metrics.example.com'], false)).toBe(false)
  })

  it('allows localhost origins in dev only', () => {
    expect(originAllowed('http://localhost:47292', [], true)).toBe(true)
    expect(originAllowed('http://127.0.0.1:47292', [], true)).toBe(true)
    expect(originAllowed('http://localhost:47292', [], false)).toBe(false)
  })

  it('does not treat a localhost-lookalike host as dev', () => {
    expect(originAllowed('http://localhost.evil.tld', [], true)).toBe(false)
  })
})

describe('corsHeadersFor', () => {
  it('never emits a wildcard', () => {
    const h = corsHeadersFor('https://metrics.example.com', ['https://metrics.example.com'], false)
    expect(h['Access-Control-Allow-Origin']).toBe('https://metrics.example.com')
    expect(Object.values(h)).not.toContain('*')
  })

  it('emits Vary: Origin so caches do not cross-serve', () => {
    expect(corsHeadersFor('https://metrics.example.com', ['https://metrics.example.com'], false)['Vary'])
      .toBe('Origin')
  })

  it('emits no ACAO at all for a disallowed origin', () => {
    const h = corsHeadersFor('https://evil.tld', ['https://metrics.example.com'], false)
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined()
  })

  it('emits no ACAO for a same-origin request that carries no Origin header', () => {
    expect(corsHeadersFor(null, [], false)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})
