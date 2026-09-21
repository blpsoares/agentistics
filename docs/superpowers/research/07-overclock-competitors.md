# Competitive research: overclock.sh and adjacent products
Research date: 2026-09-19. All findings from public web sources; anything not directly confirmed on
a primary source is marked **UNVERIFIED**.

---

## 1. What overclock.sh actually is

- **Product**: "Overclock" — self-described as an **ADE (Agentic Development Environment)**: "the
  environment where AI agents, coordinated by a maestro, ship software in parallel, in visible
  panes." Tagline: "ADE for vibe coding with AI agents in 2026."
  Source: https://overclock.sh/en (fetched 2026-09-19)
- **Positioning**: not an analytics/observability tool first — it is a **multi-agent orchestration
  cockpit / IDE-adjacent desktop app** that runs several coding-agent CLIs (Claude Code, Codex,
  Gemini, Antigravity, OpenRouter, local models) side by side in "panes," coordinated by a
  "maestro" that splits a request, tracks each agent, and merges results. Cost/token visibility is
  a *feature inside* that cockpit, not the product's core value proposition — this is a
  differentiator vs. Agentistics, whose core is measurement/analytics + session management.
- **Company / founder**: Site footer credits "by Laschuk"; no legal entity, funding, or
  incorporation info found. Locale defaults to Portuguese (site content, course material, a
  "Jornada — Vibe Coding Até R$1.000.000" livestream/campaign) strongly suggest a **Brazil-based
  indie/bootstrapped product**, not a funded startup. **UNVERIFIED**: no evidence of VC funding,
  team size, or company registration was found anywhere in search results.
  Source: https://overclock.sh/en/course/fundamentos/instalar-os-assistentes-antes-de-abrir-o-overclock
  (fetched 2026-09-19), footer "v1.1.0 · construído ao vivo · 2026"
- **Launch date**: no explicit launch date found. Product versioning seen: app v1.3.18, website
  v1.1.0, testimonials dated 2026-05 through 2026-07 — suggests active in H1 2026, likely launched
  earlier that year or in 2025. **UNVERIFIED** exact date.
- **Pricing** (USD/month, from https://overclock.sh/en, fetched 2026-09-19):
  - **Boost** — $19/mo: multi-pane basics
  - **Pro** — $39/mo: Squads, Recipes, ClockVoice (push-to-talk)
  - **Ultra** — $79/mo: Jarvis (full voice control), Harness (token-optimization/auto-harness
    building), Redline (rate-limit monitor), Shot (screenshot/recording tools), full autonomy
  - 7-day money-back guarantee. No free tier found.
- **Open source**: **No.** Proprietary desktop app + cloud account; no GitHub repo found for
  overclock.sh itself (unlike its "OverClick" cousin product, see below, which is FOSS).
- **Self-hosted or cloud**: Hybrid — a **native desktop app** (Mac/Windows/Linux) that connects to
  CLIs the user installs and authenticates locally (bring-your-own Claude Code/Codex/Gemini
  login/subscription), but requires an Overclock **account/subscription** to unlock features — so
  it is not a pure self-hosted or pure cloud tool; more like a licensed desktop client with a
  companion cloud account.
- **Target user**: explicitly "builders who ship" — solo indie developers, no-code founders,
  freelancers/agencies, and small teams doing "vibe coding." Testimonials cited: legal-tech
  founders, SaaS builders, a video editor moving into coding, hobbyists reaching production. No
  enterprise-tier language, no SSO/compliance claims found — **not** positioned at enterprise, in
  contrast to Agentistics' team-mode/central-aggregator model.

## 2. Feature inventory

From https://overclock.sh/en/features ("16 surfaces, 52 MCP tools, 11 areas") and the homepage,
fetched 2026-09-19:

- **What it measures**: real-time **token usage and cost per agent/pane**; session persistence
  across disconnects; "agent accountability" inside a squad (who did what). No evidence of
  per-tool breakdowns, per-model context-window gauges, git line/commit stats, or historical
  trend dashboards comparable to Agentistics' `stats-cache`/session-meta model. The cost/token
  view reads as a **live, in-session** monitor (what's running right now and what it costs), not
  a **historical analytics** product (no evidence of a "last 30 days" dashboard, cost-by-project
  trend charts, or a task/ALM board tied to session cost).
- **Harnesses/CLIs supported**: Claude Code, Codex, Gemini, Antigravity, OpenRouter-routed models,
  local models (Ollama/LM Studio implied by "local models" mention), and "any other agent CLI" per
  marketing copy. This is a comparable breadth to Agentistics' six harnesses, but the emphasis is
  running/orchestrating them, not deeply parsing their transcript formats.
  Explicit model names claimed on the homepage: "Claude Code (Fable 5, Opus 4.8, Sonnet), Codex
  (GPT-5.x, Codex Spark), Gemini (3.x)."
- **Session management / spawning**: **Yes** — this is a core feature. It spawns and manages
  terminal-hosted CLI sessions in "panes" within its own workspace (terminal + editor + browser +
  file viewer), broadly analogous to Agentistics' tmux-hosted session manager and cockpit, but
  built as a first-party GUI app rather than a CLI/TUI/tmux layer with a web dashboard bolted on.
- **Agent runtime of its own**: **No dedicated first-party model/runtime found.** It explicitly
  routes to the user's own CLI subscriptions/API keys ("no extra model cost beyond the
  subscriptions you already have"); the "maestro" is an orchestration layer over external CLIs,
  not a new inference runtime. No evidence contradicts this.
- **Multi-agent orchestration**: Yes, and it's the flagship feature — "Squads" (pre-configured
  agent teams per outcome type: e.g., "SaaS 10K" = 12+ panes for a full-stack app with
  auth/billing "auditor" agents), "Recipes" (agent+model+effort templates), a maestro that
  delegates/merges work, and "Missions" with three modes (Free / Squad / Agentic). This is a much
  richer multi-agent **workflow/fan-out** feature set than anything currently in Agentistics.
- **Dashboards**: A "cockpit" web/desktop view showing live pane status, per-agent cost, and
  mission/delivery tracking. No mention of a separate analytics-only dashboard, PDF export, cost
  trend charts, or historical reporting comparable to Agentistics' web dashboard.
- **Team/org features**: "OverMemory" (shared memory across agents/sessions — "one agent records,
  everyone remembers"); "SquadPRO" for coordinated multi-agent work. No evidence of an
  Agentistics-style central aggregator, member/central roles, per-connection sharing rules, or
  role-based account/team administration. Team support looks shallow compared to Agentistics.
- **Integrations**: No explicit GitHub, Slack, or VS Code integration found in the fetched pages.
  A "Marketplace" offers one-click skill installs ("zero YAML, zero CLI config") but no named
  third-party integrations were surfaced. **UNVERIFIED** whether GitHub/Slack integrations exist
  elsewhere in the product (e.g. behind login).
- **CLI/TUI/web/mobile surfaces**: A `overclock .` CLI entry point is mentioned; primary surface is
  the native desktop app (Mac/Windows/Linux); a web "cockpit" is referenced. No mobile app or
  mobile-web surface found — this is a gap relative to Agentistics' VS Code extension + planned
  mobile-friendly web dashboard.
- **Voice control**: A distinctive feature not present in Agentistics — "ClockVoice" (push-to-talk
  on Pro) and "Jarvis" (full voice-operated cockpit control on Ultra), plus cross-language
  (Portuguese→English) voice input.

## 3. How it captures data

- **No evidence of reading local session/transcript files** the way Agentistics parses
  `~/.claude/projects/**/*.jsonl` etc. Overclock instead **spawns and directly controls** the CLI
  processes itself (it manages the panes), so it very plausibly gets token/cost data by parsing
  each CLI's own live stdout/stream or its own local session files as they run — this is
  **UNVERIFIED** at the mechanism level (no docs page on this was found); the site simply shows
  a live token/cost readout per pane without explaining the plumbing.
- **No hooks, OTel, or install-time system hooks documented.** The one installation walkthrough
  found (Portuguese "Lesson 1.5" course page) shows Overclock does **not** install the assistants
  itself — it tells the user to run each vendor's own official installer (e.g.
  `curl -fsSL https://claude.ai/install.sh | bash`) beforehand, and each CLI keeps its own
  separate authentication. No mention of Overclock installing Claude Code hooks, a
  SessionStart/Stop hook, or an OpenTelemetry exporter.
  Source: https://overclock.sh/en/course/fundamentos/instalar-os-assistentes-antes-de-abrir-o-overclock
  (fetched 2026-09-19)
- **No gateway/proxy/router in front of provider APIs found.** Marketing explicitly claims "no
  extra model cost beyond the subscriptions you already have" and that agents "run on the
  subscriptions and tokens you already pay for" — i.e., it is **not** positioned as an LLM
  gateway/proxy like LiteLLM/Helicone/Portkey. It is bring-your-own-CLI, not bring-your-own-API-key
  routed through a middle-man proxy. **UNVERIFIED** whether any local proxy is used internally for
  the "Harness" token-optimization feature (Ultra tier) — plausible but undocumented.
- **API keys**: Users authenticate with their existing CLI logins/subscriptions (Claude Pro/Max,
  ChatGPT/Codex, Google/Antigravity) rather than handing Overclock a raw API key for billing
  purposes, based on available copy. **UNVERIFIED** whether OpenRouter/local-model panes require
  the user to paste an API key directly into Overclock (likely, since OpenRouter has no "CLI
  login" concept, but not confirmed by a fetched page).
- **No browser extension** found or mentioned anywhere.

## 4. Accuracy / cost-attribution claims and data model

- Marketing claims are experiential, not methodological: "every delivery, every cost, in real
  time," "you don't burn expensive model tokens on mechanical work" (re: the Harness feature
  routing cheap/mechanical steps away from expensive models). No public page was found describing
  a data model (no equivalent of Agentistics' `SessionMeta`/task/ALM schema documentation), no
  claims about how tokens are deduplicated, no mention of provider pricing tables, cache-token
  handling, or context-window measurement — all things Agentistics documents in detail
  (`docs/harness-contract.md` equivalent). This suggests overclock.sh's cost figures are a much
  thinner, live-only readout rather than an audited historical ledger.
- No accuracy benchmarking, no public post-mortems, no "we found and fixed a cost bug" style
  transparency post (which Agentistics' own CLAUDE.md contains many of for its own metrics) were
  found for overclock.sh.

## 5. Memory / learning features

- **"OverMemory"** is the named feature: persistent, cross-session, cross-agent shared memory —
  tagline "one agent records, everyone remembers." This is presented as a context/continuity
  feature (so a squad of agents shares findings/decisions across a mission), not as personalization
  or learning about the *user's* coding patterns. No claims of learning the user's style,
  preferences, or long-term behavioral modeling were found — it's shared-context memory for the
  agent squad, not a personalization/ML feature. **UNVERIFIED** how OverMemory is implemented
  (vector store vs. plain file/context injection) — no technical documentation found.
- **"Overclock Redline"** (Ultra) is described as "full history included" plus rate-limit
  monitoring across providers (Claude, GPT, Grok, Kimi) in a system tray — this is usage-limit
  tracking, not memory/learning.

## 6. Agent orchestration / workflows / parallel agents

This is overclock.sh's strongest and most differentiated area relative to Agentistics:

- **Squads**: named, pre-built multi-agent team templates per outcome (e.g. "SaaS 10K" = full-stack
  app build with dedicated auth/billing "auditor" agents across 12+ panes; "Cinema Site," "Arcade,"
  "Autopilot," "App Factory").
- **Maestro**: a coordinating layer that splits a single user request across multiple specialized
  agent panes, tracks each, and merges results — explicit "fan-out then merge" orchestration.
- **Recipes**: reusable agent+model+effort-level templates, installable via a "Marketplace" with
  "zero YAML, zero CLI config."
- **Missions**: three modes — Free (manual), Squad (maestro-orchestrated team), Agentic (autonomous,
  Ultra tier) — plus "Autopilot" for scheduled/cron-triggered runs with failure alarms.
- No terminology like "swarm" or "fleet" was found on overclock.sh itself; Agentistics' own
  internal vocabulary ("fleet") is not mirrored there. Overclock's closest equivalent concept is
  "Squad."

## 7. Public reception

**No public discussion was found.** Targeted searches for overclock.sh on Reddit, Hacker News, and
X/Twitter (including Portuguese-language review/opinion searches) returned **zero relevant
results** — every hit was either about generic hardware "overclocking" or unrelated companies named
"Overclock." No HN Show/Launch post, no Reddit threads (r/ClaudeAI, r/LocalLLaMA, etc.), no visible
X/Twitter chatter, and no independent review site coverage beyond a thin, low-detail SaaS-directory
listing (find-my-saas.com, which returned HTTP 403 on fetch and could not be read directly) was
located. Traction signals on the product's own site (testimonials: "raised revenue by 60% in a
month," "AutoBlog launched with 45 paying users in its first week," "cleared a month of backlog in
5 days") are **self-reported marketing testimonials, not independently verified** — mark all
specific numeric claims as **UNVERIFIED**. No GitHub star count exists because the core product is
closed-source. Overall assessment: overclock.sh appears to be a **real, live, paid product with an
active Discord/course/livestream community focused on a Brazilian "vibe coding" audience**, but it
has **no discernible presence in the English-language developer-tool discourse** (HN/Reddit/X) as
of this research date — a small, self-marketed niche product rather than a broadly-known
competitor with organic traction.

## 8. Adjacent competitors

**vibe-kanban** (open source, https://vibekanban.com / github.com/BloopAI or community forks) —
a Kanban board specifically for planning and dispatching work to coding agents: plan work as
Kanban cards, spin up an agent "workspace" (git branch + terminal + dev server) per card, review
diffs inline, and switch between 10+ agent CLIs (Claude Code, Codex, Gemini CLI, GitHub Copilot,
etc.). Notably, **the original project is reportedly sunsetting and going community-maintained**,
with an active hard fork ("easy-vibe-kanban") adding "agentic workflows" — a visual flow-graph of
cooperating agent steps. Data capture: local, task/board-state-based, not a metrics/analytics tool.
**What Agentistics could learn**: vibe-kanban validates that a lightweight, agent-native Kanban
(vs. Agentistics' own more elaborate ALM/task board) is a real wanted pattern; the "workflow as a
visual graph of agent steps" idea in its fork is close to Agentistics' own Dynamic Workflow feature
and worth watching for UX ideas.

**Conductor (Melty Labs, conductor.build)** — a native macOS app for running many Claude Code (and
Codex) instances in parallel, each in an isolated git-worktree workspace with its own branch,
terminal and state; a dashboard shows what each agent is doing, and finished work is reviewed/diffed
and shipped as a PR from inside the app. It's free and bring-your-own-subscription (no proxy, no
API markup). Data capture: reads/controls the CLI processes it spawns directly; no historical
analytics layer described. **What Agentistics could learn**: Conductor's "one worktree per agent,
review-then-ship" workflow mirrors Agentistics' own "one worktree per session" rule in this repo's
CLAUDE.md — validates that pattern as an industry norm, and its at-a-glance "what's every agent
doing / where's it stuck" view is a simpler, more polished version of what Agentistics' cockpit
`sessions` tab aims for.

**Terragon Labs** — was a **cloud-based background-agent orchestrator** (Claude Code, Codex, Amp,
Gemini) running tasks in isolated remote sandboxes, auto-branching and auto-PR'ing work with
AI-generated commits. **Status: shut down**; source snapshotted as `terragon-labs/terragon-oss` on
GitHub (Jan 2026), explicitly unmaintained. Data capture: cloud-hosted, container-isolated, no
local-file reading (it never ran on the user's machine). **What Agentistics could learn**: its
death is itself a signal — a cloud-only, subscription-priced, remote-sandbox background-agent
product apparently could not sustain itself standalone; reinforces the case for Agentistics'
local-first, bring-your-own-CLI model as more durable, but also flags "background/remote agents
that auto-PR" as a category worth having an opinion on rather than ignoring.

**Sculptor (Imbue, imbue.com/sculptor)** — a free, **open-source (MIT)** desktop UI for running
multiple coding agents in parallel, each in its own **containerized sandbox** (not just a git
worktree) with its own branch/terminal/diff, explicitly marketed as safer than worktrees because
dependencies don't need reinstalling per agent and the host machine stays isolated. Works with any
model/harness; ships bundled workflow skills (spec-writing, mock generation, TDD bug-fixing). Data
capture: local, container-based; no analytics/metrics angle found. **What Agentistics could learn**:
the container-per-agent isolation argument (vs. git worktrees) is a legitimate durability critique
of the worktree-based model this repo also uses — worth at least documenting the tradeoff
consciously; also a proof point that "free + open source + harness-agnostic" is a viable
positioning in this exact space, unlike Agentistics' partially-commercial framing.

**ccusage** (open source, github.com/ccusage/ccusage, npm) — a CLI that reads Claude Code's own
local JSONL/session files (`~/.claude/projects/...`) and produces daily/weekly/monthly/session
cost and token reports, plus a live `blocks --live` dashboard for the rolling 5-hour usage window.
Zero UI beyond terminal output; single-harness (Claude Code only in its core, though ecosystem forks
add others). Data capture: **local-file parsing, identical philosophy to Agentistics' own approach**
but far narrower in scope (no session management, no multi-harness, no team mode, no ALM). **What
Agentistics could learn**: ccusage is proof that a "just read the local files, no telemetry, no
account" pitch resonates and is trusted enough to be widely forked/re-implemented (Claude Code Usage
Monitor, claude-code-dashboard, claude-code-monitor, agent-usage-monitor, Claude-Code-Agent-Monitor,
etc. — a whole cottage industry of near-identical local-file-reading dashboards exists); it also
validates that a five-hour-rolling-window "burn rate + prediction" framing (used by
Maciek-roboblog/Claude-Code-Usage-Monitor specifically) is something users actively want and that
Agentistics does not currently emphasize as a headline feature.

**Claude-Code-Usage-Monitor** (Maciek-roboblog, GitHub, open source) — a terminal-based
"Usage-Ops" companion: Rich-rendered live monitor, official statusline `rate_limits` integration,
machine-readable JSON export for scripting/hooks, provenance labels on figures, burn-rate
forecasting against Claude's 5-hour rolling session window, and an **opt-in local usage warehouse**.
Single-harness (Claude Code), local-file based, no dashboard/web surface. **What Agentistics could
learn**: the "provenance label on every figure" idea directly echoes Agentistics' own N/A-vs-0
discipline — good validation that this matters to users; the explicit privacy framing ("privacy-first
... opt-in local warehouse") is a positioning angle Agentistics could lean on more explicitly in its
own marketing, since it already behaves this way (archive consent gate) but doesn't foreground it
as a competitive claim.

**Langfuse** (open source, Apache-2.0, self-hostable) — an LLM/agent **observability platform**:
you instrument your own application code (via SDK/OTel) to emit traces, and Langfuse stores full
trace trees, run evals, and manage prompts; framework-agnostic, deep on prompt management and
multi-step agent trace debugging. Data capture: **SDK instrumentation / OpenTelemetry**, not local
file reading — the opposite approach from Agentistics (Agentistics has no instrumentation
requirement; Langfuse requires you to add tracing calls to *your own* LLM app code). **What
Agentistics could learn**: Langfuse's evals/prompt-management layer is a feature category
Agentistics has none of and is out of scope (Agentistics measures coding-assistant usage, not
prompt quality) — but Langfuse's OTel-native approach is architecturally close to Agentistics'
`otel-watcher.ts`/OTLP export path, suggesting OTel is becoming the lingua franca for this space and
Agentistics' investment there is well-placed.

**Helicone** (proxy-first, acquired by Mintlify in March 2026 per industry write-ups) — adopted by
pointing your LLM API base URL at Helicone's proxy; near-zero-code integration, strong per-user/
per-key cost attribution "the same afternoon," plus caching. Data capture: **HTTP proxy/gateway in
front of the provider API** — it sees every request/response. **What Agentistics could learn**: a
proxy approach gives exact, undisputable token/cost numbers (no reconstruction from JSONL needed)
at the cost of requiring the user to route traffic through a third party and trust it with request
content — a real architectural fork in the road that Agentistics has deliberately avoided (local-
file-only, no proxy, no interception) and should keep stating explicitly as a trust/privacy
differentiator, since Helicone's post-acquisition drop in independent observability rankings (cited
as "dropped to #7") suggests proxy-based vendors face real credibility/consolidation churn.

**LiteLLM** (open source, self-hostable) — primarily a **gateway/SDK**, not an observability tool:
unifies ~100 providers behind one API, adds routing/fallbacks/virtual keys/per-team budgets;
commonly paired with Langfuse for the observability half, since LiteLLM controls/routes while
Langfuse explains/scores. Data capture: **proxy/gateway**, same category as Helicone. **What
Agentistics could learn**: the LiteLLM+Langfuse pairing shows the market has settled into "gateway"
and "observability" as separable concerns; Agentistics currently conflates a bit of both (it's an
observability tool with some session-management/orchestration reaching into gateway-adjacent
territory) — worth being clear in positioning that Agentistics is the "read local files, no
gateway, no interception" observability path, distinct from and complementary to (not competing
directly with) the LiteLLM/Helicone gateway category.

---

## WHAT AGENTISTICS COULD LEARN

**(a) Features worth copying / considering**
1. **Live "what's every agent doing right now" cockpit polish** — overclock.sh's per-pane
   real-time cost/token readout and Conductor's "at a glance, what's every agent doing / where is
   it stuck" view are simpler and more visually immediate than a metrics dashboard; Agentistics'
   session cockpit already aims at this but could take UX cues from these purpose-built views.
2. **Named, pre-built multi-agent "squad" templates** (overclock's Squads/Recipes) — Agentistics'
   Dynamic Workflow tool is the equivalent primitive; packaging a few opinionated, ready-to-run
   templates (not just the raw script API) could lower the barrier the way overclock's Marketplace
   does.
3. **A rolling-window "burn rate + forecast"** (ccusage / Claude-Code-Usage-Monitor's 5-hour
   session-window burn rate and predictions) — Agentistics tracks lifetime/period cost well but has
   no forward-looking "you'll hit your limit at 3:40pm" style forecast; this is a well-liked,
   differentiated feature in the ccusage ecosystem worth a look.
4. **Voice control** (overclock's ClockVoice/Jarvis) is a genuine novelty nobody else in this list
   has — low priority, but worth noting as a category nobody else occupies.
5. **Rate-limit monitoring across providers in a system tray** (overclock's Redline) — a small,
   concrete feature (Claude/GPT/Grok/Kimi rate-limit status at a glance) that's cheap to build and
   solves a real daily annoyance.

**(b) Data-capture techniques worth adopting**
6. **Explicit provenance labeling on every figure** (Claude-Code-Usage-Monitor's "provenance
   labels") validates Agentistics' own N/A-vs-confident-0 discipline — nothing new to adopt, but
   confirms it's a differentiator worth stating loudly in marketing, not just enforcing internally.
7. **OTel as the shared language** — Langfuse's and Agentistics' own architecture converge on
   OpenTelemetry; continuing to invest in `otel-watcher.ts`/OTLP export keeps Agentistics
   interoperable with the emerging observability-tooling ecosystem (e.g. piping into a Langfuse/
   Grafana stack) rather than being a closed island.
8. **Container-per-agent isolation** (Sculptor's critique of git worktrees) is worth an honest
   internal note: Agentistics' worktree-per-session convention (documented in this repo's own
   CLAUDE.md) shares the exact tradeoff Sculptor calls out — dependency reinstalls, shared host
   risk. Not urgent to change, but worth being aware it's a known limitation others have chosen to
   solve differently.

**(c) Positioning gaps**
9. **"No proxy, no interception, your files never leave your machine" is an under-used claim.**
   Every gateway/proxy competitor (Helicone, LiteLLM, and to an unverified extent overclock's
   "Harness" tier) requires routing traffic through a third party or a proxy; Agentistics' pure
   local-file-reading model is a genuine trust/privacy advantage that should be stated explicitly
   and prominently, especially against any future "gateway" pitch from overclock.sh or similar
   tools, rather than left implicit in the architecture.
10. **Agentistics has essentially zero public-discourse presence to compare against** — overclock.sh
    itself has almost none either (no HN/Reddit/X threads found), which suggests the entire
    "AI-coding-assistant analytics/orchestration tooling" niche is still pre-consensus and
    under-covered by tech press/forums. This is an opportunity: a well-timed Show HN / Reddit post
    with concrete before/after metrics (the kind of rigor already documented in this repo's own
    CLAUDE.md bug-fix writeups) could establish Agentistics as the credible, engineering-rigorous
    option in a field currently dominated by marketing-heavy, unverified-claim competitors like
    overclock.sh.

---

Sources consulted (all fetched/searched 2026-09-19):
- https://overclock.sh/en
- https://overclock.sh/en/features
- https://overclock.sh/en/course/fundamentos/instalar-os-assistentes-antes-de-abrir-o-overclock
- https://find-my-saas.com/products/overclock-sh (fetch blocked, HTTP 403 — not directly read)
- https://github.com/bhardwajRahul/overclick and https://github.com/ustoppble/overclick (adjacent
  "OverClick" open-source task board product, distinct from overclock.sh, noted for disambiguation
  only — not analyzed in depth as it was outside the exact target)
- WebSearch: "overclock.sh", "overclock.sh AI coding agent analytics", "overclock.sh pricing plans
  maestro agents", "overclock.sh reddit/HN/X" (multiple variants, EN and PT), "overclock.sh vibe
  coding company founder funding", "overclock.sh OverMemory data privacy telemetry API keys"
- vibekanban.com, github.com/BloopAI (vibe-kanban) and community forks
- producthunt.com/products/conductor..., conductor.build coverage (chatgate.ai, codepick.dev,
  julianastrada.com, yetanotherorchestrator.app)
- github.com/terragon-labs/terragon-oss, docs.terragonlabs.com
- github.com/imbue-ai/sculptor, imbue.com/sculptor
- github.com/ccusage/ccusage, npmjs.com/package/ccusage
- github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
- openobserve.ai, buildmvpfast.com, laminar.sh, llmcfo.com (Langfuse/Helicone/LiteLLM 2026
  comparison round-ups)
