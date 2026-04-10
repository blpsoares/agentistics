# Changelog

All notable changes to agentistics are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

> **Note:** Releases are published automatically on every push to `main` via GitHub Actions. This file documents the meaningful milestones. Future automation with [release-please](https://github.com/googleapis/release-please) is planned.

---

## [Unreleased]

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
