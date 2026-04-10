<p align="center">
  <img src="public/logoDoc.png" alt="agentistics" width="180" />
</p>

<h1 align="center">agentistics</h1>

<p align="center">
  <strong>Track · Analyze · Improve</strong><br/>
  Local analytics dashboard for AI coding assistants
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646cff?logo=vite" alt="Vite" />
</p>

---

## Table of Contents

- [Install](#install)
- [CLI Reference](#cli-reference)
- [Run from source](#run-from-source)
- [Data Sources](#data-sources)
- [Calculations and Metrics](#calculations-and-metrics)
- [Available Filters](#available-filters)
- [Charts and Visualizations](#charts-and-visualizations)
- [Statistics Cards](#statistics-cards)
- [PDF Export](#pdf-export)
- [Themes and Languages](#themes-and-languages)
- [Architecture and Tech Stack](#architecture-and-tech-stack)
- [Advanced Configuration](#advanced-configuration)
- [OpenTelemetry + Daemon Mode](#opentelemetry--daemon-mode)

---

## Install

One-line install (Linux x86_64):

```bash
curl -fsSL https://raw.githubusercontent.com/blpsoares/agentistics/main/install.sh | bash
```

With `sudo` for a system-wide install (`/usr/local/bin`):

```bash
sudo curl -fsSL https://raw.githubusercontent.com/blpsoares/agentistics/main/install.sh | bash
```

The script downloads the latest pre-built binary from [GitHub Releases](https://github.com/blpsoares/agentistics/releases/latest) and places it in `~/.local/bin` (or `/usr/local/bin` when run as root).

> **PATH note:** If `~/.local/bin` is not in your `$PATH`, the installer will print the command to add it.

---

## CLI Reference

```bash
agentop server          # Web dashboard (API + frontend) + background daemon
agentop server --port 4000   # Custom port (default: 3001)
agentop tui             # Live terminal dashboard (standalone)
agentop watch           # Background OTel metrics daemon only
agentop --help
```

| Command | What starts |
|---------|------------|
| `agentop server` | API server + embedded frontend + watcher daemon (always together) |
| `agentop tui` | Terminal UI — can run independently |
| `agentop watch` | OTel daemon only — for headless/background metric export |

After `agentop server`, open **http://localhost:3001** in your browser.

---

## Run from source

**Prerequisite:** [Bun](https://bun.sh) installed.

```bash
git clone https://github.com/blpsoares/agentistics.git
cd agentistics
bun install
bun run dev        # API (port 3001) + UI dev server (port 5173) in parallel
```

| Service | Address |
|---------|---------|
| API (Bun) | `http://localhost:3001` |
| UI (Vite) | `http://localhost:5173` |

Other scripts:

```bash
bun run watch          # OTel daemon (standalone)
bun run watch:cli      # Terminal TUI (standalone)
bun test               # Unit tests

# Build the binary
bun run build:binary   # vite build → embed assets → compile → release/agentop
bun run build:assets   # Embed dist/ assets only (requires bun run build first)
```

To run unit tests:

```bash
bun test
```

---

## Data Sources

The server (`server.ts`) reads the following paths:

| Source | Path | Description |
|--------|------|-------------|
| **Stats Cache** | `~/.claude/stats-cache.json` | Pre-computed aggregates (daily activity, tokens per model, streak) |
| **Session Meta** | `~/.claude/usage-data/session-meta/*.json` | Detailed per-session metadata (tokens, tools, git, projects) |
| **Raw JSONL** | `~/.claude/projects/**/*.jsonl` | Raw conversation logs, fallback when session-meta is unavailable |
| **Local Git** | `git log --numstat` | Commits, modified files, and changed lines within the session window |

### JSONL Parsing Pipeline

When session-meta is not available, each `.jsonl` file is parsed line by line:

```
.jsonl file
  ├── Extracts start_time and duration (timestamps of 1st and last message)
  ├── Counts user messages (excluding tool_result)
  ├── Counts assistant messages (type: 'assistant')
  ├── Maps tool_use → tool_counts { Bash: N, Read: N, Edit: N, ... }
  ├── Attributes output tokens per tool (tool_output_tokens)
  ├── Detects agent instruction file reads (CLAUDE.md, AGENTS.md, etc.)
  ├── Extracts tokens from usage field (input, output, cacheRead, cacheWrite)
  ├── Detects commits: regex /^git commit\b/ in Bash inputs
  ├── Detects pushes: regex /^git push\b/ in Bash inputs
  ├── Detects languages by file extension (Read, Edit, Write)
  ├── Counts tool errors (tool_result.is_error = true)
  ├── Captures first prompt (first 200 chars)
  ├── Records message hours (array 0–23)
  └── Returns SessionMeta object
```

### SessionMeta Structure

```typescript
interface SessionMeta {
  session_id: string              // Session UUID
  project_path: string            // Project directory
  start_time: string              // ISO 8601
  duration_minutes: number        // Total duration
  user_message_count: number      // Actual user messages
  assistant_message_count: number // Model responses
  tool_counts: Record<string, number>  // e.g.: { Bash: 12, Read: 8 }
  tool_output_tokens: Record<string, number>  // Output tokens per tool
  agent_file_reads: Record<string, number>    // Agent instruction file reads
  languages: string[]             // Detected languages
  git_commits: number             // Commits via AI assistant
  git_pushes: number              // Pushes via AI assistant
  input_tokens: number            // Tokens sent to the model
  output_tokens: number           // Tokens generated
  lines_added: number             // Lines added (git)
  lines_removed: number           // Lines removed (git)
  files_modified: number          // Unique files modified
  message_hours: number[]         // Message turn hours (0–23)
  first_prompt: string            // First 200 chars of the prompt
  tool_errors: number             // Total tool errors
  uses_task_agent: boolean        // Used Task/Agent sub-agent
  uses_mcp: boolean               // Used MCP tools
  _source: 'meta' | 'jsonl' | 'subdir'  // Data source
}
```

---

## Calculations and Metrics

### Pricing per Model

All prices are per **1 million tokens (1M)**:

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| Claude Opus 4.6 / 4.5 | $5.00 | $25.00 | $0.50 | $6.25 |
| Claude Opus 4.1 / 4.0 | $15.00 | $75.00 | $1.50 | $18.75 |
| Claude Sonnet 4.6 / 4.5 / 4.0 | $3.00 | $15.00 | $0.30 | $3.75 |
| Claude Haiku 4.5 | $0.80 | $4.00 | $0.08 | $1.00 |
| Claude Haiku 3.5 / 3.0 | $0.25 | $1.25 | $0.03 | $0.30 |

### Cost Formula

```
Total Cost = Σ per model [
  (inputTokens    / 1,000,000 × input_price)      +
  (outputTokens   / 1,000,000 × output_price)     +
  (cacheReadTokens/ 1,000,000 × cache_read_price) +
  (cacheWriteTokens/1,000,000 × cache_write_price)
]
```

### Blended Rate

Individual sessions do not store which model was used — that data is only available in aggregate via `statsCache.modelUsage`. When a per-session cost estimate is needed (project filter active, or per-session cost column in PDF export), a weighted average rate is applied:

```
avg_input_rate  = Σ(model_input_tokens  × model_price) / Σ input_tokens
avg_output_rate = Σ(model_output_tokens × model_price) / Σ output_tokens
... (same for cache)

Estimated Session Cost = session_tokens × avg_rate
```

### Token Types

| Type | Description | Relative Cost |
|------|-------------|---------------|
| **Input** | Context + prompt sent to the model | Base |
| **Output** | Tokens generated by the model | ~5× more expensive than input |
| **Cache Read** | Read from prompt cache | ~10× cheaper than input |
| **Cache Write** | Creating/updating the prompt cache | ~1.25× more expensive than input |

### Streak (Consecutive Days)

The streak is calculated globally (ignoring date/project filters). If today has no activity yet, the count starts from yesterday — so users are not penalized for not having worked yet today:

```
streak = 0
for i = 0 to 365:
    date = today - i days
    if date has activity:
        streak++
    else if i > 0:   // today without activity does not break the streak
        break
```

### Session Duration

```
duration_minutes = (last_message_timestamp - first_message_timestamp) / 60
```

### Git Commits

Detected by analyzing Bash tool inputs at parse time:

```
/^git commit\b/  → gitCommits++
/^git push\b/    → gitPushes++
```

Lines and modified files are retrieved via:
```bash
git -C <project_path> log --numstat --after="<start>" --before="<end>"
```

---

## Available Filters

### Period

| Option | Behavior |
|--------|----------|
| **7d** | Last 7 days |
| **30d** | Last 30 days |
| **90d** | Last 90 days |
| **All** | Full history |
| **Custom Date** | From/To range with calendar (DD/MM/YY) |

### Projects

- Multi-select modal with search by name
- Select/clear all at once
- Badge showing number of active projects
- When project filter is active → uses blended rate and session-meta

### Model

- Dropdown with all models detected in history
- Single selection: "All" or a specific model

### Reset

- Button appears automatically when any filter is active
- Resets: period → All, dates → empty, projects → none, model → all

---

## Charts and Visualizations

### Activity Over Time

Area chart (Recharts) with the following metrics:

- **Messages** — total messages (user + assistant)
- **Sessions** — session count
- **Tools** — total tool calls
- **Overlay** — all three metrics normalized (0–100%) overlaid

Features: interactive tooltip, axis/legend toggling, automatic scaling.

### Activity Heatmap

GitHub-style grid with 26 weeks (configurable):

- Cells colored by message intensity
- Columns = weeks, rows = days of the week
- Tooltip shows: date, messages, sessions, tool calls
- Legend: Less → More

### Hourly Usage

Horizontal bar chart with 24 hours grouped by period:

| Period | Hours | Color |
|--------|-------|-------|
| Night | 00h–05h | Purple |
| Morning | 06h–11h | Yellow |
| Afternoon | 12h–17h | Orange |
| Evening | 18h–23h | Blue |

Visual highlight on peak hour. Toggle between 12h/24h format.

### Model Breakdown

Cards per model with:
- Tokens: Input / Output / Cache Read / Cache Write
- Progress bar (% of total)
- Estimated cost per model
- Footer with total cost when multiple models are present

### Top Projects

2-column grid with the 12 most active projects:
- Progress bar relative to the project with most sessions
- Clickable → automatically applies project filter
- Displays sessions + messages per project

### Recent Sessions

Paginated table with:

**Columns:** Project · Date · Duration · Messages · Tokens · Tools · Commits · Files

**Sorting:** Date, Tokens, Messages, Tools, Files

**Inline filters:**
- Minimum tokens
- Minimum messages
- Text search in the first prompt

**Source indicator:**
- 🟠 Orange = session-meta (complete data)
- 🔵 Blue = direct JSONL
- 🟣 Purple = subdirectory

### Highlights

6 record cards for the period:
1. Longest session (minutes)
2. Most input tokens
3. Most output tokens
4. Most messages
5. Most tool calls
6. Most active project

Each card displays: date, project, duration, and an "Nx the average" multiplier when the record is ≥1.5× the average.

---

## Statistics Cards

All cards are **drag-and-drop** and the order is saved in `localStorage`. Each one has an `ℹ` button that opens a modal explaining the source, formula, and notes.

| Card | Metric | Notes |
|------|--------|-------|
| **Messages** | Total user + assistant | Displays average per session |
| **Sessions** | Session count | Displays average messages/session |
| **Tools** | Total tool calls | Displays most used tool |
| **Input Tokens** | Tokens sent to the model | With cache breakdown |
| **Output Tokens** | Tokens generated | |
| **Estimated Cost** | USD/BRL (toggle) | Uses official Anthropic prices |
| **Streak** | Consecutive days with activity | Calculated globally, ignores filters |
| **Longest Session** | Duration in minutes | With message count |
| **Commits** | Commits + pushes via AI | Detected in Bash inputs |
| **Modified Files** | Unique files + lines +/- | Via git --numstat |

---

## Deep Tool Metrics

The **Tool Metrics** panel provides a detailed analysis of each tool's usage:

### Ranking by Calls or Tokens

Two views available via toggle:

- **By calls** — ranks tools by number of invocations
- **By token spend** — ranks tools by total output tokens attributed to each tool

Token attribution works as follows:
```
For each assistant message with N tool_use blocks:
  tokens_per_tool = output_tokens ÷ N
  Accumulates in tool_output_tokens[tool] += tokens_per_tool
```

Tools consuming more than 40% of the total are highlighted in red as token "villains".

### Agent Instruction File Reads

Detects and counts reads of agent instruction/configuration files:

| Detected Pattern | Category |
|------------------|----------|
| `CLAUDE.md` | CLAUDE.md |
| `AGENTS.md` | AGENTS.md |
| `.cursorrules`, `.cursorignore` | .cursorrules |
| `.claude/*` (any file) | .claude/* |
| `copilot-instructions.md` | copilot-instructions |
| `CONVENTIONS.md` | CONVENTIONS.md |
| `.windsurfrules` | .windsurfrules |

---

## PDF Export

The export modal allows configuring a complete report:

**Selectable sections:**
- Summary (statistics cards)
- Activity over time
- Heatmap
- Hourly usage
- Model breakdown
- Top projects
- Tools
- Recent sessions
- Highlights / Records

**Options:**
- Period independent of active filters (7d / 30d / 90d / All)
- PDF theme: Light or Dark
- Live preview of selections

**Technology:** `html2canvas` captures each section as an image + `jspdf` assembles the final PDF.

---

## Themes and Languages

### Themes

Implemented via CSS custom properties:

```css
:root { /* Dark theme (default) */ }
[data-theme="light"] { /* Light theme */ }
```

### Languages

Support for **Portuguese (pt-BR)** and **English**:

- All strings translated in `src/lib/i18n.ts`
- PT/EN toggle in the header
- Selecting PT → default currency changes to BRL
- Selecting EN → currency changes to USD (if it was BRL)

### Currencies

- **USD** — US dollar
- **BRL** — Brazilian real (uses live exchange rate from public API)

---

## Architecture and Tech Stack

```
agentistics/
├── cli.ts                       # Binary entry point: server | tui | watch
├── server.ts                    # Bun API: JSONL parsing, git stats, static serving
├── watcher.ts                   # Daemon: chokidar + OTLP metrics export
├── watch-cli.ts                 # Terminal TUI: live stats in the terminal
├── scripts/
│   └── embed-dist.ts            # Bundles dist/ assets into src/embedded-dist.generated.ts
├── src/
│   ├── embedded-dist.generated.ts  # Auto-generated (gitignored) — frontend assets for binary
│   ├── App.tsx
│   ├── components/
│   │   ├── ActivityChart.tsx
│   │   ├── ActivityHeatmap.tsx
│   │   ├── DatePicker.tsx
│   │   ├── FiltersBar.tsx
│   │   ├── HealthWarnings.tsx
│   │   ├── HighlightsBoard.tsx
│   │   ├── HourChart.tsx
│   │   ├── InfoModal.tsx
│   │   ├── ModelBreakdown.tsx
│   │   ├── PDFExportModal.tsx
│   │   ├── ProjectsList.tsx
│   │   ├── ProjectsModal.tsx
│   │   ├── RecentSessions.tsx
│   │   ├── StatCard.tsx
│   │   └── ToolMetricsPanel.tsx
│   └── lib/
│       ├── types.ts             # TypeScript types + MODEL_PRICING + calcCost()
│       ├── otel.ts              # OpenTelemetry metric definitions
│       └── i18n.ts              # PT/EN translations
├── package.json
├── tsconfig.json
├── vite.config.ts
└── install.sh                   # One-line installer
```

### Binary build pipeline

```
bun run build          →  dist/          (Vite — frontend assets)
bun run build:assets   →  src/embedded-dist.generated.ts  (assets as TS module)
bun build --compile    →  release/agentop  (self-contained binary, ~100 MB)
```

The binary embeds the full Bun runtime + all JS/TS code + the frontend assets. No external dependencies needed on the target machine.

### Frontend

| Library | Version | Usage |
|---------|---------|-------|
| React | 19.2 | Declarative UI |
| Vite | 8.0 | Build tool and dev server |
| TypeScript | 5 | Strict typing |
| Recharts | 3.8 | Charts (area, bar, tooltip) |
| lucide-react | 1.7 | SVG icons |
| date-fns | 4.1 | Date manipulation |
| html2canvas | 1.4 | HTML to image capture for PDF |
| jspdf | 4.2 | PDF generation |

### Backend

| Technology | Usage |
|-----------|-------|
| Bun | HTTP server runtime |
| Node.js fs/path | Local file reading |
| child_process | Executing git commands |
| chokidar | File watching for live updates |
| @opentelemetry/* | Metrics export (optional) |

---

## Advanced Configuration

### Environment Variables (server)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `SERVE_STATIC` | *(unset)* | Set to `1` to serve embedded frontend assets (set automatically by `agentop server`) |
| `HOME` / `USERPROFILE` | *(system)* | User home directory |

### Environment Variables (watcher / OpenTelemetry)

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(none)* | OTLP collector endpoint. Required to enable metric export. |
| `OTEL_EXPORTER_OTLP_HEADERS` | *(none)* | Extra headers (e.g. `Authorization=Bearer token`) |
| `OTEL_SERVICE_NAME` | `agentistics` | Service name reported in metrics |
| `CLAUDE_STATS_WATCH_INTERVAL` | `30` | Polling interval in seconds (minimum: 5) |

### Health Checks

The system automatically detects:
- `stats-cache.json` missing or outdated
- Session-meta not found (degraded mode with JSONL)
- Claude Code version mismatch
- Incomplete session data

Alerts have 3 severity levels: **error** (red) · **warning** (yellow) · **info** (blue).

---

## OpenTelemetry + Daemon Mode

agentistics can export usage metrics via [OpenTelemetry](https://opentelemetry.io/) (OTLP/HTTP), enabling integration with **Grafana**, **Datadog**, **New Relic**, **Honeycomb**, and any OTLP-compatible collector.

### agentop server always starts the daemon

When you run `agentop server`, the watcher daemon starts automatically alongside the web server. There is no need to start it separately.

```bash
# Everything in one command — web dashboard + daemon
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 agentop server
```

To run the daemon standalone (headless, no web server):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 agentop watch
```

### How It Works

The watcher (`watcher.ts`):

1. **Watches** `~/.claude/usage-data/session-meta/` and `~/.claude/projects/` via chokidar
2. **Rebuilds** a metrics snapshot on each change (debounced 2s, serialized)
3. **Polls** every N seconds as a fallback (`CLAUDE_STATS_WATCH_INTERVAL`)
4. **Exports** all metrics to the OTLP collector when the endpoint is configured

### Exported Metrics

All metrics use the `claude_stats` namespace:

| Metric | Type | Unit | Description |
|--------|------|------|-------------|
| `claude_stats.messages.total` | Counter | messages | Total messages |
| `claude_stats.sessions.total` | Counter | sessions | Total sessions |
| `claude_stats.tool_calls.total` | Counter | calls | Total tool calls |
| `claude_stats.tokens.input` | Counter | tokens | Total input tokens |
| `claude_stats.tokens.output` | Counter | tokens | Total output tokens |
| `claude_stats.cost.usd` | Counter | USD | Estimated total cost |
| `claude_stats.git.commits` | Counter | commits | Git commits via AI |
| `claude_stats.git.lines_added` | Counter | lines | Lines added |
| `claude_stats.git.lines_removed` | Counter | lines | Lines removed |
| `claude_stats.git.files_modified` | Counter | files | Files modified |
| `claude_stats.streak` | Gauge | days | Current streak |
| `claude_stats.longest_session` | Gauge | min | Longest session duration |
| `claude_stats.active_projects` | Gauge | projects | Number of active projects |
| `claude_stats.tokens.by_model.input` | Counter | tokens | Input tokens per model |
| `claude_stats.tokens.by_model.output` | Counter | tokens | Output tokens per model |
| `claude_stats.tool_calls.by_tool` | Counter | calls | Tool calls per tool |

### Example: Grafana + OpenTelemetry Collector

```yaml
# docker-compose.yml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - "4318:4318"
    volumes:
      - ./otel-config.yaml:/etc/otelcol-contrib/config.yaml
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
```

```yaml
# otel-config.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  prometheus:
    endpoint: "0.0.0.0:8889"
service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [prometheus]
```

---

## Changelog

See [releases](https://github.com/blpsoares/agentistics/releases) for the full version history.

---

<p align="center">
  Made with ♥ for the vibe coding community
</p>
