# Multi-Harness Feature-Parity Verification & Implementation Plan

**Date:** 2026-06-22
**Branch:** worktree-multi-harness-codex
**Status:** Plan (ready to execute)
**Synthesized from:** `audit-code.md`, `audit-sessions-chat.md`, `audit-codex.md`, `audit-gemini.md`, `audit-copilot.md`

---

## 0. Context a fresh developer needs

agentistics tracks 4 AI-coding harnesses. Each one has an adapter under
`packages/server/server/adapters/` that normalizes its on-disk data into the
shared `SessionMeta` type (tagged with `harness: 'claude' | 'codex' | 'gemini' | 'copilot'`).

The **data layer** is already harness-aware and largely correct:
- `useData.ts` `filterByHarness()` (L193) filters sessions by `s.harness ?? 'claude'`.
- `useDerivedStats` aggregates non-Claude harnesses from per-session sums (never from `stats-cache.json`, which is Claude-only).
- `HARNESS_CAPABILITIES` in `packages/core/src/types.ts` (L57) is the single source of truth for what each harness can produce.

The **UI and infra layers** still behave as if only Claude exists. This plan fixes that.

### Capability matrix (ground truth — `packages/core/src/types.ts` L57)

| harness  | tokens | cost | model | tools | agents | gitLines | has real conversation transcript? | has live sessions? |
|----------|--------|------|-------|-------|--------|----------|-----------------------------------|--------------------|
| claude   | ✅     | ✅   | ✅    | ✅    | ✅     | ✅       | ✅ (`~/.claude/projects/**/*.jsonl`) | ✅ |
| codex    | ✅     | ✅   | ✅    | ✅    | ❌     | ❌       | ✅ (`~/.codex/sessions/Y/M/D/rollout-*.jsonl`) | ✅ |
| gemini   | ❌     | ❌   | ❌    | ❌    | ❌     | ❌       | ❌ (only A2A bootstrap stubs, **0 real sessions**) | ❌ |
| copilot  | ❌*    | ❌*  | ❌*   | ❌    | ❌     | ❌*      | ✅ (`~/.copilot/session-state/<id>/events.jsonl`) | ✅ |

\* Copilot `events.jsonl` DOES carry tokens/cost/model/lines/files in the `session.shutdown` event — but only on a **clean shutdown**. Capabilities are currently all `false`. See WS-G (optional capability upgrade) below.

### Helpers you will reuse (do not reinvent)

- `capable(harness, metric)` and `<NAtag />` — `packages/web/src/lib/harness.ts`.
- `HARNESS_LABELS`, `HARNESS_COLORS`, `HARNESS_INFO` — `packages/web/src/lib/harness.ts`.
- `derived.modelUsage` / `derived.filteredSessions` / `derived.firstSessionDate` / `derived.lastSessionDate` — `useDerivedStats` in `useData.ts` (already harness-filtered).
- `getEnabledAdapters()` — `packages/server/server/adapters/types.ts` (async, memoized).

### Two findings from the audits that are already RESOLVED in code (do NOT re-do)

1. **GPT pricing exists.** `audit-codex.md` gap #4 ("MODEL_PRICING needs Codex model ids") is **stale** — `MODEL_PRICING` already has `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5`, `gpt-5-mini` (types.ts L228-232) and `formatModel()` maps them. No work needed unless a new GPT id shows up.
2. **Session-list harness filtering works.** Only the *open action* and the *missing badge* are broken (F01/F02), not the filtering itself.

---

## 1. The golden rule for every "Claude-only" feature

For each feature below, decide one of exactly three outcomes per harness:

- **A — become harness-aware:** read the active harness's own data / per-session sums.
- **B — render per-harness data** that already exists in `SessionMeta` (just label it correctly).
- **C — show honest N/A** via `capable(harness, metric)` + `<NAtag />`, never a misleading `0` or Claude's number.

When a harness has **no data at all** for a feature (e.g. Gemini chat, Gemini sessions), the answer is **C — render N/A / disabled**, NOT "build an empty viewer".

---

## 2. Workstreams (grouped for parallel execution)

Eight workstreams. Dependency/serialization rules are in §4. Effort is rough dev-days.

| WS | Title | Findings | Priority | Effort |
|----|-------|----------|----------|--------|
| WS-A | Session list & drilldown harness-awareness | F01, F02, F18 | **P0** | 1.5d |
| WS-B | Chat / transcript viewer (Codex + Copilot read-only; Gemini N/A) | F03, F04, +sessions-chat §3 | **P0** | 4d |
| WS-C | Metric panels: harness gates (Budget, Cache, Highlights) | F06, F07, F18 | **P0** | 2d |
| WS-D | Model filter + cost-calc sources (PDF, drilldown fallback) | F05, F14, F15 | **P0/P1** | 1.5d |
| WS-E | Header dates + KPI info-modal + labels copy | F08, F11, F13, F16, F17, F20, F21 | **P1/P2** | 1.5d |
| WS-F | Infra: SSE watcher, OTel watcher, TUI, health, projects-list | F09, F10, F12, F19, F22 | **P1/P2** | 4d |
| WS-G | (Optional) Adapter enrichment: Codex first_prompt/hours; Copilot tokens/model | audit-codex 2&3, audit-copilot | **P1** | 2d |
| WS-H | Adapter interface: add `dataRoot` (enabler for WS-F) | F19 prerequisite | **P0 for WS-F** | 0.5d |

**P0 count: 4 workstreams (WS-A, WS-B, WS-C, WS-D) + WS-H as the WS-F enabler.**

---

## 3. Feature-by-feature spec

Format per feature: (a) today, (b) target per harness, (c) feasibility grid, (d) touch-points, (e) priority/risk/effort.

---

### WS-A — Session list & drilldown harness-awareness

#### F01 — Session row harness badge (missing)
- **(a) Today:** `RecentSessions.tsx` rows show project, prompt excerpt, chips, and a `SourceDot` (`_source`: meta/jsonl/subdir) but **no harness indicator**. Codex/Copilot rows are visually identical to Claude.
- **(b) Target:** Add a small colored chip using `HARNESS_LABELS[s.harness]` + `HARNESS_COLORS[s.harness]`. Render only in the unified "All" view (`!filters.harness`) to avoid noise in single-harness views.
- **(c) Grid:** claude→"Claude" chip; codex→"Codex"; gemini→(none, 0 sessions); copilot→"Copilot". All from `SessionMeta.harness`, no server change.
- **(d) Touch-points:** `packages/web/src/components/RecentSessions.tsx` (~L119-141 `SourceDot` area, and the row render ~L388-550); import from `packages/web/src/lib/harness.ts`. Pass `filters.harness` down from `HomePage.tsx`/`HarnessPage.tsx` if not already in scope.
- **(e)** P0 · risk Low · effort 0.5d.

#### F02 — "Open in Claude" button fires for all harnesses
- **(a) Today:** `RecentSessions.openSession()` (L222-238) and `SessionDrilldownModal` header button (L199-218) unconditionally dispatch `agentistics:open-chat` with `tab:'claude'` for every non-Nay session, and hardcode the label "Claude" (RecentSessions L478/L506). A Codex/Copilot row therefore queries `/api/claude-sessions/:id` → empty/404.
- **(b) Target:** Branch on `s.harness`:
  - `claude`/`nay` → existing behavior, label "Claude"/"Nay".
  - `codex` → dispatch `tab:'codex'`, label "Codex" (wired in WS-B).
  - `copilot` → dispatch `tab:'copilot'`, label "Copilot" (wired in WS-B).
  - `gemini` → hide the button (no transcript exists).
  Gate availability on a small helper, e.g. `canOpenTranscript(harness)` returning false for gemini.
- **(c) Grid:** claude→open Claude viewer; codex→open Codex viewer; copilot→open Copilot viewer; gemini→**button hidden (N/A)**.
- **(d) Touch-points:** `RecentSessions.tsx` L222-238, L478, L506; `SessionDrilldownModal.tsx` L199-218. Depends on WS-B for the `tab:'codex'`/`'copilot'` routes to actually work; ship the branching together with WS-B or behind a guard.
- **(e)** P0 · risk High · effort 0.5d (the routing target is WS-B).

#### F18 — HighlightsBoard shows 0-token "records" for incapable harnesses
- **(a) Today:** `HighlightsBoard.tsx` computes "Most input tokens" / "Most output tokens" across `filteredSessions`. For gemini/copilot (tokens always 0) it crowns a 0-token session as the "record".
- **(b) Target:** Accept a `harness` prop; for each token/cost card, gate on `capable(harness, 'tokens')` / `capable(harness, 'cost')`. If incapable → hide that card or show `<NAtag />`.
- **(c) Grid:** claude→all cards; codex→token+cost cards yes, no agent/gitLines cards; gemini→token/cost/tool cards hidden; copilot→token/cost cards hidden until WS-G upgrades caps.
- **(d) Touch-points:** `packages/web/src/components/HighlightsBoard.tsx`; pass `filters.harness` from `HomePage.tsx`.
- **(e)** P0 · risk Medium · effort 1d.

---

### WS-B — Chat / transcript viewer

The audits split this into "view a past session transcript" vs "chat live with Claude". **These must be separated** (F04): the live "Nay/Claude" chat (`/api/chat-tty` → `streamViaClaude`) is intentionally Claude-only and stays as-is. What changes is the **session-transcript viewer** opened from a session row.

#### F03 / F04 — Harness-aware transcript viewer
- **(a) Today:** `TtyChat.tsx` has exactly two tabs, union `'nay' | 'claude'` (L840). The `agentistics:open-chat` handler (L931-998) only understands `tab:'claude'` and always fetches `/api/claude-sessions/:id?encodedDir=...`, parsed as Claude JSONL. `claude-sessions.ts` reads `~/.claude/projects/<encodedDir>/<uuid>.jsonl`. There is no server route for Codex/Copilot transcripts.
- **(b) Target:**
  - **Server:** add per-harness transcript readers + routes.
    - `GET /api/codex-sessions/:id` → new `codex-sessions.ts` that locates the rollout file by `session_id` (scan `~/.codex/sessions/**` or reuse the `codex.ts` adapter file index) and parses turns: `event_msg.payload.type==='user_message'` → `{role:'user', content: payload.message}`; `event_msg.payload.type==='agent_message' && payload.phase==='final_answer'` → `{role:'assistant', content: payload.message}` (include `commentary` with a visual marker or skip). Field paths verified in `audit-codex.md` §"Chat reconstruction".
    - `GET /api/copilot-sessions/:id` → new `copilot-sessions.ts` reading `~/.copilot/session-state/<id>/events.jsonl`: `user.message.data.content` → user; `assistant.message.data.content` (phase `final_answer`) → assistant; pair by `data.interactionId`. Read-only (no send). Paths verified in `audit-copilot.md` §"Conversation reconstruction recipe".
  - **Frontend:** extend the `agentistics:open-chat` tab union to `'nay' | 'claude' | 'codex' | 'copilot'`; add read-only viewer tabs (reuse `ClaudeChat.tsx` as a generic transcript renderer with a `harness` + `endpoint` prop, OR a new `TranscriptViewer.tsx`). The viewer must NOT show a send box for codex/copilot.
- **(c) Grid:**
  - claude → existing live + transcript viewer.
  - codex → **read-only transcript viewer** (rich, full user+assistant turns). No send.
  - copilot → **read-only transcript viewer** (only 2/7 local sessions have `events.jsonl`; handle truncated/crashed sessions gracefully). No send.
  - gemini → **N/A**: no transcript on disk (A2A stubs only). Button hidden by F02; if reached, show "No transcript available for Gemini sessions".
- **(d) Touch-points:**
  - New: `packages/server/server/codex-sessions.ts`, `packages/server/server/copilot-sessions.ts`.
  - `packages/server/server/index.ts` — register the two new routes (mirror L296-321 Claude routes).
  - `packages/web/src/components/TtyChat.tsx` L840 (union), L931-998 (handler routing by `tab`).
  - `packages/web/src/components/ClaudeChat.tsx` (generalize) or new `TranscriptViewer.tsx`.
  - Add tests next to `codex-parse.test.ts` / `copilot-parse.test.ts` for the new transcript readers.
- **(e)** P0 · risk High · effort 4d. **Codex first** (best ROI: full transcript), Copilot second, Gemini = explicit N/A.

---

### WS-C — Metric panels: harness gates

#### F06 — BudgetPanel reads Claude statsCache, never suppressed
- **(a) Today:** `BudgetPanel.tsx` computes month spend from `statsCache.dailyModelTokens` (Claude-only), no `harness` awareness. With a Codex/gemini/copilot filter active it shows **Claude's** budget bar.
- **(b) Target:** add `harness` prop.
  - claude / unset → existing statsCache path.
  - codex (cost capable) → compute month spend from per-session Codex cost (use `derived` per-session sums, not statsCache).
  - gemini/copilot (cost `false`) → `<NAtag />` or hide the panel.
- **(c) Grid:** claude→statsCache; codex→per-session cost; gemini→N/A; copilot→N/A (until WS-G).
- **(d) Touch-points:** `packages/web/src/components/BudgetPanel.tsx`; callers `HomePage.tsx` L189, `componentCatalog.tsx` L324-328 (pass `ctx.filters.harness`).
- **(e)** P0 · risk High · effort 1d.

#### F07 — CacheHitRatePanel never suppressed
- **(a) Today:** computes from `filteredModelUsage`. For gemini/copilot all cache fields are 0 → renders a misleading "0% hit rate". For codex it's real but unlabeled.
- **(b) Target:** add `harness` prop + `capable(harness,'tokens')` gate. Incapable → `<NAtag />`/hide. Codex → render (real data).
- **(c) Grid:** claude→render; codex→render; gemini→N/A; copilot→N/A (until WS-G).
- **(d) Touch-points:** `packages/web/src/components/CacheHitRatePanel.tsx`; callers `HomePage.tsx` L194, `CostsPage.tsx` L53-54.
- **(e)** P0 · risk High · effort 0.5d.

(F18 is shared with WS-A; implement in whichever WS touches `HomePage` props first, but keep the edit atomic.)

---

### WS-D — Model filter + cost-calc sources

#### F05 — Model filter only surfaces `claude-*`
- **(a) Today:** `App.tsx` L1081-1091 builds the model dropdown with two `startsWith('claude-')` guards, so GPT-5.x models are excluded.
- **(b) Target:** remove both `claude-` guards; include every `s.model` found in `data.sessions` plus statsCache keys.
- **(c) Grid:** claude→claude models; codex→GPT models now appear; gemini/copilot→no models (none on disk; copilot gains models only with WS-G).
- **(d) Touch-points:** `packages/web/src/App.tsx` L1081-1091.
- **(e)** P0 · risk High · effort 0.25d.

#### F14 — PDF export blended rates from Claude statsCache
- **(a) Today:** `PDFExportModal.tsx` L732/L1047/L1078-1079 use `data.statsCache.modelUsage` for blended rates and the available-models list → wrong costs / missing GPT models when Codex filter active.
- **(b) Target:** use `derived.modelUsage` (harness-filtered) instead.
- **(c) Grid:** claude→same numbers; codex→correct GPT-blended rates; gemini/copilot→cost N/A (no models).
- **(d) Touch-points:** `packages/web/src/components/PDFExportModal.tsx` L732, L1047, L1078-1079; ensure `derived.modelUsage` is passed in.
- **(e)** P1 · risk Medium · effort 0.5d.

#### F15 — SessionDrilldownModal cost fallback uses Claude globalModelUsage
- **(a) Today:** `App.tsx` L1812 passes `globalModelUsage={data.statsCache.modelUsage}`; `SessionDrilldownModal.tsx` L57-75 `sessionCost()` falls back to `blendedCostPerToken(globalModelUsage)` (Claude mix) when `session.model` is missing.
- **(b) Target:** pass `derived.modelUsage` instead. (Codex sessions almost always have a model so impact is the fallback path only, but it's the correct source.)
- **(c) Grid:** claude→same; codex→correct fallback mix; gemini/copilot→cost shown as N/A elsewhere.
- **(d) Touch-points:** `packages/web/src/App.tsx` L1812 (prop source).
- **(e)** P1 · risk Medium · effort 0.25d. **Note:** F14+F15 are tiny but both edit shared files (`App.tsx`, PDFExportModal) — see serialization in §4.

---

### WS-E — Header dates, KPI info-modal, label copy

#### F20 — Header "Since" date is Claude-only
- **(a) Today:** `App.tsx` L1415-1420 uses `statsCache.firstSessionDate`.
- **(b) Target:** when `filters.harness` is non-Claude, use `derived.firstSessionDate`.
- **(d)** `App.tsx` L1415-1420. **(e)** P1 · Low · 0.25d.

#### F21 — Header "Updated" date is Claude-only
- **(a) Today:** `App.tsx` L1409-1411 uses `statsCache.lastComputedDate` (never updates for Codex).
- **(b) Target:** non-Claude → show `derived.lastSessionDate`, or hide.
- **(d)** `App.tsx` L1409-1411. **(e)** P2 · Low · 0.25d.

#### F08 — KPI info-modal sources hardcoded `~/.claude/...`
- **(a) Today:** `App.tsx` L1153-1295 `infoItems` memo lists `~/.claude/...` source paths for every KPI.
- **(b) Target:** parameterize `infoItems` by `filters.harness`; pull correct source descriptions from `HARNESS_INFO[harness]` in `harness.ts`.
- **(d)** `App.tsx` L1153-1295; `packages/web/src/lib/harness.ts` `HARNESS_INFO`. **(e)** P1 · Medium · 0.5d.

#### F11 — ArchiveConsentModal Claude-specific copy
- **(a) Today:** title/body say "Claude Code deletes your sessions after 30 days".
- **(b) Target:** clarify the 30-day cleanup is Claude-specific; the store preserves all harnesses. Copy-only.
- **(d)** `packages/web/src/components/ArchiveConsentModal.tsx` L16-36. **(e)** P2 · Low · 0.25d.

#### F13 — PDF filename hardcoded `claude-stats-...`
- **(a) Today:** `PDFExportModal.tsx` L677/L707 save `claude-stats-YYYY-MM-DD.pdf`.
- **(b) Target:** `agentistics-[harness?-]YYYY-MM-DD.pdf` from active filter.
- **(d)** `PDFExportModal.tsx` L677, L707. **(e)** P2 · Trivial · 0.1d.

#### F16 — componentCatalog "via Claude Bash calls" sub-labels
- **(a) Today:** `componentCatalog.tsx` L183-199 hardcode "via Claude" / "via Claude Bash calls".
- **(b) Target:** neutral copy ("via Bash calls") or harness-aware; add `capable(harness,'gitLines')` guard on lines sub-labels.
- **(d)** `packages/web/src/lib/componentCatalog.tsx` L183-199. **(e)** P2 · Low · 0.25d.

#### F17 — ToolsPage subtitle names "Claude"
- **(a) Today:** `ToolsPage.tsx` L19 "Which tools Claude is using…".
- **(b) Target:** neutral "Which tools the assistant is using…".
- **(d)** `packages/web/src/pages/ToolsPage.tsx` L19. **(e)** P2 · Trivial · 0.1d.

---

### WS-F — Infrastructure (depends on WS-H for `dataRoot`)

#### F19 — SSE watcher monitors only `~/.claude/`
- **(a) Today:** `sse.ts` `setupFileWatcher()` chokidar-watches `PROJECTS_DIR` + `SESSION_META_DIR`. New Codex/Copilot sessions don't trigger a live refresh.
- **(b) Target:** also watch each enabled adapter's `dataRoot` (added in WS-H). Resolve via `getEnabledAdapters()` at startup.
- **(d)** `packages/server/server/sse.ts`; needs WS-H `dataRoot`. **(e)** P1 · Medium · 1.5d.

#### F09 — OTel watcher Claude-only, metrics `claude_stats.*`
- **(a) Today:** `otel-watcher.ts` `buildSnapshot()` reads only `STATS_CACHE_FILE`; metrics prefixed `claude_stats.*`.
- **(b) Target:** aggregate across all harnesses (sum tokens/cost only where `capable(harness,'tokens'/'cost')`); EITHER rename to `agentistics.*` (breaking) OR keep names + add a `harness` attribute. **Recommend** adding `harness` label and an aggregate, documenting the metric-name decision before shipping.
- **(d)** `packages/server/server/otel-watcher.ts`. **(e)** P2 · risk Medium (breaking for existing dashboards) · 1.5d.

#### F10 — TUI snapshot Claude-only
- **(a) Today:** `tui/index.ts` L190-270 reads statsCache directly; non-Claude sessions absent from live TUI.
- **(b) Target:** call `/api/data` (already multi-harness) or share the server aggregation fn instead of reading statsCache.
- **(d)** `packages/web/src/tui/index.ts` L190-270, L600. **(e)** P2 · Medium · 1d.

#### F12 — Health checks target `~/.claude/` only
- **(a) Today:** `health.ts` raises "Projects directory not found" when only non-Claude harnesses exist.
- **(b) Target:** if `getEnabledAdapters()` returns ≥1 non-Claude adapter with sessions, downgrade Claude-missing errors to info.
- **(d)** `packages/server/server/health.ts`. **(e)** P2 · Low · 0.5d.

#### F22 — `/api/projects-list` scans only `~/.claude/projects/`
- **(a) Today:** `index.ts` L249-277 scans `PROJECTS_DIR` for the ClaudeChat project picker.
- **(b) Target:** This endpoint powers the Claude live-chat picker only — **document it as Claude-specific** (lowest-cost). A harness-aware picker would need `adapter.loadProjects()` per harness (interface already has optional `loadProjects?`).
- **(d)** `packages/server/server/index.ts` L249-277. **(e)** P2 · Low (doc) / Medium (if generalized) · 0.5d.

---

### WS-H — Adapter interface: add `dataRoot` (enabler)
- **(a) Today:** `HarnessAdapter` (adapters/types.ts) has `id`, `isAvailable()`, `loadSessions()`, optional `loadProjects?()`. No way for `sse.ts` to know where to watch.
- **(b) Target:** add `dataRoot: string` (or `dataRoots: string[]`) to the interface and to all 4 adapters (`claude.ts`, `codex.ts`, `gemini.ts`, `copilot.ts`). Pure additive change; unblocks F19.
- **(d)** `packages/server/server/adapters/types.ts` + the 4 adapter files. **(e)** P0-for-WS-F · risk Low · 0.5d.

---

### WS-G — (Optional) Adapter data enrichment

Not parity-blocking, but high user value. Each is a pure parser change with unit-test coverage.

- **Codex `first_prompt`** (`audit-codex` #2): `codex-parse.ts` sets `first_prompt:''`. Extract first `event_msg[user_message].payload.message`. Fixes blank session titles. P1 · 0.25d.
- **Codex `message_hours`** (`audit-codex` #3): parser sets `[]`. Populate from `event_msg[user_message].timestamp` (and agent_message). Fixes flat HourChart for Codex. P1 · 0.5d.
- **Copilot capability upgrade** (`audit-copilot`): `session.shutdown.data.modelMetrics` carries inputTokens/outputTokens/cacheRead/cacheWrite, `requests.cost`, `currentModel`, `codeChanges.{linesAdded,linesRemoved,filesModified}`. Extract in `copilot-parse.ts`; then flip `HARNESS_CAPABILITIES.copilot` for tokens/cost/model/gitLines to `true` **with the caveat** that these only exist on clean shutdown (sessions that crashed will show 0 — acceptable as real-0, or keep caps `false` to stay safe). **Decide explicitly.** Touch `packages/core/src/types.ts` (caps) + `copilot-parse.ts`. P1 · 1d.
- **Copilot `first_prompt`**: extract from `user.message.data.content` or `workspace.yaml.summary`. P1 · 0.25d.
- **Gemini:** leave as-is (0 real sessions). Optionally surface `projects.json` via `loadProjects()` but flagged as "not real conversations" — low value, defer.

---

## 4. Recommended implementation workflow (parallelism & serialization)

### Shared files that REQUIRE serialized edits (one WS at a time, or coordinate)

| Shared file | WS that touch it | Serialize because |
|-------------|------------------|-------------------|
| `packages/web/src/App.tsx` | WS-D (F05,F15), WS-E (F08,F20,F21) | Many memos/props in one file; high merge-conflict risk. Do WS-E after WS-D, or one dev owns App.tsx. |
| `packages/web/src/components/PDFExportModal.tsx` | WS-D (F14), WS-E (F13) | Same file; batch F13+F14 together. |
| `packages/web/src/pages/HomePage.tsx` | WS-A (F01,F18 props), WS-C (F06,F07 props) | All add `filters.harness` prop wiring. Batch the prop-passing in one pass, then split panel internals. |
| `packages/server/server/adapters/types.ts` | WS-H, WS-G (copilot caps via core types) | WS-H must land first; it's the WS-F enabler. |
| `packages/core/src/types.ts` | WS-G (copilot capability flip only) | Single-line caps change; do last, deliberately. |
| `packages/server/server/index.ts` | WS-B (new routes), WS-F (F22 doc) | Additive route registration vs comment — low conflict but same file. |

### Can run fully in parallel (no shared-file conflicts)

- **WS-B server side** (`codex-sessions.ts`, `copilot-sessions.ts` — new files) ∥ everything.
- **WS-H** (adapter `dataRoot`) ∥ everything — land it early to unblock WS-F.
- **WS-C panel internals** (`BudgetPanel.tsx`, `CacheHitRatePanel.tsx`, `HighlightsBoard.tsx` — distinct files) ∥ each other.
- **WS-F infra** files (`sse.ts`, `otel-watcher.ts`, `tui/index.ts`, `health.ts`) are all distinct ∥ each other (after WS-H).
- **WS-G** parser files (`codex-parse.ts`, `copilot-parse.ts`) ∥ each other and ∥ most UI work.

### Suggested execution order

1. **Wave 0 (enablers, ship first):** WS-H (`dataRoot`), WS-D/F05 (one-line filter fix), WS-A/F01 (badge — pure additive). All low-risk, unblock visibility.
2. **Wave 1 (P0, parallel):**
   - Dev 1: WS-B (Codex transcript route + viewer, then Copilot) — biggest item.
   - Dev 2: WS-C (panel gates) — owns `HomePage.tsx` prop pass for F06/F07/F18.
   - Dev 3: WS-A/F02 (open routing — merges with WS-B's tabs) + WS-D/F14,F15.
3. **Wave 2 (P1/P2, after Wave 1 settles App.tsx/HomePage):**
   - WS-E (copy + header dates + info-modal) — single owner of `App.tsx`.
   - WS-F (infra, needs WS-H) — split across `sse.ts`/`otel`/`tui`/`health`.
   - WS-G (adapter enrichment) — independent.
4. **Gate:** `bun tsc --noEmit && bun test` (husky pre-commit) must pass per WS. Add tests for new transcript readers (WS-B) and parser enrichment (WS-G).

### Honest-N/A checklist (do not build empty features)

- **Gemini chat / sessions / all metrics →** N/A everywhere (0 real sessions on disk). Hide the "Open transcript" button (F02), keep the harness out of the selector until it has sessions.
- **Copilot tools, agents →** N/A (`toolRequests` always empty, no agent events).
- **Codex agents, gitLines →** N/A per capabilities.
- **Copilot tokens/cost/model →** N/A until WS-G flips capabilities (and only on clean shutdown).

---

## 5. Quick reference — every file this plan touches

**Frontend:** `RecentSessions.tsx`, `SessionDrilldownModal.tsx`, `HighlightsBoard.tsx`, `BudgetPanel.tsx`, `CacheHitRatePanel.tsx`, `TtyChat.tsx`, `ClaudeChat.tsx` (or new `TranscriptViewer.tsx`), `PDFExportModal.tsx`, `App.tsx`, `HomePage.tsx`, `CostsPage.tsx`, `ToolsPage.tsx`, `ArchiveConsentModal.tsx`, `lib/componentCatalog.tsx`, `lib/harness.ts`, `tui/index.ts`.

**Server:** `index.ts`, `claude-sessions.ts` (reference), new `codex-sessions.ts`, new `copilot-sessions.ts`, `sse.ts`, `otel-watcher.ts`, `health.ts`, `adapters/types.ts`, `adapters/{claude,codex,gemini,copilot}.ts`, `adapters/codex-parse.ts`, `adapters/copilot-parse.ts`.

**Core:** `packages/core/src/types.ts` (`HARNESS_CAPABILITIES` flip in WS-G only).
