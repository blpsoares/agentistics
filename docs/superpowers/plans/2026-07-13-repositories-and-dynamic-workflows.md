# Repositories Polish + Dynamic Workflows Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repo-detail "Workflows" tab clear and detailed (rename to "Dynamic Workflows", gate by harness capability, show a step-by-step timeline of agents), and polish the Repositories page (sorting, provider logos, honest Actions gating, and a tab-bar scrollbar fix).

**Architecture:** Pure frontend. One new capability flag in `@agentistics/core` gates the tab. The workflow-step grouping and repo-sorting logic live in small, unit-tested pure helpers (`lib/workflowSteps.ts`, `hooks/useData.ts`); the React components consume them. No backend or `WorkflowRun` type changes — a run's harness is derived from its session.

**Tech Stack:** TypeScript, React, Vite, Bun test, `@agentistics/core`, lucide-react (icons), inline SVG (provider logos, timeline rail).

## Global Constraints

- **Language:** everything in English — code, comments, commits, UI copy (the project CLAUDE.md rule). "Dynamic Workflows" stays in English in both `pt` and `en`, like the existing "Actions" tab.
- **No new runtime dependencies** — provider logos and the timeline rail are inline SVG/CSS.
- **`stats-cache.json` stays Claude-only** — not touched here; workflow/repo aggregates already come from per-session data.
- **Never import server modules into `packages/web/src`** and never import a page component into another page/test — put shared pure logic in `lib/` or `hooks/`.
- **Capability source of truth:** `HARNESS_CAPABILITIES` in `packages/core/src/types.ts`; read via `capable(harness, metric)` from `packages/web/src/lib/harness.ts`.
- **Commit style:** Conventional Commits, English.

---

### Task 1: Add `dynamicWorkflows` capability to the core

**Files:**
- Modify: `packages/core/src/types.ts:45-61` (interface `HarnessCapabilities` + `HARNESS_CAPABILITIES`)
- Test: `packages/core/src/types.test.ts` (append a test in the existing `HARNESS_CAPABILITIES` section, ~line 285)

**Interfaces:**
- Consumes: nothing.
- Produces: `HarnessCapabilities.dynamicWorkflows: boolean`; `HARNESS_CAPABILITIES.<id>.dynamicWorkflows`. Consumed by Task 2 via `capable(h, 'dynamicWorkflows')`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/types.test.ts` (the file already imports `HARNESS_CAPABILITIES`):

```typescript
test('dynamicWorkflows capability is Claude-only', () => {
  expect(HARNESS_CAPABILITIES.claude.dynamicWorkflows).toBe(true)
  expect(HARNESS_CAPABILITIES.codex.dynamicWorkflows).toBe(false)
  expect(HARNESS_CAPABILITIES.gemini.dynamicWorkflows).toBe(false)
  expect(HARNESS_CAPABILITIES.copilot.dynamicWorkflows).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/types.test.ts`
Expected: FAIL — `dynamicWorkflows` is `undefined` (and/or a TS error that the property does not exist).

- [ ] **Step 3: Implement the capability**

In `packages/core/src/types.ts`, add the field to the interface:

```typescript
export interface HarnessCapabilities {
  tokens: boolean
  cost: boolean
  model: boolean
  tools: boolean
  agents: boolean
  gitLines: boolean
  /** Runs of the harness's multi-agent orchestration tool (Claude Code's Workflow tool).
   *  Gates the repo-detail "Dynamic Workflows" tab. */
  dynamicWorkflows: boolean
}
```

And set it in every literal (the whole table for clarity):

```typescript
export const HARNESS_CAPABILITIES: Record<HarnessId, HarnessCapabilities> = {
  claude:  { tokens: true,  cost: true,  model: true,  tools: true,  agents: true,  gitLines: true,  dynamicWorkflows: true  },
  codex:   { tokens: true,  cost: true,  model: true,  tools: true,  agents: false, gitLines: false, dynamicWorkflows: false },
  gemini:  { tokens: true,  cost: true,  model: true,  tools: true,  agents: false, gitLines: false, dynamicWorkflows: false },
  copilot: { tokens: true,  cost: true,  model: true,  tools: false, agents: false, gitLines: true,  dynamicWorkflows: false },
}
```

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `bun test packages/core/src/types.test.ts && bun tsc --noEmit`
Expected: PASS; typecheck clean (the required key forces every literal to set it).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/types.test.ts
git commit -m "feat(core): add dynamicWorkflows harness capability (Claude-only)"
```

---

### Task 2: Rename + gate the repo-detail tabs, fix the phantom scrollbar

**Files:**
- Modify: `packages/web/src/pages/RepoDetailPage.tsx` (imports ~line 4-9; `tabs` array line 57-63; tab-bar container line 115)
- Modify: `packages/web/src/index.css` (add a scrollbar-hiding rule)

**Interfaces:**
- Consumes: `capable` from `../lib/harness`; `HarnessId`, `HARNESS_LABELS`, `HARNESS_COLORS` (imported now, used by Task 3); `data.sessions`.
- Produces: a `harnessOf(run)` local helper + `sessionByIdWf` map reused by Task 3; a `.tabscroll` CSS class.

- [ ] **Step 1: Add the scrollbar-hiding CSS class**

Append to `packages/web/src/index.css`:

```css
/* Horizontal-only scroll for the repo-detail tab bar: keep left/right scroll on
   mobile but hide the scrollbar chrome. overflow-x:auto otherwise promotes
   overflow-y to auto and the tabs' -1px marginBottom shows a vertical scrollbar. */
.tabscroll { scrollbar-width: none; }
.tabscroll::-webkit-scrollbar { display: none; }
```

- [ ] **Step 2: Add imports + the session map and harness helper**

In `RepoDetailPage.tsx`, extend the `@agentistics/core` import and add the harness lib import:

```typescript
import type { SessionMeta, MemberPresence, HarnessId, WorkflowRun } from '@agentistics/core'
import { repoShortName, fmt, fmtCost, fmtDuration, formatProjectName, formatModel, calcCost } from '@agentistics/core'
import { capable, HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'
```

Inside the component, after `workflows` is computed (line 52), add:

```typescript
const sessionByIdWf = useMemo(
  () => new Map((data.sessions ?? []).map(s => [s.session_id, s] as [string, SessionMeta])),
  [data.sessions],
)
const harnessOf = (w: WorkflowRun): HarnessId => sessionByIdWf.get(w.sessionId)?.harness ?? 'claude'
```

Note: this `useMemo` must sit with the other hooks, ABOVE the `if (!scoped) return null` guard (line 48), to respect the rules of hooks. Place it right after the `sessionIds` memo (line 43-46) and move the `workflows` derivation to reference it — i.e. keep `workflows` where it is (after the guard) but define `sessionByIdWf` before the guard. `harnessOf` is a plain function, define it after the guard next to `workflows`.

- [ ] **Step 3: Rename + gate the tabs**

Replace the `tabs` array (line 57-63) — change the `actions` and `workflows` entries:

```typescript
  const tabs: { id: Tab; label: string; icon: React.ReactNode; show: boolean; badge?: number }[] = [
    { id: 'overview', label: pt ? 'Visão geral' : 'Overview', icon: <GitBranch size={13} />, show: true },
    { id: 'members', label: pt ? 'Membros' : 'Members', icon: <Users size={13} />, show: isCentral, badge: scoped.repoStats[0]?.members.length },
    { id: 'actions', label: 'Actions', icon: <Zap size={13} />, show: ciSessions.length > 0, badge: ciSessions.length || undefined },
    { id: 'sessions', label: pt ? 'Sessões' : 'Sessions', icon: <Clock size={13} />, show: true },
    { id: 'workflows', label: 'Dynamic Workflows', icon: <WorkflowIcon size={13} />, show: workflows.length > 0 && workflows.some(w => capable(harnessOf(w), 'dynamicWorkflows')), badge: workflows.length },
  ]
```

- [ ] **Step 4: Apply the scrollbar class to the tab bar**

Change the tab-bar container (line 115) to add the class:

```tsx
      <div className="tabscroll" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
```

- [ ] **Step 5: Update the workflows tab Section title**

Change the workflows panel header (line 191-194) so the Section title matches the tab:

```tsx
      {tab === 'workflows' && (
        <Section title={<><WorkflowIcon size={14} /> Dynamic Workflows</>}>
          <WorkflowsMini workflows={workflows} lang={lang} currency={currency} brlRate={brlRate} sessionById={sessionByIdWf} />
        </Section>
      )}
```

(`WorkflowsMini` gets the new `sessionById` prop in Task 3; if implementing Task 2 alone, TypeScript will flag the extra prop — that is expected and resolved by Task 3. To keep Task 2 independently green, temporarily omit the `sessionById` prop here and add it in Task 3.)

- [ ] **Step 6: Typecheck + manual verify**

Run: `bun tsc --noEmit`
Expected: clean (omitting `sessionById` from `WorkflowsMini` for now).
Manual: `bun run dev`, open a repo detail — the tab reads "Dynamic Workflows"; a repo with zero CI sessions shows no "Actions" tab; the tab bar shows no vertical scrollbar.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/pages/RepoDetailPage.tsx packages/web/src/index.css
git commit -m "feat(repo-detail): rename Dynamic Workflows tab, gate Actions to real runs, fix tab scrollbar"
```

---

### Task 3: Dynamic Workflows step-timeline (pure helper + component)

**Files:**
- Create: `packages/web/src/lib/workflowSteps.ts`
- Test: `packages/web/src/lib/workflowSteps.test.ts`
- Modify: `packages/web/src/pages/RepoDetailPage.tsx` (replace `WorkflowsMini`, lines 395-412)

**Interfaces:**
- Consumes: `WorkflowRun`, `WorkflowAgent` from `@agentistics/core`; `HARNESS_LABELS`, `HARNESS_COLORS` (from Task 2 import); `sessionByIdWf` (from Task 2).
- Produces: `buildWorkflowSteps(run, noPhaseLabel?)` → `WorkflowStep[]`; types `WorkflowStep`, `StepSubtotal`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/workflowSteps.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import type { WorkflowRun, WorkflowAgent } from '@agentistics/core'
import { buildWorkflowSteps } from './workflowSteps'

function agent(p: Partial<WorkflowAgent>): WorkflowAgent {
  return {
    label: 'a', phase: '', model: 'claude-sonnet-5', status: 'completed',
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, ...p,
  }
}

function run(p: Partial<WorkflowRun>): WorkflowRun {
  return {
    runId: 'r', name: 'wf', sessionId: 's', status: 'completed', startedAt: '',
    durationMs: 0, phases: [], agents: [],
    totals: { agentCount: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, durationMs: 0, toolUses: 0 },
    ...p,
  }
}

test('orders steps by declared phases, then appends undeclared/no-phase', () => {
  const r = run({
    phases: [{ title: 'Scan', agentCount: 2 }, { title: 'Fix', agentCount: 1 }, { title: 'Deploy', agentCount: 0 }],
    agents: [
      agent({ phase: 'Scan', tokensIn: 10, tokensOut: 2, costUSD: 0.10 }),
      agent({ phase: 'Scan', tokensIn: 5, tokensOut: 1, costUSD: 0.05 }),
      agent({ phase: 'Fix', tokensIn: 20, tokensOut: 4, costUSD: 0.20 }),
      agent({ phase: '', tokensIn: 1, tokensOut: 1, costUSD: 0.01 }),
    ],
  })
  const steps = buildWorkflowSteps(r)
  expect(steps.map(s => s.title)).toEqual(['Scan', 'Fix', 'Deploy', '(no phase)'])
  expect(steps.map(s => s.index)).toEqual([1, 2, 3, 4])
  expect(steps[0].subtotal).toEqual({ count: 2, tokensIn: 15, tokensOut: 3, costUSD: 0.15 })
  expect(steps[2].agents.length).toBe(0)         // declared phase with no agents renders empty
  expect(steps[2].subtotal.count).toBe(0)
  expect(steps[3].title).toBe('(no phase)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/web/src/lib/workflowSteps.test.ts`
Expected: FAIL — module `./workflowSteps` not found.

- [ ] **Step 3: Implement the helper**

Create `packages/web/src/lib/workflowSteps.ts`:

```typescript
import type { WorkflowRun, WorkflowAgent } from '@agentistics/core'

export interface StepSubtotal {
  count: number
  tokensIn: number
  tokensOut: number
  costUSD: number
}

export interface WorkflowStep {
  /** 1-based display number for the timeline node. */
  index: number
  title: string
  /** Declared count from run.phases (may differ from agents.length if some skipped). */
  declaredCount: number
  agents: WorkflowAgent[]
  subtotal: StepSubtotal
}

function subtotal(agents: WorkflowAgent[]): StepSubtotal {
  return agents.reduce<StepSubtotal>((t, a) => ({
    count: t.count + 1,
    tokensIn: t.tokensIn + a.tokensIn,
    tokensOut: t.tokensOut + a.tokensOut,
    costUSD: t.costUSD + a.costUSD,
  }), { count: 0, tokensIn: 0, tokensOut: 0, costUSD: 0 })
}

/** Group a run's agents under its declared phases (in declared order), then append
 *  any undeclared phases and the no-phase bucket. Declared phases with no agents
 *  render as empty steps. */
export function buildWorkflowSteps(run: WorkflowRun, noPhaseLabel = '(no phase)'): WorkflowStep[] {
  const byPhase = new Map<string, WorkflowAgent[]>()
  for (const a of run.agents) {
    const key = a.phase || noPhaseLabel
    const arr = byPhase.get(key) ?? []
    arr.push(a)
    byPhase.set(key, arr)
  }

  const out: Omit<WorkflowStep, 'index'>[] = []
  const seen = new Set<string>()
  for (const p of run.phases) {
    seen.add(p.title)
    const agents = byPhase.get(p.title) ?? []
    out.push({ title: p.title, declaredCount: p.agentCount, agents, subtotal: subtotal(agents) })
  }
  for (const [key, agents] of byPhase) {
    if (seen.has(key)) continue
    out.push({ title: key, declaredCount: agents.length, agents, subtotal: subtotal(agents) })
  }
  return out.map((s, i) => ({ ...s, index: i + 1 }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/web/src/lib/workflowSteps.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `WorkflowsMini` with the timeline component**

In `RepoDetailPage.tsx`, add the import near the top:

```typescript
import { buildWorkflowSteps } from '../lib/workflowSteps'
```

Replace the whole `WorkflowsMini` function (lines 395-412) with:

```tsx
function statusColor(status: WorkflowRun['status']): string {
  return status === 'completed' ? '#22c55e' : status === 'partial' ? '#eab308' : '#ef4444'
}

/** Seconds-aware run duration (fmtDuration floors to whole minutes, so a 12s run
 *  would read "0m" — workflow runs are often sub-minute). */
function fmtRunDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

function agentGlyph(status: WorkflowAgent['status']): { ch: string; color: string } {
  if (status === 'completed') return { ch: '✓', color: '#22c55e' }
  if (status === 'failed') return { ch: '✗', color: '#ef4444' }
  return { ch: '⤼', color: 'var(--text-tertiary)' }
}

function WorkflowsMini({ workflows, lang, currency, brlRate, sessionById }: {
  workflows: WorkflowRun[]
  lang: 'pt' | 'en'; currency: 'USD' | 'BRL'; brlRate: number
  sessionById: Map<string, SessionMeta>
}) {
  const pt = lang === 'pt'
  if (workflows.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 2px' }}>{pt ? 'Nenhum workflow.' : 'No workflows.'}</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {workflows.map(w => (
        <WorkflowRunCard key={w.runId} run={w} pt={pt} currency={currency} brlRate={brlRate} sessionById={sessionById} />
      ))}
    </div>
  )
}

function WorkflowRunCard({ run, pt, currency, brlRate, sessionById }: {
  run: WorkflowRun; pt: boolean; currency: 'USD' | 'BRL'; brlRate: number; sessionById: Map<string, SessionMeta>
}) {
  const [open, setOpen] = useState(true)
  const harness = sessionById.get(run.sessionId)?.harness ?? 'claude'
  const steps = buildWorkflowSteps(run, pt ? '(sem fase)' : '(no phase)')
  const tok = run.totals.tokensIn + run.totals.tokensOut

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--bg-card)' }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', cursor: 'pointer' }}
      >
        <ChevronDown size={14} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s', color: 'var(--text-tertiary)' }} />
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(run.status), flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{run.name}</span>
        <span style={{
          fontSize: 10.5, fontWeight: 600, color: HARNESS_COLORS[harness],
          background: 'var(--bg-elevated)', border: `1px solid ${HARNESS_COLORS[harness]}55`,
          borderRadius: 5, padding: '2px 7px',
        }}>{HARNESS_LABELS[harness]}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{run.totals.agentCount} {pt ? 'agentes' : 'agents'}</span>
          <span>{fmt(tok)} tok</span>
          <span style={{ color: 'var(--anthropic-orange)', fontWeight: 600 }}>{fmtCost(run.totals.costUSD, currency, brlRate)}</span>
          {run.durationMs > 0 && <span>{fmtRunDuration(run.durationMs)}</span>}
        </span>
      </div>

      {/* Timeline */}
      {open && (
        <div style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column' }}>
          {steps.map((step, i) => (
            <div key={`${step.title}-${i}`} style={{ display: 'flex', gap: 10 }}>
              {/* Rail */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22, flexShrink: 0 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                }}>{step.index}</span>
                {i < steps.length - 1 && <span style={{ flex: 1, width: 2, background: 'var(--border)', minHeight: 8 }} />}
              </div>
              {/* Step body */}
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{step.title}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{step.subtotal.count} {pt ? 'agentes' : 'agents'}</span>
                  {step.subtotal.count > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(step.subtotal.tokensIn)} in · {fmt(step.subtotal.tokensOut)} out · <strong style={{ color: 'var(--anthropic-orange)' }}>{fmtCost(step.subtotal.costUSD, currency, brlRate)}</strong>
                    </span>
                  )}
                </div>
                {step.agents.length === 0
                  ? <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 4 }}>{pt ? 'nada rodou' : 'nothing ran'}</div>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {step.agents.map((a, j) => {
                        const g = agentGlyph(a.status)
                        return (
                          <div key={j} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
                            <span style={{ color: g.color, fontWeight: 700, width: 12, flexShrink: 0 }}>{g.ch}</span>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 600, wordBreak: 'break-word' }}>{a.label}</span>
                            {a.model && <span style={{ color: 'var(--text-tertiary)', fontSize: 10.5 }}>{formatModel(a.model)}</span>}
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                              <span>{fmt(a.tokensIn)}/{fmt(a.tokensOut)}</span>
                              <span style={{ color: 'var(--anthropic-orange)' }}>{fmtCost(a.costUSD, currency, brlRate)}</span>
                            </span>
                            {a.toolStats && (
                              <span style={{ flexBasis: '100%', paddingLeft: 20, color: 'var(--text-tertiary)', fontSize: 10.5 }}>
                                {a.toolStats.readCount}r · {a.toolStats.editFileCount}e · +{a.toolStats.linesAdded}/−{a.toolStats.linesRemoved}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Also make sure `WorkflowAgent` is imported — extend the core type import:

```typescript
import type { SessionMeta, MemberPresence, HarnessId, WorkflowRun, WorkflowAgent } from '@agentistics/core'
```

And restore the `sessionById` prop on the call site added in Task 2 Step 5 (it is now required):

```tsx
          <WorkflowsMini workflows={workflows} lang={lang} currency={currency} brlRate={brlRate} sessionById={sessionByIdWf} />
```

- [ ] **Step 6: Typecheck + manual verify**

Run: `bun tsc --noEmit && bun test packages/web/src/lib/workflowSteps.test.ts`
Expected: clean + PASS.
Manual: `bun run dev`, open a repo with workflow runs → each run expands into a numbered step timeline; each step lists its agents with model, status glyph, tokens, cost, and a tool line when present; the Claude Code badge shows in the header.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/workflowSteps.ts packages/web/src/lib/workflowSteps.test.ts packages/web/src/pages/RepoDetailPage.tsx
git commit -m "feat(repo-detail): step-by-step timeline for Dynamic Workflows runs"
```

---

### Task 4: Sort repositories (pure comparator + UI control) and gate the Actions button

**Files:**
- Modify: `packages/web/src/hooks/useData.ts` (add `RepoSortKey`, `sortRepos` near `RepoStat`, ~line 15-46)
- Test: `packages/web/src/hooks/useData.test.ts` (append)
- Modify: `packages/web/src/pages/RepositoriesPage.tsx`

**Interfaces:**
- Consumes: `RepoStat`.
- Produces: `export type RepoSortKey`; `export function sortRepos(repos, key, dir)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/web/src/hooks/useData.test.ts`:

```typescript
import { sortRepos, type RepoSortKey } from './useData'
import type { RepoStat } from './useData'

function repo(p: Partial<RepoStat>): RepoStat {
  return {
    id: 'x', remote: '', linked: true, name: 'x', path: '', sessions: 0, messages: 0, tools: 0,
    costUSD: 0, inputTokens: 0, outputTokens: 0, gitCommits: 0, linesAdded: 0, linesRemoved: 0,
    filesModified: 0, ciSessions: 0, members: [], harnesses: ['claude'], firstActive: '', lastActive: '',
    activityByDay: {}, _users: new Set(), _harnesses: new Set(), _paths: {}, ...p,
  }
}

test('sortRepos by cost descending then ascending', () => {
  const repos = [repo({ id: 'a', costUSD: 5 }), repo({ id: 'b', costUSD: 10 }), repo({ id: 'c', costUSD: 3 })]
  expect(sortRepos(repos, 'cost', 'desc').map(r => r.id)).toEqual(['b', 'a', 'c'])
  expect(sortRepos(repos, 'cost', 'asc').map(r => r.id)).toEqual(['c', 'a', 'b'])
})

test('sortRepos by name uses locale compare', () => {
  const repos = [repo({ id: 'a', name: 'zeta' }), repo({ id: 'b', name: 'alpha' })]
  expect(sortRepos(repos, 'name', 'asc').map(r => r.name)).toEqual(['alpha', 'zeta'])
})

test('sortRepos does not mutate the input array', () => {
  const repos = [repo({ id: 'a', costUSD: 1 }), repo({ id: 'b', costUSD: 2 })]
  sortRepos(repos, 'cost', 'desc')
  expect(repos.map(r => r.id)).toEqual(['a', 'b'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/web/src/hooks/useData.test.ts`
Expected: FAIL — `sortRepos` is not exported.

- [ ] **Step 3: Implement `sortRepos`**

In `packages/web/src/hooks/useData.ts`, after the `RepoStat` interface (line 46), add:

```typescript
export type RepoSortKey = 'cost' | 'sessions' | 'tokens' | 'commits' | 'lastActive' | 'name'

/** Sort a repo list by a metric. Numeric/date keys compare numerically; `name`
 *  compares by locale. Non-mutating (returns a new array). `desc` reverses the
 *  ascending order. */
export function sortRepos(repos: RepoStat[], key: RepoSortKey, dir: 'asc' | 'desc'): RepoStat[] {
  const val = (r: RepoStat): number | string => {
    switch (key) {
      case 'cost': return r.costUSD
      case 'sessions': return r.sessions
      case 'tokens': return r.inputTokens + r.outputTokens
      case 'commits': return r.gitCommits
      case 'lastActive': return r.lastActive ? new Date(r.lastActive).getTime() : 0
      case 'name': return r.name.toLowerCase()
    }
  }
  const sorted = [...repos].sort((a, b) => {
    const va = val(a), vb = val(b)
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb)
    return (va as number) - (vb as number)
  })
  return dir === 'desc' ? sorted.reverse() : sorted
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/web/src/hooks/useData.test.ts`
Expected: PASS (all three new tests).

- [ ] **Step 5: Wire the sort control + gate the Actions button in the page**

In `packages/web/src/pages/RepositoriesPage.tsx`:

Update imports:

```typescript
import { GitBranch, Search, Zap, ArrowUp, ArrowDown } from 'lucide-react'
import type { RepoStat, RepoSortKey } from '../hooks/useData'
import { RepositoriesList } from '../components/RepositoriesList'
import { sortRepos } from '../hooks/useData'
```

Add sort state and apply it after search-filtering (replace the `filtered` memo block, keeping search, and add `sorted`):

```typescript
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<RepoSortKey>('cost')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const repos = derived.repoStats
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(r =>
      `${r.name} ${r.remote} ${r.path}`.toLowerCase().includes(q),
    )
  }, [repos, query])
  const sorted = useMemo(() => sortRepos(filtered, sortKey, sortDir), [filtered, sortKey, sortDir])
```

Add a sort-key label map above the component's `return`:

```typescript
  const sortLabels: Record<RepoSortKey, string> = {
    cost: pt ? 'Custo' : 'Cost',
    sessions: pt ? 'Sessões' : 'Sessions',
    tokens: 'Tokens',
    commits: 'Commits',
    lastActive: pt ? 'Atividade' : 'Activity',
    name: pt ? 'Nome' : 'Name',
  }
```

In the Section `action`, gate the Actions button on `ciTotal > 0` only and add the sort pills. Replace the `action` JSX with:

```tsx
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {ciTotal > 0 && (
              <button
                onClick={() => navigate('/repositories/actions')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600,
                  color: 'var(--accent-blue)', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 7, padding: '5px 9px', cursor: 'pointer', fontFamily: 'inherit',
                }}
                title="GitHub Actions"
              >
                <Zap size={12} /> Actions{ciTotal > 0 ? ` · ${ciTotal}` : ''}
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 2 }}>{pt ? 'Ordenar:' : 'Sort:'}</span>
              {(['cost', 'sessions', 'tokens', 'commits', 'lastActive', 'name'] as RepoSortKey[]).map(k => {
                const active = sortKey === k
                return (
                  <button
                    key={k}
                    onClick={() => setSortKey(k)}
                    style={{
                      padding: '4px 9px', borderRadius: 7, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                      border: '1px solid var(--border)',
                      background: active ? 'var(--anthropic-orange-dim, rgba(205,93,56,0.12))' : 'var(--bg-elevated)',
                      color: active ? 'var(--anthropic-orange, #cd5d38)' : 'var(--text-secondary)',
                      fontWeight: active ? 600 : 500,
                    }}
                  >{sortLabels[k]}</button>
                )
              })}
              <button
                onClick={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))}
                title={sortDir === 'desc' ? (pt ? 'Decrescente' : 'Descending') : (pt ? 'Crescente' : 'Ascending')}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, height: 26, borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                }}
              >{sortDir === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={13} color="var(--text-tertiary)" style={{ position: 'absolute', left: 8, pointerEvents: 'none' }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={pt ? 'Buscar…' : 'Search…'}
                style={{
                  fontSize: 12, fontFamily: 'inherit', color: 'var(--text-primary)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7,
                  padding: '5px 8px 5px 26px', width: 130, outline: 'none',
                }}
              />
            </div>
          </div>
        }
```

Change the list to consume `sorted`:

```tsx
        <RepositoriesList
          repos={sorted}
          isCentral={isCentral}
          currency={currency}
          brlRate={brlRate}
          lang={lang}
          onOpen={openRepo}
        />
```

- [ ] **Step 6: Typecheck + manual verify**

Run: `bun tsc --noEmit && bun test packages/web/src/hooks/useData.test.ts`
Expected: clean + PASS.
Manual: on `/repositories`, click each sort pill and the direction toggle — order updates; the Actions button is absent when no CI runs exist.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/hooks/useData.ts packages/web/src/hooks/useData.test.ts packages/web/src/pages/RepositoriesPage.tsx
git commit -m "feat(repositories): sortable repo list; show Actions button only when CI ran"
```

---

### Task 5: Provider logos + card polish in the repositories list

**Files:**
- Modify: `packages/web/src/components/RepositoriesList.tsx`

**Interfaces:**
- Consumes: `RepoStat` (unchanged).
- Produces: internal `ProviderLogo` component (not exported).

- [ ] **Step 1: Add the `ProviderLogo` component**

In `RepositoriesList.tsx`, keep the `Link2Off`/`GitBranch` imports and add `ProviderLogo` above the `RepositoriesList` export. The SVG path data is the official monochrome brand mark (simple-icons), rendered with `fill="currentColor"` so it inherits the accent color:

```tsx
/** Provider brand mark (inline SVG — lucide-react no longer ships brand icons).
 *  Falls back to GitBranch for unknown hosts and Link2Off for unlinked repos. */
function ProviderLogo({ host, linked, size = 15, color }: { host: string; linked: boolean; size?: number; color?: string }) {
  const style: React.CSSProperties = { flexShrink: 0, color }
  if (!linked) return <Link2Off size={size} color={color} style={{ flexShrink: 0 }} />
  if (host.includes('github')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} aria-label="GitHub">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    )
  }
  if (host.includes('gitlab')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} aria-label="GitLab">
        <path d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.462-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z" />
      </svg>
    )
  }
  if (host.includes('bitbucket')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} aria-label="Bitbucket">
        <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z" />
      </svg>
    )
  }
  return <GitBranch size={size} color={color} style={{ flexShrink: 0 }} />
}
```

- [ ] **Step 2: Use `ProviderLogo` in the card header**

Replace the leading icon in the card header (lines 101-103) — swap the inline `r.linked ? <GitBranch.../> : <Link2Off.../>` for the logo:

```tsx
                <ProviderLogo host={host} linked={r.linked} size={16} color={accent} />
```

- [ ] **Step 3: Polish the header spacing / host chip**

The host chip stays but reads as secondary now the logo carries identity. Adjust the chip (lines 108-114) to a slightly lighter weight so the logo leads:

```tsx
                {host && (
                  <span style={{
                    marginLeft: 'auto', flexShrink: 0, fontSize: 9.5, fontWeight: 500,
                    color: hostColor(host), background: 'var(--bg-elevated)',
                    padding: '2px 6px', borderRadius: 5, whiteSpace: 'nowrap', opacity: 0.9,
                  }}>{host}</span>
                )}
```

- [ ] **Step 4: Typecheck + manual verify**

Run: `bun tsc --noEmit`
Expected: clean.
Manual: `/repositories` — GitHub repos show the GitHub mark, GitLab/Bitbucket show theirs, unknown hosts show `GitBranch`, unlinked cards show `Link2Off`; the logo picks up the orange accent for linked repos.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/RepositoriesList.tsx
git commit -m "feat(repositories): provider brand logos on repo cards"
```

---

### Task 6: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole repo**

Run: `bun tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: PASS — includes the new `types.test.ts`, `workflowSteps.test.ts`, and `useData.test.ts` cases.

- [ ] **Step 3: Manual smoke of every change**

`bun run dev`, then confirm:
- Repo detail tab reads "Dynamic Workflows"; expands to a numbered step timeline with agents (model, status glyph, tokens, cost, tool line); harness badge shows.
- "Actions" tab hidden when the repo has no CI sessions; visible (with count) when it does.
- No vertical scrollbar on the repo-detail tab bar.
- `/repositories`: sort pills + direction toggle reorder cards; provider logos render; Actions button hidden when `ciTotal === 0`.

- [ ] **Step 4: Update CLAUDE.md docs**

The repo's CLAUDE.md documents `HARNESS_CAPABILITIES` and `RepoDetailPage` tabs. Add a one-line note that `dynamicWorkflows` is a capability and that the tab is "Dynamic Workflows" (gated by it). Edit the relevant lines in `packages/... `? No — CLAUDE.md is at repo root (`/home/mithrandir/agentistics/CLAUDE.md`). Update the `HARNESS_CAPABILITIES` limitation paragraph and the `RepoDetailPage.tsx` bullet to mention the rename + capability gate.

```bash
git add CLAUDE.md
git commit -m "docs: note dynamicWorkflows capability and Dynamic Workflows tab"
```
