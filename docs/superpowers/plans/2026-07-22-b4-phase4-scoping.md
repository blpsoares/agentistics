# B4 Phase 4 — Data scoping by team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On the central, a logged-in non-owner principal sees only data for the teams they belong to; the owner sees everything. Achieved by tagging each team `SessionMeta` with its `teamId` at read time and filtering the `/api/data` response through a pure scoping function keyed by the principal's team memberships.

**Architecture:** Add `teamId?` to `SessionMeta` (core). At central read time, `loadTeamSessionsFromMongo` tags each session's `teamId` via a new `getMemberTeamMap()` (memberId→teamId). A pure `team-scope.ts` filters an already-built `AppData` to the visible team set (sessions by `teamId`, workflows by visible sessionId, projects/userStatsCaches/presence by visible users). The `/api/data` handler applies it after the (cache-shared) `buildApiResponse()` using `getPrincipal(req)` — owner or no-principal → passthrough. Additive: the shared build cache is untouched (never parameterized per-principal).

**Tech Stack:** Bun, TypeScript strict, MongoDB.

## Global Constraints

- English; TS strict; no `any`. Commit subjects lowercase.
- Additive & non-breaking: no gate flip; scoping applies ONLY when a non-owner principal is present. A request with no principal (legacy shared-password session) gets the full response unchanged this phase.
- Do NOT parameterize `buildApiResponse()` (it is a shared memoized singleton) — filter the response afterward in the handler.
- Owner (`principal.role === 'owner'`) → passthrough (sees all).
- Pure `team-scope.ts` is unit-tested; Mongo IO tagging is not.
- Run: `bun test`; `bun tsc --noEmit`.

---

### Task 1: tag `teamId` onto central sessions

**Files:**
- Modify: `packages/core/src/types.ts` (add `teamId?` to `SessionMeta`)
- Modify: `packages/server/server/team-tokens.ts` (add `getMemberTeamMap`)
- Modify: `packages/server/server/team-source.ts` (tag `teamId` in `loadTeamSessionsFromMongo`)

**Interfaces:**
- Produces: `SessionMeta.teamId?: string`; `getMemberTeamMap(): Promise<Record<string, string>>` (memberId→teamId).

> IO/type task — no unit test; the pure filter (Task 2) is where behavior is tested.

- [ ] **Step 1: Add `teamId?` to `SessionMeta`**

In `packages/core/src/types.ts`, find the `SessionMeta` interface and add near `git_remote?`:
```ts
  /** Team the owning member belongs to (central read-time tag; used for per-team scoping). */
  teamId?: string
```

- [ ] **Step 2: Add `getMemberTeamMap` to `team-tokens.ts`**

First READ `team-tokens.ts` to confirm `getTokensCollection`, `DEFAULT_TEAM_ID` import (added in Phase 2), and the existing `getMemberNameMap` (mirror it). Append:
```ts
/** memberId (token hash) → teamId, for read-time team tagging. Defaults to DEFAULT_TEAM_ID. */
export async function getMemberTeamMap(): Promise<Record<string, string>> {
  const col = await getTokensCollection()
  const docs = await col.find({}, { projection: { _id: 1, teamId: 1 } }).toArray()
  const map: Record<string, string> = {}
  for (const d of docs) map[d._id] = d.teamId ?? DEFAULT_TEAM_ID
  return map
}
```
(If `DEFAULT_TEAM_ID` is not yet imported in this file, add `import { DEFAULT_TEAM_ID } from './teams'` at the top — it was added in Phase 2; confirm before adding a duplicate.)

- [ ] **Step 3: Tag `teamId` in `loadTeamSessionsFromMongo`**

First READ `team-source.ts` `loadTeamSessionsFromMongo` (~:43-60). It currently loads the `sessions` docs, fetches `getMemberNameMap()`, and maps each `doc` through `fromTeamDoc(doc, nameMap)`. `fromTeamDoc` strips `memberId`, so tag `teamId` from `doc.memberId` BEFORE it's lost. Modify the function to also fetch the team map and tag each resulting `SessionMeta`:
```ts
import { getMemberNameMap, getMemberTeamMap } from './team-tokens'  // add getMemberTeamMap to the existing import
import { DEFAULT_TEAM_ID } from './teams'                            // add if not already imported
```
In the body, alongside the existing `const nameMap = await getMemberNameMap()`:
```ts
  const teamMap = await getMemberTeamMap()
```
and where each doc is mapped to a `SessionMeta` (the `.map(doc => ...)` / loop that calls `fromTeamDoc`), set the tag on the produced meta before returning it:
```ts
    const meta = fromTeamDoc(doc, nameMap)
    meta.teamId = teamMap[doc.memberId] ?? DEFAULT_TEAM_ID
    return meta
```
(Adapt to the exact existing shape — the key change is: after `fromTeamDoc`, assign `meta.teamId` from `teamMap[doc.memberId]`.)

- [ ] **Step 4: Type-check + suite**

Run: `bun tsc --noEmit` — no errors. Run: `bun test` — all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/server/server/team-tokens.ts packages/server/server/team-source.ts
git commit -m "feat(iam): tag teamId onto central sessions at read time"
```

---

### Task 2: `team-scope.ts` — pure response scoping

**Files:**
- Create: `packages/server/server/team-scope.ts`
- Test: `packages/server/server/team-scope.test.ts`

**Interfaces:**
- Consumes: `AppData` from `@agentistics/core`; `Principal` from `./iam-types`.
- Produces:
  - `visibleTeamIdsOf(principal: Principal): Set<string>`
  - `scopeAppDataToTeams(data: AppData, visible: Set<string>): AppData`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/team-scope.test.ts
import { test, expect } from 'bun:test'
import { visibleTeamIdsOf, scopeAppDataToTeams } from './team-scope'
import type { Principal } from './iam-types'
import type { AppData } from '@agentistics/core'

const principal: Principal = { accountId: 'p', role: 'member', memberships: [{ teamId: 'A', role: 'user' }] }

test('visibleTeamIdsOf collects membership team ids', () => {
  const s = visibleTeamIdsOf({ accountId: 'x', role: 'member', memberships: [{ teamId: 'A', role: 'user' }, { teamId: 'B', role: 'manager' }] })
  expect([...s].sort()).toEqual(['A', 'B'])
})

test('scopeAppDataToTeams keeps only sessions in visible teams and prunes derived data', () => {
  const data = {
    sessions: [
      { session_id: 's1', user: 'alice', project_path: '/a', teamId: 'A' },
      { session_id: 's2', user: 'bob', project_path: '/b', teamId: 'B' },
    ],
    projects: [
      { path: '/a', users: ['alice'] },
      { path: '/b', users: ['bob'] },
    ],
    workflows: [
      { runId: 'w1', sessionId: 's1', user: 'alice' },
      { runId: 'w2', sessionId: 's2', user: 'bob' },
    ],
    userStatsCaches: { alice: { x: 1 }, bob: { x: 2 } },
    presence: { alice: { online: true }, bob: { online: false } },
  } as unknown as AppData

  const scoped = scopeAppDataToTeams(data, new Set(['A']))
  expect(scoped.sessions.map(s => s.session_id)).toEqual(['s1'])
  expect((scoped.workflows ?? []).map(w => w.runId)).toEqual(['w1'])
  expect((scoped.projects ?? []).map(p => (p as { path: string }).path)).toEqual(['/a'])
  expect(Object.keys(scoped.userStatsCaches ?? {})).toEqual(['alice'])
  expect(Object.keys(scoped.presence ?? {})).toEqual(['alice'])
})

test('scopeAppDataToTeams drops sessions with no teamId (untagged) for a scoped principal', () => {
  const data = { sessions: [{ session_id: 's3', user: 'c', project_path: '/c' }] } as unknown as AppData
  expect(scopeAppDataToTeams(data, new Set(['A'])).sessions).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/team-scope.test.ts`
Expected: FAIL — cannot find module `./team-scope`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/team-scope.ts
/**
 * team-scope.ts — pure per-team filtering of an already-built AppData response.
 * Owner passthrough is the CALLER's responsibility; this filters to `visible` team ids.
 * Sessions are kept by their read-time `teamId` tag; workflows follow their session;
 * projects + user-keyed maps (userStatsCaches, presence) are pruned to visible users.
 */
import type { AppData } from '@agentistics/core'
import type { Principal } from './iam-types'

export function visibleTeamIdsOf(principal: Principal): Set<string> {
  return new Set(principal.memberships.map(m => m.teamId))
}

function pickKeys<T>(obj: Record<string, T> | undefined, keep: Set<string>): Record<string, T> | undefined {
  if (!obj) return obj
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(obj)) if (keep.has(k)) out[k] = v
  return out
}

export function scopeAppDataToTeams(data: AppData, visible: Set<string>): AppData {
  const sessions = (data.sessions ?? []).filter(s => s.teamId != null && visible.has(s.teamId))
  const visibleSessionIds = new Set(sessions.map(s => s.session_id))
  const visibleUsers = new Set(sessions.map(s => s.user).filter((u): u is string => Boolean(u)))
  const workflows = (data.workflows ?? []).filter(w => visibleSessionIds.has(w.sessionId))
  const projects = (data.projects ?? []).filter(p => (p.users ?? []).some(u => visibleUsers.has(u)))
  return {
    ...data,
    sessions,
    workflows,
    projects,
    userStatsCaches: pickKeys(data.userStatsCaches, visibleUsers),
    presence: pickKeys(data.presence, visibleUsers),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/team-scope.test.ts`
Expected: PASS (3 tests). Then `bun tsc --noEmit` — no errors.

> If tsc complains that `AppData.projects` element lacks `users` or that `presence`/`userStatsCaches` types don't match `pickKeys`, read the `AppData`/`Project` types in `packages/core/src/types.ts` and adjust the local casts minimally (do not change core types beyond Task 1's `teamId`).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/team-scope.ts packages/server/server/team-scope.test.ts
git commit -m "feat(iam): pure per-team appdata scoping"
```

---

### Task 3: apply scoping in the `/api/data` handler

**Files:**
- Modify: `packages/server/server/index.ts` (the `/api/data` handler, ~:856-889)

**Interfaces:**
- Consumes: `getPrincipal` from `./auth`; `scopeAppDataToTeams`, `visibleTeamIdsOf` from `./team-scope`.

> IO/integration — verified by tsc, suite, and the end-to-end test in Phase 5.

- [ ] **Step 1: Integrate scoping at the return seam**

First READ the `/api/data` handler (~:856-889). It calls `const data = await buildApiResponse()`, then (central-only) merges `presence`, `includeOfflineData`, `liveSessionIds`, and returns a single object like `return json({ ...data, liveSessionIds, presence, ... })`.

Change: capture the final response object in a variable, then — when central AND a non-owner principal is present — pass it through the pure scoper before returning. Do NOT scope for the owner or when there is no principal (legacy shared-password session).

Concretely, replace the final `return json({ ...data, ... })` with:
```ts
    let response = { ...data, /* keep the exact existing extra fields: */ liveSessionIds, presence, includeOfflineData }
    if (TEAM_CENTRAL) {
      const principal = await getPrincipal(req)
      if (principal && principal.role !== 'owner') {
        const { scopeAppDataToTeams, visibleTeamIdsOf } = await import('./team-scope')
        response = scopeAppDataToTeams(response, visibleTeamIdsOf(principal))
      }
    }
    return json(response)
```
Adapt the `response` object literal to the EXACT fields the existing return spreads (copy them verbatim — do not add or drop any). `getPrincipal` is already imported in index.ts (Phase 1/2); if not, add `import { getPrincipal } from './auth'` (merge with the existing `./auth` import).

- [ ] **Step 2: Type-check + suite**

Run: `bun tsc --noEmit` — no errors. Run: `bun test` — all pass.

- [ ] **Step 3: Commit**

```bash
git add packages/server/server/index.ts
git commit -m "feat(iam): scope /api/data by the caller's teams (non-owner)"
```

---

## Self-Review

**Spec coverage (Phase 4 slice):** per-team data-read scoping (spec §5.3 "visibleTeamIds applied where team data is assembled") → Tasks 1+2+3. Owner-sees-all, member-sees-own-teams (spec §3 matrix "View metrics") → owner passthrough (Task 3) + `visibleTeamIdsOf` (Task 2). `stats-cache.json` stays Claude-only, scoping is on per-session data (spec rule) → we filter the `sessions` array + user-keyed maps, never a shared statsCache.

**Deferred:** scoping the ADMIN-gated `/api/team/members` list (a separate route) — done when the members panel is made role-aware in Phase 5. Phase 4 covers the main dashboard `/api/data`.

**Placeholder scan:** none — Task 3 explicitly says to copy the existing return fields verbatim (a real seam to read), which is precise, not vague.

**Type consistency:** `teamId?` added to `SessionMeta` (Task 1) is what `scopeAppDataToTeams` filters on (Task 2). `visibleTeamIdsOf(Principal)` returns the `Set<string>` `scopeAppDataToTeams` consumes. `getMemberTeamMap` returns `Record<string,string>` used only in Task 1's tagging.

**Non-breaking:** scoping only triggers for a non-owner principal on a central; legacy shared-password sessions (no principal) and the owner get the full response. The shared `buildApiResponse` memo is never parameterized.
