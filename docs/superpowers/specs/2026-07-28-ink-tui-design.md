# Ink TUI — design

**Date:** 2026-07-28
**Status:** implemented
**Scope:** rewrite `agentop tui` as a multi-screen Ink application, and rebuild the
`agentop start` launcher on the same renderer.

## Goal

`packages/web/src/tui/index.ts` is a single 938-line file: a hand-rolled ANSI palette,
manually padded tables, an `@inquirer` question wizard that runs *before* any data is
shown, a fixed-interval repaint loop, and mixed Portuguese/English strings. It has no
tests.

Replace it with a component-based terminal application built on
[Ink](https://term.ink) (React for CLIs), reusing `@agentistics/core` for all
pricing/formatting, so the terminal and the web dashboard compute identical numbers.

## Verified constraint: Ink compiles into the standalone binary

`agentop` ships as `bun build --compile`. This was validated by spike before any design
work, because a negative result would have invalidated the whole approach:

- Ink 7.1.1 + React 19 + `yoga-layout` bundle and run in a compiled binary with **no
  `node_modules` present** (confirmed by running the binary from `/tmp`).
- `ink` requires `es-toolkit` as a runtime dependency.
- **The one wrinkle:** `ink/build/reconciler.js` guards devtools behind
  `process.env['DEV'] === 'true'` but reaches it via `await import('./devtools.js')`,
  whose top-level `import devtools from 'react-devtools-core'` Bun's bundler resolves
  **statically**, regardless of the dead branch.
  - `--external react-devtools-core` → bundles, then fails at binary startup
    (`Cannot find package ... from '/$bunfs/root/'`).
  - `--define 'process.env.DEV="false"'` → no help; resolution precedes DCE.
  - **Chosen fix:** commit a stub package that satisfies the resolver at bundle time.

### The stub

`packages/tui/stubs/react-devtools-core/` — a `package.json` plus:

```js
export default { initialize() {}, connectToDevTools() {} }
```

wired as a `file:` dependency. It is only ever reachable under `DEV=true`, which the
shipped binary never sets. This mirrors the existing `ensure-type-stub.ts` precedent in
`packages/server/scripts/`. It **must** carry a comment explaining why it exists, or a
future reader will delete it and break the binary build.

## Package layout

A new workspace package, `packages/tui` (`@agentistics/tui`).

The TUI currently lives in `packages/web`, which is a Vite **browser** bundle. Ink is a
terminal renderer; housing it beside `react-dom` invites someone to import a terminal
module into the web build. The new package owns `ink`, `react`, `es-toolkit` and the
stub. `packages/server/bin/cli.ts` consumes it for both the `tui` and `start` commands.

```
packages/tui/
  src/
    index.tsx           entry — arg parsing, lang resolution, render(<App/>)
    App.tsx             screen router, global keybindings, overlay host
    data/
      useAppData.ts     /api/data fetch + /api/events SSE subscription
      ensureApi.ts      auto-spawn the API server if absent (ported)
    selectors.ts        PURE: AppData -> per-screen view models
    format.ts           re-exports @agentistics/core fmt helpers
    i18n.ts             EN/PT terminal strings
    screens/            Overview, Projects, Sessions, Costs, Harnesses
    components/         KpiRow, Sparkline, BarRow, DataTable, StatusBar, Spinner
    overlays/           FilterOverlay, HelpOverlay
    launcher/           the `agentop start` screen
  stubs/react-devtools-core/
```

`@inquirer/prompts` and `@inquirer/core` are used by **no other file in the repo** and
are removed from the root `package.json` with the old TUI.

## Data flow — SSE, not polling

The old TUI ran its own `chokidar` watcher and a user-configured repaint interval. The
server already serves SSE at `/api/events` (`packages/server/server/index.ts:262`).

```
agentop tui
  -> ensureApi()            spawn `agentop server` if :47291 is not answering
  -> GET /api/data          full AppData snapshot
  -> SSE /api/events        push -> refetch -> React re-render (diffed by Ink)
  -> fallback: 10s poll if the SSE connection cannot be established
```

This removes the interval question from configuration entirely and makes the terminal
update at the same moment the browser dashboard does.

**Rule:** the TUI computes nothing the dashboard doesn't. Cost is `calcCost()` from
`@agentistics/core`; the Claude-only nature of `stats-cache.json` is respected exactly
as `useDerivedStats` does — non-Claude harnesses aggregate from per-session sums.

## Screens

Navigation: `1`–`5` or `tab`/`shift+tab`. Every screen is live.

| Key | Screen | Contents |
|-----|--------|----------|
| `1` | Overview | cost / tokens / sessions / streak KPIs, 30-day activity sparkline, per-harness share bars |
| `2` | Projects | ranked table — cost, tokens, sessions, last activity |
| `3` | Sessions | recent sessions, `enter` drills into one; live sessions marked |
| `4` | Costs | per-model table — rate origin, tokens, cost |
| `5` | Harnesses | side-by-side comparison; `N/A` via `HARNESS_CAPABILITIES`, never a fake `0` |

Overlays: `f` filter (project / harness / date range), `?` help, `q` quit.

**No up-front wizard.** The app launches into Overview with defaults; filtering happens
in-app against already-loaded data.

`HARNESS_CAPABILITIES` is honoured on every screen — an incapable metric renders `N/A`,
matching the web rule that a confident `0` is worse than an admitted gap.

## `agentop start` launcher

`cli-start.ts` already separates logic (`detectServices`, `startBackground`,
`restartRunning`, `connectFlow`, `stopMenu`) from presentation (the five primitives in
`cli-ui.ts`). **That logic is not rewritten.** Only presentation changes:

- One persistent frame showing the live service-status panel *and* the action menu
  together, replacing the sequential `clearScreen()` prompt chain.
- Status rows (server / watcher / central / machine / member) refresh while the menu is
  on screen, rather than being a snapshot printed once.

`cli-ui.ts` is **kept**, not deleted: it remains the fallback for non-TTY stdin and for
any path that must not depend on the renderer. `runStart()` picks Ink when
`process.stdin.isTTY`, and the existing primitives otherwise.

## Internationalisation

Language resolves from `--lang`, then `preferences.lang`, then EN — the existing
`resolveLang()` in `cli-start.ts`, extracted to a shared module so the launcher and the
TUI agree.

Strings live in `packages/tui/src/i18n.ts`, in the same shape as `cli-i18n.ts`.

**Deviation, deliberate:** the request was "EN/PT via core i18n", but
`@agentistics/core/i18n` is compiled into the **browser** bundle. Terminal-only strings
placed there would be downloaded by every web user for no benefit. Behaviour is
identical; only the file location differs. Raised with and accepted by the user.

## Testing

The old TUI has no tests. The split between pure selectors and rendering components is
what makes the new one testable.

- `selectors.test.ts` — `bun test`, pure `AppData -> view model` assertions, including
  the non-Claude per-session aggregation rule and capability-driven `N/A`.
- Component render tests via `ink-testing-library@4`, asserting on rendered frames.
- No filesystem mocking, per the project convention — selectors are pure.

## Migration

Replace outright, in the same change:

1. Delete `packages/web/src/tui/index.ts`.
2. Point `agentop tui` (`packages/server/bin/cli.ts`) at `@agentistics/tui`.
3. Update the root `watch:cli` script.
4. Drop `@inquirer/prompts` and `@inquirer/core` from the root `package.json`.
5. Verify `bun run build:binary` produces a working binary, and that `agentop tui` and
   `agentop start` both run **from the compiled binary**, not just under `bun`.

Step 5 is the acceptance gate. Working under `bun run` proves nothing about the shipped
artifact — the whole devtools problem above is invisible until compile time.

## Out of scope

The web dashboard, the server, the harness adapters, the MCP package, and the data
pipeline are untouched. No new metric is introduced; this is a presentation rewrite.

## Risks

| Risk | Mitigation |
|------|------------|
| Ink upgrade reintroduces an unresolvable optional import | Binary smoke test in the acceptance gate catches it at build, not at release |
| Someone deletes the "unused" stub | Explanatory comment in the stub + a note in CLAUDE.md |
| Narrow terminals break layout | Ink flexbox + a minimum-width guard screen below ~60 cols |
| SSE unavailable (older server) | Documented 10s polling fallback |

---

## Implementation notes (what the design did not anticipate)

Recorded after the fact, because each of these was a real defect the design would not have caught.

1. **Column fitting had to be generic.** Each screen originally sized its first column with
   `Math.max(floor, width - constant)`. At 60 columns those floors made the table *wider* than
   the terminal — the Sessions table rendered 85 columns into 60 and every row wrapped, which
   destroys the alignment of the entire screen. Replaced with `fitColumns()` in `DataTable`:
   drop columns from the right, then give the remainder to the identity column. Screens declare
   columns most-important-first. `Overview` needed the same treatment for its KPI row
   (`fitKpis`) — its fixed row was 74 columns wide.

2. **The shell's padding is part of the width contract.** `App` has `paddingX={1}`, so screens
   have `columns - 2` to work with. Passing the raw terminal width made a full-width bar overflow
   by exactly two columns.

3. **`agentMetrics` is an object, not an array.** `SessionAgentMetrics` is
   `{ invocations[], totalInvocations, ... }`. The first draft called `.length` on it; the test
   fixture had used an `as never` cast, which hid the mistake until `tsc` ran.

4. **`ModelUsage` field names.** They are `cacheReadInputTokens` / `cacheCreationInputTokens`,
   not `cacheReadTokens` / `cacheWriteTokens`. Getting this wrong produced `NaN` totals rather
   than a type error, because the fixtures were cast.

5. **`HARNESS_CAPABILITIES` gating needed a metric that actually varies.** The Harnesses screen
   first gated `cost` and `tokens`, but every harness has both set to `true`, making the N/A path
   dead code. It now shows agent invocations, which only Claude reports — so the N/A is real.

6. **Non-TTY stdin.** Ink throws from inside a React effect when it cannot enter raw mode,
   surfacing as an unreadable reconciler stack. `runTui` now checks `process.stdin.isTTY` and
   exits with one sentence, and `cli-start.ts` falls back to `cli-ui.ts`.

7. **`fmt()` stopped at millions.** A heavy Claude history renders as `13290.8M`. Extended to B
   and T in `@agentistics/core` (shared with the web dashboard) rather than duplicated locally.

8. **`calcStreak` moved to core.** It lived in `packages/web/src/hooks/useData.ts`, which the TUI
   cannot import. Moved to `packages/core/src/streak.ts` and re-exported from `useData.ts`, so
   there is still exactly one implementation.
