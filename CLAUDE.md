# agentistics — CLAUDE.md

Local analytics dashboard for AI coding assistants. Visualizes tokens, costs, activity, and projects based on data from `~/.claude/`.

## Language convention

**Everything in this project is in English**: code, comments, commit messages, PR titles and descriptions, documentation, and this file.

## Architecture

```
cli.ts  (binary entry point — agentop)
  ├── agentop server  → server.ts + watcher.ts (always together)
  ├── agentop tui     → watch-cli.ts (standalone)
  └── agentop watch   → watcher.ts (daemon only)

server.ts (Bun, port 3001)
  ├── Reads ~/.claude/usage-data/session-meta/ → enriched sessions (preferred source)
  ├── Fallback: parses JSONL from ~/.claude/projects/*/**/*.jsonl
  ├── Serves /api/data, /api/events (SSE), /api/rates
  ├── Serves embedded static assets when SERVE_STATIC=1 (binary mode)
  └── Watched by chokidar for real-time updates

src/ (React + Vite, port 5173 in dev)
  ├── useData.ts → fetches /api/data + SSE subscription
  ├── useDerivedStats() → all filter and aggregation logic
  └── components/ → UI (charts, cards, heatmap, PDF export)

scripts/embed-dist.ts
  └── Reads dist/ after vite build and generates src/embedded-dist.generated.ts
      (assets embedded as strings/base64 for the compiled binary)
```

## Calculation functions — single source of truth

**All layers** use the same functions from `src/lib/types.ts`. Never inline pricing calculations.

### `MODEL_PRICING` — pricing table (USD per 1M tokens)

```
src/lib/types.ts — lines 133–146
```

Update here when Anthropic changes prices or releases new models. Fallback (Sonnet 4.6: $3/$15) is on line 153.

### `getModelPrice(modelId)` — resolves price by model ID

```
src/lib/types.ts — line 148
```

Tries exact match, then partial match via `startsWith` in both directions. Returns Sonnet fallback if no match.

### `calcCost(usage, modelId)` — total cost from a usage record

```
src/lib/types.ts — line 156
```

Takes a `ModelUsage` object (input, output, cacheRead, cacheWrite in tokens) and returns cost in USD.

### `blendedCostPerToken(modelUsage)` — weighted average rate across models

```
src/hooks/useData.ts
```

Used when there is no per-session model ID (project filter active, or per-session cost in PDF export). Weights each model's rate by its token volume in global usage.

### `serveStatic(pathname)` — serves embedded frontend assets

```
server.ts
```

Only active when `SERVE_STATIC=1` (set by `cli.ts` for the `server` subcommand). Reads from `embeddedDist` (generated at compile time). Returns `null` in dev mode.

---

## Where each layer calculates cost

| Layer | What it calculates | How |
|-------|--------------------|-----|
| `useData.ts / useDerivedStats` | Filtered `totalCostUSD` | `calcCost()` per model; `blendedCostPerToken()` when project filter is active |
| `ModelBreakdown.tsx` | Per-model cost in the UI | `calcCost()` |
| `PDFExportModal.tsx` | Per-model cost in PDF | `calcCost()` |
| `PDFExportModal.tsx` | Per-session cost in PDF | `blendedCostPerToken(statsCache.modelUsage)` — sessions have no individual model field |
| `watcher.ts` | Total cost exported via OTel | `calcCost()` imported from `src/lib/types.ts` |
| `watch-cli.ts` | Cost in terminal output | `calcCost()` |
| `server.ts` | — | Does not calculate cost; only fetches/caches the external pricing table (`/api/rates`) |

---

## Data flow

```
~/.claude/
  ├── stats-cache.json          → aggregated data (tokens/day, model, activity)
  ├── usage-data/session-meta/  → enriched sessions (preferred source)
  └── projects/**/*.jsonl       → raw files (fallback when meta is unavailable)
         ↓
    server.ts (aggregates and serves)
         ↓
    /api/data → useData() → useDerivedStats() → React components
```

## Important rules

- **`stats-cache.json`** has no project-level granularity — project filters are computed by summing individual sessions
- **Tokens per model/day**: `dailyModelTokens` only stores totals; input/output split uses global statsCache proportions as an approximation when filtering by date
- **Sessions have no individual model field** — use `blendedCostPerToken` for per-session cost estimates
- **Streak**: counts backwards from today; if today has no activity, starts from yesterday — intentional behavior so users are not penalized for not having worked yet today
- **BRL costs**: conversion via `/api/rates` (fetches live exchange rate); falls back to a fixed rate if the API fails
- **Session sources**: `_source: 'meta'` sessions are the most complete; `'jsonl'` and `'subdir'` are fallbacks with partial data (no git line counts, no cache tokens)
- **Binary mode**: `agentop server` sets `SERVE_STATIC=1`; server.ts serves the embedded frontend on the same port as the API
- **`src/embedded-dist.generated.ts`** is in `.gitignore` — auto-generated, never commit it

## Development

```bash
bun run dev            # API (3001) + UI (5173) in parallel
bun run watch          # OpenTelemetry daemon (optional)
bun run watch:cli      # Terminal TUI
bun test               # Unit tests for pure functions

# Build the binary
bun run build          # Generates dist/ (Vite)
bun run build:assets   # Generates src/embedded-dist.generated.ts
bun run build:binary   # Full pipeline → release/agentop
```

## Tests

Unit tests cover the critical pure functions:

- `src/lib/types.test.ts` → `calcCost()`, `getModelPrice()`
- `src/hooks/useData.test.ts` → `calcStreak()`, `getDateRangeFilter()`

Do not mock the filesystem — the tested functions are pure and have no side effects.
