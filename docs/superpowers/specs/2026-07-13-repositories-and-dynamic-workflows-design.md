# Repositories page polish + Dynamic Workflows tab — design

Date: 2026-07-13
Status: Approved (pending spec review)

## Problem

Two related areas of the Repositories feature are confusing or underbuilt:

1. **The "Workflows" tab in `RepoDetailPage`** reads as if it were about GitHub
   Actions (it sits right next to the "Actions" tab, which *is* GitHub Actions/CI).
   It actually lists runs of the Claude Code **Workflow tool** (multi-agent
   orchestration / fan-out). The `WorkflowsMini` view shows only one line per run
   (name · agent count · tokens · cost) — it hides the steps (phases) and the
   agents per step, so the user can't see what happened inside a run.

2. **The Repositories page** (`RepositoriesPage` / `RepositoriesList`) can't be
   sorted, the card layout is weak, and there's no provider logo (GitHub etc.).
   The "Actions" entry points show even when no CI run ever happened. The repo
   detail tab bar also shows a spurious vertical scrollbar.

## Scope

Frontend only. No backend, no changes to `WorkflowRun` shape or the workflow
pipeline. One new capability flag in `@agentistics/core`. The **global `/workflows`
page (`WorkflowsPage`) is intentionally out of scope** — it keeps its current name
and `RunBlock` layout.

## The seven changes

### 1. `dynamicWorkflows` capability (`packages/core/src/types.ts`)

Add `dynamicWorkflows: boolean` to `HarnessCapabilities`, and set it in
`HARNESS_CAPABILITIES`:

- `claude: true`
- `codex`, `gemini`, `copilot`: `false`

This is the single source of truth that gates the tab and future harness support.
The existing `capable(harness, metric)` helper (`packages/web/src/lib/harness.ts`)
already reads `HARNESS_CAPABILITIES[harness][metric]`, so `capable(h, 'dynamicWorkflows')`
works with no other wiring. Because the type gains a required key, every literal in
`HARNESS_CAPABILITIES` must set it (compile-time enforced).

### 2. Rename + gate the tab (`packages/web/src/pages/RepoDetailPage.tsx`)

- Tab label `"Workflows"` → **`"Dynamic Workflows"`** (both EN and PT — the term
  stays in English as a product name, matching the existing "Actions" tab).
- Derive each run's harness from its session:
  `sessionById.get(run.sessionId)?.harness ?? 'claude'` (build a `sessionById`
  map from `data.sessions`, same pattern as `WorkflowsPage`).
- `show` for the tab becomes: `workflows.length > 0 && workflows.some(w =>
  capable(harnessOf(w), 'dynamicWorkflows'))`. Today this equals
  `workflows.length > 0` (workflows are Claude-only), but it is now principled and
  future-proof: a harness without the capability never surfaces the tab.
- The badge stays the run count.

### 3. Timeline view — replaces `WorkflowsMini`

New component (in `RepoDetailPage.tsx`, replacing `WorkflowsMini`) rendering each
run as an expandable block:

**Header (always visible):**
- status dot (`completed` green / `partial` yellow / `failed` red — reuse the
  color logic from `WorkflowsPage`'s `RunBlock`),
- workflow name,
- **harness badge** using `HARNESS_LABELS` + `HARNESS_COLORS` (e.g. "Claude Code"),
- compact totals strip: agents · tokens (in+out) · cost · duration.

**Expanded body — vertical timeline of steps:**
- Steps come from `run.phases` (authoritative order + titles). Each step is
  numbered (①②③…), shows its title, agent count, and a per-step subtotal
  (in / out / cost) computed by summing the agents assigned to that phase.
- Agents are grouped by `agent.phase` and attached under their step, ordered by
  the `run.phases` order (mirror `RunBlock`'s ordering logic). Agents whose
  `phase` matches no declared phase fall into a trailing `(no phase)` bucket.
- A step declared in `run.phases` but with zero agents renders as an empty step
  (the phase existed but nothing ran).
- Per agent: label, model badge, status glyph (✓ completed / ✗ failed / ⤼ skipped),
  tokens in/out, cost, and — when `agent.toolStats` is present — a compact line of
  tool activity (reads, edits, +added/−removed lines).
- Visual: a left vertical rail with a node per step (inline styled divs/SVG, no
  new deps), consistent with the app's existing inline-SVG approach.

Reuse the `perMillionUSD` / `sumAgents` helpers by lifting the small ones needed,
or re-derive locally; do **not** import from `WorkflowsPage` (keep pages
decoupled). Cost formatting via `fmtCost`, token counts via `fmt` from
`@agentistics/core`.

Mobile: the timeline stacks naturally (single column); agent rows wrap their
metrics like the existing mobile `AgentTable` cards.

### 4. Sort repositories (`packages/web/src/pages/RepositoriesPage.tsx`)

Add a sort control in the Section `action` area, next to the search box, styled as
pills (matching the app's existing pill style). Sort keys operate on `RepoStat`:

| Key            | Field                             |
|----------------|-----------------------------------|
| Cost (default) | `costUSD`                         |
| Sessions       | `sessions`                        |
| Tokens         | `inputTokens + outputTokens`      |
| Commits        | `gitCommits`                      |
| Last active    | `lastActive` (ISO → time)         |
| Name           | `name` (locale compare)           |

- A direction toggle (▲/▼). Default: **Cost, descending**.
- Numeric/date keys sort descending by default; Name ascending by default; the
  toggle flips either.
- Sorting is applied to the already-search-`filtered` array via a `useMemo`
  before it is passed to `RepositoriesList`. The "no repository" (unlinked) bucket
  sorts by the same key like any other card (not force-pinned).
- State: `const [sortKey, setSortKey]` + `const [sortDir, setSortDir]`, local to
  the page.

### 5. Provider logo + card polish (`packages/web/src/components/RepositoriesList.tsx`)

- New `ProviderLogo({ host, linked, size })` component using **inline brand SVGs**
  for GitHub, GitLab, and Bitbucket (lucide-react no longer ships brand icons).
  Fallback: `GitBranch` for an unknown host, `Link2Off` for an unlinked repo
  (no remote). The SVG marks are monochrome and inherit `currentColor` so they
  respect the card accent / theme.
- Replace the leading generic `GitBranch`/`Link2Off` icon in each card header with
  `ProviderLogo`. Keep the small host-name chip but make it secondary (the logo
  now carries provider identity); keep `hostColor` for the chip text.
- Light spacing polish on the header row to seat the logo cleanly. No structural
  rewrite of the card — metrics grid, sparkline, and footer chips stay.

### 6. Gate "Actions" to real runs

- **`RepositoriesPage.tsx`**: the Actions button condition `isCentral || ciTotal > 0`
  becomes **`ciTotal > 0`** — it disappears when no CI run exists, even on a central.
- **`RepoDetailPage.tsx`**: the Actions tab `show: true` becomes
  **`show: ciSessions.length > 0`**.

### 7. Kill the phantom vertical scrollbar (`RepoDetailPage.tsx`)

The tab bar container uses `overflowX: 'auto'`, which per CSS promotes
`overflow-y` from `visible` to `auto`; combined with the tab buttons'
`marginBottom: -1`, that 1px vertical overflow shows a vertical scrollbar (the same
`overflow-x`/`overflow-y` gotcha the CLAUDE.md iOS-sticky note documents).

Fix: keep horizontal scrolling (tabs must scroll on mobile) but suppress the
vertical scrollbar without re-clipping the active tab's underline — hide the
scrollbar chrome via `scrollbarWidth: 'none'` (Firefox) + a
`::-webkit-scrollbar { display: none }` rule (Chrome/Safari) scoped to the tab bar,
and/or absorb the −1px so nothing overflows vertically. Verify the active tab's
2px bottom border still aligns with the container border.

## Non-goals

- No change to the global `/workflows` page.
- No backend / `WorkflowRun` type change; harness is derived from the session.
- No new runtime dependency (logos and timeline are inline SVG/CSS).
- No new sort persistence (sort state is in-memory per page visit).

## Testing / verification

- `bun tsc --noEmit` (the new capability key is compile-checked across all
  `HARNESS_CAPABILITIES` literals).
- `bun test` (existing suites; these are pure-function suites — no new pure logic
  that needs a unit test beyond what's covered, though a small sort-comparator or
  phase-grouping helper, if extracted, is a candidate for a focused test).
- Manual: open a repo with workflow runs → confirm tab reads "Dynamic Workflows",
  shows the Claude Code badge, expands into steps with agents; open Repositories →
  sort by each key + flip direction; confirm GitHub logo renders; confirm Actions
  button/tab vanish when `ciSessions === 0`; confirm no vertical scrollbar on the
  tab bar.
