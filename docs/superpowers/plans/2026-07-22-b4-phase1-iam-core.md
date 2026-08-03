# B4 Phase 1 — IAM Core (data + security) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the security + data primitives for governance/IAM — password hashing, principal-carrying sessions, the accounts/teams Mongo collections, and the pure capability matrix — WITHOUT changing the existing login behavior (purely additive; the shared password still works until Phase 2 wires bootstrap + account login).

**Architecture:** New server-only modules under `packages/server/server/`, following the existing doc/CRUD pattern of `team-repos.ts` / `central-config.ts` and the pure-helper/thin-IO split of `auth.ts`. Pure functions (password hash/verify, session sign/verify, capability checks, doc builders, email normalization) are unit-tested with `bun test`; Mongo-touching functions are thin IO wrappers (no DB mocking, matching the project rule).

**Tech Stack:** Bun, TypeScript (strict), MongoDB driver (`mongodb` ^6.12.0, already a dep), `node:crypto` (HMAC), and **`Bun.password` (argon2id)** — no new dependency.

## Global Constraints

- Everything in English (code, comments, commit messages).
- TypeScript strict typing; no `any` unless unavoidable.
- Password hashing MUST be **argon2id** — use `Bun.password.hash(plain, { algorithm: 'argon2id' })` / `Bun.password.verify` (no external lib; keeps `bun build --compile` of the machine binary working).
- Additive only — do NOT remove or alter `handleLogin` / `isAuthed` / `hasValidSession` in this phase; the running central must keep working on the shared password.
- Session secret source is `TEAM_SESSION_SECRET` from `./config` (unchanged).
- Never log or return raw passwords or password hashes.
- Colocate tests next to the module (`*.test.ts`), matching `auth.test.ts` / `chat-tty.test.ts`.
- Mongo collection names introduced here: `accounts`, `teams`.
- Run the full suite with `bun test` from the repo root; type-check with `bun tsc --noEmit` (husky pre-commit runs both).

---

### Task 1: Password hashing (`passwords.ts`)

**Files:**
- Create: `packages/server/server/passwords.ts`
- Test: `packages/server/server/passwords.test.ts`

**Interfaces:**
- Consumes: `Bun.password` (global).
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/passwords.test.ts
import { test, expect } from 'bun:test'
import { hashPassword, verifyPassword } from './passwords'

test('hashPassword produces an argon2id hash distinct from the plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple')
  expect(hash).not.toBe('correct horse battery staple')
  expect(hash.startsWith('$argon2id$')).toBe(true)
})

test('verifyPassword accepts the correct password and rejects wrong ones', async () => {
  const hash = await hashPassword('s3cret!')
  expect(await verifyPassword('s3cret!', hash)).toBe(true)
  expect(await verifyPassword('wrong', hash)).toBe(false)
})

test('verifyPassword returns false for an empty/garbage hash instead of throwing', async () => {
  expect(await verifyPassword('anything', '')).toBe(false)
  expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/passwords.test.ts`
Expected: FAIL — cannot find module `./passwords`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/server/passwords.ts
/**
 * passwords.ts — argon2id password hashing via Bun's built-in Bun.password.
 * No external dependency (keeps `bun build --compile` of the machine binary working).
 * Raw passwords and hashes are never logged.
 */

/** Hash a plaintext password with argon2id. Returns the encoded `$argon2id$...` string. */
export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: 'argon2id' })
}

/** Verify a plaintext password against an encoded hash. Returns false on any malformed hash. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false
  try {
    return await Bun.password.verify(plain, hash)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/passwords.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/passwords.ts packages/server/server/passwords.test.ts
git commit -m "feat(iam): argon2id password hashing via Bun.password"
```

---

### Task 2: IAM types + email normalization (`iam-types.ts`)

**Files:**
- Create: `packages/server/server/iam-types.ts`
- Test: `packages/server/server/iam-types.test.ts`

**Interfaces:**
- Produces:
  - `type Role = 'owner' | 'member'`
  - `type TeamRole = 'manager' | 'user'`
  - `interface Membership { teamId: string; role: TeamRole }`
  - `interface Principal { accountId: string; role: Role; memberships: Membership[] }`
  - `interface AccountDoc { _id: string; name: string; email: string; emailLower: string; passwordHash: string; role: Role; memberships: Membership[]; sessionVersion: number; createdAt: string; updatedAt: string; createdBy?: string; lastLoginAt?: string | null }`
  - `interface TeamDoc { _id: string; name: string; createdAt: string; createdBy?: string }`
  - `normalizeEmail(email: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/iam-types.test.ts
import { test, expect } from 'bun:test'
import { normalizeEmail } from './iam-types'

test('normalizeEmail lowercases and trims', () => {
  expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com')
})

test('normalizeEmail is idempotent', () => {
  const once = normalizeEmail('Bob@Foo.io')
  expect(normalizeEmail(once)).toBe(once)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/iam-types.test.ts`
Expected: FAIL — cannot find module `./iam-types`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/server/iam-types.ts
/**
 * iam-types.ts — shared governance/IAM types (server-only) + pure helpers.
 * `role: 'owner'` is the single instance-global owner; everyone else is `'member'`
 * whose effective rights come from `memberships` (per-team manager/user).
 */

export type Role = 'owner' | 'member'
export type TeamRole = 'manager' | 'user'

export interface Membership {
  teamId: string
  role: TeamRole
}

/** The authenticated caller, resolved fresh from the DB on every request. */
export interface Principal {
  accountId: string
  role: Role
  memberships: Membership[]
}

/** Mongo doc in the `accounts` collection. */
export interface AccountDoc {
  _id: string
  name: string
  email: string
  emailLower: string
  passwordHash: string
  role: Role
  memberships: Membership[]
  sessionVersion: number
  createdAt: string
  updatedAt: string
  createdBy?: string
  lastLoginAt?: string | null
}

/** Mongo doc in the `teams` collection. */
export interface TeamDoc {
  _id: string
  name: string
  createdAt: string
  createdBy?: string
}

/** Canonical email form for storage + uniqueness + lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/iam-types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/iam-types.ts packages/server/server/iam-types.test.ts
git commit -m "feat(iam): shared IAM types + normalizeEmail"
```

---

### Task 3: Capability matrix (`iam-caps.ts`)

**Files:**
- Create: `packages/server/server/iam-caps.ts`
- Test: `packages/server/server/iam-caps.test.ts`

**Interfaces:**
- Consumes: `Principal` from `./iam-types`.
- Produces:
  - `type IamAction = 'teams:write' | 'central:config' | 'tokens:write' | 'members:write' | 'tags:write' | 'team:view' | 'accounts:manage'`
  - `interface IamContext { teamId?: string; targetRole?: 'owner' | 'manager' | 'user' }`
  - `isManagerOf(p: Principal, teamId: string | undefined): boolean`
  - `isMemberOf(p: Principal, teamId: string | undefined): boolean`
  - `can(p: Principal, action: IamAction, ctx?: IamContext): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/iam-caps.test.ts
import { test, expect } from 'bun:test'
import { can, isManagerOf, isMemberOf } from './iam-caps'
import type { Principal } from './iam-types'

const owner: Principal = { accountId: 'o1', role: 'owner', memberships: [] }
const mgrA: Principal = { accountId: 'm1', role: 'member', memberships: [{ teamId: 'A', role: 'manager' }] }
const userA: Principal = { accountId: 'u1', role: 'member', memberships: [{ teamId: 'A', role: 'user' }] }

test('owner can do everything', () => {
  expect(can(owner, 'teams:write')).toBe(true)
  expect(can(owner, 'central:config')).toBe(true)
  expect(can(owner, 'tokens:write', { teamId: 'Z' })).toBe(true)
  expect(can(owner, 'accounts:manage', { teamId: 'Z', targetRole: 'owner' })).toBe(true)
})

test('owner-only actions are denied to managers and users', () => {
  expect(can(mgrA, 'teams:write')).toBe(false)
  expect(can(mgrA, 'central:config')).toBe(false)
  expect(can(userA, 'teams:write')).toBe(false)
})

test('team-scoped writes require managing that exact team', () => {
  expect(can(mgrA, 'tokens:write', { teamId: 'A' })).toBe(true)
  expect(can(mgrA, 'members:write', { teamId: 'A' })).toBe(true)
  expect(can(mgrA, 'tokens:write', { teamId: 'B' })).toBe(false) // cross-team
  expect(can(userA, 'tokens:write', { teamId: 'A' })).toBe(false) // users can't write
})

test('team:view requires any membership of that team', () => {
  expect(can(userA, 'team:view', { teamId: 'A' })).toBe(true)
  expect(can(mgrA, 'team:view', { teamId: 'A' })).toBe(true)
  expect(can(userA, 'team:view', { teamId: 'B' })).toBe(false)
})

test('accounts:manage — a manager may manage only user-role accounts in their team', () => {
  expect(can(mgrA, 'accounts:manage', { teamId: 'A', targetRole: 'user' })).toBe(true)
  expect(can(mgrA, 'accounts:manage', { teamId: 'A', targetRole: 'manager' })).toBe(false)
  expect(can(mgrA, 'accounts:manage', { teamId: 'B', targetRole: 'user' })).toBe(false)
  expect(can(userA, 'accounts:manage', { teamId: 'A', targetRole: 'user' })).toBe(false)
})

test('helpers', () => {
  expect(isManagerOf(mgrA, 'A')).toBe(true)
  expect(isManagerOf(userA, 'A')).toBe(false)
  expect(isMemberOf(userA, 'A')).toBe(true)
  expect(isMemberOf(userA, undefined)).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/iam-caps.test.ts`
Expected: FAIL — cannot find module `./iam-caps`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/server/iam-caps.ts
/**
 * iam-caps.ts — the pure authorization matrix. `can(principal, action, ctx)` is the
 * single source of truth for role × action decisions; API routes call it at the gate.
 * owner is all-powerful; manager/user are scoped to their team memberships.
 */
import type { Principal } from './iam-types'

export type IamAction =
  | 'teams:write'      // create/edit/delete teams — owner only
  | 'central:config'   // central settings (interval, offline policy) — owner only
  | 'tokens:write'     // mint/rotate/revoke machine tokens — owner or manager of ctx.teamId
  | 'members:write'    // add/remove members in a team — owner or manager of ctx.teamId
  | 'tags:write'       // create/edit tags (B5) — owner or manager of ctx.teamId
  | 'team:view'        // read a team's metrics — owner or any membership of ctx.teamId
  | 'accounts:manage'  // create/edit/delete accounts — owner (any), manager (user-role, own team)

export interface IamContext {
  teamId?: string
  targetRole?: 'owner' | 'manager' | 'user'
}

export function isManagerOf(p: Principal, teamId: string | undefined): boolean {
  if (!teamId) return false
  return p.memberships.some(m => m.teamId === teamId && m.role === 'manager')
}

export function isMemberOf(p: Principal, teamId: string | undefined): boolean {
  if (!teamId) return false
  return p.memberships.some(m => m.teamId === teamId)
}

export function can(p: Principal, action: IamAction, ctx: IamContext = {}): boolean {
  if (p.role === 'owner') return true
  switch (action) {
    case 'teams:write':
    case 'central:config':
      return false // owner-only
    case 'tokens:write':
    case 'members:write':
    case 'tags:write':
      return isManagerOf(p, ctx.teamId)
    case 'team:view':
      return isMemberOf(p, ctx.teamId)
    case 'accounts:manage':
      // A manager may manage only 'user'-role accounts within a team they manage.
      return ctx.targetRole === 'user' && isManagerOf(p, ctx.teamId)
    default:
      return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/iam-caps.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/iam-caps.ts packages/server/server/iam-caps.test.ts
git commit -m "feat(iam): pure capability matrix (can/isManagerOf/isMemberOf)"
```

---

### Task 4: Principal-carrying session cookie (`auth.ts` additions)

**Files:**
- Modify: `packages/server/server/auth.ts` (add new exports after `verifySession`, ~line 69; do NOT touch existing functions)
- Test: `packages/server/server/auth-principal.test.ts`

**Interfaces:**
- Consumes: `createHmac` (already imported), `constantTimeEqual` (already in module).
- Produces:
  - `signPrincipalSession(expiryMs: number, accountId: string, sessionVersion: number, secret: string): string`
  - `interface PrincipalCookie { accountId: string; sessionVersion: number }`
  - `verifyPrincipalSession(cookieValue: string | undefined, secret: string, nowMs: number): PrincipalCookie | null`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/auth-principal.test.ts
import { test, expect } from 'bun:test'
import { signPrincipalSession, verifyPrincipalSession } from './auth'

const SECRET = 'test-secret'
const FUTURE = 10_000_000_000_000 // year 2286
const NOW = 1_000_000_000_000

test('sign→verify roundtrip returns accountId + sessionVersion', () => {
  const cookie = signPrincipalSession(FUTURE, 'acc123', 4, SECRET)
  expect(verifyPrincipalSession(cookie, SECRET, NOW)).toEqual({ accountId: 'acc123', sessionVersion: 4 })
})

test('rejects an expired cookie', () => {
  const cookie = signPrincipalSession(NOW - 1, 'acc123', 0, SECRET)
  expect(verifyPrincipalSession(cookie, SECRET, NOW)).toBeNull()
})

test('rejects a tampered payload or wrong secret', () => {
  const cookie = signPrincipalSession(FUTURE, 'acc123', 0, SECRET)
  expect(verifyPrincipalSession(cookie.replace('acc123', 'acc999'), SECRET, NOW)).toBeNull()
  expect(verifyPrincipalSession(cookie, 'other-secret', NOW)).toBeNull()
})

test('rejects malformed cookies', () => {
  expect(verifyPrincipalSession(undefined, SECRET, NOW)).toBeNull()
  expect(verifyPrincipalSession('garbage', SECRET, NOW)).toBeNull()
  expect(verifyPrincipalSession('a.b.c', SECRET, NOW)).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/auth-principal.test.ts`
Expected: FAIL — `signPrincipalSession` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/server/server/auth.ts` immediately after `verifySession` (after line 69), keeping all existing code intact:

```ts
// ---------------------------------------------------------------------------
// Principal-carrying session (IAM) — additive; coexists with the legacy
// password session above until Phase 2 switches login over to accounts.
// Cookie value: `${expiryMs}.${accountId}.${sessionVersion}.${HMAC(payload)}`.
// ---------------------------------------------------------------------------

export interface PrincipalCookie {
  accountId: string
  sessionVersion: number
}

/** Sign a principal session. The signed payload is `expiryMs.accountId.sessionVersion`. */
export function signPrincipalSession(
  expiryMs: number,
  accountId: string,
  sessionVersion: number,
  secret: string,
): string {
  const payload = `${expiryMs}.${accountId}.${sessionVersion}`
  const mac = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}

/**
 * Verify a principal session cookie:
 *   - splits off the trailing `.mac`, verifies HMAC over the payload (constant-time),
 *   - parses `expiryMs.accountId.sessionVersion`, checks expiry > nowMs.
 * Returns { accountId, sessionVersion } or null for any malformed/expired/tampered cookie.
 */
export function verifyPrincipalSession(
  cookieValue: string | undefined,
  secret: string,
  nowMs: number,
): PrincipalCookie | null {
  if (!cookieValue) return null
  const lastDot = cookieValue.lastIndexOf('.')
  if (lastDot === -1) return null
  const payload = cookieValue.slice(0, lastDot)
  const mac = cookieValue.slice(lastDot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  if (!constantTimeEqual(mac, expected)) return null
  const parts = payload.split('.')
  if (parts.length !== 3) return null
  const expiry = parseInt(parts[0]!, 10)
  const accountId = parts[1]!
  const sessionVersion = parseInt(parts[2]!, 10)
  if (isNaN(expiry) || expiry <= nowMs) return null
  if (!accountId || isNaN(sessionVersion)) return null
  return { accountId, sessionVersion }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/auth-principal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/auth.ts packages/server/server/auth-principal.test.ts
git commit -m "feat(iam): principal-carrying session sign/verify (additive)"
```

---

### Task 5: Accounts collection (`accounts.ts`)

**Files:**
- Create: `packages/server/server/accounts.ts`
- Test: `packages/server/server/accounts.test.ts` (pure builder only — no DB)

**Interfaces:**
- Consumes: `getMongoDb` from `./mongo`; `AccountDoc`, `Membership`, `Role`, `normalizeEmail` from `./iam-types`.
- Produces:
  - `interface NewAccount { name: string; email: string; passwordHash: string; role: Role; memberships: Membership[]; createdBy?: string }`
  - `makeAccountDoc(input: NewAccount, id: string, nowIso: string): AccountDoc` (pure)
  - `getAccountsCollection(): Promise<Collection<AccountDoc>>`
  - `ensureAccountIndexes(): Promise<void>`
  - `createAccount(input: NewAccount): Promise<AccountDoc>`
  - `getAccount(id: string): Promise<AccountDoc | null>`
  - `findAccountByEmail(email: string): Promise<AccountDoc | null>`
  - `listAccounts(): Promise<AccountDoc[]>`
  - `updateAccount(id: string, patch: Partial<Pick<AccountDoc, 'name' | 'passwordHash' | 'role' | 'memberships' | 'lastLoginAt'>>): Promise<void>`
  - `deleteAccount(id: string): Promise<void>`
  - `bumpSessionVersion(id: string): Promise<void>`
  - `countAccounts(): Promise<number>`
  - `hasAnyOwner(): Promise<boolean>`

- [ ] **Step 1: Write the failing test** (pure builder is the only unit-testable surface — DB methods are thin IO)

```ts
// packages/server/server/accounts.test.ts
import { test, expect } from 'bun:test'
import { makeAccountDoc } from './accounts'

test('makeAccountDoc is deterministic and normalizes the email', () => {
  const doc = makeAccountDoc(
    { name: 'Alice', email: '  Alice@Example.COM ', passwordHash: '$argon2id$x', role: 'owner', memberships: [] },
    'id123',
    '2026-07-22T00:00:00.000Z',
  )
  expect(doc).toEqual({
    _id: 'id123',
    name: 'Alice',
    email: '  Alice@Example.COM ',
    emailLower: 'alice@example.com',
    passwordHash: '$argon2id$x',
    role: 'owner',
    memberships: [],
    sessionVersion: 0,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    createdBy: undefined,
    lastLoginAt: null,
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/accounts.test.ts`
Expected: FAIL — cannot find module `./accounts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/server/accounts.ts
/**
 * accounts.ts — the `accounts` collection (governance/IAM). CRUD is thin IO over
 * the shared Mongo singleton; `makeAccountDoc` is a pure, deterministic builder so
 * it can be unit-tested. Passwords are stored ONLY as argon2id hashes (see passwords.ts).
 */
import { randomBytes } from 'node:crypto'
import type { Collection } from 'mongodb'
import { getMongoDb } from './mongo'
import type { AccountDoc, Membership, Role } from './iam-types'
import { normalizeEmail } from './iam-types'

export interface NewAccount {
  name: string
  email: string
  passwordHash: string
  role: Role
  memberships: Membership[]
  createdBy?: string
}

/** Pure doc builder — deterministic given id + nowIso. */
export function makeAccountDoc(input: NewAccount, id: string, nowIso: string): AccountDoc {
  return {
    _id: id,
    name: input.name,
    email: input.email,
    emailLower: normalizeEmail(input.email),
    passwordHash: input.passwordHash,
    role: input.role,
    memberships: input.memberships,
    sessionVersion: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: input.createdBy,
    lastLoginAt: null,
  }
}

export async function getAccountsCollection(): Promise<Collection<AccountDoc>> {
  const db = await getMongoDb()
  return db.collection<AccountDoc>('accounts')
}

/** Enforce email uniqueness. Idempotent — safe to call on every boot. */
export async function ensureAccountIndexes(): Promise<void> {
  const col = await getAccountsCollection()
  await col.createIndex({ emailLower: 1 }, { unique: true })
}

export async function createAccount(input: NewAccount): Promise<AccountDoc> {
  const doc = makeAccountDoc(input, randomBytes(12).toString('hex'), new Date().toISOString())
  const col = await getAccountsCollection()
  await col.insertOne(doc)
  return doc
}

export async function getAccount(id: string): Promise<AccountDoc | null> {
  const col = await getAccountsCollection()
  return col.findOne({ _id: id })
}

export async function findAccountByEmail(email: string): Promise<AccountDoc | null> {
  const col = await getAccountsCollection()
  return col.findOne({ emailLower: normalizeEmail(email) })
}

export async function listAccounts(): Promise<AccountDoc[]> {
  const col = await getAccountsCollection()
  return col.find({}).toArray()
}

export async function updateAccount(
  id: string,
  patch: Partial<Pick<AccountDoc, 'name' | 'passwordHash' | 'role' | 'memberships' | 'lastLoginAt'>>,
): Promise<void> {
  const col = await getAccountsCollection()
  await col.updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date().toISOString() } })
}

export async function deleteAccount(id: string): Promise<void> {
  const col = await getAccountsCollection()
  await col.deleteOne({ _id: id })
}

/** Invalidate every existing session for this account (logout-all / password change / revoke). */
export async function bumpSessionVersion(id: string): Promise<void> {
  const col = await getAccountsCollection()
  await col.updateOne({ _id: id }, { $inc: { sessionVersion: 1 }, $set: { updatedAt: new Date().toISOString() } })
}

export async function countAccounts(): Promise<number> {
  const col = await getAccountsCollection()
  return col.countDocuments({})
}

/** True once at least one owner account exists — drives the bootstrap gate (Phase 2). */
export async function hasAnyOwner(): Promise<boolean> {
  const col = await getAccountsCollection()
  return (await col.countDocuments({ role: 'owner' }, { limit: 1 })) > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/accounts.test.ts`
Expected: PASS (1 test). Then `bun tsc --noEmit` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/accounts.ts packages/server/server/accounts.test.ts
git commit -m "feat(iam): accounts collection CRUD + pure makeAccountDoc"
```

---

### Task 6: Teams collection (`teams.ts`)

**Files:**
- Create: `packages/server/server/teams.ts`
- Test: `packages/server/server/teams.test.ts` (pure builder only)

**Interfaces:**
- Consumes: `getMongoDb` from `./mongo`; `TeamDoc` from `./iam-types`.
- Produces:
  - `makeTeamDoc(name: string, id: string, nowIso: string, createdBy?: string): TeamDoc` (pure)
  - `DEFAULT_TEAM_ID = 'default'`
  - `getTeamsCollection(): Promise<Collection<TeamDoc>>`
  - `createTeam(name: string, createdBy?: string): Promise<TeamDoc>`
  - `getTeam(id: string): Promise<TeamDoc | null>`
  - `listTeams(): Promise<TeamDoc[]>`
  - `updateTeam(id: string, name: string): Promise<void>`
  - `deleteTeam(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/teams.test.ts
import { test, expect } from 'bun:test'
import { makeTeamDoc, DEFAULT_TEAM_ID } from './teams'

test('makeTeamDoc is deterministic', () => {
  expect(makeTeamDoc('Platform', 'tid1', '2026-07-22T00:00:00.000Z', 'owner1')).toEqual({
    _id: 'tid1',
    name: 'Platform',
    createdAt: '2026-07-22T00:00:00.000Z',
    createdBy: 'owner1',
  })
})

test('DEFAULT_TEAM_ID is the stable seed id', () => {
  expect(DEFAULT_TEAM_ID).toBe('default')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/teams.test.ts`
Expected: FAIL — cannot find module `./teams`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/server/teams.ts
/**
 * teams.ts — the `teams` collection. A team is the unit of visibility + permission;
 * members/repos carry a teamId. `makeTeamDoc` is pure/deterministic for unit tests.
 */
import { randomBytes } from 'node:crypto'
import type { Collection } from 'mongodb'
import { getMongoDb } from './mongo'
import type { TeamDoc } from './iam-types'

/** Stable id of the seeded team every pre-existing member/repo is migrated into (Phase 2). */
export const DEFAULT_TEAM_ID = 'default'

export function makeTeamDoc(name: string, id: string, nowIso: string, createdBy?: string): TeamDoc {
  return { _id: id, name, createdAt: nowIso, createdBy }
}

export async function getTeamsCollection(): Promise<Collection<TeamDoc>> {
  const db = await getMongoDb()
  return db.collection<TeamDoc>('teams')
}

export async function createTeam(name: string, createdBy?: string): Promise<TeamDoc> {
  const doc = makeTeamDoc(name, randomBytes(8).toString('hex'), new Date().toISOString(), createdBy)
  const col = await getTeamsCollection()
  await col.insertOne(doc)
  return doc
}

export async function getTeam(id: string): Promise<TeamDoc | null> {
  const col = await getTeamsCollection()
  return col.findOne({ _id: id })
}

export async function listTeams(): Promise<TeamDoc[]> {
  const col = await getTeamsCollection()
  return col.find({}).toArray()
}

export async function updateTeam(id: string, name: string): Promise<void> {
  const col = await getTeamsCollection()
  await col.updateOne({ _id: id }, { $set: { name } })
}

export async function deleteTeam(id: string): Promise<void> {
  const col = await getTeamsCollection()
  await col.deleteOne({ _id: id })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/teams.test.ts`
Expected: PASS (2 tests). Then `bun tsc --noEmit` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/teams.ts packages/server/server/teams.test.ts
git commit -m "feat(iam): teams collection CRUD + pure makeTeamDoc"
```

---

### Task 7: `getPrincipal(req)` — wire cookie → account → principal

**Files:**
- Modify: `packages/server/server/auth.ts` (add `getPrincipal` at the end of the file)

**Interfaces:**
- Consumes: `verifyPrincipalSession` (Task 4), `parseCookies` + `COOKIE_NAME` + `TEAM_SESSION_SECRET` (in module), `getAccount` from `./accounts`, `Principal` from `./iam-types`.
- Produces: `getPrincipal(req: Request): Promise<Principal | null>`.

> This is a thin IO wrapper (touches Mongo via `getAccount`), so it is verified by
> integration (Phase 2/3 endpoints + the manual checks in the spec), not a unit test —
> its pure core (`verifyPrincipalSession`) is already covered by Task 4.

- [ ] **Step 1: Add the import at the top of `auth.ts`**

Add after the existing `config` import (line 20):

```ts
import { getAccount } from './accounts'
import type { Principal } from './iam-types'
```

- [ ] **Step 2: Append `getPrincipal` at the end of `auth.ts`**

```ts
/**
 * Resolve the authenticated principal for a request, or null.
 * Verifies the principal cookie, loads the account, and rejects if the account's
 * sessionVersion no longer matches the cookie (revocation / password change / logout-all).
 * Role + memberships are read FRESH from the DB so permission changes take effect immediately.
 */
export async function getPrincipal(req: Request): Promise<Principal | null> {
  const cookies = parseCookies(req.headers.get('cookie'))
  const parsed = verifyPrincipalSession(cookies[COOKIE_NAME], TEAM_SESSION_SECRET, Date.now())
  if (!parsed) return null
  const account = await getAccount(parsed.accountId)
  if (!account) return null
  if (account.sessionVersion !== parsed.sessionVersion) return null
  return { accountId: account._id, role: account.role, memberships: account.memberships }
}
```

- [ ] **Step 3: Type-check + full suite**

Run: `bun tsc --noEmit`
Expected: no errors.
Run: `bun test`
Expected: PASS (all existing tests + the new IAM tests from Tasks 1–6).

- [ ] **Step 4: Commit**

```bash
git add packages/server/server/auth.ts
git commit -m "feat(iam): getPrincipal — cookie → account → principal with sessionVersion check"
```

---

## Self-Review

**Spec coverage (Phase 1 slice of the spec):**
- §4 `accounts` collection → Task 5. `teams` collection → Task 6. `AccountDoc`/`TeamDoc`/`Membership`/`Principal` types → Task 2.
- §5.1 argon2id hashing → Task 1. §5.2 session carries `accountId+sessionVersion`, permissions from DB, sessionVersion revocation → Tasks 4 + 7. §5.3 capability matrix (the `can()` core that `ADMIN_PATHS` will call) → Task 3.
- Not in this phase (by design, deferred): wiring `getPrincipal` into the `index.ts` gate + removing the shared password (Phase 2/3 — needs bootstrap + account login to exist first, else the central locks out); `teamId` on `tokens`/`repos` + Default-team seeding/backfill (Phase 2); rate-limited account login endpoint (Phase 3). These are intentionally out of scope so Phase 1 stays additive and non-breaking.

**Placeholder scan:** none — every step has full code and exact commands.

**Type consistency:** `Principal`, `AccountDoc`, `TeamDoc`, `Membership`, `Role`, `TeamRole` defined in Task 2 and consumed unchanged in Tasks 3/5/6/7. `verifyPrincipalSession` return type `PrincipalCookie` (Task 4) consumed in Task 7. `getAccount` signature (Task 5) matches its use in Task 7. `makeAccountDoc`/`makeTeamDoc` signatures match their tests.

**Non-breaking guarantee:** Tasks 1–6 only add new files; Task 4 appends to `auth.ts` without touching existing exports; Task 7 adds one new export. The existing password login path is untouched — the running central keeps working throughout Phase 1.
