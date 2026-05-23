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

agentistics is a **local analytics dashboard** for Claude Code. It reads the data Claude Code writes to `~/.claude/` and turns it into charts, metrics, and reports — all without sending anything to a server.

**Key capabilities:**

- Tokens, costs, sessions, and streaks across all your projects
- Per-project and per-model breakdowns with live BRL/USD conversion
- Custom layout builder — drag, resize, and arrange any combination of charts
- **Nay** — an AI chat assistant that answers questions about your data using MCP tools
- **MCP server** — exposes your analytics as tools for Claude Code and other agents
- OpenTelemetry export for Grafana, Datadog, and any OTLP-compatible collector
- PDF export, themes, PT/BR + EN languages

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
curl -fsSL https://raw.githubusercontent.com/blpsoares/agentistics/main/install.sh | bash
```

System-wide install:

```bash
sudo curl -fsSL https://raw.githubusercontent.com/blpsoares/agentistics/main/install.sh | bash
```

> If `~/.local/bin` is not in your `$PATH`, the installer will print the command to add it. Binaries are also on the [Releases page](https://github.com/blpsoares/agentistics/releases/latest).

**Start:**

```bash
agentop server        # Dashboard + API + Nay + watcher — everything in one command
```

Open **http://localhost:47291** in your browser.

| Command | What it starts |
|---------|---------------|
| `agentop server` | API + embedded frontend + Nay + OTel daemon |
| `agentop tui` | Terminal dashboard (no browser needed) |
| `agentop watch` | OTel daemon only (headless) |

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

Nay sets up its workspace at `~/.agentistics/nay-chat/` on first server start — a `CLAUDE.md` with strict behavior rules and a `settings.json` that grants access to all 12 agentistics MCP tools without prompting.

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
| `agentistics_summary` | All-time totals: tokens, cost, sessions, streak, cache hit rate |
| `agentistics_projects` | Per-project token and cost breakdown |
| `agentistics_sessions` | Recent sessions with duration, model, cost |
| `agentistics_costs` | Model pricing breakdown and cache savings |
| `agentistics_component_catalog` | Available dashboard components |
| `agentistics_get_layouts` | Current custom page layouts |
| `agentistics_build_layout` | Create a full layout from a component list |
| `agentistics_add_component` | Add one component to an existing layout |
| `agentistics_remove_component` | Remove a component by instance ID |
| `agentistics_create_layout` | Create a new empty layout |
| `agentistics_set_active_layout` | Switch the active /custom layout |
| `agentistics_delete_layout` | Delete a layout permanently |

Once registered, you can use these tools from **any Claude Code session** — not just Nay.

→ **Full documentation:** [docs/mcp.md](docs/mcp.md)

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
