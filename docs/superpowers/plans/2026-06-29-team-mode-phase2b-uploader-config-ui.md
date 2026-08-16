# Team Mode — Phase 2b: Local Uploader + Team Config UI Implementation Plan

> Executed via a parallel **Workflow** (two file-disjoint tracks: server ∥ web), integrated + verified. The API contract below is the fixed seam between the tracks.

**Goal:** A dev's local agentistics can be put in "team member" mode and automatically push its consolidated session metrics (deltas only, metrics-only) to a central, all configured from the dashboard UI — no more manual `curl`.

**Architecture:** Server side gains a `team-uploader` (pure delta-selection + an IO push loop) that POSTs new/changed consolidated sessions to `${endpoint}/api/team/ingest`, plus a `POST /api/team/test-connection` route. Config lives in `preferences.team`. Web side gains a "Team" tab in `PreferencesModal` that edits `preferences.team` (via the existing `/api/preferences` PUT) and calls test-connection. The two sides only touch disjoint files and communicate through the contract below.

**Tech Stack:** Bun, TypeScript (strict), React, `bun test`. No new dependencies (uploader uses built-in `fetch`).

## Global Constraints

- Everything in English: code, comments, commit messages.
- Conventional Commits; pre-commit hook runs `bun tsc --noEmit` + `bun test`.
- TypeScript strict — no `any`.
- `packages/server/server/*` are server-only — never imported from `packages/web/src/`.
- Reuse `@agentistics/core` (no inlined calculations); reuse `loadConsolidated` from `consolidate.ts` for the local session source; reuse the existing `/api/preferences` GET/PUT for config persistence (do NOT add a separate config store).
- Additive + backward-compatible: default `mode: 'solo'` and `pushEnabled: false` → nothing pushes, no behavior change. The uploader only runs when `mode === 'member' && pushEnabled`.
- Secrets: the bearer token lives in `preferences.team.token` on disk (the existing preferences file). Do NOT log the token.

---

## THE CONTRACT (fixed seam — both tracks build against this verbatim)

### Config shape — `preferences.team` (persisted via existing `/api/preferences`)

```ts
// added to the Preferences interface in packages/server/server/preferences.ts
team?: {
  mode: 'solo' | 'member'   // default 'solo'
  endpoint: string          // central base URL, e.g. "https://central.example:47291" (no trailing slash); default ''
  org: string               // default 'default'
  user: string              // this dev's identity (name or email); default ''
  pushEnabled: boolean      // default false
  token: string             // bearer token for ingest; default ''
}
```
`DEFAULT_PREFS.team` = `{ mode: 'solo', endpoint: '', org: 'default', user: '', pushEnabled: false, token: '' }`.

The web UI reads `team` from `GET /api/preferences` and writes it with `PUT /api/preferences` (body `{ team: {...} }` — the existing handler shallow-merges). No new config endpoint.

### `POST /api/team/test-connection` (new route, server)

- Request body: `{ endpoint: string, org: string, user: string, token: string }`
- Behavior: server-side `fetch` to `${endpoint}/api/team/ingest` with method POST, header `Authorization: Bearer ${token}` (omitted if token empty), body `{ org, user, sessions: [] }` (an empty, harmless idempotent ingest).
- Response (200 always, the result is in the body): `{ ok: boolean, status: number, error?: string }`
  - `ok: true` when the central replied 200 with `{ ok: true }`.
  - `ok: false` with `status` (e.g. 401, 0 on network error) and a short `error` string otherwise.
- This keeps the token server-side (the browser never sends it anywhere but to its own local server, which already holds it).

### `/api/team/ingest` (already exists from Phase 2a — the uploader's target)

- `POST` body `{ org, user, sessions: SessionMeta[] }`, header `Authorization: Bearer <token>` (when the central sets `TEAM_INGEST_TOKEN`). Returns `{ ok: true, count }`.

---

## TRACK A — Server (files: `preferences.ts`, `team-uploader.ts` [new], `team-uploader.test.ts` [new], `index.ts`, `config.ts`)

**A1. `preferences.ts`** — add the `team` field to the `Preferences` interface and to `DEFAULT_PREFS` exactly as in the contract. (The existing read/merge logic already deep-enough merges top-level keys; confirm `team` round-trips through `readPreferences`/`writePreferences`.)

**A2. `config.ts`** — add `export const TEAM_SENT_FILE = process.env.AGENTISTICS_TEAM_SENT_FILE ?? join(HOME_DIR, '.agentistics', 'team-sent.json')` (tracks what has already been pushed).

**A3. `team-uploader.ts`** — pure + IO, clearly split:

Pure (unit-tested):
```ts
import type { SessionMeta } from '@agentistics/core'

/** Deterministic content fingerprint of a session (stable JSON). */
export function sessionHash(s: SessionMeta): string   // = JSON.stringify(s)

export interface SentState { [sessionId: string]: string }  // sessionId -> last-sent hash

/** Select sessions whose content changed (or are new) vs the sent state.
 *  Returns the sessions to push and the next sent-state to persist after a successful push. */
export function selectDeltas(sessions: SessionMeta[], sent: SentState): { toSend: SessionMeta[]; nextSent: SentState }
//  toSend = sessions where sent[session_id] !== sessionHash(s)
//  nextSent = { ...sent, [each toSend session_id]: its hash }  (merged so unchanged stay)
```

IO (not unit-tested; manual/integration):
```ts
/** Load sent-state from TEAM_SENT_FILE (={} if missing/corrupt). */
export async function loadSentState(): Promise<SentState>
/** Persist sent-state to TEAM_SENT_FILE. */
export async function saveSentState(state: SentState): Promise<void>

/** One push cycle: load consolidated sessions, select deltas, POST them in
 *  batches to `${team.endpoint}/api/team/ingest`, persist sent-state on success.
 *  Returns the count pushed. No-op (returns 0) if mode!=='member' || !pushEnabled || !endpoint || !user. */
export async function pushOnce(team: NonNullable<Preferences['team']>): Promise<number>
//  - sessions source: loadConsolidated() from './consolidate' (Map -> values())
//  - batch size: 200 sessions per POST
//  - header Authorization: `Bearer ${team.token}` only when token is non-empty
//  - on a failed POST (non-2xx / throw): stop, do NOT advance sent-state for the failed batch, return what succeeded
//  - never throw out of pushOnce (callers are fire-and-forget); log a concise warning on failure

/** Start the periodic uploader. Idempotent. Reads preferences each cycle so
 *  toggling pushEnabled/mode takes effect without restart. Interval 60s. */
export function startUploader(): void
//  - module-level `started` guard
//  - every 60s: read current preferences; if team?.mode==='member' && team.pushEnabled, await pushOnce(team)
//  - also run one cycle ~5s after start
```

**A4. `index.ts`**:
- Add `POST /api/team/test-connection` route guard (before the non-`/api` static fallback, mirror the `/api/team/ingest` re-wrap-with-CORS pattern). A new handler `handleTeamTestConnection(req)` may live in `team-uploader.ts` or a small `team-client.ts` — your choice; keep it server-only and typed.
- Start the uploader on boot: near `void setupFileWatcher()`, add `import('./team-uploader').then(m => m.startUploader())` (unconditional is fine — `pushOnce` is a no-op unless member+pushEnabled; the periodic timer is cheap). Match the existing import style.

**A5. `team-uploader.test.ts`** — TDD the pure `sessionHash` + `selectDeltas`:
- `selectDeltas` with empty sent → all sessions to send; nextSent has every id.
- A session already in sent with the SAME hash → not resent.
- A session in sent with a CHANGED hash → resent; nextSent updated.
- A brand-new session → sent; unchanged ones in sent are preserved in nextSent.

## TRACK B — Web (files: `TeamSettings.tsx` [new], `PreferencesModal.tsx`, and ONLY if needed a small wiring in `app-context.ts`)

**B1. `TeamSettings.tsx`** — a settings panel component (mirror the existing PreferencesModal tab styling), props:
```ts
interface Props {
  team: { mode: 'solo'|'member'; endpoint: string; org: string; user: string; pushEnabled: boolean; token: string }
  onChange: (team: Props['team']) => void   // caller persists via PUT /api/preferences
  lang: 'pt' | 'en'
}
```
Renders:
- Mode selector: Solo / Team member (segmented control or radio).
- When `member`: inputs for Server URL (`endpoint`), Your name/email (`user`), Org (`org`), Token (`token`, type=password), a **Push enabled** toggle, and a **Test connection** button.
- Test connection button → `POST /api/team/test-connection` with `{ endpoint, org, user, token }`; show ✓ "Connected" / ✗ with the error/status. Local component state for the test result + a loading state.
- A short status line explaining metrics-only / what gets pushed.
- All copy bilingual (pt/en) via a local `T` table, matching the project's existing pattern.

**B2. `PreferencesModal.tsx`** — add a **"Team"** tab to the existing tabbed Settings modal (it currently has Preferences / Live / Install / Environment). The tab renders `<TeamSettings team={...} onChange={...} lang={...} />`. Source `team` from the preferences the modal already loads; on `onChange`, persist via the same `PUT /api/preferences` path the modal already uses for other preference writes (reuse the existing save mechanism — do NOT invent a new one). If the modal does not already hold the full preferences object, read `team` from `GET /api/preferences` on open.

**B3.** Only touch `app-context.ts` if `TeamSettings` genuinely needs global state — prefer keeping all team state local to the modal/tab. Avoid scope creep.

---

## Integration seam checklist (for the Integrate stage)

- `preferences.team` typed identically in `preferences.ts` (server) and wherever the web reads it — the web should import the type from `@agentistics/core` IF the Preferences type is shared there, otherwise mirror the contract shape exactly in the component props (it is a UI-local shape, acceptable).
- `POST /api/team/test-connection` request/response shape matches between `index.ts`/handler (server) and `TeamSettings.tsx` (web).
- `bun tsc --noEmit` + `bun run build` + `bun test` all green on the combined result.

## Testing

- Pure unit tests (TDD): `sessionHash`, `selectDeltas` (Track A5). These are the only logic-risk units.
- IO (uploader push loop, test-connection route, UI) verified by `tsc` + `bun run build` + a manual end-to-end (start a central from Phase 2a, set member config, confirm sessions appear on the central) — out of the pure-test suite.

## Out of scope (later phases)

- Autostart-on-boot toggle (Phase 4). Mode badge in the main header (optional, Phase 4).
- Minted per-user tokens + login/admin (Phase 3). The token here is the Phase 2a shared `TEAM_INGEST_TOKEN`.
- Real `bulkWrite` count surfaced to the uploader (deferred Phase 2a item) — the uploader treats a 200 as success.
