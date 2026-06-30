# Team Mode — Phase 6: Central-controlled push interval Implementation Plan

> Executed via a parallel **Workflow** (server ∥ web, file-disjoint), integrated + verified. The central dictates how often members push their metrics; the value is customizable by the central admin but hard-clamped to a safe range so it can never overload the central. Stored live in Mongo (no restart needed).

**Goal:** Replace the hardcoded 60s uploader interval with a central-controlled value. The central admin sets the push interval (default 30s); it is clamped to a safe floor (15s) and ceiling (1h) in code; members push at that interval (a member may choose to push *less* often, never more).

**Architecture:** A Mongo `config` collection (single doc) holds `pushIntervalSec`, read/written through a small `central-config.ts`. A public `GET /api/team/policy` returns it; admin `GET/PUT /api/team/config` reads/updates it (clamped). The member's `team-uploader` fetches the policy each cycle and uses `max(centralValue, memberPreference, FLOOR)`. Shared clamp constants live in `@agentistics/core`. No volume / no restart — the interval takes effect on the next cycle.

**Tech Stack:** Bun, TypeScript (strict), MongoDB, React, `bun test`.

## Global Constraints
- Everything in English; user-facing copy bilingual pt/en. TypeScript strict — no `any`. Conventional Commits; pre-commit runs `bun tsc --noEmit` + `bun test`.
- `packages/server/server/*` server-only. Reuse `getMongoDb`, `CORS_HEADERS`, the central+auth gate.
- Additive: when no central config exists, fall back to the default; Solo unaffected.

---

## THE CONTRACT (seam)

### Shared constants — `packages/core/src/types.ts` (or a new `packages/core/src/team.ts` export)
```ts
export const PUSH_INTERVAL = { MIN_SEC: 15, MAX_SEC: 3600, DEFAULT_SEC: 30 } as const
/** Clamp any requested interval to the safe range. Pure. */
export function clampPushInterval(sec: number): number   // = Math.min(MAX, Math.max(MIN, Math.round(sec || DEFAULT)))
```

### Mongo `config` collection
Single doc: `{ _id: 'team', pushIntervalSec: number }` (pushIntervalSec already clamped on write).

### Endpoints (server)
- `GET /api/team/policy` → `{ pushIntervalSec: number }` — PUBLIC (members fetch it; just a number, no secret). Returns the stored value or `PUSH_INTERVAL.DEFAULT_SEC`.
- `GET /api/team/config` → `{ pushIntervalSec: number }` — ADMIN (central + auth gate).
- `PUT /api/team/config` body `{ pushIntervalSec: number }` → clamps via `clampPushInterval`, upserts the Mongo doc, returns `{ pushIntervalSec }` — ADMIN.

### Member preference (web → preferences)
`preferences.team.pushIntervalSec?: number` — the member's own choice (optional). Effective uploader interval = `max(centralPolicy, memberPref ?? 0, PUSH_INTERVAL.MIN_SEC)`, then `clampPushInterval`.

---

## TRACK A — Server (files: `packages/core/src/types.ts` or `team.ts` + `team.test.ts`, `packages/server/server/central-config.ts` [new], `packages/server/server/index.ts`, `packages/server/server/team-uploader.ts`)

**A1 core constants + clamp:** add `PUSH_INTERVAL` + `clampPushInterval` to `@agentistics/core` (export from the barrel). TDD `clampPushInterval` in the core test (below MIN→MIN, above MAX→MAX, NaN/0→DEFAULT, in-range→rounded).

**A2 `central-config.ts` (NEW):** Mongo-backed:
```ts
export async function getCentralConfig(): Promise<{ pushIntervalSec: number }>   // reads doc _id:'team'; defaults pushIntervalSec=PUSH_INTERVAL.DEFAULT_SEC
export async function setPushInterval(sec: number): Promise<number>              // clampPushInterval, upsert, return the stored value
```
Use `getMongoDb()` → `db.collection('config')`. Tolerate an unreachable DB in getCentralConfig (return the default).

**A3 `index.ts` routes:** add
- `GET /api/team/policy` (PUBLIC — add `/api/team/policy` to the AUTH_PUBLIC allowlist): returns `{ pushIntervalSec: (await getCentralConfig()).pushIntervalSec }`.
- `GET /api/team/config` (ADMIN — gate on TEAM_CENTRAL + hasValidSession, like /api/team/members): returns the config.
- `PUT /api/team/config` (ADMIN): body `{ pushIntervalSec }` → `setPushInterval` → return `{ pushIntervalSec }`.
Wrap responses with CORS like the other team routes.

**A4 `team-uploader.ts`:** the uploader currently uses a hardcoded 60s interval. Change `startUploader` so each cycle computes the effective interval:
- fetch `GET ${team.endpoint}/api/team/policy` → `centralSec` (fallback to PUSH_INTERVAL.DEFAULT_SEC on error);
- read the member preference `team.pushIntervalSec` (passed in, or read from preferences);
- `effective = clampPushInterval(Math.max(centralSec, memberPref ?? 0))`;
- schedule the next cycle after `effective * 1000` ms (use a recursive `setTimeout` rather than a fixed `setInterval`, so the interval can change between cycles). Keep the existing `running` guard.

## TRACK B — Web (files: `packages/web/src/components/TeamSettings.tsx`)

**B1 Central (admin) branch:** add a "Push interval" control to the central's Team admin section. A small selector (options 15s / 30s / 1min / 2min / 5min) or a number input; on change, `PUT /api/team/config` with `{ pushIntervalSec }`; load the current value via `GET /api/team/config` on mount. Show a hint: "Members push at this interval (min 15s)." Options below `PUSH_INTERVAL.MIN_SEC` are disabled. Bilingual.

**B2 Member branch:** add a "Push interval" selector to the member connect config. Options ≥ `PUSH_INTERVAL.MIN_SEC` (e.g. 15s / 30s / 1min / 2min / 5min). On change, persist `team.pushIntervalSec` via the existing `PUT /api/preferences` mechanism the tab already uses. A hint: "Your team's central enforces a minimum; you can only push less often than that." (No need to fetch the central's exact value in the UI — the server clamps `max(member, central)`.) Bilingual.

Import `PUSH_INTERVAL` from `@agentistics/core` for the option list / min.

---

## Integration seam checklist
- `/api/team/policy` `{ pushIntervalSec }` and `/api/team/config` GET/PUT shapes match between `index.ts` and `TeamSettings.tsx`.
- `preferences.team.pushIntervalSec` typed (extend the team preferences type if needed) and read by the uploader.
- `bun tsc --noEmit` + `bun run build` + `bun test` green.

## Testing
- Pure unit test: `clampPushInterval` (MIN/MAX/default/round).
- IO (policy/config endpoints, uploader interval, UI) verified by tsc + build + a manual smoke (set interval on the central → `GET /api/team/policy` reflects it → member uploader uses it).

## Out of scope (later)
- A full central config form for password/secret/envs (those are deploy-time in `central.env`; a separate follow-up with the Mongo-backed-password approach).
- Per-member rate limiting beyond the interval.
