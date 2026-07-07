# Sessions tab, Workflows tab & central chat-privacy cut — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan

## Summary

Three related changes, shipped together, all aligned with the project's existing privacy principle ("members never push chat; the central never sees conversation content"):

1. **Sessions tab (local-only)** — a new `/sessions` page listing *live* sessions (heuristic) plus the N most recent sessions, each with project path and a copy-ready resume command.
2. **Central chat-privacy cut** — remove, end-to-end, the central's ability to view a member's conversation content. Session metadata cards stay; only the on-demand chat fetch/view is removed.
3. **Workflows tab** — a new `/workflows` page detailing each Workflow-tool run (phases, agent count, agent names/labels, model, in/out tokens, cost in BRL and BRL-per-million), parsed from data Claude Code already writes to disk. Persisted to the consolidate store so runs survive Claude's 30-day cleanup.

These are independent enough to build in parallel but ship in one spec/PR.

---

## Block 1 — Sessions tab (local)

### Purpose

Answer, for the user's own machine: "which sessions do I have open right now, and which recent one do I resume?" Pure self-insight. Not a team/central feature.

### Scope & visibility

- New route `/sessions` with a nav entry.
- Visible in **solo** and **member** modes (own machine only). **Hidden on central** — the central already has WebSocket-authoritative presence; it must not gain a per-member live-session view (that would be the surveillance line we explicitly avoid). Gate with the existing `teamSession?.central === true`.

### "Live" detection (heuristic)

There is no explicit running-process signal in the data. A session is considered **live** when its last activity (last message timestamp / transcript mtime) is within a threshold, default **10 minutes** (`LIVE_THRESHOLD_MIN`). No new heartbeat/hook is introduced. This is best-effort and reliable primarily for Claude; other harnesses are still listed but "live" is a soft signal.

### Layout

Two zones on the page:

- **Live** — sessions under the threshold, pinned at top, each with a `● ao vivo` / `● live` badge.
- **Recent** — the N most recent sessions overall (default **5**, selectable **5 / 10 / 20 / 50**, persisted in preferences as `sessionsRecentCount`). A live session that is also among the most recent appears in the Live zone (not duplicated).

Each card reuses the existing session-card shape (harness chip, title via `sessionLabel()`, path, tokens, cost in BRL, relative last-activity) and adds:

- **Resume block** (copy button):
  - Claude: `cd <projectPath> && claude --resume <sessionId>`
  - Other harnesses (codex/gemini/copilot): show the **path only** (no resume command — not all have a stable resume UX). Do not fabricate a command.

Clicking a card opens the existing `SessionDrilldownModal` (unchanged in solo/member).

### Data & implementation notes

- Built on top of the session data already returned by `/api/data` — no new push/ingest/schema changes. "Live" is computed client-side (or in a small server helper) from each session's last-activity timestamp.
- Reuse `RecentSessions` card internals where practical; the Sessions page is an enriched view (live grouping + resume block + count selector), not a rewrite.
- `sessionsRecentCount` and (optionally) `liveThresholdMin` live in `~/.agentistics` preferences via the existing `/api/preferences` flow.

---

## Block 2 — Central chat-privacy cut (end-to-end)

### Purpose

Today a central can open a member's session and read the actual conversation text. That is *content*, not a metric, and it contradicts the project's stated principle. Remove the capability entirely — not just hide it — so even a tampered/old central cannot pull chat from an updated member.

### What stays vs what goes

- ✅ **Stays:** the "Recent sessions" metadata cards (path, title, harness, tokens, msgs, tools, files, timestamp) and the `SessionDrilldownModal` metrics view (tokens/cost/tools). These are metadata only.
- ❌ **Goes:** viewing a member's conversation content — the `RemoteSessionChat` block inside the drilldown and the entire on-demand chat pipeline behind it.

### Changes

**Frontend**
- `web/src/components/SessionDrilldownModal.tsx`: remove the `{central && session.user && <RemoteSessionChat .../>}` block (~line 608) and delete the `RemoteSessionChat` component and its fetch helper.
- Hide the "View transcript" button in the drilldown header when `central` (it targets local endpoints, but removing it avoids confusion on an aggregator).

**Server**
- `server/index.ts`: `GET /api/team/session-chat` (~line 1128) returns **410 Gone**; remove the entry from `ADMIN_PATHS` (~line 131) and the now-unused import.
- `server/team-agent.ts`: remove/neutralize `handleSessionChat`, `requestChat`, and the `chat-result` resolution. **Keep** WebSocket agent registration, presence, and ping/pong — only the chat request/response path is removed.
- `server/team-agent-client.ts` (member side): remove the `fetch-chat` handler and `fetchLocalMessages` so a member never serves conversation content, even to an old central.

### Result

The reverse WebSocket keeps doing presence/latency; the chat channel no longer exists at any layer. `TtyChat` (the local "Nay" assistant) is unrelated and untouched.

---

## Block 3 — Workflows tab

### Purpose

A detailed view of every Workflow-tool orchestration run: its phases, how many agents ran, their names/labels, model, in/out tokens, and cost (BRL + BRL-per-million). This is the deep drill-down the current Agent metrics can't provide (Agent metrics have no model and no phase concept).

### Data source (already on disk — no user instrumentation needed)

Claude Code already writes everything; agentistics simply doesn't read it yet:

- In the main session JSONL: a `tool_use` with `name: "Workflow"` (its `input.script` holds `export const meta = { name, description, phases:[{title}] }` and `await agent(prompt, { label, phase, model })` calls), and a `toolUseResult` with `status: "async_launched"`, `taskType: "local_workflow"`, `workflowName`, `runId`, `summary`, `transcriptDir`, `scriptPath`.
- A later `<task-notification>` user message whose `<usage>` block carries `agent_count`, `agents_done/error/skipped`, `subagent_tokens`, `tool_uses`, `duration_ms`, and whose `<result>` carries final status.
- On disk under `~/.claude/projects/<proj>/<sessionId>/subagents/workflows/<runId>/`:
  - `journal.jsonl` — `{type:"started"|"result", key, agentId, result}` per agent.
  - `agent-<id>.jsonl` — full per-subagent transcript **with `model` and complete `usage`** (aggregate exactly like a normal session).
  - `agent-<id>.meta.json` — `{"agentType":"workflow-subagent","spawnDepth":N}`.
  - `workflows/scripts/<name>-<runId>.js` — the saved script.

### New instrumentation

**`server/workflow-metrics.ts`** (new module, analogous to `agent-metrics.ts`):
- Detect a workflow run via `toolUseResult.taskType === 'local_workflow'` (and/or `tool_use.name === 'Workflow'`).
- Discover and read `subagents/workflows/<runId>/` recursively (`data.ts` currently does not descend into this subdir — that must change).
- Aggregate tokens/cost per agent from each `agent-*.jsonl` using the same per-model logic as a normal session (`calcCost` + `MODEL_PRICING`).
- Parse the saved `script` for `meta.phases[].title`, and the `agent({label, phase, model})` calls to recover phase membership, labels, and **model** per planned agent.
- Parse the `<task-notification>` / `<usage>` text (regex over the XML string) for final status, agent counts, and duration.
- Correlate journal `result` entries to agents where useful.

**`data.ts`:** descend into `subagents/workflows/` during session scanning and attach discovered runs.

**`core/types.ts` — new types:**
```
WorkflowRun {
  runId: string
  name: string
  sessionId: string
  status: 'completed' | 'failed' | 'partial'
  startedAt / durationMs
  phases: { title: string; agentCount: number }[]
  agents: {
    label: string
    phase: string
    model: string
    tokensIn / tokensOut / cacheRead / cacheWrite: number
    costUSD: number
    status: 'completed' | 'failed' | 'skipped'
    toolStats?: {...}
  }[]
  totals: { agentCount, tokensIn, tokensOut, costUSD, durationMs, toolUses }
}
```
(The existing `AgentInvocation` is not reused — it lacks `model` and any phase concept.)

### Persistence (survive the 30-day cleanup)

Workflow transcripts under `subagents/workflows/` are deleted by Claude's cleanup along with the rest of the transcript. Because runs are expensive and interesting, persist each `WorkflowRun` to the **consolidate** store (namespaced like sessions, e.g. `~/.agentistics/workflows/<runId>.json`, skip-if-identical) and revive on read when the live source is gone. This mirrors the existing session-consolidation behavior and its "no false metrics" guarantees (dedup by `runId`, live wins). Honors `AGENTISTICS_ARCHIVE=0` and the archive-mode gate exactly like session consolidation.

### Frontend `/workflows`

- New route + nav entry.
- Grouped by **session** → each **workflow run** rendered as an expandable block:
  - Header: workflow name, status, agent count, total tokens, total cost (BRL), duration.
  - Phases as sections; under each phase, its agents.
  - Per-agent row: label, model, in/out tokens, cost in **R$** and **R$/M** (from `MODEL_PRICING` × BRL rate via `/api/rates`), status, tool stats.
- Cost/BRL uses the existing `@agentistics/core` pricing functions and the `/api/rates` BRL rate — never inline pricing.

### Capabilities

Workflow runs are Claude-only in practice (the Workflow tool is a Claude Code feature). Non-Claude harnesses simply have no workflow data; the tab shows an empty state for them.

---

## Out of scope (explicit)

- No new member→central push fields; the central gains nothing from Blocks 1 & 3.
- No aggregated "N active sessions in the team" counter on the central (possible future iteration, deliberately deferred).
- No real running-process detection (no heartbeat/hook); "live" stays heuristic.
- No backfill of `model` into the existing Agent metrics pipeline.

## Testing

- Pure parsers get unit tests (no fs mocking — feed fixture strings/objects):
  - `workflow-metrics` script parser (phases/labels/model extraction) and `<usage>` text parser.
  - per-agent token/cost aggregation from a fixture `agent-*.jsonl`.
  - "live" classification from a last-activity timestamp vs threshold.
- Follow existing test conventions (`bun test`, pure functions only).
