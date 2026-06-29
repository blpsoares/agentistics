# Compare Page — Hour/Day/Activity/Peak Comparatives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `computeHarnessSummaries` with hour-of-day, day-of-week, activity-over-time, and peak fields, then render four new comparative sections on ComparePage.

**Architecture:** Pure function extension in `useData.ts` to add new fields to each harness summary; new lightweight components for mini bar/sparkline charts; ComparePage renders the new sections below the existing table. No new npm dependencies — charts use CSS bars (the existing recharts import stays but new mini-charts are CSS-only for compactness).

**Tech Stack:** React + TypeScript, date-fns (already installed: `parseISO`, `format`, `getDay`), `calcCost`/`getModelPrice` from `@agentistics/core`, CSS variables from the design system.

## Global Constraints

- English: all code, comments, UI text, commit messages
- Never inline cost math — always `calcCost(usage, modelId)` from `@agentistics/core`
- Never import `packages/server/server/*` from `packages/web/src/`
- `bun tsc --noEmit` must pass (zero errors)
- `bun test` must pass (all existing + new tests)
- `bun run build` must succeed
- Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- `capable(harness, metric)` gates must be respected for N/A rendering
- No new npm dependencies

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/web/src/hooks/useData.ts` | Modify | Extend `computeHarnessSummaries` return type + implementation |
| `packages/web/src/hooks/useData.test.ts` | Modify | Update existing test helper + add focused tests for new fields |
| `packages/web/src/pages/ComparePage.tsx` | Modify | Add four new comparative sections below the existing table |

No new files — the mini-charts are inline JSX inside ComparePage.tsx.

---

## Task 1: Extend `computeHarnessSummaries` — new fields + updated return type

**Files:**
- Modify: `packages/web/src/hooks/useData.ts` — `computeHarnessSummaries` function (lines 209–277)

**Interfaces:**
- Produces: extended `HarnessSummary` type with `hourCounts`, `peakHour`, `dowCounts`, `peakDow`, `dailyActivity`, `peakTokenDay`, `peakSessionCost`

### Background — data sources

| Field | Claude source | Non-Claude source |
|-------|--------------|-------------------|
| `hourCounts[0..23]` | `data.statsCache.hourCounts` (Record<string,number> — keys are string hours) | sum each session's `message_hours: number[]` |
| `peakHour` | index of max in `hourCounts` | same |
| `dowCounts[0..6]` | derive from `statsCache.dailyActivity` — `getDay(parseISO(d.date))` → add `d.sessionCount` | `getDay(parseISO(s.start_time))` → +1 per session |
| `peakDow` | index of max in `dowCounts` | same |
| `dailyActivity` | `statsCache.dailyActivity.map(d => ({date: d.date, sessions: d.sessionCount}))` sorted asc | group sessions by `start_time` day, +1 per session |
| `peakTokenDay` | max daily token sum from `statsCache.dailyModelTokens` (sum all `tokensByModel` values) | `capable(h,'tokens')` → group sessions by day summing `input_tokens+output_tokens`, take max. Others → null |
| `peakSessionCost` | null (hard to get per-session from statsCache) | `capable(h,'cost')` → `calcCost({inputTokens,outputTokens,cacheReadInputTokens:s.cache_read_input_tokens??0,cacheCreationInputTokens:s.cache_creation_input_tokens??0,webSearchRequests:0,costUSD:0}, s.model)` per session; take max. Others → null |

Note: `getDay` from date-fns is already imported in useData.ts (check — it's NOT currently imported; add it to the existing import line alongside `format`, `parseISO`, etc.).

- [ ] **Step 1: Add `getDay` to the date-fns import at the top of useData.ts**

Current import (line 4):
```typescript
import { subDays, isAfter, isBefore, parseISO, startOfDay, endOfDay, format, differenceInCalendarDays, addDays } from 'date-fns'
```

New import:
```typescript
import { subDays, isAfter, isBefore, parseISO, startOfDay, endOfDay, format, differenceInCalendarDays, addDays, getDay } from 'date-fns'
```

- [ ] **Step 2: Define the extended HarnessSummary type inline above `computeHarnessSummaries`**

Add this interface right above the function (around line 208):
```typescript
export interface HarnessSummary {
  sessions: number
  messages: number
  inputTokens: number
  outputTokens: number
  costUSD: number
  hourCounts: number[]       // length 24, index = hour-of-day (0-23)
  peakHour: number | null    // hour with max count, null if all zero
  dowCounts: number[]        // length 7, index 0=Sunday..6=Saturday
  peakDow: number | null     // index of max dowCounts, null if all zero
  dailyActivity: { date: string; sessions: number }[]  // sorted ascending
  peakTokenDay: { date: string; tokens: number } | null  // null if no token data
  peakSessionCost: number | null  // null if no cost data / claude
}
```

- [ ] **Step 3: Update the `computeHarnessSummaries` function signature to use `HarnessSummary`**

Change the return type annotation (currently line 211–212):
```typescript
export function computeHarnessSummaries(
  data: import('@agentistics/core').AppData,
): Record<HarnessId, HarnessSummary> {
  const result = {} as Record<HarnessId, HarnessSummary>
```

- [ ] **Step 4: Add the helper `peakIndex` function above `computeHarnessSummaries`**

```typescript
function peakIndex(arr: number[]): number | null {
  let maxVal = 0
  let maxIdx: number | null = null
  for (let i = 0; i < arr.length; i++) {
    if ((arr[i] ?? 0) > maxVal) {
      maxVal = arr[i]!
      maxIdx = i
    }
  }
  return maxIdx
}
```

- [ ] **Step 5: Implement the Claude branch new fields**

Inside the `if (harness === 'claude')` branch, after computing `costUSD` (just before `result['claude'] = {`), add:

```typescript
      // ── Claude: hour-of-day from statsCache.hourCounts ──
      const claudeHourCounts = Array.from({ length: 24 }, (_, i) => data.statsCache.hourCounts?.[String(i)] ?? 0)

      // ── Claude: dow from statsCache.dailyActivity ──
      const claudeDowCounts = Array.from({ length: 7 }, () => 0)
      for (const d of data.statsCache.dailyActivity ?? []) {
        const dow = getDay(parseISO(d.date))
        claudeDowCounts[dow] = (claudeDowCounts[dow] ?? 0) + d.sessionCount
      }

      // ── Claude: daily activity for sparkline ──
      const claudeDailyActivity = (data.statsCache.dailyActivity ?? [])
        .map(d => ({ date: d.date, sessions: d.sessionCount }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // ── Claude: peak token day from statsCache.dailyModelTokens ──
      let claudePeakTokenDay: { date: string; tokens: number } | null = null
      for (const d of data.statsCache.dailyModelTokens ?? []) {
        const tokens = Object.values(d.tokensByModel).reduce((s, t) => s + t, 0)
        if (!claudePeakTokenDay || tokens > claudePeakTokenDay.tokens) {
          claudePeakTokenDay = { date: d.date, tokens }
        }
      }
```

Then update the `result['claude'] = {` assignment to include the new fields:

```typescript
      result['claude'] = {
        sessions: claudeBase + claudeGapSessions,
        messages: messageBase + claudeGapMessages,
        inputTokens,
        outputTokens,
        costUSD,
        hourCounts: claudeHourCounts,
        peakHour: peakIndex(claudeHourCounts),
        dowCounts: claudeDowCounts,
        peakDow: peakIndex(claudeDowCounts),
        dailyActivity: claudeDailyActivity,
        peakTokenDay: claudePeakTokenDay,
        peakSessionCost: null,  // statsCache has no per-session cost breakdown
      }
```

- [ ] **Step 6: Implement non-Claude branch new fields**

Replace the non-Claude branch (the `else` block, currently ending around line 272). Replace the entire else block:

```typescript
    } else {
      // ── Non-Claude: pure per-session sums ──
      const harnessSessions = data.sessions.filter(s => s.harness === harness)
      let sessions = harnessSessions.length
      let messages = 0
      let inputTokens = 0
      let outputTokens = 0
      let costUSD = 0

      const hourCounts = Array.from({ length: 24 }, () => 0)
      const dowCounts = Array.from({ length: 7 }, () => 0)
      const dailyMap: Record<string, number> = {}
      const tokensByDay: Record<string, number> = {}
      let peakSessionCost: number | null = null

      const hasCost = HARNESS_CAPABILITIES[harness].cost
      const hasTokens = HARNESS_CAPABILITIES[harness].tokens

      for (const s of harnessSessions) {
        messages += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
        inputTokens += s.input_tokens ?? 0
        outputTokens += s.output_tokens ?? 0

        // hour-of-day
        for (const h of s.message_hours ?? []) {
          if (h >= 0 && h <= 23) hourCounts[h] = (hourCounts[h] ?? 0) + 1
        }

        // day-of-week + daily activity
        if (s.start_time) {
          const dow = getDay(parseISO(s.start_time))
          dowCounts[dow] = (dowCounts[dow] ?? 0) + 1
          const day = format(parseISO(s.start_time), 'yyyy-MM-dd')
          dailyMap[day] = (dailyMap[day] ?? 0) + 1

          if (hasTokens) {
            const sessionTokens = (s.input_tokens ?? 0) + (s.output_tokens ?? 0)
            tokensByDay[day] = (tokensByDay[day] ?? 0) + sessionTokens
          }
        }

        // cost
        if (s.model && hasCost) {
          const sessionCost = calcCost({
            inputTokens: s.input_tokens ?? 0,
            outputTokens: s.output_tokens ?? 0,
            cacheReadInputTokens: s.cache_read_input_tokens ?? 0,
            cacheCreationInputTokens: s.cache_creation_input_tokens ?? 0,
            webSearchRequests: 0,
            costUSD: 0,
          }, s.model)
          costUSD += sessionCost
          if (peakSessionCost === null || sessionCost > peakSessionCost) {
            peakSessionCost = sessionCost
          }
        }
      }

      // daily activity sorted asc
      const dailyActivity = Object.entries(dailyMap)
        .map(([date, sessions]) => ({ date, sessions }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // peak token day
      let peakTokenDay: { date: string; tokens: number } | null = null
      if (hasTokens) {
        for (const [date, tokens] of Object.entries(tokensByDay)) {
          if (!peakTokenDay || tokens > peakTokenDay.tokens) {
            peakTokenDay = { date, tokens }
          }
        }
      }

      result[harness] = {
        sessions,
        messages,
        inputTokens,
        outputTokens,
        costUSD,
        hourCounts,
        peakHour: peakIndex(hourCounts),
        dowCounts,
        peakDow: peakIndex(dowCounts),
        dailyActivity,
        peakTokenDay,
        peakSessionCost: hasCost ? peakSessionCost : null,
      }
    }
```

Note: `HARNESS_CAPABILITIES` must be imported. Check the current imports — it comes from `@agentistics/core`. Add it to the existing core import:

```typescript
import type { AppData, Filters, DateRange, AgentInvocation, HarnessId } from '@agentistics/core'
import { calcCost, getModelPrice, MODEL_PRICING, HARNESS_CAPABILITIES } from '@agentistics/core'
```

- [ ] **Step 7: Verify TypeScript compiles with zero errors**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex
bun tsc --noEmit
```

Expected: no errors. Fix any type errors before proceeding.

- [ ] **Step 8: Commit the pure function changes**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex
git add packages/web/src/hooks/useData.ts
git commit -m "feat(web): add hour/day/activity/peak fields to computeHarnessSummaries"
```

---

## Task 2: Update and extend tests for `computeHarnessSummaries`

**Files:**
- Modify: `packages/web/src/hooks/useData.test.ts`

**Interfaces:**
- Consumes: `HarnessSummary` (from Task 1), `computeHarnessSummaries`, `makeAppData` helper

### What changes in existing tests

The `makeAppData` helper and existing `computeHarnessSummaries` tests still pass because:
- We added new fields to the return type, but the existing assertions only check `sessions`, `messages`, `inputTokens`, `outputTokens`, `costUSD`
- The new fields may be absent from fixture sessions (`message_hours: []`, etc.) → hourCounts all-zero → `peakHour: null`

Add `hourCounts: {}` to `statsCache` in `makeAppData` (it's already there in the test fixture). Verify existing tests still pass after Task 1.

### New tests to add

- [ ] **Step 1: Add focused test group for new fields**

Append to `packages/web/src/hooks/useData.test.ts` after the existing `computeHarnessSummaries` describe block:

```typescript
// ── computeHarnessSummaries — new fields (hour/dow/activity/peaks) ─────────────

describe('computeHarnessSummaries — hourCounts and peakHour', () => {
  function makeSession(overrides: Partial<import('@agentistics/core').SessionMeta>): import('@agentistics/core').SessionMeta {
    return {
      session_id: 'test',
      harness: 'codex',
      project_path: '/p',
      start_time: '2026-06-10T08:00:00Z',
      end_time: undefined,
      duration_minutes: 5,
      user_message_count: 1,
      assistant_message_count: 1,
      tool_counts: {},
      tool_output_tokens: {},
      agent_file_reads: {},
      languages: [],
      git_commits: 0,
      git_pushes: 0,
      input_tokens: 1000,
      output_tokens: 400,
      first_prompt: '',
      user_interruptions: 0,
      user_response_times: [],
      tool_errors: 0,
      tool_error_categories: {},
      uses_task_agent: false,
      uses_mcp: false,
      uses_web_search: false,
      uses_web_fetch: false,
      lines_added: 0,
      lines_removed: 0,
      files_modified: 0,
      message_hours: [],
      user_message_timestamps: [],
      model: 'gpt-4o',
      ...overrides,
    }
  }

  function makeData(sessions: import('@agentistics/core').SessionMeta[]): import('@agentistics/core').AppData {
    return {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-10',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 0,
        totalMessages: 0,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions,
      projects: [],
      allSessions: [],
      harnesses: ['codex'],
    }
  }

  test('codex: hourCounts sums message_hours across sessions', () => {
    const s1 = makeSession({ session_id: 's1', message_hours: [9, 9, 14] })
    const s2 = makeSession({ session_id: 's2', message_hours: [9, 22] })
    const data = makeData([s1, s2])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.hourCounts[9]).toBe(3)  // 9 appears 3 times
    expect(summaries['codex']!.hourCounts[14]).toBe(1)
    expect(summaries['codex']!.hourCounts[22]).toBe(1)
    expect(summaries['codex']!.hourCounts[0]).toBe(0)
  })

  test('codex: peakHour identifies hour with highest count', () => {
    const s1 = makeSession({ session_id: 's1', message_hours: [9, 9, 14] })
    const data = makeData([s1])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakHour).toBe(9)
  })

  test('codex: peakHour is null when no message_hours data', () => {
    const s1 = makeSession({ session_id: 's1', message_hours: [] })
    const data = makeData([s1])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakHour).toBeNull()
  })

  test('codex: hourCounts has exactly 24 entries', () => {
    const s1 = makeSession({ session_id: 's1', message_hours: [0, 23] })
    const data = makeData([s1])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.hourCounts.length).toBe(24)
  })
})

describe('computeHarnessSummaries — dowCounts and peakDow', () => {
  function makeSession(id: string, startTime: string, hours: number[] = []): import('@agentistics/core').SessionMeta {
    return {
      session_id: id,
      harness: 'codex',
      project_path: '/p',
      start_time: startTime,
      duration_minutes: 5,
      user_message_count: 1,
      assistant_message_count: 1,
      tool_counts: {},
      tool_output_tokens: {},
      agent_file_reads: {},
      languages: [],
      git_commits: 0,
      git_pushes: 0,
      input_tokens: 100,
      output_tokens: 50,
      first_prompt: '',
      user_interruptions: 0,
      user_response_times: [],
      tool_errors: 0,
      tool_error_categories: {},
      uses_task_agent: false,
      uses_mcp: false,
      uses_web_search: false,
      uses_web_fetch: false,
      lines_added: 0,
      lines_removed: 0,
      files_modified: 0,
      message_hours: hours,
      user_message_timestamps: [],
      model: 'gpt-4o',
    }
  }

  function makeData(sessions: import('@agentistics/core').SessionMeta[]): import('@agentistics/core').AppData {
    return {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-14',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 0,
        totalMessages: 0,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions,
      projects: [],
      allSessions: [],
      harnesses: ['codex'],
    }
  }

  test('codex: dowCounts maps Monday session to index 1', () => {
    // 2026-06-08 is a Monday (dow=1)
    const s = makeSession('s1', '2026-06-08T09:00:00Z')
    const data = makeData([s])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.dowCounts[1]).toBe(1)   // Monday
    expect(summaries['codex']!.dowCounts[0]).toBe(0)   // Sunday
  })

  test('codex: peakDow identifies day with most sessions', () => {
    // 2026-06-08 = Monday (1), 2026-06-09 = Tuesday (2) x2
    const sessions = [
      makeSession('s1', '2026-06-08T09:00:00Z'),
      makeSession('s2', '2026-06-09T10:00:00Z'),
      makeSession('s3', '2026-06-09T14:00:00Z'),
    ]
    const data = makeData(sessions)
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakDow).toBe(2)   // Tuesday
    expect(summaries['codex']!.dowCounts[2]).toBe(2)
    expect(summaries['codex']!.dowCounts[1]).toBe(1)
  })

  test('codex: dowCounts has exactly 7 entries', () => {
    const s = makeSession('s1', '2026-06-08T09:00:00Z')
    const data = makeData([s])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.dowCounts.length).toBe(7)
  })
})

describe('computeHarnessSummaries — peakTokenDay and peakSessionCost', () => {
  function makeSession(
    id: string,
    startTime: string,
    input: number,
    output: number,
    model = 'gpt-4o',
  ): import('@agentistics/core').SessionMeta {
    return {
      session_id: id,
      harness: 'codex',
      project_path: '/p',
      start_time: startTime,
      duration_minutes: 5,
      user_message_count: 1,
      assistant_message_count: 1,
      tool_counts: {},
      tool_output_tokens: {},
      agent_file_reads: {},
      languages: [],
      git_commits: 0,
      git_pushes: 0,
      input_tokens: input,
      output_tokens: output,
      first_prompt: '',
      user_interruptions: 0,
      user_response_times: [],
      tool_errors: 0,
      tool_error_categories: {},
      uses_task_agent: false,
      uses_mcp: false,
      uses_web_search: false,
      uses_web_fetch: false,
      lines_added: 0,
      lines_removed: 0,
      files_modified: 0,
      message_hours: [],
      user_message_timestamps: [],
      model,
    }
  }

  function makeData(sessions: import('@agentistics/core').SessionMeta[]): import('@agentistics/core').AppData {
    return {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-14',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 0,
        totalMessages: 0,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions,
      projects: [],
      allSessions: [],
      harnesses: ['codex'],
    }
  }

  test('codex: peakTokenDay identifies the day with highest total tokens', () => {
    // 2026-06-10: 1000+400=1400 tokens; 2026-06-11: 500+200=700 tokens
    const sessions = [
      makeSession('s1', '2026-06-10T08:00:00Z', 1000, 400),
      makeSession('s2', '2026-06-11T09:00:00Z', 500, 200),
    ]
    const data = makeData(sessions)
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakTokenDay?.date).toBe('2026-06-10')
    expect(summaries['codex']!.peakTokenDay?.tokens).toBe(1400)
  })

  test('codex: peakTokenDay aggregates multiple sessions on same day', () => {
    // Both sessions on 2026-06-10: 1000+400 + 500+200 = 2100
    const sessions = [
      makeSession('s1', '2026-06-10T08:00:00Z', 1000, 400),
      makeSession('s2', '2026-06-10T14:00:00Z', 500, 200),
    ]
    const data = makeData(sessions)
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakTokenDay?.date).toBe('2026-06-10')
    expect(summaries['codex']!.peakTokenDay?.tokens).toBe(2100)
  })

  test('gemini: peakTokenDay is null (no token capability)', () => {
    const sessions = [
      { ...makeSession('s1', '2026-06-10T08:00:00Z', 0, 0), harness: 'gemini' as const, model: undefined },
    ]
    const data = { ...makeData([]), sessions, harnesses: ['gemini'] as import('@agentistics/core').HarnessId[] }
    const summaries = computeHarnessSummaries(data)
    expect(summaries['gemini']!.peakTokenDay).toBeNull()
  })

  test('codex: peakSessionCost uses calcCost (not inline math)', () => {
    // s1 has more tokens → higher cost
    const sessions = [
      makeSession('s1', '2026-06-10T08:00:00Z', 10_000, 2_000),
      makeSession('s2', '2026-06-11T09:00:00Z', 500, 100),
    ]
    const data = makeData(sessions)
    const summaries = computeHarnessSummaries(data)
    // peakSessionCost should be positive and correspond to s1
    expect(summaries['codex']!.peakSessionCost).toBeGreaterThan(0)
    // s2 cost should be smaller — verify indirectly that peak > s2's cost
    const { calcCost: cc, getModelPrice: gmp } = require('@agentistics/core')
    const s2Cost = cc({ inputTokens: 500, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 }, 'gpt-4o')
    expect(summaries['codex']!.peakSessionCost).toBeGreaterThan(s2Cost)
  })

  test('gemini: peakSessionCost is null (no cost capability)', () => {
    const sessions = [
      { ...makeSession('s1', '2026-06-10T08:00:00Z', 0, 0), harness: 'gemini' as const, model: undefined },
    ]
    const data = { ...makeData([]), sessions, harnesses: ['gemini'] as import('@agentistics/core').HarnessId[] }
    const summaries = computeHarnessSummaries(data)
    expect(summaries['gemini']!.peakSessionCost).toBeNull()
  })

  test('claude: peakSessionCost is always null (statsCache has no per-session breakdown)', () => {
    const data: import('@agentistics/core').AppData = {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-10',
        dailyActivity: [{ date: '2026-06-10', sessionCount: 2, messageCount: 4, toolCallCount: 0 }],
        dailyModelTokens: [],
        modelUsage: { 'claude-sonnet-4-5': { inputTokens: 10000, outputTokens: 2000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 } },
        totalSessions: 2,
        totalMessages: 4,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions: [],
      projects: [],
      allSessions: [],
      harnesses: ['claude'],
    }
    const summaries = computeHarnessSummaries(data)
    expect(summaries['claude']!.peakSessionCost).toBeNull()
  })
})

describe('computeHarnessSummaries — dailyActivity', () => {
  test('codex: dailyActivity groups sessions by day and sorts ascending', () => {
    function s(id: string, day: string): import('@agentistics/core').SessionMeta {
      return {
        session_id: id,
        harness: 'codex',
        project_path: '/p',
        start_time: `${day}T08:00:00Z`,
        duration_minutes: 5,
        user_message_count: 1,
        assistant_message_count: 1,
        tool_counts: {},
        tool_output_tokens: {},
        agent_file_reads: {},
        languages: [],
        git_commits: 0,
        git_pushes: 0,
        input_tokens: 100,
        output_tokens: 50,
        first_prompt: '',
        user_interruptions: 0,
        user_response_times: [],
        tool_errors: 0,
        tool_error_categories: {},
        uses_task_agent: false,
        uses_mcp: false,
        uses_web_search: false,
        uses_web_fetch: false,
        lines_added: 0,
        lines_removed: 0,
        files_modified: 0,
        message_hours: [],
        user_message_timestamps: [],
        model: 'gpt-4o',
      }
    }
    const data: import('@agentistics/core').AppData = {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-12',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 0,
        totalMessages: 0,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions: [
        s('a', '2026-06-12'),
        s('b', '2026-06-10'),
        s('c', '2026-06-10'),  // same day as b
        s('d', '2026-06-11'),
      ],
      projects: [],
      allSessions: [],
      harnesses: ['codex'],
    }
    const summaries = computeHarnessSummaries(data)
    const daily = summaries['codex']!.dailyActivity
    // Should be sorted ascending
    expect(daily[0]!.date).toBe('2026-06-10')
    expect(daily[1]!.date).toBe('2026-06-11')
    expect(daily[2]!.date).toBe('2026-06-12')
    // 2026-06-10 has 2 sessions
    expect(daily[0]!.sessions).toBe(2)
    expect(daily[1]!.sessions).toBe(1)
    expect(daily[2]!.sessions).toBe(1)
  })
})
```

- [ ] **Step 2: Run all tests to verify existing + new tests pass**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex
bun test
```

Expected: all tests pass, zero failures. If any existing test fails, the issue is likely a type mismatch in the `makeAppData` helper — add missing fields (e.g., the new fields return correct defaults for sessions with `message_hours: []`).

- [ ] **Step 3: Commit the test changes**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex
git add packages/web/src/hooks/useData.test.ts
git commit -m "test(web): add focused tests for hour/dow/activity/peak harness fields"
```

---

## Task 3: Render the new comparative sections on ComparePage

**Files:**
- Modify: `packages/web/src/pages/ComparePage.tsx`

**Interfaces:**
- Consumes: `HarnessSummary` (from Task 1) — all new fields available on `summaries[harness]`
- Consumes: `capable(harness, 'tokens')`, `capable(harness, 'cost')` from `'../lib/harness'`
- Consumes: `fmt`, `fmtCost` from `'@agentistics/core'`
- Consumes: `HARNESS_COLORS`, `HARNESS_LABELS` from `'../lib/harness'`

### Four sections to add (below the existing table and session-share card)

1. **"Usage by hour of day"** — 24-bar CSS mini chart per harness, small-multiples layout (one column per harness). Each bar height proportional to that hour's count. Peak hour labeled below.
2. **"Busiest day of week"** — 7-bar CSS mini chart per harness + peak day name.
3. **"Activity over time"** — sparkline (CSS bars by day) per harness showing sessions/day trend.
4. **"Peaks"** — text row: peakTokenDay (date + fmt token count) and peakSessionCost (fmtCost), with NACell for harnesses without these metrics.

### Mini-chart component (inline, no new file)

Define these inside ComparePage.tsx above the `export default` function:

```typescript
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function MiniBarChart({ values, color, peakIndex: peak, height = 40 }: {
  values: number[]
  color: string
  peakIndex: number | null
  height?: number
}) {
  const max = Math.max(...values, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height }}>
      {values.map((v, i) => {
        const pct = Math.round((v / max) * 100)
        const isPeak = i === peak
        return (
          <div
            key={i}
            title={`${v}`}
            style={{
              flex: 1,
              height: `${Math.max(pct, v > 0 ? 4 : 0)}%`,
              background: isPeak ? color : `${color}55`,
              borderRadius: '2px 2px 0 0',
              minWidth: 2,
              transition: 'height 0.3s ease-out',
            }}
          />
        )
      })}
    </div>
  )
}

function SparklineChart({ data, color, height = 32 }: {
  data: { date: string; sessions: number }[]
  color: string
  height?: number
}) {
  if (data.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>No data</span>
    </div>
  }
  const max = Math.max(...data.map(d => d.sessions), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height, overflow: 'hidden' }}>
      {data.map((d, i) => {
        const pct = Math.round((d.sessions / max) * 100)
        return (
          <div
            key={i}
            title={`${d.date}: ${d.sessions} sessions`}
            style={{
              flex: 1,
              height: `${Math.max(pct, d.sessions > 0 ? 4 : 0)}%`,
              background: `${color}99`,
              borderRadius: '1px 1px 0 0',
              minWidth: 1,
            }}
          />
        )
      })}
    </div>
  )
}
```

### Section card layout (shared wrapper)

```typescript
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 22px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
        {title}
      </div>
      {children}
    </div>
  )
}
```

### Per-harness column grid helper

The four sections each render one column per harness side-by-side:

```typescript
function HarnessGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${aggs.length}, 1fr)`,
      gap: 16,
    }}>
      {children}
    </div>
  )
}
```

(This needs to be a closure inside the component or receive `aggs.length` as a prop.)

- [ ] **Step 1: Add the new helper components above the `export default function ComparePage()` line**

Add `MiniBarChart`, `SparklineChart`, `SectionCard` as functions before `export default function ComparePage()`. They use only CSS and React — no recharts imports needed.

Also add `DOW_LABELS` constant there.

Also add `fmtDuration` to the core import if you want to use it for any future enhancement. For now just ensure `fmt` and `fmtCost` are imported (they already are in the existing file).

- [ ] **Step 2: Add `React` import if missing**

Check line 1 of ComparePage.tsx — it imports `React` via `import React, { useMemo, useState } from 'react'`. That's correct. The new JSX uses `React.ReactNode` type — ensure it's in scope (it is via the existing import).

- [ ] **Step 3: Add the four new sections inside the JSX return, after the existing session-share card**

After the closing `</div>` of the session-share card (the one ending around line 363 with `</div>`), add:

```tsx
      {/* Section 1: Usage by hour of day */}
      <SectionCard title="Usage by hour of day">
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${aggs.length}, 1fr)`,
          gap: 16,
        }}>
          {aggs.map(a => {
            const s = summaries[a.harness]
            const totalMsgs = s?.hourCounts.reduce((acc, v) => acc + v, 0) ?? 0
            return (
              <div key={a.harness}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors[a.harness], marginBottom: 8 }}>
                  {HARNESS_LABELS[a.harness]}
                </div>
                {totalMsgs === 0 ? (
                  <div style={{ height: 40, display: 'flex', alignItems: 'center' }}>
                    <NACell />
                  </div>
                ) : (
                  <>
                    <MiniBarChart
                      values={s?.hourCounts ?? Array(24).fill(0)}
                      color={colors[a.harness]}
                      peakIndex={s?.peakHour ?? null}
                      height={40}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>0h</span>
                      <span style={{ fontSize: 10, color: colors[a.harness], fontWeight: 600 }}>
                        {s?.peakHour !== null && s?.peakHour !== undefined
                          ? `Peak ${String(s.peakHour).padStart(2, '0')}:00`
                          : ''}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>23h</span>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Section 2: Busiest day of week */}
      <SectionCard title="Busiest day of week">
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${aggs.length}, 1fr)`,
          gap: 16,
        }}>
          {aggs.map(a => {
            const s = summaries[a.harness]
            const hasData = s && s.dowCounts.some(v => v > 0)
            return (
              <div key={a.harness}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors[a.harness], marginBottom: 8 }}>
                  {HARNESS_LABELS[a.harness]}
                </div>
                {!hasData ? (
                  <div style={{ height: 40, display: 'flex', alignItems: 'center' }}>
                    <NACell />
                  </div>
                ) : (
                  <>
                    <MiniBarChart
                      values={s.dowCounts}
                      color={colors[a.harness]}
                      peakIndex={s.peakDow}
                      height={40}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      {DOW_LABELS.map((label, i) => (
                        <span
                          key={label}
                          style={{
                            fontSize: 9,
                            color: i === s.peakDow ? colors[a.harness] : 'var(--text-tertiary)',
                            fontWeight: i === s.peakDow ? 700 : 400,
                            flex: 1,
                            textAlign: 'center',
                          }}
                        >
                          {label.slice(0, 1)}
                        </span>
                      ))}
                    </div>
                    {s.peakDow !== null && (
                      <div style={{ fontSize: 11, color: colors[a.harness], fontWeight: 600, marginTop: 6 }}>
                        Peak: {DOW_LABELS[s.peakDow]}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Section 3: Activity over time */}
      <SectionCard title="Activity over time">
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${aggs.length}, 1fr)`,
          gap: 16,
        }}>
          {aggs.map(a => {
            const s = summaries[a.harness]
            return (
              <div key={a.harness}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors[a.harness], marginBottom: 8 }}>
                  {HARNESS_LABELS[a.harness]}
                </div>
                <SparklineChart
                  data={s?.dailyActivity ?? []}
                  color={colors[a.harness]}
                  height={40}
                />
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {s && s.dailyActivity.length > 0
                    ? `${s.dailyActivity[0]!.date.slice(0, 10)} – ${s.dailyActivity[s.dailyActivity.length - 1]!.date.slice(0, 10)}`
                    : 'No data'}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Section 4: Peaks (token day + session cost) */}
      <SectionCard title="Peaks">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{
                padding: '0 16px 10px 0',
                textAlign: 'left',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                borderBottom: '1px solid var(--border)',
              }}>
                Metric
              </th>
              {aggs.map(a => (
                <th key={a.harness} style={{
                  padding: '0 16px 10px',
                  textAlign: 'left',
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors[a.harness],
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  borderBottom: `2px solid ${colors[a.harness]}`,
                  whiteSpace: 'nowrap',
                }}>
                  {HARNESS_LABELS[a.harness]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{
                padding: '12px 16px 12px 0',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                borderBottom: '1px solid var(--border)',
              }}>
                Busiest token day
              </td>
              {aggs.map(a => {
                const s = summaries[a.harness]
                const ptd = capable(a.harness, 'tokens') ? s?.peakTokenDay : null
                return (
                  <td key={a.harness} style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    {!capable(a.harness, 'tokens') ? (
                      <NACell />
                    ) : ptd ? (
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(ptd.tokens)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                          {ptd.date}
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td style={{
                padding: '12px 16px 12px 0',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
              }}>
                Peak session cost
              </td>
              {aggs.map(a => {
                const s = summaries[a.harness]
                const psc = capable(a.harness, 'cost') ? s?.peakSessionCost : null
                return (
                  <td key={a.harness} style={{ padding: '12px 16px' }}>
                    {!capable(a.harness, 'cost') ? (
                      <NACell />
                    ) : psc !== null && psc !== undefined ? (
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCost(psc, currency, brlRate)}
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </SectionCard>
```

Note: `SectionCard` receives `currency` and `brlRate` from the parent scope via closure — they're destructured at the top of `ComparePage`. So `fmtCost(psc, currency, brlRate)` works fine.

- [ ] **Step 4: TypeScript check**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex
bun tsc --noEmit
```

Expected: zero errors. Common issues:
- `summaries[a.harness]` may be typed as `HarnessSummary | undefined` — use `s?.hourCounts ?? Array(24).fill(0)` pattern consistently.
- `React.ReactNode` in `SectionCard` props — fine as long as `React` is imported (it is).

- [ ] **Step 5: Run all tests again**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex
bun test
```

Expected: all pass.

- [ ] **Step 6: Build check**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex
bun run build
```

Expected: succeeds with no errors.

- [ ] **Step 7: Commit the UI changes**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex
git add packages/web/src/pages/ComparePage.tsx
git commit -m "feat(web): render usage-peak comparatives on the Compare page"
```

---

## Task 4: Write the SDD report

**Files:**
- Create: `.superpowers/sdd/compare-comparatives-report.md`

- [ ] **Step 1: Create the report directory and file**

```bash
mkdir -p /home/padawan/agentistics/.claude/worktrees/multi-harness-codex/.superpowers/sdd
```

Write `.superpowers/sdd/compare-comparatives-report.md` with:
- New fields added to `HarnessSummary` and how each is sourced (Claude vs non-Claude)
- UI sections added to ComparePage
- `bun tsc --noEmit` output (zero errors)
- `bun test` output (count of passing tests)
- `bun run build` output (success)
- Commit hashes
- Any concerns (e.g., Claude's `peakSessionCost` is always null; Claude's `hourCounts` comes from statsCache which may lag behind live data)

- [ ] **Step 2: Commit the report**

```bash
cd /home/padawan/agentistics/.claude/worktrees/multi-harness-codex
git add .superpowers/sdd/compare-comparatives-report.md
git commit -m "docs: add compare-comparatives implementation report"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `hourCounts: number[]` (length 24) | Task 1 |
| `peakHour: number | null` | Task 1 |
| Claude hourCounts from statsCache.hourCounts | Task 1 Step 5 |
| Non-Claude hourCounts from message_hours | Task 1 Step 6 |
| `dowCounts: number[]` (length 7, 0=Sunday) | Task 1 |
| `peakDow: number | null` | Task 1 |
| Claude dowCounts from statsCache.dailyActivity + getDay | Task 1 Step 5 |
| Non-Claude dowCounts from session start_time + getDay | Task 1 Step 6 |
| `dailyActivity: {date, sessions}[]` sorted asc | Task 1 |
| Claude dailyActivity from statsCache.dailyActivity | Task 1 Step 5 |
| Non-Claude dailyActivity from session grouping | Task 1 Step 6 |
| `peakTokenDay: {date, tokens} | null` | Task 1 |
| Claude peakTokenDay from dailyModelTokens | Task 1 Step 5 |
| Codex peakTokenDay from sessions grouped by day | Task 1 Step 6 |
| No-token harnesses → peakTokenDay null | Task 1 Step 6 (HARNESS_CAPABILITIES.tokens gate) |
| `peakSessionCost: number | null` | Task 1 |
| Claude peakSessionCost null | Task 1 Step 5 |
| Codex peakSessionCost via calcCost per session | Task 1 Step 6 |
| No-cost harnesses → peakSessionCost null | Task 1 Step 6 |
| Function remains pure | Task 1 (no hooks, no side effects) |
| date-fns for date math | Task 1 (getDay added to import) |
| `calcCost` from @agentistics/core (no inline math) | Task 1 Step 6 |
| Tests for new fields | Task 2 |
| Existing tests still pass | Task 2 |
| "Usage by hour of day" section — mini bars per harness | Task 3 |
| Peak hour labeled | Task 3 |
| "Busiest day of week" — 7-bar chart + peak name | Task 3 |
| "Activity over time" — sparkline per harness | Task 3 |
| "Peaks" — peakTokenDay + peakSessionCost | Task 3 |
| NACell for harnesses without tokens/cost | Task 3 |
| `fmt`/`fmtCost` for numbers | Task 3 |
| Consistent CSS variable styling | Task 3 |
| bun tsc passes | Task 3 Step 4 |
| bun test passes | Task 3 Step 5 |
| bun run build passes | Task 3 Step 6 |
| SDD report | Task 4 |

**Placeholder scan:** No "TBD", "TODO", or vague steps found.

**Type consistency:**
- `HarnessSummary.hourCounts: number[]` — used as `s?.hourCounts ?? Array(24).fill(0)` in Task 3 ✓
- `HarnessSummary.peakHour: number | null` — used as `s?.peakHour ?? null` in Task 3 ✓
- `peakIndex(arr)` helper — takes `number[]`, returns `number | null` ✓
- `HARNESS_CAPABILITIES[harness].tokens` / `.cost` — accessed via `capable(harness, 'tokens')` wrapper in Task 3 ✓
- All fields consistent between Task 1 definition and Task 3 usage ✓
