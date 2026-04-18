# OpenTelemetry Integration

agentistics can export usage metrics via [OpenTelemetry](https://opentelemetry.io/) (OTLP/HTTP), enabling integration with Grafana, Datadog, New Relic, Honeycomb, and any OTLP-compatible collector.

## How to enable

Set `OTEL_EXPORTER_OTLP_ENDPOINT` before starting:

```bash
# Binary
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 agentop server

# From source
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun run dev
```

The OTel daemon starts automatically as part of `agentop server`. To run it standalone (headless, no web server):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 agentop watch
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(none — export disabled)* | OTLP collector endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` | *(none)* | Extra headers, e.g. `Authorization=Bearer token` |
| `OTEL_SERVICE_NAME` | `agentistics` | Service name reported in metrics |
| `CLAUDE_STATS_WATCH_INTERVAL` | `30` | Polling interval in seconds (minimum: 5) |

## How it works

The watcher (`server/otel-watcher.ts`):

1. **Watches** `~/.claude/usage-data/session-meta/` and `~/.claude/projects/` via chokidar
2. **Rebuilds** a metrics snapshot on every file change (debounced 2s, serialized — no concurrent rebuilds)
3. **Polls** every `CLAUDE_STATS_WATCH_INTERVAL` seconds as a fallback for missed events
4. **Exports** all metrics to the OTLP endpoint when it is configured

## Exported metrics

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

## Example: Grafana + OTel Collector

```yaml
# docker-compose.yml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - "4318:4318"   # OTLP HTTP
      - "8889:8889"   # Prometheus scrape
    volumes:
      - ./otel-config.yaml:/etc/otelcol-contrib/config.yaml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
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

Then add a Prometheus data source in Grafana pointing to `http://otel-collector:8889` and create dashboards using the `claude_stats.*` metrics.

A pre-built Grafana dashboard JSON is available in `grafana/` in the repository root.

## Grafana dashboard

The `grafana/` folder contains a ready-to-import dashboard with:
- Total cost over time
- Token breakdown by model
- Session count and streak gauge
- Tool call ranking
- Git activity

Import it via Grafana → Dashboards → Import → Upload JSON.
