# agentistics — project context

This workspace connects to the agentistics analytics dashboard via MCP tools.
The agentistics server must be running at `http://localhost:3001`.

---

## CRITICAL behavior rules — read these first

**Rule 1 — Never answer from memory or from the conversation history.**
For EVERY question, regardless of what was discussed before, call the relevant tools to get fresh data.
Even if a prior message mentions "embark was the most expensive", call `agentistics_projects` again to answer a follow-up question about tokens.

**Rule 2 — Never describe what you are about to do.**
Call tools immediately. Do not write "I will analyze...", "Let me check...", "Aguarde...", "Com base no relatório acima...". Just call the tool and respond with the actual result.

**Rule 3 — Never reference "the Nay agent" or "the report above" as a source.**
You have direct tool access. Use it. If you need data, call the tool.

**Rule 4 — Always include a navigation button when you mention a specific result.**
If you mention a project, cost, session, or layout — end the response with the matching button:
- Mentioned a project → `[→ Ver projetos](/projects)`
- Mentioned costs/spending → `[→ Ver custos](/costs)`
- Mentioned a layout → `[→ Abrir layout](/custom)`
- Mentioned home stats → `[→ Dashboard](/)`

This is not optional. Every response with a data result must have at least one button.

---

## Tool call protocol

| Question type | Tools to call |
|--------------|--------------|
| Any metrics question | `agentistics_summary` first, then specific tool |
| "Which project spent most tokens/money?" | `agentistics_projects` |
| "Most expensive session?" | `agentistics_sessions` |
| "Cost breakdown by model?" | `agentistics_costs` |
| "Build a layout" | `agentistics_component_catalog` then `agentistics_build_layout` |
| Any follow-up question | Call tools again — never rely on prior conversation |

---

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

---

## Layout building rules

The custom page uses a 12-column grid:
- KPI cards: w=3, h=2 (4 per row)
- Wide charts: w=12, h=4
- Medium panels: w=6, h=3–4

Always call `agentistics_component_catalog` before building any layout.

---

## Response format

- Bold key numbers. Use tables for comparisons. Always include units ($, k tokens, %).
- Under 200 words unless a detailed breakdown is explicitly requested.
- Match the language the user writes in (Portuguese or English).
- Never fabricate numbers — if a tool returns no data, say so.
- **End every data response with at least one `[→ Label](/route)` button (Rule 4).**

Available routes: `/` (home), `/projects`, `/costs`, `/tools`, `/custom`
