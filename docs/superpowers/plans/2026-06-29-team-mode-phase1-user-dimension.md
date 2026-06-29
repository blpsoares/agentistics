# Team Mode — Phase 1: `user` Dimension (filesystem-fed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `user` dimension to agentistics end-to-end — sessions can be tagged with an owning user, the central server unions per-user consolidated session files from a shared folder, and the dashboard gains a multi-select user filter (team total when none selected, per-subset aggregate when selected) — without any Mongo or ingestion API yet.

**Architecture:** The dev side is untouched. A new server "team folder source" reads consolidated `SessionMeta` JSONs from `AGENTISTICS_TEAM_DIR/<user>/sessions/*.json`, tags each with its owning `user`, and merges them into the existing session list inside `_buildApiResponseCore`. The frontend derives the distinct user list from the sessions (no new API field) and applies a multi-select `user` filter alongside the existing project filter. All totals keep emerging from per-session sums via the existing `@agentistics/core` functions — nothing is pre-aggregated.

**Tech Stack:** Bun, TypeScript (strict), React + Vite, `bun test`. Monorepo packages: `@agentistics/core`, `@agentistics/server`, `@agentistics/web`.

## Global Constraints

- Everything in English: code, comments, commit messages (project rule, `CLAUDE.md`).
- Conventional Commits (`feat:`, `test:`, `chore:`…); commit-msg hook (commitlint) enforces it.
- pre-commit hook runs `bun tsc --noEmit` + `bun test` — every commit must pass both.
- TypeScript strict typing — no `any`, no non-null assertions to dodge types.
- Test pure functions only; do NOT mock the filesystem (project rule). Filesystem-touching code (`team-source.ts`, `data.ts` wiring) is verified by build + manual run, not unit tests.
- Never inline pricing/calculations — reuse `@agentistics/core` (not directly relevant here, but the rule stands).
- `packages/server/server/*` modules are server-only — never import them from `packages/web/src/`.
- New pure helpers live in `@agentistics/core` and are re-exported from `packages/core/src/index.ts`.

---

## File Structure

**Created:**
- `packages/core/src/team.ts` — pure helpers: `tagUser`, `distinctUsers`, `filterByUsers`.
- `packages/core/src/team.test.ts` — unit tests for the three helpers.
- `packages/server/server/team-source.ts` — `loadTeamSessions()` folder loader (FS, not unit-tested).
- `packages/web/src/components/UsersFilter.tsx` — compact multi-select user dropdown.

**Modified:**
- `packages/core/src/types.ts` — add `SessionMeta.user?`, `Filters.users?`.
- `packages/core/src/index.ts` — re-export `./team`.
- `packages/server/server/config.ts` — add `TEAM_MODE`, `TEAM_DIR`.
- `packages/server/server/data.ts` — union team sessions; widen dedup key to include `user`.
- `packages/web/src/hooks/useData.ts` — apply the `user` filter (`filterByUsers`) in `useDerivedStats`.
- `packages/web/src/lib/app-context.ts` — expose `users: string[]`.
- `packages/web/src/App.tsx` — compute the `users` memo, pass it through the Outlet.
- `packages/web/src/components/FiltersBar.tsx` — render `UsersFilter` when users exist.

---

## Task 1: Pure `user` helpers + type fields (core)

**Files:**
- Modify: `packages/core/src/types.ts` (SessionMeta ~line 97, Filters ~line 206)
- Create: `packages/core/src/team.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/team.test.ts`

**Interfaces:**
- Consumes: `SessionMeta` from `./types`.
- Produces:
  - `SessionMeta.user?: string` — the owning user (undefined for Solo/local sessions).
  - `Filters.users?: string[]` — selected users (undefined/empty = all).
  - `tagUser(session: SessionMeta, user: string): SessionMeta`
  - `distinctUsers(sessions: SessionMeta[]): string[]` (sorted, unique, skips undefined)
  - `filterByUsers<T extends { user?: string }>(sessions: T[], users: string[]): T[]` (empty `users` = pass-through)

- [ ] **Step 1: Add the type fields**

In `packages/core/src/types.ts`, inside `interface SessionMeta`, add the `user` field right after the `harness` line (currently line 97):

```ts
  harness: HarnessId
  /** Owning user in team mode. Undefined for local/Solo sessions. */
  user?: string
```

In the same file, inside `interface Filters`, add `users` right after the `projects` line (currently line 206):

```ts
  projects: string[]   // empty = all projects
  users?: string[]     // empty/undefined = all users
  models: string[]     // empty = all models
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/team.test.ts`:

```ts
import { test, expect } from 'bun:test'
import type { SessionMeta } from './types'
import { tagUser, distinctUsers, filterByUsers } from './team'

function session(id: string, user?: string): SessionMeta {
  return {
    session_id: id, project_path: '/p', start_time: '2026-06-01T00:00:00Z',
    duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    first_prompt: '', user_interruptions: 0, user_response_times: [],
    tool_errors: 0, tool_error_categories: {}, uses_task_agent: false,
    uses_mcp: false, uses_web_search: false, uses_web_fetch: false,
    lines_added: 0, lines_removed: 0, files_modified: 0, message_hours: [],
    user_message_timestamps: [], harness: 'claude', user,
  }
}

test('tagUser sets the user without mutating the input', () => {
  const s = session('a')
  const tagged = tagUser(s, 'devA')
  expect(tagged.user).toBe('devA')
  expect(s.user).toBeUndefined() // original untouched
})

test('distinctUsers returns sorted unique users and skips undefined', () => {
  const sessions = [session('1', 'devB'), session('2', 'devA'), session('3', 'devB'), session('4')]
  expect(distinctUsers(sessions)).toEqual(['devA', 'devB'])
})

test('filterByUsers with empty selection passes everything through', () => {
  const sessions = [session('1', 'devA'), session('2', 'devB')]
  expect(filterByUsers(sessions, [])).toHaveLength(2)
})

test('filterByUsers keeps only selected users and drops untagged sessions', () => {
  const sessions = [session('1', 'devA'), session('2', 'devB'), session('3')]
  const result = filterByUsers(sessions, ['devA'])
  expect(result.map(s => s.session_id)).toEqual(['1'])
})

test('filterByUsers supports multi-select (aggregate of a subset)', () => {
  const sessions = [session('1', 'devA'), session('2', 'devB'), session('3', 'devC')]
  const result = filterByUsers(sessions, ['devA', 'devB'])
  expect(result.map(s => s.session_id).sort()).toEqual(['1', '2'])
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/core/src/team.test.ts`
Expected: FAIL — `Cannot find module './team'` (file not created yet).

- [ ] **Step 4: Implement the helpers**

Create `packages/core/src/team.ts`:

```ts
import type { SessionMeta } from './types'

/** Tag a session with its owning user (team mode). Pure — returns a new object. */
export function tagUser(session: SessionMeta, user: string): SessionMeta {
  return { ...session, user }
}

/** Distinct, sorted list of users present in a session list. Skips undefined. Pure. */
export function distinctUsers(sessions: SessionMeta[]): string[] {
  const set = new Set<string>()
  for (const s of sessions) if (s.user) set.add(s.user)
  return Array.from(set).sort()
}

/** Multi-select user predicate. Empty/undefined selection = all sessions pass.
 *  Sessions with no `user` are excluded when a selection is active. Pure. */
export function filterByUsers<T extends { user?: string }>(sessions: T[], users: string[]): T[] {
  if (!users || users.length === 0) return sessions
  const set = new Set(users)
  return sessions.filter(s => !!s.user && set.has(s.user))
}
```

- [ ] **Step 5: Re-export from the barrel**

In `packages/core/src/index.ts`, add a re-export line alongside the other `export *` lines:

```ts
export * from './team'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/core/src/team.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/team.ts packages/core/src/team.test.ts packages/core/src/index.ts
git commit -m "feat(core): add user dimension types and pure team helpers"
```

---

## Task 2: Server team-folder source + config + merge

**Files:**
- Modify: `packages/server/server/config.ts` (after line 25)
- Create: `packages/server/server/team-source.ts`
- Modify: `packages/server/server/data.ts` (import line 4; merge block after line 650; dedup key line 658)

**Interfaces:**
- Consumes: `tagUser` from `@agentistics/core`; `safeReadDir`, `safeReadJson` from `./utils`; `TEAM_MODE`, `TEAM_DIR` from `./config`.
- Produces:
  - `TEAM_MODE: boolean`, `TEAM_DIR: string` (config).
  - `loadTeamSessions(root?: string): Promise<SessionMeta[]>` — reads `root/<user>/sessions/*.json`, tags each with `<user>`.
  - Sessions in the API response now carry `user`; the dedup key includes `user`.

> No unit test here (filesystem I/O — project rule says don't mock FS). Verified by typecheck + the existing suite staying green + the manual run in Step 6.

- [ ] **Step 1: Add config constants**

In `packages/server/server/config.ts`, after the `CONSOLIDATED_DIR` line (currently line 25), add:

```ts
// ---------------------------------------------------------------------------
// Team mode (Phase 1: folder union). When AGENTISTICS_TEAM=1 the server unions
// per-user consolidated SessionMeta JSONs from TEAM_DIR/<user>/sessions/*.json
// and tags each session with its owning user. Off by default (Solo behavior).
// ---------------------------------------------------------------------------
export const TEAM_MODE = process.env.AGENTISTICS_TEAM === '1'
export const TEAM_DIR = process.env.AGENTISTICS_TEAM_DIR ?? join(HOME_DIR, '.agentistics', 'team')
```

(`join` and `HOME_DIR` are already imported/defined at the top of the file.)

- [ ] **Step 2: Create the folder loader**

Create `packages/server/server/team-source.ts`:

```ts
import { join } from 'path'
import type { SessionMeta } from '@agentistics/core'
import { tagUser } from '@agentistics/core'
import { safeReadDir, safeReadJson } from './utils'
import { TEAM_DIR } from './config'

/**
 * Phase-1 "folder union" transport. Reads consolidated SessionMeta JSONs from
 * `root/<user>/sessions/*.json` and tags each with its owning user. Missing
 * dirs are tolerated (safeReadDir returns []). No raw transcript data — these
 * are the same metrics-only docs the consolidate mode already produces.
 */
export async function loadTeamSessions(root: string = TEAM_DIR): Promise<SessionMeta[]> {
  const out: SessionMeta[] = []
  const users = await safeReadDir(root)
  for (const user of users) {
    const dir = join(root, user, 'sessions')
    const files = await safeReadDir(dir)
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const data = await safeReadJson<SessionMeta>(join(dir, f))
      if (data && data.session_id) out.push(tagUser(data, user))
    }
  }
  return out
}
```

- [ ] **Step 3: Import config + merge team sessions in data.ts**

In `packages/server/server/data.ts`, extend the existing config import on line 4 to include `TEAM_MODE` (leave the rest of the import list intact):

```ts
import { PROJECTS_DIR, SESSION_META_DIR, ARCHIVE_PROJECTS_DIR, ARCHIVE_SESSION_META_DIR, STATS_CACHE_FILE, ARCHIVE_STATS_DIR, ARCHIVE_ENABLED, HOME_DIR, TEAM_MODE } from './config'
```

Then, inside `_buildApiResponseCore`, immediately AFTER the non-Claude adapter `for` loop closes (the loop that ends at line 650) and BEFORE `sessions.sort(...)` on line 651, insert:

```ts
    // --- Team mode (Phase 1): union per-user consolidated sessions from the shared folder ---
    if (TEAM_MODE) {
      const { loadTeamSessions } = await import('./team-source')
      const teamSessions = await loadTeamSessions().catch(() => [] as SessionMeta[])
      for (const s of teamSessions) {
        sessions.push(s)
        harnessSet.add(s.harness)
        const existing = projects.find(p => p.path === s.project_path && p.path)
        if (existing) {
          existing.sessions.push({ sessionId: s.session_id, created: s.start_time })
        } else if (s.project_path) {
          projects.push({
            path: s.project_path,
            name: s.project_path.split('/').filter(Boolean).pop() ?? s.project_path,
            sessions: [{ sessionId: s.session_id, created: s.start_time }],
          })
        }
      }
    }
```

- [ ] **Step 4: Widen the dedup key to include user**

In the same file, the dedup key on line 658 currently reads:

```ts
      const key = `${s.harness ?? 'claude'}:${s.session_id}`
```

Replace it with one that includes `user`, so two devs are never collapsed if session ids ever coincide (and local sessions, with `user` undefined, keep their original key shape):

```ts
      const key = `${s.user ?? ''}:${s.harness ?? 'claude'}:${s.session_id}`
```

- [ ] **Step 5: Typecheck + full suite**

Run: `bun tsc --noEmit`
Expected: no errors.

Run: `bun test`
Expected: all existing tests still PASS (no behavior change when `AGENTISTICS_TEAM` is unset).

- [ ] **Step 6: Manual smoke test of the folder union**

Create a tiny fixture and run the server source path once:

```bash
mkdir -p /tmp/agentistics-team/devA/sessions /tmp/agentistics-team/devB/sessions
cat > /tmp/agentistics-team/devA/sessions/s1.json <<'JSON'
{ "session_id": "s1", "project_path": "/x", "start_time": "2026-06-01T00:00:00Z",
  "duration_minutes": 1, "user_message_count": 1, "assistant_message_count": 1,
  "tool_counts": {}, "tool_output_tokens": {}, "agent_file_reads": {}, "languages": [],
  "git_commits": 0, "git_pushes": 0, "input_tokens": 10, "output_tokens": 20,
  "first_prompt": "hi", "user_interruptions": 0, "user_response_times": [],
  "tool_errors": 0, "tool_error_categories": {}, "uses_task_agent": false,
  "uses_mcp": false, "uses_web_search": false, "uses_web_fetch": false,
  "lines_added": 0, "lines_removed": 0, "files_modified": 0, "message_hours": [],
  "user_message_timestamps": [], "harness": "claude" }
JSON
cp /tmp/agentistics-team/devA/sessions/s1.json /tmp/agentistics-team/devB/sessions/s2.json
AGENTISTICS_TEAM_DIR=/tmp/agentistics-team bun -e "import('./packages/server/server/team-source').then(async m => { const r = await m.loadTeamSessions(); console.log(r.map(s => [s.session_id, s.user])); })"
```

Expected output: `[ [ "s1", "devA" ], [ "s2", "devB" ] ]`

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/config.ts packages/server/server/team-source.ts packages/server/server/data.ts
git commit -m "feat(server): union per-user team sessions from shared folder in team mode"
```

---

## Task 3: Apply the `user` filter in derived stats (web)

**Files:**
- Modify: `packages/web/src/hooks/useData.ts` (`useDerivedStats`: import line ~13, lines 488-494 and 511-516 and 572)

**Interfaces:**
- Consumes: `filterByUsers` from `@agentistics/core`; `Filters.users`, `SessionMeta.user` (from Task 1).
- Produces: `useDerivedStats` now excludes sessions whose `user` is not in `filters.users` (when non-empty), and counts `userFiltered` toward `sessionFiltered` so totals come from per-session sums.

> **No new unit test in this task.** The `user`-selection logic is the pure
> `filterByUsers` helper, already fully tested in `packages/core/src/team.test.ts`
> (Task 1). This task only wires that tested helper into the hook — exactly
> mirroring how `filterByHarness` is applied as a pre-filter at line 494 and
> tested separately, not via the hook. `useDerivedStats` is a React hook
> (`useMemo`); the repo has no `@testing-library/react` and does not unit-test
> the hook directly. Verification here is `tsc` + the full suite staying green;
> behavioral verification happens in Task 4 Step 6 (manual browser check).

- [ ] **Step 1: Import `filterByUsers` and apply it as a pre-filter**

In `packages/web/src/hooks/useData.ts`, the existing `@agentistics/core` import near the top of the file (~line 13) already pulls in shared helpers. Add `filterByUsers` to that import list (keep the other named imports intact), e.g.:

```ts
import { calcCost, blendedCostPerToken, filterByUsers, /* …existing… */ } from '@agentistics/core'
```

> If `filterByUsers` is not in the `@agentistics/core` import there, add it to whichever existing `from '@agentistics/core'` import already brings in `calcCost`/`blendedCostPerToken`.

Then, just after line 490 (`const projectSet = new Set(projects)`), add the user-filter state:

```ts
    const projectSet = new Set(projects)
    const users = filters.users ?? []
    const userFiltered = users.length > 0
```

Apply `filterByUsers` as a pre-filter on top of the harness pre-filter. Replace the `harnessSessions` line (currently line 494) so the user filter composes on top of it, mirroring how harness is pre-filtered:

```ts
    // ── Harness filter — applied first so all downstream filters compose on top ──
    const harnessSessions = filterByUsers(filterByHarness(data.sessions, filters.harness), users)
```

(`filterByUsers` with an empty `users` array is a pass-through, so Solo mode is unaffected.)

- [ ] **Step 2: Count `userFiltered` toward `sessionFiltered`**

Include `userFiltered` in the `sessionFiltered` decision on line 572 so totals come from per-session sums when a user filter is active:

```ts
    const sessionFiltered = projectFiltered || modelSet !== null || nonClaudeHarness || userFiltered
```

- [ ] **Step 3: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full suite (no regression)**

Run: `bun test`
Expected: all existing tests still PASS. (The `user`-selection logic itself is
already covered by `packages/core/src/team.test.ts` from Task 1; this task wires
that tested helper in. Behavioral verification of the wired hook happens in
Task 4 Step 6.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useData.ts
git commit -m "feat(web): apply multi-select user filter in derived stats"
```

---

## Task 4: User filter UI (compact dropdown) + wiring

**Files:**
- Create: `packages/web/src/components/UsersFilter.tsx`
- Modify: `packages/web/src/lib/app-context.ts` (after line 58)
- Modify: `packages/web/src/App.tsx` (users memo near the `sessionCountByProject` memo ~line 1343; Outlet value ~line 1966)
- Modify: `packages/web/src/components/FiltersBar.tsx` (props + render near the projects trigger ~line 225)

**Interfaces:**
- Consumes: `distinctUsers` from `@agentistics/core`; `filters.users` + `setFilters`; `AppContext.users`.
- Produces:
  - `<UsersFilter users={string[]} selected={string[]} onChange={(users: string[]) => void} lang={'pt'|'en'} />`
  - `AppContext.users: string[]` (distinct users present in the data; `[]` in Solo mode).

> UI rendering is verified by typecheck + `bun run build` + a manual browser check — not unit tested.

- [ ] **Step 1: Create the dropdown component**

Create `packages/web/src/components/UsersFilter.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react'
import { Users, Check, ChevronDown } from 'lucide-react'

interface Props {
  users: string[]
  selected: string[]
  onChange: (users: string[]) => void
  lang: 'pt' | 'en'
}

const T = {
  pt: { all: 'Todos os devs', selected: 'devs', selectAll: 'Selecionar tudo', clear: 'Limpar' },
  en: { all: 'All devs', selected: 'devs', selectAll: 'Select all', clear: 'Clear' },
} as const

export function UsersFilter({ users, selected, onChange, lang }: Props) {
  const t = T[lang]
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  function toggle(user: string) {
    if (selected.includes(user)) onChange(selected.filter(u => u !== user))
    else onChange([...selected, user])
  }

  const label = selected.length === 0 ? t.all : `${selected.length} ${t.selected}`
  const active = selected.length > 0

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 8,
          border: '1px solid var(--border)',
          background: active ? 'var(--anthropic-orange-dim, rgba(205,93,56,0.12))' : 'var(--bg-elevated)',
          color: active ? 'var(--anthropic-orange, #cd5d38)' : 'var(--text-secondary)',
          fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <Users size={14} />
        <span>{label}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 600,
          minWidth: 200, maxHeight: 320, overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.4)', padding: 6,
        }}>
          <div style={{ display: 'flex', gap: 6, padding: '4px 6px 8px' }}>
            <button
              onClick={() => onChange(users)}
              style={miniBtn}
            >{t.selectAll}</button>
            <button
              onClick={() => onChange([])}
              style={miniBtn}
            >{t.clear}</button>
          </div>
          {users.map(user => {
            const isSel = selected.includes(user)
            return (
              <div
                key={user}
                onClick={() => toggle(user)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  background: isSel ? 'var(--anthropic-orange-dim, rgba(205,93,56,0.07))' : 'transparent',
                }}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)' }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: isSel ? '1.5px solid var(--anthropic-orange, #cd5d38)' : '1.5px solid var(--border)',
                  background: isSel ? 'var(--anthropic-orange, #cd5d38)' : 'transparent',
                }}>
                  {isSel && <Check size={11} color="#fff" strokeWidth={3} />}
                </div>
                <span style={{
                  fontSize: 13, color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{user}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  flex: 1, padding: '5px 8px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', fontSize: 11, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
}
```

- [ ] **Step 2: Expose `users` on AppContext**

In `packages/web/src/lib/app-context.ts`, add a field inside the "filter bar data" block right after `modelsInProject` (line 58):

```ts
  modelsInProject: Set<string> | null
  /** Distinct users present in the data (team mode). Empty in Solo mode. */
  users: string[]
```

- [ ] **Step 3: Compute the `users` memo and pass it through the Outlet**

In `packages/web/src/App.tsx`, add `distinctUsers` to the existing `@agentistics/core` import, then add a memo near the `sessionCountByProject` memo (~line 1343):

```ts
  const users = useMemo(() => (data ? distinctUsers(data.sessions) : []), [data])
```

Then add `users` to the Outlet `context={{ ... }}` object (~line 1966), next to `sessionCountByProject`:

```tsx
        sessionCountByProject, models, modelGroups, modelsInProject, users,
```

- [ ] **Step 4: Render `UsersFilter` in FiltersBar**

In `packages/web/src/components/FiltersBar.tsx`:

(a) Import the component near the other component imports:

```ts
import { UsersFilter } from './UsersFilter'
```

(b) Add `users` to the FiltersBar `Props` interface (mirror how `models`/`sessionCountByProject` are declared) and to the destructured props. The component already receives `filters`, `onChange`, and `lang`. Add:

```ts
  users: string[]
```

(c) Render the filter right before the projects trigger button (~line 225), only when team users exist:

```tsx
        {users.length > 0 && (
          <UsersFilter
            users={users}
            selected={filters.users ?? []}
            onChange={u => onChange({ ...filters, users: u })}
            lang={lang}
          />
        )}
```

(d) At the two `FiltersBar` render sites in `App.tsx` (~lines 1889 and 1926), pass the new prop:

```tsx
          users={users}
```

(If `FiltersBar` is also rendered from `CustomPage` via the Outlet context, read `users` from `useOutletContext<AppContext>()` there and pass it the same way.)

- [ ] **Step 5: Typecheck + build**

Run: `bun tsc --noEmit`
Expected: no errors.

Run: `bun run build`
Expected: Vite build succeeds.

- [ ] **Step 6: Manual browser verification**

```bash
# Terminal A — start dev with team fixtures from Task 2 Step 6 present
AGENTISTICS_TEAM=1 AGENTISTICS_TEAM_DIR=/tmp/agentistics-team bun run dev
```

In the browser (UI at the dev port): confirm a "All devs" dropdown appears in the filters bar; selecting `devA` drops the totals to that dev's sessions; selecting `devA + devB` shows their combined totals; clearing returns to the team total. (The fixtures from Task 2 are minimal — the goal is that the filter visibly changes session counts.)

- [ ] **Step 7: Run the full suite**

Run: `bun test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/components/UsersFilter.tsx packages/web/src/lib/app-context.ts packages/web/src/App.tsx packages/web/src/components/FiltersBar.tsx
git commit -m "feat(web): add multi-select user filter dropdown to the dashboard"
```

---

## Self-Review

**Spec coverage (Phase 1 scope only):**
- `user` field on sessions → Task 1 (types) + Task 2 (server tags it).
- Central behaves as if all `.claude` present, fed by folder → Task 2 (`loadTeamSessions` folder union, `AGENTISTICS_TEAM`).
- View dev A / A+B / A+B+C / total → Task 3 (multi-select predicate) + Task 4 (UI).
- Totals emerge from per-session sums, nothing pre-aggregated → Task 3 reuses `sessionFiltered` path; no rollups introduced.
- Purely additive / Solo unchanged → `TEAM_MODE` gates the merge; filter UI only renders when `users.length > 0`; `user`/`users` are optional fields.
- Out of Phase 1 (deferred to later phases, intentionally NOT in this plan): Mongo source, ingestion API + uploader, security/login/token admin, autostart, Docker packaging, mode-selector UI + badge.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output. The two "mirror the existing pattern" notes (FiltersBar Props in Task 4 Step 4b; renderHook fallback in Task 3 Step 1) point at concrete existing code and include the exact field/assertion to add.

**Type consistency:** `tagUser`/`distinctUsers`/`filterByUsers` signatures match between Task 1 (definition) and Tasks 2-4 (use). `Filters.users?: string[]` and `SessionMeta.user?: string` are referenced consistently. `AppContext.users: string[]` matches the App.tsx memo and the FiltersBar prop. The dedup key change is the only edit to existing behavior and is backward-compatible (empty `user` prefix).
