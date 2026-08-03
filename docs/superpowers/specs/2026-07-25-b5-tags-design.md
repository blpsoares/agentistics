# B5 — Tags: aggregated metrics across machines, repos, teams and accounts (design)

**Date:** 2026-07-25
**Roadmap:** `docs/superpowers/ROADMAP.md` → Group B → B5
**Branch:** `dev`
**Depends on:** B4 (governance/IAM) — roles, accounts, `iam-caps.can()`

## Problem

Metrics today are explorable but not *prepared*. To answer "how much did Client X cost us this
month" an operator has to remember which repos, machines and people belong to Client X and rebuild
that filter by hand every time. A **tag** is a saved, named grouping whose aggregated metrics are
available in one click.

## Naming — tags, not projects

`project` is already a core, occupied concept in this codebase: `ServerProject`, `project_path`,
the `projects` filter dimension, the `/projects` page, `scanProjects`. A second meaning would make
every future discussion ambiguous and produce two unrelated `Project` types in the same code. The
grouping is also **many-to-many by nature** — one repo can belong to "Client X" and to "Frontend
team" at once — which is exactly what a tag communicates and what "project"/"workspace" (both
implying containment) do not.

## The model: two independent axes

The central decision of this design is that **what a tag aggregates** and **who may see it** are
separate axes. Conflating them loses the feature.

### Axis 1 — Sources (rich)

A tag holds a list of typed sources:

| Source type | Value | Resolves to |
|---|---|---|
| `repo` | normalized git remote (`host/org/repo`) | sessions whose `git_remote` matches |
| `project` | project path | sessions whose `project_path` matches |
| `machine` | `memberId` (token hash) | sessions pushed by that machine |
| `team` | `teamId` | sessions carrying that team (any of `teamIds`) |
| `account` | `accountId` | sessions from **every machine that account owns** |

A tag's session set is the **union (OR)** of its sources. `account` and `team` are *dynamic*: they
resolve at query time, so a machine added to a team later is automatically included. This matters —
selecting a team and having it not track the team would be surprising.

### Axis 2 — Visibility (accounts only, explicit)

A tag is visible to an explicit list of accounts (`sharedWith`), plus its creator, plus every
owner. Visibility is **never** derived from teams. Consequences, all deliberate:

- **Closed scope.** A grantee sees the tag's **full** numbers — never a silently reduced subset.
  There is no "partial view" state to explain.
- **Auditable.** "Who can see this tag?" has a literal answer.
- **Manual.** A new team member inherits nothing; grants are explicit. Accepted for v1 as
  predictable-over-automatic. A later convenience may allow *granting to a team* (expanding to its
  members at read time) without reintroducing team-derived visibility.

## Security rules

Because a grantee sees full numbers, **granting a tag is an act of data sharing**. Two rules keep
tags from becoming a side channel around team scoping:

1. **You may only create or edit a tag whose every source you can already see.** Otherwise a
   manager could compose a tag over another team's machines and grant it to themselves — privilege
   escalation in two steps. Enforced server-side on every write, re-validated on edit.
2. **Tag access is aggregate-only.** Seeing a tag yields totals (cost, sessions, tokens, top
   project / model / harness). It never opens the underlying session list, transcripts, or agent
   metrics for sources the viewer could not otherwise see. This is the line that keeps the whole
   team-scoping model intact.

`iam-caps.ts` already reserves a `tags:write` action, currently `isManagerOf(p, ctx.teamId)`. Its
semantics change here: authority to write a tag is **not** team-derived but source-derived —
`can(p, 'tags:write')` becomes "may create tags at all" (owner or any manager), and the real gate is
the per-source visibility check in rule 1. The capability test is updated to match.

## Aggregation is server-side — and why

`/api/data` is **scoped** for a non-owner principal (`scopeAppDataToTeams` strips sessions outside
their teams). A tag's numbers must be full for its grantees, including sources they cannot otherwise
see. Therefore tag aggregates **cannot** be computed in the browser from `data.sessions` — they must
be computed on the server against the unscoped session set and returned as numbers only.

This falls out of rule 2: the server sends the aggregate, never the rows behind it.

### Dedupe comes free

Sources are resolved to a **set of sessions**, then summed once — never summed per source and
added. A session matching both "team Backend" and "machine bryan-laptop" is counted once. This is
the same discipline the app already applies elsewhere (per-session sums for every non-Claude
dimension; `stats-cache.json` stays Claude-only and is never used for tag math).

## Data model

New Mongo collection `tags`:

```ts
interface TagDoc {
  _id: string                    // random id
  name: string
  color?: string                 // UI chip colour
  sources: { type: 'repo' | 'project' | 'machine' | 'team' | 'account'; value: string }[]
  sharedWith: string[]           // accountIds granted read access (creator implicit, owners implicit)
  createdBy: string              // accountId
  createdAt: string              // ISO 8601
  updatedAt: string
}
```

Server modules, following the existing `team-repos.ts` shape:

- `tags-store.ts` — Mongo CRUD (`listTags`, `getTag`, `createTag`, `updateTag`, `deleteTag`).
- `tags-resolve.ts` — **pure**: `sessionMatchesTag(session, sources, ownedMachinesByAccount, teamsByMachine)` and
  `resolveTagSessions(sessions, tag, lookups)`. Unit-tested without Mongo.
- `tags-aggregate.ts` — **pure**: `aggregateSessions(sessions)` → `{ costUSD, sessions, inputTokens,
  outputTokens, topProject, topModel, topHarness }`. Uses `calcCost()` from `@agentistics/core`.
- `tags-handlers.ts` — routes + the visibility/authority gates.

Splitting resolve and aggregate keeps both pure and independently testable; the handler is the only
part that touches Mongo or auth.

## API

| Route | Who | Returns / does |
|---|---|---|
| `GET /api/tags` | any authed principal | tags visible to them, each with its aggregate |
| `POST /api/tags` | `tags:write` + rule 1 | create |
| `PATCH /api/tags` | creator or owner, + rule 1 | edit name/color/sources/sharedWith |
| `DELETE /api/tags` | creator or owner | delete |
| `GET /api/tags/:id` | a viewer of that tag | one tag + its aggregate + per-source breakdown |

`GET /api/tags` computes aggregates for the listed tags in one pass over the session set.

## Frontend

Two surfaces, per the agreed design:

1. **`/tags` page** — a card per visible tag (name chip, cost, sessions, tokens, source count) using
   the existing `.ag-grid cols-N` utility so it scales down to mobile with no new breakpoint.
   Clicking a card opens the tag detail (aggregate + per-source breakdown + top project/model/harness).
   Create/edit lives in a `Drawer`, reusing the settings `Section` / `Select` / `RecordCard`
   primitives — including their mobile behaviour from C4.
2. **A `tags` dimension in `+ Filtro`** — selecting a tag re-scopes the dashboard.

**Documented limitation of the filter surface:** the dashboard is built from the *scoped*
`/api/data`, so filtering by a tag can only narrow what the viewer already sees. A grantee who
filters by a tag containing sources outside their scope will see smaller numbers on the dashboard
than on the `/tags` card. This is correct (rule 2 — the rows are not theirs to see) and the tag
detail states it rather than leaving it to look like a bug.

## Out of scope

- Granting a tag to a team (a later convenience; v1 is account-only).
- Tag-based budgets or alerts.
- Nested tags / tag hierarchies.
- Drill-down from a tag into sessions (deliberately excluded by rule 2).

## Phasing

1. **Store + pure resolution** — `tags-store.ts`, `tags-resolve.ts`, `tags-aggregate.ts` with unit
   tests. No routes, no UI.
2. **API + authority gates** — `tags-handlers.ts`, routes wired, rule 1 and rule 2 enforced, cap
   semantics updated.
3. **`/tags` page** — list, detail, create/edit drawer.
4. **Filter dimension** — `tags` in `Filters`, the `+ Filtro` menu, chip row, and the documented
   narrowing behaviour.

## Verification

- `bun tsc --noEmit`, `bun test`, `bun run build` after every phase.
- Unit tests for the pure modules: OR-union of sources, dedupe of an overlapping session, dynamic
  resolution of `team` and `account` sources, empty-source tag.
- Authority tests: a manager cannot create a tag over an unseen machine; cannot grant a tag they do
  not fully see; a grantee gets full aggregates; a non-grantee does not see the tag at all.
- E2E on the real central at 390px and 1440px, as owner and as a scoped user.
