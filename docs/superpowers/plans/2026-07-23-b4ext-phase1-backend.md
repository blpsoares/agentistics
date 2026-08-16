# B4-EXT Phase 1 — Accounts↔Machines backend core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Backend for account-owned machines + first-login password: token gains `accountId`; add-machine-to-account endpoint (gated); scoped machine listing; account `mustChangePassword` + change-password; account PATCH (name/memberships/reset); account-create-with-machine; `whoami` extended. Additive; server-authoritative.

**Architecture:** Extend `team-tokens.ts` (TokenDoc + machine mint/list), `accounts.ts` (mustChangePassword + updates), `iam-view.ts` (pure machine-mgmt capability), `iam-handlers.ts` (machines/change-password/PATCH/create-with-machine), and the whoami handler. Pure helpers unit-tested; Mongo IO integration-verified by curl at the end.

**Tech Stack:** Bun, TS strict, MongoDB, node:crypto.

## Global Constraints
- English; TS strict, no `any`. Commit subjects lowercase.
- Server enforces authz (owner → all; manager → their teams). `passwordHash` never serialized.
- Machine tokens = tokens with `accountId` set; CI/repo tokens (`repo`/`ci`) stay separate (no accountId).
- Random/temp passwords are shown once (like tokens), never stored plaintext.
- Mongo IO not unit-tested; pure helpers are. Run `bun tsc --noEmit` + `bun test` after each task.

---

### Task 1: token `accountId` + machine mint/list + pure capability

**Files:** Modify `team-tokens.ts`, `iam-view.ts`; test `iam-view.test.ts`.

**Interfaces produced:**
- `TokenDoc.accountId?: string`
- `mintToken(user, label, opts?)` — `opts` gains `accountId?`, `teamId?` (already may support teamId; add accountId).
- `mintMachineToken(input: { accountId: string; user: string; machineName: string; teamId: string }): Promise<{ id: string; token: string }>` — thin wrapper over mintToken setting accountId + label=machineName.
- `listMachines(): Promise<MachineInfo[]>` — tokens where `accountId` exists; `MachineInfo = { id, accountId, machineName, user, teamId, createdAt, lastSeenAt }`.
- pure `canManageMachineTeam(p: Principal, teamId: string | undefined): boolean` in `iam-view.ts` (owner → true; else manager of teamId).

- [ ] Step 1: Write failing test in `iam-view.test.ts` for `canManageMachineTeam`:
```ts
import { canManageMachineTeam } from './iam-view'
// owner → true any team; manager → true only own team; user → false
test('canManageMachineTeam', () => {
  const owner = { accountId:'o', role:'owner' as const, memberships:[] }
  const mgrA = { accountId:'m', role:'member' as const, memberships:[{teamId:'A',role:'manager' as const}] }
  const userA = { accountId:'u', role:'member' as const, memberships:[{teamId:'A',role:'user' as const}] }
  expect(canManageMachineTeam(owner,'Z')).toBe(true)
  expect(canManageMachineTeam(mgrA,'A')).toBe(true)
  expect(canManageMachineTeam(mgrA,'B')).toBe(false)
  expect(canManageMachineTeam(userA,'A')).toBe(false)
  expect(canManageMachineTeam(mgrA,undefined)).toBe(false)
})
```
- [ ] Step 2: run → fail. Implement `canManageMachineTeam` in `iam-view.ts`:
```ts
export function canManageMachineTeam(p: Principal, teamId: string | undefined): boolean {
  if (p.role === 'owner') return true
  if (!teamId) return false
  return p.memberships.some(m => m.teamId === teamId && m.role === 'manager')
}
```
- [ ] Step 3: In `team-tokens.ts` READ TokenDoc + mintToken + getTokensCollection. Add `accountId?: string` to TokenDoc; make `mintToken` accept `opts.accountId` and set it on the doc (keep existing teamId default). Append `mintMachineToken` + `listMachines` + `MachineInfo`:
```ts
export interface MachineInfo { id: string; accountId: string; machineName: string; user: string; teamId?: string; createdAt: string; lastSeenAt: string | null }
export async function mintMachineToken(input: { accountId: string; user: string; machineName: string; teamId: string }): Promise<{ id: string; token: string }> {
  return mintToken(input.user, input.machineName, { accountId: input.accountId, teamId: input.teamId })
}
export async function listMachines(): Promise<MachineInfo[]> {
  const col = await getTokensCollection()
  const docs = await col.find({ accountId: { $exists: true } }).toArray()
  return docs.map(d => ({ id: d._id, accountId: d.accountId!, machineName: d.label, user: d.user, teamId: d.teamId, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt }))
}
```
(`mintToken` must return `{ id, token }` — check its current return; adapt.)
- [ ] Step 4: `bun test iam-view.test.ts` pass; `bun tsc --noEmit` clean.
- [ ] Step 5: commit `feat(iam): token accountId + machine mint/list + canManageMachineTeam`

---

### Task 2: machines endpoints (list scoped + add-to-account)

**Files:** Modify `iam-handlers.ts`, `index.ts`.

- [ ] Step 1: In `iam-handlers.ts` append `handleMachines(req)` (self-guard via getPrincipal):
```ts
export async function handleMachines(req: Request): Promise<Response> {
  const principal = await getPrincipal(req)
  if (!principal) return json({ error: 'unauthorized' }, 401)
  if (req.method === 'GET') {
    const all = await listMachines()
    const visible = principal.role === 'owner' ? all : all.filter(m => canManageMachineTeam(principal, m.teamId))
    return json({ machines: visible })
  }
  if (req.method === 'POST') {
    let body: unknown; try { body = await req.json() } catch { return json({ error:'invalid JSON' },400) }
    const b = body as Record<string, unknown>
    const accountId = typeof b.accountId==='string'?b.accountId:''
    const name = typeof b.name==='string'?b.name.trim():''
    if (!accountId || !name) return json({ error:'accountId and name are required' },400)
    const account = await getAccount(accountId)
    if (!account) return json({ error:'account not found' },404)
    // team: explicit ctx or the account's first membership team (or 'default' for owner accounts)
    const teamId = (typeof b.teamId==='string'&&b.teamId) || account.memberships[0]?.teamId || 'default'
    if (!canManageMachineTeam(principal, teamId)) return json({ error:'forbidden' },403)
    const { token } = await mintMachineToken({ accountId, user: account.name, machineName: name, teamId })
    return json({ token }, 201)   // plaintext once
  }
  return json({ error:'method not allowed' },405)
}
```
Add imports: `listMachines`, `mintMachineToken` from `./team-tokens`; `canManageMachineTeam` from `./iam-view`; `getAccount` already imported.
- [ ] Step 2: In `index.ts` add `/api/iam/machines` (GET|POST) to AUTH_PUBLIC + a dispatch block mirroring the other iam routes (CORS-preserving, self-guarding). 
- [ ] Step 3: `bun tsc --noEmit` clean; `bun test` pass.
- [ ] Step 4: commit `feat(iam): machines endpoints (scoped list + add to account)`

---

### Task 3: account create-with-machine + `mustChangePassword` + login/me expose

**Files:** Modify `accounts.ts`, `iam-handlers.ts`, `iam-view.ts` (publicAccount).

- [ ] Step 1: `accounts.ts` — add `mustChangePassword?: boolean` to `AccountDoc` + to `makeAccountDoc` (default from input, else false). Add `NewAccount.mustChangePassword?: boolean`.
- [ ] Step 2: `iam-view.ts` `publicAccount` — add `mustChangePassword: a.mustChangePassword ?? false` to `PublicAccount`.
- [ ] Step 3: `iam-handlers.ts` `handleAccounts` POST — after validation + create, if body has `machine: { name }` (validate name string), mint a machine token for the new account (`mintMachineToken({ accountId: account._id, user: account.name, machineName, teamId: account.memberships[0]?.teamId || 'default' })`) and include `machineToken` in the response. Also accept `mustChangePassword?: boolean` in the body (default true for admin-created) and pass to createAccount.
- [ ] Step 4: `handleIamLogin` + `handleIamMe` — include `mustChangePassword` in the returned account (via publicAccount it's already there for /me; for login response add `mustChangePassword: account.mustChangePassword ?? false`).
- [ ] Step 5: `bun tsc --noEmit` clean; `bun test` pass.
- [ ] Step 6: commit `feat(iam): account create-with-machine + mustChangePassword`

---

### Task 4: change-password + account PATCH

**Files:** Modify `iam-handlers.ts`, `accounts.ts`, `index.ts`.

- [ ] Step 1: `accounts.ts` — ensure `updateAccount` supports `passwordHash`, `name`, `memberships`, `mustChangePassword`, `lastLoginAt` in its patch type (extend if needed).
- [ ] Step 2: `iam-handlers.ts` `handleChangePassword(req)`:
```ts
export async function handleChangePassword(req: Request): Promise<Response> {
  const principal = await getPrincipal(req)
  if (!principal) return json({ error:'unauthorized' },401)
  let body:unknown; try{body=await req.json()}catch{return json({error:'invalid JSON'},400)}
  const b = body as Record<string,unknown>
  const current = typeof b.currentPassword==='string'?b.currentPassword:''
  const next = typeof b.newPassword==='string'?b.newPassword:''
  if (next.length < 8) return json({ error:'password must be at least 8 characters' },400)
  const account = await getAccount(principal.accountId)
  if (!account) return json({ error:'account not found' },404)
  // require currentPassword unless this is a forced first-login change
  if (!account.mustChangePassword) {
    if (!(await verifyPassword(current, account.passwordHash))) return json({ error:'current password is incorrect' },401)
  }
  const passwordHash = await hashPassword(next)
  await updateAccount(account._id, { passwordHash, mustChangePassword: false })
  await bumpSessionVersion(account._id)   // invalidate old sessions
  const cookie = makePrincipalSessionCookieHeader(account._id, account.sessionVersion + 1)  // re-issue with the bumped version
  return new Response(JSON.stringify({ ok:true }), { status:200, headers:{ 'Content-Type':'application/json', 'Set-Cookie': cookie } })
}
```
Add imports: `bumpSessionVersion` from `./accounts`. (Note: after bumpSessionVersion the stored version = account.sessionVersion+1; re-issue the cookie with that value so the caller stays logged in.)
- [ ] Step 3: `handleAccounts` — add a `PATCH` branch: `{ id, name?, memberships?, resetPassword? }`. Load target; authz: owner → any non-owner target (and self name); manager → only if `canDeleteAccount(principal, target)` style (all memberships user-role in managed teams). Apply name/memberships via updateAccount; if `resetPassword` → generate a random temp password, hash it, set `mustChangePassword:true`, and return `{ tempPassword }` once. Never let a manager escalate a target to owner/manager.
- [ ] Step 4: `index.ts` — add `/api/iam/change-password` (POST) to AUTH_PUBLIC + dispatch (self-guarding, CORS-preserving); ensure `/api/iam/accounts` dispatch also accepts `PATCH`.
- [ ] Step 5: `bun tsc --noEmit` clean; `bun test` pass.
- [ ] Step 6: commit `feat(iam): change-password + account patch (edit/reset)`

---

### Task 5: extend `whoami`

**Files:** locate the `whoami` server handler (grep `whoami` in `packages/server/server` — likely `team-*.ts` or `index.ts`; validated the token → returns `{ ok, user, org }`). Modify it + `accounts.ts` (lookup by accountId).

- [ ] Step 1: READ the whoami handler + `validateIngestToken` (team-tokens.ts) — it returns `{ ok, user, memberId, repo?, ci? }`. Extend the token validation path so whoami can also return `machineName` (token.label), `teamId` (token.teamId), `accountId` (token.accountId), and `email` (from `getAccount(accountId).email` when accountId present).
- [ ] Step 2: Update the whoami response shape to `{ ok, user, org, machineName?, teamId?, email? }`. Keep backward-compatible (existing fields unchanged; new fields optional).
- [ ] Step 3: `bun tsc --noEmit` clean; `bun test` pass.
- [ ] Step 4: commit `feat(iam): whoami returns machineName/email/teamId for linked machines`

---

## Manual integration check (controller-run, after Task 5)
Rebuild central; with the owner cookie:
- `POST /api/iam/machines {accountId:<owner id>, name:"laptop-1"}` → 201 `{token}`.
- `GET /api/iam/machines` → includes it.
- `POST /api/iam/change-password {newPassword:"..."}` (as a mustChangePassword account) → 200 + Set-Cookie.
- `PATCH /api/iam/accounts {id, memberships:[...]}` → 200; verify scoping (manager can't touch other teams).
- `GET /api/team/whoami` (Bearer machine token) → returns machineName/email/teamId.

## Self-Review
Covers spec §3 (token accountId, mustChangePassword), §4 (machines, PATCH, change-password, whoami, login/me expose), authz gating (canManageMachineTeam + existing canCreate/canDelete). Deferred to later phases: all frontend (create-with-machine UI, edit, first-login screen, machines view, machine identity display). Pure helper `canManageMachineTeam` unit-tested; IO integration-checked via curl. No `any`; passwordHash never returned; temp/random passwords shown once.
