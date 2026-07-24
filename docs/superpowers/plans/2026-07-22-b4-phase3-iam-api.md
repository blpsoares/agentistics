# B4 Phase 3 — IAM API (login + accounts/teams CRUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the account-based auth API (email/password login, logout, `me`) and role-enforced CRUD for accounts and teams — all self-guarding via `getPrincipal` + the capability matrix. Purely additive: the shared-password gate is NOT flipped here (that happens in Phase 5 alongside the frontend).

**Architecture:** Extend `iam-handlers.ts` with self-guarding handlers (each calls `getPrincipal` internally and enforces `can(...)`), plus a new pure `iam-view.ts` (safe account serialization + account-management capability helpers, unit-tested). All `/api/iam/*` routes are added to `AUTH_PUBLIC` so the legacy shared-password gate does not block them — the handlers do their own auth. `passwordHash` is never serialized.

**Tech Stack:** Bun, TypeScript strict, MongoDB, node:crypto.

## Global Constraints

- English; TS strict; no `any`. Commit subjects lowercase (commitlint).
- Additive & non-breaking: do NOT flip the request gate or remove shared-password login this phase.
- Every IAM route is self-guarding: the handler calls `getPrincipal(req)` and returns 401 when null; capability via `can(...)`/pure helpers. Routes go in `AUTH_PUBLIC` (they self-guard), never in `ADMIN_PATHS` (that Set is the legacy shared-password gate).
- `passwordHash` (and any secret) MUST be stripped before serializing an account — use `publicAccount()`.
- The single global `owner` account is bootstrap-only: the accounts API never creates or deletes an `owner`.
- Mongo IO not unit-tested; pure functions in `iam-view.ts` are.
- Login must not reveal whether an email exists — return a generic `invalid credentials` 401 for both unknown email and wrong password.
- Run: `bun test`; `bun tsc --noEmit`.

---

### Task 1: `iam-view.ts` — safe serialization + account-management capability (pure)

**Files:**
- Create: `packages/server/server/iam-view.ts`
- Test: `packages/server/server/iam-view.test.ts`

**Interfaces:**
- Consumes: `AccountDoc`, `Principal`, `Membership` from `./iam-types`.
- Produces:
  - `interface PublicAccount { id: string; name: string; email: string; role: 'owner'|'member'; memberships: Membership[]; createdAt: string; lastLoginAt?: string | null }`
  - `publicAccount(a: AccountDoc): PublicAccount`
  - `accountVisibleTo(principal: Principal, account: AccountDoc): boolean`
  - `canCreateAccount(p: Principal, memberships: Membership[]): boolean`
  - `canDeleteAccount(p: Principal, target: AccountDoc): boolean`
  - `teamVisibleTo(p: Principal, teamId: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/iam-view.test.ts
import { test, expect } from 'bun:test'
import { publicAccount, accountVisibleTo, canCreateAccount, canDeleteAccount, teamVisibleTo } from './iam-view'
import type { AccountDoc, Principal } from './iam-types'

const owner: Principal = { accountId: 'o1', role: 'owner', memberships: [] }
const mgrA: Principal = { accountId: 'm1', role: 'member', memberships: [{ teamId: 'A', role: 'manager' }] }

function acc(id: string, over: Partial<AccountDoc> = {}): AccountDoc {
  return { _id: id, name: 'N', email: `${id}@x.co`, emailLower: `${id}@x.co`, passwordHash: '$argon2id$secret', role: 'member', memberships: [], sessionVersion: 0, createdAt: 't', updatedAt: 't', lastLoginAt: null, ...over }
}

test('publicAccount strips passwordHash and maps _id → id', () => {
  const p = publicAccount(acc('u1', { memberships: [{ teamId: 'A', role: 'user' }] }))
  expect(p).toEqual({ id: 'u1', name: 'N', email: 'u1@x.co', role: 'member', memberships: [{ teamId: 'A', role: 'user' }], createdAt: 't', lastLoginAt: null })
  expect((p as Record<string, unknown>).passwordHash).toBeUndefined()
})

test('accountVisibleTo: owner sees all; manager sees users in their team + self', () => {
  const userA = acc('u1', { memberships: [{ teamId: 'A', role: 'user' }] })
  const userB = acc('u2', { memberships: [{ teamId: 'B', role: 'user' }] })
  expect(accountVisibleTo(owner, userB)).toBe(true)
  expect(accountVisibleTo(mgrA, userA)).toBe(true)
  expect(accountVisibleTo(mgrA, userB)).toBe(false)
  expect(accountVisibleTo(mgrA, acc('m1'))).toBe(true) // self
})

test('canCreateAccount: owner any; manager only user-role in managed teams', () => {
  expect(canCreateAccount(owner, [{ teamId: 'Z', role: 'manager' }])).toBe(true)
  expect(canCreateAccount(mgrA, [{ teamId: 'A', role: 'user' }])).toBe(true)
  expect(canCreateAccount(mgrA, [{ teamId: 'A', role: 'manager' }])).toBe(false)
  expect(canCreateAccount(mgrA, [{ teamId: 'B', role: 'user' }])).toBe(false)
  expect(canCreateAccount(mgrA, [])).toBe(false)
})

test('canDeleteAccount: never an owner; owner deletes others; manager deletes managed users', () => {
  expect(canDeleteAccount(owner, acc('o2', { role: 'owner' }))).toBe(false)
  expect(canDeleteAccount(owner, acc('u1', { memberships: [{ teamId: 'B', role: 'user' }] }))).toBe(true)
  expect(canDeleteAccount(mgrA, acc('u1', { memberships: [{ teamId: 'A', role: 'user' }] }))).toBe(true)
  expect(canDeleteAccount(mgrA, acc('u2', { memberships: [{ teamId: 'B', role: 'user' }] }))).toBe(false)
  expect(canDeleteAccount(mgrA, acc('x', { memberships: [{ teamId: 'A', role: 'manager' }] }))).toBe(false)
})

test('teamVisibleTo: owner all; member only their teams', () => {
  expect(teamVisibleTo(owner, 'Z')).toBe(true)
  expect(teamVisibleTo(mgrA, 'A')).toBe(true)
  expect(teamVisibleTo(mgrA, 'B')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/iam-view.test.ts`
Expected: FAIL — cannot find module `./iam-view`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/iam-view.ts
/**
 * iam-view.ts — pure helpers for the IAM API: safe account serialization (never leaks
 * passwordHash) + account/team visibility & management capability checks.
 */
import type { AccountDoc, Principal, Membership } from './iam-types'

export interface PublicAccount {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  memberships: Membership[]
  createdAt: string
  lastLoginAt?: string | null
}

/** Client-safe view of an account — drops passwordHash/emailLower/sessionVersion. */
export function publicAccount(a: AccountDoc): PublicAccount {
  return {
    id: a._id,
    name: a.name,
    email: a.email,
    role: a.role,
    memberships: a.memberships,
    createdAt: a.createdAt,
    lastLoginAt: a.lastLoginAt ?? null,
  }
}

function managedTeams(p: Principal): Set<string> {
  return new Set(p.memberships.filter(m => m.role === 'manager').map(m => m.teamId))
}

/** Owner sees all; a principal always sees itself; a manager sees accounts holding a
 *  membership in a team they manage. */
export function accountVisibleTo(principal: Principal, account: AccountDoc): boolean {
  if (principal.role === 'owner') return true
  if (principal.accountId === account._id) return true
  const managed = managedTeams(principal)
  return account.memberships.some(m => managed.has(m.teamId))
}

/** Owner may create any account; a manager may create only user-role memberships in teams
 *  they manage (and at least one membership). */
export function canCreateAccount(p: Principal, memberships: Membership[]): boolean {
  if (p.role === 'owner') return true
  const managed = managedTeams(p)
  return memberships.length > 0 && memberships.every(m => m.role === 'user' && managed.has(m.teamId))
}

/** Never delete an owner via the API. Owner may delete any non-owner; a manager may delete an
 *  account whose every membership is a user-role in a team they manage. */
export function canDeleteAccount(p: Principal, target: AccountDoc): boolean {
  if (target.role === 'owner') return false
  if (p.role === 'owner') return true
  const managed = managedTeams(p)
  return target.memberships.length > 0 && target.memberships.every(m => m.role === 'user' && managed.has(m.teamId))
}

/** Owner sees every team; a member sees only teams they belong to. */
export function teamVisibleTo(p: Principal, teamId: string): boolean {
  if (p.role === 'owner') return true
  return p.memberships.some(m => m.teamId === teamId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/iam-view.test.ts`
Expected: PASS (5 tests). Then `bun tsc --noEmit` — no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/iam-view.ts packages/server/server/iam-view.test.ts
git commit -m "feat(iam): pure account-view + management capability helpers"
```

---

### Task 2: login / logout / me handlers

**Files:**
- Modify: `packages/server/server/iam-handlers.ts` (append handlers; keep existing status/bootstrap)

**Interfaces:**
- Consumes: `findAccountByEmail`, `updateAccount`, `getAccount` from `./accounts`; `verifyPassword` from `./passwords`; `makePrincipalSessionCookieHeader`, `getPrincipal` from `./auth`; `publicAccount` from `./iam-view`.
- Produces: `handleIamLogin(req): Promise<Response>`, `handleIamMe(req): Promise<Response>`. (Logout reuses `auth.handleLogout` at the route.)

> Thin IO — no unit test; verified by curl integration after Task 4.

- [ ] **Step 1: Extend the imports at the top of `iam-handlers.ts`**

Add these imports (merge with existing ones from the same modules where present):
```ts
import { findAccountByEmail, updateAccount, getAccount } from './accounts'
import { verifyPassword } from './passwords'
import { getPrincipal } from './auth'
import { publicAccount } from './iam-view'
```
(Note: `createAccount`, `hasAnyOwner` are already imported from `./accounts`; `makePrincipalSessionCookieHeader` already from `./auth`; `hashPassword` already from `./passwords`. Combine imports so each module is imported once.)

- [ ] **Step 2: Append the handlers**

```ts
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
```

- [ ] **Step 3: Type-check**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/server/iam-handlers.ts
git commit -m "feat(iam): email/password login + me handlers"
```

---

### Task 3: accounts + teams CRUD handlers

**Files:**
- Modify: `packages/server/server/iam-handlers.ts` (append)

**Interfaces:**
- Consumes: `listAccounts`, `getAccount`, `createAccount`, `deleteAccount`, `findAccountByEmail` from `./accounts`; `hashPassword`; `getPrincipal`; `listTeams`, `createTeam`, `getTeam`, `deleteTeam`, `DEFAULT_TEAM_ID` from `./teams`; `publicAccount`, `accountVisibleTo`, `canCreateAccount`, `canDeleteAccount`, `teamVisibleTo` from `./iam-view`; `Membership` from `./iam-types`.
- Produces: `handleAccounts(req): Promise<Response>`, `handleTeams(req): Promise<Response>` (each dispatches by `req.method`).

> Thin IO — verified by curl after Task 4.

- [ ] **Step 1: Extend imports** (merge with existing)

```ts
import { listAccounts, deleteAccount } from './accounts'
import { listTeams, createTeam, getTeam, deleteTeam, DEFAULT_TEAM_ID } from './teams'
import { accountVisibleTo, canCreateAccount, canDeleteAccount, teamVisibleTo } from './iam-view'
import type { Membership } from './iam-types'
```

- [ ] **Step 2: Append a small membership parser + the two handlers**

```ts
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
    const memberships = parseMemberships(b.memberships)
    if (!name) return json({ error: 'name is required' }, 400)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'valid email is required' }, 400)
    if (password.length < 8) return json({ error: 'password must be at least 8 characters' }, 400)
    if (!canCreateAccount(principal, memberships)) return json({ error: 'forbidden' }, 403)
    if (await findAccountByEmail(email)) return json({ error: 'email already exists' }, 409)
    const passwordHash = await hashPassword(password)
    const account = await createAccount({ name, email, passwordHash, role: 'member', memberships, createdBy: principal.accountId })
    return json({ account: publicAccount(account) }, 201)
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
```

- [ ] **Step 3: Type-check + full suite**

Run: `bun tsc --noEmit` — no errors. Run: `bun test` — all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/server/iam-handlers.ts
git commit -m "feat(iam): accounts + teams crud handlers (role-enforced)"
```

---

### Task 4: wire the IAM API routes into `index.ts`

**Files:**
- Modify: `packages/server/server/index.ts`

- [ ] **Step 1: Add the routes to `AUTH_PUBLIC`** (the Set that already contains `/api/iam/status`, `/api/iam/bootstrap`)

Add:
```ts
  '/api/iam/login',
  '/api/iam/logout',
  '/api/iam/me',
  '/api/iam/accounts',
  '/api/iam/teams',
```
(They self-guard via `getPrincipal`; do NOT add to `ADMIN_PATHS`.)

- [ ] **Step 2: Add the dispatch blocks** (immediately after the existing `POST /api/iam/bootstrap` block). Use the SAME CORS-spread pattern the neighboring IAM blocks use (preserves Set-Cookie).

```ts
if (url.pathname === '/api/iam/login' && req.method === 'POST') {
  if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  const { handleIamLogin } = await import('./iam-handlers')
  const res = await handleIamLogin(req)
  const headers = new Headers(res.headers); for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

if (url.pathname === '/api/iam/logout' && req.method === 'POST') {
  if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  const { handleLogout } = await import('./auth')
  const res = handleLogout(req)
  const headers = new Headers(res.headers); for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

if (url.pathname === '/api/iam/me' && req.method === 'GET') {
  if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  const { handleIamMe } = await import('./iam-handlers')
  const res = await handleIamMe(req)
  const headers = new Headers(res.headers); for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

if (url.pathname === '/api/iam/accounts' && (req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')) {
  if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  const { handleAccounts } = await import('./iam-handlers')
  const res = await handleAccounts(req)
  const headers = new Headers(res.headers); for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

if (url.pathname === '/api/iam/teams' && (req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')) {
  if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  const { handleTeams } = await import('./iam-handlers')
  const res = await handleTeams(req)
  const headers = new Headers(res.headers); for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}
```

> First READ the existing `/api/iam/bootstrap` dispatch block and mirror its exact CORS pattern; the code above assumes the `new Headers(...)` + set-CORS pattern the reviewer confirmed in Phase 2. If the file uses a shared helper, use it instead.

- [ ] **Step 3: Type-check + full suite**

Run: `bun tsc --noEmit` — no errors. Run: `bun test` — all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/server/index.ts
git commit -m "feat(iam): wire login/me/logout + accounts/teams routes"
```

---

## Self-Review

**Spec coverage (Phase 3 slice):** `/api/iam/login`, `/api/iam/me` (spec §7) → Tasks 2 + 4; `/api/iam/accounts`, `/api/iam/teams` CRUD with role enforcement (spec §7 + §3 matrix) → Tasks 1 + 3 + 4; `passwordHash` stripping (spec §7 security note + Ph1-review carry-over) → `publicAccount` (Task 1), used by every account response. Logout reuses `auth.handleLogout`.

**Deferred (documented):** PATCH/edit of accounts & memberships (create + delete + list suffice for an end-to-end test; edit is a later refinement). The gate flip + shared-password removal is Phase 5 (with the frontend), per the non-breaking constraint.

**Placeholder scan:** none — complete code in every step; Task 4 references the real Phase-2 CORS pattern to mirror.

**Type consistency:** `PublicAccount`, `publicAccount`, `accountVisibleTo`, `canCreateAccount`, `canDeleteAccount`, `teamVisibleTo` (Task 1) consumed in Tasks 2/3. `Membership` shape matches `iam-types`. `createAccount(NewAccount)` called with `role:'member'`. Handlers return through the existing `json()` helper + `JSON_CT` defined in `iam-handlers.ts` (Phase 2).

**Non-breaking:** all routes self-guard and are in AUTH_PUBLIC; nothing changes the legacy gate or shared-password login. Central stays fully usable on the current auth until Phase 5.
