# Team Mode — Phase 5: Role-aware Team UX + Cross-filtering Implementation Plan

> Executed via a parallel **Workflow** (3 file-disjoint tracks: server / team-tab-web / harness-filter-web), integrated + verified. Addresses direct user feedback: the Team config is confusing (admin shows + 500s on non-central instances) and the team dashboard can't cross-filter harness × user × model.

**Goal:** (1) Make the Team settings adapt to the instance's role — a normal dev sees only "Connect to team" (member config); a central sees only "Admin (Members/tokens)"; the admin section never renders (and never 500s) on a non-central instance. (2) Add a multi-select **Harness** filter to the dashboard that combines freely with the existing Users / Models / Date filters (AND composition).

**Architecture:** The server exposes whether this instance is a central (`central: boolean`) on `/api/team/session`. The web Team tab branches on that flag. A new `HarnessFilter` multi-select (mirroring the Phase-1 `UsersFilter`) writes `filters.harnesses` and `useDerivedStats` filters sessions by it at the session level (so it composes with users/models/date). Three disjoint file tracks.

**Tech Stack:** Bun, TypeScript (strict), React, `bun test`.

## Global Constraints
- Everything in English. TypeScript strict — no `any`. Conventional Commits; pre-commit runs `bun tsc --noEmit` + `bun test`.
- `packages/server/server/*` server-only. Reuse `@agentistics/core`.
- Additive + backward-compatible: empty `harnesses` = all (no behavior change); Solo unaffected.

---

## THE CONTRACT (seam)

### `/api/team/session` response (server) — add `central`
```ts
{ authed: boolean, required: boolean, central: boolean }   // central = TEAM_CENTRAL
```
The web reads `central` to decide: show the **Admin (Members)** section ONLY when `central === true`; show the **member connect** config when `central === false`.

### `Filters.harnesses` (core types) — new multi-select dimension
```ts
// in packages/core/src/types.ts, Filters interface:
harnesses?: HarnessId[]   // empty/undefined = all harnesses
```
(Keep the existing `harness?: HarnessId` field untouched — the per-harness route still uses it; the new `harnesses` is the additive dashboard filter.)

### `filterByHarnesses` (core, pure) — new helper
```ts
// packages/core/src/team.ts (or a sibling) — mirror filterByUsers:
export function filterByHarnesses<T extends { harness?: HarnessId }>(sessions: T[], harnesses: HarnessId[]): T[]
//  empty -> pass-through; else keep sessions whose (harness ?? 'claude') is in the set
```

---

## TRACK A — Server (files: `auth.ts`, `auth.test.ts`)
**A1.** In `auth.ts` `handleSession`, add `central: TEAM_CENTRAL` to the JSON response (import `TEAM_CENTRAL` from `./config`). Update the `auth.test.ts` (if it asserts the session shape) to include `central`. The admin routes are ALREADY gated to central + auth (Phase 3) — no change needed there; this only surfaces the flag to the UI.

## TRACK B — Team tab role-aware (files: `TeamSettings.tsx`, `PreferencesModal.tsx`)
**B1 `TeamSettings.tsx`** — accept a `central: boolean` prop. Restructure:
- A clear role selector at top: **Solo** / **Team member** (segmented), bound to `team.mode`.
- When `central === true`: render ONLY the **Admin** intro ("This instance is the team central") + keep the `<TeamMembers/>` admin section. Hide the member connect fields (endpoint/token/push) — a central doesn't push to itself.
- When `central === false`: render the **member connect** config (mode selector + endpoint/user/org/token/test-connection/push) as today. Do NOT render `<TeamMembers/>` at all (this removes the 500 on non-central instances).
- Keep all copy bilingual.

**B2 `PreferencesModal.tsx`** — fetch `central` from `/api/team/session` (the modal already calls it for `required`); pass `central` into `<TeamSettings central={...}/>`. Remove any prior `teamRequired`-based gating of the admin section in favor of `central` (admin must depend on being the central, not on a password being set).

## TRACK C — Harness multi-filter (files: `packages/core/src/types.ts`, `packages/core/src/team.ts`, `packages/core/src/team.test.ts`, `packages/web/src/components/HarnessFilter.tsx`, `packages/web/src/components/FiltersBar.tsx`, `packages/web/src/hooks/useData.ts`, `packages/web/src/lib/app-context.ts`, `packages/web/src/App.tsx`)
**C1 core types + helper + test:** add `Filters.harnesses?: HarnessId[]`; add pure `filterByHarnesses` to `team.ts` (export from index barrel — already `export * from './team'`); TDD it in `team.test.ts` (empty=all; subset keeps only those harnesses; `undefined` harness treated as `'claude'`).
**C2 `HarnessFilter.tsx`** (NEW) — a compact multi-select dropdown mirroring the existing `UsersFilter.tsx` exactly (read it first), props `{ harnesses: HarnessId[]; selected: HarnessId[]; onChange; lang }`. Renders the harness ids with friendly labels (claude → "Claude Code", codex → "Codex", gemini → "Gemini", copilot → "Copilot"). Shows only when `harnesses.length > 1`.
**C3 `useData.ts`** — in `useDerivedStats`, after the existing user filter: `const harnessesSel = filters.harnesses ?? []`, apply `filterByHarnesses` as a pre-filter composed with the existing `filterByUsers(filterByHarness(...))` chain, and add `harnessesSel.length > 0` to the `sessionFiltered` OR (so totals come from per-session sums when a harness subset is selected). Import `filterByHarnesses` from `@agentistics/core`.
**C4 `app-context.ts` + `App.tsx`** — expose `harnesses: HarnessId[]` (the distinct harnesses present; `data.harnesses` already exists in AppData from the API). Pass it through the Outlet like `users`. (Reuse `data.harnesses`.)
**C5 `FiltersBar.tsx`** — render `<HarnessFilter harnesses={...} selected={filters.harnesses ?? []} onChange={h => onChange({ ...filters, harnesses: h })} lang={lang}/>` next to the Users filter; pass the prop at every FiltersBar render site (App.tsx + CustomPage). Include `harnesses` in the `isDefault`/`reset` logic (mirror how `users` was added).

---

## Integration seam checklist
- `/api/team/session` `{authed,required,central}` matches between `auth.ts` and `PreferencesModal.tsx`/`TeamSettings.tsx`.
- `filters.harnesses` typed in core and consumed in useData + FiltersBar + HarnessFilter consistently.
- `bun tsc --noEmit` + `bun run build` + `bun test` green.

## Testing
- Pure unit tests (TDD): `filterByHarnesses` (Track C1).
- The role-aware Team tab + harness filter UI verified by `tsc` + `build` + manual (admin hidden on non-central; harness multi-select changes the dashboard numbers and composes with the user filter).

## Out of scope (later)
- Removing the legacy single-harness route/pills in favor of the multi-filter (kept for now to avoid reworking the unified-view statsCache logic).
- A "group by" pivot view (the user chose independent combinable filters for this round).
- Live OS autostart install.
