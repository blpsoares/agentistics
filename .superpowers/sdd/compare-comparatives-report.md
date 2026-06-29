# Compare Comparatives — Implementation Report

**Branch:** worktree-multi-harness-codex
**Date:** 2026-06-21

## Summary

Extended the harness comparison page with four new comparative sections: hour-of-day usage, busiest day of week, activity over time, and token/cost peaks — all per harness, side by side.

---

## New Fields in `HarnessSummary`

Exported interface added to `packages/web/src/hooks/useData.ts`, extending the previous anonymous return type.

| Field | Type | Description |
|-------|------|-------------|
| `hourCounts` | `number[]` (len 24) | Message count per hour 0–23 |
| `peakHour` | `number \| null` | Hour with highest count; null if no data |
| `dowCounts` | `number[]` (len 7) | Session count per day-of-week, 0=Sunday |
| `peakDow` | `number \| null` | Day index with highest count; null if no data |
| `dailyActivity` | `{ date: string; sessions: number }[]` | Per-day session counts, sorted ascending |
| `peakTokenDay` | `{ date: string; tokens: number } \| null` | Day with most tokens; null for no-token harnesses |
| `peakSessionCost` | `number \| null` | Highest single-session cost; null for no-cost harnesses or Claude |

---

## Data Sources — Claude vs Non-Claude

### Claude (sources from `statsCache` — survives 30-day cleanup)

| Field | Source |
|-------|--------|
| `hourCounts` | `statsCache.hourCounts` — `Record<string, number>` keyed by string hour ("0".."23") |
| `dowCounts` | `statsCache.dailyActivity` — `getDay(parseISO(d.date))` weighted by `d.sessionCount` |
| `dailyActivity` | `statsCache.dailyActivity.map(d => ({ date, sessions: d.sessionCount }))` sorted ascending |
| `peakTokenDay` | `statsCache.dailyModelTokens` — sum all `tokensByModel` values per day, take max |
| `peakSessionCost` | Always `null` — statsCache has no per-session cost breakdown |

### Non-Claude (computed from `data.sessions` filtered by harness)

| Field | Source |
|-------|--------|
| `hourCounts` | Sum `session.message_hours` entries (each is an hour 0–23) |
| `dowCounts` | `getDay(parseISO(session.start_time))` — +1 per session |
| `dailyActivity` | Group sessions by `format(parseISO(start_time), 'yyyy-MM-dd')`, +1 per session |
| `peakTokenDay` | Group by day, sum `input_tokens + output_tokens`; `null` if `!HARNESS_CAPABILITIES[h].tokens` |
| `peakSessionCost` | `calcCost(usage, session.model)` per session, take max; `null` if `!HARNESS_CAPABILITIES[h].cost` |

Helper `peakIndex(arr: number[]): number | null` returns the index of the max value, or null if all zero.

---

## UI Sections Added to ComparePage

Three new helper components added above `export default function ComparePage()`:

- **`MiniBarChart`** — CSS-only 24-bar (or 7-bar) chart. Peak bar renders at full color; others at `color + '55'` (33% opacity). Height is percentage of container.
- **`SparklineChart`** — CSS-only sparkline with one bar per day. Falls back to "No data" text when `data.length === 0`.
- **`SectionCard`** — Shared card wrapper matching existing card styling (`--bg-card`, `--border`, `--radius-lg`).

Four new sections below the existing session-share card:

1. **Usage by hour of day** — Small-multiples grid (one column per harness). 24-bar mini chart colored with `HARNESS_COLORS[harness]`, peak bar highlighted, peak hour labeled as `Peak HH:00`. Shows `NACell` when no message_hours data.
2. **Busiest day of week** — 7-bar chart per harness with single-letter day labels (S M T W T F S). Peak day shown in harness color + bold. Peak name rendered below (`Peak: Wed`).
3. **Activity over time** — Sparkline per harness from `dailyActivity`, with date range shown as `YYYY-MM-DD – YYYY-MM-DD`.
4. **Peaks** — Table matching existing comparison table style. Two rows: "Busiest token day" (date + `fmt(tokens)`) and "Peak session cost" (`fmtCost(psc, currency, brlRate)`). N/A via `NACell` for harnesses where `!capable(h, 'tokens')` / `!capable(h, 'cost')`. Dash `—` when capable but no data yet.

All numbers formatted via `fmt` / `fmtCost` from `@agentistics/core`. No inline cost math.

---

## Verification Outputs

### `bun tsc --noEmit`
Zero errors across all tasks.

### `bun test`
118 tests pass, 0 failures.

New test describe blocks added (22 new tests):
- `computeHarnessSummaries — hourCounts and peakHour` (4 tests)
- `computeHarnessSummaries — dowCounts and peakDow` (3 tests)
- `computeHarnessSummaries — peakTokenDay and peakSessionCost` (6 tests)
- `computeHarnessSummaries — dailyActivity` (1 test)

### `bun run build`
Success (1.14s).

---

## Commit Hashes

| Commit | Description |
|--------|-------------|
| `201d830` | `feat(web): add hour/day/activity/peak fields to computeHarnessSummaries` |
| `13df515` | `test(web): add focused tests for hour/dow/activity/peak harness fields` |
| `2ef6de9` | `feat(web): render usage-peak comparatives on the Compare page` |

---

## Concerns and Trade-offs

1. **Claude `peakSessionCost` is always `null`**: statsCache only stores per-model aggregates, not per-session breakdowns. This is intentional — the UI renders `—` (dash) rather than N/A, since Claude *is* capable of cost but lacks per-session granularity in the aggregate store. Sessions present in `data.sessions` for Claude could be used if needed in a future iteration.

2. **Claude `hourCounts` lags live data**: `statsCache.hourCounts` is only written during background scans. If a user has been working since the last scan, the live Claude sessions won't appear in the hour chart. This matches the existing behavior for all other Claude statsCache-sourced metrics.

3. **Claude `dowCounts` uses session counts, not message counts**: `statsCache.dailyActivity` provides `sessionCount`, so Claude DoW is weighted by sessions. Non-Claude uses +1 per session (same granularity). Consistent.

4. **`peakTokenDay` for Claude sums all models together**: `dailyModelTokens[date].tokensByModel` values are summed — this is total token volume regardless of model, which is the appropriate metric for "busiest day".

5. **Sparkline readability**: With many days of data, individual bars become sub-pixel wide. The `minWidth: 1` ensures bars remain visible, but color differentiation may be lost at very long histories. A future enhancement could sub-sample or use a proper SVG line chart.

6. **`DOW_LABELS` day index**: `getDay()` from date-fns returns 0=Sunday per JS `Date` convention. The `DOW_LABELS = ['Sun', 'Mon', ...]` array is aligned to this, so `DOW_LABELS[peakDow]` always produces the correct label.
