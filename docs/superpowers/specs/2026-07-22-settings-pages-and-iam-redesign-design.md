# Settings-as-pages + IAM redesign + sidebar footer (design spec)

**Date:** 2026-07-22
**Roadmap item:** UI-1 (new; see `docs/superpowers/ROADMAP.md`). Follows B4 (governance/IAM).
**Scope:** Frontend only (no backend change — permissions already come from `/api/iam/me`).

Language: English (code/comments/commits/docs).

---

## 1. Problem

Three UX problems surfaced after B4 shipped:
1. The **Settings modal grew too large** (9 tabs: Preferences, Team, IAM, GitHub Repositories, Data & sources, Harnesses, Sessions, Install, Live). It should become **dedicated pages** reached from an aside menu.
2. The **IAM tab is confusing** — teams + accounts crammed into tiny inline forms; unclear what does what.
3. The **sidebar footer** (account + theme/lang/export/settings/logout cluster) is cramped and ugly.

Plus a recurring dev-pain: the **PWA service worker doesn't auto-update**, so new bundles don't take over until every tab closes (users kept seeing the old shared-password login).

---

## 2. Settings as pages (aside submenu — decision A)

- Add a **"Settings"** entry to `SideNav` that **expands inline** into a submenu of sections. Each sub-item is a `NavLink` to a dedicated route `/settings/:section`. The active section is highlighted; the group auto-expands when on a `/settings/*` route.
- **The Settings modal is retired.** The gear/settings action navigates to `/settings/preferences`. `PreferencesModal` is decomposed: each tab body becomes a routed page component. Bodies that are already standalone (`TeamSettings`, `TeamRepos`, `IamTab`→redesigned) are re-hosted; inline bodies (Preferences/Display, Install, Data & sources, Harnesses, Sessions, Live) are **extracted** into `packages/web/src/pages/settings/*` page components.
- **Routing:** nested routes under `/settings` in `AppRouter.tsx` inside the existing `AppLayout`. A minimal `SettingsPage` wrapper renders a section title + the section body (the aside carries the section nav, so no secondary sidebar).

### Permission/mode gating (which sub-items appear)
Derived from `/api/iam/me` (role + memberships) + the central/solo flag — **only accessible items render**:

| Section | Who sees it |
|---|---|
| Preferences, Sessions, Data & sources, Harnesses, Install | everyone |
| Live | solo/member only (hidden on central, as today) |
| IAM | central + **owner** or **manager** |
| Team, GitHub Repositories | central + **owner** only |

A user with no management role sees only the personal/read sections. Server routes already enforce the real authorization (Phase 3/5) — this gating is UX-only (don't show what you can't use).

---

## 3. IAM page redesign (`/settings/iam` — decision A)

One page, two clearly-designed sections with short role explanations at the top (owner = full control; manager = manages their team's users + tokens; user = scoped read):

- **Accounts** — a real table: Name · Email · Role · Team(s) · (delete). A **"New account"** button opens a **drawer** (slide-in panel, full-screen on mobile) with the form: name, email, password, team + role selectors. Manager sees only accounts in their teams and can create only `user`-role in their team; owner sees all.
- **Teams** — a table: Name · (members count if cheap) · (delete, except the default team). A **"New team"** button opens a drawer. Owner only.

No more cramped inline grids. Drawer pattern keeps the list clean and the form roomy. Errors surface inline in the drawer.

---

## 4. Sidebar footer redesign

Reorganize the current cramped cluster into a clean two-row block at the bottom of `SideNav`:
- **Account row:** avatar + name (ellipsized) + role label, with the **logout** button aligned right.
- **Actions row:** theme toggle, language, export, settings (gear → `/settings/preferences`) — evenly spaced, consistent sizing, adequate padding.

Keep it compact but legible; fix the alignment/sizing that makes the current cluster look broken.

---

## 5. PWA auto-update

In `packages/web/vite.config.ts`, set `VitePWA({ registerType: 'autoUpdate', workbox: { skipWaiting: true, clientsClaim: true }, ... })` so a new bundle takes control immediately on next load — no manual service-worker unregister. Keep `devOptions.enabled` as-is.

---

## 6. Architecture & reuse

- **Routing:** `AppRouter.tsx` gains `path: 'settings'` with child routes (`preferences`, `sessions`, `data-sources`, `harnesses`, `install`, `live`, `iam`, `team`, `repositories`) + an index redirect to `preferences`. All inside `AppLayout` (keeps the aside + outlet context).
- **SideNav:** a collapsible "Settings" group; its items are filtered by the `me`/central gating above.
- **Page components:** `packages/web/src/pages/settings/` — `PreferencesSettings.tsx`, `SessionsSettings.tsx`, `DataSourcesSettings.tsx`, `HarnessesSettings.tsx`, `InstallSettings.tsx`, `LiveSettings.tsx`, `IamSettings.tsx` (redesigned), plus reuse `TeamSettings`/`TeamRepos` as `TeamSettingsPage`/`ReposSettingsPage` bodies. Extract inline bodies from `PreferencesModal` with minimal changes (move JSX + wire the same props from outlet context).
- **`app-context.ts`:** the settings pages read what they need (lang, theme, currency, prefs setters, `me`) from the existing `AppContext` outlet — add fields only if a page needs state not already there.
- **Delete `PreferencesModal`** once all bodies are migrated (or keep as a thin re-export during migration, then remove). No backend change.

---

## 7. Non-goals (YAGNI)
- No account/team editing (PATCH) — still create/delete only (deferred from B4).
- No change-password UI yet.
- No secondary settings sidebar (decision A uses the main aside).
- No new backend endpoints.

## 8. Testing
- Pure functions: a `visibleSettingsSections(me, central)` helper (which sections a principal sees) — unit-tested (role × mode → list).
- Everything else is UI/layout — verified by the browser after a rebuild (no component test infra). `bun tsc --noEmit` + `bun test` stay green.
- iOS/mobile: the drawer + settings pages must be responsive (full-screen drawer on mobile, per existing mobile conventions).
