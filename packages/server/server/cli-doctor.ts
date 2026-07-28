/**
 * cli-doctor.ts — `agentop doctor [--exposed]`.
 *
 * Prints the go-live checklist and exits non-zero on any failure, so exposing an instance can
 * be gated on a single command instead of on remembering nine environment variables.
 * `--exposed` evaluates against the strict (public) bar even when the profile is not yet set,
 * which is how you check readiness BEFORE flipping AGENTISTICS_EXPOSURE.
 */
import { PROFILE, CAPS } from './exposure'
import { runPreflight, allPassed } from './preflight'
import {
  TEAM_SESSION_SECRET,
  TEAM_SESSION_SECRET_ENV,
  TEAM_PASSWORD,
  TEAM_TLS,
  TRUST_PROXY,
  ALLOWED_ORIGINS,
  MONGO_URL,
  TEAM_CENTRAL,
} from './config'

const GREEN = '\x1b[92m'
const RED = '\x1b[91m'
const YELLOW = '\x1b[93m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

export async function runDoctor(argv: string[]): Promise<never> {
  const exposed = argv.includes('--exposed')

  // Owner MFA + token counts need the database; a central that cannot reach it cannot be
  // declared ready either, so a lookup failure is surfaced rather than silently passed.
  let ownersWithoutMfa: string[] = []
  let machineTokenCount = 0
  let dbError: string | null = null
  if (TEAM_CENTRAL) {
    try {
      const [{ listAccounts }, { accountsWithoutMfa }, { listMachines }] = await Promise.all([
        import('./accounts'),
        import('./mfa-store'),
        import('./team-tokens'),
      ])
      const accounts = await listAccounts()
      const owners = accounts.filter(a => a.role === 'owner')
      const missing = new Set(await accountsWithoutMfa(owners.map(o => o._id)))
      ownersWithoutMfa = owners.filter(o => missing.has(o._id)).map(o => o.email)
      machineTokenCount = (await listMachines()).length
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err)
    }
  }

  const checks = runPreflight({
    profile: exposed ? 'public' : PROFILE,
    caps: CAPS,
    sessionSecret: TEAM_SESSION_SECRET_ENV ?? TEAM_SESSION_SECRET ?? undefined,
    password: TEAM_PASSWORD,
    tls: TEAM_TLS,
    trustProxy: TRUST_PROXY,
    bindIp: process.env.BIND_IP ?? '127.0.0.1',
    allowedOrigins: ALLOWED_ORIGINS,
    ownersWithoutMfa,
    // A credentialed URI carries `user:pass@`.
    mongoAuthenticated: /\/\/[^/@]+@/.test(MONGO_URL),
    machineTokenCount,
    dbUnavailable: !!dbError,
  })

  console.log(`\n  agentistics — exposure preflight ${DIM}(profile: ${exposed ? 'public (forced)' : PROFILE})${RESET}\n`)
  for (const c of checks) {
    const icon = c.status === 'pass' ? `${GREEN}✓${RESET}` : c.status === 'warn' ? `${YELLOW}!${RESET}` : `${RED}✗${RESET}`
    console.log(`  ${icon} ${c.label}`)
    console.log(`    ${DIM}${c.detail}${RESET}`)
  }

  if (dbError) {
    console.log(`\n  ${YELLOW}!${RESET} Database unreachable — owner-MFA and machine-token checks could not run.`)
    console.log(`    ${DIM}${dbError}${RESET}`)
  }

  const ok = allPassed(checks) && !dbError
  console.log(
    ok
      ? `\n  ${GREEN}Ready to expose.${RESET}\n`
      : `\n  ${RED}NOT ready${RESET} — fix every ✗ above before opening the tunnel.\n`,
  )
  process.exit(ok ? 0 : 1)
}
