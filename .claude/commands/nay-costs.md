Use the Nay agent to do a deep-dive cost analysis of my Claude Code spending.

Nay should:
1. Call `agentistics_costs` for the model pricing breakdown.
2. Call `agentistics_projects` to rank projects by cost.
3. Call `agentistics_sessions` with limit=50 to identify the most expensive individual sessions.

Produce a report covering:
- **Total spend** and daily average
- **Model cost table**: model name | tokens used | cost | % of total
- **Cache savings**: how much was saved vs. full pricing; what hit rate means in $/month at current pace
- **Top 5 most expensive projects** (table: project | sessions | total cost | avg cost/session)
- **Top 5 most expensive sessions** (table: date | project | model | duration | cost)
- **Recommendations**: concrete suggestions to reduce cost (e.g., use Haiku for X type of work, improve caching by Y)

Flag any session that cost more than 3× the average session cost as an anomaly worth investigating.
