/**
 * iam-handlers.ts — thin IO route handlers for IAM bootstrap (Phase 2).
 * Mirrors auth.ts: each returns a Response with JSON content-type; the caller in
 * index.ts spreads CORS_HEADERS. Bootstrap is public only while no owner exists —
 * handleBootstrap re-checks hasAnyOwner() and refuses once set up.
 */
import { randomBytes } from 'node:crypto'
import { hasAnyOwner, countOwners, createAccount, findAccountByEmail, updateAccount, getAccount, listAccounts, deleteAccount, bumpSessionVersion } from './accounts'
import { hashPassword, verifyPassword } from './passwords'
import { validateOwnerInput, verifyBootstrapToken, consumeBootstrapToken } from './bootstrap'
import { listTeams, createTeam, getTeam, deleteTeam } from './teams'
import { backfillTokenTeamIds, listMachines, mintMachineToken, mintMachine, revokeToken, rotateToken, setMachineTeams, setMachineLabel, setMachineOwners, detachTeamFromAllMachines, detachAccountFromAllMachines } from './team-tokens'
import { getCentralConfig } from './central-config'
import { packConnectToken } from '@agentistics/core'
import { backfillRepoTeamIds } from './team-repos'
import {
  makePrincipalSessionCookieHeader,
  getPrincipal,
  signMfaChallenge,
  verifyMfaChallenge,
  MFA_CHALLENGE_TTL_MS,
} from './auth'
import { TEAM_SESSION_SECRET } from './config'
import { generateSecret, otpauthUri, verifyTotp, generateRecoveryCodes, hashRecoveryCode } from './totp'
import { getMfa, isMfaEnabled, enableMfa, disableMfa, consumeRecoveryCode } from './mfa-store'
import { publicAccount, accountVisibleTo, canCreateAccount, canDeleteAccount, teamVisibleTo, canManageMachineTeam, canManageMachine, canAssignMemberships } from './iam-view'
import type { AccountDoc, Membership, Role } from './iam-types'
import { normalizeEmail } from './iam-types'
import { limiter, RULES, tooManyRequests } from './rate-limit'
import { validatePasswordPolicy } from './password-policy'
import { writeAudit } from './audit'
import { readJsonLimited, LIMITS } from './limits'

const JSON_CT = { 'Content-Type': 'application/json' } as const

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_CT })
}

/** GET /api/iam/status — tells the SPA whether first-owner setup is still needed. */
export async function handleIamStatus(): Promise<Response> {
  let needsBootstrap = false
  try {
    needsBootstrap = !(await hasAnyOwner())
  } catch {
    needsBootstrap = false // DB unreachable → don't advertise a setup screen
  }
  return json({ central: true, needsBootstrap })
}

/**
 * POST /api/iam/bootstrap
 * Body: { token, name, email, password, confirm }
 * Creates the first owner (if none exists), seeds the Default team, backfills teamId,
 * consumes the token, and logs the caller in (principal session cookie).
 */
export async function handleBootstrap(req: Request): Promise<Response> {
  if (await hasAnyOwner()) return json({ ok: false, error: 'already set up' }, 409)

  const parsedBody = await readJsonLimited<unknown>(req, LIMITS.bodyBytes)
  if (!parsedBody.ok) {
    return json({ ok: false, error: parsedBody.error }, parsedBody.error === 'too_large' ? 413 : 400)
  }
  const body: unknown = parsedBody.value

  const v = validateOwnerInput(body as Record<string, unknown>)
  if (!v.ok) return json({ ok: false, error: v.error }, 400)

  if (!(await verifyBootstrapToken(v.value.token))) {
    return json({ ok: false, error: 'invalid setup token' }, 401)
  }

  const passwordHash = await hashPassword(v.value.password)
  const account = await createAccount({
    name: v.value.name,
    email: v.value.email,
    passwordHash,
    role: 'owner',
    memberships: [],
  })

  // No Default team is seeded — machines/accounts start with no team (loose) and are assigned to
  // real teams explicitly. Backfills only normalize legacy shapes.
  await backfillTokenTeamIds()
  await backfillRepoTeamIds()
  await consumeBootstrapToken(new Date().toISOString())

  const cookie = makePrincipalSessionCookieHeader(account._id, account.sessionVersion)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...JSON_CT, 'Set-Cookie': cookie },
  })
}

/**
 * POST /api/iam/login  Body: { email, password }
 * Generic 401 on unknown email OR wrong password (no user enumeration).
 */
export async function handleIamLogin(
  req: Request,
  hooks: { onSuccess?: () => void; ip?: string } = {},
): Promise<Response> {
  const ip = hooks.ip ?? 'unknown'
  const parsedBody = await readJsonLimited<unknown>(req, LIMITS.bodyBytes)
  if (!parsedBody.ok) {
    return json({ ok: false, error: parsedBody.error }, parsedBody.error === 'too_large' ? 413 : 400)
  }
  const body: unknown = parsedBody.value
  const b = body as Record<string, unknown>
  const email = typeof b.email === 'string' ? b.email : ''
  const password = typeof b.password === 'string' ? b.password : ''

  // Per-account soft backoff, on top of the per-IP limit applied in index.ts: an attacker
  // guessing one mailbox is slowed even when they rotate source addresses. Checked BEFORE the
  // argon2 verify so a locked account costs no CPU (that verify is the expensive part, and an
  // unauthenticated caller must never be able to spend it freely).
  const acctKey = `acct:${normalizeEmail(email)}`
  const acctVerdict = limiter.check(acctKey, RULES.login)
  if (!acctVerdict.allowed) return tooManyRequests(acctVerdict.retryAfterSec)

  const account = await findAccountByEmail(email)
  const ok = account ? await verifyPassword(password, account.passwordHash) : false
  if (!account || !ok) {
    limiter.fail(acctKey, RULES.login)
    // The e-mail is recorded (it is not a secret and an incident review needs it); the password
    // never is — buildAuditEvent drops it even if a caller passes it.
    void writeAudit({ action: 'login.failure', ip, targetId: account?._id, meta: { email: normalizeEmail(email) } })
    return json({ ok: false, error: 'invalid credentials' }, 401)
  }
  limiter.reset(acctKey)
  hooks.onSuccess?.()

  // Second factor, when enrolled: the password alone issues NO cookie. The caller gets a
  // short-lived, HMAC-signed challenge that grants nothing by itself and must be exchanged
  // for a session at /api/iam/login/mfa.
  if (await isMfaEnabled(account._id)) {
    const challenge = signMfaChallenge(
      account._id,
      account.sessionVersion,
      TEAM_SESSION_SECRET,
      Date.now() + MFA_CHALLENGE_TTL_MS,
    )
    void writeAudit({ action: 'login.mfa_challenge', ip, actorId: account._id })
    return json({ ok: false, mfaRequired: true, challenge }, 200)
  }

  await updateAccount(account._id, { lastLoginAt: new Date().toISOString() })
  void writeAudit({ action: 'login.success', ip, actorId: account._id })
  const cookie = makePrincipalSessionCookieHeader(account._id, account.sessionVersion)
  return new Response(JSON.stringify({ ok: true, mustChangePassword: account.mustChangePassword ?? false }), { status: 200, headers: { ...JSON_CT, 'Set-Cookie': cookie } })
}

/**
 * POST /api/iam/login/mfa  Body: { challenge, code }
 * Exchanges a password-stage challenge for a session by proving the second factor.
 * `code` is either a 6-digit TOTP or one of the account's single-use recovery codes.
 */
export async function handleIamLoginMfa(req: Request): Promise<Response> {
  const parsedBody = await readJsonLimited<unknown>(req, LIMITS.bodyBytes)
  if (!parsedBody.ok) {
    return json({ ok: false, error: parsedBody.error }, parsedBody.error === 'too_large' ? 413 : 400)
  }
  const body: unknown = parsedBody.value
  const b = body as Record<string, unknown>
  const challenge = typeof b.challenge === 'string' ? b.challenge : ''
  const code = typeof b.code === 'string' ? b.code : ''

  const parsed = verifyMfaChallenge(challenge, TEAM_SESSION_SECRET, Date.now())
  if (!parsed) return json({ ok: false, error: 'challenge expired' }, 401)

  // Rate-limit the second factor on its own key: six digits is a small space, so an
  // unbounded challenge would reduce 2FA to a brute-forceable formality.
  const mfaKey = `mfa:${parsed.accountId}`
  const verdict = limiter.check(mfaKey, RULES.login)
  if (!verdict.allowed) return tooManyRequests(verdict.retryAfterSec)

  const account = await getAccount(parsed.accountId)
  if (!account || account.sessionVersion !== parsed.sessionVersion) {
    return json({ ok: false, error: 'challenge expired' }, 401)
  }
  const mfa = await getMfa(parsed.accountId)
  if (!mfa) return json({ ok: false, error: 'challenge expired' }, 401)

  let usedRecovery = false
  let ok = verifyTotp(mfa.secret, code, Math.floor(Date.now() / 1000))
  if (!ok) {
    ok = await consumeRecoveryCode(parsed.accountId, hashRecoveryCode(code))
    usedRecovery = ok
  }
  if (!ok) {
    limiter.fail(mfaKey, RULES.login)
    void writeAudit({ action: 'login.mfa_failure', ip: 'unknown', actorId: parsed.accountId })
    return json({ ok: false, error: 'invalid code' }, 401)
  }
  limiter.reset(mfaKey)
  if (usedRecovery) void writeAudit({ action: 'mfa.recovery_used', ip: 'unknown', actorId: parsed.accountId })
  void writeAudit({ action: 'login.success', ip: 'unknown', actorId: parsed.accountId, meta: { secondFactor: usedRecovery ? 'recovery' : 'totp' } })

  await updateAccount(account._id, { lastLoginAt: new Date().toISOString() })
  const cookie = makePrincipalSessionCookieHeader(account._id, account.sessionVersion)
  return new Response(
    JSON.stringify({
      ok: true,
      mustChangePassword: account.mustChangePassword ?? false,
      usedRecovery,
      recoveryCodesLeft: usedRecovery ? Math.max(0, mfa.recoveryHashes.length - 1) : mfa.recoveryHashes.length,
    }),
    { status: 200, headers: { ...JSON_CT, 'Set-Cookie': cookie } },
  )
}

/**
 * MFA enrolment, all authenticated and all acting on the CALLER's own account:
 *   GET    /api/iam/mfa        → { enabled }
 *   POST   /api/iam/mfa/start  → { secret, otpauthUri }  (generated, not yet active)
 *   POST   /api/iam/mfa/enable { secret, code } → { recoveryCodes } shown exactly once
 *   DELETE /api/iam/mfa        { code } → disables
 */
export async function handleMfa(req: Request, pathname: string): Promise<Response> {
  const principal = await getPrincipal(req)
  if (!principal) return json({ error: 'unauthorized' }, 401)
  const account = await getAccount(principal.accountId)
  if (!account) return json({ error: 'unauthorized' }, 401)

  if (pathname === '/api/iam/mfa' && req.method === 'GET') {
    return json({ enabled: await isMfaEnabled(account._id) })
  }

  if (pathname === '/api/iam/mfa/start' && req.method === 'POST') {
    const secret = generateSecret()
    return json({ secret, otpauthUri: otpauthUri(secret, account.email, 'Agentistics') })
  }

  if (pathname === '/api/iam/mfa/enable' && req.method === 'POST') {
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
    const b = body as Record<string, unknown>
    const secret = typeof b.secret === 'string' ? b.secret : ''
    const code = typeof b.code === 'string' ? b.code : ''
    // Verifying the code before storing proves the authenticator is really in sync — enrolling
    // an unverified secret locks the account out of its own second factor.
    if (!secret || !verifyTotp(secret, code, Math.floor(Date.now() / 1000))) {
      return json({ error: 'invalid code' }, 400)
    }
    const recoveryCodes = generateRecoveryCodes()
    await enableMfa(account._id, secret, recoveryCodes.map(hashRecoveryCode))
    void writeAudit({ action: 'mfa.enable', ip: 'unknown', actorId: account._id })
    // Every session that authenticated with the password alone is now under-authenticated.
    await bumpSessionVersion(account._id)
    const cookie = makePrincipalSessionCookieHeader(account._id, account.sessionVersion + 1)
    return new Response(JSON.stringify({ ok: true, recoveryCodes }), {
      status: 200,
      headers: { ...JSON_CT, 'Set-Cookie': cookie },
    })
  }

  if (pathname === '/api/iam/mfa' && req.method === 'DELETE') {
    let body: unknown
    try { body = await req.json() } catch { body = {} }
    const code = typeof (body as Record<string, unknown>).code === 'string'
      ? ((body as Record<string, unknown>).code as string)
      : ''
    const mfa = await getMfa(account._id)
    if (!mfa) return json({ ok: true })
    if (!verifyTotp(mfa.secret, code, Math.floor(Date.now() / 1000))) {
      return json({ error: 'invalid code' }, 401)
    }
    await disableMfa(account._id)
    void writeAudit({ action: 'mfa.disable', ip: 'unknown', actorId: account._id })
    return json({ ok: true })
  }

  return json({ error: 'not found' }, 404)
}

/**
 * GET /api/iam/me → { authed, account? }. Drives the logged-in-user display + the SPA gate.
 */
export async function handleIamMe(req: Request): Promise<Response> {
  const principal = await getPrincipal(req)
  if (!principal) return json({ authed: false })
  const account = await getAccount(principal.accountId)
  if (!account) return json({ authed: false })
  return json({ authed: true, account: publicAccount(account) })
}

/**
 * POST /api/iam/change-password  Body: { currentPassword?, newPassword }
 * Self-service password change. currentPassword is required UNLESS the account is flagged
 * mustChangePassword (forced first-login change). Bumps sessionVersion to invalidate old
 * sessions, then re-issues the caller's principal cookie with the bumped version so they
 * stay logged in.
 */
export async function handleChangePassword(req: Request): Promise<Response> {
  const principal = await getPrincipal(req)
  if (!principal) return json({ error: 'unauthorized' }, 401)
  let body: unknown
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const b = body as Record<string, unknown>
  const current = typeof b.currentPassword === 'string' ? b.currentPassword : ''
  const next = typeof b.newPassword === 'string' ? b.newPassword : ''
  const account = await getAccount(principal.accountId)
  if (!account) return json({ error: 'account not found' }, 404)
  const policy = validatePasswordPolicy(next, { email: account.email, name: account.name })
  if (!policy.ok) return json({ error: policy.error }, 400)
  // require currentPassword unless this is a forced first-login change
  if (!account.mustChangePassword) {
    if (!(await verifyPassword(current, account.passwordHash))) return json({ error: 'current password is incorrect' }, 401)
  }
  void writeAudit({ action: 'password.change', ip: 'unknown', actorId: account._id })
  const passwordHash = await hashPassword(next)
  await updateAccount(account._id, { passwordHash, mustChangePassword: false })
  await bumpSessionVersion(account._id) // invalidate old sessions
  // Re-issue with the bumped version (stored version is now account.sessionVersion + 1)
  // so the caller stays logged in.
  const cookie = makePrincipalSessionCookieHeader(account._id, account.sessionVersion + 1)
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...JSON_CT, 'Set-Cookie': cookie } })
}

/** Parse an unknown value into a Membership[] (drops malformed entries). */
function parseMemberships(v: unknown): Membership[] {
  if (!Array.isArray(v)) return []
  const out: Membership[] = []
  for (const m of v) {
    const r = (m as Record<string, unknown>)?.role
    const t = (m as Record<string, unknown>)?.teamId
    if (typeof t === 'string' && (r === 'manager' || r === 'user')) out.push({ teamId: t, role: r })
  }
  return out
}

/** Machine-link requests from create body: `machines: [{name, teamId?}]` (+ single `machine:{name}`
 *  alias). Drops entries without a non-empty name. Each becomes its own minted machine token. */
function parseMachineRequests(machines: unknown, single: unknown): { name: string; teamId?: string }[] {
  const out: { name: string; teamId?: string }[] = []
  if (Array.isArray(machines)) {
    for (const m of machines) {
      const name = typeof (m as Record<string, unknown>)?.name === 'string' ? ((m as Record<string, unknown>).name as string).trim() : ''
      const teamId = typeof (m as Record<string, unknown>)?.teamId === 'string' ? ((m as Record<string, unknown>).teamId as string) : undefined
      if (name) out.push({ name, ...(teamId ? { teamId } : {}) })
    }
  }
  const singleName = typeof (single as Record<string, unknown> | undefined)?.name === 'string'
    ? ((single as Record<string, unknown>).name as string).trim() : ''
  if (singleName) out.push({ name: singleName })
  return out
}

/**
 * /api/iam/accounts — GET list (scoped), POST create, DELETE remove. Self-guarding.
 */
export async function handleAccounts(req: Request): Promise<Response> {
  const principal = await getPrincipal(req)
  if (!principal) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'GET') {
    const all = await listAccounts()
    return json({ accounts: all.filter(a => accountVisibleTo(principal, a)).map(publicAccount) })
  }

  if (req.method === 'POST') {
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
    const b = body as Record<string, unknown>
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    const email = typeof b.email === 'string' ? b.email.trim() : ''
    const password = typeof b.password === 'string' ? b.password : ''
    const role: Role = b.role === 'owner' ? 'owner' : 'member'
    const memberships = parseMemberships(b.memberships)
    const mustChangePassword = typeof b.mustChangePassword === 'boolean' ? b.mustChangePassword : true
    // Machines to link at creation: accept `machines: [{name, teamId?}]` (multiple, each mints its
    // own token) plus a single `machine: {name}` alias for back-compat.
    const machineReqs = parseMachineRequests(b.machines, b.machine)
    if (!name) return json({ error: 'name is required' }, 400)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'valid email is required' }, 400)
    const policy = validatePasswordPolicy(password, { email, name })
    if (!policy.ok) return json({ error: policy.error }, 400)
    // Only an owner may create another owner (global, no team scope). A member account follows the
    // scoped canCreateAccount rule (owner→any; manager→user-role memberships in teams they manage).
    if (role === 'owner') {
      if (principal.role !== 'owner') return json({ error: 'forbidden' }, 403)
    } else if (!canCreateAccount(principal, memberships)) {
      return json({ error: 'forbidden' }, 403)
    }
    if (await findAccountByEmail(email)) return json({ error: 'email already exists' }, 409)
    const passwordHash = await hashPassword(password)
    const account = role === 'owner'
      ? await createAccount({ name, email, passwordHash, role: 'owner', memberships: [], createdBy: principal.accountId, mustChangePassword })
      : await createAccount({ name, email, passwordHash, role: 'member', memberships, createdBy: principal.accountId, mustChangePassword })
    // Link the requested machines — one token per machine, each gated by team scope.
    const fallbackTeam = account.memberships[0]?.teamId || 'default'
    const centralUrl = (await getCentralConfig()).publicUrl
    const machineTokens: { name: string; token: string }[] = []
    for (const m of machineReqs) {
      const teamId = (m.teamId && account.memberships.some(x => x.teamId === m.teamId)) ? m.teamId : fallbackTeam
      if (!canManageMachineTeam(principal, teamId)) continue // out-of-scope machine link is skipped
      const { token } = await mintMachineToken({ accountId: account._id, user: account.name, machineName: m.name, teamId })
      machineTokens.push({ name: m.name, token: packConnectToken(token, centralUrl) })
    }
    const firstToken = machineTokens[0]?.token
    return json({
      account: publicAccount(account),
      ...(firstToken ? { machineTokens, machineToken: firstToken } : {}),
    }, 201)
  }

  if (req.method === 'PATCH') {
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
    const b = body as Record<string, unknown>
    const id = typeof b.id === 'string' ? b.id : ''
    if (!id) return json({ error: 'id is required' }, 400)
    const target = await getAccount(id)
    if (!target) return json({ error: 'not found' }, 404)

    const isOwner = principal.role === 'owner'
    const isSelf = target._id === principal.accountId

    // Authz:
    //  - self: rename only (password via change-password; you can't alter your own memberships/role).
    //  - owner: may edit anyone; memberships only apply to member accounts (reject on owner targets).
    //  - manager: only targets they may delete (user-members in managed teams) — canDeleteAccount
    //    already rejects owner targets for them.
    if (isSelf) {
      if (b.memberships !== undefined || b.resetPassword === true) return json({ error: 'forbidden' }, 403)
    } else if (isOwner) {
      if (target.role === 'owner' && b.memberships !== undefined) {
        return json({ error: 'forbidden' }, 403)
      }
    } else if (!canDeleteAccount(principal, target)) {
      return json({ error: 'forbidden' }, 403)
    }

    const patch: Partial<Pick<AccountDoc, 'name' | 'memberships' | 'passwordHash' | 'mustChangePassword'>> = {}

    if (b.name !== undefined) {
      const name = typeof b.name === 'string' ? b.name.trim() : ''
      if (!name) return json({ error: 'name cannot be empty' }, 400)
      patch.name = name
    }

    if (b.memberships !== undefined) {
      const memberships = parseMemberships(b.memberships)
      // A manager may assign EITHER role (user or manager) but only inside teams they manage —
      // delegating within your own team is not escalation. Assigning into an unmanaged team is.
      // Unlike creation, EDIT may reduce to an empty set (removing a member from the manager's only
      // team is allowed — the entry gate already proved every current membership was in scope).
      if (!isOwner && memberships.length > 0 && !canAssignMemberships(principal, memberships)) {
        return json({ error: 'forbidden' }, 403)
      }
      patch.memberships = memberships
    }

    let tempPassword: string | undefined
    if (b.resetPassword === true) {
      tempPassword = randomBytes(12).toString('hex') // 24 hex chars
      patch.passwordHash = await hashPassword(tempPassword)
      patch.mustChangePassword = true
    }

    if (Object.keys(patch).length === 0) return json({ error: 'nothing to update' }, 400)
    await updateAccount(target._id, patch)
    // A password reset invalidates the target's existing sessions (forces re-login → first change).
    if (b.resetPassword === true) await bumpSessionVersion(target._id)

    const updated = await getAccount(target._id)
    return json({
      ok: true,
      account: publicAccount(updated ?? target),
      ...(tempPassword ? { tempPassword } : {}),
    })
  }

  if (req.method === 'DELETE') {
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
    const id = typeof (body as Record<string, unknown>)?.id === 'string' ? (body as Record<string, unknown>).id as string : ''
    if (!id) return json({ error: 'id is required' }, 400)
    if (id === principal.accountId) return json({ error: 'cannot delete yourself' }, 400)
    const target = await getAccount(id)
    if (!target) return json({ error: 'not found' }, 404)
    if (!canDeleteAccount(principal, target)) return json({ error: 'forbidden' }, 403)
    // Last-owner protection: never leave the instance with zero owners.
    if (target.role === 'owner' && (await countOwners()) <= 1) {
      return json({ error: 'cannot delete the last owner' }, 400)
    }
    await deleteAccount(id)
    // Detach the deleted account from any machines it owned — the machines survive, they just lose
    // the dead owner relation (no orphaned accountId left dangling).
    await detachAccountFromAllMachines(id).catch(() => {})
    return json({ ok: true })
  }

  return json({ error: 'method not allowed' }, 405)
}

/**
 * /api/iam/teams — GET list (scoped), POST create (owner), DELETE remove (owner, not default).
 */
export async function handleTeams(req: Request): Promise<Response> {
  const principal = await getPrincipal(req)
  if (!principal) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'GET') {
    const all = await listTeams()
    return json({ teams: all.filter(t => teamVisibleTo(principal, t._id)) })
  }

  if (req.method === 'POST') {
    if (principal.role !== 'owner') return json({ error: 'forbidden' }, 403)
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
    const name = typeof (body as Record<string, unknown>)?.name === 'string' ? ((body as Record<string, unknown>).name as string).trim() : ''
    if (!name) return json({ error: 'name is required' }, 400)
    const team = await createTeam(name, principal.accountId)
    return json({ team }, 201)
  }

  if (req.method === 'DELETE') {
    if (principal.role !== 'owner') return json({ error: 'forbidden' }, 403)
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
    const id = typeof (body as Record<string, unknown>)?.id === 'string' ? (body as Record<string, unknown>).id as string : ''
    if (!id) return json({ error: 'id is required' }, 400)
    if (!(await getTeam(id))) return json({ error: 'not found' }, 404)
    await deleteTeam(id)
    // Detach the deleted team from any machines in it (no orphaned teamId left showing as a raw _id)
    // and from any account memberships that referenced it.
    await detachTeamFromAllMachines(id).catch(() => {})
    try {
      const accounts = await listAccounts()
      for (const a of accounts) {
        if (a.memberships.some(m => m.teamId === id)) {
          await updateAccount(a._id, { memberships: a.memberships.filter(m => m.teamId !== id) })
        }
      }
    } catch { /* best-effort */ }
    return json({ ok: true })
  }

  return json({ error: 'method not allowed' }, 405)
}

/**
 * /api/iam/machines — GET list (scoped), POST add-to-account (gated). Self-guarding.
 * Owner sees/manages all; a manager only their team's machines.
 */
export async function handleMachines(req: Request): Promise<Response> {
  const principal = await getPrincipal(req)
  if (!principal) return json({ error: 'unauthorized' }, 401)
  if (req.method === 'GET') {
    const all = await listMachines()
    // Owner sees all; anyone else sees machines in teams they manage PLUS their own account's
    // machines (so a user can view/manage the machines linked to them).
    const visible = principal.role === 'owner' ? all : all.filter(m => canManageMachine(principal, m))

    // Enrich with owner account info — ONLY for accounts the caller may actually see, so a manager
    // never learns an owner account's name/email via a default-team machine.
    const accounts = await listAccounts()
    const accountMap = new Map<string, AccountDoc>()
    for (const a of accounts) accountMap.set(a._id, a)

    // Enrich with presence (keyed by user, mirroring the members panel).
    const presence = await import('./team-presence').then(m => m.computePresence()).catch(() => ({} as Record<string, { online: boolean; latencyMs: number | null }>))

    const enriched = visible.map(m => {
      // Resolve every owner account the caller may actually see (no cross-scope name/email leak).
      const owners = m.accountIds
        .map(id => accountMap.get(id))
        .filter((a): a is AccountDoc => !!a && accountVisibleTo(principal, a))
        .map(a => ({ id: a._id, name: a.name, email: a.email }))
      return {
        ...m,
        owners,
        // Back-compat: primary owner's name/email for any caller still reading the flat fields.
        ...(owners[0] ? { accountName: owners[0].name, accountEmail: owners[0].email } : {}),
        online: presence[m.user]?.online ?? false,
        latencyMs: presence[m.user]?.latencyMs ?? null,
      }
    })

    return json({ machines: enriched })
  }
  if (req.method === 'POST') {
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
    const b = body as Record<string, unknown>
    // Set a machine's owner ACCOUNTS (scoped): { ownerId, accountIds: string[] } (a single
    // { accountId } is also accepted). A machine may be owned/managed by several accounts. Every
    // account in the new set must be visible to the caller, and the caller must manage the machine.
    const ownerId = typeof b.ownerId === 'string' ? b.ownerId : ''
    if (ownerId) {
      const accountIds = Array.isArray(b.accountIds)
        ? b.accountIds.filter((x): x is string => typeof x === 'string')
        : (typeof b.accountId === 'string' ? [b.accountId] : [])
      const machine = (await listMachines()).find(m => m.id === ownerId)
      if (!machine) return json({ error: 'machine not found' }, 404)
      if (!canManageMachine(principal, machine)) return json({ error: 'forbidden' }, 403)
      // Validate every target account exists + is visible to the caller (no assigning to
      // out-of-scope accounts). An empty list is allowed (clears ownership) only for an owner.
      if (accountIds.length === 0 && principal.role !== 'owner') return json({ error: 'accountIds is required' }, 400)
      for (const id of accountIds) {
        const acct = await getAccount(id)
        if (!acct) return json({ error: 'account not found' }, 404)
        if (!accountVisibleTo(principal, acct)) return json({ error: 'forbidden' }, 403)
      }
      // The machine's display identity follows its (first) owner account, so a re-assigned machine
      // stops showing the previous — possibly deleted — account's name.
      const nextUser = accountIds[0] ? (await getAccount(accountIds[0]))?.name : undefined
      await setMachineOwners(ownerId, accountIds, nextUser)
      // Tell the machine over the reverse WebSocket so a solo/member instance refreshes the
      // "Connected as" panel instead of showing the old account until its next handshake.
      try {
        const actor = (await getAccount(principal.accountId))?.name ?? 'an admin'
        const { notifyMember } = await import('./team-agent')
        notifyMember(machine.user, { type: 'reassigned', account: nextUser ?? null, actor })
      } catch { /* best-effort — the identity still reflects via whoami */ }
      return json({ ok: true })
    }
    // Rename a machine (scoped): { renameId, name }. Updates the token label; the new name
    // reflects on the machine at its next whoami handshake. Owner / team-manager / the machine's
    // own account may rename.
    const renameId = typeof b.renameId === 'string' ? b.renameId : ''
    if (renameId) {
      const newName = typeof b.name === 'string' ? b.name.trim() : ''
      if (!newName) return json({ error: 'name is required' }, 400)
      const machine = (await listMachines()).find(m => m.id === renameId)
      if (!machine) return json({ error: 'machine not found' }, 404)
      if (!canManageMachine(principal, machine)) return json({ error: 'forbidden' }, 403)
      await setMachineLabel(renameId, newName)
      // Notify the machine over the reverse WebSocket (best-effort) with the new name + who did it.
      try {
        const actor = (await getAccount(principal.accountId))?.name ?? 'an admin'
        const { notifyMember } = await import('./team-agent')
        notifyMember(machine.user, { type: 'renamed', name: newName, actor })
      } catch { /* best-effort — the name still reflects via whoami */ }
      return json({ ok: true })
    }
    // Rotate a machine's token (scoped): { rotateId } → new plaintext token once. Lets an admin OR
    // the machine's owner recover a lost token (the shown-once token can't be re-displayed).
    const rotateId = typeof b.rotateId === 'string' ? b.rotateId : ''
    if (rotateId) {
      const machine = (await listMachines()).find(m => m.id === rotateId)
      if (!machine) return json({ error: 'machine not found' }, 404)
      if (!canManageMachine(principal, machine)) return json({ error: 'forbidden' }, 403)
      const token = await rotateToken(rotateId)
      if (token === null) return json({ error: 'machine not found' }, 404)
      return json({ token: packConnectToken(token, (await getCentralConfig()).publicUrl) }, 200)
    }
    // Reassign a machine to another team (scoped): { reassignId, teamId }. Must manage BOTH the
    // machine's current team and the target team. Used by the Teams page to attach a machine.
    // Change a machine's TEAMS (a machine can be in several). Forms:
    //   { reassignId, addTeamId }        → attach one team
    //   { reassignId, removeTeamId }     → detach one team (empty set → loose)
    //   { reassignId, teamIds: [...] }   → replace the whole set (single `teamId` accepted as alias)
    const reassignId = typeof b.reassignId === 'string' ? b.reassignId : ''
    if (reassignId) {
      const machine = (await listMachines()).find(m => m.id === reassignId)
      if (!machine) return json({ error: 'machine not found' }, 404)
      // You must ALREADY manage the machine to change its teams — otherwise a manager could seize a
      // machine they only observed the id of (via a shared/Default team) by attaching it to a team
      // they manage, then rotate/revoke/re-own it. Owner bypasses.
      if (!canManageMachine(principal, machine)) return json({ error: 'forbidden' }, 403)
      const current = machine.teamIds && machine.teamIds.length ? machine.teamIds : (machine.teamId ? [machine.teamId] : [])
      const addTeamId = typeof b.addTeamId === 'string' && b.addTeamId ? b.addTeamId : ''
      const removeTeamId = typeof b.removeTeamId === 'string' && b.removeTeamId ? b.removeTeamId : ''
      let next: string[]
      if (addTeamId) {
        if (!(await getTeam(addTeamId))) return json({ error: 'team not found' }, 404)
        if (!canManageMachineTeam(principal, addTeamId)) return json({ error: 'forbidden' }, 403)
        next = [...new Set([...current, addTeamId])]
      } else if (removeTeamId) {
        // Detach: must manage the team being removed (owner always).
        if (!canManageMachineTeam(principal, removeTeamId)) return json({ error: 'forbidden' }, 403)
        next = current.filter(t => t !== removeTeamId)
      } else {
        // Replace the whole set. A non-owner must manage EVERY team involved (old ∪ new) — no Default
        // exemption — so a replace can't drop or add teams outside their scope.
        const raw = Array.isArray(b.teamIds) ? b.teamIds.filter((x): x is string => typeof x === 'string' && !!x)
          : (typeof b.teamId === 'string' && b.teamId ? [b.teamId] : [])
        next = [...new Set(raw)]
        for (const t of next) if (!(await getTeam(t))) return json({ error: 'team not found' }, 404)
        if (principal.role !== 'owner') {
          const involved = [...new Set([...current, ...next])]
          const ok = involved.every(t => canManageMachineTeam(principal, t))
          if (!ok) return json({ error: 'forbidden' }, 403)
        }
      }
      await setMachineTeams(reassignId, next)
      return json({ ok: true })
    }
    // Mint a new machine: { name, accountIds?: string[], teamId?: string }.
    // Flexible linkage: name required; accountIds (0+) optional; teamId optional.
    // Owners may create any combination (incl. fully loose). Non-owners must provide a teamId they
    // manage (else 403) — prevents managers creating machines outside their scope.
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) return json({ error: 'name is required' }, 400)
    // accountIds: accept either an array OR a single accountId alias → array (may be empty).
    const accountIds = Array.isArray(b.accountIds)
      ? b.accountIds.filter((x): x is string => typeof x === 'string')
      : (typeof b.accountId === 'string' ? [b.accountId] : [])
    // teamIds: accept an array OR a single teamId alias; empty = loose (no team). No DEFAULT fallback.
    const teamIds = [...new Set(
      (Array.isArray(b.teamIds) ? b.teamIds.filter((x): x is string => typeof x === 'string' && !!x)
        : (typeof b.teamId === 'string' && b.teamId ? [b.teamId] : [])),
    )]
    // Validate every account exists + is visible to the caller (no assigning to out-of-scope accounts).
    for (const id of accountIds) {
      const acct = await getAccount(id)
      if (!acct) return json({ error: 'account not found' }, 404)
      if (!accountVisibleTo(principal, acct)) return json({ error: 'forbidden' }, 403)
    }
    // Validate each team exists.
    for (const t of teamIds) if (!(await getTeam(t))) return json({ error: 'team not found' }, 404)
    // Scope rule: owner may create any combination. A non-owner (manager) MUST provide at least one
    // team AND must manage EVERY team assigned — so they can't create a machine outside their scope.
    if (principal.role !== 'owner') {
      if (teamIds.length === 0 || !teamIds.every(t => canManageMachineTeam(principal, t))) {
        return json({ error: 'select teams you manage' }, 403)
      }
    }
    // user: first account's name, or the machine name itself if no accounts.
    const user = accountIds.length > 0 && accountIds[0]
      ? ((await getAccount(accountIds[0]))?.name ?? name)
      : name
    const { token } = await mintMachine({ machineName: name, user, accountIds, teamIds })
    return json({ token: packConnectToken(token, (await getCentralConfig()).publicUrl) }, 201)
  }
  if (req.method === 'DELETE') {
    // Revoke a machine (scoped): { id }. Cascades to the member's sessions/stats/workflows.
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
    const id = typeof (body as Record<string, unknown>)?.id === 'string' ? (body as Record<string, unknown>).id as string : ''
    if (!id) return json({ error: 'id is required' }, 400)
    const machine = (await listMachines()).find(m => m.id === id)
    if (!machine) return json({ error: 'machine not found' }, 404)
    if (!canManageMachine(principal, machine)) return json({ error: 'forbidden' }, 403)
    const deleted = await revokeToken(id)
    // Cascade cleanup (best-effort) — mirrors handleRevokeToken so the member disappears too.
    try {
      const { getTeamCollection } = await import('./mongo')
      const col = await getTeamCollection()
      await col.deleteMany({ memberId: id })
      const { deleteMemberStats } = await import('./team-stats')
      await deleteMemberStats(id)
      const { deleteMemberWorkflows } = await import('./team-workflows')
      await deleteMemberWorkflows(id)
    } catch { /* best-effort; token already revoked */ }
    return json({ ok: deleted })
  }
  return json({ error: 'method not allowed' }, 405)
}
