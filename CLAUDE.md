# agentistics — CLAUDE.md

Local analytics dashboard for AI coding assistants. Visualizes tokens, costs, activity, projects, and agent metrics based on data from `~/.claude/`.

## Language convention

**Everything in this project is in English**: code, comments, commit messages, PR titles and descriptions, documentation, and this file.

## Monorepo structure

```
packages/
  core/     (@agentistics/core)   — shared types, pricing, formatters, i18n, otel helpers
  server/   (@agentistics/server) — Bun HTTP server, CLI (agentop), otel-watcher, scripts
  web/      (@agentistics/web)    — React + Vite frontend
  mcp/      (@agentistics/mcp)    — MCP server, publishable to npm standalone
  desktop/                        — Tauri v2 Windows installer (spawns agentop as sidecar)
```

## Architecture

```
packages/server/bin/cli.ts  (binary entry point — agentop)
  ├── agentop server  → server/index.ts + server/otel-watcher.ts (always together)
  ├── agentop tui     → ../../web/src/tui/index.ts (standalone)
  └── agentop watch   → server/otel-watcher.ts (daemon only)

packages/server/server/index.ts (Bun, port 47291) — thin entry point
  └── delegates to server/ modules (see below)

packages/server/server/          — server-side modules (never bundled by Vite)
  ├── config.ts            → path constants + PORT env var
  ├── utils.ts             → createLimiter, safeReadJson, safeReadDir, safeStat
  ├── git.ts               → decodeProjectDir, getGitFileStats, getProjectGitStats
  ├── jsonl.ts             → parseSessionJsonl, makeEmptySession, classifyAgentFile, EXT_TO_LANG
  ├── health.ts            → runHealthChecks, analyzeToolHealthIssues
  ├── rates.ts             → pricing scraper + BRL rate cache
  ├── sse.ts               → SSE clients, chokidar watcher, serveStatic, maybeSpawnWatcher
  ├── data.ts              → loadSessionMetas, scanProjects, buildApiResponse (main orchestrator)
  ├── agent-metrics.ts     → extractAgentMetrics (parses Agent tool_use from JSONL)
  └── otel-watcher.ts      → chokidar file watcher + OTLP metrics export daemon

packages/web/src/ (React + Vite, port 47292 in dev)
  ├── lib/
  │   ├── app-context.ts        → AppContext interface (React context type shared by all pages)
  │   ├── componentCatalog.tsx  → catalog of all components available in the custom layout builder
  │   └── chatModels.ts         → web-only model list
  ├── hooks/
  │   ├── useData.ts            → fetches /api/data + SSE subscription + useDerivedStats()
  │   └── useCustomLayout.ts    → custom layout state: named layouts, pinned projects, persistence
  ├── pages/
  │   ├── HomePage.tsx          → main dashboard (KPIs, charts, sessions)
  │   ├── CustomPage.tsx        → custom layout builder (/custom route)
  │   ├── CostsPage.tsx         → cost deep-dive page
  │   ├── ProjectsPage.tsx      → projects overview page
  │   └── ToolsPage.tsx         → tools breakdown page
  ├── tui/
  │   └── index.ts              → terminal TUI (live stats in the terminal, no browser needed)
  └── components/               → UI (charts, cards, heatmap, modals, PDF export)

packages/core/src/              — shared across server + web + mcp (import as @agentistics/core)
  ├── types.ts              → all shared types + pricing functions (single source of truth)
  ├── format.ts             → shared display helpers: fmt(), fmtCost(), fmtDuration()
  ├── i18n.ts               → PT/EN translations
  ├── otel.ts               → OpenTelemetry helpers
  ├── chatUtils.ts          → TOOL_LABELS, formatToolName, etc.
  └── index.ts              → barrel re-export of everything above

packages/server/scripts/embed-dist.ts
  └── Reads packages/web/dist/ after vite build and generates
      packages/server/server/embedded-dist.generated.ts
      (assets embedded as strings/base64 for the compiled binary)
```

## Calculation functions — single source of truth

**All layers** use the same functions from `packages/core/src/types.ts` via `@agentistics/core`. Never inline pricing calculations.

### `MODEL_PRICING` — pricing table (USD per 1M tokens)

```
packages/core/src/types.ts
```

Update here when Anthropic changes prices or releases new models. Fallback (Sonnet 4.6: $3/$15) is the return value of `getModelPrice` when no match is found.

### `getModelPrice(modelId)` — resolves price by model ID

```
packages/core/src/types.ts
```

Tries exact match, then partial match via `startsWith` in both directions. Returns Sonnet 4.6 fallback if no match.

### `calcCost(usage, modelId)` — total cost from a usage record

```
packages/core/src/types.ts
```

Takes a `ModelUsage` object (input, output, cacheRead, cacheWrite in tokens) and returns cost in USD.

### `blendedCostPerToken(modelUsage)` — weighted average rate across models

```
packages/web/src/hooks/useData.ts
```

Used when there is no per-session model ID (project filter active, or per-session cost in PDF export). Weights each model's rate by its token volume in global usage.

### `serveStatic(pathname)` — serves embedded frontend assets

```
packages/server/server/sse.ts
```

Only active when `SERVE_STATIC=1` (set by `cli.ts` for the `server` subcommand). Reads from `embeddedDist` (generated at compile time). Returns `null` in dev mode.

---

## Where each layer calculates cost

| Layer | What it calculates | How |
|-------|--------------------|-----|
| `useData.ts / useDerivedStats` | Filtered `totalCostUSD` | `calcCost()` per model; `blendedCostPerToken()` when project or model filter is active and per-session breakdown is needed |
| `ModelBreakdown.tsx` | Per-model cost in the UI | `calcCost()` |
| `PDFExportModal.tsx` | Per-model cost in PDF | `calcCost()` |
| `PDFExportModal.tsx` | Per-session cost in PDF | `blendedCostPerToken(statsCache.modelUsage)` — sessions have no individual model field |
| `otel-watcher.ts` | Total cost exported via OTel | `calcCost()` from `@agentistics/core` |
| `tui/index.ts` | Cost in terminal output | `calcCost()` from `@agentistics/core` |
| `server/agent-metrics.ts` | Per-agent-invocation cost | `calcCost()` with per-invocation token breakdown |
| `server/rates.ts` | — | Does not calculate cost; only fetches/caches the external pricing table (`/api/rates`) |

---

## Agent metrics

Agent metrics are extracted from raw JSONL files by `server/agent-metrics.ts`. They are available in the `agentMetrics` field of each `SessionMeta`.

### Data available per Agent invocation

| Field | Source |
|---|---|
| `agentType` | `toolUseResult.agentType` in the JSONL message envelope |
| `description` | `tool_use.input.description` |
| `totalTokens` | `toolUseResult.totalTokens` |
| `totalDurationMs` | `toolUseResult.totalDurationMs` |
| `totalToolUseCount` | `toolUseResult.totalToolUseCount` |
| `inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens` | `toolUseResult.usage.*` |
| `toolStats` (reads, searches, bash, edits, lines changed) | `toolUseResult.toolStats` |
| `costUSD` | Calculated via `calcCost()` |
| `status` | `toolUseResult.status` (`completed` / `failed`) |

### What is NOT available for Skills and Tasks

- **Skills** (`/commit`, `/review-pr`, etc.) are not recorded as individual tool_use events in the JSONL — only a `skill_listing` attachment appears. Skill invocations can only be inferred indirectly from subsequent tool calls.
- **Tasks** (`TaskCreate`/`TaskUpdate`) have subject/description/status but no token or duration data.

---

## Data flow

```
~/.claude/
  ├── stats-cache.json          → aggregated data (tokens/day, model, activity)
  ├── usage-data/session-meta/  → enriched sessions (preferred source)
  └── projects/**/*.jsonl       → raw files (fallback + agent metrics source)
         ↓
    packages/server/server/data.ts (buildApiResponse — main orchestrator)
    packages/server/server/agent-metrics.ts (extractAgentMetrics — parses Agent tool_use from JSONL)
         ↓
    /api/data → useData() → useDerivedStats() → React components
```

## Important rules

- **`stats-cache.json`** has no project-level granularity — project filters are computed by summing individual sessions
- **Tokens per model/day**: `dailyModelTokens` only stores totals; input/output split uses global statsCache proportions as an approximation when filtering by date
- **Sessions have an optional `model` field** — extracted from the JSONL file by `server/data.ts` when not already present in session-meta. Use `blendedCostPerToken` as fallback when `model` is unknown (e.g. per-session cost column in PDF export)
- **Agent metrics** are only available for sessions whose JSONL files are accessible; `_source: 'meta'`-only sessions won't have them
- **Streak**: counts backwards from today; if today has no activity, starts from yesterday — intentional behavior so users are not penalized for not having worked yet today
- **BRL costs**: conversion via `/api/rates` (fetches live exchange rate); falls back to a fixed rate if the API fails
- **Session sources**: `_source: 'meta'` sessions are the most complete; `'jsonl'` and `'subdir'` are fallbacks with partial data (no git line counts, no cache tokens)
- **Binary mode**: `agentop server` sets `SERVE_STATIC=1`; server.ts serves the embedded frontend on the same port as the API
- **`packages/server/server/embedded-dist.generated.ts`** is in `.gitignore` — auto-generated, never commit it
- **`packages/server/` modules** are server-only — never import them from `packages/web/src/` (Vite would try to bundle them and fail on Node/Bun APIs)
- **`@agentistics/core`** is the shared package — import types, pricing, and formatters from there; never duplicate them inline
- **Custom layout persistence**: `useCustomLayout` saves `{ layouts, activeLayout, pinnedProjects }` to `/api/preferences`. Layouts open **locked** by default; edit mode requires clicking "Edit". When all layouts are deleted, `active` is `''` (empty string) — CustomPage shows an empty state in this case
- **`componentCatalog.tsx`** is the single source of truth for what can be placed on the custom page — every component has a `render(ctx: AppContext)` function; to add a new component, add it there
- **`app-context.ts`** defines `AppContext` — the shape of the outlet context passed from `App.tsx` to all pages via `useOutletContext<AppContext>()`. Add new global state here when it must be accessible from any page or from custom layout components
- **`format.ts`** contains shared display helpers (`fmt`, `fmtCost`, `fmtDuration`, `fmtFull`) — never duplicate these inline

## Development

```bash
bun run dev            # API (47291) + UI (47292) in parallel
bun run watch          # OpenTelemetry daemon (optional)
bun run watch:cli      # Terminal TUI
bun test               # Unit tests for pure functions

# Build the binary
bun run build          # Generates packages/web/dist/ (Vite)
bun run build:assets   # Generates packages/server/server/embedded-dist.generated.ts
bun run build:binary   # Full pipeline → release/agentop
```

## Tests

Unit tests cover the critical pure functions:

- `packages/core/src/types.test.ts` → `calcCost()`, `getModelPrice()`
- `packages/core/src/chatUtils.test.ts` → tool label helpers
- `packages/web/src/hooks/useData.test.ts` → `calcStreak()`, `getDateRangeFilter()`
- `packages/server/server/chat-tty.test.ts` → chat TTY parsing

Do not mock the filesystem — the tested functions are pure and have no side effects.

## Git hooks (husky)

- **pre-commit**: `bun tsc --noEmit` + `bun test`
- **commit-msg**: commitlint enforces Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
