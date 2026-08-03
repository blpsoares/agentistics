/**
 * client-ip.ts — resolve the caller's IP for rate limiting and audit logging.
 *
 * SECURITY: forwarded headers are attacker-controlled unless a proxy we trust rewrites them.
 * `trustProxy` is opt-in via AGENTISTICS_TRUST_PROXY=1 and must ONLY be enabled when the app is
 * unreachable except through that proxy (e.g. cloudflared on the same host, app bound to
 * 127.0.0.1). With it off we always use the socket address — a rate limiter keyed on a header
 * the attacker controls is not a rate limiter.
 *
 * An unresolvable address collapses to the shared `unknown` bucket rather than to a free pass.
 */

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6 = /^[0-9a-fA-F:]{2,45}$/

function validIp(value: string | undefined | null): string | null {
  if (!value) return null
  const v = value.trim()
  if (IPV4.test(v)) return v
  if (v.includes(':') && IPV6.test(v)) return v
  return null
}

export function resolveClientIp(input: {
  socketAddress: string | null
  headers: Headers
  trustProxy: boolean
}): string {
  if (input.trustProxy) {
    const cf = validIp(input.headers.get('cf-connecting-ip'))
    if (cf) return cf
    const xff = input.headers.get('x-forwarded-for')
    if (xff) {
      const first = validIp(xff.split(',')[0])
      if (first) return first
    }
  }
  return validIp(input.socketAddress) ?? 'unknown'
}
