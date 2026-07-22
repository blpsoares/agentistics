# B4 Phase 2 — Bootstrap (owner creation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision the first owner account securely — on central startup with no accounts, generate a one-time bootstrap token and print it to the logs; expose `GET /api/iam/status` (needsBootstrap) and `POST /api/iam/bootstrap` (token → creates the owner, seeds the Default team, backfills `teamId`, logs the caller in). After this phase the central is bootstrappable end-to-end via curl (the web UI comes in Phase 5).

**Architecture:** Builds on Phase 1 primitives (`accounts.ts`, `teams.ts`, `passwords.ts`, `auth.ts` principal session). New `bootstrap.ts` (token doc in the `config` collection + pure hash/verify + pure input validation) and `iam-handlers.ts` (thin IO route handlers mirroring `auth.ts`'s handler pattern). `index.ts` gains a central-startup seed/token block and two public IAM routes. `teamId` is added to `tokens`/`repos` with an idempotent backfill.

**Tech Stack:** Bun, TypeScript (strict), MongoDB driver, `node:crypto`.

## Global Constraints

- Everything in English (code, comments, commits).
- TypeScript strict; no `any`.
- Commit subjects must be lowercase (commitlint: no sentence/start/pascal/upper-case) — e.g. `feat(iam): ...`.
- Additive & non-breaking: the existing shared-password login path stays working this phase (it is removed in a later phase once accounts fully take over). Do not modify existing `auth.ts` functions except by ADDING new exports.
- Bootstrap routes are **public only while no owner exists** — the route handler itself MUST re-check `hasAnyOwner()` and return 409 once an owner exists (the AUTH_PUBLIC allowlist is static).
- Mongo-touching functions are thin IO and are NOT unit-tested (project rule: no DB mocking). Only pure functions get unit tests.
- Bootstrap token: 24 random bytes hex; stored only as a sha256 hash in the `config` collection, doc `_id: 'bootstrap'`. The plaintext is printed to stdout exactly once at generation — the one intentional place a secret is logged.
- `DEFAULT_TEAM_ID` = `'default'` (from `teams.ts`, Phase 1).
- Run tests: `bun test`; type-check: `bun tsc --noEmit`.

---

### Task 1: `bootstrap.ts` — token doc + pure hash/verify + pure input validation

**Files:**
- Create: `packages/server/server/bootstrap.ts`
- Test: `packages/server/server/bootstrap.test.ts` (pure functions only)

**Interfaces:**
- Consumes: `getMongoDb` from `./mongo`.
- Produces:
  - `interface BootstrapDoc { _id: string; tokenHash?: string; createdAt: string; consumedAt?: string }`
  - `interface OwnerInput { name: string; email: string; password: string; confirm: string; token: string }`
  - `hashBootstrapToken(token: string): string` (pure, sha256 hex)
  - `bootstrapTokenMatches(token: string, storedHash: string | undefined): boolean` (pure, constant-time)
  - `validateOwnerInput(b: Record<string, unknown>): { ok: true; value: OwnerInput } | { ok: false; error: string }` (pure)
  - `generateBootstrapToken(nowIso: string): Promise<string>` (IO — stores hash, returns plaintext once)
  - `getBootstrapDoc(): Promise<BootstrapDoc | null>` (IO)
  - `verifyBootstrapToken(token: string): Promise<boolean>` (IO)
  - `consumeBootstrapToken(nowIso: string): Promise<void>` (IO)

- [ ] **Step 1: Write the failing test** (pure functions only)

```ts
// packages/server/server/bootstrap.test.ts
import { test, expect } from 'bun:test'
import { hashBootstrapToken, bootstrapTokenMatches, validateOwnerInput } from './bootstrap'

test('hashBootstrapToken is sha256 hex and deterministic', () => {
  const h = hashBootstrapToken('abc')
  expect(h).toBe(hashBootstrapToken('abc'))
  expect(h).toMatch(/^[0-9a-f]{64}$/)
  expect(h).not.toBe('abc')
})

test('bootstrapTokenMatches compares against the stored hash', () => {
  const h = hashBootstrapToken('tok')
  expect(bootstrapTokenMatches('tok', h)).toBe(true)
  expect(bootstrapTokenMatches('wrong', h)).toBe(false)
  expect(bootstrapTokenMatches('tok', undefined)).toBe(false)
})

test('validateOwnerInput accepts a well-formed body', () => {
  const r = validateOwnerInput({ name: ' Alice ', email: ' Alice@Example.com ', password: 'longenough', confirm: 'longenough', token: 't' })
  expect(r.ok).toBe(true)
  if (r.ok) {
    expect(r.value.name).toBe('Alice')
    expect(r.value.email).toBe('Alice@Example.com')
    expect(r.value.token).toBe('t')
  }
})

test('validateOwnerInput rejects bad input with a specific error', () => {
  expect(validateOwnerInput({ email: 'a@b.co', password: 'longenough', confirm: 'longenough', token: 't' })).toEqual({ ok: false, error: 'name is required' })
  expect(validateOwnerInput({ name: 'A', email: 'nope', password: 'longenough', confirm: 'longenough', token: 't' })).toEqual({ ok: false, error: 'valid email is required' })
  expect(validateOwnerInput({ name: 'A', email: 'a@b.co', password: 'short', confirm: 'short', token: 't' })).toEqual({ ok: false, error: 'password must be at least 8 characters' })
  expect(validateOwnerInput({ name: 'A', email: 'a@b.co', password: 'longenough', confirm: 'different1', token: 't' })).toEqual({ ok: false, error: 'passwords do not match' })
  expect(validateOwnerInput({ name: 'A', email: 'a@b.co', password: 'longenough', confirm: 'longenough' })).toEqual({ ok: false, error: 'missing bootstrap token' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/bootstrap.test.ts`
Expected: FAIL — cannot find module `./bootstrap`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/server/bootstrap.ts
/**
 * bootstrap.ts — one-time owner-setup token for first-boot provisioning.
 * The token's sha256 hash lives in the `config` collection (doc _id:'bootstrap').
 * Pure helpers (hash/match/validate) are unit-tested; the doc CRUD is thin IO.
 * The plaintext token is printed to stdout ONCE at generation (see index.ts boot block).
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { getMongoDb } from './mongo'

const COLLECTION = 'config'
const DOC_ID = 'bootstrap'

export interface BootstrapDoc {
  _id: string
  tokenHash?: string
  createdAt: string
  consumedAt?: string
}

export interface OwnerInput {
  name: string
  email: string
  password: string
  confirm: string
  token: string
}

/** sha256 hex of a token (pure). */
export function hashBootstrapToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time compare of a token against a stored sha256-hex hash (pure). */
export function bootstrapTokenMatches(token: string, storedHash: string | undefined): boolean {
  if (!storedHash) return false
  const a = Buffer.from(hashBootstrapToken(token), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Validate + normalize the owner-creation body (pure). */
export function validateOwnerInput(
  b: Record<string, unknown>,
): { ok: true; value: OwnerInput } | { ok: false; error: string } {
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const email = typeof b.email === 'string' ? b.email.trim() : ''
  const password = typeof b.password === 'string' ? b.password : ''
  const confirm = typeof b.confirm === 'string' ? b.confirm : ''
  const token = typeof b.token === 'string' ? b.token : ''
  if (!token) return { ok: false, error: 'missing bootstrap token' }
  if (!name) return { ok: false, error: 'name is required' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'valid email is required' }
  if (password.length < 8) return { ok: false, error: 'password must be at least 8 characters' }
  if (password !== confirm) return { ok: false, error: 'passwords do not match' }
  return { ok: true, value: { name, email, password, confirm, token } }
}

async function bootstrapCollection() {
  const db = await getMongoDb()
  return db.collection<BootstrapDoc>(COLLECTION)
}

/** Generate a fresh token, store its hash (clearing any prior consumed state), return plaintext once. */
export async function generateBootstrapToken(nowIso: string): Promise<string> {
  const token = randomBytes(24).toString('hex')
  const col = await bootstrapCollection()
  await col.updateOne(
    { _id: DOC_ID },
    { $set: { tokenHash: hashBootstrapToken(token), createdAt: nowIso }, $unset: { consumedAt: '' } },
    { upsert: true },
  )
  return token
}

/** The stored bootstrap doc, or null (tolerates an unreachable DB). */
export async function getBootstrapDoc(): Promise<BootstrapDoc | null> {
  try {
    const col = await bootstrapCollection()
    return await col.findOne({ _id: DOC_ID })
  } catch {
    return null
  }
}

/** True if the presented token matches the stored, unconsumed hash. */
export async function verifyBootstrapToken(token: string): Promise<boolean> {
  const doc = await getBootstrapDoc()
  if (!doc || doc.consumedAt) return false
  return bootstrapTokenMatches(token, doc.tokenHash)
}

/** Mark the token consumed (one-time) and drop the hash. */
export async function consumeBootstrapToken(nowIso: string): Promise<void> {
  const col = await bootstrapCollection()
  await col.updateOne({ _id: DOC_ID }, { $set: { consumedAt: nowIso }, $unset: { tokenHash: '' } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/bootstrap.test.ts`
Expected: PASS (4 tests). Then `bun tsc --noEmit` — no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/bootstrap.ts packages/server/server/bootstrap.test.ts
git commit -m "feat(iam): bootstrap token doc + pure hash/verify/validate"
```

---

### Task 2: `teamId` on tokens/repos + Default-team seed + backfills

**Files:**
- Modify: `packages/server/server/teams.ts` (add `seedDefaultTeam`)
- Modify: `packages/server/server/team-tokens.ts` (add `teamId?` to `TokenDoc`, set it in `mintToken`, add `backfillTokenTeamIds`)
- Modify: `packages/server/server/team-repos.ts` (add `teamId?` to `RepoDoc`, set it in `registerRepo`, add `backfillRepoTeamIds`)

**Interfaces:**
- Consumes: `DEFAULT_TEAM_ID`, `getTeamsCollection` from `./teams`.
- Produces:
  - `seedDefaultTeam(): Promise<void>` (idempotent upsert of `{_id:'default', name:'Default team'}`)
  - `backfillTokenTeamIds(): Promise<void>`
  - `backfillRepoTeamIds(): Promise<void>`
  - `TokenDoc.teamId?: string`, `RepoDoc.teamId?: string`

> All-IO task — no unit tests (project rule). Deliverable verified by tsc + the boot/bootstrap integration in Task 5.

- [ ] **Step 1: Add `seedDefaultTeam` to `teams.ts`** (append after `deleteTeam`)

```ts
/** Idempotently ensure the seeded Default team exists (every pre-existing member/repo maps here). */
export async function seedDefaultTeam(): Promise<void> {
  const col = await getTeamsCollection()
  await col.updateOne(
    { _id: DEFAULT_TEAM_ID },
    { $setOnInsert: { name: 'Default team', createdAt: new Date().toISOString() } },
    { upsert: true },
  )
}
```

- [ ] **Step 2: Add `teamId` to `TokenDoc` and set it in `mintToken` + add backfill in `team-tokens.ts`**

In the `TokenDoc` interface (lines ~28-39) add the field:
```ts
  teamId?: string
```
Add the import at the top of `team-tokens.ts` (next to other imports):
```ts
import { DEFAULT_TEAM_ID } from './teams'
```
In `mintToken`, when building the inserted doc, add `teamId: DEFAULT_TEAM_ID` to the document object (new tokens default to the Default team; team reassignment comes in a later phase).
Append the backfill helper at the end of the file:
```ts
/** Assign the Default team to any token minted before teams existed. Idempotent. */
export async function backfillTokenTeamIds(): Promise<void> {
  const col = await getTokensCollection()
  await col.updateMany({ teamId: { $exists: false } }, { $set: { teamId: DEFAULT_TEAM_ID } })
}
```

- [ ] **Step 3: Add `teamId` to `RepoDoc` and set it in `registerRepo` + add backfill in `team-repos.ts`**

In the `RepoDoc` interface (lines ~21-26) add:
```ts
  teamId?: string
```
Add the import at the top:
```ts
import { DEFAULT_TEAM_ID } from './teams'
```
In `registerRepo`, where the doc is built for `replaceOne` (lines ~70-74), add `teamId: DEFAULT_TEAM_ID` to the replacement doc.
Append the backfill helper at the end of the file:
```ts
/** Assign the Default team to any repo registered before teams existed. Idempotent. */
export async function backfillRepoTeamIds(): Promise<void> {
  const col = await getReposCollection()
  await col.updateMany({ teamId: { $exists: false } }, { $set: { teamId: DEFAULT_TEAM_ID } })
}
```

- [ ] **Step 4: Type-check**

Run: `bun tsc --noEmit`
Expected: no errors.
Run: `bun test`
Expected: all existing tests still pass (this task adds no tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/teams.ts packages/server/server/team-tokens.ts packages/server/server/team-repos.ts
git commit -m "feat(iam): teamId on tokens/repos + default-team seed and backfill"
```

---

### Task 3: `auth.ts` — principal session cookie header helper

**Files:**
- Modify: `packages/server/server/auth.ts` (append one export at the end; do not touch existing functions)

**Interfaces:**
- Consumes: `signPrincipalSession` (Phase 1), the module-private `SESSION_DURATION_MS`, `MAX_AGE_SECONDS`, `makeCookieHeader`, `TEAM_SESSION_SECRET`.
- Produces: `makePrincipalSessionCookieHeader(accountId: string, sessionVersion: number): string`

> Thin IO (reads `Date.now`) — no unit test; verified by the bootstrap integration in Task 5.

- [ ] **Step 1: Append to `auth.ts`**

```ts
/**
 * Build a Set-Cookie header string for a freshly-issued principal session (7-day expiry).
 * Reuses the module's cookie internals so login/bootstrap flows never re-implement them.
 */
export function makePrincipalSessionCookieHeader(accountId: string, sessionVersion: number): string {
  const expiryMs = Date.now() + SESSION_DURATION_MS
  const value = signPrincipalSession(expiryMs, accountId, sessionVersion, TEAM_SESSION_SECRET)
  return makeCookieHeader(value, MAX_AGE_SECONDS)
}
```

- [ ] **Step 2: Type-check**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/server/auth.ts
git commit -m "feat(iam): principal session cookie header helper"
```

---

### Task 4: `iam-handlers.ts` — status + bootstrap route handlers

**Files:**
- Create: `packages/server/server/iam-handlers.ts`

**Interfaces:**
- Consumes: `hasAnyOwner`, `createAccount` from `./accounts`; `hashPassword` from `./passwords`; `validateOwnerInput`, `verifyBootstrapToken`, `consumeBootstrapToken` from `./bootstrap`; `seedDefaultTeam` from `./teams`; `backfillTokenTeamIds` from `./team-tokens`; `backfillRepoTeamIds` from `./team-repos`; `makePrincipalSessionCookieHeader` from `./auth`.
- Produces:
  - `handleIamStatus(): Promise<Response>` — `{ central: true, needsBootstrap }`
  - `handleBootstrap(req: Request): Promise<Response>` — creates the first owner; on success sets the principal cookie and returns `{ ok: true }`.

> Thin IO handlers mirroring `auth.ts` (return a `Response` with `Content-Type: application/json`; the caller in `index.ts` spreads `CORS_HEADERS`). No unit test — verified by the curl integration in Task 5's manual check.

- [ ] **Step 1: Write the module**

```ts
// packages/server/server/iam-handlers.ts
/**
 * iam-handlers.ts — thin IO route handlers for IAM bootstrap (Phase 2).
 * Mirrors auth.ts: each returns a Response with JSON content-type; the caller in
 * index.ts spreads CORS_HEADERS. Bootstrap is public only while no owner exists —
 * handleBootstrap re-checks hasAnyOwner() and refuses once set up.
 */
import { hasAnyOwner, createAccount } from './accounts'
import { hashPassword } from './passwords'
import { validateOwnerInput, verifyBootstrapToken, consumeBootstrapToken } from './bootstrap'
import { seedDefaultTeam } from './teams'
import { backfillTokenTeamIds } from './team-tokens'
import { backfillRepoTeamIds } from './team-repos'
import { makePrincipalSessionCookieHeader } from './auth'

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
```

- [ ] **Step 2: Type-check**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/server/iam-handlers.ts
git commit -m "feat(iam): status + bootstrap route handlers"
```

---

### Task 5: Wire boot seeding + token log + IAM routes into `index.ts`

**Files:**
- Modify: `packages/server/server/index.ts`

**Interfaces:**
- Consumes: `handleIamStatus`, `handleBootstrap` from `./iam-handlers`; the IAM boot helpers via dynamic import.

> IO/integration wiring. Verified by tsc, the full suite, and the manual curl check below.

- [ ] **Step 1: Add the two routes to the `AUTH_PUBLIC` Set** (the Set at lines ~111-122)

Add these two entries to the Set literal:
```ts
  '/api/iam/status',
  '/api/iam/bootstrap',
```
(Do NOT add them to `ADMIN_PATHS`.)

- [ ] **Step 2: Add the central-startup seed + token block** (immediately AFTER the existing `if (TEAM_CENTRAL) { ... }` block that ends ~line 89)

```ts
// IAM bootstrap init (central only): ensure indexes + Default team, backfill teamId, and —
// when no owner exists yet — mint a one-time setup token and print it to the logs.
if (TEAM_CENTRAL) {
  void (async () => {
    try {
      const { ensureAccountIndexes, hasAnyOwner } = await import('./accounts')
      const { seedDefaultTeam } = await import('./teams')
      const { backfillTokenTeamIds } = await import('./team-tokens')
      const { backfillRepoTeamIds } = await import('./team-repos')
      await ensureAccountIndexes()
      await seedDefaultTeam()
      await backfillTokenTeamIds()
      await backfillRepoTeamIds()
      if (!(await hasAnyOwner())) {
        const { getBootstrapDoc, generateBootstrapToken } = await import('./bootstrap')
        const existing = await getBootstrapDoc()
        if (!existing || existing.consumedAt || !existing.tokenHash) {
          const token = await generateBootstrapToken(new Date().toISOString())
          console.log(
            '\n' +
            '========================================================\n' +
            '  agentistics — OWNER SETUP REQUIRED\n' +
            '  No owner account exists yet. Create it with this\n' +
            '  one-time setup token (POST /api/iam/bootstrap):\n\n' +
            `      ${token}\n\n` +
            '  Keep it secret. It is shown only once.\n' +
            '========================================================\n',
          )
        } else {
          console.log(
            '\n[agentistics] Owner setup pending — a setup token was already issued ' +
            '(see earlier logs). Restart with the DB reset, or reissue later via the CLI.\n',
          )
        }
      }
    } catch (err) {
      console.error('[agentistics] IAM bootstrap init skipped:', err instanceof Error ? err.message : err)
    }
  })()
}
```

- [ ] **Step 3: Add the route dispatch blocks** (immediately AFTER the `GET /api/team/session` block, ~line 865)

Mirror the CORS/response shape of the existing `/api/team/login` dispatch (which also sets a cookie) — use the SAME way that block spreads `CORS_HEADERS` over the handler's `Response` so `Set-Cookie` is preserved. The two blocks:

```ts
if (url.pathname === '/api/iam/status' && req.method === 'GET') {
  if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  const { handleIamStatus } = await import('./iam-handlers')
  const res = await handleIamStatus()
  return new Response(res.body, { status: res.status, headers: { ...CORS_HEADERS, ...Object.fromEntries(res.headers) } })
}

if (url.pathname === '/api/iam/bootstrap' && req.method === 'POST') {
  if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  const { handleBootstrap } = await import('./iam-handlers')
  const res = await handleBootstrap(req)
  return new Response(res.body, { status: res.status, headers: { ...CORS_HEADERS, ...Object.fromEntries(res.headers) } })
}
```

> If the existing `/api/team/login` block uses a shared helper (e.g. `withCors(res)`) instead of the inline spread above, use that same helper here for consistency. Check lines ~846-851 first and match whatever pattern is there.

- [ ] **Step 4: Type-check + full suite**

Run: `bun tsc --noEmit`
Expected: no errors.
Run: `bun test`
Expected: all tests pass (no new tests here; nothing regressed).

- [ ] **Step 5: Manual integration check (report the output; do not skip)**

Rebuild the central image and verify end-to-end via curl (Mongo must be up):

```bash
# From the repo root — rebuild + restart the central, then read the token from logs:
bash central.sh up
docker compose -p team-mode logs app --since 2m | grep -A2 "OWNER SETUP" || bash central.sh logs
```
Then, using the printed TOKEN:
```bash
# status should report needsBootstrap:true before setup
curl -s http://localhost:48080/api/iam/status
# create the owner
curl -s -X POST http://localhost:48080/api/iam/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"token":"<TOKEN>","name":"Owner","email":"owner@example.com","password":"supersecret","confirm":"supersecret"}' -i
# status should now report needsBootstrap:false; a second bootstrap must 409
curl -s http://localhost:48080/api/iam/status
```
Expected: first status `{"central":true,"needsBootstrap":true}`; bootstrap returns 200 `{ ok: true }` with a `Set-Cookie: agentistics_session=...`; second status `needsBootstrap:false`; a repeat bootstrap returns 409.

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/index.ts
git commit -m "feat(iam): wire bootstrap boot seed + token log + iam routes"
```

---

## Self-Review

**Spec coverage (Phase 2 slice):** first-owner bootstrap token (spec §6) → Tasks 1 + 5. `POST /api/iam/bootstrap` + `GET /api/iam/status` (spec §7) → Tasks 4 + 5. Default-team seeding + `teamId` backfill + `ensureAccountIndexes` at boot (spec §9, carry-overs from the Phase 1 review) → Tasks 2 + 5. Log the plaintext token once (spec §6) → Task 5. Ingest never blocked (spec §6): unaffected — the boot block and new routes don't touch `/api/team/ingest`.

**Deferred (documented):** the `agentop central owner` CLI shortcut (spec §6 "mechanism C") is NOT in this phase — the web/curl path (token in logs → `POST /api/iam/bootstrap`) fully provisions the owner. It needs `docker compose exec app` plumbing (bundled) vs native MONGO_URL (external) and is best done as its own small follow-up. Also deferred (Phase 3, per spec §5.5): removing the shared password + wiring `getPrincipal` into the request gate — Phase 2 stays additive so the running central is never locked out mid-migration.

**Placeholder scan:** none — full code in every code step; Task 5 step 3 explicitly says to match the existing login block's CORS pattern (a real, inspectable reference), not a vague directive.

**Type consistency:** `OwnerInput`/`BootstrapDoc` (Task 1) consumed by `iam-handlers` (Task 4). `createAccount(NewAccount)` (Phase 1) called with `{name,email,passwordHash,role:'owner',memberships:[]}` — matches the `NewAccount` shape. `makePrincipalSessionCookieHeader(accountId, sessionVersion)` (Task 3) called with `account._id, account.sessionVersion` (Task 4). `DEFAULT_TEAM_ID` (Phase 1 teams.ts) consumed in Task 2.

**Non-breaking:** existing login/gate untouched; new routes are additive and public-gated by their own `hasAnyOwner()` re-check; boot block is fire-and-forget and try/caught.
