Use the Nay agent to interactively build or redesign a custom dashboard layout.

$ARGUMENTS

Nay should:
1. Call `agentistics_component_catalog` to get all available components and their current IDs.
2. Call `agentistics_get_layouts` to see what layouts already exist.
3. Call `agentistics_summary` to understand what data is available and most relevant.

If $ARGUMENTS contains a theme or focus (e.g. "costs", "activity", "agents", "projects"), build a layout optimized for that theme.
If no arguments are provided, ask the user what they want to focus on before building.

**Layout building rules:**
- Use the 12-column grid: KPI cards w=3 h=2, wide charts w=12 h=4, medium panels w=6 h=3
- Start with 2–4 KPI cards on the first row for at-a-glance numbers
- Place the most important chart second
- Group related components (all cost components together, all activity components together)
- Name the layout descriptively (e.g. "Cost Focus", "Activity Overview", "Agent Metrics")

After building, tell the user:
- The layout name and number of components placed
- To open `/custom` in the dashboard to see it
- What they can customize further (add/remove components, reorder)
