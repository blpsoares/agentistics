/**
 * preflight.ts — the go-live checklist, as a pure function.
 *
 * `agentop doctor --exposed` prints these and exits non-zero on any failure. Every check maps
 * to a finding in docs/exposure.md, so a red line tells the operator exactly what to fix before
 * opening a tunnel — the whole point being that none of the controls in this branch help if a
 * single env var is wrong on the day it goes public.
 *
 * fail = do not expose. warn = a deliberate trade-off the operator should have made on purpose.
 */
import type { Capabilities, ExposureProfile } from './exposure'
import { validateSecret } from './secret-store'

export interface Check {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
}

export interface PreflightInput {
  profile: ExposureProfile
  caps: Capabilities
  sessionSecret: string | undefined
  password: string | undefined
  tls: boolean
  trustProxy: boolean
  bindIp: string
  allowedOrigins: string[]
  /** E-mails of owner accounts with no TOTP enrolled. */
  ownersWithoutMfa: string[]
  mongoAuthenticated: boolean
  machineTokenCount: number
  /** True when the account/token lookups could not run. Their checks then report "unknown"
   *  rather than a reassuring pass — a control you did not verify is not a control. */
  dbUnavailable?: boolean
}

export function runPreflight(input: PreflightInput): Check[] {
  // Only a public profile is held to the full bar; `local` and `lan` are allowed to keep the
  // conveniences that would be fatal on the internet.
  const strict = input.profile === 'public'
  const checks: Check[] = []

  const anyLocalPower =
    input.caps.localShell || input.caps.localChat || input.caps.localTranscripts || input.caps.mcpAdmin
  checks.push({
    id: 'local-shell',
    label: 'Local shell / chat / transcript / MCP routes are disabled',
    status: !strict || !anyLocalPower ? 'pass' : 'fail',
    detail: anyLocalPower
      ? 'POST /api/exec, /api/chat-tty, the transcript readers or /api/mcp-action are reachable. Set AGENTISTICS_EXPOSURE=public and unset AGENTISTICS_ALLOW_LOCAL_SHELL.'
      : 'All host-power routes answer 403.',
  })

  const secret = validateSecret(input.sessionSecret, input.password)
  checks.push({
    id: 'session-secret',
    label: 'Session secret is strong and separate from the password',
    status: secret.ok ? 'pass' : 'fail',
    detail: secret.ok ? 'OK.' : `Invalid (${secret.reason}). Generate one with: openssl rand -hex 32`,
  })

  checks.push({
    id: 'tls',
    label: 'TLS is terminated in front of the app',
    status: !strict || input.tls ? 'pass' : 'fail',
    detail: input.tls
      ? 'AGENTISTICS_TEAM_TLS=1 — cookies are Secure + __Host- prefixed and HSTS is sent.'
      : 'Set AGENTISTICS_TEAM_TLS=1 once the tunnel terminates HTTPS.',
  })

  const loopback = input.bindIp === '127.0.0.1' || input.bindIp === 'localhost' || input.bindIp === '::1'
  checks.push({
    id: 'bind-ip',
    label: 'App is not published on a public interface',
    status: !strict || loopback ? 'pass' : 'fail',
    detail: `BIND_IP=${input.bindIp}. Behind a tunnel this must be 127.0.0.1 — the tunnel connects locally, so binding wider only adds a way in that bypasses it.`,
  })

  checks.push({
    id: 'trust-proxy',
    label: 'Forwarded-IP trust matches the deployment',
    status: !strict || input.trustProxy ? 'pass' : 'warn',
    detail: input.trustProxy
      ? 'AGENTISTICS_TRUST_PROXY=1 — rate limiting and the audit log see the real client IP.'
      : 'Without it every request looks like it came from the tunnel, so per-IP limits apply to all users at once.',
  })

  checks.push({
    id: 'owner-mfa',
    label: 'Every owner account has TOTP enrolled',
    status: input.dbUnavailable ? 'fail' : !strict || input.ownersWithoutMfa.length === 0 ? 'pass' : 'fail',
    detail: input.dbUnavailable
      ? 'Could not verify — the database was unreachable.'
      : input.ownersWithoutMfa.length
        ? `Missing for: ${input.ownersWithoutMfa.join(', ')}`
        : 'All owners enrolled.',
  })

  const badOrigin = input.allowedOrigins.find(o => !o.startsWith('https://'))
  checks.push({
    id: 'cors',
    label: 'CORS is same-origin or an explicit https allowlist',
    status: badOrigin ? 'fail' : 'pass',
    detail: badOrigin
      ? `Plaintext origin in AGENTISTICS_ALLOWED_ORIGINS: ${badOrigin}`
      : input.allowedOrigins.length
        ? `Allowed: ${input.allowedOrigins.join(', ')}`
        : 'Same-origin only.',
  })

  checks.push({
    id: 'mongo-auth',
    label: 'MongoDB requires authentication',
    status: input.mongoAuthenticated ? 'pass' : 'warn',
    detail: input.mongoAuthenticated
      ? 'Credentials present in MONGO_URL.'
      : 'Unauthenticated. Acceptable while the port stays unpublished and off the tunnel; point MONGO_URL at a credentialed cluster to clear this.',
  })

  checks.push({
    id: 'machine-tokens',
    label: 'Machine tokens exist and are individually revocable',
    status: input.dbUnavailable || input.machineTokenCount === 0 ? 'warn' : 'pass',
    detail: input.dbUnavailable
      ? 'Could not verify — the database was unreachable.'
      : `${input.machineTokenCount} machine token(s) minted.`,
  })

  return checks
}

export function allPassed(checks: Check[]): boolean {
  return checks.every(c => c.status !== 'fail')
}
