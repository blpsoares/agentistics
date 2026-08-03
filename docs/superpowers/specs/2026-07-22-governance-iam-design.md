# B4 — Governance / IAM (design spec)

**Date:** 2026-07-22
**Roadmap item:** B4 (see `docs/superpowers/ROADMAP.md`) — the foundation for B5 (tags) and B7 (member metrics).
**Status:** design approved; ready for implementation planning.

Language: everything in this project is English (code/comments/commits/docs).

---

## 1. Problem & goals

Today the central has **no accounts, no roles, no email/password** — access is a single shared
password (`AGENTISTICS_TEAM_PASSWORD`) that mints a stateless HMAC session cookie; "admin" is
binary (holding a valid cookie). Data identity is token-based (`memberId = sha256(token)`).

Goal: a real governance layer — **owner / manager (gestor) / user** accounts with email+password,
**teams** as the unit of division/visibility, permission-gated UI and API, secure first-boot owner
provisioning, and the logged-in user + role shown in the UI. The shared password is **removed**
once an owner exists.

**Non-goals (YAGNI):** generic per-resource ACLs, SSO/OAuth login, multi-org per central,
self-service signup. Roles are a fixed 3-tier model scoped by team.

---

## 2. Division model — Teams

```
Central (instance, one org)
 └── Teams                         (owner-managed)
      ├── Members (machines/tokens)   existing — gain `teamId`
      ├── Repos                       existing — gain `teamId`
      └── (Tags/folders — B5, later)
```

- **Team is the boundary of both visibility and permission.**
- Existing `tokens`/`repos` docs gain a `teamId`. Migration assigns everything to a seeded
  **"Default team"**; the owner redistributes later.
- Additive migration only — the members/tokens/ingest pipeline is untouched.

---

## 3. Roles & permissions

Accounts hold `role: 'owner'` (instance-global) OR team-scoped memberships:
`memberships: [{ teamId, role: 'manager' | 'user' }]`. One account can be manager of team A and
user of team B.

| Action | owner | manager (per team) | user (per team) |
|---|:---:|:---:|:---:|
| Create/edit/delete **teams** | ✅ | ❌ | ❌ |
| Mint/rotate/revoke **machine tokens** | ✅ | ✅ (own team) | ❌ |
| Add/remove **members** in a team | ✅ | ✅ (own team) | ❌ |
| Manage **accounts** (create/edit/delete) | ✅ (all) | ✅ (`user` role, own team only) | ❌ |
| Create **tags/views** (B5) | ✅ | ✅ (own team) | 🔸 personal only |
| **View metrics** | everything | only their team(s) | only their team(s) |
| Central config (interval, offline policy) | ✅ | ❌ | ❌ |

Rules:
- Only owner creates/deletes **teams** and manages **owner/manager** accounts.
- A manager may create/edit/delete **user**-role accounts **only within teams they manage**.
- Managers/users never see data outside their team memberships.

---

## 4. Data model (new + changed Mongo docs)

Reuse the existing lazy Mongo singleton (`server/mongo.ts`, `getMongoDb()`) and the doc/CRUD
pattern of `team-repos.ts` / `central-config.ts`.

### New collection `accounts`
```ts
interface AccountDoc {
  _id: string            // random id (e.g. randomBytes(12) hex)
  email: string          // unique (lowercased); enforce a unique index
  emailLower: string     // normalized for lookup/uniqueness
  name: string
  passwordHash: string   // argon2id
  role: 'owner' | 'member'   // 'owner' = global owner; 'member' = scoped by memberships
  memberships: { teamId: string; role: 'manager' | 'user' }[]  // empty for owner
  sessionVersion: number // bump to invalidate all of this account's sessions
  createdAt: string
  updatedAt: string
  createdBy?: string      // accountId of creator (audit)
  lastLoginAt?: string | null
}
```
> Note: the doc-level `role` distinguishes the single global **owner** from everyone else
> (`'member'`), whose effective rights come from `memberships`. This keeps "owner" unambiguous and
> team-independent.

### New collection `teams`
```ts
interface TeamDoc {
  _id: string            // random id; the seeded default team uses a stable id 'default'
  name: string
  createdAt: string
  createdBy?: string
}
```

### Changed: `tokens` (team-tokens.ts) and `repos` (team-repos.ts)
- Add `teamId: string` (default `'default'` on migration). Token minting/repo registration take an
  optional `teamId`; a manager's mint is forced to their team.

### Bootstrap (first-owner) state
Stored in the existing `config` collection (central-config.ts pattern), doc `_id: 'bootstrap'`:
```ts
interface BootstrapDoc {
  _id: 'bootstrap'
  tokenHash?: string     // sha256 of the one-time setup token; deleted once owner created
  createdAt: string
  consumedAt?: string
}
```

---

## 5. Security

1. **Password hashing:** add `argon2` to `packages/server/package.json`; store `passwordHash`
   (argon2id) only. Never log or return password/hash.
2. **Session carries a principal, permissions resolved from DB:** keep the HMAC cookie mechanism in
   `auth.ts` but change the signed payload from `expiryMs` to `expiryMs.accountId.sessionVersion`
   (still HMAC-signed with `TEAM_SESSION_SECRET`). On each request `getPrincipal(req)`:
   - verify HMAC + expiry,
   - load the account by `accountId`,
   - reject if `account.sessionVersion !== cookie.sessionVersion` (revocation / password change /
     forced logout),
   - return `{ accountId, role, memberships }` (fresh from DB — **role/team changes take effect
     immediately**; permissions are never baked into the cookie).
3. **Enforcement:** replace binary `isAuthed`/`hasValidSession` with `getPrincipal`. Central choke
   points:
   - `ADMIN_PATHS` (index.ts) gains a **required-capability** check per route (e.g.
     `teams:write` → owner; `tokens:write` → owner or manager-of-target-team).
   - **Data-read scoping:** `buildApiResponse` / `team-source.ts` filter members/repos/sessions to
     the principal's team memberships (owner = all). This is the largest surface — a `visibleTeamIds`
     helper derived from the principal, applied where team data is assembled.
4. **Login hardening:** rate-limit/backoff per IP+email using the existing `createLimiter`
   (`server/utils.ts`); constant-time compares already exist in `auth.ts`.
5. **Remove shared password:** once an owner account exists, `AGENTISTICS_TEAM_PASSWORD` no longer
   grants dashboard access (login is accounts-only). The env var becomes inert for auth. (`auth.ts`
   `handleLogin` is replaced by account login.)
6. **Cookie flags** unchanged: `HttpOnly; SameSite=Lax; Path=/`, `Secure` when TLS.

---

## 6. First-boot owner provisioning (bootstrap)

**Mechanism A (one-time bootstrap token) — primary; Mechanism C (CLI) — shortcut.**

- On startup, when `TEAM_CENTRAL` and **no accounts exist**:
  - generate a random setup token, store its **hash** in `config` doc `_id:'bootstrap'`,
  - **print the plaintext token prominently to stdout/logs** (visible via `central.sh logs` /
    `docker logs`) — only whoever controls the server sees it.
- Web setup screen (`OwnerSetup.tsx`): visible only while no owner exists. Requires the **bootstrap
  token** + name + email + password + confirm. On success: create the owner account, seed the
  **Default team**, migrate existing tokens/repos to it, **consume** the bootstrap token (delete
  hash, set `consumedAt`). The setup screen then disappears permanently.
- **CLI shortcut (C):** `agentop central owner` — prints/regenerates the bootstrap token, and/or
  `agentop central owner create` creates the owner interactively from the host shell (writes Mongo
  directly), for people who prefer the terminal.
- **Ingest is never blocked** during setup — `POST /api/team/ingest` stays token-authed, so members
  keep pushing while the owner is being set up.

### Already-running centrals (upgrade path)
Same flow: the upgraded version boots, finds no accounts → generates a bootstrap token in the logs →
forced one-time owner setup. Existing data is preserved; all existing members/repos land in the
Default team; the old shared password stops granting dashboard access. No data loss, no ingest
interruption.

---

## 7. API surface (new endpoints, central-only)

All under `/api/iam/*` (added to the admin gate; each carries a capability requirement):

- `POST /api/iam/bootstrap` — create first owner (bootstrap token required). Public **only while no
  owner exists**; 404/409 afterwards.
- `POST /api/iam/login` — email+password → session cookie. Public. Replaces `/api/team/login`.
- `POST /api/iam/logout` — clear cookie.
- `GET  /api/iam/me` — current principal `{ accountId, name, email, role, memberships }` (drives the
  logged-in-user display). Public-ish (returns `null`/401 when unauthenticated).
- `GET/POST/PATCH/DELETE /api/iam/accounts` — manage accounts (owner: all; manager: `user` in own
  teams). **Security:** these handlers and `/api/iam/me` MUST strip `passwordHash` (and any secret
  field) from `AccountDoc` before serializing to the client — `getAccount`/`listAccounts` return the
  full doc including the hash. (Flagged in the Phase 1 whole-branch review.)
- `GET/POST/PATCH/DELETE /api/iam/teams` — manage teams (owner only).
- Existing `/api/team/tokens*`, `/api/team/repos`, `/api/team/config` gain team-scope + role checks.

`/api/team/session` is extended (or superseded by `/api/iam/me`) so the SPA can decide: needs
bootstrap? needs login? authed-as-whom?

---

## 8. Frontend

- **Gate flow** (`App.tsx`): fetch `/api/iam/me` (+ a `needsBootstrap` flag). Render order:
  `needsBootstrap` → `<OwnerSetup>`; else unauthenticated → `<Login>` (email+password, replaces
  `TeamLogin`); else the app.
- **IAM tab** in `PreferencesModal` (central-only, like the existing `repositories` tab): manage
  Teams + Accounts, with controls filtered by the caller's role. New components `IamPanel.tsx`
  (accounts + roles), `TeamsPanel.tsx` (teams CRUD).
- **Logged-in user + role** shown in the header (near the member summary) and/or the Settings
  header.
- Existing `TeamMembers` / `TeamRepos` panels gain team scoping (a team selector; managers see only
  their team).
- All permission-gated controls hidden/disabled based on `/api/iam/me`.

---

## 9. Migration summary (additive, safe)

1. New collections `accounts`, `teams`; `config` gains the `bootstrap` doc.
2. `tokens` + `repos` gain `teamId` (backfill to `'default'`, created on first owner setup).
3. Shared-password login removed once an owner exists (env var inert).
4. `stats-cache.json` stays Claude-only; team scoping is applied on per-session sums (same as every
   other dimension) — no change to that rule.

---

## 10. Suggested implementation phasing (for the plan)

Parallelizable clusters; each independently testable:

1. **Data + security core:** `accounts`/`teams` collections, argon2, `getPrincipal`, session payload
   change, capability checks at `ADMIN_PATHS`. (pure-ish; unit-testable)
2. **Bootstrap:** startup token generation + logging, `POST /api/iam/bootstrap`, CLI `agentop central
   owner`, Default-team seeding + token/repo backfill.
3. **IAM API:** accounts/teams CRUD endpoints with role enforcement.
4. **Data scoping:** `visibleTeamIds` applied in `buildApiResponse`/`team-source.ts`.
5. **Frontend:** gate flow (OwnerSetup + Login), IAM/Teams panels, logged-in-user display, team
   scoping in existing panels.

## 11. Testing
- Unit: password hash/verify roundtrip, session sign/verify with accountId+sessionVersion,
  capability matrix (role × action → allow/deny), `visibleTeamIds` derivation. Pure functions, no FS
  mocking (project rule).
- Integration (manual + curl per project memory): bootstrap flow on a fresh central, upgrade flow on
  an existing central (data preserved, ingest uninterrupted), revocation takes effect immediately
  (bump sessionVersion → next request 401).
