# Agentistics — complete metrics inventory

Read-only discovery, done against the worktree `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec`
(branch `spec/runtime-architecture`, HEAD `9b06537aec33cdca98a98f9c851360dcfa62527a`, **50 commits behind
`origin/dev`** — some narrative in `CLAUDE.md` there is stale relative to `dev`; every claim below was
checked against the actual file at that HEAD, and drift from `dev` is flagged where found). No file was
modified. `docs/metrics.md` and `docs/harness-contract.md` were read in full; all other claims are
grounded in source reads with `file:line` citations, or explicitly marked "per CLAUDE.md" when taken from
the repo's own architecture memory rather than verified by reading the implementation myself.

---

## 1. Master metric inventory

Legend for **aggregation**: `sum` = plain addition; `gauge` = last/point-in-time value, never summed;
`median`/`mean` = distribution statistic; `Claude: cache, non-Claude: per-session` = the
`stats-cache.json`-is-Claude-only split that recurs through the whole product.

### 1.1 Cost

| Metric | Meaning | Source field(s) | Parser | Transformation | Aggregation | Projection | UI surfaces | Capability gate | Filters honored |
|---|---|---|---|---|---|---|---|---|---|
| API-equivalent cost (USD) | tokens × `MODEL_PRICING` per model | `SessionMeta.model` / `model_usage`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; `StatsCache.modelUsage` for Claude | `calcCost()` / `sessionCostUSD()` / `sessionModelUsage()` — `packages/core/src/types.ts:1000` (`calcCost`), `:927` (`getModelPrice`), `:964` (`sessionModelUsage`), `:983` (`sessionCostUSD`) | Per-model: `Σ (tokens/1e6 × price[kind])` for input/output/cacheRead/cacheWrite; multi-model sessions (`model_usage`) price each model at its own rate | `Claude: Σ calcCost(modelUsage) from statsCache; non-Claude: Σ sessionCostUSD(session) per session` | `useDerivedStats` (`useData.ts`), `selectors.ts` (TUI), `otel-watcher.ts`, `agent-metrics.ts`, `tags-aggregate.ts`, `task-rollup.ts` | Home KPI, CostsPage, ComparePage, RepositoriesPage, TagsPage/TagDetailPage, PDF export, header, TUI Overview, VS Code status bar, MCP `agentistics_costs`/`agentistics_summary` | `HARNESS_CAPABILITIES.cost` (`types.ts:99-193`; all 6 harnesses `true`) | date, project, repo, model, harness, user/team/machine (central), tag |
| Plan-basis cost (C, A, V) | What the subscription actually cost vs. API-equivalent value extracted | `Preferences.billing.profiles` (`BillingTimeline`/`BillingPeriod`), filtered sessions' API cost | `computePlanCost` et al., `packages/core/src/billing.ts` (types `:51-96`; day arithmetic `:104-140`) | `C = Σ monthly×overlapDays/30.44` over registered periods; `A` = API cost restricted to the SAME covered days (`coveredDayKeys`); `V = A/C` | Per harness, then `AggregatePlanBasis` composes across harnesses (`billing.ts:716` `combine...`, `:809`, `:871` `PlanAllocation`) | `usePlanBasis` hook (web), Home "API vs plan" panel, `CompareByFilter`, `SessionStatsMenu`, `AgentMetricsPanel` | Home, CostsPage, session drawer, Compare, Settings→Billing | Unavailable when no plan registered or on a central (`central: true → {basis:null, blocked:'central'}` per CLAUDE.md) | date range (proration), harness (per-harness C/A), never project/model (allocations only) |
| Plan allocation (per row) | A row's share of `C`, rescaled by that harness's `C/A` | Same as above | `PlanAllocation` machinery, `billing.ts:871` | Linear rescale within one harness; cross-harness rows use each harness's own factor | n/a (per-row) | `AgentMetricsPanel`, per-repo/per-model plan figures | Cost surfaces with a Plan toggle | Same as plan-basis cost | Labelled "allocated", never claimed as measured |
| Monthly commitment | What registered plans owe THIS calendar month | `BillingSettings.profiles` | `monthlyCommitment()` (billing.ts, per CLAUDE.md) | Prorated for a plan that starts/ends mid-month | sum | `BudgetPanel` | CostsPage budget panel | n/a | none (fixed obligation) |
| Blended cost / 1M tokens | Weighted-average per-token rate when no per-session model is known | Global `modelUsage` | `blendedCostPerToken()` — `packages/web/src/hooks/useData.ts:571` | `avg_rate[kind] = Σ(model_tokens[kind]×price[kind]) / Σ tokens[kind]`, over ALL FOUR kinds | n/a | `useDerivedStats` (project/model filter active), PDF per-session cost column | PDF export, session drawer fallback, repo detail | n/a | project filter active |
| Cost per harness (Compare) | Per-harness totals + comparatives | `AppData.statsCache` (claude) + `AppData.sessions` (others) | `computeHarnessSummaries()` — `useData.ts:939`; `HarnessSummary` type `useData.ts:618` | Claude via `claudeSummaryFromStatsCache`, others via `summarizeHarnessSessions` | Claude: cache; non-Claude: per-session sum | `computeFilteredHarnessSummaries` (`useData.ts:980`) when any filter active | ComparePage | Per `HARNESS_CAPABILITIES.cost` | users, harnesses, teams, machines, projects, models, date |
| Per-agent-invocation cost | Cost of one subagent's own turns, priced at ITS OWN model | Subagent transcript `message.usage` per model | `calcCost()` inside `agent-metrics.ts`/`subagent-parse.ts` (per CLAUDE.md "Agent metrics" section) | Sum per model of the subagent's turns | sum | `agent-metrics.ts` → `AgentInvocation.costUSD` | ToolsPage agent metrics panel, session drawer | `HARNESS_CAPABILITIES.agents` (claude only) | n/a (per invocation) |
| Tag cost | Aggregate cost of a tag's resolved session set | Resolved `SessionMeta[]` | `aggregateSessions()` — `packages/server/server/tags-aggregate.ts:48-77` | `Σ (sessionCostUSD(s) ?? calcCost(fallback usage, ''))` per session | sum, always per-session (never statsCache) | `tags-handlers.ts` | TagsPage cards, TagDetailPage KPI row | n/a | tag sources + optional `TagDoc.window` period |
| Task/subtask/delivery cost | Cost across a task's/subtask's linked sessions | `RollupSession[]` built from `Task`/`Subtask` session links | `rollupAttempt()` — `packages/server/server/sessions/task-rollup.ts:72-106` | `costUSD = sumOrNull(rows.map(costUSD))`; `costMeasuredSessions`/`costEstimatedSessions` counted separately; Copilot credits kept apart (`mixedCurrency`) | sum-or-null (never a confident 0) | `task-report.ts` (`subtaskViews`), `task-web.ts` | `/tasks` board, TagDetailPage-style task cards | n/a (per session's own harness capability) | task/subtask scope only |
| OTel exported cost | `claude_stats.cost.usd` counter | `StatsCache.modelUsage` (top-level) + per-harness `HarnessSnapshot.totalCostUsd` (consolidate store) | `buildSnapshot()` — `packages/server/server/otel-watcher.ts:146-232`; `buildHarnessSnapshots()` `:97-142` | Top-level cost = `Σ calcCost(modelUsage)` — **Claude only** (from `stats-cache.json`); per-harness gauge separately exported with harness attribute (`obs.observe(h.totalCostUsd, {harness})`, `:511`) | Claude: cache; non-Claude: per-harness per-session sum, exported as a SEPARATE metric series | `latestSnapshot` global | Any OTel-compatible backend (Grafana etc.) | n/a | none — this is the unfiltered, whole-machine total |

### 1.2 Tokens (input / output / cacheRead / cacheWrite / total)

| Metric | Meaning | Source | Parser | Transformation | Aggregation | Projection | UI surfaces | Capability gate | Filters |
|---|---|---|---|---|---|---|---|---|---|
| `TokenBreakdown` (4 counters) | The ONE definition of "tokens" in the product | `SessionMeta.input_tokens/output_tokens/cache_read_input_tokens/cache_creation_input_tokens` | `sessionTokens()` — `packages/core/src/tokens.ts:58-68`; `usageTokens()` `:71-78` for `ModelUsage` | none — direct read, zero-filled | `addTokens`/`sumTokens` (`tokens.ts:80-93`) | `totalTokens()` (`:102-104`) is THE figure everywhere | Every surface that prints "tokens" | n/a (structural) | n/a |
| Total tokens | `input+output+cacheRead+cacheWrite` | as above | `totalTokens()` — `tokens.ts:102` | sum of 4 | sum | every aggregate (`HarnessSummary.tokens`, `RepoStat.tokens`, `TagAggregate.tokens`) | Home, Costs, Compare, Repos, Tags, PDF, header `N tok`, session drawer | n/a | all standard filters |
| "Read" tokens (cache-hit denominator) | Everything the model read, however served | as above minus output | `readTokens()` — `tokens.ts:107-109` | `input+cacheRead+cacheWrite` | sum | Cache Efficiency panel | CostsPage cache panel | n/a | date/project (session-scoped) |
| "Conversation only" tokens | `input+output`, explicitly labelled NOT the total | as above | `TERMS.conversation` — `tokens.ts:219-228` | sum of 2, presented ONLY under this explicit label | sum | rare, explicit "conversational" cards | none identified as primary; exists as a vocabulary entry, guarded by `tokens.lint.test.ts` against silent reuse as "tokens" | n/a | n/a |
| Token shares (%) | Composition of the total | `TokenBreakdown` | `tokenShares()` — `tokens.ts:125-134` | `part/total`, `0` when total≤0 (never `NaN`) | n/a | bar charts, `totalTokensExplained()` sentence (`tokens.ts:280-291`) | Home/Costs token composition bars | n/a | n/a |
| Per-day token split | What a session did on each UTC day | `SessionMeta.daily: Record<day, SessionDayUsage>` (`types.ts:262`) | Written during JSONL parse (per turn timestamp), consumed by `sliceSession()` — `packages/web/src/lib/sessionDaySlice.ts:100-115` | Sums the 4 counters + `messages` + `hours` per day inside the requested day-set | sum over days-in-range; `null` (not 0) when session has no `daily` | Every date-filtered aggregate in `useDerivedStats` | Home KPIs under a date filter, "Usage by hour" chart | n/a; absent on old records / harnesses whose adapter predates the field | date range only |
| Per-model token/day approximation | Input/output split by model, per day | `StatsCache.dailyModelTokens` (totals only, no in/out split) | none — CLAUDE.md states explicitly: "input/output split uses global statsCache proportions as an approximation when filtering by date" | Apportion daily model total by the GLOBAL model in/out ratio | **estimate, not measured** | `useDerivedStats` | Costs page per-model-per-day chart | n/a | date range |
| OTel token gauges | `claude_stats.tokens.input` / `.output` | `StatsCache.modelUsage` | `buildSnapshot()` — `otel-watcher.ts:180-192` | **`inp = inputTokens + cacheRead + cacheCreation`**, `out = outputTokens` — cache is FOLDED into the "input" metric name because OTel only exposes two counters (`otel.ts:41,44-45` `METRIC_DESCRIPTORS`); this is NOT the 4-part `tokens.ts` breakdown | Claude-only (top-level); per-harness `HarnessSnapshot` (`otel-watcher.ts:97-142`) does the same 3-into-2 fold per non-Claude harness | OTel exporter | External dashboards | n/a | none (unfiltered) |

**Finding:** the OTel exporter's `claude_stats.tokens.input`/`.output` names deliberately conflate cache
traffic into "input" (no cache-read/cache-write OTel metric exists at all — see `METRIC_DESCRIPTORS`,
`packages/core/src/otel.ts:40-58`). Someone reading only the OTel series would see a materially
different "input tokens" number than the dashboard's `TokenBreakdown.input`, which excludes cache.

### 1.3 Requests / messages / rounds / model invocations

| Metric | Meaning | Source | Parser | Aggregation | Projection | Surfaces | Gate | Filters |
|---|---|---|---|---|---|---|---|---|
| User messages / rounds | Person's turns | `SessionMeta.user_message_count` | `jsonl.ts` (`isHumanUserEntry`, excludes `isMeta`/`isCompactSummary` — CLAUDE.md "One billed response…") | sum | `session-profile.ts` `messages` reader (`session-profile.ts:93`) | Home, session drawer, `session-profile.ts` baseline | n/a | date, project, harness |
| Assistant messages | `assistant_message_count` | same | same | sum | | Home, drawer | n/a | same |
| Prompt/answer chars & tokens | Verbosity metrics | `user_chars`/`user_char_messages`/`assistant_chars`/`assistant_char_messages` (`types.ts:205-220`) | jsonl.ts | sum, own denominator (never `user_message_count`) | session-profile-adjacent panels | docs/metrics.md §"Prompt and answer length metrics" | n/a | n/a |
| Model invocations / per-model breakdown | Which models did the work | `SessionMeta.model` / `model_usage` | `sessionModelUsage()` (`types.ts:964`) | Claude: `StatsCache.modelUsage`; non-Claude: per-session | `ModelBreakdown.tsx`, `modelRows()` (TUI `selectors.ts:199-221`) | Home, Costs, TUI Models screen | n/a | model, date, project |
| Rounds in a delivery | Turns spent on a task | `SessionMeta.user_message_count` across linked sessions | `rollupAttempt()` — `task-rollup.ts:97` | `sumOrNull` | `AttemptRollup.rounds` | `/tasks` board | n/a | task scope |

### 1.4 Latency / durations / active time

| Metric | Meaning | Source | Parser | Aggregation | Projection | Surfaces | Gate | Filters |
|---|---|---|---|---|---|---|---|---|
| `duration_minutes` | Wall clock, last−first event | `SessionMeta.duration_minutes` | computed at parse time | n/a | Longest-session KPI, `LongestSession` in `StatsCache` | Home, OTel `longestSessionMinutes` | always populated | n/a |
| `active_minutes` | Σ per-turn duration | `SessionMeta.active_minutes`, `TurnEvent[]` | `computeActiveTime()`/`activeMinutesOf()` — `packages/core/src/activeTime.ts:155-164`; fold/finish resumable state `:91-145` | sum of closed turns; `undefined` if no usable timing (never a guess) | `session-profile.ts` `activeMinutes` reader | Every session card ("Xh ativo · Yh decorrido"), `session-profile.ts` baseline, task evidence (`taskStats`) | `HARNESS_CAPABILITIES.activeTime` (all 6 `true`, but quality varies: measured for claude/codex/copilot, reconstructed for gemini/antigravity/kimi — `activeTime.ts` header, `docs/harness-contract.md §1`) | n/a |
| **Per-model-invocation latency** | Time a single model call took | **Does not exist** | — | — | — | — | — | — |
| **Tool-call duration** | How long one tool_use took | **Does not exist** — only `AgentInvocation.totalDurationMs` (whole subagent span) and `WorkflowAgent`'s `durationMs` (whole agent) are tracked; no per-tool-call timer anywhere in `SessionMeta`, `AgentInvocation` or `WorkflowAgent` | — | — | — | — | — | — |
| Subagent duration | `AgentInvocation.totalDurationMs` | subagent transcript first→last timestamp | `subagent-parse.ts` (`summarizeSubagentTranscript`, `:96`) | ROOT'S OWN SPAN ONLY — nested agents never add (CLAUDE.md "Agent metrics") | `SessionAgentMetrics.totalDurationMs` | ToolsPage agent panel | `HARNESS_CAPABILITIES.agents` (claude only) | n/a |
| Workflow run duration | `WorkflowRun.durationMs` / `WorkflowAgent.durationMs` (via `totals.durationMs`) | run transcript | `workflow-metrics.ts`, `workflow-agent.ts` (server root, not under `sessions/` despite CLAUDE.md's tree — verified: `packages/server/server/workflow-*.ts`) | sum of agent spans | `WorkflowRun.totals.durationMs` | RepoDetailPage "Dynamic Workflows" tab | `HARNESS_CAPABILITIES.dynamicWorkflows` (claude only) | repo scope |
| Task delivery wall time | Creation → delivery | `Task.createdAt`/delivery timestamp | `taskStats()` — `packages/server/server/sessions/task-stats.ts:106-121` | `deliveredMs - createdMs`, `null` while open | `TaskStats.deliveryMs` | `/tasks` board | n/a | task scope |
| Streak | Consecutive active days | `StatsCache.dailyActivity` (global, unfiltered) | `calcStreak()` (per CLAUDE.md/`docs/metrics.md §"Streak"`) | counts backward from today, today-with-no-activity doesn't break it | KPI | Home | n/a — Claude's dailyActivity only, per docs/metrics.md | **none — deliberately ignores date/project filters** |

### 1.5 Agents / subagents

| Metric | Meaning | Source | Parser | Aggregation | Projection | Surfaces | Gate |
|---|---|---|---|---|---|---|---|
| Agent invocation count | How many `Agent`/forked-`Skill` launches | subagent transcript directory (`subagents/agent-<id>.jsonl`), NOT the parent's `tool_use`/`tool_result` pairing | `planAgentJoin()` — `packages/server/server/subagent-join.ts:138`; `AgentJoinPlan` (`:62`) pairs by `agentId` then `toolUseId`, refuses ambiguous pairings, reports `unclaimed` transcripts | `totalsOf()` — `subagent-parse.ts:256-266` | `SessionAgentMetrics.totalInvocations` | ToolsPage, session drawer, `session-profile.ts` `subagents` reader (`session-profile.ts:103-106`, gated on `_source==='jsonl'`) | `HARNESS_CAPABILITIES.agents` — claude only (antigravity explicitly `false`: an `invoke_subagent` child is its own conversation, not an invocation) |
| Unmeasured invocations | Invocations whose transcript is gone/interrupted | `AgentInvocation.unmeasured` (`types.ts:~370`) | subagent-join/parse | count, excluded from totals | `SessionAgentMetrics.unmeasuredInvocations` | `web/src/lib/agentMeasured.ts` — surfaces "totals cover fewer rows than shown" | same |
| Subagent tokens/cost/duration/tool-stats | Per-invocation numbers | subagent's own `message.usage`, priced at ITS OWN model | `agentNumbers()` — `subagent-parse.ts:200-255` | per invocation | `AgentInvocation.{totalTokens,costUSD,totalDurationMs,toolStats}` | ToolsPage agent panel | claude only |
| Workflow agent metrics | Per-agent tokens/cost/tools in a Dynamic Workflow run | agent transcript `agent-<hash>.jsonl` | `workflow-agent.ts` + `workflow-match.ts` (prompt-fingerprint pairing) | sum into `WorkflowRun.totals` | RepoDetailPage timeline | claude only (`dynamicWorkflows`) |

### 1.6 Tool calls, MCP, shell/git commands

| Metric | Meaning | Source | Parser | Aggregation | Surfaces | Gate |
|---|---|---|---|---|---|---|
| Tool call counts by name | `tool_counts: Record<string,number>` | raw transcript `tool_use` | `jsonl.ts` per-harness parsers; `canonicalTool()` — `harness-activity.ts` per CLAUDE.md maps each harness's own tool name to Claude's vocabulary | sum | ToolsPage, `otel-watcher.ts` `toolCounts` (Claude-session-meta-only, see §4 gap) | `HARNESS_CAPABILITIES.tools` — `true` for ALL 6 harnesses |
| Tool output-token attribution | Which tool "spent" how many output tokens | `tool_output_tokens` | fair-split: `output_tokens ÷ N tool_use blocks` per assistant message (docs/metrics.md §"Tool token attribution") | sum | ToolsPage "villains" (>40% flag) | tools=true |
| MCP servers used | Distinct MCP server names | `tool_counts` keys prefixed `mcp__<server>__<tool>` | `session-profile.ts` `mcpServers` reader (`:98-102`) counts `new Set(names.map(t=>t.split('__')[1]))` | count of distinct servers | `session-profile.ts` baseline | `HARNESS_CAPABILITIES.mcpServers` — **claude + kimi only** (narrower than `tools`; antigravity/copilot/codex/gemini `false`) |
| MCP call count / tool names (Copilot) | `mcp_tool_call_count`, `mcp_tool_names` | Copilot adapter only (`types.ts` near end of `SessionMeta`) | copilot-parse.ts | sum / set | HarnessInfoPanel | copilot-specific fields, not a capability flag |
| Git commits / pushes | `git_commits`, `git_pushes` | Bash tool_use commands, chained on `&&`/`;`/`||`/newline | `countGitCommands()` — `harness-activity.ts` (regex `(?![\w-])`, not `\b`, to exclude `git commit-tree`) | sum | Home, otel-watcher (Claude-session-meta only) | Every harness whose Bash-equivalent tool is parsed — `tools:true` implies commands are readable |
| Lines added/removed | `lines_added`, `lines_removed` | `git log --numstat` for project window, OR edit-payload deltas (Antigravity) | `getProjectGitStats()`/`getGitFileStats()` (`git.ts`), or `antigravity-parse.ts` newline-diff | project-level preferred when a project filter is active; session-level (`files_modified`) otherwise | Home, RepositoriesPage | `HARNESS_CAPABILITIES.gitLines` — claude, copilot: `true`; codex, gemini, kimi, antigravity: **`false`** (antigravity computes `lines_added` from edit payloads but is gated `false` because it structurally cannot report `lines_removed`, per `types.ts` comment ~ line 130-140) |
| Files modified | `files_modified` | `Math.max(gitFileStats.filesModified, claudeFilesModified.size)` | `jsonl.ts` (docs/metrics.md, CLAUDE.md "files_modified counting") | max of two independent counts, not a sum | Home FILES KPI (session-level preferred; falls back to project-level only if session shows 0) | all harnesses report SOME count; gitLines gate does not block `files_modified` |
| Languages | `languages: string[]` | file extensions touched, via `EXT_TO_LANG` (jsonl.ts) | classification map | set union | Home "Languages" word cloud | tools=true harnesses |
| Tool errors | `tool_errors`, `tool_error_categories` | tool_use results signalling failure | jsonl.ts | sum | `session-profile.ts` `toolErrors` reader (`:96`) | n/a (every harness reports what it can distinguish) |

### 1.7 Repositories, projects, sessions, tasks, tags, models, providers, harness

| Dimension | Key | Source | Aggregator | Surfaces | Notes |
|---|---|---|---|---|---|
| Repository | `normalizeGitRemote()` result, `host/org/repo` | `SessionMeta.git_remote` (`types.ts:332-335`), `normalizeGitRemote()` (`types.ts:1084-1102`) | `useDerivedStats` builds `RepoStat[]`; server `resolveProjectFacts`/`planProjectFacts` (project-facts.ts, per CLAUDE.md) stamps it from ANY harness's `project_path`, not only Claude's | RepositoriesPage, RepoDetailPage, ActionsPage, tag detail `repos` bucket, task `repos` (`reposOfRows`) | `''` = "no linked repository" bucket, always shown, never hidden |
| Project | `project_path` (raw dir) | `SessionMeta.project_path` | server `scanProjects` (`data.ts`) | HomePage top-projects panel, ProjectsModal, filter dimension | No dedicated `/projects` page — redirects to `/repositories`; `stats-cache.json` has NO project granularity (CLAUDE.md), so project filters are ALWAYS per-session sums |
| Session | `session_id` | `SessionMeta` itself | `loadSessionMetas`/`buildApiResponse` (`data.ts`) | everywhere | `_source: 'meta'|'jsonl'|'subdir'` provenance (see §4) |
| Task/delivery | task id | `Task`/`Subtask`/`TaskClaim` (`task-model.ts`) | `task-rollup.ts`, `task-stats.ts`, `task-report.ts` | `/tasks` board | Measured THROUGH sessions, never standalone; `null` sorts last, never as 0 |
| Tag | `TagDoc.id` | `tags-store.ts` (Mongo) | `resolveTagSessions()` (`tags-resolve.ts`) → `aggregateSessions()`/`aggregateTagDetail()` | TagsPage, TagDetailPage | Sources = `repo|project|machine|team|account`, union/OR, deduped; optional `window` period narrows further |
| Model | model id string | `SessionMeta.model`/`model_usage` | `getModelPrice()`, `formatModel()` | ModelBreakdown, Settings→Pricing (only models this machine has USED) | Provenance: `official`/`community`/`builtin` per model (rates.ts) |
| **Provider** | billing entity (`anthropic`/`openai`/`google`/`moonshot`/`other`) | model-id prefix match | `resolveProvider()` — `packages/core/src/providers.ts:62-72` | `ModelBreakdown.tsx` (grouping/sort, `resolveProvider` used at lines 5,55,70-71,210-211), `PricingSettings.tsx` (line 190, group headings) | **NOT a `Filters` dimension** — see §2.3 below. Used only for grouping/labels in two UI components. |
| Harness | `HarnessId` | `SessionMeta.harness` | `HARNESS_ORDER`/`HARNESS_SORT` (`types.ts:196-203`) | Everywhere; selector shown only when `AppData.harnesses.length > 1` | Single source of truth — never hardcode a harness array (CLAUDE.md rule, enforced structurally via `Record<HarnessId,...>`) |

### 1.8 Dates / daily / hour-of-day

| Metric | Meaning | Source | Rule | Surfaces |
|---|---|---|---|---|
| Day bucket (aggregate/billing) | UTC day a session/turn belongs to | `start_time.slice(0,10)` | `tagSessionDay`, `session-profile.ts:50-54` `dayMs()`, `billing.ts` day arithmetic, `sessionDaySlice.ts` | Billing, tags, session-profile, all date-range filters |
| Day bucket (session-gap streak) | LOCAL-clock day | `format(parseISO(start_time))` | The SECOND, deliberately different day rule in this repo (docs/metrics.md §"The day rule is UTC") | Session-gap count only — a documented, intentional exception |
| `SessionMeta.daily[day]` | Per-day 4-counter + messages + hours split | written per turn during JSONL parse | `sliceSession()` (`sessionDaySlice.ts:100-115`) | Date-filtered KPIs; `null` fallback = whole session filed on start day |
| `SessionDayUsage.hours` | Hour-of-LOCAL-clock → message count, per day | same parser, same line as `message_hours` push | `expandHours()`/rebuild (per CLAUDE.md "THE HOUR CHART IS CUT THE SAME WAY") | "Usage by hour" chart under a date filter |
| `message_hours` | Lifetime hour-of-day array, no day | jsonl.ts | direct read when unfiltered | Usage-by-hour chart (unfiltered), ComparePage peakHour |
| Day-of-week | `dowCounts[7]` | derived from session timestamps | `computeHarnessSummaries` | ComparePage "busiest day of week" |

### 1.9 Context gauge, compaction, skills

| Metric | Meaning | Source | Gate | Surfaces |
|---|---|---|---|---|
| `context_tokens` | Context window fill on LAST turn — a GAUGE, never summed | per-harness: claude last `message.usage` input-side; codex `last_token_usage.input_tokens`; kimi last per-turn `usage.record` (main agent only, by timestamp); antigravity protobuf `1.9.10.1` | `HARNESS_CAPABILITIES.contextWindow` — claude/codex/kimi/antigravity `true`; gemini/copilot `false` | Session card context bar |
| `context_window` | The window size, when the harness STATES it | codex `model_context_window`; antigravity protobuf `1.9.10.4` | outranks table lookup | same bar |
| Context window (table) | `resolveContextWindow(model)` | `packages/core/src/contextWindows.ts:73-85`, `CONTEXT_WINDOWS` table (`:51-61`, Anthropic models only, dated+sourced) | absent model ⇒ no bar drawn (never guessed) | same |
| `contextFraction` | `used/window`, unclamped | `contextWindows.ts:88-96` | `null` when either half missing; bar SATURATES past 100% but label still says the true % | same |
| `compact_count`/`compact_ms`/`compact_dropped_tokens` | Compaction cost | `compact_boundary` system line (`compactMetadata`) | `HARNESS_CAPABILITIES.compaction` — **claude only** | `session-profile.ts` `compacts` reader; session drawer |
| `skill_uses: Record<name,count>` | Skill invocations by name | `Skill` tool_use `input.skill` | `HARNESS_CAPABILITIES.skills` — **claude only** | `session-profile.ts` `skills` reader; ToolsPage/skills panel |

### 1.10 Cache hit rate, budget, health, workflow runs

| Metric | Formula | Source | Surfaces |
|---|---|---|---|
| Cache hit rate | `cacheRead / readTokens()` = `cacheRead/(input+cacheRead+cacheWrite)` | `tokens.ts:107` `readTokens()` | CacheHitRatePanel — hard-wired to API basis always (cache doesn't reduce a subscription bill) |
| Net cache savings | `cacheRead×(inputPrice−cacheReadPrice) − cacheWrite×(cacheWritePrice−inputPrice)` | docs/metrics.md §"Cache efficiency" | same panel |
| Budget / forecast | Variable spend pace vs. a monthly target | filtered `totalCostUSD` over elapsed days | `BudgetPanel` — keeps VARIABLE tracking in API basis; shows `monthlyCommitment()` (a different question) beside it in plan basis | CostsPage |
| Health checks | Stale cache / tool-error clustering / etc. | `runHealthChecks`, `analyzeToolHealthIssues` (`packages/server/server/health.ts:194`), `analyzeCacheStaleness` (`:156`) | `HealthIssue[]` | Warnings icon (header/mobile "More" sheet) |
| Workflow run totals | `WorkflowRun.totals` (agentCount, tokensIn/Out, cacheRead/Write, costUSD, durationMs, toolUses) | run + agent transcripts, `agent-<hash>.jsonl` | `workflow-metrics.ts` (server root) | RepoDetailPage "Dynamic Workflows" tab; `dynamicWorkflows` capability — claude only |
| `workflowTokens()` | 4-part sum for a run/agent | `packages/core/src/types.ts:447-450` | same rule as `tokens.ts` applied to workflow totals — `cacheRead`/`cacheWrite` optional (older docs predate them) | same |
| `WorkflowAgent.labelSource` | Provenance of an agent's label/phase | `types.ts:420-424` | `'record'` (exact, from `workflowProgress`) / `'matched'` (prompt-fingerprint pairing, `workflow-match.ts`) / `'none'` (file name only) | shown on the timeline so a guessed label is visibly distinct from a recorded one |

**Browser activity**: no metric of this kind exists anywhere in the inventory. There is no
"time in browser", "tab count" or web-activity tracking. The closest concepts are
`uses_web_search`/`uses_web_fetch` (booleans on `SessionMeta`, `types.ts:313-314`) — whether the
harness's own web-search/web-fetch TOOL was invoked, not anything about a browser session.

---

## 2. Filters — verbatim type, dimensions, and session-side vs statsCache-side application

### 2.1 `Filters` type, verbatim (`packages/core/src/types.ts:794-808`)

```ts
export interface Filters {
  dateRange: DateRange
  customStart: string
  customEnd: string
  projects: string[]   // empty = all projects
  repos?: string[]     // empty/undefined = all repos; [''] targets the "no linked repo" bucket
  users?: string[]     // empty/undefined = all users (member = user; scoped to users with machines)
  teams?: string[]     // central: empty/undefined = all teams; matches session.teamId
  machines?: string[]  // central: empty/undefined = all machines; matches session.memberId (token hash)
  tags?: string[]      // central: empty/undefined = all; a tag narrows to its resolved sessions (tag ids)
  models: string[]     // empty = all models
  harness?: HarnessId
  harnesses?: HarnessId[]  // multi-select harness filter; empty/undefined = all harnesses
  presence?: 'online' | 'offline'  // team/central: filter members by live status; undefined = policy default
}
```

No `provider`, `repo` (singular — it's `repos`), `task`, or `run` field exists on `Filters`. Tag filtering
is entirely separate (`Filters.tags` narrows by resolved tag-session-set intersection, not a tag-native
query engine).

### 2.2 `FiltersBar` dimensions (`packages/web/src/components/FiltersBar.tsx:70`)

```ts
only?: Array<'members' | 'teams' | 'machines' | 'harnesses' | 'presence' | 'repos' | 'tags' | 'projects' | 'models' | 'activeOnly'>
```

Ten dimensions the "+ Filtro" menu can offer (a page passes `only` to restrict which of them apply —
"a filter that visibly changes nothing reads as broken", `FiltersBar.tsx:68-69`). `activeOnly` is
explicitly NOT part of `Filters` (`FiltersBar.tsx:14-22`) — it is the fleet's own "keep only what is
running" toggle, passed in by the caller and dropped outside the Sessions workspace.

### 2.3 Provider as a filter dimension — does NOT exist

`resolveProvider()` (`packages/core/src/providers.ts:62`) is used in exactly two places, both UI
grouping/sort, never filtering:
- `packages/web/src/components/ModelBreakdown.tsx` — lines 5 (import), 55 (search-by-provider-label),
  70-71 (sort rank), 210-211 (group heading insertion)
- `packages/web/src/pages/settings/PricingSettings.tsx` — line 5 (import), 190 (`provider: resolveProvider(model)`)

Neither `Filters` nor `FiltersBar`'s `only` array has a `provider` entry. A user cannot filter the
dashboard, Compare page, or any export by "OpenAI models only" — only by explicit model id or by harness
(which correlates but is not the same axis: Antigravity alone spans both Google and Anthropic models).

### 2.4 How each filter is applied — session-side vs statsCache-side

The controlling logic lives in `useDerivedStats` (`packages/web/src/hooks/useData.ts`). The central
decision is the `cacheBlindScope` flag (`useData.ts:1505-1511`):

```ts
const cacheBlindScope: boolean = projectFiltered || repoFiltered || tagFiltered || modelSet !== null
  || ((teamsFiltered || machinesFiltered) && !machineCacheScoped)
  || (userFiltered && !userCacheUsable)
  || activeOnly
```

- **`stats-cache.json` has NO granularity for**: project, repo, tag, model, or a live-fleet
  intersection (`activeOnly`) — any of those filters forces `cacheBlindScope = true`, which routes
  totals through `filteredSessions` (a pure per-session sum) instead of the cache
  (`useData.ts:1518,1521,1553,1641-1642,1802,1958`).
- **Harness filter**: a selection of EXACTLY `['claude']` is explicitly **NOT** cache-blind
  (`useData.ts:1540-1553`, `claudeOnlyHarness`/`harnessesFiltered`) — `stats-cache.json` IS Claude's own
  history, so that one selection is served by it (comment: treating it as session-only "made the SAME
  scope report a different number with the chip set than without it", measured as a 1.2% drop in A). A
  MIXED harness selection (e.g. `['claude','codex']`) DOES fall back to session-side sums, because the
  cache cannot represent the non-Claude half.
- **Team/machine filter**: only cache-blind when `resolveMachineCacheScope()`
  (`packages/core/src/team.ts:510-539`) returns `null` — i.e. when the per-machine caches
  (`AppData.machineStatsCaches`) cannot serve the exact scope (unknown machine, missing cache, or a
  team/user selection that doesn't resolve to a positive machine set). When it CAN resolve, the merged
  per-machine caches ARE the deep history for that scope and are used directly.
- **User filter**: cache-blind unless `userCacheUsable` — `AppData.userStatsCaches` (keyed by display
  name) already sums a member's machines, so a single-member selection is normally cache-backed; it
  falls back to sessions only when this viewer's pruned copy is missing that member's cache.
- **Date filter**: NEVER makes the scope cache-blind by itself — `stats-cache.json.dailyActivity`/
  `dailyModelTokens` ARE date-granular for Claude. Non-Claude sessions in range are added via
  `nonClaudeInRange` (session-side) regardless.
- **`activeOnly` (fleet intersection)**: ALWAYS cache-blind — "a live-fleet intersection has no cache
  granularity of any kind: stats-cache.json is keyed by day and model, never by conversation"
  (`useData.ts:1508-1511`).

### 2.5 `sessionDaySlice.ts` — how a date range narrows one session (recap with citations)

- `dayKey()` (`sessionDaySlice.ts:66-68`): `iso.slice(0,10)`.
- `MAX_RANGE_DAYS = 400` (`:76`); `daysBetween()` (`:80-88`) stops there rather than refusing, because
  a set at exactly the cap is otherwise indistinguishable from a complete range.
- `sliceSession()` (`:100-115`): returns `null` when the session carries no `daily` (caller must then
  apply the whole-session-on-start-day fallback, never treat it as zero); otherwise sums the 4 counters
  + messages + hours over the requested day set.
- Past `MAX_RANGE_DAYS`, callers must use `activeInWindow` (the session's OWN days) instead of building
  a day-Set — the historical bug this replaced put `all`'s window at `1970-01-01…1971-02-04` (epoch
  start), which every `daily`-carrying session failed to match, silently dropping 397/662 sessions.

### 2.6 `resolveMachineCacheScope` and `cacheBlindScope` (core)

- `resolveMachineCacheScope()` — `packages/core/src/team.ts:510-539`. Pure. Takes
  `{machineOwners, machineStatsCaches, users, teams, machines, allowedUsers}` and returns either the
  exact set of `machineStatsCaches` keys whose merge reproduces the scope, or `null` ("fall back to
  per-session sum" — precision may only be ADDED, never invented; every failure mode — unknown machine,
  missing cache, empty resolved set — returns `null` rather than a confident partial answer).
- `cacheBlindScope` (note: **NOT a core export** — despite CLAUDE.md's prose naming it as if it were a
  standalone function, it is a local `const` computed inline inside `useDerivedStats`,
  `packages/web/src/hooks/useData.ts:1505`). There is no `cacheBlindScope()` function in
  `packages/core/src/*.ts` — confirmed by grep; the concept exists only as this one boolean expression
  in the web hook. (Server-side, `data.ts:1122` has a one-line comment referencing "cacheBlindScope
  exists to prevent" but does not reimplement it — the server never needs the split because it computes
  authoritative per-session values, not a UI-facing blended KPI.)

---

## 3. `stats-cache.json` mixing — where each surface draws the line

Every one of the following independently re-derives "is this scope cache-representable", and the
answers are consistent but not literally shared code:

| Surface | Rule |
|---|---|
| `useDerivedStats` (web) | `cacheBlindScope` boolean, §2.4 above |
| `computeHarnessSummaries`/`computeFilteredHarnessSummaries` (web, Compare page) | Unfiltered ⇒ statsCache-canonical Claude totals; ANY filter active ⇒ every harness (Claude included) summarized from the filtered per-session slice, "since statsCache has no per-user/-harness/-date/-project granularity" (`useData.ts:971-978`) |
| `selectors.ts` (TUI) | `claudeTotals()` reads ONLY the cache (`selectors.ts:96-108`) except `agents` (no agent data in the cache, counted from whatever session files still exist); `sessionTotals()` for every non-Claude harness (`:111-119`); `harnessRows()` composes both (`:126-131`) |
| `otel-watcher.ts` | Top-level snapshot (`totalMessages`, `totalSessions`, `totalCostUsd`, `modelTokens`) comes from `stats-cache.json` alone (`buildSnapshot`, `:163-192`) — **this is Claude-only by construction**, even though the function's docstring calls it simply "the snapshot". Non-Claude harnesses are exported SEPARATELY via `harnessSnapshots[]` (`buildHarnessSnapshots`, `:97-142`), each computed by summing the consolidate store's own `~/.agentistics/sessions/<harness>/*.json` files. `totalGitCommits`/`totalLinesAdded`/`totalFilesModified`/`totalToolCalls`/`toolCounts` are summed from `SESSION_META_DIR` (`~/.claude/usage-data/session-meta`, confirmed Claude-only path — `packages/server/server/config.ts:15`), so these particular OTel gauges structurally EXCLUDE every non-Claude harness's git/file/tool activity. **This is a real, unremarked gap**: an OTel dashboard watching `claude_stats.git.commits` never sees a Codex or Copilot commit. |
| `tags-aggregate.ts` / `tags-detail.ts` | Always per-session, explicitly documented as never reading `stats-cache.json` ("Tag math runs server-side against the unscoped session set, per-session (never from stats-cache.json)" — CLAUDE.md) |
| `task-rollup.ts` / `task-stats.ts` | Always per-session (`SessionMeta`), never the cache — a task's sessions are looked up individually by conversation link |
| `billing.ts` (plan basis) | `A` (API-equivalent cost) for the covered days is computed the same way the rest of the product does — cache-backed for Claude, session-backed otherwise, inheriting `useDerivedStats`'s split (billing does not re-derive its own scope rule; it consumes `filters` the same way) |
| MCP `agentistics_summary`/`agentistics_costs` | **Does NOT follow the pattern** — see §5 "gap" below: it primes from `data.sessions` unconditionally (even for the unified/`claude` scope) and only falls back to a `sc.allTimeTotals` read when the per-session sum is exactly zero |

---

## 4. Provenance / estimation fields already in the codebase

The product already has a rich vocabulary for "how sure are we of this number" — none of it is
`Filters`- or `Provider`-shaped, but it directly answers the brief's ask for existing provenance:

| Field | Location | Meaning |
|---|---|---|
| `SessionMeta._source: 'meta'|'jsonl'|'subdir'` | `types.ts:349` | `'meta'` = most complete (from `usage-data/session-meta`); `'jsonl'`/`'subdir'` = fallback, no git line counts, no cache tokens, and — critically — `'jsonl'` is what `session-profile.ts`'s `transcriptRead()` (`:87-89`) uses to gate the `subagents` metric's denominator |
| `AgentInvocation.unmeasured?: true` | `types.ts` (~ near `AgentInvocation`) | Numbers could not be established (interrupted call, missing transcript) — MUST be read before any figure on the record, since zeros are only there because the type has no other value |
| `SessionAgentMetrics.unmeasuredInvocations` | same | Count of unmeasured rows, so a total can state it covers fewer invocations than shown |
| `RollupSession.costMeasured?: boolean` | `packages/server/server/sessions/task-rollup.ts:38` | `true` = the harness's OWN figure; absent/`false` = `calcCost()` estimate. `AttemptRollup.costMeasuredSessions`/`costEstimatedSessions` (`:54-55`) split the count |
| `RollupSession.credits?: SessionCredits` | `task-rollup.ts:24-27,40` | Copilot-only nano-AIU/premium-request credits, NEVER converted to or summed with dollars; `AttemptRollup.mixedCurrency` (`:58,104`) flags when an attempt mixes the two currencies |
| `WorkflowAgent.labelSource: 'record'|'matched'|'none'` | `types.ts:420-424` | Whether an agent's label/phase is the run's own record (exact), a prompt-fingerprint match (`workflow-match.ts`, heuristic), or unresolved (file name only) |
| Model pricing `origin: 'official'|'community'|'builtin'` | `rates.ts` (per CLAUDE.md §"Pricing — three layered sources") | Surfaced per row in Settings → Pricing |
| `dailyModelTokens` in/out split | `StatsCache.dailyModelTokens` (`types.ts` DailyModelTokens interface) | **Explicitly an approximation**: "input/output split uses global statsCache proportions as an approximation when filtering by date" (CLAUDE.md bullet list) — the daily series stores only a combined total, so a per-day-per-model split is apportioned by the GLOBAL ratio, not measured |
| `apiCostByDay.undatedCostUSD` | billing.ts (per CLAUDE.md) | Real spend with no day attribution — Claude's cumulative `modelUsage` total minus what the daily series can account for; reported as its own residue, never folded silently into a day |
| `HarnessCapabilities` (structural) | `types.ts:99-193` | The master provenance gate for every metric — see §1 tables' "Gate" column throughout |

**Estimated/inferred, not measured — the full list found:**
1. `dailyModelTokens` input/output split (approximation via global proportions).
2. `blendedCostPerToken` / `blendedSessionCost` — used whenever a session has no per-session model
   (project/model filter active without per-session model data).
3. `calcCost()` itself is always an ESTIMATE (`docs/metrics.md` header: "Every cost in this product is an
   API-equivalent estimate") — never the vendor's actual bill.
4. Plan-basis `V`/allocations are explicitly labelled "allocated" (a linear rescale), never a
   measurement.
5. `taskStats`/`task-rollup` costs inherit `sessionCostUSD()`'s estimate unless `costMeasured` is set.
6. `WorkflowAgent.labelSource === 'matched'` labels are a heuristic (longest verbatim prompt match),
   deliberately conservative (a tie or no match yields the file name, never a guessed label).
7. Antigravity's `gitLines` capability is `false` specifically because `lines_removed` cannot be
   measured at all from the transcript (structural, not statistical, estimation gap).
8. `getModelPrice()`'s prefix-matching fallback (`types.ts:927-947`) — an unrecognized model id resolves
   to the nearest prefix match or the Sonnet-class fallback ($3/$15), which is a real but UNCITED price
   for that specific model.

---

## 5. Gaps found against a future canonical model

1. **No Provider filter dimension.** `resolveProvider()` exists and is used for grouping/labels in
   exactly two components (`ModelBreakdown.tsx`, `PricingSettings.tsx`); `Filters` has no `provider`
   field and `FiltersBar`'s `only` array has no `'provider'` entry. A user cannot answer "how much did
   I spend on OpenAI vs. Anthropic models across harnesses" without manually reading the per-model
   breakdown and mentally regrouping.

2. **No Run entity.** There is no first-class "one model call" or "one turn" record with its own id
   outside of a session's aggregate counters — the closest things are `AgentInvocation` (one subagent
   launch) and `WorkflowAgent` (one agent within an orchestrated run), both scoped to Claude-only
   features. A canonical model wanting per-turn granularity across harnesses would need a new entity;
   today the finest grain that survives storage is the session (plus, for Claude, `SessionMeta.daily`
   at day resolution — no per-turn persistence beyond the live transcript).

3. **No per-model-invocation latency, anywhere.** Confirmed absent from `SessionMeta`, `TurnEvent`
   (`activeTime.ts`), `AgentInvocation`, and `WorkflowAgent`. The active-time machinery
   (`computeActiveTime`) measures a TURN's wall time (human prompt → harness stop), which can bundle
   multiple model calls (tool round-trips) — there is no way to isolate a single LLM API call's latency.

4. **No tool-call durations.** `tool_counts` is a pure count; `tool_output_tokens` attributes OUTPUT
   TOKENS (not time) to tools via the fair-split formula. Nothing times how long any individual
   `tool_use` took to execute (a shell command, an MCP call, a file read). `AgentInvocation.toolStats`
   counts categories (read/search/bash/editFile/other) but never durations.

5. **No browser activity metric.** Confirmed by inspection: no field, adapter, or UI surface tracks
   time-in-browser, tab counts, or any browser-session concept. `uses_web_search`/`uses_web_fetch` are
   booleans about the harness's own web-search/web-fetch TOOL, not a browser.

6. **No Task→Run attribution finer than "sessions filed under this task/subtask".** `task-rollup.ts`
   and `task-stats.ts` both operate at the session granularity (`RollupSession`, `SessionMeta` via
   conversation link) — there is no sub-session attribution (e.g. "which turns of this session were
   spent on subtask A vs. subtask B" when a session serves more than one piece of work). The design is
   explicit that a session may file directly on a task, under a subtask, or both ("hybrid"), but the
   COST/TOKEN numbers for a hybrid session are not split between the two — the whole session's rollup
   counts once, wherever the ROW is filed.

7. **OTel token/git/tool metrics are silently Claude-scoped at the top level.** `claude_stats.tokens.*`,
   `claude_stats.git.*`, `claude_stats.tool_calls.*`, and `claude_stats.cost.usd` (the aggregate, not
   the per-harness series) are built from `stats-cache.json` + `~/.claude/usage-data/session-meta`
   (`otel-watcher.ts:146-232`, `config.ts:15`). Only `claude_stats.tokens.by_model.*` (via
   `harnessSnapshots`, exported with a harness attribute) sees non-Claude data, and only for
   tokens/cost/sessions — never git/tool/file metrics per harness. A user relying purely on the
   top-level OTel gauges (the ones without a `harness` label) is looking at Claude Code's numbers only,
   with no sentence anywhere in the exported metric names saying so.

8. **MCP server's `agentistics_summary`/`agentistics_costs` deviate from the "cache is Claude's
   authority" rule.** `packages/mcp/agentistics-mcp.ts:748-778` computes `totalInput`/`totalOutput`/etc.
   by summing `data.sessions` (filtered by harness, including the unified/`'claude'` case) and only
   falls back to `sc.allTimeTotals` (`data.statsCache.allTimeTotals`) when that per-session sum is
   falsy. Two problems: (a) this inverts the rest of the product's rule that Claude's DEEP history lives
   in the cache and individual session files are pruned after 30 days — an MCP query about Claude's
   all-time tokens will under-report once old sessions have been cleaned up, recovering only via the
   zero-fallback; (b) `StatsCache` (`types.ts:30-42`) has **no `allTimeTotals` field at all** — the
   fallback reads `sc.allTimeTotals ?? {}`, which is always `{}` given the actual `StatsCache` shape, so
   the "fallback" branch is dead code that always resolves to `?? 0`. This looks like a genuine,
   unnoticed bug/staleness in the MCP tool rather than an intentional simplification.

9. **MCP's harness enum is missing `kimi`.** `packages/mcp/agentistics-mcp.ts:22`:
   `const HARNESS_IDS = ["claude", "codex", "gemini", "copilot", "antigravity"] as const;` — `kimi` is
   a full `HarnessId` in `@agentistics/core` (`types.ts:47`) with real token/cost/tool capabilities, but
   every MCP tool's `harness` parameter enum (`HARNESS_PARAM`, `:22-28`) cannot select it, and the
   `agentistics_harnesses` comparison tool's description text also omits it. An assistant using the MCP
   surface cannot scope a query to Kimi Code sessions at all.

10. **`cacheBlindScope` is not a shared/exported rule.** It is reimplemented as an inline boolean once
    in `useData.ts` (§2.6) and informally referenced (never re-derived) elsewhere. A future canonical
    model would want this promoted to a pure, tested `@agentistics/core` function so TUI, MCP, and any
    new consumer share exactly one definition of "can this scope be answered from the cache" — today
    each of `selectors.ts`, `otel-watcher.ts`, and `useData.ts` independently encodes a version of the
    same judgment call, and (per finding 8) at least one of those independent encodings has drifted.

11. **No explicit "coverage" field on aggregate types for the Claude/non-Claude mixing itself.** Unlike
    `HARNESS_CAPABILITIES` (per-metric) or `costMeasured`/`unmeasured` (per-row), there is no field on
    `HarnessSummary`, `RepoStat`, or `TagAggregate` stating "this total is cache-backed" vs.
    "session-backed" — the distinction is entirely implicit in which code path ran. A UI wanting to show
    "based on N sessions still on disk (older activity summarized separately)" has no field to read; it
    would have to be threaded through as a new boolean, mirroring `cacheBlindScope`'s logic a fourth
    time.

---

## Key files referenced (absolute paths)

- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/CLAUDE.md`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/docs/metrics.md`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/docs/harness-contract.md`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/core/src/types.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/core/src/tokens.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/core/src/billing.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/core/src/session-profile.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/core/src/contextWindows.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/core/src/providers.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/core/src/otel.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/core/src/activeTime.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/core/src/team.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/web/src/hooks/useData.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/web/src/lib/sessionDaySlice.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/web/src/components/FiltersBar.tsx`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/web/src/components/ModelBreakdown.tsx`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/web/src/pages/settings/PricingSettings.tsx`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/tui/src/selectors.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/vscode/src/today.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/vscode/src/status-bar.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/otel-watcher.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/config.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/health.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/agent-metrics.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/subagent-join.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/subagent-parse.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/tags-aggregate.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/tags-detail.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/tags-resolve.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/sessions/task-rollup.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/sessions/task-stats.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/workflow-metrics.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/workflow-agent.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/server/server/workflow-match.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/mcp/agentistics-mcp.ts`
- `/home/mithrandir/agentistics/.claude/worktrees/runtime-spec/packages/mcp/session-tokens.ts`
