# Team Mode — Phase 3: Login + Token Admin Implementation Plan

> Executed via a parallel **Workflow** (server ∥ web, file-disjoint), then integrated + security-reviewed. The contract below is the fixed seam.

**Goal:** Secure the central: a single team password gates the dashboard + admin, and the director mints/revokes per-dev ingest tokens (hashed in Mongo, with last-seen) from a Members admin panel — replacing the single shared `TEAM_INGEST_TOKEN`.

**Architecture:** Server gains stateless HMAC-signed session cookies (`auth.ts`), a Mongo-backed token store storing only token *hashes* (`team-tokens.ts`), admin route handlers, and a request gate in `index.ts` that—when central + password set—requires a valid session for protected routes (ingest stays token-authed, login stays public). Ingest auth now also accepts minted tokens (hash lookup) and updates last-seen. Web gains a login screen (shown when the dashboard 401s) and a Members admin panel (mint/revoke/last-seen). Disjoint files; the contract is the seam.

**Tech Stack:** Bun, TypeScript (strict), `node:crypto` (HMAC/SHA-256/randomBytes — no new deps), MongoDB, React, `bun test`.

## Global Constraints

- Everything in English. TypeScript strict — no `any`. Conventional Commits; pre-commit runs `bun tsc --noEmit` + `bun test`.
- `packages/server/server/*` server-only. Reuse `getMongoDb`/`getTeamCollection` patterns from `mongo.ts`; reuse `CORS_HEADERS` for responses.
- **Backward-compatible / additive:** if `AGENTISTICS_TEAM_PASSWORD` is unset, NO session gate is applied (Solo and an unauthenticated central behave exactly as today). If the `tokens` collection is empty AND no legacy `TEAM_INGEST_TOKEN`, ingest stays open as in Phase 2a.
- **Security rules (BIND every task):**
  - Never store a raw token or raw password. Tokens → SHA-256 hash in Mongo. Password → compared via a constant-time compare against `AGENTISTICS_TEAM_PASSWORD` (or its configured hash).
  - Session cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 7d; `Secure` when `AGENTISTICS_TEAM_TLS=1`. Value = `${expiryMs}.${HMAC_SHA256(expiryMs, secret)}`, secret = `AGENTISTICS_TEAM_SESSION_SECRET ?? AGENTISTICS_TEAM_PASSWORD`. Verify with constant-time HMAC compare AND expiry check.
  - Never log secrets (password, tokens, cookie values, session secret).
  - Constant-time comparisons (`crypto.timingSafeEqual`) for password and HMAC checks.

---

## THE CONTRACT (fixed seam — both tracks build to this verbatim)

### Config (server, `config.ts`)
```ts
export const TEAM_PASSWORD = process.env.AGENTISTICS_TEAM_PASSWORD || undefined   // gate enabled iff set
export const TEAM_SESSION_SECRET = process.env.AGENTISTICS_TEAM_SESSION_SECRET || TEAM_PASSWORD || ''
export const TEAM_TLS = process.env.AGENTISTICS_TEAM_TLS === '1'                  // Secure cookie flag
```

### Auth API (server, public — NOT behind the gate)
- `POST /api/team/login`  body `{ password: string }` → on match: `Set-Cookie` session + `{ ok: true }`; on mismatch: `200 { ok: false, error: 'invalid password' }` (do not 401 the login form). Constant-time compare.
- `POST /api/team/logout` → clears the cookie, `{ ok: true }`.
- `GET  /api/team/session` → `{ authed: boolean, required: boolean }` (`required` = is a password configured). The web uses this on load to decide whether to show the login screen. Public.

### Admin API (server, BEHIND the gate — 401 if not authed when `required`)
- `GET    /api/team/members` → `{ members: { id: string; user: string; label: string; createdAt: string; lastSeenAt: string | null }[] }`  (`id` = the token hash, safe to expose)
- `POST   /api/team/tokens`  body `{ user: string; label: string }` → `{ token: string }` (the PLAINTEXT token, shown once; only the hash is stored)
- `DELETE /api/team/tokens`  body `{ id: string }` → `{ ok: true }`  (revoke by hash id)

### Ingest auth change (server, `team-ingest.ts`)
The existing `POST /api/team/ingest` bearer check becomes: a request is authorized if the bearer token's SHA-256 matches a doc in the `tokens` collection (→ update that doc's `lastSeenAt`), OR it equals the legacy `TEAM_INGEST_TOKEN` (if set), OR neither password-gate nor tokens nor legacy token are configured (open, as Phase 2a). 401 otherwise.

### Mongo `tokens` collection
`{ _id: <sha256(token) hex>, user: string, label: string, createdAt: ISOstring, lastSeenAt: ISOstring | null }`

---

## TRACK A — Server

Files: `config.ts`, `auth.ts` [new], `auth.test.ts` [new], `team-tokens.ts` [new], `team-tokens.test.ts` [new], `team-admin.ts` [new], `team-ingest.ts`, `index.ts`.

**A1 `config.ts`** — add the three config exports above.

**A2 `auth.ts`** (pure crypto helpers + handlers):
```ts
// PURE (unit-tested in auth.test.ts):
export function signSession(expiryMs: number, secret: string): string         // `${expiryMs}.${hmacHex}`
export function verifySession(cookieValue: string | undefined, secret: string, nowMs: number): boolean
//   true iff signature matches (constant-time) AND expiryMs > nowMs
export function parseCookies(header: string | null): Record<string, string>   // minimal cookie parser
export function constantTimeEqual(a: string, b: string): boolean              // wraps crypto.timingSafeEqual, length-safe
// HANDLERS (IO/Response — use CORS_HEADERS + Set-Cookie):
export function handleLogin(req: Request): Promise<Response>     // body {password}; compares TEAM_PASSWORD; sets cookie
export function handleLogout(req: Request): Response             // clears cookie
export function handleSession(req: Request): Response            // {authed, required}
export function isAuthed(req: Request): boolean                  // verifySession over the request cookie; true if no password configured
```
Unit tests (A2 test): `signSession`/`verifySession` round-trip (valid passes; tampered fails; expired fails; wrong-secret fails); `constantTimeEqual` correctness; `parseCookies` parses `a=1; b=2`.

**A3 `team-tokens.ts`** (Mongo-backed, with one pure helper):
```ts
export function hashToken(token: string): string                 // PURE — sha256 hex; unit-tested
export async function mintToken(user: string, label: string): Promise<string>   // returns plaintext; stores {_id:hash,user,label,createdAt,lastSeenAt:null}
export async function revokeToken(id: string): Promise<boolean>  // deleteOne by _id(hash)
export async function listMembers(): Promise<{ id: string; user: string; label: string; createdAt: string; lastSeenAt: string | null }[]>
export async function validateIngestToken(bearer: string | null): Promise<{ ok: boolean; user?: string }>
//   hashes bearer, looks up; if found → updateOne lastSeenAt=now, return {ok:true,user}; else {ok:false}
```
Unit test (A3 test): `hashToken` is deterministic + 64-hex; different inputs differ.

**A4 `team-admin.ts`** — `handleMembers`/`handleMintToken`/`handleRevokeToken` route handlers (validate body, call team-tokens, JSON responses). Each assumes the caller already passed the gate (the gate is enforced in index.ts).

**A5 `team-ingest.ts`** — change the bearer check to: `const r = await validateIngestToken(authHeader)`. Authorized if `r.ok`, OR legacy `TEAM_INGEST_TOKEN` matches (constant-time), OR (no tokens configured AND no legacy token AND ... ) keep the Phase-2a "open when unset" behavior. Keep idempotent upsert unchanged.

**A6 `index.ts`** — register public routes (`/api/team/login`,`/logout`,`/session`) and admin routes (`/api/team/members`, `/api/team/tokens` POST+DELETE). Add the GATE: when `TEAM_CENTRAL && TEAM_PASSWORD`, for any `/api/*` path that is NOT in the public allowlist (`/api/team/login`, `/api/team/logout`, `/api/team/session`, `/api/team/ingest`), require `isAuthed(req)` → else `401 { error: 'auth required' }`. Static assets (the SPA + login UI) are served regardless so the login screen can load. Place the gate early in `fetch`, after CORS preflight.

## TRACK B — Web

Files: `TeamLogin.tsx` [new], `TeamMembers.tsx` [new], `PreferencesModal.tsx` (add Members admin to the Team tab when central/authed), and the app shell (`App.tsx`) to show the login screen on 401.

**B1 `TeamLogin.tsx`** — a full-screen password prompt. Calls `POST /api/team/login`; on `{ok:true}` calls an `onAuthed()` prop (parent reloads data); on `{ok:false}` shows the error. Bilingual.

**B2 App shell gate (`App.tsx`)** — on load, call `GET /api/team/session`. If `required && !authed`, render `<TeamLogin onAuthed={...}/>` instead of the dashboard. After login, proceed normally. (Also: if any data fetch returns 401, flip to the login screen.) Keep this minimal and additive — when `required:false` nothing changes.

**B3 `TeamMembers.tsx`** — admin panel: table of members (`user`, `label`, `lastSeenAt` relative, revoke button → `DELETE /api/team/tokens`), and a "Mint token" form (`user`,`label` → `POST /api/team/tokens` → show the plaintext token ONCE in a copyable field with a clear "save it now, it won't be shown again" note). Bilingual.

**B4 `PreferencesModal.tsx`** — surface `<TeamMembers/>` inside the existing **Team** tab (a "Members (central admin)" section), shown only when `GET /api/team/session` reports `required` (i.e. this instance is a gated central). Reuse the tab; do not add a new modal.

---

## Integration seam checklist (Integrate stage)
- `/api/team/session`, `/login`, `/members`, `/tokens` request/response shapes match between `index.ts`/handlers and the web components.
- The gate's public allowlist exactly matches the routes the web calls before auth (`/session`, `/login`).
- `bun tsc --noEmit` + `bun run build` + `bun test` green.

## Testing
- Pure unit tests (TDD): `signSession`/`verifySession`/`constantTimeEqual`/`parseCookies` (auth), `hashToken` (tokens). These carry the security-critical logic.
- IO (login/gate/admin routes, Mongo token store, web screens) verified by `tsc` + `build` + a manual e2e (login → mint token → ingest with it → see last-seen; revoke → ingest 401) + a dedicated security review.

## Out of scope (Phase 4)
- Docker compose (app + Mongo single-node RS), autostart toggle, config wizard. Roles beyond the single team login (per-user RBAC) remain out of scope entirely.
