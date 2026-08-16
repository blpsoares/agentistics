import { describe, expect, it } from 'bun:test'
import { runPreflight, allPassed, type PreflightInput } from './preflight'

const good: PreflightInput = {
  profile: 'public',
  caps: {
    localShell: false,
    localChat: false,
    localTranscripts: false,
    localProcesses: false,
    mcpAdmin: false,
    requireMfaForOwner: true,
    requireSecureCookies: true,
  },
  sessionSecret: 'f'.repeat(64),
  password: undefined,
  tls: true,
  trustProxy: true,
  bindIp: '127.0.0.1',
  allowedOrigins: [],
  ownersWithoutMfa: [],
  mongoAuthenticated: true,
  machineTokenCount: 3,
}

const idOf = (checks: ReturnType<typeof runPreflight>, id: string) => checks.find(c => c.id === id)!

describe('runPreflight', () => {
  it('passes a fully hardened public instance', () => {
    expect(allPassed(runPreflight(good))).toBe(true)
  })

  it('fails when local shell is still reachable', () => {
    const checks = runPreflight({ ...good, caps: { ...good.caps, localShell: true } })
    expect(idOf(checks, 'local-shell').status).toBe('fail')
    expect(allPassed(checks)).toBe(false)
  })

  it('fails when any other host-power capability is reachable', () => {
    expect(allPassed(runPreflight({ ...good, caps: { ...good.caps, localTranscripts: true } }))).toBe(false)
    expect(allPassed(runPreflight({ ...good, caps: { ...good.caps, mcpAdmin: true } }))).toBe(false)
  })

  it('fails when the session secret is missing or equals the password', () => {
    expect(allPassed(runPreflight({ ...good, sessionSecret: undefined }))).toBe(false)
    expect(allPassed(runPreflight({ ...good, sessionSecret: 'p'.repeat(40), password: 'p'.repeat(40) }))).toBe(false)
  })

  it('fails when TLS is off on a public profile', () => {
    expect(idOf(runPreflight({ ...good, tls: false }), 'tls').status).toBe('fail')
  })

  it('fails when an owner has no MFA on a public profile', () => {
    const checks = runPreflight({ ...good, ownersWithoutMfa: ['vini@example.com'] })
    expect(idOf(checks, 'owner-mfa').status).toBe('fail')
    expect(idOf(checks, 'owner-mfa').detail).toContain('vini@example.com')
  })

  it('fails when the app is bound to every interface behind a tunnel', () => {
    expect(idOf(runPreflight({ ...good, bindIp: '0.0.0.0' }), 'bind-ip').status).toBe('fail')
  })

  it('warns rather than fails when forwarded-IP trust is off', () => {
    const checks = runPreflight({ ...good, trustProxy: false })
    expect(idOf(checks, 'trust-proxy').status).toBe('warn')
    expect(allPassed(checks)).toBe(true)
  })

  it('warns rather than fails when the bundled Mongo has no auth', () => {
    const checks = runPreflight({ ...good, mongoAuthenticated: false })
    expect(idOf(checks, 'mongo-auth').status).toBe('warn')
    expect(allPassed(checks)).toBe(true)
  })

  it('fails a plaintext cross-origin allowlist entry', () => {
    expect(idOf(runPreflight({ ...good, allowedOrigins: ['http://ops.example.com'] }), 'cors').status).toBe('fail')
    expect(idOf(runPreflight({ ...good, allowedOrigins: ['https://ops.example.com'] }), 'cors').status).toBe('pass')
  })

  it('does not demand TLS, MFA or a loopback bind on a local profile', () => {
    const local = runPreflight({
      ...good,
      profile: 'local',
      tls: false,
      bindIp: '0.0.0.0',
      caps: { ...good.caps, localShell: true, requireMfaForOwner: false },
      ownersWithoutMfa: ['x@y.z'],
    })
    expect(allPassed(local)).toBe(true)
  })

  it('reports every check even when they pass, so the operator sees the whole surface', () => {
    const ids = runPreflight(good).map(c => c.id)
    expect(ids).toEqual([
      'local-shell', 'session-secret', 'tls', 'bind-ip', 'trust-proxy',
      'owner-mfa', 'cors', 'mongo-auth', 'machine-tokens',
    ])
  })
})

describe('when the database could not be reached', () => {
  it('reports the owner-MFA check as unverified instead of passing it', () => {
    const checks = runPreflight({ ...good, dbUnavailable: true })
    const mfa = checks.find(c => c.id === 'owner-mfa')!
    expect(mfa.status).toBe('fail')
    expect(mfa.detail).toContain('Could not verify')
    expect(allPassed(checks)).toBe(false)
  })
})
