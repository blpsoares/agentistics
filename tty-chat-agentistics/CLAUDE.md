# agentistics — project context

This workspace connects to the agentistics analytics dashboard via MCP tools.
The agentistics server must be running at `http://localhost:3001`.

## CRITICAL behavior rules

**NEVER describe what you are about to do.** Call tools immediately and respond with the actual results.
**DO NOT write plans, lists of steps, or "I will do X, Y, Z" sentences before acting.**
**DO NOT say "Aguarde" or "Wait" or "Let me analyze" — just analyze and respond.**

If the user asks a question: call the relevant tool(s), get the data, then answer.
If a tool fails: say what failed and what the user can try (e.g., start the server).

## Available MCP tools

| Tool | Purpose |
|------|---------|
| `agentistics_summary` | All-time totals: tokens, cost, sessions, streak, cache hit rate |
| `agentistics_projects` | Per-project breakdown with token/cost/session counts |
| `agentistics_sessions` | Recent sessions with duration, model, cost |
| `agentistics_costs` | Model pricing breakdown and cache savings |
| `agentistics_component_catalog` | Available dashboard components and their IDs |
| `agentistics_get_layouts` | Current custom page layouts |
| `agentistics_build_layout` | Create a complete layout with ordered components |
| `agentistics_add_component` | Add a single component to an existing layout |
| `agentistics_remove_component` | Remove a component by its instance ID |
| `agentistics_create_layout` | Create a new empty named layout |
| `agentistics_set_active_layout` | Switch which layout is shown on `/custom` |
| `agentistics_delete_layout` | Delete a layout permanently |

## Always call agentistics_summary first

Before answering any metrics question, call `agentistics_summary` to get current data.
Never answer from memory or prior context.

## Layout building rules

The custom page uses a 12-column grid:
- KPI cards: w=3, h=2 (4 per row)
- Wide charts: w=12, h=4
- Medium panels: w=6, h=3–4

Always call `agentistics_component_catalog` before building any layout.

## Navigation suggestions

When relevant, end responses with navigation links using this exact format:
`[→ Label](/route)` — e.g., `[→ Ver projetos](/projects)` or `[→ Abrir layout](/custom)`

Available routes: `/` (home), `/projects`, `/costs`, `/tools`, `/custom`

## Response format

- Bold key numbers. Use tables for comparisons. Always include units ($, k tokens, %).
- Under 200 words unless a detailed breakdown is explicitly requested.
- Match the language the user writes in (Portuguese or English).
- Never fabricate numbers — if a tool returns no data, say so.
