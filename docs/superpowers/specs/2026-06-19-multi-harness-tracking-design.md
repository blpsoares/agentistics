# Multi-harness tracking — design

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** Bryan Soares (with Claude)

## Goal

Extend agentistics beyond Claude Code so it tracks multiple AI coding harnesses, each with its **own dedicated dashboard area** (rich, showing whatever that harness exposes) **and** a **unified area** that aggregates/compares everything across harnesses.

Target harnesses (this spec):

- **Claude Code** — existing, richest source.
- **OpenAI Codex CLI** — near-parity (real tokens + cost).
- **Gemini CLI** — local data is sparse; tokens/cost only via OpenTelemetry (specified here).
- **GitHub Copilot CLI** — local data is sparse (sessions/projects/activity, no tokens locally).

Cursor / Aider / others are explicitly **out of scope**.

## Key principle: metrics are unequal across harnesses

Each harness exposes a different subset of data. Forcing parity is impossible and would produce false metrics. The product rule is **best-effort + graceful degradation**:

- Each harness's dedicated page shows everything *that harness* offers.
- Missing data renders as **"N/A"**, never as a misleading `0`.
- The unified view aggregates only **comparable** metrics (sessions, activity, projects, plus tokens/cost where available) and labels each slice by harness (color/legend).

### Ground-truth data availability (verified on this machine, 2026-06-19)

| Harness | Source on disk | Tokens/cost | Model | Tools | Project/git | Verdict |
|---|---|---|---|---|---|---|
| Claude Code | `~/.claude/` (stats-cache.json, projects/**/*.jsonl, usage-data/session-meta/) | ✅ incl. cache | ✅ | ✅ + agents | ✅ git lines | Richest (current) |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `session_index.jsonl` | ✅ input / cached_input / output | ✅ (`gpt-5.5`) | ✅ web_search, task events | ✅ cwd | **Near-parity** |
| Gemini CLI | `~/.gemini/tmp/<project>/chats/session-*.jsonl` + `projects.json` | ❌ local (✅ via OTel) | ❌ local | ⚠️ partial | ✅ cwd / projects.json | Sparse local |
| Copilot CLI | `~/.copilot/session-state/<id>/events.jsonl` + `workspace.yaml` | ❌ | ❌ local | ⚠️ MCP / turn events | ✅ cwd / branch / repository | Sparse local |

#### Codex rollout format (verified)

JSONL with typed events. Relevant types:
- `session_meta` → `payload.id`, `payload.timestamp`, `payload.cwd`, `payload.model_provider`, `payload.cli_version`, `payload.source`.
- `token_count` → `total_token_usage` `{ input_tokens, cached_input_tokens, output_tokens }` (cumulative; take the last event per session or delta as appropriate).
- `turn_context` → `model` (e.g. `gpt-5.5`).
- `user_message` / `agent_message` / `message` / `input_text` / `output_text` → message counts.
- `web_search_call` / `web_search_end` → web search usage.
- `task_started` / `task_complete` → turn boundaries.
- Tool/command events (`workspace-write`, `search`, `path`, etc.) → tool counts.

#### Gemini local format (verified)

- `~/.gemini/projects.json` → map of `{ absolutePath: shortName }` (project discovery).
- `~/.gemini/tmp/<project>/chats/session-*.jsonl` → first line is session header `{ sessionId, projectHash, startTime, lastUpdated, kind }`; subsequent lines are `{ type: "user", kind: "main", ... }`. **No token, model, or cost data.** `logs.json` observed empty.
- Local Gemini metrics available: session count, start/last-updated timestamps, project association, user-message count, activity heatmap.

#### Copilot local format (verified)

- `~/.copilot/session-state/<id>/events.jsonl` → typed events: `session.start` (with `data.context` = `{ cwd, gitRoot, branch, repository }`), `session.info` (MCP/auth), `user.message` (with `content`), `assistant.turn_start` / `assistant.turn_end`, `session.error`.
- `~/.copilot/session-state/<id>/workspace.yaml` → `{ id, cwd, created_at, updated_at, summary_count }`.
- **No token, model, or cost data** in observed events.
- Local Copilot metrics available: session count, timestamps, project/repo/branch, user-message count, assistant turn count, MCP usage, errors, activity heatmap.

## Architecture (Approach A: adapters + harness tag)

Chosen over per-harness pipelines (too much duplication) and an event-sourced rewrite (YAGNI). Approach A reuses ~90% of the existing pipeline because the normalized data model (`SessionMeta`, `StatsCache`) is already source-agnostic in *shape* — only the *origin* is Claude-specific today.

### Adapters are modules, not packages

Each harness adapter is a single file under `packages/server/server/adapters/` — **not** a workspace package. Rationale: adapters do not cross a runtime/deploy boundary (server-only, depend on server utils, produce `core` types, not publishable standalone). Packages in this monorepo exist for consumption boundaries (`core` shared across 3 runtimes, `mcp` publishable). Adapters are the same category as the existing `git.ts` / `jsonl.ts` / `rates.ts` / `agent-metrics.ts` modules. Promote to a package only if a future runtime needs to import them — a cheap later refactor.

### Adapter contract

```ts
// packages/server/server/adapters/types.ts
export type HarnessId = 'claude' | 'codex' | 'gemini' | 'copilot'

export interface HarnessAdapter {
  id: HarnessId
  /** Directory(ies) for this harness exist on disk. */
  isAvailable(): boolean
  /** Returns normalized SessionMeta[] with `harness` populated. Missing
   *  fields are left 0/undefined (best-effort degradation). */
  loadSessions(): Promise<SessionMeta[]>
  /** Optional: harness-specific project discovery, when not derivable from sessions. */
  loadProjects?(): Promise<Project[]>
}
```

Files:
- `packages/server/server/adapters/types.ts` — contract + `HarnessId` + adapter registry.
- `packages/server/server/adapters/claude.ts` — wraps the **existing** Claude pipeline behind the contract; **no behavior change**. `data.ts`'s current Claude-specific loading (`loadSessionMetas`, `scanProjects`, agent-metrics, archive/consolidate) is invoked from here.
- `packages/server/server/adapters/codex.ts` — new parser for the Codex rollout format.
- `packages/server/server/adapters/gemini.ts` — new parser for Gemini local chats + `projects.json`.
- `packages/server/server/adapters/copilot.ts` — new parser for Copilot `events.jsonl` + `workspace.yaml`.

`buildApiResponse` (`data.ts`) becomes the orchestrator: iterate the registry, call `isAvailable()`, `loadSessions()` on each available adapter, concatenate, and merge into the unified `AppData`. The per-harness aggregate (`StatsCache`-equivalent) is computed from the harness's own sessions.

### Config

`config.ts` gains harness-root constants and env overrides, mirroring the existing `CLAUDE_DIR` pattern:

```ts
export const CODEX_DIR   = process.env.CODEX_DIR   ?? join(HOME_DIR, '.codex')
export const GEMINI_DIR  = process.env.GEMINI_DIR  ?? join(HOME_DIR, '.gemini')
export const COPILOT_DIR = process.env.COPILOT_DIR ?? join(HOME_DIR, '.copilot')
```

Each adapter's `isAvailable()` checks its root. A harness can be force-disabled via env (e.g. `AGENTISTICS_HARNESS_CODEX=0`), consistent with the existing `AGENTISTICS_ARCHIVE=0` style.

## Data model changes (`packages/core/src/types.ts`)

- `SessionMeta` gains **`harness: HarnessId`** (default `'claude'` for backward compatibility / migration of existing consolidated/archived sessions without the field).
- `AppData` gains **`harnesses: HarnessId[]`** — which harnesses are present this run, so the UI knows which dedicated pages and unified slices to show.
- Per-harness aggregates: `AppData` carries either a `Record<HarnessId, StatsCache>` or the unified `StatsCache` + a derive-by-filter approach. **Decision:** keep a single unified `sessions: SessionMeta[]` as today and **derive per-harness stats by filtering on `harness`** (same mechanism as the existing project filter), to avoid duplicating the `StatsCache` plumbing. `statsCache` stays as the Claude-or-unified aggregate for backward compat; per-harness/unified breakdowns are computed in `useDerivedStats`.
- Missing data stays `0`/`undefined`; the UI distinguishes "real 0" from "N/A" via a per-harness capability map (see UI section).

### Capability map

A static map declares which metrics each harness can produce, so the UI renders "N/A" vs `0` correctly and the unified view knows what is comparable:

```ts
// packages/core/src/types.ts
export const HARNESS_CAPABILITIES: Record<HarnessId, {
  tokens: boolean; cost: boolean; model: boolean;
  tools: boolean; agents: boolean; gitLines: boolean;
}> = {
  claude:  { tokens: true,  cost: true,  model: true,  tools: true,  agents: true,  gitLines: true },
  codex:   { tokens: true,  cost: true,  model: true,  tools: true,  agents: false, gitLines: false },
  gemini:  { tokens: false, cost: false, model: false, tools: false, agents: false, gitLines: false }, // until OTel (Phase 3)
  copilot: { tokens: false, cost: false, model: false, tools: false, agents: false, gitLines: false },
}
```

(Gemini's `tokens/cost/model` flip to `true` once Phase 3 OTel ingestion is active and present.)

## Pricing (`packages/core/src/types.ts`)

Extend `MODEL_PRICING` with OpenAI models used by Codex (e.g. `gpt-5.5` and any others seen in `turn_context.model`), so Codex sessions get **real cost** via the existing `calcCost()` / `getModelPrice()` path. No new cost machinery — Codex flows through the same single-source-of-truth functions. `rates.ts` pricing scraper is extended/configured to also surface OpenAI prices if a live source is wired; otherwise OpenAI entries use the static fallback table.

## Frontend — dedicated pages + unified

Navigation: **dedicated route per harness** + a unified page (per user choice).

- Routes: `/claude`, `/codex`, `/gemini`, `/copilot`, and `/` (or `/unified`) = unified.
- A harness selector/tabs in the top nav. Only harnesses present in `AppData.harnesses` are shown.
- Each dedicated page reuses the existing components/charts, passing a **`harness` filter** into `useData` / `useDerivedStats` — exactly like the existing project filter. Cards for metrics the harness lacks (per `HARNESS_CAPABILITIES`) render **"N/A"**.
- The unified page aggregates comparable metrics across harnesses, with **per-harness color/legend** on charts (stacked/grouped). High-level side-by-side comparison (sessions, activity, tokens/cost where available).
- `Filters` (`core/src/types.ts`) gains an optional `harness?: HarnessId` field, threaded through `useData`/`useDerivedStats` the same way `project` is.
- `componentCatalog.tsx` / custom layout: components become harness-aware via `AppContext` (the active `harness` filter is part of context), so custom layouts can pin per-harness widgets. Add a "harness" dimension to `AppContext` (`app-context.ts`).

## Archive / consolidate (per-harness)

The archive (`full` mode) and consolidate (`consolidate` mode) stores become **namespaced by harness** under `~/.agentistics/`:

- Consolidate: `~/.agentistics/sessions/<harness>/<id>.json` (was `~/.agentistics/sessions/<id>.json`). Migration: existing flat files are treated as `claude`.
- Full archive: `~/.agentistics/archive/<harness>/...` mirroring each harness's raw transcript tree (Claude as today; Codex rollouts; Gemini chats; Copilot events). `AGENTISTICS_ARCHIVE_DIR` still overrides the root.
- The gap-fill / dedup-by-`session_id` / `supplementStatsCache` guards in `data.ts` continue to apply, now keyed by `(harness, session_id)` so IDs never collide across harnesses.
- The existing 30-day-cleanup rationale applies to Claude and Codex (both prune transcripts); Gemini/Copilot are archived too for consistency.

## Phasing

- **Phase 1 — Codex (highest ROI).** Adapter contract + `claude.ts` refactor (no behavior change) + `codex.ts` (rich: tokens, cost, model, tools) + `harness` tag + capability map + `harness` filter in frontend + `/codex` page + OpenAI pricing entries + per-harness archive/consolidate namespacing.
- **Phase 2 — Gemini + Copilot (local).** `gemini.ts` + `copilot.ts` (sessions, projects, activity, message/turn counts; tokens/cost = N/A) + `/gemini`, `/copilot` pages + the unified page with per-harness legends.
- **Phase 3 — Gemini OTel (tokens/cost).** Ingest Gemini's OpenTelemetry export to recover tokens/cost/model. See below.

### Phase 3 detail — Gemini OpenTelemetry ingestion

Gemini CLI does not persist tokens/cost locally, but supports OpenTelemetry telemetry export. agentistics already runs an OTel pipeline (`packages/server/server/otel-watcher.ts`, `packages/core/src/otel.ts`) for *exporting* Claude metrics; Phase 3 adds *ingesting* Gemini's OTel.

Plan:
1. **Enable Gemini telemetry**: document/automate setting Gemini CLI to emit OTLP to a local collector endpoint (Gemini settings `telemetry` → OTLP target). The Install/Environment tab in `PreferencesModal.tsx` gets a "Connect Gemini" helper that writes the needed Gemini `settings.json` telemetry block and points it at agentistics' local OTLP receiver.
2. **Local OTLP receiver**: agentistics' server exposes a minimal OTLP/HTTP ingest endpoint (or reuses an embedded collector) that captures Gemini's `gen_ai`/token metrics (`gen_ai.client.token.usage` and equivalents) and request/model spans.
3. **Persist + normalize**: ingested Gemini telemetry is written to a per-harness store (`~/.agentistics/otel/gemini/...`) and the `gemini.ts` adapter joins it onto the local session records by session id / time window, populating `input_tokens`, `output_tokens`, `model`, and cost (via `calcCost()` with Gemini model pricing added to `MODEL_PRICING`).
4. **Capability flip**: when Gemini OTel data is present, `HARNESS_CAPABILITIES.gemini` `tokens/cost/model` are treated as available and the `/gemini` page + unified view stop showing N/A for those.
5. **Graceful absence**: if OTel is not configured, Gemini stays on Phase-2 behavior (local-only, N/A tokens). No hard dependency.

Gemini model pricing entries are added to `MODEL_PRICING` as part of this phase.

## Testing

Following the project rule (no FS mocking; test pure functions):

- `adapters/codex.test.ts` — feed a sample rollout JSONL string → assert normalized `SessionMeta` (tokens summed/last-event, model, tool counts, project from cwd). Parsing must be a pure function over file content.
- `adapters/gemini.test.ts` — sample chat JSONL → session count, timestamps, message counts, project; tokens/model = undefined.
- `adapters/copilot.test.ts` — sample `events.jsonl` → session, project/repo/branch, user-message + turn counts; tokens/model = undefined.
- `types.test.ts` — extend with OpenAI (and Gemini, Phase 3) pricing in `calcCost()` / `getModelPrice()`.
- `useData.test.ts` — `harness` filter behavior in derived stats; unified vs per-harness aggregation; capability-driven N/A.
- Refactor guard: `adapters/claude.ts` must produce byte-identical results to the pre-refactor pipeline for the existing fixtures (snapshot/parity test).

To keep parsers pure and testable, each adapter separates **file reading** (impure, thin) from **parsing/normalization** (pure, tested) — same split as the existing `parseSessionJsonl`.

## Backward compatibility

- `SessionMeta.harness` defaults to `'claude'` when absent (old consolidated/archived files).
- Existing routes/behavior for Claude-only users are unchanged; if only `~/.claude` exists, the app behaves as today (no harness tabs forced).
- Consolidated store migration: flat `~/.agentistics/sessions/<id>.json` files are read as `claude` and re-namespaced on next write.

## Out of scope

- Cursor, Aider, and other harnesses.
- Real-time streaming/live view of non-Claude harnesses (Phase-by-phase batch read; live SSE stays Claude as today unless trivially extendable).
- Cross-harness session de-duplication beyond `(harness, session_id)` keying.
