/**
 * response-policy.ts — the ONE policy a route may keep when `handleRequest` stamps the baseline.
 *
 * `handleRequest` sets the OWASP headers on every response, and it SETS rather than appends, on
 * purpose: a newly added route cannot forget them. The cost is that a header a route writes for
 * itself is silently replaced, and two routes had been writing one for years —
 * `/api/fleet/media` and `/api/fleet/tree/media` both declared `default-src 'none'; sandbox` in
 * their own source, with comments explaining why it mattered, and neither one ever shipped. A
 * guarantee that reads true in the source and is absent on the wire is worse than none.
 *
 * IT WAS NOT COSMETIC. The baseline carries `frame-ancestors vscode-webview:` on a `local`
 * profile — the dashboard's own clickjacking rule, deliberately narrow and deliberately NOT
 * `'self'` (see `security-headers.ts`, which says so and has a test pinning it). Applied to a PDF's
 * bytes it forbids the dashboard from framing its own document, so the Studio's and the gallery's
 * PDF panes rendered the browser's "cannot display" glyph. Measured in Chromium: `Framing
 * 'http://127.0.0.1:47692/' violates the following Content Security Policy directive:
 * "frame-ancestors vscode-webview:"`. With the policy below the same frame renders both pages.
 *
 * THE ESCAPE IS AN ALLOWLIST OF ONE VALUE, NOT "THE ROUTE WINS". "Keep whatever a route set" would
 * make the baseline opt-out, and the next route to write a looser policy would get it. So the
 * wrapper keeps a route's `Content-Security-Policy` only when it is EXACTLY this constant — which
 * is strictly stricter than the baseline in every direction that matters (`default-src 'none'`
 * against `'self'`, plus a `sandbox` that gives the response an opaque origin and no scripting).
 * Any other value a route writes is still replaced, so the property is closed by construction
 * rather than by anybody remembering a rule.
 *
 * WHAT IT IS FOR: an OPAQUE BYTE RESPONSE — an image, a video, a PDF — served from the closed
 * content table in `artifact-media.ts`, where the browser is additionally forbidden by `nosniff`
 * (still stamped by the baseline) from deciding a type the extension did not. It is not for
 * anything that carries the application's own controls; there would be something to clickjack.
 */

/** The one policy `handleRequest` will leave alone. Strictly stricter than the baseline. */
export const OPAQUE_MEDIA_CSP = "default-src 'none'; sandbox"

/**
 * May this response keep the `Content-Security-Policy` it already carries?
 *
 * Compared by VALUE against the single allowlisted constant, so a route cannot widen the policy by
 * writing a different one — it would simply be overwritten with the baseline, which is the safe
 * direction and the behaviour every other route already has.
 */
export function keepsOwnCsp(res: Response): boolean {
  return res.headers.get('Content-Security-Policy') === OPAQUE_MEDIA_CSP
}
