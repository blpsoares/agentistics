# Group A — UI fixes (design spec)

**Date:** 2026-07-22
**Roadmap items:** A1, A2, A3 (see `docs/superpowers/ROADMAP.md`)
**Scope:** Frontend only. No backend/data-shape changes — every field needed already exists on
`SessionMeta` / `RepoStat` and is available in the components.

---

## A1 — Repositories list/detail shows a machine path on the central

**Problem.** On the **central** (aggregator), repo cards render a machine-local filesystem path
(e.g. `/home/reksai/eletro/ads-propostas`). A repo on the central is identified by its git remote,
not by any one machine's path, so the path is meaningless and redundant (the card title already
shows `org/repo`).

**Decision.** On the central, **omit the path line entirely** (no replacement). On a machine
(solo/member) keep the path — the same repo can be cloned at multiple local paths, so it's useful
there.

**Changes.**
- `packages/web/src/components/RepositoriesList.tsx` — the `subtitle` path block (~L143-148):
  render it only when `!isCentral`. `isCentral` is already a prop.
- `packages/web/src/pages/RepoDetailPage.tsx` — the folder/path subtitle (~L103-108): same
  `!isCentral` gate, for consistency on the central. `isCentral` comes from the outlet context.
- Machine behavior unchanged.

**Acceptance.**
- On central: no filesystem path shown on repo cards or repo detail header.
- On solo/member: path still shown exactly as today.

---

## A2 — Central member-data views: responsive + desktop polish

**Problem.** Member-data views on the central are broken on mobile (no responsive layout) and
cramped on desktop.

**Scope.** Both member views:
1. `packages/web/src/components/TeamMembers.tsx` (Settings → Team: token/member table).
2. `MembersTable` inside `packages/web/src/pages/RepoDetailPage.tsx` (per-repo "who works here").

**Changes.**
- `TeamMembers.tsx`:
  - Replace the fixed 5-column grid (`gridTemplateColumns: 'auto 1.2fr 1fr 1fr auto'` at the header
    ~L428-435 and each row ~L460-473) with a responsive layout.
  - On mobile (`useIsMobile()` from `packages/web/src/hooks/useIsMobile.ts`) render **stacked
    cards** — one card per member with labelled fields — following the pattern in
    `WorkflowsPage.tsx` `AgentTable` (~L291-312).
  - Fix the Rotate/Revoke action cluster (~L593-636, `whiteSpace: 'nowrap'`) so it wraps/stacks on
    mobile instead of overflowing.
  - Desktop: improve density/spacing so columns aren't visually squeezed.
- `RepoDetailPage.tsx` `MembersTable` (~L356-524):
  - The collapsed-row headline metrics use a fixed flex cluster (`Head` ~L517-524, gap 16) that
    cramps — make it wrap / reduce on small widths. The expandable metric grid is already
    `auto-fit minmax(150px,1fr)` (fine). Ensure the whole thing is usable on mobile.

**Acceptance.**
- On a narrow viewport (< `MOBILE_BREAKPOINT` 768), both views render as readable stacked cards with
  no horizontal overflow.
- On desktop, columns/metrics have comfortable spacing; action buttons never clip.

---

## A3 — Dynamic Workflows missing session title / project / repo

**Problem.** Workflow run cards lack the session **title**, **project**, and linked **repository**.

**Data fact.** `WorkflowRun` (`packages/core/src/types.ts`) has no `title`/`project_path`/
`git_remote`. Those live on `SessionMeta` — join via the `sessionById` map (already built in both
views) using `run.sessionId`. Helpers: `sessionLabel(s)` (`@agentistics/core`) for the title,
`formatProjectName(s.project_path)` for the project, `repoShortName(s.git_remote)` for the repo.

**Scope.** Both views.

**Changes.**
- `packages/web/src/pages/WorkflowsPage.tsx` (`/workflows`, the aside link) — `RunBlock`
  (title area ~L221-234; `s` already in scope ~L186): title already renders; **add project** and
  **add repo**. **Omit the repo line when `s.git_remote` is empty/falsy** (unlinked session).
- `packages/web/src/pages/RepoDetailPage.tsx` (Dynamic Workflows tab):
  - `WorkflowRunCard` header (~L653-679): add **session title** + **project**. **Repo omitted** —
    the page is already scoped to one repo (redundant). Session meta available via
    `sessionById.get(run.sessionId)` (already fetched ~L647).
  - `SessionGroupCard` (by-session header ~L603-618): already shows title; add **project** (repo
    omitted, same reason).

**Acceptance.**
- Standalone `/workflows`: each run shows title, project, and — when linked — repo (`org/repo`);
  no repo line when unlinked.
- Repo-detail Dynamic Workflows: each run shows title + project; no repo line (redundant).

---

## Testing

These are JSX/layout changes over pure data already in the components. Verify by:
- `bun tsc --noEmit` (type safety — the pre-commit hook enforces it).
- Manual/visual check at desktop and < 768px widths (user opens the URL; no browser automation per
  project memory).
No new unit tests required — no new pure functions are introduced. If a small pure helper is
extracted (e.g. a member-card field list), add a focused test next to the existing suites.
