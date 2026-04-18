# agentistics MCP Server

The agentistics MCP server exposes your usage analytics as tools that any MCP-compatible client can call — including Claude Code, Nay (the built-in chat), and any third-party agent that supports MCP.

## What is MCP?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is an open standard that lets AI models call structured tools defined by external servers. The agentistics MCP server translates the `/api/data` response into a set of typed tools so that AI agents can query your usage data programmatically.

## Starting the MCP server

The MCP server runs as a stdio process. It is **not** a separate HTTP server — it communicates via stdin/stdout with the MCP client (Claude Code, etc.) and makes HTTP calls internally to the agentistics API.

```bash
# agentistics must be running first (provides /api/data)
agentop server

# Then register the MCP (done automatically on first server start, but you can do it manually):
claude mcp add -s user agentistics \
  -e AGENTISTICS_API=http://localhost:47291 \
  -- bun run /path/to/agentistics/mcp/agentistics-mcp.ts
```

The agentistics server registers the MCP automatically at startup via `claude mcp add -s user`. If the registration already exists with the correct URL, it is skipped.

### Verify registration

```bash
claude mcp list
# Should show: agentistics  bun run .../mcp/agentistics-mcp.ts
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTISTICS_API` | `http://localhost:47291` | Base URL of the agentistics API server |

## Available tools

### `agentistics_summary`

All-time totals across your entire Claude Code history.

**Returns:**
```json
{
  "totalSessions": 142,
  "totalMessages": 3891,
  "totalInputTokens": 12500000,
  "totalOutputTokens": 890000,
  "totalCacheReadTokens": 45000000,
  "totalCostUSD": 18.42,
  "currentStreak": 7,
  "topProject": "/home/user/projects/my-app",
  "cacheHitRate": 0.78,
  "totalToolCalls": 8200
}
```

---

### `agentistics_projects`

Per-project breakdown with aggregated token and cost data.

**Returns:** array of projects sorted by total tokens descending
```json
[
  {
    "name": "my-app",
    "path": "/home/user/projects/my-app",
    "sessionCount": 34,
    "inputTokens": 3200000,
    "outputTokens": 220000,
    "cacheReadTokens": 9100000,
    "costUSD": 5.21
  }
]
```

> **Note:** Token/cost data is aggregated from session records grouped by `project_path`. Projects are matched by exact path.

---

### `agentistics_sessions`

Recent sessions with duration, model, and cost.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `limit` | number | 20 | Max sessions to return (1–100) |

**Returns:** array of sessions sorted by start time descending
```json
[
  {
    "sessionId": "abc123",
    "projectPath": "/home/user/projects/my-app",
    "startTime": "2025-01-15T14:30:00Z",
    "durationMinutes": 47,
    "inputTokens": 85000,
    "outputTokens": 6200,
    "model": "claude-sonnet-4-6",
    "estimatedCostUSD": 0.348
  }
]
```

---

### `agentistics_costs`

Model pricing breakdown and cache savings analysis.

**Returns:**
```json
{
  "byModel": [
    {
      "model": "claude-sonnet-4-6",
      "inputTokens": 8200000,
      "outputTokens": 610000,
      "cacheReadTokens": 31000000,
      "cacheWriteTokens": 1200000,
      "costUSD": 12.80
    }
  ],
  "cacheHitRate": 0.78,
  "estimatedSavingsUSD": 9.30,
  "totalCostUSD": 18.42
}
```

---

### `agentistics_component_catalog`

Lists all dashboard components available for placement on the custom `/custom` page. **Always call this before building a layout.**

**Returns:**
```json
[
  {
    "id": "kpi-messages",
    "label": "Messages",
    "category": "KPI",
    "defaultW": 3,
    "defaultH": 2
  },
  {
    "id": "activity-chart",
    "label": "Activity Chart",
    "category": "Activity",
    "defaultW": 12,
    "defaultH": 4
  }
]
```

---

### `agentistics_get_layouts`

Returns all saved custom layouts and which one is currently active.

**Returns:**
```json
{
  "active": "overview",
  "layouts": [
    {
      "name": "overview",
      "items": [
        { "id": "kpi-cost", "x": 0, "y": 0, "w": 3, "h": 2 }
      ]
    }
  ]
}
```

---

### `agentistics_build_layout`

Creates a complete layout replacing any existing layout with the same name. Components are auto-positioned using first-fit shelf packing on a 12-column grid if positions are not specified.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Layout name |
| `componentIds` | string[] | yes | Ordered list of component IDs from the catalog |
| `activate` | boolean | no | Set as active layout after creating (default: true) |

**Grid rules:**
- KPI cards: `w=3, h=2` (4 per row)
- Wide charts: `w=12, h=4`
- Medium panels: `w=6, h=3–4`
- Grid is 12 columns wide

---

### `agentistics_add_component`

Adds a single component to an existing layout. The component is auto-positioned after existing items.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `layoutName` | string | yes | Target layout name |
| `componentId` | string | yes | Component ID from the catalog |
| `w` | number | no | Width in grid columns (defaults to catalog default) |
| `h` | number | no | Height in grid rows (defaults to catalog default) |

---

### `agentistics_remove_component`

Removes a component by its instance ID from a layout.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `layoutName` | string | yes | Target layout name |
| `instanceId` | string | yes | The `id` field of the specific item in the layout |

---

### `agentistics_create_layout`

Creates a new empty named layout without adding any components.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Layout name |

---

### `agentistics_set_active_layout`

Switches the `/custom` page to display a different layout.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Layout name to activate |

---

### `agentistics_delete_layout`

Permanently deletes a layout. Cannot be undone.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Layout name to delete |

---

## Using the MCP from Claude Code

Once registered, you can invoke agentistics tools directly from any Claude Code session:

```
# In a Claude Code chat (not Nay), you can ask:
"What's my total spend so far this month according to agentistics?"
"Build me a layout in agentistics with cost KPIs and the activity chart"
```

Claude Code will automatically use the registered MCP tools. No explicit configuration needed per-project — the registration is at user scope (`~/.claude.json`).

## Using the MCP from a custom agent

```typescript
// Example: calling agentistics tools from a Claude agent
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

const response = await client.beta.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  tools: [/* your agentistics MCP tools */],
  messages: [{ role: 'user', content: 'What project spent the most tokens?' }],
})
```

## MCP server implementation

The server lives at `mcp/agentistics-mcp.ts`. It uses the `@modelcontextprotocol/sdk` to expose tools over stdio, fetching data from the agentistics HTTP API (`AGENTISTICS_API`).

Key design decisions:
- **No direct file access** — all data goes through the agentistics API so the same parsing/aggregation logic applies everywhere
- **Cost calculation** — the MCP server has its own inline `calcCostUSD` that mirrors `src/lib/types.ts` to avoid bundling the frontend module
- **Auto-position algorithm** — `agentistics_build_layout` uses first-fit shelf packing on a 12-column grid, placing items left-to-right before moving to the next row

## See also

- [Nay chat](./nay.md) — how the built-in AI assistant uses these tools
- [Data sources](./data-sources.md) — what `/api/data` returns and how it's computed
