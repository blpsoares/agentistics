# Harness Info Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-harness "info" modal that explains what data each AI coding harness contains, what it doesn't contain and why, and where the data comes from.

**Architecture:** Add `HarnessInfo` type + `HARNESS_INFO` map to `harness.ts`, create a self-contained `HarnessInfoModal.tsx` component, then wire an ⓘ (Info icon from lucide-react) trigger into `ComparePage.tsx` harness cards and into the `HarnessSelector` component in `App.tsx`.

**Tech Stack:** React, TypeScript, lucide-react (Info icon), CSS-in-JS via inline styles with `var(--...)` CSS variables (project pattern), no new dependencies.

## Global Constraints

- Everything in English: code, comments, UI copy, commit messages
- Conventional Commits format (`feat(web): ...`)
- Pre-commit hook runs `bun tsc --noEmit` + `bun test` — both must pass before commit
- Never import from `packages/server/server/*` in web code
- `@agentistics/core` for shared types — `HarnessId` comes from there
- `bun run build` must succeed
- Use lucide-react `Info` icon (already used in project, same bundle)
- Modal overlay pattern: fixed inset 0, rgba backdrop, stopPropagation on card, Escape key closes
- CSS variables: `var(--bg-surface)`, `var(--border)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--text-tertiary)`, `var(--bg-elevated)`, `var(--radius-lg)`, `var(--bg-card)`

---

### Task 1: Add `HarnessInfo` type and `HARNESS_INFO` constant to `harness.ts`

**Files:**
- Modify: `packages/web/src/lib/harness.ts`

**Interfaces:**
- Produces: `HarnessInfo` interface, `HARNESS_INFO: Record<HarnessId, HarnessInfo>` — consumed by Task 2 (modal component)

- [ ] **Step 1: Read the current file to understand exact structure**

```bash
cat packages/web/src/lib/harness.ts
```
Expected: Shows the 3 exports: `HARNESS_LABELS`, `HARNESS_COLORS`, `capable`.

- [ ] **Step 2: Add the type and constant**

Replace the full content of `packages/web/src/lib/harness.ts` with:

```ts
import type { HarnessId, HarnessCapabilities } from '@agentistics/core'
import { HARNESS_CAPABILITIES } from '@agentistics/core'

export const HARNESS_LABELS: Record<HarnessId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  copilot: 'Copilot CLI',
}

export const HARNESS_COLORS: Record<HarnessId, string> = {
  claude: '#D97706',
  codex: '#10a37f',
  gemini: '#4285f4',
  copilot: '#6e7681',
}

export function capable(harness: HarnessId, metric: keyof HarnessCapabilities): boolean {
  return HARNESS_CAPABILITIES[harness][metric]
}

export interface HarnessInfo {
  source: string[]
  contains: string[]
  missing: { item: string; why: string }[]
  note?: string
}

export const HARNESS_INFO: Record<HarnessId, HarnessInfo> = {
  claude: {
    source: [
      '~/.claude/stats-cache.json (aggregate history)',
      '~/.claude/projects/**/*.jsonl (transcripts)',
      '~/.claude/usage-data/session-meta/',
    ],
    contains: [
      'Tokens (input, output, cache read/write)',
      'Cost (USD)',
      'Model per session',
      'Tool usage',
      'Sub-agent metrics',
      'Git line counts',
      'Full session history',
    ],
    missing: [],
    note: 'The stats cache retains aggregate totals even after Claude Code deletes transcripts older than its cleanup window (default 30 days), so historical session/token/cost totals survive.',
  },
  codex: {
    source: [
      '~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl',
    ],
    contains: [
      'Tokens (input, cached, output)',
      'Cost (USD)',
      'Model (e.g. gpt-5.5)',
      'Tool usage (e.g. web search)',
      'Messages',
      'Project (working directory)',
    ],
    missing: [
      { item: 'Sub-agent metrics', why: 'Codex does not record per-subagent breakdowns in its transcripts.' },
      { item: 'Git line counts', why: 'Not present in Codex transcripts.' },
    ],
    note: 'Codex reports input_tokens including the cached portion; agentistics stores the non-cached input separately from cache reads so cost is not double-counted.',
  },
  gemini: {
    source: [
      '~/.gemini/tmp/<project>/chats/*.jsonl',
      '~/.gemini/projects.json (project names)',
    ],
    contains: [
      'Sessions',
      'Projects',
      'Messages',
      'Activity (when a chat has real content)',
    ],
    missing: [
      { item: 'Tokens', why: 'Not stored in local Gemini chat files.' },
      { item: 'Cost', why: 'No token data locally, so cost cannot be computed.' },
      { item: 'Model', why: 'Not recorded in local chat files.' },
    ],
    note: 'Gemini CLI often writes bootstrap-only stub files (just the injected session context) with no real conversation. Only chats containing a genuine user message or a model response are counted. Real token/cost data would require enabling Gemini OpenTelemetry (a planned future integration).',
  },
  copilot: {
    source: [
      '~/.copilot/session-state/<id>/events.jsonl',
      '~/.copilot/session-state/<id>/workspace.yaml',
    ],
    contains: [
      'Sessions',
      'Project / repository / branch',
      'Messages',
      'Assistant turns',
      'MCP usage',
      'Activity',
    ],
    missing: [
      { item: 'Tokens', why: 'Not present in Copilot local event logs.' },
      { item: 'Cost', why: 'No token data locally.' },
      { item: 'Model', why: 'Not recorded in local events.' },
    ],
    note: 'Copilot CLI does not persist token/model data locally; only session activity and project context are available.',
  },
}
```

- [ ] **Step 3: Verify TypeScript compiles with no errors**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex && bun tsc --noEmit 2>&1 | head -20
```
Expected: No output (zero errors).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/harness.ts
git commit -m "feat(web): add HarnessInfo type and HARNESS_INFO metadata map"
```

---

### Task 2: Create `HarnessInfoModal.tsx`

**Files:**
- Create: `packages/web/src/components/HarnessInfoModal.tsx`

**Interfaces:**
- Consumes: `HarnessId` from `@agentistics/core`; `HARNESS_INFO`, `HARNESS_LABELS`, `HARNESS_COLORS` from `../lib/harness`; `Info`, `X`, `Check`, `AlertCircle` from `lucide-react`
- Produces: `HarnessInfoModal` component with props `{ harness: HarnessId; onClose: () => void }`

- [ ] **Step 1: Create the file**

Create `packages/web/src/components/HarnessInfoModal.tsx` with:

```tsx
import React, { useEffect } from 'react'
import { X, Check } from 'lucide-react'
import type { HarnessId } from '@agentistics/core'
import { HARNESS_INFO, HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'

interface Props {
  harness: HarnessId
  onClose: () => void
}

export function HarnessInfoModal({ harness, onClose }: Props) {
  const info = HARNESS_INFO[harness]
  const label = HARNESS_LABELS[harness]
  const color = HARNESS_COLORS[harness]

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          width: 480,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-block',
              width: 10, height: 10,
              borderRadius: '50%',
              background: color,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 14, fontWeight: 700, color }}>
              {label}
            </span>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>
              data
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: '1px solid var(--border)', borderRadius: 7,
              color: 'var(--text-tertiary)', cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Source */}
          <section>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
              letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
            }}>
              Where the data comes from
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {info.source.map((s, i) => (
                <div key={i} style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  padding: '5px 9px',
                  wordBreak: 'break-all',
                }}>
                  {s}
                </div>
              ))}
            </div>
          </section>

          {/* Captured */}
          <section>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
              letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
            }}>
              Captured
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {info.contains.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                  <Check size={12} style={{ color: 'var(--accent-green)', marginTop: 1, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Not available */}
          <section>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
              letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
            }}>
              Not available
            </div>
            {info.missing.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                Most complete source — everything above is tracked.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {info.missing.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                    <span style={{
                      display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
                      background: 'var(--text-tertiary)', marginTop: 5, flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{m.item}</strong>
                      {' — '}
                      {m.why}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Note */}
          {info.note && (
            <section style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 7,
              padding: '10px 12px',
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
                letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5,
              }}>
                Note
              </div>
              <p style={{
                fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic',
                lineHeight: 1.5, margin: 0,
              }}>
                {info.note}
              </p>
            </section>
          )}

        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex && bun tsc --noEmit 2>&1 | head -20
```
Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/HarnessInfoModal.tsx
git commit -m "feat(web): create HarnessInfoModal component"
```

---

### Task 3: Wire ⓘ into `ComparePage.tsx`

**Files:**
- Modify: `packages/web/src/pages/ComparePage.tsx`

**Interfaces:**
- Consumes: `HarnessInfoModal` from `../components/HarnessInfoModal`; `Info` from `lucide-react`; `useState` from `react`
- Produces: ⓘ button in each harness card; modal renders on top when harness is selected

**Key change:** The harness header cards (lines 168–202 of original file) live inside a grid. Each card has a header div with a dot + label. We add an ⓘ button to the right of that header div, push the header to `justifyContent: 'space-between'`, and manage `selectedHarness: HarnessId | null` state in `ComparePage`.

- [ ] **Step 1: Add imports and state**

In `ComparePage.tsx`, change the import line:
```ts
import React, { useMemo } from 'react'
```
to:
```ts
import React, { useMemo, useState } from 'react'
```

Add `Info` to the lucide-react import:
```ts
import { GitCompare, Info } from 'lucide-react'
```

Add the `HarnessInfoModal` import after the harness import:
```ts
import { HARNESS_LABELS, HARNESS_COLORS, capable } from '../lib/harness'
import { HarnessInfoModal } from '../components/HarnessInfoModal'
```

- [ ] **Step 2: Add state and modal render in `ComparePage`**

After `const colors = HARNESS_COLORS` (line ~131), add:
```tsx
const [infoHarness, setInfoHarness] = useState<HarnessId | null>(null)
```

Before the final `</>` closing (the last line of the return), add:
```tsx
{infoHarness && (
  <HarnessInfoModal harness={infoHarness} onClose={() => setInfoHarness(null)} />
)}
```

- [ ] **Step 3: Add the ⓘ button to each harness card header**

In the card header div (the one with `display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8`), add `justifyContent: 'space-between'` and append the button after the label `<span>`:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, justifyContent: 'space-between' }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: colors[a.harness],
      flexShrink: 0,
    }} />
    <span style={{ fontSize: 13, fontWeight: 700, color: colors[a.harness] }}>
      {HARNESS_LABELS[a.harness]}
    </span>
  </div>
  <button
    onClick={e => { e.stopPropagation(); setInfoHarness(a.harness) }}
    title={`About ${HARNESS_LABELS[a.harness]} data`}
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22,
      background: 'transparent',
      border: '1px solid var(--border)',
      borderRadius: 5,
      color: 'var(--text-tertiary)',
      cursor: 'pointer',
      flexShrink: 0,
      padding: 0,
    }}
  >
    <Info size={11} />
  </button>
</div>
```

- [ ] **Step 4: Verify TypeScript and tests**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex && bun tsc --noEmit 2>&1 | head -20 && bun test 2>&1 | tail -10
```
Expected: No TS errors; tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/ComparePage.tsx
git commit -m "feat(web): wire harness info modal trigger to ComparePage cards"
```

---

### Task 4: Wire ⓘ into `HarnessSelector` in `App.tsx`

**Files:**
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `HarnessInfoModal` from `./components/HarnessInfoModal`; `Info` from `lucide-react` (already imported or add it); `useState` (already imported)
- Produces: small ⓘ button next to each non-"All" harness button; modal renders inside `HarnessSelector`; clicking ⓘ does NOT navigate

**Key change:** `HarnessSelector` currently renders a flat list of buttons. We need to:
1. Add `useState<HarnessId | null>` for `infoHarness` inside `HarnessSelector`.
2. For each non-"All" option, wrap the button in a `<div style={{display:'flex',alignItems:'center',gap:2}}>` and add a small ⓘ button after it with `stopPropagation`.
3. Render `<HarnessInfoModal>` at the bottom of `HarnessSelector`'s return.

- [ ] **Step 1: Add `Info` to lucide-react import in `App.tsx`**

Find the existing lucide-react import block and add `Info` to it. The import currently ends with `GitCompare,`. Change to include `Info`:

```ts
import {
  MessageSquare, Zap, Clock, Flame, GitCommit,
  Wrench, RefreshCw, FileCode, TrendingUp, BarChart2,
  Sun, Moon, Globe, AlertTriangle, Download,
  Maximize2, X, Trophy, Activity, Bot, Sparkles, Settings, SlidersHorizontal,
  Calendar, Database, FileText, Shield, FolderOpen, CheckCircle,
  Target, Home, DollarSign, Layers, Code2, GitCompare, Info,
} from 'lucide-react'
```

- [ ] **Step 2: Add `HarnessInfoModal` import to `App.tsx`**

After the existing modal imports (around line 41), add:
```ts
import { HarnessInfoModal } from './components/HarnessInfoModal'
```

- [ ] **Step 3: Refactor `HarnessSelector` to include state and ⓘ buttons**

Replace the entire `HarnessSelector` function (from `function HarnessSelector({` through the closing `}` of the function) with:

```tsx
function HarnessSelector({ harnesses, lang }: { harnesses: HarnessId[]; lang: Lang }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [infoHarness, setInfoHarness] = useState<HarnessId | null>(null)

  // Only render when there is more than one harness present in the data
  if (harnesses.length <= 1) return null

  const harnessMatch = location.pathname.match(/^\/h\/([^/]+)$/)
  const currentHarness: HarnessId | null = harnessMatch
    ? (harnessMatch[1] as HarnessId)
    : null

  const handleSelect = (harness: HarnessId | null) => {
    if (harness === null) {
      navigate('/')
    } else {
      navigate(`/h/${harness}`)
    }
  }

  const allOption = { id: null as HarnessId | null, label: lang === 'pt' ? 'Todos' : 'All' }
  const options = [
    allOption,
    ...harnesses.map(h => ({ id: h as HarnessId | null, label: HARNESS_LABELS[h] })),
  ]

  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: 12,
        padding: '0 12px',
        borderLeft: '1px solid var(--border)',
      }}>
        {options.map(opt => {
          const active = opt.id === currentHarness
          const color = opt.id ? HARNESS_COLORS[opt.id] : undefined
          return (
            <div key={opt.id ?? '__all__'} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                onClick={() => handleSelect(opt.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px',
                  borderRadius: 7,
                  border: active
                    ? `1px solid ${color ? `${color}50` : 'var(--anthropic-orange)30'}`
                    : '1px solid transparent',
                  background: active
                    ? color ? `${color}18` : 'var(--anthropic-orange-dim)'
                    : 'transparent',
                  color: active
                    ? color ?? 'var(--anthropic-orange)'
                    : 'var(--text-tertiary)',
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                    ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'
                    ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  }
                }}
              >
                {opt.label}
              </button>
              {opt.id !== null && (
                <button
                  onClick={e => { e.stopPropagation(); setInfoHarness(opt.id as HarnessId) }}
                  title={`About ${HARNESS_LABELS[opt.id]} data`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 4,
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    padding: 0,
                    opacity: 0.6,
                  }}
                  onMouseEnter={e => {
                    ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                  }}
                  onMouseLeave={e => {
                    ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.6'
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'
                  }}
                >
                  <Info size={11} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {infoHarness && (
        <HarnessInfoModal harness={infoHarness} onClose={() => setInfoHarness(null)} />
      )}
    </>
  )
}
```

- [ ] **Step 4: Verify TypeScript and tests**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex && bun tsc --noEmit 2>&1 | head -20 && bun test 2>&1 | tail -10
```
Expected: Zero TS errors; all tests pass.

- [ ] **Step 5: Build verification**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex && bun run build 2>&1 | tail -20
```
Expected: Build completes without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "feat(web): wire harness info modal trigger to HarnessSelector in App.tsx"
```

---

### Task 5: Final integration commit

- [ ] **Step 1: Run full verification**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex && bun tsc --noEmit && bun test && bun run build 2>&1 | tail -5
```

- [ ] **Step 2: Write the SDD report**

Create `.superpowers/sdd/harness-info-modal-report.md` with:
- Files created/modified
- How each trigger is wired (ComparePage ⓘ, HarnessSelector ⓘ)
- tsc/test/build outputs
- Commit hash
- Any concerns

- [ ] **Step 3: Final squash/summary commit (optional)**

If desired by reviewer, squash into a single feat commit:
```bash
git log --oneline -5
```
Then decide based on review.

---

## Self-Review

**Spec coverage:**
- ✅ `HarnessInfo` interface with `source`, `contains`, `missing`, `note` — Task 1
- ✅ `HARNESS_INFO` with exact content for all 4 harnesses — Task 1
- ✅ `HarnessInfoModal` component with overlay, X button, Escape to close, colored header, all 4 sections — Task 2
- ✅ ⓘ in ComparePage harness cards — Task 3
- ✅ ⓘ in HarnessSelector per-harness buttons (NOT on All) — Task 4
- ✅ stopPropagation on ⓘ in HarnessSelector (won't navigate) — Task 4
- ✅ `bun tsc`, `bun test`, `bun run build` checks — Tasks 3, 4, 5
- ✅ Commit message matches spec: `feat(web): add per-harness info modal (data sources, captured/missing)`

**Placeholder scan:** No TBD/TODO/placeholder in any step.

**Type consistency:**
- `HarnessId` sourced from `@agentistics/core` throughout
- `HARNESS_INFO[harness]` typed as `HarnessInfo` everywhere
- Modal props `{ harness: HarnessId; onClose: () => void }` consistent across Task 2 (definition), Task 3 (usage), Task 4 (usage)
- `infoHarness: HarnessId | null` state consistent in both Task 3 and Task 4
