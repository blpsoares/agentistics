# Agentistics — Multi-Feature Roadmap

> **Purpose of this file:** This is a large, multi-subsystem initiative that will span several
> sessions. This file is the durable source of truth so any future session (the coordinating
> Claude) can pick up with full context. **Update the status boxes and "Session log" as work
> progresses.** Each big item gets its own spec under `docs/superpowers/specs/` and its own
> plan — link them here as they're created.

Language: everything in this project is English (code/comments/commits/docs). This roadmap is
English by project convention; conversation with the user is Portuguese.

---

## Status legend

- ⬜ Not started
- 🟨 In design (brainstorming / spec being written)
- 🟦 Planned (spec approved, implementation plan written)
- 🟩 In progress (implementing)
- ✅ Done (merged / verified)

---

## The 7 work items

### Group A — UI fixes (small, high-value, low-risk)

#### A1 — Repositories aside/list shows machine path on central ✅
- **Problem:** In the repositories aside/list, on the **central**, a machine filesystem path
  (e.g. `/home/reksai/eletro/ads-propostas`) is shown. A repo-level view must be keyed by git
  remote, not by a local path — the path is meaningless on the central (it belongs to one machine).
- **Nuance:** On a **machine** (solo/member), showing the path in the repo view still makes sense —
  the same repo can be cloned at multiple local paths. So the fix is **mode-aware**: hide/replace
  the path only when `team.mode === 'central'`.
- **Decision:** on central, **omit the path line** (title already shows `org/repo`; no replacement).
- **Spec:** [2026-07-22-group-a-ui-fixes-design.md](specs/2026-07-22-group-a-ui-fixes-design.md)

#### A2 — Central member data view: responsive + desktop UI overhaul ✅
- **Problem:** On the central, the member-data visualization is broken on mobile (not responsive)
  and cramped/ugly on desktop.
- **Scope:** Both views — `TeamMembers.tsx` (Settings → Team) and `MembersTable` in
  `RepoDetailPage.tsx`. Responsive layout (use `useIsMobile()` + existing mobile conventions),
  better desktop density/spacing, fix overflowing action buttons.
- **Spec:** [2026-07-22-group-a-ui-fixes-design.md](specs/2026-07-22-group-a-ui-fixes-design.md)

#### A3 — Dynamic Workflows aside missing context fields ✅
- **Problem:** The Dynamic Workflows view lacks: session **title**, **project**, and **repository**
  (when a repo is linked).
- **Scope:** Both views (`WorkflowsPage` at `/workflows` + RepoDetailPage Dynamic Workflows tab).
  Join to `SessionMeta` via `sessionById.get(run.sessionId)` and render title (`sessionLabel()`),
  project (`formatProjectName`), repo (`repoShortName`). Omit the repo line when unlinked; on
  RepoDetailPage omit repo entirely (redundant — page is repo-scoped).
- **Spec:** [2026-07-22-group-a-ui-fixes-design.md](specs/2026-07-22-group-a-ui-fixes-design.md)

### Group C — UI/UX follow-ups (post-B4)

#### UI-1 — Settings as pages + IAM redesign + sidebar footer ✅
- **Problem:** the Settings modal grew too large (9 tabs); IAM tab confusing; sidebar footer cramped; PWA doesn't auto-update (stale-bundle pain).
- **Decisions:** aside "Settings" with inline expandable submenu → dedicated `/settings/:section` pages (decision A), showing only sections the account can access; IAM as one page with Accounts + Teams sections + drawer forms + role explanations (decision A); sidebar footer redesign; PWA `registerType: 'autoUpdate'` (skipWaiting/clientsClaim). Frontend only.
- **Spec:** [2026-07-22-settings-pages-and-iam-redesign-design.md](specs/2026-07-22-settings-pages-and-iam-redesign-design.md)
- **Plan:** [plans/2026-07-22-ui1-settings-pages.md](plans/2026-07-22-ui1-settings-pages.md) — ✅ **implemented** (commits `4cb50f8`..`f127f2c` on `dev`; tsc clean, 344 tests; all reviews clean): PWA autoUpdate (skipWaiting+clientsClaim), `visibleSettingsSections` helper, 8 settings pages extracted from the modal, `/settings/*` routes + shell, gated aside submenu, redesigned sidebar footer, `PreferencesModal` retired, redesigned IAM page (Accounts+Teams tables + drawers). **Deferred:** client-side guard on directly-typed inaccessible `/settings/*` URLs (server 401/403 covers it); account role badge shows first membership; account/team edit (PATCH).

#### UI-2 — Settings hub page (B) + governance reorg (Users/Teams/Machines) ✅
- **Problem:** UI-1's aside submenu (model A) was bad; governance area confused Teams/Users/Machines.
- **Decisions:** aside keeps only a gear → `/settings` **hub page** with grouped internal nav (Personal / Governance); governance split into **Users** (accounts), **Teams**, **Machines** (registered member tokens/presence), **Repositories**; account creation gained an **owner** option (gated to owner callers) + **multi-team manager scope** editor.
- **Plan:** [plans/2026-07-22-ui2-settings-hub.md](plans/2026-07-22-ui2-settings-hub.md) — ✅ **implemented** (commits `0e108ff`..`a14c9ec` on `dev`; tsc clean, 345 tests; reviews clean, no privilege-escalation). Also fixed the UI-1 blank-settings-page bug (`SettingsPage` must forward outlet context — commit `<hubfix>`). **Deferred:** hide `manager` role option from non-owner viewers (server already 403s); account/team PATCH.

#### C3 — Filters: Teams / Members / Machines (machine-aware) ✅
- **Implemented** (commits `25c5bbd` backend + `defbef3` frontend on `dev`; tsc clean, 357 tests, build ok):
  `Filters` gained `teams?[]`/`machines?[]`; `SessionMeta` gained `memberId` (machine token hash,
  re-attached at central read time); pure `filterByTeams`/`filterByMachines` in core (unit-tested);
  App fetches `/api/iam/teams`+`/api/iam/machines` (central) → `FiltersBar` + `AppContext`; the
  **Members filter lists only users with ≥1 machine** and shows each user's machine names; Machines
  picker shows machine names + owner; `useDerivedStats` + `computeFilteredHarnessSummaries` apply both.
- **(original spec kept below for reference)**

<details><summary>original C3 spec</summary>
- **What (central filter bar):** add filter dimensions:
  - **Teams** — filter by team.
  - **Members** — a member = a **user**; selecting a member filters by **that user's machines**, and the
    filter UI **lists which machines belong to the user** (so you see/pick the user's machines).
  - **Machines** — filter by individual machine (the picker shows **machine names**).
- **User filter only lists users that have ≥1 machine linked.** Loose accounts with no machines are
  access/view-only (they never produce sessions) → excluded from the member/user filter.
- **Depends on:** the machine↔account model (`accountIds[]`) + per-session `memberId`/user already in place.
  Likely touches `FiltersBar`, `useDerivedStats`/`Filters`, and the `/api/data` scoping.
- **Spec:** _(write next session)_
</details>

#### C5 — Move Dynamic Workflows into the session drilldown ✅
- **Implemented** (commit `b4e6ffb` on `dev`): removed the "Dynamic Workflows" item from the aside +
  the mobile "More" tile; added a **Dynamic Workflows (N)** section inside `SessionDrilldownModal`
  showing only that session's runs (phase→agents timeline). The `/workflows` route +
  RepoDetailPage tab remain. *(Leftover: unused `hasWorkflows` prop / `WorkflowIcon` import in App.tsx
  — harmless; clean up next pass.)*

#### C6 — Flexible machine linkage + manager direct grants 🟨
- **#1 flexible machine linkage — ✅ done** (commit `d5dbd3c` on `dev`): a machine can be added
  **loose** (no owner, no team), **team-only**, **owner(s)-only**, or **team + owner(s)** — owner
  and team are independent + optional (only the name is required). Backend `mintMachine` (no forced
  team/owner) + scope rule (owner: any combo; manager: must pick a team they manage). Add-machine
  drawer made owner/team optional.
- **#2 manager direct grants — 🟨 spec'd, build next session (with security review).**
  `managedMachineIds[]` + `managedAccountIds[]` on the account (Option A) so a manager can be granted
  standalone machines/users beyond their teams. Touches `iam-view` (accountVisibleTo/canManageMachine),
  `getPrincipal`, **data scoping** (`team-scope`), the account form, PATCH (owner-only edits).
  **Spec:** [2026-07-23-manager-direct-grants-design.md](specs/2026-07-23-manager-direct-grants-design.md).
  Adds a SECOND authz axis → must land after the pending whole-branch security review, with tests.

#### C7 — Governance detail views + team add-user-suggests-machines ⬜
- **Auto-suggest machines when adding a user to a team** (Teams → Manage → Add member): on picking a
  user, offer (checkbox) to **also add that user's machines to the team**; on confirm, reassign those
  machines' `teamId` to the team (POST `/api/iam/machines {reassignId, teamId}` per machine). The
  team's **Add machine** picker must **exclude machines already in the team** (`m.teamId !== teamId`).
- **Row → detail view** on Users / Teams / Machines: clicking a row opens a detail (modal or the
  existing drawer, enriched) showing everything — a **user**: role/permission, teams, linked machines;
  a **team**: members + machines; a **machine**: owners, team, presence, tokens. Much of this already
  exists as the Teams "Manage" drawer + Users edit drawer + Machines edit drawer — mostly make rows
  clickable + enrich, rather than build new modals.
- **Recommendation:** build next session with the pending security review (touches the same
  Teams/Users/Machines authz surface). Bounded part (#auto-suggest) could ship first.

#### C4 — Dedicated mobile UI (ULTRA IMPORTANT) ⬜
- **Problem:** after heavy desktop UI work (settings pages, governance/Users/Teams/Machines drawers,
  Select/Checkbox primitives, machine edit drawer, member sidebar status, filters), the **mobile
  experience needs a dedicated pass** to keep UI/UX quality. Governance drawers, tables, the new
  Select popover, and the filter bar must all be verified/reworked on small screens.
- **Follow the existing mobile conventions** (CLAUDE.md): `useIsMobile()` (768px), `MobileBottomNav`
  + "More" sheet, full-screen modals/drawers on mobile, `overflow-x: clip` iOS fix, collapsible
  `FiltersBar`. Audit every governance/settings surface added during B4-EXT for mobile.
- **Spec:** _(write next session)_

#### B4-EXT — Accounts ↔ Machines governance + first-login password ✅
- **What:** machines owned by accounts (token gains `accountId`+machineName); create account with/without a machine; random password + **forced first-login change** (`mustChangePassword` + `POST /api/iam/change-password`); **1 account : N machines**; owner registers machines for any account & grants managers visibility via team memberships (**account PATCH/edit**); Machines page becomes a **scoped view**; `whoami` extended so the machine shows its identity; **Central connection** settings section restored on solo/member (regression fix `87f6671`).
- **Handshake:** bearer machine token (sha256-hashed server-side) → `GET /api/team/whoami` verifies + returns `{user,machineName,email,teamId}`; server-authoritative attribution.
- **Spec:** [2026-07-23-accounts-machines-governance-design.md](specs/2026-07-23-accounts-machines-governance-design.md)
- **Phases:**
  1. **Backend core** — ✅ **implemented** (commits `f13619a`..`ab4a81b` on `dev`; tsc clean, 346 tests; whole-branch review READY TO MERGE, 1 Important authz gap fixed): [plans/2026-07-23-b4ext-phase1-backend.md](plans/2026-07-23-b4ext-phase1-backend.md) — token `accountId` + `mintMachineToken`/`listMachines` + `canManageMachineTeam`; `/api/iam/machines` (scoped list + gated add-to-account); `mustChangePassword` + `/api/iam/change-password` (cookie re-issue); `PATCH /api/iam/accounts` (edit memberships/reset, no manager escalation); account create-with-machine; `whoami` returns machineName/email/teamId. Routes smoke-verified (401 self-guarded). *(Authed end-to-end still needs an owner session — test via the Phase 2/3 UI.)*
  2. **Frontend accounts** — ✅ **implemented** (commits `8f2ba04`..`9867d4c` on `dev`; tsc clean, 351 tests, Vite build ok; whole-branch review READY TO MERGE, security-lens, 0 blocking): [plans/2026-07-23-b4ext-phase2-frontend-accounts.md](plans/2026-07-23-b4ext-phase2-frontend-accounts.md) — `generatePassword` helper (unbiased, rejection-sampled); `mustChangePassword` threaded through `Principal`/`IamAccount`; blocking first-login `ChangePassword` screen wired into the App gate (bootstrap→login→**mustChange**→app); create-account drawer extended with provision-a-machine toggle + generate-random-password + require-change checkbox + shown-once result panel (email/password/machine token + `agentop member connect` command, HTTP-safe copy w/ fallback); edit-account drawer (rename/memberships/reset-password → temp shown once) via `PATCH`. Accepted-by-design: result panel shows on every create; one-time secrets rendered as plain text (with "won't be shown again" warning). *(UI verified via tsc/tests/build; authed E2E on the real central pending.)*
  3. **Frontend machines** — ✅ **implemented** (commit `ff12bcf` on `dev`; tsc/tests/build ok): central `MachinesSettings` now branches on `isCentral` — the central shows a governance view (machines grouped by owning account + team/last-seen) with an **Add machine** drawer (account picker + name + optional team → `POST /api/iam/machines` → shown-once token + `agentop member connect` command, HTTP-safe copy, no-close-while-secret guard); solo/member keeps the existing connection component. *(Rotate/revoke deferred.)*
  4. **Machine client** — ✅ **implemented** (commit `4791488` on `dev`; tsc/tests/build ok): `whoami` now also returns the team **name**; `test-connection` propagates `machineName/email/team`; the solo/member **Central connection** UI shows a "Connected as" panel (machine · email · team · user) after the handshake, resolved on mount + on Save. Token sub-copy updated to the per-machine minted-token model.

- **Post-E2E feedback (2026-07-23, commits `70e19b4`..`83eb1c7`):** fixed a shown-once-secret data-loss bug (drawers no longer close on backdrop/X while a token/temp-password is visible; connect command gained a copy button built from the real origin). Added a new **`admin`** account role (global, one tier below owner): hierarchy owner > admin > manager > user; owner may now delete other owners **with last-owner protection** (`countOwners()`); admin deletes members only; only owner mints owner/admin (`canAssignRole`); full-stack (iam-view/handlers + Users UI badge/selector/legend/`canDeleteClient`+`canEditClient` mirrors + admins get governance-page access). Central **auto-detects external `MONGO_URL`** (Atlas): local Mongo is now an opt-in `docker-compose.localdb.yml` overlay that `central.sh` includes only for the bundled DB; `MONGO_URL` trimmed in config.ts (stray-space fix). Whole-branch security review READY TO MERGE (0 Critical/Important).

- **Feedback waves 2–4 (2026-07-23, commits `f584664`..`61ca59e`..`c7a79dd`):** **`admin` role REVERTED** — back to owner + team-scoped manager/user (spec `2026-07-23-b4ext-phase5-account-form-roles.md`); kept owner-deletes-owner + last-owner guard. Account form redesigned (styled `Select`/`Checkbox` primitives; sectioned drawers). **Machines page** completed: lists ALL machine tokens (not only account-bound), owner/user/team/presence, **rename / rotate / revoke / bulk-delete / add-multiple-machines / reassign team**; **machines can have multiple owner accounts** (`accountIds[]`) edited via a side drawer; owner accounts hidden from owner pickers. **Central public URL** config → **embedded in minted tokens** (`packConnectToken`/`unpackConnectToken` in core) so a machine auto-fills the endpoint on paste; connect command comes ready (no `--endpoint` when embedded); `cli-member` unpacks. **Deleted-machine correctness:** a bootstrapped central always requires a token (open-ingest fallback gated on `!hasAnyOwner`) → a deleted machine's next push 401s → member auto-resets to solo; central hides orphaned team data (sessions/stats/workflows) from revoked tokens at read time (`getLiveTokenIds`). **Machine rename** pushes a WS notification to the machine (with the actor). `agentop restart --rebuild` now rebuilds the **native** server (`bun run bin`) not just Docker. Users page shows **totals per role + machines-per-user**. Member machine shows **connection status + latency-to-central** in the sidebar aside. Machine identity (`whoami`) returns `machineName` for every token. `cli` npm script added. tsc clean, 355 tests, build ok.
- **B4-EXT deferred / next-session:** (1) **whole-branch security review of the latest batch** (`bc59c19..c7a79dd`+ — multi-owner, composite token, ingest gating, WS rename, sidebar status — not yet reviewed); (2) last-owner DELETE TOCTOU race; (3) optional **Atlas orphan-doc cleanup** (read-time filter already hides them); (4) **merge `dev` → `main`** (nothing merged yet); (5) authed E2E on the real central. *(Machine IP capture: dropped per owner.)*

### Group B — Large subsystems (each is its own project)

#### B4 — Governance / IAM (the foundation) 🟨
- **Roles:** `owner`, `gestor` (manager), `users`.
  - **owner:** all permissions + create/update/delete **teams** (team creation can aggregate repos
    from machines, and machines/users), delete/add machines, update tokens.
  - **gestor:** manage/view only their own team — revoke a machine/user from their team, create
    "visualization tags".
  - **users:** scoped view/actions per their account permissions.
- **Auth:** email + password, stored in DB with proper security (hashing/encryption, e.g. argon2/bcrypt).
- **First boot:** when a central is brought up for the first time, prompt owner account creation
  (name, email, password, confirm password).
- **UI:** all permission management lives in an **IAM tab/menu**. Logged-in user + their permission
  shown somewhere on screen. Every action/view gated by the logged-in account's permissions.
- **Note:** This replaces/extends the current central password-only login. It's the foundation —
  B5 (tags) and B7 (member metrics) should respect roles/teams.
- **Decisions:** Teams = unit of division/visibility (members/repos gain `teamId`, seeded
  "Default team"). Roles: owner (global) / manager / user (team-scoped `memberships`). Security:
  argon2id, session cookie carries `accountId+sessionVersion`, permissions resolved from DB
  (instant revocation), rate-limited login. Shared password **removed** once an owner exists.
  Bootstrap: **one-time setup token printed to central logs** (primary) + `agentop central owner`
  CLI (shortcut); same flow covers fresh + already-running centrals; ingest never blocked. Manager
  can create `user` accounts within their team.
- **Spec:** [2026-07-22-governance-iam-design.md](specs/2026-07-22-governance-iam-design.md)
- **Implementation is split into 5 per-phase plans** (each testable on its own):
  1. **Core (data + security)** — ✅ **implemented** (commits `2628d44`..`bec226e` on `dev`; tsc clean, 328 tests pass; whole-branch review READY TO MERGE, 0 Critical/Important): [plans/2026-07-22-b4-phase1-iam-core.md](plans/2026-07-22-b4-phase1-iam-core.md) — passwords (Bun.password argon2id), IAM types, capability matrix, principal session, accounts/teams collections, `getPrincipal`. Additive/non-breaking.
  2. **Bootstrap** — ✅ **implemented** (commits `86d94fc`..`68efba37` on `dev`; tsc clean, 332 tests pass; all reviews clean; integration-verified on the real central: token printed to logs, `GET /api/iam/status` → needsBootstrap:true): [plans/2026-07-22-b4-phase2-bootstrap.md](plans/2026-07-22-b4-phase2-bootstrap.md) — `bootstrap.ts`, `iam-handlers.ts`, `teamId` on tokens/repos + seed/backfill, boot token log, `GET /api/iam/status`, `POST /api/iam/bootstrap`. Carry-over from Ph1 review (`ensureAccountIndexes` + `DEFAULT_TEAM_ID` seed at boot) — **done**. **Deferred:** `agentop central owner` CLI reissue shortcut (needs `docker compose exec` plumbing) — until then, the setup token is only re-shown while no owner exists on a fresh boot; losing it before creating the owner needs a DB reset.
  3. **IAM API** — ✅ **implemented** (commits `49e30b1`..`b640b59` on `dev`; tsc clean, 337 tests; all reviews clean; whole-branch READY TO MERGE): [plans/2026-07-22-b4-phase3-iam-api.md](plans/2026-07-22-b4-phase3-iam-api.md) — `iam-view.ts` (pure publicAccount + capability helpers), login/me handlers, accounts/teams CRUD (role-enforced), routes wired. `passwordHash` stripped via `publicAccount` everywhere (carry-over done). **Deferred:** account PATCH/edit; login dummy-verify on unknown email (minor timing enumeration).
  4. **Data scoping** — ✅ **implemented** (commits `c6199ff`..`2e78b05` on `dev`; tsc clean, 340 tests; reviews clean): [plans/2026-07-22-b4-phase4-scoping.md](plans/2026-07-22-b4-phase4-scoping.md) — `teamId` tagged onto central sessions at read time (`getMemberTeamMap`), pure `scopeAppDataToTeams` + `visibleTeamIdsOf`, applied in `/api/data` for non-owner principals (owner + legacy sessions → passthrough). **Deferred:** scoping the ADMIN `/api/team/members` list (done when the members panel goes role-aware in Ph5).
  5. **Frontend + gate flip** — ✅ **implemented** (commits `b9913c6`..`04fb59c` on `dev`; tsc clean, 340 tests; reviews clean incl. dedicated flip review; **E2E-verified on the real central**): [plans/2026-07-22-b4-phase5-frontend.md](plans/2026-07-22-b4-phase5-frontend.md) — `Login`/`OwnerSetup` screens, App gate (bootstrap→login→app), SideNav account+role+logout, IAM tab (teams+accounts), and the server gate flipped to account-principal auth (anti-lockout: health + iam/* public; legacy `/api/team/login`→410). **Deferred polish:** account/team PATCH, member-panel team scoping, migrate `/api/team/session` consumers then retire `handleSession`, login dummy-verify.

**✅ B4 GOVERNANCE/IAM FULLY IMPLEMENTED (phases 1-5).** E2E proven: bootstrap→cookie→me(no hash)→/api/data 200→CRUD; owner sees all, non-owner scoped (Ph4). A temp owner `e2e-owner@test.local` was created during verification (consumed the one-time token) — reset the `accounts`+`config.bootstrap` docs to re-run first-boot OwnerSetup.

#### B5 — Tags (aggregate project metrics) ⬜
- **Problem:** Create tags that aggregate metrics across "projects". A "project" can be:
  - a **repository** — when created on the central, selecting a repo pulls metrics from **all
    machines that have members on that repo**;
  - an **individual folder** (path) — can also be added to a tag.
- **Storage:** tags saved in DB.
- **Depends on:** B4 (gestor can create visualization tags; scoping by team).
- **Spec:** _(link when written)_

#### B6 — Smart auto-update (critical vs optional) ⬜
- **Problem:** Some updates are "critical" — the user shouldn't have to run update commands.
  - **Critical update** (inferred from a **tag on the remote** that the installed CLI can detect):
    auto-install **without consent**, then **auto-restart** the running agentop services (rebuild
    containers where applicable), **non-blocking** (must not hold the user's terminal), and log a
    message telling the user it was updated.
  - **Optional update:** keep current behavior — inform the user, let them decide.
- **Also:** whenever the user runs a CLI update, services must auto-restart on the new version;
  containers must be **rebuilt** (otherwise they keep running the old image).
- **Independent:** can be built in parallel with anything else.
- **Touches:** `server/version.ts`, `server/upgrade.ts`, `server/autostart.ts`, `central.sh`,
  `cli-central.ts`, restart plumbing (`agentop restart --all --rebuild`).
- **Spec:** _(link when written)_

#### B7 — New aside: per-member/machine metrics ⬜
- **Problem:** A new aside menu showing member/machine metrics:
  - which project each member worked on most (repo **or** folder — whichever is higher);
  - most used model;
  - most used harness;
  - etc. (organize well).
- **Depends on:** benefits from B4 (permission-gated) but can start from data already available.
- **Spec:** _(link when written)_

---

## Recommended order

1. **Group A** (A1 → A2 → A3) — quick wins, fresh context on repos/members/workflows code.
2. **B4 Governance/IAM** — the foundation for B5 and B7.
3. **B5 Tags** and **B7 Member metrics** — after roles/teams exist.
4. **B6 Auto-update** — independent; can be slotted in parallel anytime.

## Parallelization note
Design (brainstorm → spec) is done **sequentially, one subsystem at a time**. Implementation of an
approved spec is parallelized aggressively (subagents / dynamic workflows per independent task).

---

## Session log

| Date | Session focus | Outcome |
|------|---------------|---------|
| 2026-07-22 | Kickoff: decomposed the initiative into 7 items, created this roadmap. Starting Group A brainstorming. | Roadmap created. |
| 2026-07-22 | Group A brainstormed + spec written (A1 omit path on central; A2 both member views responsive; A3 title+project+repo in both workflow views). | Spec `specs/2026-07-22-group-a-ui-fixes-design.md`. A1/A2/A3 → 🟦 Planned. Implementing next. |
| 2026-07-22 | Group A implemented. A1: gated path subtitle on `!isCentral` in `RepositoriesList.tsx` + `RepoDetailPage.tsx`. A2: `TeamMembers.tsx` + `RepoDetailPage.MembersTable` responsive (useIsMobile stacked cards, GRID_COLS with minmax(0,…), flex action buttons). A3: joined `sessionById` to render title/project/repo in `WorkflowsPage.RunBlock` + title/project in `RepoDetailPage` workflow cards. `bun tsc --noEmit` clean, 310 tests pass. | A1/A2/A3 → ✅. Committed `d6a9bff`. Also added `restart:all` npm script (`37e5940`). **Next: B4 Governance/IAM design.** |
| 2026-07-22 | Group A committed + validated on the real central (PWA service-worker cache had masked the rebuild — see memory). B4 Governance/IAM fully brainstormed; mapped current central auth (single shared password, no accounts/roles, token=member identity). | Spec `specs/2026-07-22-governance-iam-design.md` written. B4 → 🟨 (design). **Next: user reviews spec → writing-plans.** |
| 2026-07-22 | B4 Phase 1 (IAM core) implemented via subagent-driven (7 tasks) + Phase 2 (bootstrap) implemented via subagent-driven (5 tasks). Both fully reviewed clean; Phase 2 integration-verified on the real central. | Phase 1 commits `2628d44`..`bec226e`; Phase 2 `86d94fc`..`68efba37`. 332 tests pass. **Next: Phase 3 (IAM API: login + accounts/teams CRUD) → then Phase 4 (data scoping) → Phase 5 (frontend, first user-testable state).** |
| 2026-07-23 | Post-E2E feedback wave: fixed shown-once-secret data-loss (drawer dismissal); added **admin** role (owner>admin>manager>user, owner-deletes-owner w/ last-owner guard) full-stack; central **auto-detects external MONGO_URL** (Atlas) via opt-in local-Mongo overlay + MONGO_URL trim; completed **Phase 3** (central Machines governance view) + **Phase 4** (machine identity via whoami). Whole-branch security review READY TO MERGE (0 blocking). | Commits `70e19b4`..`83eb1c7` on `dev`. tsc clean, 352 tests, build ok. B4-EXT Phases 2–4 ✅ + admin role. Deferred: last-owner delete race, Machines rotate/revoke, date→BSON migration (separate item). **Next: user rebuilds central (`agentop central restart --rebuild` / `./central.sh up`) + hard-reload to test E2E.** |
| 2026-07-23 | Long iterative E2E-feedback session (waves 2–4). **Reverted the `admin` role** → owner + team-scoped manager/user (spec `2026-07-23-b4ext-phase5-account-form-roles.md`). Completed the Machines page (list all tokens, rename/rotate/revoke/bulk-delete/add-multiple/reassign-team, **multi-owner `accountIds[]`** via edit drawer). **Central public URL embedded in tokens** (`packConnectToken`/`unpackConnectToken`), connect command comes ready. **Deleted-machine auto-reset** (ingest requires a token once bootstrapped) + orphaned-data read filter (`getLiveTokenIds`). Machine **rename WS notification** (with actor). `restart --rebuild` rebuilds the **native** server. Users totals + machines-per-user. Member **sidebar connection status + latency**. Styled `Select`/`Checkbox`. `cli` npm script. | Commits `70e19b4`..`61ca59e`/`c7a79dd` on `dev` (pushed). tsc clean, **355 tests**, build ok. B4-EXT → ✅. New roadmap items captured: **C3 filters (teams/members/machines)** + **C4 dedicated mobile UI**. **Next session: (a) whole-branch security review of the latest batch, (b) merge `dev`→`main`, then C3/C4 or B5/B6/B7.** |
| 2026-07-23 | B4-EXT Phase 2 (frontend accounts) implemented via subagent-driven (5 tasks) + a final-review fix wave. `generatePassword` (unbiased); `mustChangePassword` threaded through types; blocking first-login `ChangePassword` gate; create-account drawer (provision-machine + random pw + must-change + shown-once secrets w/ HTTP-safe copy); edit-account drawer (rename/memberships/reset) via PATCH. Every task reviewed (spec+quality); whole-branch review READY TO MERGE (0 blocking). | Commits `8f2ba04`..`9867d4c` on `dev`. tsc clean, 351 tests, build ok. B4-EXT Phase 2 → ✅. **Next: Phase 3 (frontend machines: grouped view + add-to-account) → Phase 4 (machine client whoami identity in Central connection).** |
