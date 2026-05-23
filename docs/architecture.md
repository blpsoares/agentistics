# Architecture

## Monorepo layout

```
agentistics/
├── packages/
│   ├── core/                         # @agentistics/core — shared, publishable
│   │   └── src/
│   │       ├── types.ts              # All shared types + MODEL_PRICING + calcCost()
│   │       ├── format.ts             # fmt(), fmtCost(), fmtDuration(), fmtFull()
│   │       ├── chatUtils.ts          # formatToolName, TOOL_LABELS, extractNavLinks
│   │       ├── i18n.ts               # PT/EN translations, t()
│   │       ├── otel.ts               # OpenTelemetry metric definitions
│   │       └── index.ts              # Barrel re-export
│   │
│   ├── server/                       # @agentistics/server — CLI + HTTP server
│   │   ├── bin/
│   │   │   └── cli.ts                # Binary entry: agentop server | tui | watch
│   │   ├── server/
│   │   │   ├── index.ts              # Bun HTTP server — thin entry, delegates to modules
│   │   │   ├── config.ts             # Path constants + PORT (reads .env.config)
│   │   │   ├── env-config.ts         # .env.config read/write/backup/restore
│   │   │   ├── utils.ts              # Shared FS helpers (createLimiter, safeRead*)
│   │   │   ├── git.ts                # Git stats via git log --numstat; workspace fallback scans subdirectories
│   │   │   ├── jsonl.ts              # JSONL session parser
│   │   │   ├── health.ts             # Health checks + warnings
│   │   │   ├── rates.ts              # Pricing scraper + BRL rate cache
│   │   │   ├── sse.ts                # SSE clients, chokidar watcher, serveStatic
│   │   │   ├── data.ts               # Main orchestrator (buildApiResponse)
│   │   │   ├── agent-metrics.ts      # Agent tool_use metrics parser
│   │   │   ├── chat-tty.ts           # Nay chat: ensureNayChat, streamViaClaude
│   │   │   └── otel-watcher.ts       # Chokidar + OTLP metrics export daemon
│   │   └── scripts/
│   │       ├── embed-dist.ts         # Embeds packages/web/dist/ → embedded-dist.generated.ts
│   │       └── ensure-type-stub.ts   # Creates type stub for CI (before full build)
│   │
│   ├── web/                          # @agentistics/web — React + Vite frontend
│   │   ├── src/
│   │   │   ├── App.tsx               # Router, global state, header
│   │   │   ├── pages/
│   │   │   │   ├── HomePage.tsx      # Main dashboard (KPIs, charts, sessions)
│   │   │   │   ├── CustomPage.tsx    # Custom layout builder (/custom)
│   │   │   │   ├── CostsPage.tsx     # Cost deep-dive
│   │   │   │   ├── ProjectsPage.tsx  # Projects overview
│   │   │   │   └── ToolsPage.tsx     # Tool metrics breakdown
│   │   │   ├── hooks/
│   │   │   │   ├── useData.ts        # Fetches /api/data + SSE + useDerivedStats()
│   │   │   │   └── useCustomLayout.ts # Layout state + persistence
│   │   │   ├── components/           # UI components (charts, cards, modals)
│   │   │   │   ├── TtyChat.tsx       # Nay chat panel (FAB + floating panel)
│   │   │   │   ├── PreferencesModal.tsx # Unified Settings modal (Preferences/Live/Install/Environment tabs)
│   │   │   │   └── ...
│   │   │   ├── lib/
│   │   │   │   ├── app-context.ts    # AppContext interface (React context shape)
│   │   │   │   ├── componentCatalog.tsx # Catalog of custom layout components
│   │   │   │   ├── chatModels.ts     # CHAT_MODELS, DEFAULT_CHAT_MODEL
│   │   │   │   └── chatSounds.ts     # CHAT_SOUNDS — 5 Web Audio API notification sounds
│   │   │   └── tui/
│   │   │       └── index.ts          # Terminal TUI (standalone, no browser)
│   │   ├── public/
│   │   │   ├── icons/                # PWA icons (icon-192.png, icon-512.png)
│   │   │   └── ...                   # logo, favicon, etc.
│   │   ├── index.html
│   │   └── vite.config.ts            # Vite config with vite-plugin-pwa (devOptions.enabled: true)
│   │
│   ├── mcp/                          # @agentistics/mcp — MCP server, publishable to npm
│   │   └── agentistics-mcp.ts        # stdio transport, 12 tools, imports @agentistics/core
│   │
│   └── desktop/                      # Tauri v2 Windows installer
│       ├── src/main.rs               # Spawns agentop.exe sidecar, polls health, onboarding
│       ├── ui/index.html             # Loading screen + first-run onboarding UI
│       ├── capabilities/default.json # Tauri v2 permission declarations
│       ├── tauri.conf.json           # Window config, CSP, sidecar declaration
│       └── Cargo.toml
│
├── docs/                             # Extended documentation
├── grafana/                          # Pre-built Grafana dashboard JSON
├── .env.config                       # Committed port defaults (PORT, VITE_PORT)
├── package.json                      # Root: workspaces + orchestration scripts
└── tsconfig.json                     # Root: paths alias for @agentistics/core
```

## Request lifecycle

```
Browser → GET /api/data
  → packages/server/server/index.ts (Bun.serve)
    → server/data.ts (buildApiResponse)
      ├── server/jsonl.ts       (parse raw JSONL sessions)
      ├── server/agent-metrics.ts (extract agent invocations)
      ├── server/git.ts         (git stats per project)
      └── server/health.ts      (warnings)
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
bun run build           →  packages/web/dist/                              (Vite)
bun run build:assets    →  packages/server/server/embedded-dist.generated.ts
bun build --compile     →  release/agentop                                 (self-contained binary)
```

The binary embeds the full Bun runtime + all JS/TS code + frontend assets. No external dependencies needed — `agentop server` serves both API and frontend on port 47291.

In dev mode, the API runs on port 47291 and Vite serves the frontend with hot reload on port 47292.

## Windows desktop app

The Tauri app (`packages/desktop/`) is a native Windows wrapper:

1. On launch, reads config from `%APPDATA%\Agentistics\config.json`
2. If not configured: shows onboarding screen — auto-detects `%USERPROFILE%\.claude` and WSL paths via `\\wsl.localhost\{distro}\home\*\.claude`
3. Once configured: spawns `agentop.exe` as a sidecar with `CLAUDE_DIR` env var
4. Polls `http://localhost:47291/api/health` every 250ms (up to 30s), then navigates the WebView to the dashboard
5. On window close: kills the sidecar process

CI builds the installer on `windows-latest` after the Linux runner cross-compiles `agentop.exe`.

## Port configuration

Ports are configured in `.env.config` at the repository root:

```ini
PORT=47291      # API server + embedded frontend (binary mode)
VITE_PORT=47292 # Vite dev server (dev mode only)
```

Edit via the `</>` button in the header or directly in the file (restart required).

## Calculation functions — single source of truth

All layers import from `@agentistics/core` (`packages/core/src/types.ts`). Never inline pricing calculations.

| Function | Usage |
|----------|-------|
| `MODEL_PRICING` | Pricing table, USD per 1M tokens |
| `getModelPrice(modelId)` | Resolves price by model ID (exact then partial match) |
| `calcCost(usage, modelId)` | Total cost from a `ModelUsage` record |
| `blendedCostPerToken(modelUsage)` | Weighted average rate — used in `useData.ts` for filtered views and PDF export |

## Tech stack

### Frontend (`packages/web/`)

| Library | Version | Usage |
|---------|---------|-------|
| React | 19.2 | UI |
| Vite | 8.0 | Build tool + dev server |
| TypeScript | 5 | Strict typing |
| Recharts | 3.8 | Area charts, bar charts |
| react-markdown | 10.x | Markdown rendering in Nay chat |
| lucide-react | 1.7 | SVG icons |
| date-fns | 4.1 | Date manipulation |
| html2canvas + jspdf | 1.4 / 4.2 | PDF export |

### Backend (`packages/server/`)

| Technology | Usage |
|-----------|-------|
| Bun | HTTP server, subprocess spawning, file I/O |
| chokidar | File watching for live updates and OTel daemon |
| @modelcontextprotocol/sdk | MCP server implementation |
| @opentelemetry/* | Metrics export (optional) |

### Desktop (`packages/desktop/`)

| Technology | Usage |
|-----------|-------|
| Tauri v2 | Native window + WebView wrapper |
| Rust | Sidecar spawn, health polling, config management |
| tauri-plugin-shell | Sidecar process lifecycle |
| reqwest | HTTP health check in Rust async |

## Key design decisions

**No database** — all data read directly from Claude Code's local files. Zero setup, zero schema migrations, always fresh.

**Single API endpoint** — `/api/data` returns everything in one call. The frontend derives all views from this response using `useDerivedStats()`. Filtering is purely client-side.

**`stats-cache.json` for aggregates, JSONL for details** — the stats cache is fast (pre-computed by Claude Code) but has no project granularity. Project breakdowns are computed from individual session records.

**Nay runs as a subprocess** — `claude --print` is spawned by the server, not called via API. Nay inherits the full Claude Code CLI environment without extra integration work.

**Binary embeds the frontend** — `agentop server` serves both API and UI from a single process on a single port. No Nginx needed.

**`@agentistics/core` as shared package** — types, pricing functions, and formatters live in one place. Server, web, and MCP all import from `@agentistics/core`. Nothing is duplicated.

**PWA installable** — `vite-plugin-pwa` makes the web app installable as a PWA (enabled even in dev mode via `devOptions: { enabled: true }`). API calls are always `NetworkOnly`; static assets are cached. Icons live at `packages/web/public/icons/`.

**Unified Settings modal** — `PreferencesModal.tsx` replaced 3 separate modals with a single tabbed interface: Preferences (lang/theme/currency/sounds), Live (update interval), Install (web PWA + desktop download), and Environment (port config).

**`files_modified` takes max of two sources** — `server/jsonl.ts` tracks unique file paths from Edit/Write/MultiEdit tool calls, then takes `Math.max(gitFileStats.filesModified, claudeFilesModified.size)`. The FILES KPI in `useData.ts` prefers the session-level count and only falls back to project-level git stats if sessions show 0.

**`getProjectGitStats` handles workspace folders** — if a project path is not itself a git repo, `server/git.ts` scans one level of subdirectories and aggregates stats from all git repos found there. This covers workspace folders like `~/zuke` that contain multiple repos.
