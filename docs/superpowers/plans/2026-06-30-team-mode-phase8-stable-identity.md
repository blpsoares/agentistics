# Team Mode — Phase 8: Stable member identity (key by token, editable display name)

> Executed via a parallel **Workflow** (server ∥ web), integrated + verified. Aggregates each member's data by a STABLE id (the token), so the data is never fragmented by the self-declared name — and renaming a member is a pure display change that re-labels all of their history at once.

**Goal:** Stop a machine's data from splitting across multiple names. Key every stored session by a stable **memberId** (the token's hash), not by the display name. The display name lives on the token and is editable; renaming it instantly re-labels all of that member's history (no re-key, no split). Add a "rename member" admin action.

**Architecture:** `validateIngestToken` returns the token's `memberId` (its Mongo `_id` = sha256(token)). Ingested sessions are keyed `org:memberId:harness:sessionId` and carry `memberId` + a cached `user`. At read time the central joins each session's `memberId` to the token's CURRENT display name, so a rename reflects everywhere. A revoked-token session falls back to its cached `user`. The central's own self-contributed sessions keep `user = CENTRAL_USER` (read locally — no Mongo key change needed).

**Tech Stack:** Bun, TypeScript (strict), MongoDB, React, `bun test`.

## Global Constraints
- Everything in English; user-facing copy bilingual pt/en. TypeScript strict — no `any`. Conventional Commits; pre-commit runs `bun tsc --noEmit` + `bun test`.
- `packages/server/server/*` server-only. Reuse the admin gate (ADMIN_PATHS) for the rename route.
- **Migration note (document, do not auto-run):** the doc `_id` scheme changes from name-based to memberId-based, so pre-Phase-8 data stays under the old keys. Operators clear stale data with `db.sessions.deleteMany({})` once; members re-push under the new stable keys.

---

## THE CONTRACT (seam)

### memberId
- For a member: `memberId = <token _id>` (the sha256 hash already stored in the `tokens` collection).
- For the central's own self-contribution: not stored in Mongo (read locally), tagged with `user = CENTRAL_USER` as today — no memberId needed.

### `team-tokens.ts`
- `validateIngestToken(bearer)` → `{ ok: boolean; user?: string; memberId?: string }` (add `memberId: doc._id`).
- `setMemberName(id: string, user: string): Promise<boolean>` (NEW) — update the token doc's `user` field (the editable display name). Returns whether a doc matched.
- `listMembers()` already returns `{ id, user, label, createdAt, lastSeenAt }` — keep.
- `getMemberNameMap(): Promise<Record<string, string>>` (NEW) — `{ [tokenId]: user }` for the read-time join.

### `team-store.ts`
- `teamDocId(org, memberId, harness, sessionId)` — key by memberId (was `user`).
- `TeamSessionDoc = SessionMeta & { _id: string; org: string; memberId: string; user: string }`.
- `toTeamDoc(session, org, memberId, user)` — sets `memberId`, `_id = teamDocId(org, memberId, harness, sessionId)`, and `user` (cached display name).
- `fromTeamDoc(doc)` — strips `_id`/`org`/`memberId`, keeps `user` (the read-time join overrides `user` afterward).

### `team-ingest.ts`
- On a minted-token ingest: pass `mintedResult.memberId` and `mintedResult.user` to `toTeamDoc(s, org, memberId, user)`. (Legacy/open ingest has no memberId → fall back to a memberId derived from the self-declared user, e.g. `legacy:${user}`, so it is at least stable per name; document that legacy ingestion can't benefit from rename-safety — minted tokens are the supported path.)

### `team-source.ts`
- `loadTeamSessionsFromMongo()` — after mapping docs, build `nameMap = await getMemberNameMap()` and for each session set `s.user = nameMap[doc.memberId] ?? doc.user` (current token name; fall back to the cached name for revoked tokens). The dashboard then groups by the current display name automatically.

### Rename route (`index.ts`)
- `PUT /api/team/members` (ADMIN-gated; add to ADMIN_PATHS) body `{ id, user }` → `setMemberName(id, user)` → `{ ok }`. (Reuse for the admin rename action.)

### Web (`TeamMembers.tsx`)
- Add an inline **rename** affordance per member row (an edit icon → editable name field → save → `PUT /api/team/members { id, user }` → refresh the list). Bilingual. After rename, the dashboard shows the new name across all of that member's history (the server join handles it).

---

## TRACK A — Server (files: `team-tokens.ts`, `team-store.ts`, `team-store.test.ts`, `team-ingest.ts`, `team-source.ts`, `index.ts`)
Implement the contract above. Update `team-store.test.ts` for the new `teamDocId`/`toTeamDoc` memberId signatures (id is now `org:memberId:harness:sessionId`; `toTeamDoc` sets `memberId`). Keep the open/legacy ingest working (legacy → `memberId = 'legacy:' + user`). The rename route reuses the admin gate.

## TRACK B — Web (files: `TeamMembers.tsx`)
Add the per-member rename UI calling `PUT /api/team/members { id, user }`. Keep the existing mint/revoke/list intact. Bilingual.

---

## Integration seam checklist
- `validateIngestToken` `memberId` consumed by `team-ingest.ts`; `toTeamDoc` memberId signature consistent across `team-store.ts` + `team-ingest.ts`.
- `getMemberNameMap` shape `{ [id]: user }` used by `team-source.ts`.
- `PUT /api/team/members { id, user }` shape matches between `index.ts` and `TeamMembers.tsx`.
- `bun tsc --noEmit` + `bun run build` + `bun test` green.

## Testing
- Unit: `teamDocId` (memberId-based) + `toTeamDoc` (sets memberId, _id) in `team-store.test.ts`.
- **Manual e2e (controller):** mint a token (memberId M, user "A"); ingest a session with a wrong self-declared name → stored under `org:M:...` with user "A"; rename member M to "B" via PUT /api/team/members → `GET /api/data` shows that session's user as "B" (all history re-labeled, not split). Ingest again → still one member, still "B".

## Out of scope (later)
- Member identity that survives TOKEN ROTATION (revoke+mint) — would need a separate memberId decoupled from the token; v1 ties memberId to the token (rename is safe; rotation starts a new member).
- Hiding orphaned/revoked members from the filter (could be a small follow-up).
