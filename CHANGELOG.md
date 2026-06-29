# Changelog

All notable changes to agentistics are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

> **Note:** Releases are published automatically on every push to `main` via GitHub Actions. This file documents the meaningful milestones. Future automation with [release-please](https://github.com/googleapis/release-please) is planned.

---

## [Unreleased]

### Added
- **Multi-harness tracking** — alongside Claude Code, agentistics now ingests **Codex CLI**, **Gemini CLI**, and **GitHub Copilot CLI** sessions via per-harness `HarnessAdapter` modules under `packages/server/server/adapters/`
- Harness selector (shown only when >1 harness has data), generic per-harness dashboards at `/h/:harness`, and a side-by-side `/compare` page with per-harness colors and comparatives
- `HARNESS_CAPABILITIES` in `@agentistics/core` drives "N/A" rendering for metrics a harness can't produce (e.g. Codex/Gemini/Copilot have no agent metrics or git line counts), instead of a misleading 0
- "Data & sources" tab per harness (`HarnessInfoPanel`) explaining each harness's data source, what's captured, and what's missing
- Archive modes (`off` / `consolidate` / `full`) that survive Claude's 30-day transcript cleanup, gated by a first-run consent modal
- **Full mobile/responsive support** — responsive layouts gated on `useIsMobile()`, a bottom nav with a square-tile "More" sheet (hosting settings/live/refresh/warnings), a collapsible sticky filter bar, full-screen modals on mobile, and iOS-aware PWA install guidance

### Fixed
- iOS `position: sticky` broke under `overflow-x: hidden`; switched mobile `html/body/#root` to `overflow-x: clip`
- Mobile Models dropdown was clipped by the filter collapse-animation wrapper's `overflow: hidden`

### Changed
- `stats-cache.json` is treated as Claude-only; non-Claude harnesses are aggregated purely from per-session data so Claude totals are never corrupted
- README now describes agentistics as a multi-harness dashboard; `docs/mcp.md` documents the MCP's unified (all-harness) scope

---

## [0.4.0] — 2026-04-10

### Added
- `agentop` binary with embedded frontend — single-file distribution via `agentop server`
- CI/CD pipeline: GitHub Actions builds and publishes Linux x86_64 binary on every push to main
- One-line installer (`install.sh`)
- Terminal UI (`agentop tui`) with live metrics, streak, cost, and project breakdown
- OpenTelemetry metrics export via `agentop watch` daemon

### Fixed
- `embeddedDist` import now lazy-loaded — fresh clones can run `bun dev` without building assets first
- Chart X-axis date disorder caused by unsorted `heatmapData` after dailyActivity supplement
- Session count inconsistency between header (stale statsCache), stat card, and projects modal

### Changed
- Project renamed from `claude-stats` to `agentistics`; binary renamed to `agentop`
- Light theme overhauled with premium neutral palette

---

## [0.3.0] — 2026-03-15

### Added
- PDF export modal with per-model cost breakdown and session highlights
- Health warnings panel with auto-fix suggestions
- Git statistics per project (commits, pushes, lines added/removed, files modified)
- OpenTelemetry metrics export and watcher/daemon mode

### Fixed
- PDF: fixed cut pages, inconsistent widths, and white background in dark theme
- Sessions crash and blended cost rate in PDF export
- `HOME` hardcoded path in ProjectsModal replaced with `formatProjectName`

---

## [0.2.0] — 2026-02-20

### Added
- Activity heatmap (GitHub-style) with streak calculation
- Hour-of-day chart
- Model breakdown with per-model cost
- Projects list with session/message/tool counts
- Recent sessions panel
- Highlights board (records and personal bests)
- Dark/light theme toggle
- PT/EN language toggle
- Live updates via SSE with configurable interval
- Date range filters (7d, 30d, 90d, All) and custom date picker
- Multi-project filter with search modal
- BRL cost conversion via live exchange rate

### Fixed
- Streak counts backward from today; starts from yesterday if today has no activity

---

## [0.1.0] — 2026-01-06

### Added
- Initial dashboard: tokens, cost, sessions, messages, tool calls
- Reads `~/.claude/projects/**/*.jsonl` and `~/.claude/stats-cache.json`
- Bun + React 19 + Vite + Recharts stack
- Session metadata enrichment from `~/.claude/usage-data/session-meta/`
