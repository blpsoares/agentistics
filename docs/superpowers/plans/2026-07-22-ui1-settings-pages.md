# UI-1 — Settings as pages + IAM redesign + sidebar footer + PWA autoUpdate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the oversized Settings modal into dedicated `/settings/:section` pages navigated from an inline "Settings" submenu in the aside (showing only sections the account can access), redesign the IAM section (Accounts + Teams tables with drawer forms + role explanations), tidy the cramped sidebar footer, and make the PWA auto-update.

**Architecture:** New nested routes under `/settings` in `AppRouter` (inside `AppLayout`). The 7 inline tab bodies in `PreferencesModal.tsx` (`PreferencesTab`, `SessionsTab`, `LiveTab`, `InstallTab`, `DataSourcesTab`, `HarnessesTab`, `TeamTab`) plus `IamTab`/`TeamRepos` are re-hosted as routed page components under `packages/web/src/pages/settings/`, reading their props from the `AppContext` outlet. A pure `visibleSettingsSections(me, central)` helper drives both the aside submenu and route guards. `PreferencesModal` is retired.

**Tech Stack:** React + Vite + react-router (web).

## Global Constraints

- English; TS strict, no `any`. Commit subjects lowercase.
- Frontend only — no backend/API change. Permissions derive from `/api/iam/me` (already fetched into App's `iam` state).
- Reuse existing tab body code — MOVE it, don't rewrite (except IAM, which is redesigned, and the footer). When extracting, thread the props each body needs from the `AppContext` outlet (`useOutletContext<AppContext>()`) or a small local fetch, matching how existing pages get context.
- Only render settings sub-items the account can access (UX gate); server still enforces real authz.
- Responsive: settings pages + the IAM drawer are full-screen/stacked on mobile (`useIsMobile`).
- Run `bun tsc --noEmit` + `bun test` after each task.

---

### Task 1: PWA auto-update

**Files:** Modify `packages/web/vite.config.ts`

- [ ] **Step 1:** READ `vite.config.ts` and the existing `VitePWA({...})` call. Set `registerType: 'autoUpdate'` and add `workbox: { ...existing, skipWaiting: true, clientsClaim: true }` (merge, don't drop existing workbox options). Keep `devOptions` and icons unchanged.
- [ ] **Step 2:** `bun tsc --noEmit` clean. (No test; config change.)
- [ ] **Step 3:** Commit: `git commit -m "fix(pwa): auto-update service worker (skipWaiting + clientsClaim)"`

---

### Task 2: `visibleSettingsSections` pure helper

**Files:**
- Create: `packages/web/src/lib/settingsSections.ts`
- Test: `packages/web/src/lib/settingsSections.test.ts`

**Interfaces:**
- Produces:
  - `type SettingsSectionId = 'preferences' | 'sessions' | 'data-sources' | 'harnesses' | 'install' | 'live' | 'iam' | 'team' | 'repositories'`
  - `interface SettingsSection { id: SettingsSectionId; labelEn: string; labelPt: string }`
  - `interface SettingsViewer { central: boolean; role?: 'owner' | 'member'; isManager?: boolean }`
  - `SETTINGS_SECTIONS: SettingsSection[]` (canonical order)
  - `visibleSettingsSections(v: SettingsViewer): SettingsSection[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/settingsSections.test.ts
import { test, expect } from 'bun:test'
import { visibleSettingsSections } from './settingsSections'

const ids = (v: Parameters<typeof visibleSettingsSections>[0]) => visibleSettingsSections(v).map(s => s.id)

test('solo/member: personal sections + live, no central-only', () => {
  expect(ids({ central: false })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install', 'live'])
})

test('central owner: personal (no live) + all central sections', () => {
  expect(ids({ central: true, role: 'owner' })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install', 'iam', 'team', 'repositories'])
})

test('central manager: personal + iam only', () => {
  expect(ids({ central: true, role: 'member', isManager: true })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install', 'iam'])
})

test('central plain user: personal only, no iam/team/repos', () => {
  expect(ids({ central: true, role: 'member', isManager: false })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install'])
})
```

- [ ] **Step 2: Run test → fails** (`bun test packages/web/src/lib/settingsSections.test.ts`).

- [ ] **Step 3: Implement**

```ts
// packages/web/src/lib/settingsSections.ts
/** Which settings sections a viewer can see. UX-only gate — the server enforces real authz. */
export type SettingsSectionId =
  | 'preferences' | 'sessions' | 'data-sources' | 'harnesses' | 'install' | 'live' | 'iam' | 'team' | 'repositories'

export interface SettingsSection { id: SettingsSectionId; labelEn: string; labelPt: string }
export interface SettingsViewer { central: boolean; role?: 'owner' | 'member'; isManager?: boolean }

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'preferences', labelEn: 'Preferences', labelPt: 'Preferências' },
  { id: 'sessions', labelEn: 'Sessions', labelPt: 'Sessões' },
  { id: 'data-sources', labelEn: 'Data & sources', labelPt: 'Dados & fontes' },
  { id: 'harnesses', labelEn: 'Harnesses', labelPt: 'Harnesses' },
  { id: 'install', labelEn: 'Install', labelPt: 'Instalação' },
  { id: 'live', labelEn: 'Live', labelPt: 'Ao vivo' },
  { id: 'iam', labelEn: 'IAM', labelPt: 'IAM' },
  { id: 'team', labelEn: 'Team', labelPt: 'Equipe' },
  { id: 'repositories', labelEn: 'GitHub Repositories', labelPt: 'Repositórios GitHub' },
]

export function visibleSettingsSections(v: SettingsViewer): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(s => {
    switch (s.id) {
      case 'live': return !v.central                       // solo/member only
      case 'iam': return v.central && (v.role === 'owner' || !!v.isManager)
      case 'team':
      case 'repositories': return v.central && v.role === 'owner'
      default: return true                                  // personal sections everywhere
    }
  })
}
```

- [ ] **Step 4: Run test → passes.** `bun tsc --noEmit` clean.
- [ ] **Step 5: Commit:** `git commit -m "feat(settings): visibleSettingsSections gating helper"`

---

### Task 3: Extract tab bodies into settings page components

**Files:**
- Create `packages/web/src/pages/settings/` : `PreferencesSettings.tsx`, `SessionsSettings.tsx`, `LiveSettings.tsx`, `InstallSettings.tsx`, `DataSourcesSettings.tsx`, `HarnessesSettings.tsx`, `TeamSettingsPage.tsx`, `ReposSettingsPage.tsx`
- Modify `packages/web/src/components/PreferencesModal.tsx` (source of the bodies to move)

**Approach:** READ `PreferencesModal.tsx` first. Each inline `function XxxTab(...)` (PreferencesTab:173, InstallTab:375, LiveTab:584, SessionsTab:672, DataSourcesTab:973, HarnessesTab:1032, TeamTab:1083) MOVES verbatim into its own page file, exported as the page component. For each, the props it currently receives from `PreferencesModal` state must now come from the `AppContext` outlet (`const ctx = useOutletContext<AppContext>()`) or a local fetch:
- `SessionsTab`, `HarnessesTab`, `DataSourcesTab`: need only `pt` (+ `harnesses` for DataSources) → read `lang`/`data.harnesses` from ctx.
- `TeamTab`: needs `pt`, `central`, `presence` → ctx has `lang`, `isCentral`, `data.presence`.
- `LiveTab`: needs the live-toggle props → read from ctx (the live state already lives in App/ctx).
- `InstallTab`: needs `pwaPrompt`/`onPwaInstalled`/`onClose`/`central` → `onClose` is dropped (it's a page now); `central` from ctx; `pwaPrompt` from ctx if present, else keep the component's own detection.
- `PreferencesTab`: needs `draft`/`set`/`pt`/`previewSound`. Convert the modal's draft+Save/Cancel model to a **page-local draft** with a Save/Reset button row at the bottom of the page that persists via the same `/api/preferences` PUT the modal used (reuse the existing save function — move it alongside).
- `TeamSettingsPage`/`ReposSettingsPage`: thin wrappers that render the existing `TeamSettings`/`TeamRepos` components with ctx-derived props (these are already standalone components — just host them).

Each page component is wrapped by the shared `SettingsPage` (Task 4) via the router, so it renders only its body (title comes from the route/section). Keep each moved body's internal logic identical; only change how props arrive.

> This is a mechanical extraction: do it one body at a time, `bun tsc --noEmit` after each, so type errors localize. Do NOT delete `PreferencesModal.tsx` yet (Task 6 does, after routing is wired).

- [ ] **Step 1:** Extract `SessionsSettings`, `HarnessesSettings`, `DataSourcesSettings` (props: just pt/harnesses from ctx). tsc clean.
- [ ] **Step 2:** Extract `LiveSettings`, `InstallSettings`, `TeamSettingsPage`, `ReposSettingsPage` (ctx-derived props; drop `onClose`). tsc clean.
- [ ] **Step 3:** Extract `PreferencesSettings` with a page-local draft + Save/Reset row reusing the existing preferences PUT. tsc clean.
- [ ] **Step 4:** `bun test` green.
- [ ] **Step 5:** Commit: `git commit -m "refactor(settings): extract modal tab bodies into settings page components"`

---

### Task 4: `SettingsPage` wrapper + routing

**Files:**
- Create `packages/web/src/pages/settings/SettingsPage.tsx`
- Modify `packages/web/src/AppRouter.tsx`

- [ ] **Step 1: `SettingsPage.tsx`** — a minimal wrapper: reads the section from the route, renders a page title (section label) + the section body. Also guards: if the section isn't in `visibleSettingsSections(viewer)`, redirect to `/settings/preferences`.

```tsx
// packages/web/src/pages/settings/SettingsPage.tsx
import React from 'react'
import { Outlet } from 'react-router-dom'

/** Shell for /settings/* — the aside carries the section nav; this just frames the body. */
export default function SettingsPage() {
  return (
    <div style={{ maxWidth: 900 }}>
      <Outlet />
    </div>
  )
}
```
(Each child route renders its own titled body; the guard/redirect for inaccessible sections is handled per-page or by the SideNav only listing accessible items — keep it simple: SideNav lists only accessible sections, and each central-only page still relies on the server 401/403 if hit directly.)

- [ ] **Step 2: Wire routes in `AppRouter.tsx`** — add lazy imports for each settings page and a nested route group:
```tsx
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'))
const PreferencesSettings = lazy(() => import('./pages/settings/PreferencesSettings'))
const SessionsSettings = lazy(() => import('./pages/settings/SessionsSettings'))
const DataSourcesSettings = lazy(() => import('./pages/settings/DataSourcesSettings'))
const HarnessesSettings = lazy(() => import('./pages/settings/HarnessesSettings'))
const InstallSettings = lazy(() => import('./pages/settings/InstallSettings'))
const LiveSettings = lazy(() => import('./pages/settings/LiveSettings'))
const IamSettings = lazy(() => import('./pages/settings/IamSettings'))
const TeamSettingsPage = lazy(() => import('./pages/settings/TeamSettingsPage'))
const ReposSettingsPage = lazy(() => import('./pages/settings/ReposSettingsPage'))
```
Inside `<Route element={<AppLayout />}>` add:
```tsx
<Route path="settings" element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>}>
  <Route index element={<Navigate to="preferences" replace />} />
  <Route path="preferences" element={<Suspense fallback={<PageFallback />}><PreferencesSettings /></Suspense>} />
  <Route path="sessions" element={<Suspense fallback={<PageFallback />}><SessionsSettings /></Suspense>} />
  <Route path="data-sources" element={<Suspense fallback={<PageFallback />}><DataSourcesSettings /></Suspense>} />
  <Route path="harnesses" element={<Suspense fallback={<PageFallback />}><HarnessesSettings /></Suspense>} />
  <Route path="install" element={<Suspense fallback={<PageFallback />}><InstallSettings /></Suspense>} />
  <Route path="live" element={<Suspense fallback={<PageFallback />}><LiveSettings /></Suspense>} />
  <Route path="iam" element={<Suspense fallback={<PageFallback />}><IamSettings /></Suspense>} />
  <Route path="team" element={<Suspense fallback={<PageFallback />}><TeamSettingsPage /></Suspense>} />
  <Route path="repositories" element={<Suspense fallback={<PageFallback />}><ReposSettingsPage /></Suspense>} />
</Route>
```
Add `Navigate` to the `react-router-dom` import. (`IamSettings` is created in Task 7 — until then, temporarily point `iam` at a placeholder or create Task 7 before this route; to keep tsc green, do Task 7 before Task 4, or stub `IamSettings` as re-export of the existing `IamTab`. Recommended: reorder so Task 7 lands before this route is added, OR have `IamSettings` initially `export { IamTab as default }`.)

- [ ] **Step 3:** `bun tsc --noEmit` clean; `bun test` green.
- [ ] **Step 4:** Commit: `git commit -m "feat(settings): /settings/* nested routes + page shell"`

---

### Task 5: SideNav "Settings" submenu (gated) + retire the modal trigger

**Files:** Modify `packages/web/src/App.tsx`

- [ ] **Step 1:** In `SideNav`, add a collapsible **"Settings"** group below the main nav items. Its sub-items = `visibleSettingsSections({ central: isCentral, role: principal?.role, isManager: principal?.memberships.some(m => m.role === 'manager') })` mapped to `NavLink`s to `/settings/<id>`. The group auto-expands when the current path starts with `/settings`. Highlight the active sub-item. Use the existing nav-item styling.
- [ ] **Step 2:** Change the footer gear/settings action from opening the modal to `navigate('/settings/preferences')` (or a `NavLink`). Remove the `showPrefsModal` state usage where it only drove the modal (keep `PreferencesModal` mounted for now if other code references it — Task 6 removes it). On mobile, the "More" sheet's Settings tile also navigates to `/settings/preferences`.
- [ ] **Step 3:** `bun tsc --noEmit` clean; `bun test` green.
- [ ] **Step 4:** Commit: `git commit -m "feat(settings): aside settings submenu (permission-gated)"`

---

### Task 6: Sidebar footer redesign + remove PreferencesModal

**Files:** Modify `packages/web/src/App.tsx`; delete `packages/web/src/components/PreferencesModal.tsx`

- [ ] **Step 1:** Redesign the `SideNav` footer into two tidy rows: (a) account block — avatar + name (ellipsized) + role label, logout right-aligned; (b) actions row — theme, language, export, settings gear — evenly spaced with consistent button sizing/padding. Fix the current cramped alignment. (The mockup: account row on top, a thin divider, then the icon actions row.)
- [ ] **Step 2:** Remove `PreferencesModal` entirely: delete the file, remove its import + `showPrefsModal` state + its `<PreferencesModal .../>` render in `App.tsx`. Ensure the moved tab bodies (Task 3) fully cover its functionality. Grep to confirm no remaining references: `grep -rn PreferencesModal packages/web/src`.
- [ ] **Step 3:** `bun tsc --noEmit` clean; `bun test` green.
- [ ] **Step 4:** Commit: `git commit -m "feat(settings): redesign sidebar footer, retire PreferencesModal"`

---

### Task 7: IAM page redesign (`IamSettings.tsx`)

**Files:** Create `packages/web/src/pages/settings/IamSettings.tsx` (replaces the cramped `IamTab`; delete `IamTab.tsx` once unused)

**Design:** one page, two sections with a short role legend at top. Accounts: a real table (Name · Email · Role · Teams · delete) + "New account" button opening a right-side **drawer** with the form (name/email/password/team/role). Teams: table (Name · delete, except default) + "New team" drawer. Reuse the same `/api/iam/teams` + `/api/iam/accounts` calls from `IamTab`.

- [ ] **Step 1:** Write `IamSettings.tsx` — port `IamTab`'s data loading + create/delete calls, but render:
  - A legend block: "Owner — full control · Manager — manages their team's users & tokens · User — scoped read".
  - **Accounts** section: `<table>` with header row + one row per account (role badge; teams as chips; a trash button hidden for `owner`). A "New account" button toggles a `Drawer`.
  - **Teams** section: table + "New team" button → drawer.
  - A reusable in-file `Drawer` (fixed right panel, backdrop, full-screen on mobile via `useIsMobile`) holding each create form (roomy fields, inline error).
  Keep it TS-strict, no `any`; reuse the fetch/error patterns from `IamTab`.
- [ ] **Step 2:** Point the `iam` route (Task 4) at `IamSettings` (if it was a stub, replace). Delete `packages/web/src/components/IamTab.tsx` and confirm no references: `grep -rn IamTab packages/web/src`.
- [ ] **Step 3:** `bun tsc --noEmit` clean; `bun test` green.
- [ ] **Step 4:** Commit: `git commit -m "feat(iam): redesigned IAM settings page (accounts + teams + drawers)"`

---

## Self-Review

**Spec coverage:** aside submenu → pages (Task 4+5); permission-gated items (Task 2 helper used in Task 5 + spec §2 table); IAM redesign with tables+drawers+legend (Task 7); sidebar footer (Task 6); PWA autoUpdate (Task 1); modal retired (Task 6). Reuse-by-extraction (Task 3) matches "reuse existing tab code".

**Placeholder scan:** none — full code for the new artifacts; extraction tasks reference the real in-repo bodies with exact line anchors + the props each needs.

**Ordering caveat (made explicit):** Task 4 routes reference `IamSettings` (Task 7). Resolve by stubbing `IamSettings` as `export { default } from '../../components/IamTab'`-style re-export when wiring Task 4, then replacing it in Task 7 — or run Task 7 before Task 4's `iam` route line. Either keeps tsc green.

**Type consistency:** `SettingsSectionId`/`SettingsSection`/`visibleSettingsSections` (Task 2) consumed by SideNav (Task 5). Route paths (`data-sources`, etc.) match `SettingsSectionId`. Page components' default exports match the lazy imports in Task 4.

**Non-goals honored:** no PATCH/edit, no change-password, no secondary sidebar, no backend change.
