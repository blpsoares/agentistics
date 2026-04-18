Use the Nay agent to run a full productivity and efficiency audit of my Claude Code usage.

Nay should:
1. Call `agentistics_summary` for totals.
2. Call `agentistics_projects` to see all projects.
3. Call `agentistics_sessions` with limit=100 to analyze patterns.
4. Call `agentistics_costs` for the model/cache breakdown.

Produce an audit report with these sections:

### Productivity
- Sessions per day (average and trend)
- Average session duration
- Most active days of the week
- Current streak vs. longest streak
- Projects with most vs. least activity

### Efficiency
- Cache hit rate — is it above 50%? If not, what could help
- Average tokens per session by model
- Cost per session by model — are expensive models being used for simple tasks?
- Sessions under 2 minutes (possibly wasted context) vs. long deep-work sessions

### Project health
- Projects with no sessions in the last 7 days (inactive)
- Projects with the highest cost per session (worth reviewing workflows)
- Projects with best cache efficiency (good patterns to replicate)

### Recommendations
Give 3–5 concrete, actionable recommendations based on the data.
Flag anything that looks like waste or an opportunity to save.

Keep the full audit under 600 words. Use tables for all comparisons.
