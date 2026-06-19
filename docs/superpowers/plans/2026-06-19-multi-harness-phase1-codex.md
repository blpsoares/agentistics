# Multi-harness Tracking — Phase 1 (Foundation + Codex) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a harness-adapter layer and add OpenAI Codex CLI as a fully tracked harness (real tokens, cost, model, tools) alongside Claude Code, with a dedicated `/codex` dashboard and a harness filter, without changing existing Claude behavior.

**Architecture:** A new `packages/server/server/adapters/` module directory defines a `HarnessAdapter` contract. Each harness has one adapter file that reads its on-disk format and returns normalized `SessionMeta[]` tagged with `harness`. `buildApiResponse` iterates available adapters and concatenates. The frontend reuses existing components, threading a new `harness` filter (mirroring the existing `project` filter) and rendering "N/A" for metrics a harness cannot produce (driven by a `HARNESS_CAPABILITIES` map in core).

**Tech Stack:** Bun, TypeScript, React + Vite, `@agentistics/core` shared package. Tests via `bun test`. Parsing functions are pure (no FS mocking).

## Global Constraints

- Everything in English: code, comments, commit messages, PR titles/descriptions, docs (per `CLAUDE.md`).
- Conventional Commits enforced by commitlint (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- pre-commit hook runs `bun tsc --noEmit` + `bun test` — both must pass before each commit.
- Never inline pricing/cost math — always use `calcCost()` / `getModelPrice()` from `@agentistics/core`.
- Never import `packages/server/server/*` modules from `packages/web/src/*` (Vite bundling fails on Node/Bun APIs).
- Do not mock the filesystem — keep parsing pure and test pure functions over string input.
- `SessionMeta.harness` defaults to `'claude'` when absent (backward compat with existing consolidated/archived files).
- New harness model price entries go in `MODEL_PRICING` (`packages/core/src/types.ts`); fallback rate stays Sonnet 4.6 (`$3/$15/$0.30/$3.75`).

---

## File Structure

**Create:**
- `packages/server/server/adapters/types.ts` — `HarnessId`, `HarnessAdapter` contract, adapter registry.
- `packages/server/server/adapters/codex-parse.ts` — pure parser: rollout JSONL string → `SessionMeta`.
- `packages/server/server/adapters/codex-parse.test.ts` — parser tests.
- `packages/server/server/adapters/codex.ts` — Codex adapter (thin FS reader implementing the contract).
- `packages/server/server/adapters/claude.ts` — Claude adapter wrapping the existing pipeline.
- `packages/web/src/lib/harness.ts` — frontend harness metadata (labels, colors, capability lookup helpers).
- `packages/web/src/pages/CodexPage.tsx` — dedicated Codex dashboard (thin wrapper over HomePage content with a fixed harness filter).

**Modify:**
- `packages/core/src/types.ts` — `HarnessId`, `SessionMeta.harness`, `HARNESS_CAPABILITIES`, `AppData.harnesses`, `Filters.harness`, OpenAI pricing in `MODEL_PRICING`, `formatModel`/`getModelColor` for OpenAI.
- `packages/server/server/config.ts` — `CODEX_DIR` + per-harness enable env vars.
- `packages/server/server/consolidate.ts` — namespace store by harness.
- `packages/server/server/data.ts` — orchestrate adapters; merge sessions; expose `harnesses`.
- `packages/web/src/hooks/useData.ts` — thread `harness` filter through `useDerivedStats`.
- `packages/web/src/App.tsx` — `/codex` route + harness nav selector.

---

## Task 1: Core harness types

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/src/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type HarnessId = 'claude' | 'codex' | 'gemini' | 'copilot'`
  - `SessionMeta.harness: HarnessId`
  - `export const HARNESS_CAPABILITIES: Record<HarnessId, HarnessCapabilities>`
  - `export interface HarnessCapabilities { tokens: boolean; cost: boolean; model: boolean; tools: boolean; agents: boolean; gitLines: boolean }`
  - `AppData.harnesses: HarnessId[]`
  - `Filters.harness?: HarnessId`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/types.test.ts`:

```ts
import { HARNESS_CAPABILITIES } from './types'

test('HARNESS_CAPABILITIES declares all four harnesses', () => {
  expect(Object.keys(HARNESS_CAPABILITIES).sort()).toEqual(['claude', 'codex', 'copilot', 'gemini'])
})

test('claude is fully capable, copilot has no tokens', () => {
  expect(HARNESS_CAPABILITIES.claude.tokens).toBe(true)
  expect(HARNESS_CAPABILITIES.claude.agents).toBe(true)
  expect(HARNESS_CAPABILITIES.codex.tokens).toBe(true)
  expect(HARNESS_CAPABILITIES.codex.agents).toBe(false)
  expect(HARNESS_CAPABILITIES.copilot.tokens).toBe(false)
  expect(HARNESS_CAPABILITIES.gemini.tokens).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/types.test.ts`
Expected: FAIL — `HARNESS_CAPABILITIES` is not exported.

- [ ] **Step 3: Add the types**

In `packages/core/src/types.ts`, near the top (before `SessionMeta`):

```ts
export type HarnessId = 'claude' | 'codex' | 'gemini' | 'copilot'

export interface HarnessCapabilities {
  tokens: boolean
  cost: boolean
  model: boolean
  tools: boolean
  agents: boolean
  gitLines: boolean
}

/** Single source of truth for which metrics each harness can produce.
 *  Drives "N/A vs real 0" rendering and what the unified view aggregates.
 *  gemini flips tokens/cost/model to true once Phase 3 OTel ingestion is active. */
export const HARNESS_CAPABILITIES: Record<HarnessId, HarnessCapabilities> = {
  claude:  { tokens: true,  cost: true,  model: true,  tools: true,  agents: true,  gitLines: true },
  codex:   { tokens: true,  cost: true,  model: true,  tools: true,  agents: false, gitLines: false },
  gemini:  { tokens: false, cost: false, model: false, tools: false, agents: false, gitLines: false },
  copilot: { tokens: false, cost: false, model: false, tools: false, agents: false, gitLines: false },
}
```

Add `harness: HarnessId` to `SessionMeta` (place it next to `_source`):

```ts
  harness: HarnessId
  _source?: 'meta' | 'jsonl' | 'subdir'
```

Add to `AppData`:

```ts
  harnesses: HarnessId[]
```

Add to `Filters`:

```ts
  harness?: HarnessId
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify types compile**

Run: `bun tsc --noEmit`
Expected: errors only about missing `harness` on `SessionMeta` literals elsewhere (those are fixed in later tasks). If `tsc` blocks the commit, make `harness` required but ensure Task 7/8 set it; for this commit only, temporarily confirm core package compiles in isolation: `cd packages/core && bun tsc --noEmit` (Expected: PASS), then return to repo root.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/types.test.ts
git commit -m "feat(core): add HarnessId, capabilities map, and harness field"
```

---

## Task 2: OpenAI/Codex pricing

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/src/types.test.ts`

**Interfaces:**
- Consumes: `calcCost`, `getModelPrice`, `MODEL_PRICING` (existing).
- Produces: OpenAI entries in `MODEL_PRICING`; `formatModel`/`getModelColor` recognize OpenAI ids.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/types.test.ts`:

```ts
import { getModelPrice, calcCost, formatModel } from './types'

test('gpt-5.5 resolves to a non-fallback price', () => {
  const price = getModelPrice('gpt-5.5')
  // Must differ from the Sonnet 4.6 fallback ($3 in / $15 out)
  expect(price.input === 3 && price.output === 15).toBe(false)
})

test('calcCost works for a codex usage record', () => {
  const cost = calcCost(
    { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    'gpt-5.5',
  )
  expect(cost).toBeGreaterThan(0)
})

test('formatModel renders gpt-5.5 readably', () => {
  expect(formatModel('gpt-5.5')).toBe('GPT-5.5')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/types.test.ts`
Expected: FAIL — `gpt-5.5` falls back to Sonnet price; `formatModel('gpt-5.5')` returns `'gpt-5.5'`.

- [ ] **Step 3: Add OpenAI pricing entries**

> Pricing note: use OpenAI's published GPT-5.x rates at implementation time. The values below are placeholders that must be confirmed against OpenAI's pricing page before merging; update them if they differ. (USD per 1M tokens.)

In `MODEL_PRICING` (`packages/core/src/types.ts`), add an OpenAI section:

```ts
  // OpenAI (Codex CLI) — confirm against OpenAI pricing before merge
  'gpt-5.5':        { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-5.1':        { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-5':          { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-5-mini':     { input: 0.25, output: 2,  cacheRead: 0.025, cacheWrite: 0.25 },
```

> `getModelPrice` already does bidirectional `startsWith` matching, so `gpt-5.5-codex` etc. resolve to the closest `gpt-5*` entry.

In `formatModel`'s map, add:

```ts
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.1': 'GPT-5.1',
    'gpt-5': 'GPT-5',
    'gpt-5-mini': 'GPT-5 mini',
```

In `getModelColor`, add an OpenAI branch before the final return:

```ts
  if (modelId.startsWith('gpt-')) return '#10a37f' // OpenAI green
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/types.test.ts
git commit -m "feat(core): add OpenAI/Codex model pricing and labels"
```

---

## Task 3: Harness adapter contract + registry

**Files:**
- Create: `packages/server/server/adapters/types.ts`

**Interfaces:**
- Consumes: `HarnessId`, `SessionMeta` from `@agentistics/core`; `ServerProject` from `../data` (type-only).
- Produces:
  - `export interface HarnessAdapter { id: HarnessId; isAvailable(): boolean; loadSessions(): Promise<SessionMeta[]>; loadProjects?(): Promise<ServerProject[]> }`
  - `export function getEnabledAdapters(): HarnessAdapter[]` (registry; reads enable env vars).

> No standalone unit test for this file — it is a contract + registry; it is exercised through Task 8's orchestration. (Per task right-sizing: scaffolding folds into the consumer's deliverable.)

- [ ] **Step 1: Create the contract file**

```ts
// packages/server/server/adapters/types.ts
import type { HarnessId, SessionMeta } from '@agentistics/core'
import type { ServerProject } from '../data'

export interface HarnessAdapter {
  id: HarnessId
  /** True when this harness's data directory exists on disk. */
  isAvailable(): boolean
  /** Normalized sessions with `harness` already set. Missing fields stay 0/undefined. */
  loadSessions(): Promise<SessionMeta[]>
  /** Optional harness-specific project discovery when not derivable from sessions. */
  loadProjects?(): Promise<ServerProject[]>
}

/** Env override: AGENTISTICS_HARNESS_<ID>=0 disables an adapter even if available. */
export function harnessEnabled(id: HarnessId): boolean {
  return process.env[`AGENTISTICS_HARNESS_${id.toUpperCase()}`] !== '0'
}
```

> The registry function `getEnabledAdapters()` is added in Task 8 (it imports the concrete adapters created in Tasks 6 and 7, which do not exist yet). Defining it here would create forward references to missing modules.

- [ ] **Step 2: Verify it compiles**

Run: `bun tsc --noEmit`
Expected: PASS (or only the pre-existing `harness`-missing errors from Task 1, resolved by Task 8).

- [ ] **Step 3: Commit**

```bash
git add packages/server/server/adapters/types.ts
git commit -m "feat(server): add HarnessAdapter contract"
```

---

## Task 4: Codex config paths

**Files:**
- Modify: `packages/server/server/config.ts`

**Interfaces:**
- Produces: `export const CODEX_DIR`, `export const CODEX_SESSIONS_DIR`.

- [ ] **Step 1: Add config constants**

Append to `packages/server/server/config.ts`:

```ts
// ---------------------------------------------------------------------------
// Other harnesses (Phase 1: Codex). Each adapter checks its own root.
// Override with CODEX_DIR; disable with AGENTISTICS_HARNESS_CODEX=0.
// ---------------------------------------------------------------------------
export const CODEX_DIR = process.env.CODEX_DIR ?? join(HOME_DIR, '.codex')
export const CODEX_SESSIONS_DIR = join(CODEX_DIR, 'sessions')
```

- [ ] **Step 2: Verify it compiles**

Run: `bun tsc --noEmit`
Expected: PASS (modulo Task 1 follow-ups).

- [ ] **Step 3: Commit**

```bash
git add packages/server/server/config.ts
git commit -m "feat(server): add Codex directory config"
```

---

## Task 5: Codex rollout parser (pure)

**Files:**
- Create: `packages/server/server/adapters/codex-parse.ts`
- Test: `packages/server/server/adapters/codex-parse.test.ts`

**Interfaces:**
- Consumes: `SessionMeta` from `@agentistics/core`.
- Produces: `export function parseCodexRollout(content: string, fallbackId: string): SessionMeta | null`.

**Format reference (verified):** rollout JSONL, one event per line. Relevant lines:
- `{"type":"session_meta","payload":{"id","timestamp","cwd","model_provider","cli_version","source"}}`
- `{"type":"turn_context", ... ,"model":"gpt-5.5"}`
- `{"type":"token_count", ... "total_token_usage":{"input_tokens","cached_input_tokens","output_tokens"}}` (cumulative — take the **last** occurrence)
- `{"type":"user_message"}` / `{"type":"agent_message"}` — message counts
- `{"type":"web_search_call"}` — web search usage
- tool/command events: `workspace-write`, `search`, `path` etc. → tool counts

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/adapters/codex-parse.test.ts
import { test, expect } from 'bun:test'
import { parseCodexRollout } from './codex-parse'

const SAMPLE = [
  JSON.stringify({ timestamp: '2026-05-25T18:25:51.037Z', type: 'session_meta', payload: { id: 'abc-123', timestamp: '2026-05-25T18:25:50.087Z', cwd: '/home/u/proj', model_provider: 'openai', cli_version: '0.133.0', source: 'vscode' } }),
  JSON.stringify({ type: 'turn_context', model: 'gpt-5.5' }),
  JSON.stringify({ type: 'user_message', payload: { text: 'hi' } }),
  JSON.stringify({ type: 'token_count', payload: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 5 } } }),
  JSON.stringify({ type: 'agent_message', payload: { text: 'hello' } }),
  JSON.stringify({ type: 'web_search_call' }),
  JSON.stringify({ type: 'token_count', payload: { total_token_usage: { input_tokens: 300, cached_input_tokens: 80, output_tokens: 42 } } }),
].join('\n')

test('parses a codex rollout into a SessionMeta', () => {
  const s = parseCodexRollout(SAMPLE, 'fallback-id')
  expect(s).not.toBeNull()
  expect(s!.session_id).toBe('abc-123')
  expect(s!.harness).toBe('codex')
  expect(s!.project_path).toBe('/home/u/proj')
  expect(s!.model).toBe('gpt-5.5')
  // last token_count wins (cumulative)
  expect(s!.input_tokens).toBe(300)
  expect(s!.output_tokens).toBe(42)
  expect(s!.cache_read_input_tokens).toBe(80)
  expect(s!.user_message_count).toBe(1)
  expect(s!.assistant_message_count).toBe(1)
  expect(s!.uses_web_search).toBe(true)
  expect(s!.start_time).toBe('2026-05-25T18:25:50.087Z')
  expect(s!._source).toBe('jsonl')
})

test('falls back to fallbackId and returns null on empty', () => {
  expect(parseCodexRollout('', 'fb')).toBeNull()
  const noMeta = parseCodexRollout(JSON.stringify({ type: 'user_message' }), 'fb-2')
  expect(noMeta!.session_id).toBe('fb-2')
  expect(noMeta!.user_message_count).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/adapters/codex-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```ts
// packages/server/server/adapters/codex-parse.ts
import type { SessionMeta } from '@agentistics/core'

const TOOL_EVENT_TYPES = new Set(['workspace-write', 'search', 'path', 'open_page', 'web_search_call'])

/** Pure: parse a Codex rollout JSONL string into a normalized SessionMeta.
 *  Returns null when the content has no usable lines. */
export function parseCodexRollout(content: string, fallbackId: string): SessionMeta | null {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null

  let sessionId = ''
  let cwd = ''
  let startTime = ''
  let endTime = ''
  let model: string | undefined
  let inputTokens = 0
  let outputTokens = 0
  let cacheRead = 0
  let userMessages = 0
  let assistantMessages = 0
  let usesWebSearch = false
  const toolCounts: Record<string, number> = {}

  for (const raw of lines) {
    let e: any
    try { e = JSON.parse(raw) } catch { continue }
    const type = e.type as string | undefined
    const payload = e.payload ?? e

    if (type === 'session_meta') {
      sessionId = payload.id ?? sessionId
      cwd = payload.cwd ?? cwd
      startTime = payload.timestamp ?? startTime
    } else if (type === 'turn_context') {
      if (typeof e.model === 'string') model = e.model
      else if (typeof payload.model === 'string') model = payload.model
    } else if (type === 'token_count') {
      const u = payload.total_token_usage ?? payload.info?.total_token_usage
      if (u) {
        // cumulative — last wins
        inputTokens = u.input_tokens ?? inputTokens
        outputTokens = u.output_tokens ?? outputTokens
        cacheRead = u.cached_input_tokens ?? cacheRead
      }
    } else if (type === 'user_message') {
      userMessages++
    } else if (type === 'agent_message') {
      assistantMessages++
    }

    if (type && TOOL_EVENT_TYPES.has(type)) {
      toolCounts[type] = (toolCounts[type] ?? 0) + 1
      if (type === 'web_search_call') usesWebSearch = true
    }
    if (typeof e.timestamp === 'string') endTime = e.timestamp
  }

  if (!startTime && typeof JSON.parse(lines[0]).timestamp === 'string') {
    startTime = JSON.parse(lines[0]).timestamp
  }

  const durationMinutes = startTime && endTime
    ? Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000)
    : 0

  return {
    session_id: sessionId || fallbackId,
    project_path: cwd,
    start_time: startTime || endTime || '',
    end_time: endTime || undefined,
    duration_minutes: durationMinutes,
    user_message_count: userMessages,
    assistant_message_count: assistantMessages,
    tool_counts: toolCounts,
    tool_output_tokens: {},
    agent_file_reads: {},
    languages: [],
    git_commits: 0,
    git_pushes: 0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: 0,
    first_prompt: '',
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: 0,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: false,
    uses_web_search: usesWebSearch,
    uses_web_fetch: false,
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: [],
    user_message_timestamps: [],
    model,
    harness: 'codex',
    _source: 'jsonl',
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/server/adapters/codex-parse.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/adapters/codex-parse.ts packages/server/server/adapters/codex-parse.test.ts
git commit -m "feat(server): add pure Codex rollout parser"
```

---

## Task 6: Codex adapter (FS reader)

**Files:**
- Create: `packages/server/server/adapters/codex.ts`

**Interfaces:**
- Consumes: `HarnessAdapter`, `harnessEnabled` (Task 3); `parseCodexRollout` (Task 5); `CODEX_SESSIONS_DIR` (Task 4); `safeReadDir` from `../utils`.
- Produces: `export const codexAdapter: HarnessAdapter`.

> Tested indirectly via Task 8 (orchestration) against the real `~/.codex` dir; the parsing logic itself is covered by Task 5's pure tests. The reader is a thin FS shell with no branching worth its own fixture.

- [ ] **Step 1: Implement the adapter**

```ts
// packages/server/server/adapters/codex.ts
import { join } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { SessionMeta } from '@agentistics/core'
import type { HarnessAdapter } from './types'
import { harnessEnabled } from './types'
import { CODEX_SESSIONS_DIR } from '../config'
import { createLimiter, safeReadDir } from '../utils'

/** Recursively collect rollout-*.jsonl paths under ~/.codex/sessions/YYYY/MM/DD/. */
async function collectRolloutFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await safeReadDir(dir)
  await Promise.all(entries.map(async name => {
    const full = join(dir, name)
    if (name.endsWith('.jsonl') && name.startsWith('rollout-')) {
      out.push(full)
    } else if (!name.includes('.')) {
      // year/month/day directories have no extension
      out.push(...await collectRolloutFiles(full))
    }
  }))
  return out
}

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  isAvailable() {
    return harnessEnabled('codex') && existsSync(CODEX_SESSIONS_DIR)
  },
  async loadSessions(): Promise<SessionMeta[]> {
    const { parseCodexRollout } = await import('./codex-parse')
    const files = await collectRolloutFiles(CODEX_SESSIONS_DIR)
    const limit = createLimiter(20)
    const sessions = await Promise.all(files.map(f => limit(async () => {
      const content = await readFile(f, 'utf-8').catch(() => '')
      const fallbackId = f.split('/').pop()?.replace(/\.jsonl$/, '') ?? f
      return parseCodexRollout(content, fallbackId)
    })))
    return sessions.filter((s): s is SessionMeta => s !== null && !!s.start_time)
  },
}
```

- [ ] **Step 2: Smoke-test against real data**

Run: `bun -e "import('./packages/server/server/adapters/codex.ts').then(async m => { const s = await m.codexAdapter.loadSessions(); console.log('codex sessions:', s.length, 'sample tokens:', s[0]?.input_tokens, s[0]?.model) })"`
Expected: prints a non-zero session count and a sample model like `gpt-5.5` (this machine has `~/.codex/sessions`). If 0, inspect path resolution before continuing.

- [ ] **Step 3: Commit**

```bash
git add packages/server/server/adapters/codex.ts
git commit -m "feat(server): add Codex harness adapter"
```

---

## Task 7: Claude adapter (wrap existing pipeline)

**Files:**
- Create: `packages/server/server/adapters/claude.ts`
- Modify: `packages/server/server/data.ts` (export the existing Claude session-loading so the adapter can call it; tag sessions with `harness: 'claude'`)

**Interfaces:**
- Consumes: existing `loadSessionMetas`, `scanProjects` from `../data`.
- Produces: `export const claudeAdapter: HarnessAdapter`.

**Goal:** zero behavior change for Claude. The adapter delegates to the existing functions and stamps `harness: 'claude'` on every session that lacks it.

- [ ] **Step 1: Write the parity test**

```ts
// packages/server/server/adapters/claude.test.ts
import { test, expect } from 'bun:test'
import { claudeAdapter } from './claude'

test('claude adapter returns sessions all tagged claude', async () => {
  const sessions = await claudeAdapter.loadSessions()
  // On this machine ~/.claude exists with sessions
  expect(sessions.length).toBeGreaterThan(0)
  expect(sessions.every(s => s.harness === 'claude')).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/adapters/claude.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

```ts
// packages/server/server/adapters/claude.ts
import { existsSync } from 'fs'
import type { SessionMeta } from '@agentistics/core'
import type { HarnessAdapter } from './types'
import { harnessEnabled } from './types'
import { CLAUDE_DIR } from '../config'
import { loadSessionMetas, scanProjects } from '../data'

export const claudeAdapter: HarnessAdapter = {
  id: 'claude',
  isAvailable() {
    return harnessEnabled('claude') && existsSync(CLAUDE_DIR)
  },
  async loadSessions(): Promise<SessionMeta[]> {
    const metaMap = await loadSessionMetas()
    const { extraSessions } = await scanProjects(metaMap)
    const all = [...metaMap.values(), ...extraSessions]
    return all.map(s => (s.harness ? s : { ...s, harness: 'claude' as const }))
  },
}
```

> If `scanProjects`'s current signature differs (it returns `{ projects, extraSessions }` and may require args), match it exactly — read `data.ts:286` before writing. Do not change its behavior; only consume it.

- [ ] **Step 4: Ensure existing Claude session construction sets `harness`**

In `packages/server/server/data.ts`, every place that builds a `SessionMeta` literal (in `loadSessionMetas`, `parseSessionJsonl` consumers, and `scanProjects`) must include `harness: 'claude'`. Add `harness: 'claude'` to each constructed object. For sessions coming from `parseSessionJsonl` (in `jsonl.ts`), stamp it at the call site in `data.ts` rather than editing the parser, e.g. `extraSessions.push({ ...parsed, harness: 'claude' })`.

- [ ] **Step 5: Run test + typecheck**

Run: `bun test packages/server/server/adapters/claude.test.ts && bun tsc --noEmit`
Expected: PASS; `tsc` clean (all `SessionMeta` literals now have `harness`).

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/adapters/claude.ts packages/server/server/adapters/claude.test.ts packages/server/server/data.ts
git commit -m "feat(server): wrap Claude pipeline in a harness adapter"
```

---

## Task 8: Orchestrate adapters in buildApiResponse

**Files:**
- Modify: `packages/server/server/adapters/types.ts` (add `getEnabledAdapters`)
- Modify: `packages/server/server/data.ts` (merge non-Claude sessions; set `AppData.harnesses`)

**Interfaces:**
- Consumes: `claudeAdapter`, `codexAdapter`.
- Produces: `export function getEnabledAdapters(): HarnessAdapter[]`; `ApiResponse` now includes `harnesses: HarnessId[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/adapters/registry.test.ts
import { test, expect } from 'bun:test'
import { getEnabledAdapters } from './types'

test('registry includes claude and codex when available', () => {
  const ids = getEnabledAdapters().map(a => a.id)
  expect(ids).toContain('claude')
  // codex is available on this machine
  expect(ids).toContain('codex')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/adapters/registry.test.ts`
Expected: FAIL — `getEnabledAdapters` not exported.

- [ ] **Step 3: Add the registry**

Append to `packages/server/server/adapters/types.ts`:

```ts
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'

const ALL_ADAPTERS: HarnessAdapter[] = [claudeAdapter, codexAdapter]

/** Adapters whose data is present and not disabled via env. */
export function getEnabledAdapters(): HarnessAdapter[] {
  return ALL_ADAPTERS.filter(a => a.isAvailable())
}
```

- [ ] **Step 4: Merge non-Claude sessions into the response**

In `data.ts` `_buildApiResponseCore`, after the existing Claude `sessions` array is built and consolidated (around `data.ts:611`, after the sort), add:

```ts
    // --- Other harnesses (Codex, …): append their normalized sessions ---
    const { getEnabledAdapters } = await import('./adapters/types')
    const harnessSet = new Set<HarnessId>(['claude'])
    for (const adapter of getEnabledAdapters()) {
      if (adapter.id === 'claude') continue // already loaded above
      const extra = await adapter.loadSessions().catch(() => [] as SessionMeta[])
      for (const s of extra) {
        // Key by (harness, session_id) so IDs never collide across harnesses
        sessions.push(s)
        harnessSet.add(s.harness)
        // surface as a project too
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
    sessions.sort((a, b) => b.start_time.localeCompare(a.start_time))
```

> Important: do NOT pass non-Claude sessions through `supplementStatsCache` (it assumes Claude's stats-cache semantics). Call the harness merge **after** `supplementStatsCache(statsCache, sessions)` so Claude totals are unaffected. Move the merge block to run after line 619. Non-Claude tokens are surfaced via `useDerivedStats` filtering, not the legacy `statsCache`.

Add `HarnessId` to the type import at the top of `data.ts`:

```ts
import type { StatsCache, SessionMeta, ProjectGitStats, HealthIssue, HarnessId } from '@agentistics/core'
```

Update `ApiResponse` and the return:

```ts
export interface ApiResponse {
  statsCache: StatsCache
  projects: ServerProject[]
  allSessions: []
  sessions: SessionMeta[]
  healthIssues: HealthIssue[]
  homeDir: string
  harnesses: HarnessId[]
}
```

```ts
    return { statsCache, projects, allSessions: [] as [], sessions, healthIssues, homeDir: HOME_DIR, harnesses: Array.from(harnessSet) }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test packages/server/server/adapters/registry.test.ts && bun tsc --noEmit`
Expected: PASS; clean typecheck.

- [ ] **Step 6: Integration smoke test**

Run: `bun -e "import('./packages/server/server/data.ts').then(async m => { const r = await (m as any).buildApiResponseStream(()=>{}); console.log('harnesses:', r.harnesses, 'total sessions:', r.sessions.length, 'codex:', r.sessions.filter((s:any)=>s.harness==='codex').length) })"`
Expected: `harnesses` includes `claude` and `codex`; codex session count > 0.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/adapters/types.ts packages/server/server/adapters/registry.test.ts packages/server/server/data.ts
git commit -m "feat(server): orchestrate harness adapters in buildApiResponse"
```

---

## Task 9: Namespace the consolidate store by harness

**Files:**
- Modify: `packages/server/server/consolidate.ts`
- Test: `packages/server/server/consolidate.test.ts`

**Interfaces:**
- Consumes: `SessionMeta`, `HarnessId`.
- Produces: `writeConsolidated` writes to `<CONSOLIDATED_DIR>/<harness>/<id>.json`; `loadConsolidated` reads all harness subdirs; legacy flat files load as `claude`.

> Keeps `(harness, session_id)` unique on disk and prevents Codex/Claude id collisions.

- [ ] **Step 1: Write the failing test (pure path helper)**

Add a pure helper to test without FS. In `consolidate.test.ts`:

```ts
import { test, expect } from 'bun:test'
import { consolidatedPath } from './consolidate'

test('consolidatedPath namespaces by harness', () => {
  expect(consolidatedPath('codex', 'abc')).toMatch(/\/sessions\/codex\/abc\.json$/)
  expect(consolidatedPath('claude', 'xyz')).toMatch(/\/sessions\/claude\/xyz\.json$/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/server/consolidate.test.ts`
Expected: FAIL — `consolidatedPath` not exported.

- [ ] **Step 3: Implement namespacing**

Rewrite `consolidate.ts` so writes/reads are per-harness, with backward-compatible reading of legacy flat files:

```ts
import { join } from 'path'
import { mkdir, writeFile, readFile } from 'fs/promises'
import type { SessionMeta, HarnessId } from '@agentistics/core'
import { CONSOLIDATED_DIR } from './config'
import { createLimiter, safeReadDir, safeReadJson } from './utils'

const writeLimit = createLimiter(20)
const readyDirs = new Set<string>()

export function consolidatedPath(harness: HarnessId, sessionId: string): string {
  return join(CONSOLIDATED_DIR, harness, `${sessionId}.json`)
}

async function ensureDir(harness: HarnessId): Promise<void> {
  if (readyDirs.has(harness)) return
  await mkdir(join(CONSOLIDATED_DIR, harness), { recursive: true })
  readyDirs.add(harness)
}

export async function writeConsolidated(sessions: SessionMeta[]): Promise<number> {
  if (sessions.length === 0) return 0
  const counts = await Promise.all(sessions.map(s => writeLimit(async () => {
    if (!s.session_id) return 0
    const harness = s.harness ?? 'claude'
    await ensureDir(harness)
    const dest = consolidatedPath(harness, s.session_id)
    const next = JSON.stringify(s)
    const prev = await readFile(dest, 'utf-8').catch(() => null)
    if (prev === next) return 0
    await writeFile(dest, next)
    return 1
  })))
  return counts.reduce<number>((a, b) => a + b, 0)
}

export async function loadConsolidated(): Promise<Map<string, SessionMeta>> {
  const map = new Map<string, SessionMeta>()
  const limit = createLimiter(40)
  // Per-harness subdirs + legacy flat files (treated as claude)
  const harnesses: HarnessId[] = ['claude', 'codex', 'gemini', 'copilot']
  const roots = [
    ...harnesses.map(h => ({ dir: join(CONSOLIDATED_DIR, h), legacy: false })),
    { dir: CONSOLIDATED_DIR, legacy: true },
  ]
  for (const { dir, legacy } of roots) {
    const files = await safeReadDir(dir)
    await Promise.all(files.filter(f => f.endsWith('.json')).map(f => limit(async () => {
      const s = await safeReadJson<SessionMeta>(join(dir, f))
      if (!s?.session_id) return
      if (!s.harness) s.harness = 'claude'
      // (harness, id) key; first writer wins per key
      const key = `${s.harness}:${s.session_id}`
      if (!map.has(key)) map.set(key, s)
    })))
    if (legacy) break
  }
  // Caller expects id-keyed map; collapse to id (live merge re-dedups by id anyway)
  const byId = new Map<string, SessionMeta>()
  for (const s of map.values()) if (!byId.has(s.session_id)) byId.set(s.session_id, s)
  return byId
}
```

> Note: `safeReadDir` on `CONSOLIDATED_DIR` returns both files (legacy) and subdir names; `safeReadJson` on a subdir name returns null, so it is naturally skipped. Confirm `safeReadDir` returns names not full paths (it does — see `utils.ts`).

- [ ] **Step 4: Run test + typecheck**

Run: `bun test packages/server/server/consolidate.test.ts && bun tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/consolidate.ts packages/server/server/consolidate.test.ts
git commit -m "feat(server): namespace consolidated store by harness"
```

---

## Task 10: Thread the harness filter through the frontend data hook

**Files:**
- Create: `packages/web/src/lib/harness.ts`
- Modify: `packages/web/src/hooks/useData.ts`
- Test: `packages/web/src/hooks/useData.test.ts`

**Interfaces:**
- Consumes: `HarnessId`, `HARNESS_CAPABILITIES`, `Filters` from `@agentistics/core`.
- Produces:
  - `harness.ts`: `HARNESS_LABELS: Record<HarnessId, string>`, `HARNESS_COLORS: Record<HarnessId, string>`, `capable(harness, metric): boolean`.
  - `useDerivedStats` filters sessions by `filters.harness` when set.

- [ ] **Step 1: Create harness frontend metadata**

```ts
// packages/web/src/lib/harness.ts
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
```

- [ ] **Step 2: Write the failing test for the filter**

In `packages/web/src/hooks/useData.test.ts`, add a test for the filtering logic. If `useDerivedStats` is a hook (not directly callable), extract the session-filtering predicate into a pure exported helper `filterByHarness(sessions, harness)` and test that:

```ts
import { filterByHarness } from './useData'

test('filterByHarness keeps only the chosen harness', () => {
  const sessions = [
    { session_id: '1', harness: 'claude' },
    { session_id: '2', harness: 'codex' },
  ] as any
  expect(filterByHarness(sessions, 'codex').map((s: any) => s.session_id)).toEqual(['2'])
  expect(filterByHarness(sessions, undefined).length).toBe(2)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/web/src/hooks/useData.test.ts`
Expected: FAIL — `filterByHarness` not exported.

- [ ] **Step 4: Implement `filterByHarness` and apply it in `useDerivedStats`**

In `useData.ts`:

```ts
import type { HarnessId } from '@agentistics/core'

export function filterByHarness<T extends { harness?: HarnessId }>(sessions: T[], harness?: HarnessId): T[] {
  if (!harness) return sessions
  return sessions.filter(s => (s.harness ?? 'claude') === harness)
}
```

In `useDerivedStats`, before the existing project/date filtering, apply `filterByHarness(sessions, filters.harness)` so all downstream derived metrics (tokens, cost, sessions, activity) respect the active harness. Ensure the existing date/project filters still compose on top of the harness-filtered list.

- [ ] **Step 5: Run test + typecheck**

Run: `bun test packages/web/src/hooks/useData.test.ts && bun tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/harness.ts packages/web/src/hooks/useData.ts packages/web/src/hooks/useData.test.ts
git commit -m "feat(web): add harness filter and metadata"
```

---

## Task 11: Codex page + harness navigation

**Files:**
- Create: `packages/web/src/pages/CodexPage.tsx`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `AppData.harnesses`, `Filters.harness`, `HARNESS_LABELS`, `useData`.
- Produces: `/codex` route; a harness selector in the top nav that sets `filters.harness` (the empty/"All" choice = unified).

- [ ] **Step 1: Create the Codex page**

`CodexPage.tsx` renders the same dashboard content as `HomePage` but forces `filters.harness = 'codex'`. The simplest implementation reuses the HomePage layout via the outlet context, setting the harness filter on mount. If HomePage reads `filters` from `useOutletContext`, CodexPage wraps it:

```tsx
// packages/web/src/pages/CodexPage.tsx
import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AppContext } from '../lib/app-context'
import HomePage from './HomePage'

export default function CodexPage() {
  const ctx = useOutletContext<AppContext>()
  useEffect(() => {
    ctx.setFilters(f => ({ ...f, harness: 'codex' }))
    return () => ctx.setFilters(f => ({ ...f, harness: undefined }))
  }, [])
  return <HomePage />
}
```

> If `AppContext` has no `setFilters`, add it in `app-context.ts` and provide it from `App.tsx` (it already manages `filters` state — expose the setter). This is the same pattern used for the existing project filter.

- [ ] **Step 2: Add the route and nav selector**

In `App.tsx`:
- Register `<Route path="/codex" element={<CodexPage />} />` next to the existing routes.
- Add a harness selector (dropdown or tab group) in the top nav, populated from `data.harnesses` mapped through `HARNESS_LABELS`, plus an "All" option. Selecting a harness navigates to `/<harness>` (for `codex`) or sets `filters.harness` directly; "All" clears it and returns to `/`.
- Only render harness options present in `data.harnesses` (so Claude-only users see no extra chrome).

- [ ] **Step 3: Verify it builds and runs**

Run: `bun run build`
Expected: Vite build succeeds (no type errors, no server-module imports leaking into web).

Then manually: `bun run dev`, open `http://localhost:47292/codex`, confirm Codex sessions/tokens/cost render and the harness selector switches views. Cards for capabilities Codex lacks (agents, git lines) should show "N/A" — wire those in the relevant cards using `capable('codex', 'agents')` etc. where a component would otherwise show a misleading 0.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/CodexPage.tsx packages/web/src/App.tsx packages/web/src/lib/app-context.ts
git commit -m "feat(web): add Codex dashboard page and harness selector"
```

---

## Task 12: Wire N/A rendering into capability-gated cards

**Files:**
- Modify: relevant components in `packages/web/src/components/` (e.g. the agent-metrics card, git-lines KPI) and any KPI that would show a misleading `0` for Codex.

**Interfaces:**
- Consumes: `capable(harness, metric)` from `lib/harness.ts`; active `filters.harness`.

- [ ] **Step 1: Identify capability-gated UI**

Grep for components that render agent metrics and git line counts:

Run: `grep -rln "agentMetrics\|lines_added\|git_stats" packages/web/src/components`

For each, when `filters.harness` is set and `!capable(filters.harness, <metric>)`, render an `N/A` placeholder instead of `0`/empty.

- [ ] **Step 2: Apply the guard**

In each identified component, add at the top of the metric render:

```tsx
import { capable } from '../lib/harness'
// ...
if (harness && !capable(harness, 'agents')) return <NAtag label="Agent metrics" />
```

(Use a small shared `NAtag` presentational component; create it in `packages/web/src/components/NAtag.tsx` if one does not exist: a muted "N/A — not available for {harness}" chip.)

- [ ] **Step 3: Verify in the running app**

Run: `bun run dev`, open `/codex`, confirm agent-metrics and git-line cards show N/A while tokens/cost/tools render real data.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components
git commit -m "feat(web): render N/A for capabilities a harness lacks"
```

---

## Task 13: Update documentation

**Files:**
- Modify: `CLAUDE.md` (add the adapters layer + harness model to architecture); `packages/server/server/` section.

- [ ] **Step 1: Document the adapter layer**

Add to `CLAUDE.md` under the server modules list:

```
  ├── adapters/types.ts    → HarnessAdapter contract + getEnabledAdapters() registry
  ├── adapters/claude.ts   → wraps the existing Claude pipeline behind the contract
  ├── adapters/codex.ts    → Codex CLI reader (~/.codex/sessions/**/rollout-*.jsonl)
  └── adapters/codex-parse.ts → pure rollout parser → SessionMeta (harness: 'codex')
```

Add a short "Multi-harness" section explaining: `SessionMeta.harness`, `HARNESS_CAPABILITIES` as the N/A source of truth, per-harness consolidate namespacing, and the dedicated-page + harness-filter UI model. Note Phases 2 (Gemini/Copilot local) and 3 (Gemini OTel) are future plans.

- [ ] **Step 2: Verify full test suite + typecheck**

Run: `bun tsc --noEmit && bun test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document harness adapter layer and Codex support"
```

---

## Self-Review

**Spec coverage:**
- Adapter contract + modules-not-packages → Tasks 3, 6, 7. ✅
- `harness` tag + `HARNESS_CAPABILITIES` + `AppData.harnesses` + `Filters.harness` → Task 1. ✅
- Codex rich parsing (tokens incl. cache, model, tools, web search) → Tasks 5, 6. ✅
- OpenAI pricing via existing `calcCost` → Task 2. ✅
- Orchestration in `buildApiResponse`, dedup by `(harness, id)`, no false totals → Task 8 (merge runs after `supplementStatsCache`). ✅
- Dedicated `/codex` page + harness selector + unified-by-default → Tasks 11, 12. ✅
- Per-harness consolidate namespacing + legacy migration → Task 9. ✅
- N/A degradation → Tasks 1 (map), 12 (UI). ✅
- Backward compat (`harness` defaults to claude) → Tasks 1, 7, 9. ✅
- Gemini/Copilot local (Phase 2), Gemini OTel (Phase 3), full archive namespacing → **deferred to their own plans** (this plan covers consolidate; full-archive namespacing is grouped with Phase 2 where Gemini/Copilot raw mirroring is introduced). Noted, not a gap.

**Placeholder scan:** Pricing numbers in Task 2 are explicitly flagged as "confirm against OpenAI before merge" with real placeholder values + a verification step — not a silent TODO. No "TBD"/"handle edge cases"/"write tests for the above" without code. ✅

**Type consistency:** `HarnessId`, `HarnessCapabilities`, `HARNESS_CAPABILITIES`, `SessionMeta.harness`, `Filters.harness`, `AppData.harnesses`, `parseCodexRollout(content, fallbackId)`, `codexAdapter`/`claudeAdapter`, `getEnabledAdapters()`, `harnessEnabled()`, `consolidatedPath(harness, id)`, `filterByHarness(sessions, harness)`, `capable(harness, metric)`, `HARNESS_LABELS`/`HARNESS_COLORS` — names used consistently across tasks. ✅

**Note on full-archive namespacing:** This plan namespaces only the *consolidate* store (Task 9). The *full* raw-mirror archive (`archive.ts`) namespacing is intentionally bundled into Phase 2, where Gemini/Copilot raw transcripts first need mirroring — Codex's consolidate coverage is sufficient for Phase 1's metrics. Flagged here so it is not mistaken for an omission.
