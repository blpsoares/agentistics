# Grafana + OpenTelemetry — Local Observability Stack

Local metrics stack for agentistics. Exports Claude usage metrics (tokens, cost, sessions, git activity) to Grafana via OpenTelemetry.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- [Bun](https://bun.sh/) (already required by the project)

## Stack

| Service | Port | Role |
|---|---|---|
| OTel Collector | 4318 | Receives OTLP/HTTP from `server/otel-watcher.ts`, exposes metrics for Prometheus |
| Prometheus | 9090 | Scrapes the collector every 15s |
| Grafana | 3000 | Visualizes metrics; pre-configured with Prometheus datasource and dashboard |

## Setup (one-time)

From the project root:

```bash
docker compose up -d
```

Verify all three containers are running:

```bash
docker compose ps
```

Expected output:

```
agentistics-grafana      Up   3000/tcp
agentistics-otel         Up   4318/tcp
agentistics-prometheus   Up   9090/tcp
```

## Running the metrics daemon

The daemon reads `~/.claude/` and exports metrics to the collector every 30 seconds.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun run watch
```

Expected output:

```
[snapshot] Messages=1234 Sessions=56 Cost=$7.89 Streak=3d Projects=4
[otel] Exporting metrics to http://localhost:4318 every 30s (service.name="agentistics")
[watcher] Watching /home/<user>/.claude/projects
```

> The `Directory not found: .../session-meta` warning is normal — the daemon falls back to reading raw JSONL files.

## Accessing Grafana

Open **http://localhost:3000** — no login required (anonymous admin).

Navigate to **Dashboards → Agentistics → Agentistics — Claude Stats**.

The dashboard auto-refreshes every 30s. Allow up to one minute after starting the daemon for the first data points to appear.

## Available metrics

| Metric | Type | Description |
|---|---|---|
| `claude_stats_cost_usd_USD_total` | Counter | Total cost in USD |
| `claude_stats_messages_total` | Counter | Total messages (user + assistant) |
| `claude_stats_sessions_total` | Counter | Total sessions |
| `claude_stats_tool_calls_total` | Counter | Total tool calls |
| `claude_stats_tokens_input_total` | Counter | Total input tokens |
| `claude_stats_tokens_output_total` | Counter | Total output tokens |
| `claude_stats_tokens_by_model_input_total` | Counter | Input tokens, labeled by `model_id` |
| `claude_stats_tokens_by_model_output_total` | Counter | Output tokens, labeled by `model_id` |
| `claude_stats_streak` | Gauge | Current activity streak in days |
| `claude_stats_active_projects` | Gauge | Number of active projects |
| `claude_stats_git_commits_total` | Counter | Total git commits |
| `claude_stats_git_pushes_total` | Counter | Total git pushes |
| `claude_stats_git_lines_added_total` | Counter | Total lines added |
| `claude_stats_git_lines_removed_total` | Counter | Total lines removed |

## Stopping the stack

```bash
docker compose down
```

To also remove the Grafana volume (clears saved dashboards and settings):

```bash
docker compose down -v
```

## Optional: custom service name

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=my-agentistics \
bun run watch
```

## File structure

```
(project root)
  docker-compose.yml                 ← spins up OTel Collector, Prometheus, and Grafana
  grafana/
    README.md                        ← this file
    otel-collector.yaml              ← OTel Collector config (receives OTLP, exposes to Prometheus)
    prometheus.yml                   ← Prometheus scrape config
    provisioning/
      datasources/
        prometheus.yaml              ← auto-configures Prometheus as Grafana datasource
      dashboards/
        provider.yaml                ← tells Grafana where to find dashboard JSON files
        agentistics.json             ← pre-built dashboard (provisioned automatically)
```
