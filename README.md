<p align="center">
  <img src="packages/web/public/logo.png" alt="agentistics" width="180" />
</p>

<h1 align="center">agentistics</h1>

<p align="center">
  <strong>Track · Analyze · Improve</strong><br/>
  Local analytics dashboard for AI coding assistants
</p>

<p align="center">
  <a href="https://github.com/blpsoares/agentistics/releases/latest">
    <img src="https://img.shields.io/github/v/release/blpsoares/agentistics?label=release&color=f97316" alt="Latest release" />
  </a>
  <a href="https://github.com/blpsoares/agentistics/actions/workflows/release.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/blpsoares/agentistics/release.yml?label=build" alt="Build status" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/blpsoares/agentistics?color=green" alt="MIT License" />
  </a>
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey" alt="Platform: Linux | Windows" />
  <img src="https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun" alt="Bun" />
</p>

<p align="center">
  <a href="#install"><strong>Install in one line →</strong></a>
  &nbsp;·&nbsp;
  <a href="docs/nay.md"><strong>Nay AI Chat →</strong></a>
  &nbsp;·&nbsp;
  <a href="docs/mcp.md"><strong>MCP Server →</strong></a>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/e3f5cf44-f745-4540-9f5d-99192c755263" width="100%" controls></video>
</p>

---

## What is agentistics?

agentistics is a **local analytics dashboard** for AI coding assistants. It reads the data your harnesses write locally and turns it into charts, metrics, and reports — all without sending anything to a server.

**Multi-harness:** beyond Claude Code (`~/.claude/`), it also tracks **Codex CLI**, **Gemini CLI**, and **GitHub Copilot CLI**. A harness selector lets you view any one harness, a unified "All" view, or a side-by-side `/compare` page. Metrics a given harness can't produce render as "N/A" instead of a misleading 0.

**Key capabilities:**

- Tokens, costs, sessions, and streaks across all your projects — for every harness
- Per-harness, per-project, and per-model breakdowns with live BRL/USD conversion
- Side-by-side harness comparison (`/compare`) and per-harness dashboards (`/h/:harness`)
- Custom layout builder — drag, resize, and arrange any combination of charts
- **Nay** — an AI chat assistant that answers questions about your data using MCP tools
- **MCP server** — exposes your analytics as tools for Claude Code and other agents
- OpenTelemetry export for Grafana, Datadog, and any OTLP-compatible collector
- PDF export, themes, PT/BR + EN languages
- Fully responsive — installable as a PWA (web, mobile-friendly) or native Windows desktop app (Tauri)

---

## Install

<a name="install"></a>

### Option 1 — Windows installer

Download the latest `.msi` or `.exe` (NSIS) from the [Releases page](https://github.com/blpsoares/agentistics/releases/latest).

- Double-click to install — no terminal required
- On first launch, agentistics detects your Claude Code data path automatically (Windows native or WSL)
- The dashboard opens at **http://localhost:47291** inside a native window

> **SmartScreen warning?** Click "More info → Run anyway". The binary is not code-signed yet.

---

### Option 2 — Pre-built binary (Linux / WSL)

```bash
curl -fsSL https://agentop.openvibes.tech/cli | bash
```

System-wide install:

```bash
sudo curl -fsSL https://agentop.openvibes.tech/cli | bash
```

> If `~/.local/bin` is not in your `$PATH`, the installer will print the command to add it. Binaries are also on the [Releases page](https://github.com/blpsoares/agentistics/releases/latest).

**Start:**

```bash
agentop server        # Dashboard + API + Nay + watcher — everything in one command
```

Open **http://localhost:47291** in your browser.

| Command | What it starts |
|---------|---------------|
| `agentop setup` | Interactive first-run wizard (solo / central / member) |
| `agentop server` | API + embedded frontend + Nay + OTel daemon |
| `agentop tui` | Terminal dashboard (no browser needed) |
| `agentop watch` | OTel daemon only (headless) |
| `agentop central …` | Manage the Team Mode central (Docker) |
| `agentop member …` | Join / leave / inspect a Team Mode central |
| `agentop autostart …` | Start a mode with the system (systemd user service) |
| `agentop upgrade` | Upgrade `agentop` to the latest release |

> Full command reference: [docs/cli.md](docs/cli.md).

---

### Option 3 — From source (any OS with Bun)

**Requires:** [Bun](https://bun.sh)

```bash
git clone https://github.com/blpsoares/agentistics.git
cd agentistics
bun install
bun run dev           # API (47291) + UI dev server (47292) in parallel
```

Open **http://localhost:47292** for the UI with hot reload, or **http://localhost:47291** for the API directly.

| Script | What it does |
|--------|-------------|
| `bun run dev` | API + Vite dev server in parallel |
| `bun run watch` | OTel daemon only |
| `bun run watch:cli` | Terminal TUI |
| `bun test` | Unit tests |
| `bun run build:binary` | Full build → `release/agentop` |

---

## Nay — AI chat assistant

Nay is a floating chat panel (bottom-right corner) that connects to your usage data via MCP tools. Ask it anything about your spend, projects, or sessions — it calls the relevant tools and gives you a direct, data-backed answer.

```
"Qual projeto gastou mais tokens este mês?"
"Build me a cost overview layout with KPI cards"
"What's my cache hit rate?"
```

> **Uses your Claude subscription quota.** Every Nay message runs `claude --print` under the hood, which counts against your Claude Max / Pro session limit (or API credits if you use an API key). Prefer **Haiku 4.5** for quick data lookups to minimize cost.

Nay sets up its workspace at `~/.agentistics/nay-chat/` on first server start — a `CLAUDE.md` with strict behavior rules and a `settings.json` that grants access to all 13 agentistics MCP tools without prompting.

→ **Full documentation:** [docs/nay.md](docs/nay.md)

---

## MCP server

The agentistics MCP server exposes your analytics as structured tools. It runs as a stdio process alongside the dashboard and is registered automatically at user scope (`~/.claude.json`) on first start — no configuration needed.

```bash
claude mcp list   # verify: should show "agentistics"
```

**Available tools:**

| Tool | What it returns |
|------|----------------|
| `agentistics_summary` | All-time totals: tokens, cost, sessions, streak — unified or per-harness |
| `agentistics_harnesses` | Side-by-side comparison of every tracked harness |
| `agentistics_projects` | Per-project token and cost breakdown (optionally per-harness) |
| `agentistics_sessions` | Recent sessions with harness, duration, model, cost |
| `agentistics_costs` | Model pricing breakdown and cache savings (optionally per-harness) |
| `agentistics_component_catalog` | Available dashboard components |
| `agentistics_get_layouts` | Current custom page layouts |
| `agentistics_build_layout` | Create a full layout from a component list |
| `agentistics_add_component` | Add one component to an existing layout |
| `agentistics_remove_component` | Remove a component by instance ID |
| `agentistics_create_layout` | Create a new empty layout |
| `agentistics_set_active_layout` | Switch the active /custom layout |
| `agentistics_delete_layout` | Delete a layout permanently |
| `agentistics_export_pdf` | Generate a PDF report download link for a date range |

Once registered, you can use these tools from **any Claude Code session** — not just Nay.

→ **Full documentation:** [docs/mcp.md](docs/mcp.md)

---

## Team Mode

Run agentistics for a whole team. A **central** aggregates coding-assistant usage
metrics from many machines (**members**); each member pushes only **computed
metrics** — never chat content or raw transcripts. Every machine has a role:

- **solo** — local only, nothing leaves the machine (the default)
- **central** — the aggregator, runs as a Docker service on port **48080**
- **member** — pushes its metrics to a central

The central dashboard adds a **Team Manager** (Settings → Team) to mint / rotate /
revoke / rename member tokens, live **presence** (WebSocket-authoritative
online/offline + latency), and filters by member, harness, project, and presence.
Members self-heal: if the central is wiped, the token is rotated, or the endpoint
changes, a member detects it and re-pushes its full history automatically — no
manual reset. A revoked machine resets itself back to solo.

**Quickstart — host a central** (from an agentistics checkout):

```bash
agentop central init    # generate central.env (interactive, openssl secrets)
agentop central up      # build + start the Docker stack → http://localhost:48080
# or, without the CLI: bun run up:central
```

**Quickstart — join as a member:**

```bash
agentop member connect --endpoint http://<central-host>:48080 --token <token>
agentop member status   # verify mode / endpoint / last sync
```

Or just run `agentop setup` and pick a role — the wizard wires up the rest.

> **Security:** tokens are stored only as sha256 hashes, the session secret is
> kept separate from the dashboard password, Mongo is never published to the host,
> and `BIND_IP` can restrict the central to a private tailnet (e.g. Tailscale).

→ **CLI reference:** [docs/cli.md](docs/cli.md) · **Deployment:** [docs/DEPLOY.md](docs/DEPLOY.md)

---

## CLI — `agentop`

`agentop` is the single binary behind everything: the dashboard, the terminal TUI,
the OTel daemon, Team Mode, autostart, and updates.

```bash
agentop setup                                              # first-run wizard
agentop server --port 4000                                 # dashboard on a custom port
agentop central up                                         # host a Team Mode central
agentop autostart server enable                            # start the dashboard at boot
```

| Command | Purpose |
|---------|---------|
| `setup` | Interactive first-run wizard (solo / central / member) |
| `server` | Dashboard + api + Nay + OTel daemon (port 47291) |
| `tui` | Live terminal dashboard |
| `watch` | OTel metrics daemon only |
| `central` | Manage the Team Mode central (Docker) |
| `member` | Join / leave / inspect a central |
| `autostart` | Start a mode with the system (systemd user service) |
| `upgrade` · `check-update` | Update `agentop` / print an update notice |

→ **Full reference:** [docs/cli.md](docs/cli.md)

---

## Dashboard features

### Pages

| Page | Route | Description |
|------|-------|-------------|
| Home | `/` | KPIs, charts, sessions, heatmap, highlights |
| Costs | `/costs` | Cost deep-dive by model and date |
| Projects | `/projects` | Per-project breakdown and comparison |
| Tools | `/tools` | Tool call ranking and token attribution |
| Custom | `/custom` | Drag-and-drop layout builder |

### Filters

- **Period:** 7d · 30d · 90d · All · Custom date range
- **Projects:** multi-select with search
- **Models:** multi-select with per-project availability

All filters apply globally and can be set by Nay when you click a navigation button in a response.

### Statistics cards

Messages · Sessions · Tools · Input tokens · Output tokens · Estimated cost · Streak · Longest session · Commits · Modified files — all drag-and-drop sortable, each with an ℹ explanation modal.

### Charts

- **Activity over time** — area chart with messages / sessions / tools / overlay
- **Activity heatmap** — GitHub-style 26-week grid
- **Hourly usage** — bar chart grouped by time of day (night / morning / afternoon / evening)
- **Model breakdown** — token and cost breakdown per model
- **Budget & forecast** — monthly budget with end-of-month projection
- **Cache efficiency** — hit rate, gross savings, write overhead, net savings
- **Top projects** — 12 most active projects, clickable to apply filter
- **Tool metrics** — ranked by calls or token spend, with villain detection

### Custom layout builder

Build fully custom analytics pages by placing and resizing any combination of components on a 12-column grid. Supports multiple named layouts, pinned project filters per layout, undo/redo (40 steps), export/import as JSON, and random layout generation.

### Live updates

SSE-powered live updates with configurable intervals (10s → 1s risky mode). Update highlights flash changed sections in orange.

### PDF export

Export any combination of sections as a PDF report. Configurable period, filters, and theme (light/dark).

---

## Dev config

The `</>` button in the header opens a panel to edit port settings. Changes are written to `.env.config` at the repository root and take effect after a server restart.

```ini
# .env.config (committed defaults)
PORT=47291       # API server + embedded frontend
VITE_PORT=47292  # Vite dev server (dev mode only)
```

---

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/cli.md](docs/cli.md) | `agentop` CLI — every command, flags, examples, autostart, updates |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Team Mode central — Docker deployment, `central.sh`, env vars |
| [docs/nay.md](docs/nay.md) | Nay AI chat — how it works, quota warning, behavior rules |
| [docs/mcp.md](docs/mcp.md) | MCP server — tool reference, parameters, usage from Claude Code |
| [docs/data-sources.md](docs/data-sources.md) | Data sources, JSONL parsing, SessionMeta structure |
| [docs/metrics.md](docs/metrics.md) | Pricing table, cost formula, blended rate, streak, cache |
| [docs/opentelemetry.md](docs/opentelemetry.md) | OTel export, metrics list, Grafana example |
| [docs/architecture.md](docs/architecture.md) | File structure, request lifecycle, tech stack, build pipeline |

---

## Changelog

See [releases](https://github.com/blpsoares/agentistics/releases) for the full version history.

---

## Star History

<p align="center">
  <a href="https://star-history.com/#blpsoares/agentistics&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=blpsoares/agentistics&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=blpsoares/agentistics&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=blpsoares/agentistics&type=Date" />
    </picture>
  </a>
</p>

---

<p align="center">
  Made with ♥ for the vibe coding community
</p>
