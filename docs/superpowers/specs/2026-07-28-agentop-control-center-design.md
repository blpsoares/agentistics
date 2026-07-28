# `agentop` control center — design

**Date:** 2026-07-28
**Status:** approved, pending implementation

## Problem

Two defects in the current CLI.

**1. The launcher grows the scrollback.** Every pass through the `runStart()` loop calls
`launcherMenu()`, which does its own Ink `render()` and `unmount()`. Ink renders *inline*: the
final frame stays in the scrollback on unmount. The submenus (`stopMenu`, `restartMenu`,
`runAgentistics`, the connect prompts) do not use Ink at all — they call `select()` / `input()` /
`pause()` from `cli-ui.ts`, which simply write lines to stdout. So each selection appends a fresh
block of output and the terminal scrolls. `clearScreen()` (`\x1b[2J\x1b[H`) at the top of the loop
clears the *visible* screen but not the history, and cannot undo what already scrolled off.

**2. `agentop` is a help dump, not an interface.** Bare `agentop` prints `HELP` (or runs the
readline setup wizard when unconfigured). The project already depends on Ink; the terminal surface
should be an actual navigable application covering the startup and configuration story.

## Scope

This is the **startup / configuration** surface only. Metrics, sessions, costs and harness
dashboards stay where they are, in `agentop tui`. The control center never renders analytics.

## Design

### Entry points

| Invocation | Behaviour |
|---|---|
| `agentop` (TTY) | Opens the control center on the **Services** tab. Never prints `HELP`. |
| `agentop` (no TTY) | Prints `HELP` and exits 0, as today. |
| `agentop start` (TTY) | Opens the same control center on **Services**. |
| `agentop start` (no TTY) | Returns `'foreground'` — runs like `agentop server`, as today. |
| `agentop --help` / `-h` | The only path that prints the plain `HELP` text to stdout. |
| `agentop tui` | Unchanged — the live metrics dashboard. |
| every other subcommand | Unchanged. |

An unconfigured machine no longer detours into `runSetup()`; the control center opens with the
**Setup** tab flagged and a call to action on Services.

### A single mount, in the alternate screen

`runStart()` mounts **one** `<ControlCenter>` for the whole session and enters the alternate
screen buffer on the way in (`\x1b[?1049h`), leaving it on the way out (`\x1b[?1049l`). Tab
switches, submenus and text prompts are state transitions inside that one component — no second
`render()`, no `select()`/`input()` on the TTY path. On exit the terminal is byte-for-byte what it
was before the command: **zero lines added to the scrollback**.

Alternate screen entry/exit lives in a small `withAltScreen()` helper that also restores on
`SIGINT`, `SIGTERM` and `process.on('exit')`, so a crash cannot strand the terminal in the
alternate buffer.

### Suspending for raw-output commands

`docker compose up --build`, `bun run bin` and the foreground server write directly to the tty and
cannot share the screen with Ink. A `suspend(fn)` wrapper:

1. unmounts the Ink app,
2. leaves the alternate screen,
3. runs `fn()` with `stdio: 'inherit'` exactly as today,
4. waits for a keypress,
5. re-enters the alternate screen and remounts the control center on the tab it came from.

The command's output is therefore complete and colored while it runs, and disappears with the
alternate buffer on return. Nothing about *what* runs changes.

### Tabs

Six tabs, ordered by how often they are used.

**Services** (default). The existing CONFIG / RUNNING panel plus every action, now as Ink screens:
start agentistics (foreground / background / docker), start a central, connect to / disconnect
from a central, restart, stop, enable autostart at boot, toggle language. Submenus render in place
under the panel rather than as separate prompts.

**Setup.** The solo / central / member wizard and the `archiveMode` consent gate, as internal
screens. Replaces the `runSetup()` call on bare `agentop`.

**Logs.** A scrollable viewer over `~/.agentistics/agentop-server.log` plus `docker logs` for the
central and machine containers, with live tail. Read-only; no action taken from this tab.

**Cheat sheet.** The commands worth memorising, grouped and dense — `agentop server --bg`,
`agentop central up`, `agentop restart --all --rebuild`, `agentop member connect …`.

**Help.** The `HELP` content rendered as navigable sections. `--help` still prints the raw text.

**Contribute.** Repository, running from a checkout, where to file issues, license.

### Visual design

The control center is the product's front door and should look like it. Concretely:

- **Chrome.** A header band carrying the `Wordmark`, the resolved mode (`solo` / `central` /
  `member → endpoint`) and the version with an update dot when one is available; a tab strip with
  the active tab in `COLORS.accent` on a filled cell and the rest dim; a persistent footer with
  only the keys valid on the current screen.
- **Palette.** `theme.ts` only — no new ad-hoc colors. Accent for the active/selected element,
  `success` / `muted` for the service dots, `danger` for stop actions, `border` for rules. Color
  never carries meaning alone: a running service is `● up`, a stopped one `○ stopped`.
- **Rhythm.** Section headers in dim small-caps, one blank line between blocks, aligned label
  columns. Selection is a single `❯` in accent plus a bold label — no full-width inverse bars.
- **Motion.** A spinner on any action taking longer than ~150 ms (service detection, docker calls,
  connect), and a transient status line reporting the result of the last action instead of a
  printed line.
- **Responsiveness.** Every screen receives `width` and fits it, per the existing TUI rule. Below
  the wordmark's width the header degrades to the plain-text fallback already in `Wordmark`; below
  ~60 columns the tab strip collapses to the active tab plus `‹ ›` affordances. Nothing wraps.

### Module layout

`packages/tui/src/control/`

| File | Responsibility |
|---|---|
| `ControlCenter.tsx` | Shell: header, tab strip, footer, tab routing, `suspend` plumbing |
| `tabs/Services.tsx` | Status panel + action list + submenus (presentation only) |
| `tabs/Setup.tsx` | Wizard screens (presentation only) |
| `tabs/Logs.tsx` | Log source picker + scrollable tail |
| `tabs/CheatSheet.tsx` | Static content |
| `tabs/Help.tsx` | Static content, sectioned |
| `tabs/Contribute.tsx` | Static content |
| `altScreen.ts` | `withAltScreen()` + `suspend()` |
| `Menu.tsx`, `Prompt.tsx`, `Spinner.tsx` | Shared primitives replacing `cli-ui` on the TTY path |

The existing `launcher/Launcher.tsx` is absorbed by `tabs/Services.tsx`.

### Boundaries

- **The control center owns no logic.** `cli-start.ts`, `cli-setup.ts`, `cli-member.ts` and
  `cli-central.ts` keep deciding what the choices are, what the service state is, and what each
  action does. The Ink layer renders already-localized strings and reports intents through
  callbacks. This is the existing rule in `CLAUDE.md` and it does not change.
- **`cli-ui.ts` stays.** It is the non-TTY fallback (pipes, systemd, CI, dumb terminals), where
  behaviour is unchanged. Do not delete it.
- **The TUI does not read preferences.** Language is still resolved by `server/cli-lang.ts` and
  passed in; the language toggle reports an intent that `cli-start.ts` persists.
- **Strings live in `cli-i18n.ts`** (EN + PT), not in the components.

## Error handling

- A failed service detection (docker absent, `lsof` missing) renders the service as `? unknown`
  with a dim reason, never an empty panel or a thrown frame.
- A failed action leaves the status line in `danger` with the message and keeps the app mounted.
- A `suspend()`ed command that exits non-zero pauses on its own output so the error is readable
  before the alternate screen swallows it.
- Missing log files render an empty-state sentence, not an error.
- `SIGINT` inside a submenu returns to the parent screen; `SIGINT` at the top level exits cleanly
  through the alternate-screen restore.

## Testing

Pure and near-pure logic is unit tested; rendering is not snapshot-tested.

- `altScreen.ts` — the escape sequences written on enter/exit/suspend, and that a throwing `fn`
  still restores.
- Tab/menu reducers — key handling (`tab`, `←/→`, `↑/↓`, digits, `enter`, `esc`) against a plain
  state function, no Ink.
- Layout — the tab strip's collapse behaviour at narrow widths, via the existing
  `components/layout.test.ts` style.
- `cli-start.ts` keeps its current tests; the intent-handling switch is exercised directly.
- **Manual gate:** verify against the **compiled binary** (`bun run build:binary`), not only
  `bun run` — the `stubs/react-devtools-core` failure mode is invisible under `bun run`. Confirm
  the scrollback is untouched: run `agentop`, navigate several tabs and submenus, quit, and check
  that the prompt is where it was.

## Out of scope

- Any metrics, session, cost or harness view (that is `agentop tui`).
- Changing what any action executes.
- Windows-native terminal support beyond what Ink already provides.
