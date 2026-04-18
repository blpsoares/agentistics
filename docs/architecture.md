# Architecture

## Repository layout

```
agentistics/
├── bin/
│   └── cli.ts                    # Binary entry: agentop server | tui | watch
├── mcp/
│   └── agentistics-mcp.ts        # MCP server (stdio transport, 12 tools)
├── server/
│   ├── index.ts                  # Bun HTTP server — thin entry, delegates to modules
│   ├── config.ts                 # Path constants + PORT (reads .env.config)
│   ├── env-config.ts             # .env.config read/write/backup/restore
│   ├── utils.ts                  # Shared FS helpers (createLimiter, safeRead*)
│   ├── git.ts                    # Git stats via git log --numstat
│   ├── jsonl.ts                  # JSONL session parser
│   ├── health.ts                 # Health checks + warnings
│   ├── rates.ts                  # Pricing scraper + BRL rate cache
│   ├── sse.ts                    # SSE clients, chokidar watcher, serveStatic
│   ├── data.ts                   # Main orchestrator (buildApiResponse)
│   ├── agent-metrics.ts          # Agent tool_use metrics parser
│   ├── chat-tty.ts               # Nay chat: ensureNayChat, streamViaClaude, execCommand
│   └── otel-watcher.ts           # Chokidar + OTLP metrics export daemon
├── src/
│   ├── App.tsx                   # Router, global state, header
│   ├── pages/
│   │   ├── HomePage.tsx          # Main dashboard (KPIs, charts, sessions)
│   │   ├── CustomPage.tsx        # Custom layout builder (/custom)
│   │   ├── CostsPage.tsx         # Cost deep-dive
│   │   ├── ProjectsPage.tsx      # Projects overview
│   │   └── ToolsPage.tsx         # Tool metrics breakdown
│   ├── hooks/
│   │   ├── useData.ts            # Fetches /api/data + SSE + useDerivedStats()
│   │   └── useCustomLayout.ts    # Layout state + persistence to /api/preferences
│   ├── components/               # UI components (charts, cards, modals)
│   │   ├── TtyChat.tsx           # Nay chat panel (FAB + floating panel)
│   │   ├── DevConfigPanel.tsx    # </> dev config modal (PORT, VITE_PORT)
│   │   └── ...
│   ├── lib/
│   │   ├── types.ts              # All shared types + MODEL_PRICING + calcCost()
│   │   ├── app-context.ts        # AppContext interface (React context shape)
│   │   ├── componentCatalog.tsx  # Catalog of custom layout components
│   │   ├── chatModels.ts         # CHAT_MODELS, DEFAULT_CHAT_MODEL
│   │   ├── chatUtils.ts          # formatToolName, fmtTime, extractNavLinks
│   │   ├── format.ts             # fmt(), fmtCost(), fmtDuration()
│   │   ├── i18n.ts               # PT/EN translations
│   │   └── otel.ts               # OpenTelemetry metric definitions
│   └── tui/
│       └── index.ts              # Terminal TUI (standalone, no browser)
├── scripts/
│   └── embed-dist.ts             # Embeds dist/ into src/embedded-dist.generated.ts
├── docs/                         # Extended documentation
├── grafana/                      # Pre-built Grafana dashboard JSON
├── .env.config                   # Committed port defaults (PORT, VITE_PORT)
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Request lifecycle

```
Browser → GET /api/data
  → server/index.ts (Bun.serve)
    → server/data.ts (buildApiResponse)
      ├── server/jsonl.ts      (parse raw JSONL sessions)
      ├── server/agent-metrics.ts (extract agent invocations)
      ├── server/git.ts        (git stats per project)
      └── server/health.ts     (warnings)
    → JSON response

Browser → GET /api/events  (SSE)
  → server/sse.ts (sseClients stream)
    chokidar watches ~/.claude/ → pushes "update" event on change
  → browser calls /api/data again

Browser → POST /api/chat-tty  (Nay)
  → server/chat-tty.ts (streamViaClaude)
    → Bun.spawn(['claude', '--print', '--output-format', 'stream-json'])
      → claude reads NAY_CHAT_DIR/CLAUDE.md + .claude/settings.json
      → MCP tools → GET http://localhost:47291/api/data
    → stream-json chunks → SSE stream → TtyChat.tsx
```

## Binary build pipeline

```
bun run build           →  dist/          (Vite compiles React app)
bun run build:assets    →  src/embedded-dist.generated.ts  (assets as TS strings/base64)
bun build --compile     →  release/agentop  (self-contained binary, ~100 MB)
```

The binary embeds the full Bun runtime + all JS/TS code + frontend assets. No external dependencies needed on the target machine — `agentop server` serves both the API and the frontend on port 47291.

In dev mode, the API runs on port 47291 and Vite serves the frontend with hot reload on port 47292.

## Port configuration

Ports are configured in `.env.config` at the repository root:

```ini
PORT=47291      # API server + embedded frontend (binary mode)
VITE_PORT=47292 # Vite dev server (dev mode only)
```

These values are loaded at server startup before `process.env` fallbacks. Edit via the `</>` button in the header or directly in the file (restart required).

## Calculation functions — single source of truth

| Function | Location | Used by |
|----------|----------|---------|
| `MODEL_PRICING` | `src/lib/types.ts:183` | All layers |
| `getModelPrice(modelId)` | `src/lib/types.ts:198` | All layers |
| `calcCost(usage, modelId)` | `src/lib/types.ts:206` | All layers |
| `blendedCostPerToken(modelUsage)` | `src/hooks/useData.ts` | Project/model filter views, PDF export |

Never inline pricing calculations. Always import from `src/lib/types.ts`.

## Tech stack

### Frontend

| Library | Version | Usage |
|---------|---------|-------|
| React | 19.2 | UI |
| Vite | 8.0 | Build tool + dev server |
| TypeScript | 5 | Strict typing (`noUncheckedIndexedAccess`) |
| Recharts | 3.8 | Area charts, bar charts |
| react-markdown | 10.x | Markdown rendering in Nay chat |
| lucide-react | 1.7 | SVG icons |
| date-fns | 4.1 | Date manipulation |
| html2canvas + jspdf | 1.4 / 4.2 | PDF export |

### Backend

| Technology | Usage |
|-----------|-------|
| Bun | HTTP server, subprocess spawning, file I/O |
| chokidar | File watching for live updates and OTel daemon |
| @modelcontextprotocol/sdk | MCP server implementation |
| @opentelemetry/* | Metrics export (optional) |

## Key design decisions

**No database** — all data is read directly from Claude Code's local files. This means zero setup, zero schema migrations, and the data is always as fresh as the last session.

**Single API endpoint** — `/api/data` returns everything in one call. The frontend derives all views from this response using `useDerivedStats()`. This makes filtering, aggregation, and computed stats purely client-side.

**`stats-cache.json` for aggregates, JSONL for details** — the stats cache is fast (pre-computed by Claude Code) but has no project granularity. Project breakdowns are computed by agentistics from session records.

**Nay runs as a subprocess** — `claude --print` is spawned by the server, not called via API. This means Nay inherits the full Claude Code CLI environment (MCP registrations, permissions, CLAUDE.md files) without any extra integration work.

**Binary embeds the frontend** — `agentop server` serves both API and UI from a single process on a single port. No Nginx, no static file server needed.
