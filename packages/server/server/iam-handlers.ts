/**
 * iam-handlers.ts — thin IO route handlers for IAM bootstrap (Phase 2).
 * Mirrors auth.ts: each returns a Response with JSON content-type; the caller in
 * index.ts spreads CORS_HEADERS. Bootstrap is public only while no owner exists —
 * handleBootstrap re-checks hasAnyOwner() and refuses once set up.
 */
import { hasAnyOwner, createAccount, findAccountByEmail, updateAccount, getAccount, listAccounts, deleteAccount } from './accounts'
import { hashPassword, verifyPassword } from './passwords'
import { validateOwnerInput, verifyBootstrapToken, consumeBootstrapToken } from './bootstrap'
import { seedDefaultTeam, listTeams, createTeam, getTeam, deleteTeam, DEFAULT_TEAM_ID } from './teams'
import { backfillTokenTeamIds, listMachines, mintMachineToken } from './team-tokens'
import { backfillRepoTeamIds } from './team-repos'
import { makePrincipalSessionCookieHeader, getPrincipal } from './auth'
import { publicAccount, accountVisibleTo, canCreateAccount, canDeleteAccount, teamVisibleTo, canManageMachineTeam } from './iam-view'
import type { Membership } from './iam-types'

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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400)
  }

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

  await seedDefaultTeam()
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
export async function handleIamLogin(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400)
  }
  const b = body as Record<string, unknown>
  const email = typeof b.email === 'string' ? b.email : ''
  const password = typeof b.password === 'string' ? b.password : ''
  const account = await findAccountByEmail(email)
  const ok = account ? await verifyPassword(password, account.passwordHash) : false
  if (!account || !ok) return json({ ok: false, error: 'invalid credentials' }, 401)
  await updateAccount(account._id, { lastLoginAt: new Date().toISOString() })
  const cookie = makePrincipalSessionCookieHeader(account._id, account.sessionVersion)
  return new Response(JSON.stringify({ ok: true, mustChangePassword: account.mustChangePassword ?? false }), { status: 200, headers: { ...JSON_CT, 'Set-Cookie': cookie } })
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
    const role = b.role === 'owner' ? 'owner' : 'member'
    const memberships = parseMemberships(b.memberships)
    const mustChangePassword = typeof b.mustChangePassword === 'boolean' ? b.mustChangePassword : true
    const machineName = typeof (b.machine as Record<string, unknown> | undefined)?.name === 'string'
      ? ((b.machine as Record<string, unknown>).name as string).trim()
      : ''
    if (!name) return json({ error: 'name is required' }, 400)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'valid email is required' }, 400)
    if (password.length < 8) return json({ error: 'password must be at least 8 characters' }, 400)
    // Owner accounts (full access) may only be created by an owner; memberships are ignored.
    // Member accounts follow the scoped canCreateAccount rule (owner→any; manager→user-role in managed teams).
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
    let machineToken: string | undefined
    if (machineName) {
      const teamId = account.memberships[0]?.teamId || 'default'
      const { token } = await mintMachineToken({ accountId: account._id, user: account.name, machineName, teamId })
      machineToken = token
    }
    return json({ account: publicAccount(account), ...(machineToken ? { machineToken } : {}) }, 201)
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
    await deleteAccount(id)
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
    if (id === DEFAULT_TEAM_ID) return json({ error: 'cannot delete the default team' }, 400)
    if (!(await getTeam(id))) return json({ error: 'not found' }, 404)
    await deleteTeam(id)
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
    const visible = principal.role === 'owner' ? all : all.filter(m => canManageMachineTeam(principal, m.teamId))
    return json({ machines: visible })
  }
  if (req.method === 'POST') {
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
    const b = body as Record<string, unknown>
    const accountId = typeof b.accountId === 'string' ? b.accountId : ''
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!accountId || !name) return json({ error: 'accountId and name are required' }, 400)
    const account = await getAccount(accountId)
    if (!account) return json({ error: 'account not found' }, 404)
    // team: explicit ctx or the account's first membership team (or 'default' for owner accounts)
    const teamId = (typeof b.teamId === 'string' && b.teamId) || account.memberships[0]?.teamId || 'default'
    if (!canManageMachineTeam(principal, teamId)) return json({ error: 'forbidden' }, 403)
    const { token } = await mintMachineToken({ accountId, user: account.name, machineName: name, teamId })
    return json({ token }, 201) // plaintext once
  }
  return json({ error: 'method not allowed' }, 405)
}
