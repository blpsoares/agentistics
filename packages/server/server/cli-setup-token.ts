/**
 * cli-setup-token.ts — `agentop setup-token`: reissue the one-time OWNER setup token.
 *
 * The token is printed to the log ONCE, at the boot that mints it. A log that has rotated,
 * a `logs` window that scrolled, a container recreated before anyone read it — and the central
 * is unreachable forever, because the boot path deliberately does NOT mint a second token
 * (it would silently invalidate one an operator may still be holding). This is the documented
 * way back in, and the boot message names it.
 *
 * Runs where Mongo is reachable — inside the container (`central.sh setup-token` /
 * `agentop central setup-token` exec it there), not on the host.
 */
import { generateBootstrapToken } from './bootstrap'
import { TEAM_CENTRAL } from './config'

/**
 * Mint a fresh setup token and print it, replacing any earlier one.
 * Refuses once an owner exists: the token only ever creates the FIRST owner (POST
 * /api/iam/bootstrap answers 409 afterwards), so minting one then would hand out a
 * credential that cannot work and reads like an account-recovery path it is not.
 */
export async function runSetupToken(): Promise<void> {
  if (!TEAM_CENTRAL) {
    process.stderr.write(
      'This command is for a team central (AGENTISTICS_TEAM_CENTRAL=1).\n' +
      'Run it where the central runs:\n' +
      '  ./central.sh setup-token          (repo checkout)\n' +
      '  agentop central setup-token       (standalone)\n',
    )
    process.exit(1)
  }

  let ownerExists: boolean
  try {
    const { hasAnyOwner } = await import('./accounts')
    ownerExists = await hasAnyOwner()
  } catch (err) {
    process.stderr.write(
      `Could not reach the database: ${err instanceof Error ? err.message : String(err)}\n` +
      'Run this inside the central (that is where MONGO_URL resolves):\n' +
      '  ./central.sh setup-token\n',
    )
    process.exit(1)
  }

  if (ownerExists) {
    process.stderr.write(
      '\nThis central is already set up — an owner account exists.\n' +
      'The setup token only ever creates the FIRST owner, so issuing one now would be useless.\n' +
      'Locked out of the owner account? Reset its password from another owner account, or from\n' +
      'the database directly. Do NOT wipe the config document to force a new token: that does not\n' +
      'remove the existing owner, and the token would still be refused.\n\n',
    )
    process.exit(1)
  }

  const token = await generateBootstrapToken(new Date())
  process.stdout.write(
    '\n' +
    '========================================================\n' +
    '  agentistics — OWNER SETUP TOKEN (reissued)\n' +
    '  Any token issued earlier is now invalid.\n' +
    '  Open the dashboard and create the owner account with:\n\n' +
    `      ${token}\n\n` +
    '  Keep it secret. It is shown only once.\n' +
    '========================================================\n\n',
  )
}
