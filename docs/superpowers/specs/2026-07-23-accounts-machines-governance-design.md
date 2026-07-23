# Accounts ↔ Machines governance + first-login password (design spec)

**Date:** 2026-07-23
**Roadmap item:** B4-EXT (extends B4 governance/IAM). Follows UI-1/UI-2.
**Scope:** Backend (server) + frontend (central admin UI + member/machine app).

Language: English (code/comments/commits/docs).

---

## 1. Problem / goal

After B4, accounts (login) and machines (member tokens) are separate concepts, and machine tokens
were minted standalone. The owner wants machines **owned by accounts**: provisioned and governed
through the account, with clear team-based visibility. Plus first-login password hygiene.

Core requirements (from the owner):
- Registering a machine requires being logged in and is always **for an account**.
- **Owner** can register a machine for any account (owner/manager/user), sees everything, and sets
  which **team** a machine/account belongs to → that team's **manager** can see it. Granting a
  manager visibility = putting the machine's account in a team the manager manages (or adding the
  manager to that team). This needs **account editing** (memberships).
- Two account-creation flows: **central-access-only** (no machine) and **with a machine** (define
  email, user name, machine name).
- Password: **generate-random option** (shown once to the admin); **first login forces a password
  change** (blocking), via `mustChangePassword`.
- **1 account : N machines** (a person's 2 laptops on one account; an owner also monitors machines
  belonging to other accounts).
- On the machine, the local app's **"Central connection"** settings show its identity (machine
  name, email, user name) after a **handshake** with the central.

---

## 2. The handshake (machine ↔ central)

The **machine token is the proof of belonging** — a bearer secret, 32 random bytes, stored on the
central only as a **sha256 hash** alongside `{ accountId, machineName, user, teamId }`. Shown once
at creation. The machine never holds human email/password.

Flow when the user opens the machine app → Settings → **Central connection**:
1. Not connected → form: central **endpoint** + **token** (provisioned when the machine was added to
   the account).
2. On submit the machine calls `GET <endpoint>/api/team/whoami` with `Authorization: Bearer <token>`.
   The central validates the token (sha256 hash, constant-time) and returns the bound identity:
   `{ ok, user, machineName, email, teamId, org }`.
3. On success the machine persists `endpoint`+`token` in `~/.agentistics`, starts pushing
   (`POST /api/team/ingest`, token in header) and opens the reverse WebSocket (presence/chat) with
   the same token. The UI shows **"Connected as {user} · machine {machineName} · {email} · team".**
4. Revoked later → pushes 401/403 → the member auto-resets to solo + notifies (existing
   `team-uploader` behavior). Rotate preserves the `accountId` link.

Attribution stays **server-authoritative** (the central stamps identity from the token; a machine
can't claim another account), same principle as CI/OIDC.

---

## 3. Data model changes

### `tokens` (team-tokens.ts) — add machine↔account link
```ts
interface TokenDoc {
  _id: string          // sha256(token) = memberId (unchanged)
  user: string
  label: string        // ← machine name (reuse label)
  createdAt: string
  lastSeenAt: string | null
  teamId?: string
  repo?: string; ci?: boolean            // CI/repo tokens: no accountId
  accountId?: string   // ← NEW: the owning account (machine tokens)
}
```
Machine token = `accountId` set. CI tokens keep `repo/ci`, no `accountId`.

### `accounts` (accounts.ts) — first-login password
```ts
interface AccountDoc {
  ... // existing
  mustChangePassword?: boolean   // ← NEW: forces change on next login
}
```

---

## 4. Backend API

- `POST /api/iam/accounts` (extended): body may include `machine?: { name: string }`. When present,
  after creating the account, mint a **machine token** linked to it (`accountId`, `label`=name,
  `user`=account name, `teamId`=account's team) and return `{ account, machineToken }` (plaintext
  token once). `generateRandomPassword` handled client-side or server returns the generated one when
  asked. New accounts created by an admin default `mustChangePassword: true` (always true when the
  password was random).
- `PATCH /api/iam/accounts` (new): `{ id, name?, memberships?, resetPassword?: boolean }` — owner
  edits any account; manager edits only `user`-role accounts in teams they manage (reuse
  `canCreateAccount`/`canDeleteAccount`-style checks). `resetPassword` → new random temp + set
  `mustChangePassword`. Editing `memberships` is how the owner **grants a manager visibility** to a
  team. Never edits an owner's role via manager; `passwordHash` never returned.
- `POST /api/iam/machines` (new): `{ accountId, name, teamId? }` → mint a machine token for that
  account. Auth: owner → any account; manager → accounts whose team ∈ their managed teams. Returns
  the plaintext token once + the `agentop member connect` command hint.
- `GET /api/iam/machines` (new) OR extend `/api/team/members`: list machine tokens (accountId set),
  **scoped**: owner → all; manager → machines whose `teamId` ∈ managed teams. Includes owner
  account, machineName, team, presence, lastSeen. Rotate/revoke reuse existing token endpoints.
- `POST /api/iam/change-password` (new): authenticated principal changes own password
  (`{ currentPassword?, newPassword }`; when `mustChangePassword`, currentPassword may be skipped or
  required per policy — require it unless mustChangePassword). Clears `mustChangePassword`, bumps
  `sessionVersion` (re-issues cookie).
- `GET /api/team/whoami` (extend): also return `machineName` (token.label), `email` (from the linked
  account), `teamId`, `accountId` — for the machine's identity display + handshake.
- Login (`/api/iam/login`) response / `/api/iam/me`: expose `mustChangePassword` so the SPA can
  force the change-password screen.

Server enforces all authz (UX gating is advisory). `stats-cache.json` stays Claude-only; scoping via
per-session sums + token.teamId (unchanged rule).

---

## 5. Frontend

### Central (admin)
- **Create account** (Users page): two modes — *Central access only* (email, name, scope, password)
  vs *With a machine* (adds user name + **machine name**). Password field has **"generate random"**
  (shown once) + a "require password change on first login" checkbox (default on). On save with a
  machine, show the **machine token once** + connect command.
- **Edit account** (new): change name, **memberships** (grant/revoke team access = grant manager
  visibility), **reset password** (random temp + must-change). Drawer form.
- **Machines page = view**: list grouped by owning account / team (owner, machine name, team,
  presence, last seen), rotate/revoke; **"Add machine"** → pick account (owner: any; manager: their
  team's) + machine name (+ team if account is multi-team). No standalone token minting in the
  primary flow.
- **First-login password change**: after login, if `me.mustChangePassword`, render a **blocking**
  change-password screen (can't use the app until changed); on success clear + continue.

### Machine (member/solo app)
- **Central connection** settings section (restored) — endpoint + token → whoami handshake → shows
  **machine name · email · user · team** when connected; Leave to disconnect.

---

## 6. Phasing

1. **Backend core:** token `accountId`; account `mustChangePassword`; `POST /api/iam/machines`;
   scoped machine listing; `PATCH /api/iam/accounts`; `POST /api/iam/change-password`; whoami
   extension; login/me expose `mustChangePassword`. (pure helpers unit-tested; IO integration-tested)
2. **Frontend accounts:** create (central/with-machine + random password), edit (memberships/reset),
   first-login blocking change-password screen.
3. **Frontend machines:** Machines as grouped view + "Add machine to account".
4. **Machine client:** whoami-driven identity display in the Central connection section.

Each phase ends with `bun tsc --noEmit` clean, `bun test` green, a rebuild, and a manual/curl check.

---

## 7. Non-goals
- No per-machine keypair / mTLS (bearer token is the model; TLS at the endpoint in prod).
- No SSO/OAuth human login.
- No standalone (non-account) machine tokens in the primary UI (CI/OIDC repo tokens remain separate).
