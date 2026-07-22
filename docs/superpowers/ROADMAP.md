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

### Group B — Large subsystems (each is its own project)

#### B4 — Governance / IAM (the foundation) ⬜
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
- **Open question from user:** they're open to better governance suggestions.
- **Spec:** _(link when written)_

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
| 2026-07-22 | Group A implemented. A1: gated path subtitle on `!isCentral` in `RepositoriesList.tsx` + `RepoDetailPage.tsx`. A2: `TeamMembers.tsx` + `RepoDetailPage.MembersTable` responsive (useIsMobile stacked cards, GRID_COLS with minmax(0,…), flex action buttons). A3: joined `sessionById` to render title/project/repo in `WorkflowsPage.RunBlock` + title/project in `RepoDetailPage` workflow cards. `bun tsc --noEmit` clean, 310 tests pass. | A1/A2/A3 → ✅. **Next: B4 Governance/IAM design.** |
