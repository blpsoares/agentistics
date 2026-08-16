# Sessions tab, Workflows tab, central chat-privacy cut & presence filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local Sessions tab and a detailed Workflows tab, remove the central's ability to view member chat content end-to-end, and fix the central members filter so it respects the active presence filter.

**Architecture:** Four independent phases. Phase A (Sessions tab) and Phase D (presence filter) are frontend-only. Phase B (chat-privacy cut) removes a frontend block plus a server route and the reverse-channel chat handlers. Phase C (Workflows tab) adds a new server parser module (`workflow-metrics.ts`), new core types, consolidate persistence, and a new frontend page — reading workflow data Claude Code already writes to disk.

**Tech Stack:** Bun, TypeScript (strict), React + Vite, react-router-dom (lazy routes), `@agentistics/core` for pricing/types, `bun test` for unit tests.

## Global Constraints

- **Language:** All code, comments, and commit messages in **English** (project convention).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, etc.). Commit messages themselves in English per this project's override of the global PT preference.
- **Pricing:** Never inline pricing math — always use `calcCost` / `getModelPrice` / `MODEL_PRICING` from `@agentistics/core`.
- **Server modules never imported from `packages/web/src/`** and vice-versa.
- **Tests:** Pure functions only, no filesystem mocking. `bun test`.
- **Pre-commit hook** runs `bun tsc --noEmit` + `bun test`; every commit must pass both.
- **Env gates:** honor `AGENTISTICS_ARCHIVE=0` for any consolidate persistence.
- **Live threshold constant:** `LIVE_THRESHOLD_MIN = 10`. **Default recent count:** `5`, options `[5, 10, 20, 50]`.

---

## Phase A — Sessions tab (local)

New route `/sessions`, hidden on central. Lists live sessions (heuristic) + N most recent, each with path and a copy-ready resume command.

### Task A1: `lastActivityOf` + `isLive` helpers (pure, tested)

**Files:**
- Create: `packages/web/src/lib/sessionLive.ts`
- Test: `packages/web/src/lib/sessionLive.test.ts`

**Interfaces:**
- Produces:
  - `lastActivityMs(s: SessionMeta): number` — epoch ms of last activity (`end_time` → last `user_message_timestamps` → `start_time`; `0` if none parseable).
  - `isLive(s: SessionMeta, nowMs: number, thresholdMin?: number): boolean` — true when `nowMs - lastActivityMs(s) <= thresholdMin*60_000` and `lastActivityMs > 0`.
  - `LIVE_THRESHOLD_MIN = 10`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/sessionLive.test.ts
import { test, expect } from 'bun:test'
import { lastActivityMs, isLive, LIVE_THRESHOLD_MIN } from './sessionLive'
import type { SessionMeta } from '@agentistics/core'

function base(over: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: 's', project_path: '/p', start_time: '2026-07-07T10:00:00Z',
    duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    first_prompt: '', user_interruptions: 0, user_response_times: [], tool_errors: 0,
    tool_error_categories: {}, uses_task_agent: false, uses_mcp: false,
    uses_web_search: false, uses_web_fetch: false, lines_added: 0, lines_removed: 0,
    files_modified: 0, message_hours: [], user_message_timestamps: [],
    harness: 'claude', ...over,
  }
}

test('lastActivityMs prefers end_time', () => {
  const s = base({ end_time: '2026-07-07T12:00:00Z', start_time: '2026-07-07T10:00:00Z' })
  expect(lastActivityMs(s)).toBe(Date.parse('2026-07-07T12:00:00Z'))
})

test('lastActivityMs falls back to last user timestamp then start', () => {
  const s = base({ end_time: undefined, user_message_timestamps: ['2026-07-07T10:30:00Z', '2026-07-07T11:00:00Z'] })
  expect(lastActivityMs(s)).toBe(Date.parse('2026-07-07T11:00:00Z'))
  const s2 = base({ end_time: undefined, user_message_timestamps: [] })
  expect(lastActivityMs(s2)).toBe(Date.parse('2026-07-07T10:00:00Z'))
})

test('isLive true within threshold, false outside', () => {
  const now = Date.parse('2026-07-07T12:00:00Z')
  const liveS = base({ end_time: '2026-07-07T11:55:00Z' })
  const deadS = base({ end_time: '2026-07-07T11:30:00Z' })
  expect(isLive(liveS, now, LIVE_THRESHOLD_MIN)).toBe(true)
  expect(isLive(deadS, now, LIVE_THRESHOLD_MIN)).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/web/src/lib/sessionLive.test.ts`
Expected: FAIL — cannot find module `./sessionLive`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/sessionLive.ts
import type { SessionMeta } from '@agentistics/core'

export const LIVE_THRESHOLD_MIN = 10

/** Epoch ms of the session's last activity: end_time → last user timestamp → start_time. 0 if none. */
export function lastActivityMs(s: SessionMeta): number {
  const candidates: string[] = []
  if (s.end_time) candidates.push(s.end_time)
  const ts = s.user_message_timestamps
  if (ts && ts.length > 0) candidates.push(ts[ts.length - 1]!)
  if (s.start_time) candidates.push(s.start_time)
  for (const c of candidates) {
    const t = Date.parse(c)
    if (!Number.isNaN(t)) return t
  }
  return 0
}

export function isLive(s: SessionMeta, nowMs: number, thresholdMin: number = LIVE_THRESHOLD_MIN): boolean {
  const last = lastActivityMs(s)
  if (last <= 0) return false
  return nowMs - last <= thresholdMin * 60_000
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/web/src/lib/sessionLive.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/sessionLive.ts packages/web/src/lib/sessionLive.test.ts
git commit -m "feat(sessions): add live-session heuristic helpers"
```

### Task A2: `resumeCommand` helper (pure, tested)

**Files:**
- Create: `packages/web/src/lib/resumeCommand.ts`
- Test: `packages/web/src/lib/resumeCommand.test.ts`

**Interfaces:**
- Produces: `resumeCommand(s: SessionMeta): string | null` — Claude → `cd <project_path> && claude --resume <session_id>`; any other harness → `null` (path shown separately, no fabricated command).

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/resumeCommand.test.ts
import { test, expect } from 'bun:test'
import { resumeCommand } from './resumeCommand'
import type { SessionMeta, HarnessId } from '@agentistics/core'

function s(harness: HarnessId): SessionMeta {
  return { session_id: 'abc-123', project_path: '/home/u/proj', harness } as SessionMeta
}

test('claude yields cd + claude --resume', () => {
  expect(resumeCommand(s('claude'))).toBe('cd /home/u/proj && claude --resume abc-123')
})

test('non-claude harnesses yield null', () => {
  expect(resumeCommand(s('codex'))).toBeNull()
  expect(resumeCommand(s('gemini'))).toBeNull()
  expect(resumeCommand(s('copilot'))).toBeNull()
})

test('claude without project_path still resumes without cd', () => {
  const noPath = { session_id: 'x', project_path: '', harness: 'claude' } as SessionMeta
  expect(resumeCommand(noPath)).toBe('claude --resume x')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/web/src/lib/resumeCommand.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/resumeCommand.ts
import type { SessionMeta } from '@agentistics/core'

/** Copy-ready shell command to resume a session. Claude only; null for other harnesses. */
export function resumeCommand(s: SessionMeta): string | null {
  if (s.harness !== 'claude') return null
  const resume = `claude --resume ${s.session_id}`
  return s.project_path ? `cd ${s.project_path} && ${resume}` : resume
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/web/src/lib/resumeCommand.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/resumeCommand.ts packages/web/src/lib/resumeCommand.test.ts
git commit -m "feat(sessions): add resume-command helper"
```

### Task A3: `SessionsPage` component + route + nav

**Files:**
- Create: `packages/web/src/pages/SessionsPage.tsx`
- Modify: `packages/web/src/AppRouter.tsx` (add lazy import + `<Route path="sessions" …>`)
- Modify: `packages/web/src/App.tsx` — `NavTabs` tabs list (~line 823) and `MobileBottomNav` `navTiles` (~line 648); both gated to hide on central.

**Interfaces:**
- Consumes: `useOutletContext<AppContext>()` → `derived.filteredSessions`, `lang`, `currency`, `brlRate`, `setSelectedSession`, `data`.
- Consumes: `lastActivityMs`, `isLive`, `LIVE_THRESHOLD_MIN` (A1); `resumeCommand` (A2).
- The page reads `teamSession.central` indirectly: the nav entry is hidden on central, and the page renders an empty-state note if opened on a central.

- [ ] **Step 1: Create `SessionsPage.tsx`**

```tsx
// packages/web/src/pages/SessionsPage.tsx
import React, { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Clock, Radio, Copy, Check } from 'lucide-react'
import type { SessionMeta } from '@agentistics/core'
import { sessionLabel } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { Section } from '../components/Section'
import { RecentSessions } from '../components/RecentSessions'
import { isLive, lastActivityMs, LIVE_THRESHOLD_MIN } from '../lib/sessionLive'
import { resumeCommand } from '../lib/resumeCommand'

const COUNT_OPTIONS = [5, 10, 20, 50] as const
const COUNT_KEY = 'agentistics-sessions-recent-count'

export default function SessionsPage() {
  const ctx = useOutletContext<AppContext>()
  const { derived, lang, setSelectedSession } = ctx
  const pt = lang === 'pt'

  const [count, setCount] = useState<number>(() => {
    const raw = Number(localStorage.getItem(COUNT_KEY))
    return COUNT_OPTIONS.includes(raw as 5) ? raw : 5
  })
  function pickCount(n: number) { setCount(n); localStorage.setItem(COUNT_KEY, String(n)) }

  const nowMs = Date.now()
  const sorted = useMemo(
    () => [...derived.filteredSessions].sort((a, b) => lastActivityMs(b) - lastActivityMs(a)),
    [derived.filteredSessions],
  )
  const live = useMemo(() => sorted.filter(s => isLive(s, nowMs, LIVE_THRESHOLD_MIN)), [sorted, nowMs])
  // Recent excludes the ones already shown as live (no duplication).
  const liveIds = new Set(live.map(s => s.session_id))
  const recent = useMemo(
    () => sorted.filter(s => !liveIds.has(s.session_id)).slice(0, count),
    [sorted, count],
  )

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--anthropic-orange)' }}><Clock size={16} /></span>
          {pt ? 'Sessões' : 'Sessions'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {pt
            ? `Sessões ao vivo (ativas nos últimos ${LIVE_THRESHOLD_MIN} min) e as mais recentes, com comando para retomar.`
            : `Live sessions (active in the last ${LIVE_THRESHOLD_MIN} min) and your most recent ones, with a resume command.`}
        </div>
      </div>

      <Section flashId="live-sessions" title={<><Radio size={14} /> {pt ? 'Ao vivo' : 'Live'} {live.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({live.length})</span>}</>}>
        {live.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 2px' }}>{pt ? 'Nenhuma sessão ativa agora.' : 'No active sessions right now.'}</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {live.map(s => <LiveCard key={s.session_id} s={s} pt={pt} onOpen={() => setSelectedSession(s)} />)}
            </div>}
      </Section>

      <Section
        flashId="recent-sessions"
        title={<><Clock size={14} /> {pt ? 'Recentes' : 'Recent'}</>}
        headerRight={
          <div style={{ display: 'flex', gap: 4 }}>
            {COUNT_OPTIONS.map(n => (
              <button key={n} onClick={() => pickCount(n)} style={{
                padding: '3px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                border: '1px solid var(--border)',
                background: count === n ? 'var(--anthropic-orange-dim, rgba(205,93,56,0.12))' : 'var(--bg-elevated)',
                color: count === n ? 'var(--anthropic-orange, #cd5d38)' : 'var(--text-secondary)',
              }}>{n}</button>
            ))}
          </div>
        }
      >
        <RecentSessions sessions={recent} lang={lang} onSelect={setSelectedSession} />
      </Section>
    </>
  )
}

function LiveCard({ s, pt, onOpen }: { s: SessionMeta; pt: boolean; onOpen: () => void }) {
  const cmd = resumeCommand(s)
  const [copied, setCopied] = useState(false)
  const mins = Math.max(0, Math.round((Date.now() - lastActivityMs(s)) / 60_000))
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-card)' }}>
      <div onClick={onOpen} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.6)', flexShrink: 0 }} />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionLabel(s)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)' }}>{pt ? `há ${mins} min` : `${mins} min ago`}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{s.project_path}</div>
      {cmd
        ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <code style={{ flex: 1, fontSize: 11, background: 'var(--bg-elevated)', padding: '6px 8px', borderRadius: 6, overflowX: 'auto', whiteSpace: 'nowrap' }}>{cmd}</code>
            <button onClick={() => { navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              title={pt ? 'Copiar' : 'Copy'}
              style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 6, padding: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              {copied ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
            </button>
          </div>
        : <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, fontStyle: 'italic' }}>{pt ? 'Retomar não disponível para este harness.' : 'Resume not available for this harness.'}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Verify `Section` accepts `headerRight`; if not, add it**

Run: `grep -n "headerRight\|interface.*Props\|export function Section" packages/web/src/components/Section.tsx`
If `headerRight` is not a prop, add it to `Section`'s props and render it on the right of the header row. If a different prop name exists for right-aligned header content, use that name instead and adjust Step 1.

- [ ] **Step 3: Add the lazy route**

In `packages/web/src/AppRouter.tsx`, add after line 11 (`ExportPage`):
```tsx
const SessionsPage = lazy(() => import('./pages/SessionsPage'))
```
And add inside `<Route element={<AppLayout />}>` (after the `costs` route, line 30):
```tsx
<Route path="sessions" element={<Suspense fallback={<PageFallback />}><SessionsPage /></Suspense>} />
```

- [ ] **Step 4: Add nav entries (hidden on central)**

In `packages/web/src/App.tsx` `NavTabs` (the `tabs` array ~line 823), add after the Home entry, gated on not-central. `NavTabs` currently receives `{ lang, harnesses }`; thread an `isCentral?: boolean` prop into it from where it is rendered (the header already computes `isCentral` at ~line 922 — pass it down). Then:
```tsx
...(isCentral ? [] : [{ to: '/sessions', labelPt: 'Sessões', labelEn: 'Sessions', icon: <Clock size={12} /> }]),
```
Import `Clock` from `lucide-react` if not already imported in App.tsx. Also add to `MobileBottomNav` `navTiles` (~line 648), gated `...(isCentral ? [] : [{ key: 'sessions', label: pt ? 'Sessões' : 'Sessions', icon: Clock, onClick: () => { setMoreOpen(false); navigate('/sessions') }, active: location.pathname.startsWith('/sessions') } as Tile])`. `MobileBottomNav` already receives `isCentral` (line 620).

- [ ] **Step 5: Typecheck + manual verify**

Run: `bun tsc --noEmit`
Expected: no errors.
Then `bun run dev`, open `http://localhost:47292/sessions` — Live + Recent render; count buttons switch 5/10/20/50; resume command copies. Confirm the Sessions tab is **absent** when running as a central.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/SessionsPage.tsx packages/web/src/AppRouter.tsx packages/web/src/App.tsx packages/web/src/components/Section.tsx
git commit -m "feat(sessions): add local Sessions tab with live + recent lists"
```

---

## Phase B — Central chat-privacy cut (end-to-end)

Remove the central's ability to view member conversation content: the frontend chat block, the server route, and the reverse-channel chat handlers. Metadata cards + drilldown metrics stay.

### Task B1: Remove `RemoteSessionChat` from the drilldown (frontend)

**Files:**
- Modify: `packages/web/src/components/SessionDrilldownModal.tsx`

**Interfaces:**
- Removes: the `{central && session.user && <RemoteSessionChat .../>}` block (~line 608) and the `RemoteSessionChat` component + its fetch helper (~lines 623–760). Hide the "View transcript" button (~line 261) when `central`.

- [ ] **Step 1: Locate the exact block**

Run: `grep -n "RemoteSessionChat\|session-chat\|View transcript\|open-transcript\|central" packages/web/src/components/SessionDrilldownModal.tsx`

- [ ] **Step 2: Delete the render block and the component**

Remove the JSX `{central && session.user && <RemoteSessionChat session={session} pt={pt} />}` and delete the entire `RemoteSessionChat` function component and any local `fetch('/api/team/session-chat…')` helper it uses. Remove now-unused imports (e.g. `MessageBubble` if only used there — verify with grep before removing).

- [ ] **Step 3: Gate the "View transcript" button on `!central`**

Wrap the transcript button (the one dispatching `agentistics:open-transcript`) so it only renders when `!central`.

- [ ] **Step 4: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors (fix any dangling references to the removed component/props).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/SessionDrilldownModal.tsx
git commit -m "feat(central): remove member chat view from session drilldown"
```

### Task B2: Return 410 for the chat route + drop the ADMIN_PATHS entry (server)

**Files:**
- Modify: `packages/server/server/index.ts` (~line 1128 route, ~line 131 `ADMIN_PATHS`, ~line 42 import)

- [ ] **Step 1: Locate**

Run: `grep -n "session-chat\|handleSessionChat\|ADMIN_PATHS" packages/server/server/index.ts`

- [ ] **Step 2: Replace the route body with a 410**

Replace the `GET /api/team/session-chat` handler so it always returns HTTP **410 Gone** with a small JSON body `{ ok: false, error: 'chat_disabled' }`, regardless of `TEAM_CENTRAL`. Remove the `handleSessionChat` import (line ~42) and the `/api/team/session-chat` entry in `ADMIN_PATHS` (line ~131).

- [ ] **Step 3: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/server/index.ts
git commit -m "feat(central): 410 the team session-chat route"
```

### Task B3: Remove chat handlers from the reverse channel (server)

**Files:**
- Modify: `packages/server/server/team-agent.ts` (remove `handleSessionChat`, `requestChat`, `chat-result` resolution; keep presence/ping/pong + agent registration)
- Modify: `packages/server/server/team-agent-client.ts` (remove `fetch-chat` handler ~line 121 and `fetchLocalMessages` ~line 33)

- [ ] **Step 1: Locate**

Run: `grep -n "handleSessionChat\|requestChat\|chat-result\|fetch-chat\|fetchLocalMessages\|readLocalMessages" packages/server/server/team-agent.ts packages/server/server/team-agent-client.ts`

- [ ] **Step 2: Remove central-side chat functions**

In `team-agent.ts` delete `handleSessionChat`, `requestChat`, `readLocalMessages`, and the pending-request map + `chat-result` case in `onAgentMessage`. Keep everything for presence, ping/pong RTT, and `registerAgent`.

- [ ] **Step 3: Remove member-side chat responder**

In `team-agent-client.ts` delete the `fetch-chat` message handler and `fetchLocalMessages` (and now-unused imports like `getClaudeSessionMessages`/`getCodexSessionMessages` if only used there — verify with grep). Keep presence/ping handling.

- [ ] **Step 4: Typecheck + focused test run**

Run: `bun tsc --noEmit && bun test`
Expected: no type errors; existing tests pass.

- [ ] **Step 5: Manual verify (member + central)**

With a member connected to a central: open a member session in the drilldown on the central — no chat block appears, `GET /api/team/session-chat` returns 410, presence pill still shows online/latency (reverse channel still alive).

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/team-agent.ts packages/server/server/team-agent-client.ts
git commit -m "feat(central): remove on-demand chat over the reverse channel"
```

---

## Phase C — Workflows tab

Parse Workflow-tool runs from disk into `WorkflowRun`, persist to the consolidate store, and render a detailed `/workflows` page.

### Task C1: `WorkflowRun` types in core

**Files:**
- Modify: `packages/core/src/types.ts` (add types after `SessionAgentMetrics`, ~line 142)
- Modify: `packages/core/src/index.ts` (types are re-exported via `export * from './types'` — verify; no change if already barrel-exported)

**Interfaces:**
- Produces:
```ts
export interface WorkflowAgent {
  label: string
  phase: string
  model: string
  status: 'completed' | 'failed' | 'skipped'
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheWrite: number
  costUSD: number
  toolStats?: {
    readCount: number; searchCount: number; bashCount: number
    editFileCount: number; linesAdded: number; linesRemoved: number; otherToolCount: number
  }
}
export interface WorkflowPhase { title: string; agentCount: number }
export interface WorkflowRun {
  runId: string
  name: string
  sessionId: string
  status: 'completed' | 'failed' | 'partial'
  startedAt: string        // ISO; '' if unknown
  durationMs: number
  phases: WorkflowPhase[]
  agents: WorkflowAgent[]
  totals: { agentCount: number; tokensIn: number; tokensOut: number; costUSD: number; durationMs: number; toolUses: number }
}
```

- [ ] **Step 1: Add the interfaces to `types.ts`** (exact code above).

- [ ] **Step 2: Add `workflows?: WorkflowRun[]` to `AppData`** (in the `AppData` interface, ~line 210).

- [ ] **Step 3: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(workflows): add WorkflowRun core types"
```

### Task C2: Script parser — phases, labels, model per agent (pure, tested)

**Files:**
- Create: `packages/server/server/workflow-script.ts`
- Test: `packages/server/server/workflow-script.test.ts`

**Interfaces:**
- Produces:
  - `parseWorkflowScript(script: string): { name: string; phases: string[]; agents: { label: string; phase: string; model: string }[] }`
  - Reads `meta.name`, `meta.phases[].title`, and each `agent(prompt, { label, phase, model })` call's literal options. Best-effort regex over the saved JS; missing fields default to `''`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/workflow-script.test.ts
import { test, expect } from 'bun:test'
import { parseWorkflowScript } from './workflow-script'

const SCRIPT = `
export const meta = {
  name: 'review-changes',
  description: 'x',
  phases: [ { title: 'Review' }, { title: 'Verify' } ],
}
await agent('do review', { label: 'review:bugs', phase: 'Review', model: 'claude-sonnet-5' })
await agent('verify it', { label: 'verify:bugs', phase: 'Verify' })
`

test('extracts name and phase titles', () => {
  const r = parseWorkflowScript(SCRIPT)
  expect(r.name).toBe('review-changes')
  expect(r.phases).toEqual(['Review', 'Verify'])
})

test('extracts agent label/phase/model with defaults', () => {
  const r = parseWorkflowScript(SCRIPT)
  expect(r.agents).toEqual([
    { label: 'review:bugs', phase: 'Review', model: 'claude-sonnet-5' },
    { label: 'verify:bugs', phase: 'Verify', model: '' },
  ])
})

test('empty script yields empty shape', () => {
  expect(parseWorkflowScript('')).toEqual({ name: '', phases: [], agents: [] })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/workflow-script.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/server/workflow-script.ts
/** Best-effort parse of a saved workflow script (JS text) for display metadata.
 *  Not an evaluator — pure string scanning over the literal `meta` block and agent() calls. */
export function parseWorkflowScript(script: string): {
  name: string
  phases: string[]
  agents: { label: string; phase: string; model: string }[]
} {
  if (!script) return { name: '', phases: [], agents: [] }

  const nameMatch = script.match(/name\s*:\s*['"`]([^'"`]+)['"`]/)
  const name = nameMatch?.[1] ?? ''

  // phases: [{ title: '...' }, ...] — grab the phases array text, then each title.
  const phases: string[] = []
  const phasesBlock = script.match(/phases\s*:\s*\[([\s\S]*?)\]/)
  if (phasesBlock) {
    const re = /title\s*:\s*['"`]([^'"`]+)['"`]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(phasesBlock[1]!)) !== null) phases.push(m[1]!)
  }

  // agent(<prompt>, { ...opts }) — scan each opts object for label/phase/model literals.
  const agents: { label: string; phase: string; model: string }[] = []
  const agentRe = /agent\s*\([\s\S]*?\{([\s\S]*?)\}\s*\)/g
  let a: RegExpExecArray | null
  while ((a = agentRe.exec(script)) !== null) {
    const opts = a[1]!
    const pick = (k: string) => opts.match(new RegExp(k + "\\s*:\\s*['\"`]([^'\"`]+)['\"`]"))?.[1] ?? ''
    const label = pick('label')
    const phase = pick('phase')
    const model = pick('model')
    if (label || phase || model) agents.push({ label, phase, model })
  }

  return { name, phases, agents }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/workflow-script.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/workflow-script.ts packages/server/server/workflow-script.test.ts
git commit -m "feat(workflows): parse workflow script for phases/labels/model"
```

### Task C3: `<usage>` task-notification parser (pure, tested)

**Files:**
- Create: `packages/server/server/workflow-usage.ts`
- Test: `packages/server/server/workflow-usage.test.ts`

**Interfaces:**
- Produces: `parseWorkflowUsage(text: string): { agentCount: number; agentsDone: number; agentsError: number; agentsSkipped: number; subagentTokens: number; toolUses: number; durationMs: number } | null` — parses the `<usage>…</usage>` block embedded in a `<task-notification>` string. `null` if no `<usage>` block present.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/workflow-usage.test.ts
import { test, expect } from 'bun:test'
import { parseWorkflowUsage } from './workflow-usage'

const NOTE = `<task-notification><result>{}</result>
<usage><agent_count>5</agent_count><agents_done>4</agents_done><agents_error>1</agents_error><agents_skipped>0</agents_skipped><subagent_tokens>123456</subagent_tokens><tool_uses>42</tool_uses><duration_ms>98765</duration_ms></usage></task-notification>`

test('parses usage block', () => {
  expect(parseWorkflowUsage(NOTE)).toEqual({
    agentCount: 5, agentsDone: 4, agentsError: 1, agentsSkipped: 0,
    subagentTokens: 123456, toolUses: 42, durationMs: 98765,
  })
})

test('returns null without usage block', () => {
  expect(parseWorkflowUsage('no usage here')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/workflow-usage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/server/workflow-usage.ts
/** Parse the <usage> block embedded in a workflow <task-notification> text. */
export function parseWorkflowUsage(text: string): {
  agentCount: number; agentsDone: number; agentsError: number; agentsSkipped: number
  subagentTokens: number; toolUses: number; durationMs: number
} | null {
  const block = text.match(/<usage>([\s\S]*?)<\/usage>/)
  if (!block) return null
  const b = block[1]!
  const num = (tag: string) => {
    const m = b.match(new RegExp(`<${tag}>\\s*(\\d+)\\s*</${tag}>`))
    return m ? parseInt(m[1]!, 10) : 0
  }
  return {
    agentCount: num('agent_count'),
    agentsDone: num('agents_done'),
    agentsError: num('agents_error'),
    agentsSkipped: num('agents_skipped'),
    subagentTokens: num('subagent_tokens'),
    toolUses: num('tool_uses'),
    durationMs: num('duration_ms'),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/workflow-usage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/workflow-usage.ts packages/server/server/workflow-usage.test.ts
git commit -m "feat(workflows): parse task-notification usage block"
```

### Task C4: Per-agent token/cost aggregation from an `agent-*.jsonl` (pure, tested)

**Files:**
- Create: `packages/server/server/workflow-agent.ts`
- Test: `packages/server/server/workflow-agent.test.ts`

**Interfaces:**
- Produces: `aggregateWorkflowAgent(lines: string[]): { model: string; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; costUSD: number }` — sums `usage.*` across assistant messages, takes `model` from the first assistant message, computes cost via `calcCost`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/workflow-agent.test.ts
import { test, expect } from 'bun:test'
import { aggregateWorkflowAgent } from './workflow-agent'

const LINES = [
  JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } }),
  JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 200, output_tokens: 80 } } }),
  JSON.stringify({ type: 'user', message: { content: 'hi' } }),
]

test('sums usage across assistant messages and keeps first model', () => {
  const r = aggregateWorkflowAgent(LINES)
  expect(r.model).toBe('claude-sonnet-5')
  expect(r.tokensIn).toBe(300)
  expect(r.tokensOut).toBe(130)
  expect(r.cacheRead).toBe(10)
  expect(r.cacheWrite).toBe(5)
  expect(r.costUSD).toBeGreaterThan(0)
})

test('empty input yields zeros', () => {
  const r = aggregateWorkflowAgent([])
  expect(r).toEqual({ model: '', tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/workflow-agent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/server/workflow-agent.ts
import { calcCost } from '@agentistics/core'

/** Aggregate one workflow subagent transcript (agent-<id>.jsonl lines) into token/cost totals. */
export function aggregateWorkflowAgent(lines: string[]): {
  model: string; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; costUSD: number
} {
  let model = ''
  let tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }
    if (e.type !== 'assistant') continue
    const msg = e.message as Record<string, unknown> | undefined
    if (!msg) continue
    if (!model && typeof msg.model === 'string') model = msg.model
    const u = (msg.usage ?? {}) as Record<string, number>
    tokensIn += u.input_tokens ?? 0
    tokensOut += u.output_tokens ?? 0
    cacheRead += u.cache_read_input_tokens ?? 0
    cacheWrite += u.cache_creation_input_tokens ?? 0
  }
  const costUSD = (tokensIn + tokensOut + cacheRead + cacheWrite) === 0 ? 0 : calcCost(
    { inputTokens: tokensIn, outputTokens: tokensOut, cacheReadInputTokens: cacheRead, cacheCreationInputTokens: cacheWrite, webSearchRequests: 0, costUSD: 0 },
    model,
  )
  return { model, tokensIn, tokensOut, cacheRead, cacheWrite, costUSD }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/workflow-agent.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/workflow-agent.ts packages/server/server/workflow-agent.test.ts
git commit -m "feat(workflows): aggregate subagent transcript token/cost"
```

### Task C5: `workflow-metrics.ts` — discover + assemble `WorkflowRun[]` from disk

**Files:**
- Create: `packages/server/server/workflow-metrics.ts`

**Interfaces:**
- Consumes: `parseWorkflowScript` (C2), `parseWorkflowUsage` (C3), `aggregateWorkflowAgent` (C4), core `WorkflowRun`/`WorkflowAgent`.
- Produces:
  - `extractWorkflowRuns(sessionLines: string[], sessionId: string, workflowsDir: string): Promise<WorkflowRun[]>` — from the main session JSONL lines, find each `toolUseResult.taskType === 'local_workflow'` (giving `runId`, `workflowName`, `scriptPath`) and the following `<task-notification>` text; read `subagents/workflows/<runId>/` for the script + `agent-*.jsonl` files; assemble a `WorkflowRun`.
  - `readWorkflowRunsForSession(sessionDir: string, sessionId: string): Promise<WorkflowRun[]>` — convenience wrapper that reads the main `<sessionId>.jsonl` (or the session subdir) and `subagents/workflows/`.

- [ ] **Step 1: Implement the module**

```ts
// packages/server/server/workflow-metrics.ts
import { join } from 'path'
import { readFile } from 'fs/promises'
import type { WorkflowRun, WorkflowAgent } from '@agentistics/core'
import { safeReadDir } from './utils'
import { parseWorkflowScript } from './workflow-script'
import { parseWorkflowUsage } from './workflow-usage'
import { aggregateWorkflowAgent } from './workflow-agent'

interface DiscoveredRun {
  runId: string
  name: string
  scriptPath?: string
  startedAt: string
  notificationText: string
}

/** Scan the main session JSONL for workflow launches and their task-notifications. */
export function discoverWorkflowLaunches(lines: string[]): DiscoveredRun[] {
  const byRunId = new Map<string, DiscoveredRun>()
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }

    // Launch: user message envelope with toolUseResult.taskType === 'local_workflow'
    const tur = e.toolUseResult as Record<string, unknown> | undefined
    if (tur && tur.taskType === 'local_workflow' && typeof tur.runId === 'string') {
      byRunId.set(tur.runId, {
        runId: tur.runId,
        name: (tur.workflowName as string) ?? '',
        scriptPath: tur.scriptPath as string | undefined,
        startedAt: (e.timestamp as string) ?? '',
        notificationText: '',
      })
    }

    // Completion notification: a message whose text contains <task-notification> with a runId.
    const text = extractText(e)
    if (text && text.includes('<task-notification>')) {
      const runId = text.match(/<run-?id>\s*([^<\s]+)\s*<\/run-?id>/)?.[1]
        ?? text.match(/runId["']?\s*[:=]\s*["']?(wf_[a-z0-9-]+)/i)?.[1]
      if (runId && byRunId.has(runId)) byRunId.get(runId)!.notificationText = text
      else if (!runId && byRunId.size === 1) {
        // Single workflow in the session — attach unambiguously.
        const only = [...byRunId.values()][0]!
        only.notificationText = text
      }
    }
  }
  return [...byRunId.values()]
}

function extractText(e: Record<string, unknown>): string {
  const msg = e.message as Record<string, unknown> | undefined
  const content = msg?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(c => {
      const item = c as Record<string, unknown>
      return typeof item.text === 'string' ? item.text : (typeof item.content === 'string' ? item.content : '')
    }).join('\n')
  }
  return ''
}

/** Assemble WorkflowRun[] for a session given its main JSONL lines and the workflows dir. */
export async function extractWorkflowRuns(
  sessionLines: string[],
  sessionId: string,
  workflowsDir: string,
): Promise<WorkflowRun[]> {
  const launches = discoverWorkflowLaunches(sessionLines)
  const runs: WorkflowRun[] = []

  for (const launch of launches) {
    const runDir = join(workflowsDir, launch.runId)
    const files = await safeReadDir(runDir)

    // Script: prefer scriptPath, else a *.js inside scripts/ or the runDir.
    let scriptText = ''
    if (launch.scriptPath) scriptText = await readFile(launch.scriptPath, 'utf-8').catch(() => '')
    if (!scriptText) {
      const scriptsDir = join(workflowsDir, 'scripts')
      const scriptFiles = (await safeReadDir(scriptsDir)).filter(f => f.includes(launch.runId) && f.endsWith('.js'))
      if (scriptFiles[0]) scriptText = await readFile(join(scriptsDir, scriptFiles[0]), 'utf-8').catch(() => '')
    }
    const parsed = parseWorkflowScript(scriptText)

    // Per-agent transcripts: agent-*.jsonl in the run dir.
    const agentFiles = files.filter(f => /^agent-.*\.jsonl$/.test(f))
    const agents: WorkflowAgent[] = []
    for (let i = 0; i < agentFiles.length; i++) {
      const content = await readFile(join(runDir, agentFiles[i]!), 'utf-8').catch(() => '')
      const agg = aggregateWorkflowAgent(content.split('\n'))
      const meta = parsed.agents[i] // best-effort positional match to planned agents
      agents.push({
        label: meta?.label ?? agentFiles[i]!.replace(/\.jsonl$/, ''),
        phase: meta?.phase ?? '',
        model: agg.model || (meta?.model ?? ''),
        status: 'completed',
        tokensIn: agg.tokensIn, tokensOut: agg.tokensOut,
        cacheRead: agg.cacheRead, cacheWrite: agg.cacheWrite,
        costUSD: agg.costUSD,
      })
    }

    const usage = parseWorkflowUsage(launch.notificationText)
    const phases = parsed.phases.map(title => ({ title, agentCount: agents.filter(a => a.phase === title).length }))
    const status: WorkflowRun['status'] = usage
      ? (usage.agentsError > 0 ? (usage.agentsDone > 0 ? 'partial' : 'failed') : 'completed')
      : 'completed'

    runs.push({
      runId: launch.runId,
      name: parsed.name || launch.name || launch.runId,
      sessionId,
      status,
      startedAt: launch.startedAt,
      durationMs: usage?.durationMs ?? 0,
      phases,
      agents,
      totals: {
        agentCount: usage?.agentCount ?? agents.length,
        tokensIn: agents.reduce((s, a) => s + a.tokensIn, 0),
        tokensOut: agents.reduce((s, a) => s + a.tokensOut, 0),
        costUSD: agents.reduce((s, a) => s + a.costUSD, 0),
        durationMs: usage?.durationMs ?? 0,
        toolUses: usage?.toolUses ?? 0,
      },
    })
  }
  return runs
}
```

- [ ] **Step 2: Add a small unit test for `discoverWorkflowLaunches`**

**Files:** Create `packages/server/server/workflow-metrics.test.ts`
```ts
import { test, expect } from 'bun:test'
import { discoverWorkflowLaunches } from './workflow-metrics'

test('discovers a local_workflow launch by runId', () => {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-07-07T10:00:00Z', toolUseResult: { taskType: 'local_workflow', runId: 'wf_abc123', workflowName: 'review', scriptPath: '/x.js' } }),
  ]
  const r = discoverWorkflowLaunches(lines)
  expect(r.length).toBe(1)
  expect(r[0]!.runId).toBe('wf_abc123')
  expect(r[0]!.name).toBe('review')
})

test('ignores non-workflow toolUseResults', () => {
  const lines = [JSON.stringify({ type: 'user', toolUseResult: { taskType: 'other' } })]
  expect(discoverWorkflowLaunches(lines).length).toBe(0)
})
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/server/server/workflow-metrics.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/workflow-metrics.ts packages/server/server/workflow-metrics.test.ts
git commit -m "feat(workflows): discover and assemble WorkflowRun from disk"
```

### Task C6: Wire discovery into `data.ts` + expose on `AppData` + consolidate persistence

**Files:**
- Modify: `packages/server/server/data.ts` (scan `subagents/workflows/` per session; collect `WorkflowRun[]`; attach to the API response)
- Create: `packages/server/server/workflow-store.ts` (persist/load `WorkflowRun` under `~/.agentistics/workflows/<runId>.json`)
- Modify: `packages/server/server/config.ts` (add `WORKFLOWS_STORE_DIR`)

**Interfaces:**
- Consumes: `extractWorkflowRuns` (C5).
- Produces (`workflow-store.ts`):
  - `writeWorkflowRuns(runs: WorkflowRun[]): Promise<number>` — skip-if-identical, honors `ARCHIVE_ENABLED`.
  - `loadWorkflowRuns(): Promise<Map<string, WorkflowRun>>` — keyed by `runId`.
- Produces: `AppData.workflows` populated (live runs unioned with stored, live wins by `runId`).

- [ ] **Step 1: Add config path**

In `packages/server/server/config.ts` after `CONSOLIDATED_DIR` (line 34):
```ts
export const WORKFLOWS_STORE_DIR = join(HOME_DIR, '.agentistics', 'workflows')
```

- [ ] **Step 2: Create `workflow-store.ts`**

```ts
// packages/server/server/workflow-store.ts
import { join } from 'path'
import { mkdir, writeFile, readFile } from 'fs/promises'
import type { WorkflowRun } from '@agentistics/core'
import { WORKFLOWS_STORE_DIR, ARCHIVE_ENABLED } from './config'
import { createLimiter, safeReadDir, safeReadJson } from './utils'

const writeLimit = createLimiter(20)
let ready = false
async function ensureDir() { if (!ready) { await mkdir(WORKFLOWS_STORE_DIR, { recursive: true }); ready = true } }

/** Persist workflow runs so they survive Claude's 30-day transcript cleanup. Skip-if-identical. */
export async function writeWorkflowRuns(runs: WorkflowRun[]): Promise<number> {
  if (!ARCHIVE_ENABLED || runs.length === 0) return 0
  await ensureDir()
  const counts = await Promise.all(runs.map(r => writeLimit(async () => {
    if (!r.runId) return 0
    const dest = join(WORKFLOWS_STORE_DIR, `${r.runId}.json`)
    const next = JSON.stringify(r)
    const prev = await readFile(dest, 'utf-8').catch(() => null)
    if (prev === next) return 0
    await writeFile(dest, next)
    return 1
  })))
  return counts.reduce<number>((a, b) => a + b, 0)
}

export async function loadWorkflowRuns(): Promise<Map<string, WorkflowRun>> {
  const map = new Map<string, WorkflowRun>()
  const limit = createLimiter(40)
  const files = await safeReadDir(WORKFLOWS_STORE_DIR)
  await Promise.all(files.filter(f => f.endsWith('.json')).map(f => limit(async () => {
    const r = await safeReadJson<WorkflowRun>(join(WORKFLOWS_STORE_DIR, f))
    if (r?.runId && !map.has(r.runId)) map.set(r.runId, r)
  })))
  return map
}
```

- [ ] **Step 3: Collect workflow runs during project scan in `data.ts`**

In the Format-B session directory branch (`data.ts` ~line 240, where `subagentsDir` is computed), after the existing agent-file read, add discovery of the workflows subdir. Because `extractWorkflowRuns` needs the main session JSONL lines, read the session's main transcript (the `<sessionId>.jsonl` in the project dir, or the subdir's first agent file as a fallback) and the `subagents/workflows/` dir:
```ts
// after: const subagentsDir = join(entryPath, 'subagents')
const workflowsDir = join(subagentsDir, 'workflows')
const wfDirs = await safeReadDir(workflowsDir)
if (wfDirs.length > 0) {
  const mainJsonl = join(projDirPath, `${sessionId}.jsonl`)
  const mainContent = await readFile(mainJsonl, 'utf-8').catch(() => '')
  if (mainContent) {
    const { extractWorkflowRuns } = await import('./workflow-metrics')
    const runs = await extractWorkflowRuns(mainContent.split('\n'), sessionId, workflowsDir)
    collectedWorkflowRuns.push(...runs)
  }
}
```
Thread a `collectedWorkflowRuns: WorkflowRun[]` accumulator through the project scan the same way `extraSessions` is accumulated, and return it up to `_buildApiResponseCore`. (Follow the existing `extraSessions` plumbing pattern exactly.)

- [ ] **Step 4: Persist + union in `_buildApiResponseCore`**

Near where `writeConsolidated(sessions)` is called (`data.ts` ~line 597), after collecting live workflow runs:
```ts
const liveWorkflows = collectedWorkflowRuns // gathered from scanProjects
await writeWorkflowRuns(liveWorkflows)
const storedWf = await loadWorkflowRuns()
const wfById = new Map(storedWf)
for (const r of liveWorkflows) wfById.set(r.runId, r) // live wins
const workflows = [...wfById.values()].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
```
Add `workflows` to the returned `AppData`.

- [ ] **Step 5: Typecheck + test**

Run: `bun tsc --noEmit && bun test`
Expected: no errors; all tests pass.

- [ ] **Step 6: Manual verify**

`bun run dev`, hit `http://localhost:47291/api/data`, confirm a `workflows` array is present and non-empty (this repo's `~/.claude` has real workflow runs).

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/config.ts packages/server/server/workflow-store.ts packages/server/server/data.ts
git commit -m "feat(workflows): scan, persist and expose workflow runs on /api/data"
```

### Task C7: `WorkflowsPage` + route + nav + capability

**Files:**
- Create: `packages/web/src/pages/WorkflowsPage.tsx`
- Modify: `packages/web/src/AppRouter.tsx` (lazy import + route)
- Modify: `packages/web/src/App.tsx` (`NavTabs` + `MobileBottomNav` entries — shown only when `data.workflows?.length`)
- Modify: `packages/web/src/lib/app-context.ts` — `AppData` already carries `workflows`; expose via `data` (no change needed, page reads `ctx.data.workflows`).

**Interfaces:**
- Consumes: `ctx.data.workflows: WorkflowRun[]`, `lang`, `currency`, `brlRate`.
- Uses `@agentistics/core` `MODEL_PRICING`/`getModelPrice` for the R$/M column and `fmtCost` for BRL formatting.

- [ ] **Step 1: Create `WorkflowsPage.tsx`**

```tsx
// packages/web/src/pages/WorkflowsPage.tsx
import React, { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Workflow as WorkflowIcon, ChevronDown, ChevronRight } from 'lucide-react'
import type { WorkflowRun } from '@agentistics/core'
import { getModelPrice } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { Section } from '../components/Section'

function brl(usd: number, rate: number) { return `R$ ${(usd * rate).toFixed(2)}` }
function perMillionBRL(model: string, rate: number) {
  const p = getModelPrice(model) // { input, output, ... } USD per 1M
  return `R$ ${((p.input + p.output) / 2 * rate).toFixed(2)}`
}

export default function WorkflowsPage() {
  const ctx = useOutletContext<AppContext>()
  const { data, lang, brlRate } = ctx
  const pt = lang === 'pt'
  const runs = data.workflows ?? []

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--anthropic-orange)' }}><WorkflowIcon size={16} /></span>
          {pt ? 'Workflows' : 'Workflows'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {pt ? 'Execuções de workflow: fases, agentes, modelo, tokens e custo.' : 'Workflow runs: phases, agents, model, tokens and cost.'}
        </div>
      </div>

      {runs.length === 0
        ? <Section flashId="wf-empty" title={pt ? 'Nenhum workflow' : 'No workflows'}>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 2px' }}>
              {pt ? 'Nenhuma execução de workflow encontrada.' : 'No workflow runs found.'}
            </div>
          </Section>
        : runs.map(run => <RunBlock key={run.runId} run={run} pt={pt} rate={brlRate} />)}
    </>
  )
}

function RunBlock({ run, pt, rate }: { run: WorkflowRun; pt: boolean; rate: number }) {
  const [open, setOpen] = useState(true)
  const statusColor = run.status === 'completed' ? '#22c55e' : run.status === 'partial' ? '#eab308' : '#ef4444'
  return (
    <Section flashId={`wf-${run.runId}`} title={
      <span onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
        {run.name}
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          · {run.totals.agentCount} {pt ? 'agentes' : 'agents'} · {(run.totals.tokensIn + run.totals.tokensOut).toLocaleString()} tkn · {brl(run.totals.costUSD, rate)}
        </span>
      </span>
    }>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {run.phases.map(ph => (
            <div key={ph.title}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                {ph.title} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>({ph.agentCount})</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
                      <th style={cell}>{pt ? 'Agente' : 'Agent'}</th><th style={cell}>{pt ? 'Modelo' : 'Model'}</th>
                      <th style={cellR}>In</th><th style={cellR}>Out</th><th style={cellR}>R$</th><th style={cellR}>R$/M</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.agents.filter(a => a.phase === ph.title).map((a, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={cell}>{a.label}</td><td style={cell}>{a.model || '—'}</td>
                        <td style={cellR}>{a.tokensIn.toLocaleString()}</td><td style={cellR}>{a.tokensOut.toLocaleString()}</td>
                        <td style={cellR}>{brl(a.costUSD, rate)}</td><td style={cellR}>{a.model ? perMillionBRL(a.model, rate) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {run.agents.some(a => !a.phase) && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {pt ? 'Alguns agentes sem fase identificada.' : 'Some agents without an identified phase.'}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

const cell: React.CSSProperties = { padding: '6px 8px' }
const cellR: React.CSSProperties = { padding: '6px 8px', textAlign: 'right' }
```

- [ ] **Step 2: Add the route**

In `AppRouter.tsx`: `const WorkflowsPage = lazy(() => import('./pages/WorkflowsPage'))` and `<Route path="workflows" element={<Suspense fallback={<PageFallback />}><WorkflowsPage /></Suspense>} />`.

- [ ] **Step 3: Add nav entries (only when workflows exist)**

In `App.tsx` `NavTabs` tabs and `MobileBottomNav` navTiles, add gated on `data.workflows?.length`. `NavTabs` receives `harnesses`; also pass a `hasWorkflows: boolean` prop (compute `(data.workflows?.length ?? 0) > 0` at the call site). Entry: `{ to: '/workflows', labelPt: 'Workflows', labelEn: 'Workflows', icon: <WorkflowIcon size={12} /> }`. Import `Workflow as WorkflowIcon` from `lucide-react`.

- [ ] **Step 4: Verify `getModelPrice` return shape**

Run: `grep -n "export function getModelPrice\|export interface PriceEntry" packages/core/src/types.ts`
Confirm it returns `{ input, output, cacheRead, cacheWrite }`. If the property names differ, adjust `perMillionBRL` in Step 1.

- [ ] **Step 5: Typecheck + manual verify**

Run: `bun tsc --noEmit`
Then `bun run dev`, open `/workflows` — runs list, phases expand, per-agent model/tokens/R$/R$-per-M render.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/WorkflowsPage.tsx packages/web/src/AppRouter.tsx packages/web/src/App.tsx
git commit -m "feat(workflows): add detailed Workflows tab"
```

---

## Phase D — Presence-coupled members filter (central bugfix)

Filter the `UsersFilter` list by the active presence filter and relabel it with a colored dot.

### Task D1: Presence-aware `UsersFilter`

**Files:**
- Modify: `packages/web/src/components/UsersFilter.tsx`
- Modify: `packages/web/src/components/FiltersBar.tsx` (~line 236, pass new props)

**Interfaces:**
- `UsersFilter` new optional props: `presence?: Record<string, MemberPresence>`, `presenceFilter?: 'online' | 'offline'`.
- When `presenceFilter` is set, the shown `users` list is filtered to matching presence; "Select all" selects only the visible subset; trigger label becomes "Online members" (green) / "Offline members" (red) when no manual selection is active.

- [ ] **Step 1: Update `UsersFilter` props and rendering**

Edit `packages/web/src/components/UsersFilter.tsx`:
```tsx
import type { MemberPresence } from '@agentistics/core'
// ...
interface Props {
  users: string[]
  selected: string[]
  onChange: (users: string[]) => void
  lang: 'pt' | 'en'
  presence?: Record<string, MemberPresence>
  presenceFilter?: 'online' | 'offline'
}

const T = {
  pt: { all: 'Todos os membros', online: 'Membros online', offline: 'Membros offline', selected: 'membros', selectAll: 'Selecionar tudo', clear: 'Limpar' },
  en: { all: 'All members', online: 'Online members', offline: 'Offline members', selected: 'members', selectAll: 'Select all', clear: 'Clear' },
} as const

export function UsersFilter({ users, selected, onChange, lang, presence, presenceFilter }: Props) {
  const t = T[lang]
  // ... keep open/ref/effect ...

  // Restrict the list to the active presence filter.
  const visibleUsers = presenceFilter && presence
    ? users.filter(u => (presence[u]?.online ?? false) === (presenceFilter === 'online'))
    : users

  function toggle(user: string) {
    if (selected.includes(user)) onChange(selected.filter(u => u !== user))
    else onChange([...selected, user])
  }

  const defaultLabel = presenceFilter === 'online' ? t.online : presenceFilter === 'offline' ? t.offline : t.all
  const defaultDot = presenceFilter === 'online' ? '#22c55e' : presenceFilter === 'offline' ? '#ef4444' : 'var(--text-secondary)'
  const label = selected.length === 0 ? defaultLabel : `${selected.length} ${t.selected}`
  const active = selected.length > 0
  const tip = selected.length === 0 ? defaultLabel : selected.join(', ')
  // In the trigger button, render a dot before the label:
  //   <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? 'var(--anthropic-orange,#cd5d38)' : defaultDot }} />
  // Replace the plain <Users size={14}/> + <span>{label}</span> row accordingly.

  // "Select all" selects only the visible subset:
  //   onClick={() => onChange(visibleUsers)}
  // Map over `visibleUsers` instead of `users` when rendering rows.
}
```
Apply the changes: add the dot to the trigger, use `defaultLabel`, iterate `visibleUsers` in the dropdown, and make "Select all" use `visibleUsers`.

- [ ] **Step 2: Pass props from `FiltersBar`**

In `packages/web/src/components/FiltersBar.tsx` (~line 236):
```tsx
<UsersFilter
  users={users}
  selected={filters.users ?? []}
  onChange={u => onChange({ ...filters, users: u })}
  lang={lang}
  presence={presence}
  presenceFilter={filters.presence}
/>
```
(`presence` is already in scope in `FiltersBar` — it's used by `PresenceFilter` at line 253.)

- [ ] **Step 3: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verify (central)**

On a central with mixed online/offline members: set the Status filter to **Online** → the members dropdown lists only online members and its label reads "Online members" with a green dot; **Offline** → only offline, red dot; **All** → everyone, neutral dot. "Select all" respects the current subset.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/UsersFilter.tsx packages/web/src/components/FiltersBar.tsx
git commit -m "fix(central): couple members filter to the active presence filter"
```

---

## Final verification

- [ ] **Full typecheck + tests:** `bun tsc --noEmit && bun test` — all green.
- [ ] **Build sanity:** `bun run build` completes (Vite bundles the two new pages).
- [ ] **Manual smoke (solo):** `/sessions` and `/workflows` render; central-only tabs hidden appropriately.
- [ ] **Manual smoke (central):** members chat view gone (410 on `/api/team/session-chat`), presence pill intact, members filter respects presence.
