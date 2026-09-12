import { expect, test } from 'bun:test'
import { keepsOwnCsp, OPAQUE_MEDIA_CSP } from './response-policy'
import { securityHeaders } from './security-headers'

/** What `handleRequest` does, reproduced exactly, so the outcome can be asserted rather than read. */
function stamp(res: Response, embed = true): Response {
  const keepCsp = keepsOwnCsp(res)
  for (const [k, v] of Object.entries(securityHeaders({ tls: false, dev: false, isApi: true, embed }))) {
    if (keepCsp && (k === 'Content-Security-Policy' || k === 'X-Frame-Options')) continue
    res.headers.set(k, v)
  }
  return res
}

/** A response carrying the media routes' allowlisted policy, as `readTreeMedia`'s route writes it. */
function opaqueMediaResponse(): Response {
  return new Response('x', { headers: { 'Content-Security-Policy': OPAQUE_MEDIA_CSP } })
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

// The defect this file exists to pin: `embed` (may an EDITOR frame the dashboard) is true only on
// a `local` profile. Everywhere else — `lan` with `AGENTISTICS_ALLOW_LOCAL_SHELL=1`, which is
// exactly the profile that can reach the Studio's media routes over a network — `embed` is false,
// and the baseline's `X-Frame-Options: DENY` used to be stamped back onto the ONE response that
// asked to be exempt from framing restrictions, silently overriding the CSP that was just let
// through. A PDF `<iframe>` refused by XFO fires no `error` event, so the pane showed nothing.
test('a media response stays framable on a profile that cannot set `embed` (lan-with-shell)', () => {
  const res = stamp(opaqueMediaResponse(), /* embed */ false)
  expect(res.headers.get('Content-Security-Policy')).toBe(OPAQUE_MEDIA_CSP)
  expect(res.headers.get('X-Frame-Options')).toBeNull()
})

test('a media response stays framable on `local` too (embed true) — same outcome, different route', () => {
  const res = stamp(opaqueMediaResponse(), /* embed */ true)
  expect(res.headers.get('Content-Security-Policy')).toBe(OPAQUE_MEDIA_CSP)
  expect(res.headers.get('X-Frame-Options')).toBeNull()
})

// The other half of the property: an ORDINARY route must keep its clickjacking protection on
// every profile. Exempting X-Frame-Options is scoped to the exact allowlisted CSP, never to
// "any route on this profile" — this is the test that would fail if that scoping were lost.
test('an ordinary response keeps X-Frame-Options: DENY on lan-with-shell (embed false)', () => {
  const res = stamp(new Response('x'), /* embed */ false)
  expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
})

test('an ordinary response has no X-Frame-Options on `local` (embed true) — the dashboard\'s own case', () => {
  const res = stamp(new Response('x'), /* embed */ true)
  expect(res.headers.get('X-Frame-Options')).toBeNull()
  expect(res.headers.get('Content-Security-Policy')).toContain('frame-ancestors vscode-webview:')
})
