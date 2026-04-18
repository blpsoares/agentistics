Use the Nay agent to produce a complete analytics summary of my Claude Code usage.

Nay should:
1. Call `agentistics_summary` to get all-time totals.
2. Call `agentistics_costs` to get the model and cache breakdown.
3. Call `agentistics_sessions` with limit=10 to see the most recent sessions.
4. Present a structured report with these sections:
   - **Overview**: total tokens, total cost, session count, current streak
   - **Model breakdown**: cost and token share per model (table)
   - **Cache efficiency**: hit rate %, tokens saved, dollar savings estimate
   - **Recent activity**: last 5 sessions with model, duration, cost
   - **Insights**: 2–3 proactive observations about patterns, anomalies, or opportunities

Format numbers clearly: use k/M for tokens, $ for costs, % for rates.
Keep the full report under 400 words.
