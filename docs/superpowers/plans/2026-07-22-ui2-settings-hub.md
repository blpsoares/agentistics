# UI-2 — Settings hub page (B) + governance reorg (Users/Teams/Machines)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the aside "Settings" submenu (UI-1's model A) with a dedicated **Settings hub page** (model B): the aside keeps only the gear button, which opens `/settings` — a full page with its own **grouped left menu** (Personal / Governance) + content. Reorganize the confusing governance area into distinct pages: **Users** (accounts), **Teams**, **Machines** (registered member machines/tokens), **Repositories**. Redesign these pages to be clean and clearly separated.

**Architecture:** `SettingsPage` becomes the settings **layout** (grouped nav + `<Outlet context={ctx}/>`). `settingsSections.ts` gains a `group` and the new ids (`users`, `teams`, `machines` replacing `iam`/`team`). `IamSettings` splits into `UsersSettings` + `TeamsSettings`; the old `TeamSettingsPage` (the TeamMembers/token panel) becomes `MachinesSettings`. The aside's expandable Settings group is removed; the gear + mobile tile navigate to `/settings`.

**Tech Stack:** React + Vite + react-router (web). Frontend only.

## Global Constraints

- English; TS strict, no `any`. Commit subjects lowercase.
- `SettingsPage` (and any nested layout) MUST forward context: `<Outlet context={useOutletContext<AppContext>()} />` (a bare `<Outlet/>` blank-screens children — this was the UI-1 bug).
- Gating stays UX-only; server enforces authz. Personal sections: everyone. Governance (central): `users`/`teams`/`machines` → owner or manager; `repositories` → owner; `live` → solo/member only.
- Reuse existing page bodies; MOVE/rename, don't rewrite behavior (except visual layout of governance pages).
- Responsive: the settings hub's left menu stacks/scrolls on mobile (`useIsMobile`).
- Run `bun tsc --noEmit` + `bun test` after each task.

---

### Task 1: `settingsSections.ts` v2 — groups + new ids

**Files:** Modify `packages/web/src/lib/settingsSections.ts` + `settingsSections.test.ts`

- [ ] **Step 1:** Rewrite to:
```ts
export type SettingsSectionId =
  | 'preferences' | 'sessions' | 'data-sources' | 'harnesses' | 'install' | 'live'
  | 'users' | 'teams' | 'machines' | 'repositories'
export type SettingsGroup = 'personal' | 'governance'
export interface SettingsSection { id: SettingsSectionId; labelEn: string; labelPt: string; group: SettingsGroup }
export interface SettingsViewer { central: boolean; role?: 'owner' | 'member'; isManager?: boolean }

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'preferences', labelEn: 'Preferences', labelPt: 'Preferências', group: 'personal' },
  { id: 'sessions', labelEn: 'Sessions', labelPt: 'Sessões', group: 'personal' },
  { id: 'data-sources', labelEn: 'Data & sources', labelPt: 'Dados & fontes', group: 'personal' },
  { id: 'harnesses', labelEn: 'Harnesses', labelPt: 'Harnesses', group: 'personal' },
  { id: 'install', labelEn: 'Install', labelPt: 'Instalação', group: 'personal' },
  { id: 'live', labelEn: 'Live', labelPt: 'Ao vivo', group: 'personal' },
  { id: 'users', labelEn: 'Users', labelPt: 'Usuários', group: 'governance' },
  { id: 'teams', labelEn: 'Teams', labelPt: 'Times', group: 'governance' },
  { id: 'machines', labelEn: 'Machines', labelPt: 'Máquinas', group: 'governance' },
  { id: 'repositories', labelEn: 'GitHub Repositories', labelPt: 'Repositórios GitHub', group: 'governance' },
]

export function visibleSettingsSections(v: SettingsViewer): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(s => {
    switch (s.id) {
      case 'live': return !v.central
      case 'users':
      case 'teams':
      case 'machines': return v.central && (v.role === 'owner' || !!v.isManager)
      case 'repositories': return v.central && v.role === 'owner'
      default: return true
    }
  })
}
```
- [ ] **Step 2:** Update `settingsSections.test.ts` to the new ids/groups:
  - solo/member → `['preferences','sessions','data-sources','harnesses','install','live']`
  - central owner → `['preferences','sessions','data-sources','harnesses','install','users','teams','machines','repositories']`
  - central manager → `['preferences','sessions','data-sources','harnesses','install','users','teams','machines']`
  - central plain user → `['preferences','sessions','data-sources','harnesses','install']`
  Also assert every section has a `group`.
- [ ] **Step 3:** `bun test packages/web/src/lib/settingsSections.test.ts` green; `bun tsc --noEmit` (will error in files referencing old ids — fixed in later tasks; acceptable to run tsc after Task 4). Commit: `feat(settings): group sections + users/teams/machines ids`

---

### Task 2: split governance pages (Users / Teams / Machines) + routes

**Files:**
- Create `packages/web/src/pages/settings/UsersSettings.tsx`, `packages/web/src/pages/settings/TeamsSettings.tsx`
- Rename/repurpose `packages/web/src/pages/settings/TeamSettingsPage.tsx` → `packages/web/src/pages/settings/MachinesSettings.tsx`
- Delete `packages/web/src/pages/settings/IamSettings.tsx`
- Modify `packages/web/src/AppRouter.tsx`

- [ ] **Step 1:** READ `IamSettings.tsx` (the current accounts+teams page with tables/drawers). Split it:
  - `UsersSettings.tsx` — the **Accounts** half (role legend + accounts table + "New account" drawer). Keep the /api/iam/accounts calls. Title "Users / Usuários".
  - `TeamsSettings.tsx` — the **Teams** half (teams table + "New team" drawer). Keep /api/iam/teams. Title "Teams / Times". Consider showing, per team, a member/machine count if cheap (optional).
  Both default-exported, `pt` from `useOutletContext<AppContext>().lang`. Reuse the in-file `Drawer` (copy it into a shared `packages/web/src/pages/settings/Drawer.tsx` and import in both, to avoid duplication).
- [ ] **Step 2:** READ `TeamSettingsPage.tsx` (renders the TeamMembers/token panel). Rename the file to `MachinesSettings.tsx`, default export `MachinesSettings`. Update its heading/description to "Machines / Máquinas — registered member machines (tokens, presence)". Keep the underlying `TeamMembers` component + props.
- [ ] **Step 3:** Delete `IamSettings.tsx`. `grep -rn IamSettings packages/web/src` must be empty after route updates.
- [ ] **Step 4:** In `AppRouter.tsx`: replace the `iam`/`team` child routes with `users`, `teams`, `machines`; keep `repositories`. Lazy-import the new pages. Update the `index` redirect target to `preferences`. (Old `/settings/iam` + `/settings/team` paths are dropped — no legacy redirect needed.)
- [ ] **Step 5:** `bun tsc --noEmit` clean; `bun test` green. Commit: `feat(settings): split governance into users/teams/machines pages`

---

### Task 3: `SettingsPage` becomes the hub layout (grouped internal nav)

**Files:** Modify `packages/web/src/pages/settings/SettingsPage.tsx`

- [ ] **Step 1:** Rebuild `SettingsPage` as a two-column layout (stacks on mobile):
  - Reads `const ctx = useOutletContext<AppContext>()`; derives `viewer = { central: ctx.isCentral, role: ctx.me?.role, isManager: ... }` from whatever the context exposes about the logged-in account (READ `app-context.ts`; if `me`/principal isn't on the context, thread it — App.tsx already has `iam.account`; add `me` to the outlet context value if missing and provide it).
  - Left column: the section menu built from `visibleSettingsSections(viewer)`, **grouped** with group headers ("Personal"/"Pessoal", "Governance"/"Governança"). Each item is a `NavLink` to `/settings/<id>` with active highlight. On mobile, render the menu as a horizontal scroll strip or a stacked block above the content.
  - Right column: `<Outlet context={ctx} />` (MUST forward context).
  - Add a page header ("Settings/Configurações") at the top.
- [ ] **Step 2:** `bun tsc --noEmit` clean; `bun test` green. Commit: `feat(settings): settings hub page with grouped internal nav`

---

### Task 4: remove the aside Settings submenu; gear → /settings

**Files:** Modify `packages/web/src/App.tsx`

- [ ] **Step 1:** In `SideNav`, REMOVE the collapsible "Settings" group (the `settingsSections`/`settingsOpen`/`settingsExpanded`/`inSettings` block and its rendered sub-items, ~lines 863-990). Remove now-unused `visibleSettingsSections` import + related state if nothing else uses them in SideNav.
- [ ] **Step 2:** Keep a single **Settings gear** entry/button in the aside that navigates to `/settings` (NavLink or navigate). Ensure the footer gear (from UI-1) and the mobile "More"/tiles Settings action also go to `/settings` (not `/settings/preferences`). The `/settings` index route redirects to `preferences`.
- [ ] **Step 3:** `bun tsc --noEmit` clean; `bun test` green. Commit: `feat(settings): aside keeps only a gear opening the settings hub`

---

## Self-Review

**Spec coverage:** aside submenu removed, gear → hub page (Task 4 + 3); grouped internal nav (Task 3); governance split into Users/Teams/Machines + Repositories (Task 2); section grouping + gating (Task 1). Machines clearly separated from Teams/Users (the user's core ask).

**Placeholder scan:** none — full code for the pure helper; page tasks reference real in-repo bodies (IamSettings, TeamSettingsPage) to split/rename with exact new names.

**Ordering:** Task 1 changes ids that Tasks 2-4 consume; tsc may be red between Task 1 and Task 4 (old ids referenced) — that's expected; final tsc must be clean after Task 4. Each task still commits (a transient red tsc mid-sequence is fine as long as the task's own step verifies what it can and the final state is green + tested).

**Context-forward invariant:** SettingsPage forwards outlet context (Task 3) — do not regress the UI-1 blank-page fix.

**Non-goals:** account/team PATCH, change-password, per-machine team reassignment UI — deferred.
