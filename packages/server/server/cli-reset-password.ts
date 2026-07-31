/**
 * cli-reset-password.ts — `agentop reset-password`: the account recovery path for a central.
 *
 * There is no "forgot my password" link, and there cannot be a useful one: a self-hosted central
 * has no mail server to send a reset link through, and a link it cannot deliver is worse than an
 * absent feature. An owner resets other people's passwords from the dashboard, but the LAST owner
 * has nobody above them — forget that password and the instance is gone, along with everyone
 * else's history.
 *
 * So recovery is where it belongs on self-hosted software: at the host. Whoever can run this
 * already holds the database and the session-signing key, and could mint themselves an owner
 * cookie by hand — it grants no authority that host access did not already carry, which is why
 * this is the honest recovery path and NOT a backdoor.
 *
 * Runs where Mongo is reachable (inside the container), same as `setup-token` and `doctor`.
 */
import { randomBytes } from 'node:crypto'
import { TEAM_CENTRAL } from './config'
import { hashPassword } from './passwords'

/** A readable, high-entropy temporary password (~95 bits) — it is typed once, then changed. */
function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(20)
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('').match(/.{1,5}/g)!.join('-')
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  if (i !== -1 && i + 1 < args.length && !args[i + 1]!.startsWith('--')) return args[i + 1]
  const inline = args.find(a => a.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : undefined
}

export async function runResetPassword(args: string[]): Promise<void> {
  if (!TEAM_CENTRAL) {
    process.stderr.write(
      'This command is for a team central (AGENTISTICS_TEAM_CENTRAL=1).\n' +
      'Run it where the central runs:\n' +
      '  ./central.sh reset-password --email you@example.com     (repo checkout)\n' +
      '  agentop central reset-password --email you@example.com  (standalone)\n',
    )
    process.exit(1)
  }

  const { listAccounts, findAccountByEmail, updateAccount, bumpSessionVersion } = await import('./accounts')
  const email = flag(args, 'email')

  if (!email) {
    // No guessing which account was meant — show what exists and stop.
    try {
      const accounts = await listAccounts()
      process.stderr.write('\nUsage: reset-password --email <address> [--password <new>] [--clear-mfa]\n\n')
      if (accounts.length === 0) {
        process.stderr.write('No accounts exist yet — create the owner with `setup-token` instead.\n\n')
      } else {
        process.stderr.write('Accounts on this central:\n')
        for (const a of accounts) process.stderr.write(`  ${a.email}  (${a.role})\n`)
        process.stderr.write('\n')
      }
    } catch (err) {
      process.stderr.write(`Could not reach the database: ${err instanceof Error ? err.message : String(err)}\n`)
    }
    process.exit(1)
  }

  let account
  try {
    account = await findAccountByEmail(email)
  } catch (err) {
    process.stderr.write(
      `Could not reach the database: ${err instanceof Error ? err.message : String(err)}\n` +
      'Run this inside the central, where MONGO_URL resolves:  ./central.sh reset-password …\n',
    )
    process.exit(1)
  }
  if (!account) {
    process.stderr.write(`No account with the e-mail ${email}. Run without --email to list them.\n`)
    process.exit(1)
  }

  const explicit = flag(args, 'password')
  if (explicit !== undefined && explicit.length < 12) {
    // The dashboard enforces a policy on passwords people choose; a value handed in on a command
    // line skips that check, so refuse the obviously weak ones rather than silently accepting.
    process.stderr.write('--password must be at least 12 characters.\n')
    process.exit(1)
  }
  const password = explicit ?? tempPassword()

  await updateAccount(account._id, {
    passwordHash: await hashPassword(password),
    // Always: a password handed over on a terminal (and printed below) is a transitional
    // credential, not the account's password.
    mustChangePassword: true,
  })
  // Every session minted under the old password dies with it — otherwise a stolen cookie
  // survives the very recovery performed because of it.
  await bumpSessionVersion(account._id)

  let clearedMfa = false
  if (args.includes('--clear-mfa')) {
    const { disableMfa } = await import('./mfa-store')
    await disableMfa(account._id)
    clearedMfa = true
  }

  try {
    const { writeAudit } = await import('./audit')
    await writeAudit({
      action: 'password.reset_cli',
      ip: 'cli',
      actorId: account._id,
      meta: { email: account.email, clearedMfa },
    })
  } catch { /* the reset already happened; a missing audit row must not undo it */ }

  const mfaStillOn = !clearedMfa && (await import('./mfa-store').then(m => m.isMfaEnabled(account._id)).catch(() => false))

  process.stdout.write(
    '\n' +
    '========================================================\n' +
    `  Password reset for ${account.email} (${account.role})\n\n` +
    `      ${password}\n\n` +
    '  It must be changed at the next sign-in, and every existing\n' +
    '  session for this account was signed out.\n' +
    (mfaStillOn
      ? '\n  Two-factor is STILL required for this account. If that device\n' +
        '  is also lost, use a recovery code, or re-run with --clear-mfa.\n'
      : '') +
    (clearedMfa ? '\n  Two-factor was DISABLED — enrol again after signing in.\n' : '') +
    '========================================================\n\n',
  )
}
