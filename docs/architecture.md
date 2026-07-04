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
│   │   │   └── cli.ts                # Binary entry: agentop setup|server|tui|watch|central|member|autostart|upgrade|check-update
│   │   ├── server/
│   │   │   ├── index.ts              # Bun HTTP server — thin entry, delegates to modules
│   │   │   ├── config.ts             # Path constants + PORT + team env vars (TEAM_*, CENTRAL_USER)
│   │   │   ├── env-config.ts         # .env.config read/write/backup/restore
│   │   │   ├── utils.ts              # Shared FS helpers (createLimiter, safeRead*)
│   │   │   ├── git.ts                # Git stats via git log --numstat; workspace fallback scans subdirectories
│   │   │   ├── jsonl.ts              # JSONL session parser
│   │   │   ├── health.ts             # Health checks + warnings
│   │   │   ├── rates.ts              # Pricing scraper + BRL rate cache
│   │   │   ├── sse.ts                # SSE clients, chokidar watcher, serveStatic, broadcastNotification, triggerSseNotification
│   │   │   ├── data.ts               # Main orchestrator (buildApiResponse)
│   │   │   ├── agent-metrics.ts      # Agent tool_use metrics parser
│   │   │   ├── chat-tty.ts           # Nay chat: ensureNayChat, streamViaClaude
│   │   │   ├── otel-watcher.ts       # Chokidar + OTLP metrics export daemon
│   │   │   ├── preferences.ts        # ~/.agentistics preferences incl. team config (mode/endpoint/token/user)
│   │   │   ├── version.ts            # getVersionInfo() — current vs latest, drives update banners/notifications
│   │   │   ├── autostart.ts          # systemd user service + loginctl linger + ~/.bashrc update-check hook
│   │   │   ├── cli-setup.ts          # `agentop setup` wizard (solo/central/member + autostart offer)
│   │   │   ├── cli-central.ts        # `agentop central …` — thin wrapper over central.sh
│   │   │   ├── cli-member.ts         # `agentop member connect|leave|status` (whoami-verified, no browser)
│   │   │   └── (team mode, see below)
│   │   │       ├── team-tokens.ts        # mint / rotate / revoke / validate tokens (sha256 hashes only)
│   │   │       ├── team-store.ts         # Mongo team-session doc shape (org:memberId:harness:sessionId)
│   │   │       ├── team-stats.ts         # per-member statsCache store (exact Claude totals)
│   │   │       ├── team-ingest.ts        # POST /api/team/ingest → upsert + SSE-on-ingest (real-time central)
│   │   │       ├── team-source.ts        # central-side read of team sessions for buildApiResponse
│   │   │       ├── team-admin.ts         # members-panel admin routes (list/rename/rotate/revoke/policy)
│   │   │       ├── team-uploader.ts      # member→central push: sent-state, sync-signature reconcile, push-on-change, auto-reset on revoke
│   │   │       ├── team-watch.ts         # central: watch the team collection → SSE refresh
│   │   │       ├── team-agent.ts         # central WebSocket registry: presence signals, ping/pong latency, on-demand chat fetch
│   │   │       ├── team-agent-client.ts  # member side of the reverse-channel WebSocket
│   │   │       ├── team-presence.ts      # computePresence() — WS-authoritative online/offline + latency
│   │   │       └── central-config.ts     # Mongo central config: instanceId, pushIntervalSec, includeOfflineData
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
│   │   │   │   ├── PreferencesModal.tsx # Unified Settings modal (Preferences/Live/Install tabs)
│   │   │   │   ├── TeamLogin.tsx     # Central dashboard password login
│   │   │   │   ├── TeamMembers.tsx   # Members panel: mint/rotate/revoke/rename + presence column
│   │   │   │   ├── TeamSettings.tsx  # Central Settings → Team (interval/express, offline-data policy)
│   │   │   │   ├── DeployCentral.tsx # In-app central deploy/help panel
│   │   │   │   ├── PresenceFilter.tsx        # Central filter: online/offline members
│   │   │   │   ├── MemberConnectionStatus.tsx # Member-side connected/reconnecting pill
│   │   │   │   ├── NotificationToasts.tsx    # Auto-dismiss animated toasts
│   │   │   │   ├── NotificationBell.tsx      # Header bell: history + unread badge
│   │   │   │   ├── UpdateModal.tsx   # Mode-aware upgrade instructions modal
│   │   │   │   └── ...
│   │   │   ├── lib/
│   │   │   │   ├── app-context.ts    # AppContext interface (React context shape)
│   │   │   │   ├── componentCatalog.tsx # Catalog of custom layout components
│   │   │   │   ├── chatModels.ts     # CHAT_MODELS, DEFAULT_CHAT_MODEL
│   │   │   │   ├── chatSounds.ts     # CHAT_SOUNDS — 5 Web Audio API notification sounds
│   │   │   │   └── notifications.ts  # Notification store + render-time pt/en i18n (NOTIFICATION_TEXT by code)
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
├── central.sh                        # Team central lifecycle (docker compose): up/init/down/logs/status/restart/pull
├── docker-compose.yml                # Central service (app + Mongo, Mongo NOT published to the host)
├── central.env                       # Generated by `central.sh init` (gitignored — secrets, chmod 600)
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

## Team Mode

Team Mode lets one machine ("central") aggregate coding-assistant usage metrics from many machines ("members"). Members push **computed metrics only** — session/agent/token/cost aggregates plus their statsCache — **never chat transcripts** (raw chat is fetched on demand over a reverse WebSocket, not stored centrally). Data lives in Mongo, which is **not published to the host** (reachable only inside the compose network).

### Roles

Every machine picks one role, persisted at `preferences.team.mode`:

- **solo** — local only, nothing leaves the machine (the default).
- **central** — the aggregator. Runs as a Docker service via `central.sh` (default port `48080`, distinct from a solo/dev server's `47291`). Serves the team dashboard behind a password.
- **member** — pushes its computed metrics to a central's `/api/team/ingest`.

### central.sh + `agentop central`

`central.sh` (repo root) wraps `docker compose` with the project name and env file pre-set; `agentop central <up|init|down|logs|status|restart|pull>` shells out to it (`server/cli-central.ts`, stdio inherited so interactive prompts and log streaming work). Key subcommands:

- **`init`** — interactive: prompts each value, auto-generates the secrets with `openssl`, detects the Tailscale IP as a suggestion, writes `central.env` (`chmod 600`).
- **`up`** — ensures `central.env` exists (offers `init`), then builds and `--force-recreate`s the containers.
- **`down`** — stops the containers but **keeps the data volume** (only `down -v` wipes it, which mints a new `instanceId` — see reconciliation below).

`central.env` variables: `APP_PORT` (default `48080`), `BIND_IP` (default `0.0.0.0`; set to a Tailscale IP to restrict exposure to a private tailnet without a public listener), `AGENTISTICS_TEAM_PASSWORD` (dashboard login), `AGENTISTICS_TEAM_SESSION_SECRET` (HMAC cookie key — kept **separate** from the password), `AGENTISTICS_TEAM_ORG`, `AGENTISTICS_TEAM_INGEST_TOKEN` (optional shared secret), `AGENTISTICS_CENTRAL_USER` (set when the central also contributes its own machine's data).

### Member identity

A member does **not** name itself — the display name is set by the central when it mints the token, and the member resolves it via `GET /api/team/whoami` (`server/cli-member.ts`, `memberConnect`). Sessions are keyed centrally by a stable `memberId` (the token's sha256 hash), so renaming a member keeps history. `agentop member connect` never writes a half-config: it only persists `preferences.team` after whoami accepts the token.

### Push model — central-owned interval + push-on-change

The **central owns the cadence** (`server/central-config.ts`, `pushIntervalSec`; normal floor 15s, default 30s, express down to 5s via `EXPRESS_MIN_SEC`). Members fetch it from `GET /api/team/policy` each cycle and can only follow it — there is no member-side override that goes faster. On top of the periodic timer, `server/team-uploader.ts` also does **push-on-change**: the file watcher calls `notifyDataChanged()`, which schedules a debounced push (coalesces bursts, never sooner than the central's interval since the last success). Members push their **supplemented** statsCache (the one the local dashboard shows, gap-filled past the stale `lastComputedDate`), not the raw `~/.claude/stats-cache.json`, so central totals match the member's own dashboard exactly.

### Real-time central

A member push lands in `server/team-ingest.ts`, which upserts the sessions/stats and then calls `triggerSseNotification()` — the central's dashboards refresh live over SSE without polling. This is why the "Live" toggle is **hidden on a central**. `server/team-watch.ts` also watches the team collection as a fallback SSE source.

### Presence — WebSocket-authoritative

Presence is computed by `server/team-presence.ts` from the reverse-channel WebSocket registry in `server/team-agent.ts`:

- A member is **online** while its WebSocket is live (source of truth). Killing the app drops the socket → **offline within ~8s** (`SOCKET_GRACE_MS`, absorbs brief reconnects).
- Once a member has *ever* held a socket this run, the socket signal is trusted; a **heartbeat window** (`server/team-presence.ts`) is only the fallback for pure-HTTP members that never opened a socket.
- **Latency** comes from WebSocket ping/pong RTT (`PING_INTERVAL_MS`; a socket missing `MAX_MISSED_PONGS` pings is force-closed so a hard-killed machine still flips offline).
- The central admin gets a "machine connected" notification (throttled per member).

The members panel (`TeamMembers.tsx`, central Settings → Team) can **mint**, **rotate** (new credential that migrates the member's sessions+stats to the new identity, preserving history), **revoke** (confirmation modal; cascade-deletes that member's data), and **rename**. There is a per-central "show offline members' data" policy (`includeOfflineData`) and filters for members / harnesses / projects / presence.

### Auto-reconciliation (self-healing sync)

`server/team-uploader.ts` fingerprints the push target as `sha256(endpoint \0 token \0 instanceId)` and stores it in the sync file. When the fingerprint changes — the central DB was wiped (`down -v` → new `instanceId`), the token was revoked and re-added, or the endpoint changed — the member clears its sent-state and **re-pushes its full history** on the next cycle (idempotent upserts, so no double-counting). No manual `team-sent.json` deletion. A persistent 401/403 (revoked token) trips `handleAuthError` after a couple of cycles: the member **auto-resets to solo** and emits a "removed from central" notification. A `null` instanceId (old/unreachable central) never triggers a spurious reset.

### Notifications

`packages/web/src/lib/notifications.ts` is a small external store rendered by `NotificationToasts.tsx` (auto-dismiss, animated) and `NotificationBell.tsx` (history + unread badge). Notifications carry a `code` (+ `meta`) and are localized **at render time** (`NOTIFICATION_TEXT`, pt/en) so they follow the language toggle. The server emits them via `broadcastNotification()` (SSE). Fired on member auth/connection errors, "removed from central", "machine connected", and "update available".

## CLI (`agentop`)

`packages/server/bin/cli.ts` is the single command surface for the compiled binary:

| Command | What it does |
|---------|--------------|
| `setup` | Interactive first-run wizard — pick solo / central / member, then optionally enable autostart (`server/cli-setup.ts`). Bare `agentop` on a TTY when the machine is unconfigured launches this. |
| `server` | Dashboard + background daemon (`SERVE_STATIC=1`; API + embedded frontend + otel-watcher on one port). |
| `tui` | Standalone terminal dashboard. |
| `watch` | OTel metrics daemon only. |
| `central <up\|init\|down\|logs\|status\|restart\|pull>` | Wraps `central.sh` (`server/cli-central.ts`). |
| `member <connect\|leave\|status>` | Configure this machine as a member (`server/cli-member.ts`). `connect --endpoint <url> --token <tok> [--org <o>]` verifies via whoami before saving. |
| `autostart <server\|central\|watch> <enable\|disable\|status>` | Register a mode to start with the system (`server/autostart.ts`). Linux/WSL: a systemd **user** service + `loginctl enable-linger`, and installs a `~/.bashrc` hook running `agentop check-update` on terminal open. macOS/Windows print a manual step. `autostart status` (no mode) lists all. |
| `upgrade` | Self-update to the latest version. |
| `check-update` | Prints the "update available" banner only when outdated; silent when current (this is what the `.bashrc` hook runs). |

**Update detection** is everywhere: on any command run (banner via `checkVersionAndWarn`), on boot/terminal (the `.bashrc` hook), and on the dashboard (bell notification + a **mode-aware** `UpdateModal.tsx` with the exact upgrade+restart command — central: `bun run up:central`; member: `agentop upgrade` then `systemctl --user restart agentop-server`). A periodic (~6h) server re-check pushes the update notification over SSE. All version logic lives in `server/version.ts`.

## Binary build pipeline

```
bun run build           →  packages/web/dist/                              (Vite)
bun run build:assets    →  packages/server/server/embedded-dist.generated.ts
bun build --compile     →  release/agentop                                 (self-contained binary)
```

The binary embeds the full Bun runtime + all JS/TS code + frontend assets. No external dependencies needed — `agentop server` binds two ports with one shared request handler: the **web dashboard on 47292** (the URL you open) and the **api + mcp on 47291**. Because both ports run the same handler, the dashboard served from 47292 makes same-origin `/api/*` calls that resolve locally.

In dev mode, the API runs on port 47291 and Vite serves the frontend with hot reload on port 47292 — the same web-on-92 / api-on-91 split.

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
PORT=47291      # api + mcp (binary mode also binds PORT+1 = 47292 for the web dashboard)
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

**Unified Settings modal** — `PreferencesModal.tsx` replaced separate modals with a single tabbed interface: Preferences (lang/theme/currency/sounds), Live (update interval), and Install (web PWA + desktop download). The old Environment (port config) tab was removed.

**Team Mode ships no per-machine secrets to the wire** — members push computed metrics only, never chat; tokens are stored **only as sha256 hashes** (`server/team-tokens.ts`) and never logged; the central's session cookie secret is kept separate from the dashboard password; auth comparisons are constant-time; Mongo is not published to the host; and `BIND_IP` can pin the listener to a private tailnet (Tailscale encrypts the transport, so plain http inside it is fine). See the "Team Mode" section above.

**`files_modified` takes max of two sources** — `server/jsonl.ts` tracks unique file paths from Edit/Write/MultiEdit tool calls, then takes `Math.max(gitFileStats.filesModified, claudeFilesModified.size)`. The FILES KPI in `useData.ts` prefers the session-level count and only falls back to project-level git stats if sessions show 0.

**`getProjectGitStats` handles workspace folders** — if a project path is not itself a git repo, `server/git.ts` scans one level of subdirectories and aggregates stats from all git repos found there. This covers workspace folders like `~/zuke` that contain multiple repos.
