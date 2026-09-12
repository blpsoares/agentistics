import { expect, test } from 'bun:test'
import { keepsOwnCsp, OPAQUE_MEDIA_CSP } from './response-policy'
import { securityHeaders } from './security-headers'

/** What `handleRequest` does, reproduced exactly, so the outcome can be asserted rather than read. */
function stamp(res: Response): Response {
  const keepCsp = keepsOwnCsp(res)
  for (const [k, v] of Object.entries(securityHeaders({ tls: false, dev: false, isApi: true, embed: true }))) {
    if (keepCsp && k === 'Content-Security-Policy') continue
    res.headers.set(k, v)
  }
  return res
}

test('a response with no policy of its own gets the baseline', () => {
  const res = stamp(new Response('x'))
  expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
})

test('the ONE allowlisted policy survives — the media routes depend on it', () => {
  const res = stamp(new Response('x', { headers: { 'Content-Security-Policy': OPAQUE_MEDIA_CSP } }))
  expect(res.headers.get('Content-Security-Policy')).toBe(OPAQUE_MEDIA_CSP)
})

test('ANY other policy a route writes is replaced, however close to the allowlisted one', () => {
  // This is the property the allowlist exists for: "keep whatever the route set" would make the
  // baseline opt-out, and the next route to write something looser would get it.
  for (const attempt of [
    "default-src 'none'",
    "default-src *; sandbox",
    "default-src 'none'; sandbox allow-scripts",
    "default-src 'none';sandbox",
    "DEFAULT-SRC 'none'; sandbox",
    "default-src 'none'; sandbox; frame-ancestors *",
    '',
  ]) {
    const res = stamp(new Response('x', { headers: { 'Content-Security-Policy': attempt } }))
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
  }
})

test('the allowlisted policy is strictly STRICTER than the baseline where it matters', () => {
  const baseline = securityHeaders({ tls: false, dev: false, isApi: true, embed: true })['Content-Security-Policy']!
  // The baseline allows same-origin everything; this allows nothing and sandboxes the document.
  expect(OPAQUE_MEDIA_CSP).toContain("default-src 'none'")
  expect(OPAQUE_MEDIA_CSP).toContain('sandbox')
  expect(baseline).toContain("default-src 'self'")
  // And it carries NO `frame-ancestors`, which is the whole point: the baseline's is the
  // DASHBOARD's clickjacking rule (`vscode-webview:`, deliberately not `'self'`), and applied to a
  // PDF's bytes it stopped the dashboard framing its own document. A sandboxed byte response
  // carrying none of the application's controls has nothing to clickjack.
  expect(OPAQUE_MEDIA_CSP).not.toContain('frame-ancestors')
  expect(baseline).toContain('frame-ancestors')
})

test('nosniff is never given up — it is what makes the closed content table mean anything', () => {
  const res = stamp(new Response('x', { headers: { 'Content-Security-Policy': OPAQUE_MEDIA_CSP } }))
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
})
