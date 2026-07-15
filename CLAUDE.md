# agentistics — CLAUDE.md

Local analytics dashboard for AI coding assistants. Visualizes tokens, costs, activity, projects, and agent metrics based on data from `~/.claude/`.

## Language convention

**Everything in this project is in English**: code, comments, commit messages, PR titles and descriptions, documentation, and this file.

## Monorepo structure

```
packages/
  core/     (@agentistics/core)   — shared types, pricing, formatters, i18n, otel helpers
  server/   (@agentistics/server) — Bun HTTP server, CLI (agentop), otel-watcher, scripts
  web/      (@agentistics/web)    — React + Vite frontend
  mcp/      (@agentistics/mcp)    — MCP server, publishable to npm standalone
  desktop/                        — Tauri v2 Windows installer (spawns agentop as sidecar)
```

## Architecture

```
packages/server/bin/cli.ts  (binary entry point — agentop)
  ├── agentop start        → server/cli-start.ts (interactive arrow-key launcher; EN default + pt-BR toggle; non-TTY stdin falls through to `server`)
  ├── agentop setup        → server/cli-setup.ts (interactive solo/central/member wizard; bare `agentop` on a TTY when unconfigured)
  ├── agentop server       → server/index.ts + server/otel-watcher.ts (always together)
  ├── agentop restart …    → bounce a mode's service (`server`/`watch` → systemd; `central` → central.sh restart; `--all` → cli-start.ts restartAllServices over every running service). `--rebuild` recreates the Docker image/container instead of bouncing (`central` → `up`; machine → `compose up -d --build`); native server ignores it (use `bun bin`/`upgrade`)
  ├── agentop tui          → ../../web/src/tui/index.ts (standalone)
  ├── agentop watch        → server/otel-watcher.ts (daemon only)
  ├── agentop central …    → server/cli-central.ts (wraps central.sh: up/init/down/logs/status/restart/pull)
  ├── agentop member …     → server/cli-member.ts (connect/leave/status; whoami-verified, no browser)
  ├── agentop ci-push      → server/ci-push.ts (one-shot GitHub Actions runner → central push; env AGENTISTICS_CENTRAL_URL/AGENTISTICS_CI_TOKEN)
  ├── agentop autostart …  → server/autostart.ts (systemd user service + linger + ~/.bashrc + ~/.zshrc update-check hook)
  ├── agentop upgrade      → server/upgrade.ts
  └── agentop check-update → server/version.ts (prints a banner only when outdated; silent otherwise)

packages/server/server/index.ts (Bun, port 47291) — thin entry point
  └── delegates to server/ modules (see below)

packages/server/server/          — server-side modules (never bundled by Vite)
  ├── config.ts            → path constants + PORT (api+mcp, 47291) + WEB_PORT (dashboard, PORT+1=47292); binary mode binds BOTH
  ├── utils.ts             → createLimiter, safeReadJson, safeReadDir, safeStat
  ├── git.ts               → decodeProjectDir, getGitFileStats, getProjectGitStats
  ├── jsonl.ts             → parseSessionJsonl, makeEmptySession, classifyAgentFile, EXT_TO_LANG
  ├── health.ts            → runHealthChecks, analyzeToolHealthIssues
  ├── rates.ts             → pricing scraper + BRL rate cache
  ├── sse.ts               → SSE clients, chokidar watcher, serveStatic, maybeSpawnWatcher
  ├── archive.ts           → mirrorFile, fullSync, snapshotStatsCache ('full' mode: raw transcript mirror → ~/.agentistics/archive)
  ├── consolidate.ts       → writeConsolidated, loadConsolidated ('consolidate' mode: per-session metrics → ~/.agentistics/sessions/<harness>/<id>.json; legacy flat files load as claude)
  ├── data.ts              → loadSessionMetas, scanProjects, buildApiResponse (main orchestrator)
  ├── agent-metrics.ts     → extractAgentMetrics (parses Agent tool_use from JSONL)
  ├── otel-watcher.ts      → chokidar file watcher + OTLP metrics export daemon
  ├── preferences.ts       → ~/.agentistics prefs incl. team config (mode/endpoint/token/user)
  ├── version.ts           → getVersionInfo (current vs latest); drives update banners/notifications
  ├── autostart.ts         → systemd user service + loginctl linger + ~/.bashrc + ~/.zshrc update-check hook
  ├── cli-setup.ts / cli-central.ts / cli-member.ts → the agentop setup/central/member command handlers
  ├── cli-start.ts         → the `agentop start` interactive launcher (config vs running status, start agentistics / agentistics central, connect/disconnect, restart-all, stop, language)
  ├── cli-ui.ts            → dependency-free arrow-key select/confirm/input/pause + clearScreen (bundles clean into the binary; no node_modules to resolve)
  ├── cli-i18n.ts          → EN/PT strings for the launcher (CLI is English by default; language follows --lang / preferences.lang / the in-launcher toggle)
  ├── team-tokens.ts       → mint / rotate / revoke / validate tokens (stored as sha256 hashes only)
  ├── team-store.ts / team-stats.ts → Mongo team-session doc shape + per-member statsCache store
  ├── team-ingest.ts       → POST /api/team/ingest → upsert + triggerSseNotification (real-time central)
  ├── team-source.ts / team-admin.ts → central-side team read for buildApiResponse + members-panel admin routes
  ├── team-uploader.ts     → member→central push: sent-state, sync-signature auto-reconcile, push-on-change (notifyDataChanged), auto-reset on revoke, /api/team/status pill
  ├── team-watch.ts        → central watches the team collection → SSE refresh (fallback)
  ├── team-repos.ts        → central repo registry (`repos` collection): registerRepo (mints a repo-bound CI token + records name/remote; re-register rotates), listRepos, unregisterRepo
  ├── ci-push.ts           → `agentop ci-push`: one-shot push of an ephemeral GitHub Actions runner's ~/.claude metrics to a central; prefers keyless OIDC (fetches the runner's id-token), falls back to a static token; never fails the CI job on a push error
  ├── team-oidc.ts         → verifies GitHub Actions OIDC JWTs (jose createRemoteJWKSet + jwtVerify; issuer/audience/expiry) for keyless CI ingest; pure helpers pickCiClaims/looksLikeJwt/ciMemberId
  ├── team-agent.ts / team-agent-client.ts → reverse-channel WebSocket: WS-authoritative presence signals, ping/pong latency, on-demand chat fetch
  ├── team-presence.ts     → computePresence (WS-authoritative online/offline + latency; heartbeat only for pure-HTTP members)
  ├── central-config.ts    → Mongo central config: instanceId + pushIntervalSec + includeOfflineData
  ├── adapters/types.ts    → HarnessAdapter contract + getEnabledAdapters() (async, memoized) registry + harnessEnabled(id)
  ├── adapters/claude.ts   → wraps the existing Claude pipeline behind the HarnessAdapter contract (zero behavior change)
  ├── adapters/codex.ts    → Codex CLI reader (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
  ├── adapters/codex-parse.ts → pure parser for the Codex envelope format → SessionMeta (harness: 'codex')
  ├── adapters/gemini.ts   → Gemini CLI reader (~/.gemini/tmp/<project>/chats/*.jsonl + projects.json)
  ├── adapters/gemini-parse.ts → pure parser; only counts chats with genuine content (a real user message or model response), dropping bootstrap-only stub files; session_id is unique per chat file
  ├── adapters/copilot.ts  → Copilot CLI reader (~/.copilot/session-state/<id>/events.jsonl + workspace.yaml)
  └── adapters/copilot-parse.ts → pure parser (session.start context, user.message, assistant turns, MCP, activity hours)

packages/web/src/ (React + Vite, port 47292 in dev)
  ├── lib/
  │   ├── app-context.ts        → AppContext interface (React context type shared by all pages)
  │   ├── componentCatalog.tsx  → catalog of all components available in the custom layout builder
  │   ├── chatModels.ts         → web-only model list
  │   ├── chatSounds.ts         → 5 synthesized notification sounds via Web Audio API (Ping, Chime, Soft, Bell, Pop)
  │   ├── notifications.ts      → notification store (useSyncExternalStore) + render-time pt/en i18n (NOTIFICATION_TEXT keyed by code, interpolates meta)
  │   └── harness.ts            → HARNESS_LABELS, HARNESS_COLORS, capable(harness, metric), HARNESS_INFO (data-source/contains/missing/note metadata for HarnessInfoPanel)
  ├── hooks/
  │   ├── useData.ts            → fetches /api/data + SSE subscription + useDerivedStats() + computeHarnessSummaries()
  │   └── useCustomLayout.ts    → custom layout state: named layouts, pinned projects, persistence
  ├── pages/
  │   ├── HomePage.tsx          → main dashboard (KPIs, charts, sessions)
  │   ├── CustomPage.tsx        → custom layout builder (/custom route)
  │   ├── CostsPage.tsx         → cost deep-dive page
  │   ├── ProjectsPage.tsx      → projects overview page
  │   ├── RepositoriesPage.tsx  → repositories overview (/repositories): cards grouped by normalized git remote (RepositoriesList) so the same repo unifies across devs/paths/machines. **Only repos WITH a remote are shown by default** — remote-less sessions can't be attributed to a repo (and would split the same repo's metrics across machines), so they're hidden behind an "Unlinked · N" toggle. Links to /repo/:id
  │   ├── RepoDetailPage.tsx    → per-repo detail (/repo/:id): scopes a repo via an overridden `repos` filter (no global filter mutation) + tabs Overview/Members/Actions/Sessions/Dynamic Workflows. The "Actions" tab shows only when the repo has CI sessions; the "Dynamic Workflows" tab shows only when the repo has workflow runs from a `dynamicWorkflows`-capable harness, and renders each run as a step-by-step timeline (phases → agents) with a harness badge, and offers an "All / By session" view toggle that groups runs per session (see `lib/workflowSteps.ts` `buildWorkflowSteps` + `groupRunsBySession`)
  │   ├── ActionsPage.tsx       → /repositories/actions: all CI-runner sessions (SessionMeta.ci) grouped by repo — the GitHub Actions submenu of Repositories
  │   ├── ToolsPage.tsx         → tools breakdown page
  │   ├── HarnessPage.tsx       → generic per-harness dashboard at /h/:harness (validates param; sets harness filter; tab bar: "Overview" = dashboard, "Data & sources" = HarnessInfoPanel); replaced the old hardcoded CodexPage
  │   └── ComparePage.tsx       → unified side-by-side comparison at /compare (per-harness colors; N/A for incapable metrics; sessions/messages/tokens/cost + comparatives: usage-by-hour with peak hour, busiest day-of-week, activity-over-time sparkline, peak token day / peak session cost)
  ├── tui/
  │   └── index.ts              → terminal TUI (live stats in the terminal, no browser needed)
  └── components/               → UI (charts, cards, heatmap, modals, PDF export)
      ├── HarnessInfoPanel.tsx  → inline panel explaining each harness's data sources / what's captured / what's missing (and why) / caveats; driven by HARNESS_INFO in lib/harness.ts
      ├── PreferencesModal.tsx  → unified Settings modal with tabs: Preferences / Live / Install (Environment tab removed)
      ├── TeamLogin.tsx / TeamMembers.tsx / TeamSettings.tsx → central: password login, members panel (mint/rotate/revoke/rename + presence), team settings (interval/express, offline-data policy)
  ├── TeamRepos.tsx         → central admin panel rendered in its own **"GitHub Repositories"** Settings tab (central-only, separate from the Team tab): register/unregister repos (POST/DELETE /api/team/repos) + generates a ready-to-paste GitHub Actions workflow snippet + `gh` setup commands with the minted CI token
      ├── DeployCentral.tsx / PresenceFilter.tsx / MemberConnectionStatus.tsx → central deploy help, online/offline member filter, member-side connection pill
      └── NotificationToasts.tsx / NotificationBell.tsx / UpdateModal.tsx → auto-dismiss toasts, header bell (history + unread badge), mode-aware upgrade modal

packages/core/src/              — shared across server + web + mcp (import as @agentistics/core)
  ├── types.ts              → all shared types + pricing functions (single source of truth)
  ├── format.ts             → shared display helpers: fmt(), fmtCost(), fmtDuration()
  ├── i18n.ts               → PT/EN translations
  ├── otel.ts               → OpenTelemetry helpers
  ├── chatUtils.ts          → TOOL_LABELS, formatToolName, etc.
  └── index.ts              → barrel re-export of everything above

packages/server/scripts/embed-dist.ts
  └── Reads packages/web/dist/ after vite build and generates
      packages/server/server/embedded-dist.generated.ts
      (assets embedded as strings/base64 for the compiled binary)
```

## Multi-harness tracking

Agentistics tracks sessions from multiple AI coding assistants (harnesses), not just Claude Code.

### Harness model

- `SessionMeta.harness: HarnessId` tags every session with its origin (`'claude' | 'codex' | 'gemini' | 'copilot'`). Missing/legacy sessions default to `'claude'`.
- `AppData.harnesses: HarnessId[]` lists which harnesses have data present, used by the frontend to decide whether to show the harness selector in the nav (shown only when >1 harness is active). Selecting "All" yields the unified view.
- Each harness is implemented as a `HarnessAdapter` module under `server/adapters/` — never a separate package. `getEnabledAdapters()` lazily resolves and memoizes available adapters; individual adapters can be disabled via `AGENTISTICS_HARNESS_<ID>=0`.

### N/A vs real 0 — `HARNESS_CAPABILITIES`

`HARNESS_CAPABILITIES` in `@agentistics/core` (`packages/core/src/types.ts`) is the single source of truth for which metrics each harness can produce. When a capability flag is `false`, the frontend renders "N/A" via the `NAtag` component + `capable(harness, metric)` helper (re-exported from `lib/harness.ts`), rather than showing a misleading 0. Current limitations: Codex, Gemini, and Copilot do not produce agent metrics or git line counts (those capabilities are `false` for non-Claude harnesses). `dynamicWorkflows` (runs of the multi-agent orchestration Workflow tool) is `true` only for `claude` — it gates the repo-detail "Dynamic Workflows" tab.

### Aggregation — stats-cache.json is Claude-only

`stats-cache.json`, `dailyModelTokens`, and `modelUsage` inside it are populated exclusively by Claude Code and must never be used to aggregate non-Claude data. In `useDerivedStats`, a non-Claude harness is aggregated purely from per-session data. The unified view = Claude statsCache totals + per-session sums of non-Claude sessions. Non-Claude sessions are merged in `data.ts` **after** `supplementStatsCache` runs so Claude totals are never corrupted.

### Codex envelope format

Codex JSONL files wrap events in `event_msg` / `response_item` envelopes; the semantic event type lives at `payload.type`. Token usage is at `payload.info.total_token_usage` (cumulative — last seen wins). Codex `input_tokens` includes the cached portion, so the parser stores non-cached input (`totalInput - cached`) in `input_tokens` and the cached portion in `cache_read_input_tokens` separately.

### Gemini caveat — bootstrap stubs vs. real sessions

Gemini CLI writes `~/.gemini/tmp/<project>/chats/*.jsonl` files but many are bootstrap-only stubs with no real conversation content. The Gemini parser (`adapters/gemini-parse.ts`) filters these out — only chats containing a genuine user message or model response are counted. Gemini's local files do not carry token/cost data; real Gemini token metrics would require OTel integration (Phase 3).

### Compare page — `computeHarnessSummaries`

`computeHarnessSummaries(data)` is an exported pure function in `hooks/useData.ts` that computes per-harness totals and comparatives (usage-by-hour, busiest day-of-week, activity-over-time, peak token day, peak session cost). Claude totals come from `statsCache` (full history); non-Claude totals are computed from per-session sums — so Compare page Claude numbers always match the main dashboard.

### Consolidate store namespacing

The consolidate store is namespaced by harness: `~/.agentistics/sessions/<harness>/<id>.json`. Legacy flat files at the root are read and treated as `claude`.

### Future phases

- **Phase 3** (planned): Gemini OTel integration for real token/cost data.

See `docs/superpowers/specs/2026-06-19-multi-harness-tracking-design.md` for the full design.

---

## Repository dimension (group by git remote)

Metrics can be grouped **by repository** (git remote) independent of the local path or which
machine produced them — so a repo's usage aggregates across all devs and CI agents. See
`docs/github-actions.md` for the GitHub Actions half.

### The key — `normalizeGitRemote` (single source of truth)

`normalizeGitRemote(url)` in `@agentistics/core` (`packages/core/src/types.ts`) collapses any
remote form (https / ssh / scp / git, with or without credentials/port/`.git`) into a stable,
**protocol-less** key `host/org/repo` (e.g. `github.com/org/repo`). Host is lowercased, path case
preserved. Returns `''` for local paths / `file://` / junk. **Never key repos by anything else.**
`repoShortName(remote)` drops the host for display (`org/repo`).

### How it's captured and threaded

- `git.ts getGitRemote(projectPath)` reads `remote.origin.url` (same Windows/WSL + no-prompt guards
  as the stats helpers) and normalizes it.
- `data.ts scanProjectDir` resolves the remote once per project and **stamps `SessionMeta.git_remote`
  onto every session** (+ `ServerProject.gitRemote`). Because it lives on the session, the remote
  travels into the consolidate store → team uploader → Mongo — the central has no filesystem access
  to members' repos, so per-session is the only place it can live.
- Frontend: `useDerivedStats` builds `repoStats` (per-remote aggregate; `remote === ''` = the
  "no linked repository" bucket, never hidden) and honors a `Filters.repos` filter (scopes cost/
  tokens session-side like a project filter). `RepoStat` is exported from `hooks/useData.ts`.

### GitHub Actions — `SessionMeta.ci` + repo-bound tokens

An ephemeral Claude Code Actions runner pushes its metrics via `agentop ci-push` →
`POST /api/team/ingest`. Auth is **keyless GitHub OIDC** (preferred): the runner presents a
short-lived GitHub-signed JWT, the central verifies it against GitHub's JWKS (`team-oidc.ts`, uses
`jose`) and checks the `repository` claim against the **registered repos allowlist** — no secret is
stored. A **repo-bound static token** (minted by `POST /api/team/repos`) is the fallback. Either
way the central **authoritatively stamps** `git_remote` + `ci: true` + `user = github-actions` (via
`stampCiSessions`) — a runner cannot mis-report its repo. CI sessions are keyed by `ciMemberId`
(`repo:<remote>`). `ci === true` sessions power the **Repositories → Actions** view. Enable OIDC by
setting `AGENTISTICS_OIDC_AUDIENCE` on the central (the workflow requests that same audience).

Cloud runners need the central reachable without exposing the dashboard. `AGENTISTICS_INGEST_ONLY=1`
(config.ts) makes a central serve **only** `POST /api/team/ingest` (404 for everything else, checked
right after the OPTIONS handler in `index.ts`) — run it as a public ingest instance sharing Mongo
with a separate private dashboard instance. See `docs/github-actions.md`.

### Repository rules

- **`normalizeGitRemote` is the only way to key a repo** — never parse `project_path` strings.
- **`git_remote` lives on the session** (not only the project) so it reaches the central.
- **CI attribution is server-authoritative** — stamped from the repo token, never trusted from the
  runner's payload.
- **`stats-cache.json` stays Claude-only** — repo/CI aggregates come from per-session sums, same as
  every non-Claude dimension.

---

## Team mode

One machine ("central") aggregates coding-assistant usage metrics from many machines ("members"). Members push **computed metrics only** (session/agent/token/cost aggregates + their statsCache) — **never chat** (raw chat is fetched on demand over a reverse WebSocket, never stored centrally). The central runs as a Docker service (`central.sh` at the repo root, default port `48080`, Mongo **not** published to the host). See `docs/architecture.md` for the full write-up.

### Roles — `preferences.team.mode`

- **solo** — local only, nothing leaves the machine (default).
- **central** — the aggregator; serves the team dashboard behind a password.
- **member** — pushes computed metrics to a central's `/api/team/ingest`.

### Push model — central owns the cadence

The **central owns the interval** (`central-config.ts`, `pushIntervalSec`; normal floor 15s, default 30s, express down to 5s = `EXPRESS_MIN_SEC`). Members read it from `GET /api/team/policy` and can only follow it — no member-side override that goes faster. Plus **push-on-change**: the file watcher calls `notifyDataChanged()` in `team-uploader.ts` → a debounced push floored by the central's interval. Members push their **supplemented** statsCache (the one the local dashboard shows, gap-filled past the stale `lastComputedDate`), never the raw `~/.claude/stats-cache.json`, so central totals match the member exactly. A member push triggers `triggerSseNotification()` on the central → dashboards refresh live, which is why the **"Live" toggle is hidden on a central**.

### Member identity

The display **name is set by the central** on the minted token — there is no name field on the machine; the member resolves it via `GET /api/team/whoami`. Sessions are keyed centrally by a stable `memberId` (token sha256 hash), so renames preserve history. `agentop member connect` never writes a half-config on a bad token.

### Presence — WebSocket-authoritative

`team-presence.ts` computes online/offline from the reverse-channel WS registry in `team-agent.ts`: online while the socket is live, **offline within ~8s** of a kill (`SOCKET_GRACE_MS`); once a member has ever held a socket that signal is trusted; a heartbeat window is only the fallback for pure-HTTP members. Latency comes from WS ping/pong RTT.

### Auto-reconciliation (self-healing sync)

`team-uploader.ts` fingerprints the target as `sha256(endpoint \0 token \0 instanceId)`. When it changes — central DB wiped (`down -v` → new `instanceId`), token revoked+re-added, or endpoint changed — the member clears its sent-state and **re-pushes its full history** (idempotent upserts, no double-count). No manual `team-sent.json` deletion. A persistent 401/403 (revoked token) auto-resets the member back to **solo** and fires a "removed from central" notification. A `null` instanceId (old/unreachable central) never triggers a spurious reset.

### Notifications

`web/src/lib/notifications.ts` is an external store rendered by `NotificationToasts` (auto-dismiss) + `NotificationBell` (history + unread badge). Notifications carry a `code` (+ `meta`) and are localized **at render time** (`NOTIFICATION_TEXT`, pt/en). The server emits them over SSE via `broadcastNotification()`.

### Team-mode rules

- **Members never push chat** — only computed metrics + statsCache; raw chat is on-demand over the WebSocket.
- **Tokens are stored only as sha256 hashes** (`team-tokens.ts`) and never logged; the central's session-cookie secret is **separate** from the dashboard password; auth compares are constant-time.
- **Non-Claude team metrics still come from per-session sums** — `stats-cache.json` remains Claude-only, on the central too (Compare-page Claude totals match the dashboard).
- **The central is the sole authority on the push interval** — members clamp to `max(central, EXPRESS_MIN_SEC)`; there is no faster member override.
- **`agentop central` runs from anywhere** — in a repo checkout it wraps `central.sh` (which does `build: .`); from the standalone binary (no repo) `cli-central.ts` falls back to a Docker-image path: it materializes a compose that pulls `ghcr.io/blpsoares/agentistics:<version>` + generates `central.env` into `~/.agentistics/central/` and drives `docker compose` directly. The image is published to GHCR by the `publish-image` job in `release.yml`. Override the image with `AGENTISTICS_IMAGE`.

---

## Calculation functions — single source of truth

**All layers** use the same functions from `packages/core/src/types.ts` via `@agentistics/core`. Never inline pricing calculations.

### `MODEL_PRICING` — pricing table (USD per 1M tokens)

```
packages/core/src/types.ts
```

Update here when Anthropic changes prices or releases new models. Fallback (Sonnet 4.6: $3/$15) is the return value of `getModelPrice` when no match is found.

### `getModelPrice(modelId)` — resolves price by model ID

```
packages/core/src/types.ts
```

Tries exact match, then partial match via `startsWith` in both directions. Returns Sonnet 4.6 fallback if no match.

### `calcCost(usage, modelId)` — total cost from a usage record

```
packages/core/src/types.ts
```

Takes a `ModelUsage` object (input, output, cacheRead, cacheWrite in tokens) and returns cost in USD.

### `blendedCostPerToken(modelUsage)` — weighted average rate across models

```
packages/web/src/hooks/useData.ts
```

Used when there is no per-session model ID (project filter active, or per-session cost in PDF export). Weights each model's rate by its token volume in global usage.

### `serveStatic(pathname)` — serves embedded frontend assets

```
packages/server/server/sse.ts
```

Only active when `SERVE_STATIC=1` (set by `cli.ts` for the `server` subcommand). Reads from `embeddedDist` (generated at compile time). Returns `null` in dev mode.

---

## Where each layer calculates cost

| Layer | What it calculates | How |
|-------|--------------------|-----|
| `useData.ts / useDerivedStats` | Filtered `totalCostUSD` | `calcCost()` per model; `blendedCostPerToken()` when project or model filter is active and per-session breakdown is needed |
| `ModelBreakdown.tsx` | Per-model cost in the UI | `calcCost()` |
| `PDFExportModal.tsx` | Per-model cost in PDF | `calcCost()` |
| `PDFExportModal.tsx` | Per-session cost in PDF | `blendedCostPerToken(statsCache.modelUsage)` — sessions have no individual model field |
| `otel-watcher.ts` | Total cost exported via OTel | `calcCost()` from `@agentistics/core` |
| `tui/index.ts` | Cost in terminal output | `calcCost()` from `@agentistics/core` |
| `server/agent-metrics.ts` | Per-agent-invocation cost | `calcCost()` with per-invocation token breakdown |
| `server/rates.ts` | — | Does not calculate cost; only fetches/caches the external pricing table (`/api/rates`) |

---

## Agent metrics

Agent metrics are extracted from raw JSONL files by `server/agent-metrics.ts`. They are available in the `agentMetrics` field of each `SessionMeta`.

### Data available per Agent invocation

| Field | Source |
|---|---|
| `agentType` | `toolUseResult.agentType` in the JSONL message envelope |
| `description` | `tool_use.input.description` |
| `totalTokens` | `toolUseResult.totalTokens` |
| `totalDurationMs` | `toolUseResult.totalDurationMs` |
| `totalToolUseCount` | `toolUseResult.totalToolUseCount` |
| `inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens` | `toolUseResult.usage.*` |
| `toolStats` (reads, searches, bash, edits, lines changed) | `toolUseResult.toolStats` |
| `costUSD` | Calculated via `calcCost()` |
| `status` | `toolUseResult.status` (`completed` / `failed`) |

### What is NOT available for Skills and Tasks

- **Skills** (`/commit`, `/review-pr`, etc.) are not recorded as individual tool_use events in the JSONL — only a `skill_listing` attachment appears. Skill invocations can only be inferred indirectly from subsequent tool calls.
- **Tasks** (`TaskCreate`/`TaskUpdate`) have subject/description/status but no token or duration data.

---

## Data flow

```
~/.claude/
  ├── stats-cache.json          → aggregated data (tokens/day, model, activity)
  ├── usage-data/session-meta/  → enriched sessions (preferred source)
  └── projects/**/*.jsonl       → raw files (fallback + agent metrics source)
         ↓
    packages/server/server/data.ts (buildApiResponse — main orchestrator)
    packages/server/server/agent-metrics.ts (extractAgentMetrics — parses Agent tool_use from JSONL)
         ↓
    /api/data → useData() → useDerivedStats() → React components
```

## Archive mirror (survives Claude's 30-day cleanup)

Claude Code deletes session transcripts (`~/.claude/projects/**/*.jsonl`) older than `cleanupPeriodDays` (default 30) on every startup, taking per-session detail + agent metrics + chat content with them (the `stats-cache.json` aggregates survive). Official docs: https://code.claude.com/docs/en/settings.

**Three modes**, persisted as `preferences.archiveMode` (`undefined` = not chosen → the consent gate blocks the app). `resolveArchiveMode()` / `getArchiveMode()` in `preferences.ts` migrate the legacy `archiveSessions` boolean (true→'full', false→'off'):
- **`consolidate`** *(recommended default)*: `data.ts` persists each computed `SessionMeta` (+agentMetrics) to `~/.agentistics/sessions/<id>.json` (~KB each, skip-if-identical), then on read **gap-fills** — sessions/projects no longer present live are revived from the store. No raw files duplicated. Trade-off: loses the raw chat text of deleted sessions and future recompute.
- **`full`** *(opt-in "archivist")*: additionally `archive.ts` mirrors raw transcripts into `~/.agentistics/archive/` (copy-if-newer; `archiveEnabled()` = mode==='full') and `data.ts` reads the union live+archive roots + `applyArchivedStats()` (per-date fill + per-field `max`, never additive). Heavy + grows unbounded; preserves everything incl. raw chat.
- **`off`**: nothing — uses `~/.claude` exclusively.

- **Consent gate**: `ArchiveConsentModal.tsx` blocks first load (links the official doc) — primary Yes(consolidate)/No(off) + an "Advanced" expander revealing full-copy. `App.tsx` early-returns the modal when `archiveChoice === null`; `chooseArchive(mode)` PUTs `archiveMode`. Env `AGENTISTICS_ARCHIVE=0` hard-disables everything; `AGENTISTICS_ARCHIVE_DIR` overrides the archive path.
- **No false metrics**: dedup by `session_id` (live always wins) + the `supplementStatsCache` guard (`day <= lastComputedDate` skip) mean revived old sessions show in lists/agent-metrics but never inflate aggregate totals. Boot + the PUT `/api/preferences` handler warm a build (persists the store) and `full` also runs `fullSync()`.

## Important rules

- **`stats-cache.json` is Claude-only** — never aggregate non-Claude harness metrics from it; use per-session sums for all other harnesses (see "Multi-harness tracking" above)
- **Harness adapters are modules, not packages** — all adapters live under `packages/server/server/adapters/`; never create a separate package per harness
- **`stats-cache.json`** has no project-level granularity — project filters are computed by summing individual sessions
- **Tokens per model/day**: `dailyModelTokens` only stores totals; input/output split uses global statsCache proportions as an approximation when filtering by date
- **Sessions have an optional `model` field** — extracted from the JSONL file by `server/data.ts` when not already present in session-meta. Use `blendedCostPerToken` as fallback when `model` is unknown (e.g. per-session cost column in PDF export)
- **Sessions have an optional `title` field** — the Claude-generated session title, parsed from the transcript's `ai-title` line (or legacy `summary`) by `server/jsonl.ts`. The UI displays it via the shared `sessionLabel()` helper (`@agentistics/core`), which falls back to `first_prompt` with `<local-command-caveat>`/`<command-name>` wrappers stripped — never render `first_prompt` raw as a title
- **Agent metrics** are only available for sessions whose JSONL files are accessible; `_source: 'meta'`-only sessions won't have them
- **Streak**: counts backwards from today; if today has no activity, starts from yesterday — intentional behavior so users are not penalized for not having worked yet today
- **BRL costs**: conversion via `/api/rates` (fetches live exchange rate); falls back to a fixed rate if the API fails
- **Session sources**: `_source: 'meta'` sessions are the most complete; `'jsonl'` and `'subdir'` are fallbacks with partial data (no git line counts, no cache tokens)
- **Binary mode**: `agentop server` sets `SERVE_STATIC=1`; `index.ts` then binds **two ports with one shared request handler** — `PORT` (47291) is the api + mcp endpoint, `WEB_PORT` (47292) serves the web dashboard (the URL you open). Same handler → the SPA on 47292 makes same-origin `/api/*` calls that resolve locally, so 91 stays api+mcp and 92 is the dashboard. The startup log lists `web` (92) above `api` (91)
- **Machine in Docker**: `docker-compose.machine.yml` (repo root) runs a solo/member machine in a container — reuses the central image (minus Mongo/central mode), mounts the host harness dirs read-only + `~/.agentistics` read-write, host networking. Offered as the `docker` option in `agentop start`. Run the machine in Docker **or** natively, never both
- **`packages/server/server/embedded-dist.generated.ts`** is in `.gitignore` — auto-generated, never commit it
- **`packages/server/` modules** are server-only — never import them from `packages/web/src/` (Vite would try to bundle them and fail on Node/Bun APIs)
- **`@agentistics/core`** is the shared package — import types, pricing, and formatters from there; never duplicate them inline
- **Custom layout persistence**: `useCustomLayout` saves `{ layouts, activeLayout, pinnedProjects }` to `/api/preferences`. Layouts open **locked** by default; edit mode requires clicking "Edit". When all layouts are deleted, `active` is `''` (empty string) — CustomPage shows an empty state in this case
- **`componentCatalog.tsx`** is the single source of truth for what can be placed on the custom page — every component has a `render(ctx: AppContext)` function; to add a new component, add it there
- **`app-context.ts`** defines `AppContext` — the shape of the outlet context passed from `App.tsx` to all pages via `useOutletContext<AppContext>()`. Add new global state here when it must be accessible from any page or from custom layout components
- **`format.ts`** contains shared display helpers (`fmt`, `fmtCost`, `fmtDuration`, `fmtFull`) — never duplicate these inline
- **`chatSounds.ts`** (`packages/web/src/lib/chatSounds.ts`) defines `CHAT_SOUNDS` (5 sounds: ping, chime, soft, bell, pop), all synthesized via Web Audio API — no audio files needed. `chatSoundId` preference is wired through App.tsx → TtyChat.tsx
- **`PreferencesModal.tsx`** is the single Settings modal — it replaced 3 separate modals with one tabbed interface (Preferences / Live / Install / Environment tabs). Do not add separate settings modals.
- **Per-harness pages live at `/h/:harness`** via the generic `HarnessPage` — never create one page per harness. Harness data-source info is shown via the page's "Data & sources" tab (powered by `HarnessInfoPanel` + `HARNESS_INFO` in `lib/harness.ts`); do not add per-harness info icons or modals elsewhere.
- **A harness appears in the selector and Compare page** only when `AppData.harnesses` includes it (i.e., it contributes at least one real session). Gemini bootstrap-only stub files do not count.
- **PWA**: `vite-plugin-pwa` is configured in `packages/web/vite.config.ts` with `devOptions: { enabled: true }`. Icons are in `packages/web/public/icons/`. The Install tab in PreferencesModal handles both web PWA install and desktop app download.
- **Mobile / responsive UI** — the whole dashboard is responsive; gate mobile-only branches on the `useIsMobile()` hook (`packages/web/src/hooks/useIsMobile.ts`, `MOBILE_BREAKPOINT = 768`). Conventions:
  - **Sticky header** holds everything needed for interaction. On mobile the header shows only the logo; the lang/theme/export/settings/health/live/refresh controls are **not** in the top row — they live in the bottom-nav "More" sheet (see below). Desktop keeps the full action row.
  - **`MobileBottomNav`** (in `App.tsx`) is the only mobile chrome: 4 primary tabs (Home/Costs/Projects/Tools) + a **"More" bottom sheet rendered as a 3-column grid of square tiles** (Custom / Export / Compare when >1 harness, plus the moved actions: Live toggle w/ interval badge, Refresh, Settings, Warnings w/ issue count). The More button shows a dot when health warnings exist. The sheet slides in via a `transform` transition. Do not move these actions back into the top header on mobile, and keep the tiles compact (no square `aspect-ratio`).
  - **Collapsible filter bar**: on mobile the full `FiltersBar` (harness chips + date/projects/models) sits in the sticky header and can be minimized to a slim "Filters" row (with an active-filter count badge) via `filtersCollapsed`. The open/close is animated with a `grid-template-rows: 0fr↔1fr` transition. The animation wrapper needs `overflow: hidden`, which would clip the Models popover — so it's only clipped while animating/collapsed (`filtersClip` + `onTransitionEnd`), then switches to `visible`.
  - **`FiltersBar` `compact` prop** (used on mobile): hides the vestigial vertical dividers and tightens padding. On mobile the controls also stretch to fill each row (date presets `flex:1`, custom range full-width, the ＋ Filtro button full-width).
  - **`FiltersBar` "＋ Filtro" model**: the top bar shows only the date presets + custom range + a single dashed **＋ Filtro** button (with an active-dimension count badge). It opens a menu of the *available* dimensions (Members/Harnesses/Presence shown only on central-with-data; Repos only when a repo dimension exists; Projects/Models when present); picking one opens that dimension's inline value picker (Projects opens the full `ProjectsModal`). The selected values are NOT shown in the top bar — they render in the animated per-category chip rows below (`AnimatedRow`/`ChipRow`/`FilterChip`, one row per dimension incl. Presence). Do not re-add always-visible dimension dropdowns to the top bar.
  - **Full-screen modals on mobile**: ProjectsModal, SessionDrilldownModal, PreferencesModal, the transcript viewer, etc. render full-screen (overlay padding 0, width/height 100%, `borderRadius: 0`) — iOS Safari pushes centered fixed-width modals off-screen when the page overflows horizontally.
  - **iOS sticky fix**: mobile `html, body, #root` use `overflow-x: clip` (NOT `hidden`) in `index.css` — `hidden` forces `overflow-y` to compute to `auto`, creating a scroll container that breaks `position: sticky`. `clip` clips without that side effect.
  - **iOS install/PWA**: iOS has no `beforeinstallprompt`; InstallModal/Install tab detect iOS and show Add-to-Home-Screen steps instead of an install button. The data cache in `useData.ts` (`agentistics-data-cache-v1` in localStorage) gives instant reopen over plain HTTP (service worker needs HTTPS/localhost).
- **`files_modified` counting** (`packages/server/server/jsonl.ts`): tracks unique file paths from Edit/Write/MultiEdit tool calls (`claudeFilesModified` Set), then takes `Math.max(gitFileStats.filesModified, claudeFilesModified.size)` — whichever is higher. This captures files Claude edited in non-git directories.
- **`getProjectGitStats`** (`packages/server/server/git.ts`): first tries the project path as a single git repo; if that fails (not a git repo), falls back to scanning one level of subdirectories and aggregating stats across all git repos found there (handles workspace folders like `~/zuke`).
- **FILES KPI** (`packages/web/src/hooks/useData.ts`): always uses session-level `files_modified` count first (Edit/Write/MultiEdit calls); falls back to project-level `git_stats.files_modified` only if sessions show 0. This is different from commits/lines which prefer project-level git stats when a project filter is active.

## Development

```bash
bun run dev            # API (47291) + UI (47292) in parallel
bun run watch          # OpenTelemetry daemon (optional)
bun run watch:cli      # Terminal TUI
bun test               # Unit tests for pure functions

# Build the binary
bun run build          # Generates packages/web/dist/ (Vite)
bun run build:assets   # Generates packages/server/server/embedded-dist.generated.ts
bun run build:binary   # Full pipeline → release/agentop
```

## Tests

Unit tests cover the critical pure functions:

- `packages/core/src/types.test.ts` → `calcCost()`, `getModelPrice()`
- `packages/core/src/chatUtils.test.ts` → tool label helpers
- `packages/web/src/hooks/useData.test.ts` → `calcStreak()`, `getDateRangeFilter()`
- `packages/server/server/chat-tty.test.ts` → chat TTY parsing

Do not mock the filesystem — the tested functions are pure and have no side effects.

## Git hooks (husky)

- **pre-commit**: `bun tsc --noEmit` + `bun test`
- **commit-msg**: commitlint enforces Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
