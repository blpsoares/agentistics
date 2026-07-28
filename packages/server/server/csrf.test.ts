/**
 * csrf.test.ts — the second line behind SameSite=Strict. The cookie-less case matters as much
 * as the cross-site one: `agentop member` and `ci-push` authenticate with a Bearer token and
 * must not be blocked by a defence aimed at browsers.
 */
import { describe, expect, it } from 'bun:test'
import { csrfVerdict } from './csrf'

const base = {
  host: 'metrics.example.com',
  hasCookie: true,
  allowlist: [] as string[],
  dev: false,
}

describe('csrfVerdict', () => {
  it('always allows safe methods', () => {
    expect(csrfVerdict({ ...base, method: 'GET', origin: 'https://evil.tld', secFetchSite: 'cross-site' }).ok).toBe(true)
    expect(csrfVerdict({ ...base, method: 'HEAD', origin: null, secFetchSite: null }).ok).toBe(true)
    expect(csrfVerdict({ ...base, method: 'OPTIONS', origin: null, secFetchSite: null }).ok).toBe(true)
  })

  it('allows a same-origin POST', () => {
    expect(csrfVerdict({ ...base, method: 'POST', origin: 'https://metrics.example.com', secFetchSite: 'same-origin' }).ok).toBe(true)
  })

  it('rejects a cross-site POST carrying a cookie', () => {
    expect(csrfVerdict({ ...base, method: 'POST', origin: 'https://evil.tld', secFetchSite: 'cross-site' }).ok).toBe(false)
  })

  it('rejects Sec-Fetch-Site: cross-site even when Origin looks right', () => {
    expect(csrfVerdict({ ...base, method: 'POST', origin: 'https://metrics.example.com', secFetchSite: 'cross-site' }).ok).toBe(false)
  })

  it('rejects a cross-site DELETE and PATCH too', () => {
    expect(csrfVerdict({ ...base, method: 'DELETE', origin: 'https://evil.tld', secFetchSite: 'cross-site' }).ok).toBe(false)
    expect(csrfVerdict({ ...base, method: 'PATCH', origin: 'https://evil.tld', secFetchSite: 'cross-site' }).ok).toBe(false)
  })

  it('allows a cookie-less POST from a non-browser client (agentop, ci-push)', () => {
    expect(csrfVerdict({ ...base, hasCookie: false, method: 'POST', origin: null, secFetchSite: null }).ok).toBe(true)
  })

  it('rejects a cookie-bearing POST with no Origin and no Sec-Fetch-Site', () => {
    const v = csrfVerdict({ ...base, method: 'POST', origin: null, secFetchSite: null })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toBe('missing_origin')
  })

  it('allows an Origin matching the request host over either scheme', () => {
    expect(csrfVerdict({ ...base, method: 'POST', origin: 'https://metrics.example.com', secFetchSite: null }).ok).toBe(true)
    expect(csrfVerdict({ ...base, method: 'POST', origin: 'http://metrics.example.com', secFetchSite: null }).ok).toBe(true)
  })

  it('rejects an Origin for a different host when Sec-Fetch-Site is absent', () => {
    const v = csrfVerdict({ ...base, method: 'POST', origin: 'https://evil.tld', secFetchSite: null })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toBe('origin_mismatch')
  })

  it('allows an explicitly allowlisted cross-origin POST', () => {
    const v = csrfVerdict({
      ...base,
      allowlist: ['https://ops.example.com'],
      method: 'POST',
      origin: 'https://ops.example.com',
      secFetchSite: 'cross-site',
    })
    expect(v.ok).toBe(true)
  })

  it('trusts same-site and none verdicts from the browser', () => {
    expect(csrfVerdict({ ...base, method: 'POST', origin: null, secFetchSite: 'same-site' }).ok).toBe(true)
    expect(csrfVerdict({ ...base, method: 'POST', origin: null, secFetchSite: 'none' }).ok).toBe(true)
  })
})
