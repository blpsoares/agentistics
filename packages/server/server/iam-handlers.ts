/**
 * iam-handlers.ts — thin IO route handlers for IAM bootstrap (Phase 2).
 * Mirrors auth.ts: each returns a Response with JSON content-type; the caller in
 * index.ts spreads CORS_HEADERS. Bootstrap is public only while no owner exists —
 * handleBootstrap re-checks hasAnyOwner() and refuses once set up.
 */
import { hasAnyOwner, createAccount, findAccountByEmail, updateAccount, getAccount } from './accounts'
import { hashPassword, verifyPassword } from './passwords'
import { validateOwnerInput, verifyBootstrapToken, consumeBootstrapToken } from './bootstrap'
import { seedDefaultTeam } from './teams'
import { backfillTokenTeamIds } from './team-tokens'
import { backfillRepoTeamIds } from './team-repos'
import { makePrincipalSessionCookieHeader, getPrincipal } from './auth'
import { publicAccount } from './iam-view'

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
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...JSON_CT, 'Set-Cookie': cookie } })
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
