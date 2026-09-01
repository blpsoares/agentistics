/**
 * config.ts — PURE. The two addresses this extension talks to, resolved from the user's settings.
 *
 * There are two of them because `agentop server` binds two ports with one handler: `PORT` (47291)
 * is the api, and `WEB_PORT` (PORT + 1, 47292) serves the dashboard the browser opens. The
 * dashboard address is DERIVED from the api one when the user has not set it, rather than carrying
 * a second hardcoded default: someone who moves the server to another port has already told us
 * where it is, and asking them to update a second setting to match is how the two get out of step.
 *
 * A setting that cannot be parsed falls back to the default AND says so. Silently correcting it
 * would leave the user looking at a working panel that is reading a machine they did not name.
 */

export const DEFAULT_API = 'http://127.0.0.1:47291'

export interface Endpoints {
  /** No trailing slash, so callers can concatenate `/api/...` without thinking about it. */
  api: string
  dashboard: string
  /** The setting that could not be read, when one could not be. Reported, never swallowed. */
  invalid?: string
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw)
    // Only http(s): a `file:` or `vscode-webview:` setting would fail much later, in a fetch whose
    // error says nothing about where it came from.
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/**
 * The dashboard that belongs to this api, when the user has not named one.
 *
 * `PORT + 1` is the server's own rule (`config.ts`, `WEB_PORT`), so this follows it rather than
 * repeating 47292. An address with no port at all (a proxy on 80/443) is returned unchanged: there
 * is no port to add one to, and inventing `:81` would be a guess about someone else's deployment.
 */
export function dashboardFor(api: URL): string {
  if (!api.port) return trimSlash(api.toString())
  const next = Number(api.port) + 1
  const u = new URL(api.toString())
  u.port = String(next)
  return trimSlash(u.toString())
}

export function resolveEndpoints(settings: {
  apiUrl?: string
  dashboardUrl?: string
}): Endpoints {
  const rawApi = (settings.apiUrl ?? '').trim()
  const parsedApi = rawApi ? parse(rawApi) : parse(DEFAULT_API)
  const invalidApi = rawApi && !parsedApi ? rawApi : undefined
  const api = parsedApi ?? parse(DEFAULT_API)!

  const rawDash = (settings.dashboardUrl ?? '').trim()
  const parsedDash = rawDash ? parse(rawDash) : null
  const invalidDash = rawDash && !parsedDash ? rawDash : undefined

  return {
    api: trimSlash(api.toString()),
    dashboard: parsedDash ? trimSlash(parsedDash.toString()) : dashboardFor(api),
    ...(invalidApi ?? invalidDash ? { invalid: invalidApi ?? invalidDash } : {}),
  }
}

/**
 * `127.0.0.1` → `localhost`, and nothing else touched.
 *
 * VS Code's webview port mapping is documented and implemented for `localhost`; the numeric
 * loopback is not reliably rewritten, so a frame pointed at `127.0.0.1` inside a webview reaches
 * the CLIENT machine's own loopback — which in a WSL or Remote-SSH window is a different computer
 * from the one running the server, and usually has nothing listening at all. That is a blank frame
 * with no error anywhere, which is exactly how it presented.
 *
 * Any other host is left alone: someone who pointed this at a real machine meant that machine.
 */
export function loopbackAsLocalhost(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]') {
      url.hostname = 'localhost'
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return raw
  }
}
