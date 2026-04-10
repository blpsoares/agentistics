Run the full pre-PR checklist for claude-stats, then open the pull request.

## Language

Everything must be in English: PR title, PR body, commit messages, and any code comments added in this change. This is non-negotiable.

## Step 1 — Run tests

Run `bun test`. All tests must pass with 0 failures before proceeding. If any fail, fix them first.

## Step 2 — Context-aware checks

Inspect what changed in this branch and run only the relevant checks below.

**If any cost calculation was touched** (`calcCost`, `getModelPrice`, `MODEL_PRICING`, `blendedCostPerToken`):
- Verify `MODEL_PRICING` in `src/lib/types.ts` and `FALLBACK_PRICING` in `server.ts` are in sync (same models, same prices)
- Verify the per-layer cost table in `CLAUDE.md` is still accurate

**If a new model was added:**
- `MODEL_PRICING` in `src/lib/types.ts`
- `FALLBACK_PRICING` in `server.ts`
- `PRICING_PAGE_MODEL_MAP` in `server.ts` (for live price scraping)
- `CLAUDE.md` pricing section

**If a new exported pure function was added:**
- Confirm there is a corresponding test in the relevant `.test.ts` file
- If not, write the missing test cases before opening the PR

**If streak, date filtering, or timezone logic was touched:**
- Confirm the fix uses `format(date, 'yyyy-MM-dd')` (local time) not `toISOString().slice(0, 10)` (UTC)
- Confirm `activeDates` is built from both `dailyActivity` and `data.sessions`

**If the stats-cache schema changed** (new fields in `StatsCache`, `SessionMeta`, `DailyActivity`):
- Note it explicitly in the PR as a potential breaking change for users upgrading

**If a UI component changed** (charts, cards, heatmap, PDF export):
- Add a screenshot or short description of the visual diff to the PR body

**If data aggregation or session parsing was touched** (`parseSessionJsonl`, `useDerivedStats`):
- Note any performance impact (more/fewer file reads, heavier compute per session)

## Step 3 — Documentation

**CLAUDE.md** — update if any of the following changed:
- A function in the per-layer cost table
- A new "important rule" about data behavior
- The data flow or architecture

**README** — update if any of the following changed:
- A user-visible metric or calculation (Calculations and Metrics section)
- A new script or command (Installation and Setup section)
- The streak, cost formula, or blended rate behavior

## Step 4 — Open the PR

Create the PR with the following structure. All text in English.

**Title:** Conventional Commits style, under 70 characters.
- `feat:` new user-visible feature
- `fix:` bug fix
- `chore:` tooling, deps, config
- `docs:` documentation only
- `refactor:` internal restructure without behavior change

**Body:**
```
## Summary
- <what changed and why — focus on the "why", not just the "what">
- <second bullet if needed>

## Root cause
<For bug fixes only: what was the underlying cause and why it was happening>

## Test plan
- [ ] `bun test` passes
- [ ] <specific scenario to verify manually>
- [ ] <another scenario if applicable>

## Breaking changes
<Only if data format, API response shape, or env vars changed. Otherwise omit this section.>
```
