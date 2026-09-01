# The VS Code extension

`packages/vscode` puts the session fleet and the dashboard inside the editor: the sessions your
machine is hosting, what each one is doing, which of them is blocked on you, and every verb the
terminal cockpit offers — without leaving the window.

It is a **client of the local `agentop server`** and nothing else. It never reads
`~/.agentistics`, never talks to tmux, and never imports the session manager. That is a
correctness constraint rather than a style preference: `registry.ts` serialises writes within ONE
process, and a second process read-modify-writing `managed-sessions.json` beside the running
server is the race that documentation exists to record — a record written by a short-lived process
has been observed erased by a longer-lived one, leaving a user sitting in a session no verb could
name.

```
VS Code window                          the machine
┌────────────────────────┐             ┌────────────────────────────┐
│ Sessions view (webview)│  HTTP       │ agentop server :47291      │
│ Sessions tab (webview) │ ──────────► │  /api/fleet                │
│ Dashboard tab (iframe) │             │  /api/fleet/act            │
│ status bar             │             │  /api/fleet/attach         │
│ integrated terminal    │ ──tmux───►  │  /api/fleet/new            │
└────────────────────────┘             │  /api/data                 │
                                       └────────────────────────────┘
```

## What it does

| Surface | What it shows | Where it comes from |
|---|---|---|
| **The fleet** (sidebar, or an editor tab) | every session, grouped by project, most urgent first | `GET /api/fleet` every 5s |
| **One session** — the sidebar walks into it, or it opens as its **own tab** | its LIVE SCREEN, the dialog it is blocked on with the options to answer, a composer to type into it, and every verb | `GET /api/fleet/stream` + `POST /api/fleet/act` |
| **Verbs** | approve · prompt · rename · note · task · open the whole task · finish the task · kill · reopen | `POST /api/fleet/act` |
| **Attach** | a real integrated terminal running the very `tmux` command the cockpit runs | `GET /api/fleet/attach` |
| **New session** | the wizard: which assistants this machine can start, where, the task, the first message, model and effort | `GET`/`POST /api/fleet/new` |
| **Dashboard** | the existing web dashboard, in a frame | `agentistics.dashboardUrl` (`:47292`) |
| **Status bar** | today's cost, tokens and session count, plus how many sessions are waiting on you | `GET /api/data`, slowly |

## Two views, and why a session gets its own tab

The panel has exactly two views. `list` is the fleet — cards, grouped by project, most urgent
first. Clicking one opens `session`: that session's live screen, its composer, its verbs, and a way
back. In the **sidebar** the two swap places, which is what makes a 300px column usable at all; the
list is a way IN, not a control panel with everything on it at once.

A session can also be opened as **its own editor tab**, and several can be open at once — one per
session, each keeping its own scroll position and its own half-typed line. A tab is created pinned
to one session and never shows the list, which is what makes "several at once" mean anything: the
sidebar can only ever be looking at one. Tabs are keyed by session id, so asking twice REVEALS the
one that exists rather than opening a second panel onto the same screen, and each is titled with
what the session is CALLED — a tab strip full of `3f5f21a8b0c1` is a tab strip nobody can use.

Both are the same document, driven by the same 5s poll and the same shared streams. An action taken
in the sidebar reports its result in the tab too.

## The live screen

`GET /api/fleet/stream` is the read channel documented in
[`docs/terminal-channel.md`](terminal-channel.md): SSE, one `capture-pane` loop per session however
many readers, each `frame` a complete picture with its SGR sequences intact.

- **The HOST opens the stream, not the webview.** A webview's `localhost` is the editor client's,
  which in a Remote-SSH or WSL window is not the machine the sessions are on. The extension host
  sits beside the fleet, so it is what asks, and it forwards each event over `postMessage`.
- **One connection per session, shared by every surface watching it** (`streams.ts`), mirroring the
  server's own model. Watching is tied to the route: entering a session asks for its stream, leaving
  gives it back. Capture is viewer-gated on the server, so a surface that forgot to unwatch would
  keep a loop running on the host for a screen nobody can see.
- **A stream that never delivers says so.** 10s without a first frame is reported as a stall, not
  as patience — a "Connecting…" that never resolves is indistinguishable from a dead session. A
  stall never blanks a screen that already has a frame.
- **The phase machine and the honesty line are imported, not restated**
  (`packages/web/src/lib/terminalStream.ts`). Whether you are looking at a live screen, a finished
  session or one that is gone is the same decision, in the same words, as on the dashboard. A second
  copy in an editor client would be a second set of honesty rules, and a frozen screen that looks
  alive is the one thing this feature may never be wrong about.
- **Rendering is `ansi.ts`, pure and tested — not xterm.js.** `capture-pane` has already resolved
  the spinners, the redraws and the cursor into final glyphs, so what is left is colour. xterm is
  300 KB that wants a fixed character grid and a fit addon, in a panel that is routinely 300px wide
  and resized by dragging; what it would buy is either already resolved or is the integrated
  terminal's job, one click away on every row. What it must not cost is colour fidelity, so the
  palette is the dashboard's own `xtermTheme` — the same session reads the same in both places.
  Verified against a real Claude Code frame: 19 coloured spans, no escape bytes and no unescaped
  `<` surviving into the HTML.

## Typing into a session

The composer is the write half, and it is the dashboard's, unchanged
([`docs/terminal-interactive.md`](terminal-interactive.md)): there is exactly one web-reachable way
to write into a managed session — `POST /api/fleet/act { action: 'prompt' }` — which types a whole
line and submits it, and answers honestly whether it landed.

- **Consent, per session, in memory.** The region is read-only until "Type into this session" is
  pressed; "Stop" revokes it and drops the pending line. Typing into a live session changes another
  running process mid-work, so it is a decision, not a side effect of the terminal being on screen.
  It is an INTENT gate and says so — the real authority is the server, which refuses a prompt into
  an open dialog, into a session that is not running, and on any exposed profile.
- **The line is local until submit**, so nothing per-key can be lost, and a line that fails is KEPT
  on screen with the server's own reason. `composerReducer` and `interactionBlock` are imported from
  the dashboard for the same reason the phase machine is.
- **A session on a dialog is not typable**, and the panel says which of the three reasons applies
  rather than disabling a box with no explanation.

## The rules it holds — none

Every `enabled` flag, every verb label and every refusal sentence arrives **already decided** from
the server, which resolves them through the same `sessionActions` the terminal cockpit resolves
every keypress against. A second implementation in an editor extension would be a third set of
rules — after the cockpit's and the browser's — and it would go wrong in the expensive direction:
offering "answer its question" on a numbered dialog belonging to a harness with no verified way to
select by number, where the keystroke takes whichever option happens to be highlighted.

Two things the extension does compute, and both are imported rather than restated:

- **What is most urgent** is `sessionRank` (`@agentistics/tui/control/session-order`).
- **What counts as running** is `sessionRunning` (`@agentistics/tui/control/session-dimensions`).

Both were widened from `ControlSession` to `Pick<ControlSession, 'state'>` so a client holding the
reduced `FleetRow` can ask them directly.

What it *does* own is the arrangement: grouping by project, ordering the bands by their most
urgent member, the search, and which of three sentences an empty list gets (`view-model.ts`, and
its tests). The **cascade** — the directory tree the cockpit draws inside each band — is
deliberately absent: it is measured against `ControlSession.projectRoot`, which is not on the wire,
and a tree derived in the client by string-matching the project name against each `cwd` goes wrong
wherever a path segment repeats.

## Attaching

A webview has no PTY. An in-panel emulation would mean streaming frames, diffing them and
reimplementing resize and the cursor — more moving parts for a worse result than the integrated
terminal, which gives real tmux fidelity (resize, real cursor, the native detach key) for free.

So `GET /api/fleet/attach?id=<id>` returns a **ticket** — `argv`, the real `detachHint` read from
the backend, and the session's label — and the extension runs it in `vscode.window.createTerminal`.
The detach key travels with the ticket because it is the one fact the user cannot recover for
themselves: a tmux prefix they rebound makes a guessed hint actively wrong, and someone who cannot
get out is stranded in a buffer that hides their editor.

The route checks SCOPE before it answers: the row must be one this machine manages and must be
running. `attachSession` composes the command from whatever id it is given without asking whether
that session exists, so before the check an unknown id came back as a perfectly well-formed ticket
for nothing, and the client opened a terminal that printed `no such session` and sat there.

One terminal per session, reused — pressing Attach twice must not leave two terminals attached to
one tmux session, both live, both echoing the other's keystrokes, with nothing saying why.

## Starting a session

`POST /api/fleet/new` is the most powerful call on the whole route table: it spawns a billable
coding assistant, with a prompt, in a directory the request names. It is the one fleet call that
reads a directory from the body — `resume` deliberately refuses to, because reopening names an
existing conversation and a directory in the body could only ever contradict it, while STARTING is
the act of choosing where work happens and has nothing else to read it from.

What bounds it is exposure, not wording: the route is registered under `localShell` in
`capability-guard.ts` and is unreachable on a `lan` or `public` profile whoever is authenticated.

The pure `fleet-spawn.ts` reads the request and refuses in a sentence rather than repairing
anything:

- **The directory must be absolute.** A relative path resolves against the SERVER's working
  directory — wherever `agentop server` was started — and the session would open somewhere nobody
  named, correctly filed under that project.
- **The harness must be one this machine can start**, checked against `startableHarnesses()`, so a
  harness with no spawn spec is refused here for the same reason it is absent from the wizard.
- **An `effort` must be one the CLI itself prints** (`SpawnSpec.efforts` is a genuine closed enum).
  A **model** is never validated — `claude --help` documents `--model` as an alias "or a model's
  full name", so a fixed list would reject valid input the day a model ships. It is refused only
  when the harness has no model flag at all, because starting the session without the model that
  was asked for is not the session that was asked for.

`attach` is not a field of the request and cannot be: the server has no tty to hand over. A caller
that wants to enter what it started asks for the ticket, by the id the spawn returned — never by
looking for "the newest row in that directory", which on a machine already running three sessions
there is a guess.

## Waiting on you

The bell rings on the **transition**, never on the level (`attention.ts`, and its tests):

- The **first** poll after the window opens announces nothing. There is no previous state to have
  transitioned from, and a machine with nine blocked sessions would greet the user with nine
  toasts.
- Only `waiting-approval` raises a notification. Plain `waiting` also means the assistant is
  waiting on you — and is counted in the badge for exactly that reason — but it is where a session
  sits at the end of every turn, so a toast on it is a toast per turn.

The count in the status bar is a level and is only ever shown as one.

## Configuration

| Setting | Default | What it is |
|---|---|---|
| `agentistics.apiUrl` | `http://127.0.0.1:47291` | the local server's api port |
| `agentistics.dashboardUrl` | *derived* | the dashboard to frame; empty means api port **+ 1**, the server's own rule (`WEB_PORT`) |
| `agentistics.language` | `auto` | `auto` follows VS Code's display language and falls back to English |
| `agentistics.notifyOnAttention` | `true` | toast on the transition into blocked |
| `agentistics.statusBar` | `true` | show today's totals |
| `agentistics.statusBarRefreshSeconds` | `300` | `/api/data` is megabytes on a well-used machine, so this timer is deliberately slow; the fleet list refreshes every 5s regardless |

A setting that cannot be parsed falls back to the default **and says so**: a working panel quietly
reading a machine the user did not name is worse than a complaint they can act on.

### Today's numbers

`/api/data` is summed **per session, for today only**, by the **UTC** day
(`start_time.slice(0, 10)`). Two day rules exist in this repo, and this is the one the dashboard's
own date presets use (`utcStartOfDay`); at UTC-3 the two disagree for three hours every night,
which is exactly when someone would notice a status bar contradicting the dashboard beside it and
stop believing both. `stats-cache.json` is not consulted: it is Claude-only, and today's sessions
are all still on disk for every harness, so the per-session sum is both complete and
cross-harness. Tokens means all four counters (`sessionTokenTotal`).

An unreachable server prints a sentence, never a zero — `R$ 0,00` from a machine whose server is
not running is a confident, wrong answer to the one question the item exists to answer.

## The Dashboard tab, and the header that used to make it blank

The dashboard is FRAMED — the existing React application, not a second implementation of its
charts, filters, PDF export and settings. Framing is full parity, permanently, for free.

It did not work at first, and the reason was on the server: every response carried
`frame-ancestors 'none'` and `X-Frame-Options: DENY`, so the tab rendered an empty rectangle with
nothing on screen saying why. The fix is deliberately narrow (`security-headers.ts`):

- On a **`local` profile only** — the machine's own dashboard, on 127.0.0.1 — the policy becomes
  `frame-ancestors vscode-webview:`. A VS Code webview document lives at `vscode-webview://<uuid>`;
  a web page's origin is `http:` or `https:` and cannot be forged into another scheme, so this
  admits the editor and nothing a page can ever present. It is deliberately **not**
  `frame-ancestors 'self'`, which would let any same-origin page frame the dashboard, and not a
  wildcard.
- `X-Frame-Options` disappears on that profile, and that is the point rather than an oversight: the
  header has two values, `DENY` and `SAMEORIGIN`, and neither can express "one scheme". Left at
  `DENY` beside a permissive `frame-ancestors` it simply wins wherever it is honoured — which is
  exactly how the blank tab happened. `frame-ancestors` is the modern and more expressive control.
- Every other profile is untouched: `lan` and `public` keep `'none'` and keep the legacy header.
  `security-headers.test.ts` pins both directions.

## The design system

The panel wears the **dashboard's** palette, not raw VS Code chrome: the same near-black surfaces,
the same Anthropic orange, the same green/amber/red accents, the same radii, and the same
per-harness colours. A panel that looks like a different product from the dashboard it sits beside
is a different product as far as the eye is concerned, and the two are one.

It is not theme-agnostic by accident. The host reads `vscode.window.activeColorTheme` and sets
`data-theme`, so a light editor gets the dashboard's LIGHT palette rather than a dark panel bolted
into a bright window — and the terminal's ANSI palette follows the same switch. Only the focus ring
and the scrollbar are borrowed from VS Code; those belong to the editor's input conventions.

## Remote windows

The dashboard URL goes through `vscode.env.asExternalUri`. In a Remote-SSH or Codespaces window
`127.0.0.1:47292` inside a webview is the LOCAL machine's, not the one the sessions are running
on, and the frame would show whatever happens to be listening at home. `asExternalUri` asks VS Code
to forward the port and hands back the address that reaches it; when it cannot, the plain URL is
used, because a local window needs no forwarding at all and a failure must not leave the tab blank
where the plain address would have worked.

For the same reason the **webview never fetches**: a webview's `localhost` is the browser's. The
extension host is the process that sits beside the fleet, so it is the process that asks.

## Building it

```bash
bun run build:vscode     # dist/extension.cjs + dist/webview.js
bun run package:vscode   # a .vsix, via @vscode/vsce
```

Then `F5` from the repo, or install the `.vsix` with
`code --install-extension packages/vscode/agentistics-vscode-*.vsix`.

Marketplace / Open VSX publishing is packaging and distribution, and is deliberately not wired up
here.

## Where each piece lives

| File | What it owns |
|---|---|
| `src/extension.ts` | activation and wiring; nothing else |
| `src/api.ts` | the only process that talks HTTP; every method total, no method inventing a value |
| `src/sessions.ts` | one poll, any number of surfaces; performs every action |
| `src/streams.ts` | one live screen per session, shared by every surface watching it |
| `src/panels.ts` | the editor tabs — one per session, keyed so asking twice reveals rather than duplicates |
| `src/ansi.ts` | **pure** — one terminal frame, rendered as HTML, in the dashboard's palette |
| `src/protocol.ts` | the wire shapes, and the note about why no rule lives on this side |
| `src/view-model.ts` | **pure** — grouping, ordering, the search, the three empty states |
| `src/attention.ts` | **pure** — which sessions have just started needing a person |
| `src/today.ts` | **pure** — today's totals, and the day rule they use |
| `src/config.ts` | **pure** — the two endpoints, one derived from the other |
| `src/webview/html.ts` | **pure** — the CSP'd documents, and the escaping |
| `src/webview/main.ts` | the panel: DOM calls only, never `innerHTML` |
| `src/terminal.ts` | attaching, and starting the server, in terminals this window owns |
| `src/status-bar.ts` | today, and the waiting count |
| `server/sessions/fleet-spawn.ts` | **pure** — what a start request off the wire may ask for |
| `server/sessions/fleet-web.ts` | the server half: attach ticket, wizard data, spawn |

Every string on the panel is somebody's session title, note, project path or a line captured off a
terminal, so the webview is built with DOM calls and never with `innerHTML`: a template literal is
one unescaped `<` away from executing it. There is exactly **one** exception, marked at the
assignment — the terminal screen, whose HTML `ansi.ts` builds, having escaped the frame before it
coloured it.

## See also

- [`docs/session-manager.md`](session-manager.md) — the fleet itself, and every rule these routes
  are a transport for.
- [`docs/terminal-channel.md`](terminal-channel.md) — `GET /api/fleet/stream`, the read-only screen
  stream the browser uses where this extension hands over a real terminal instead.
- [`docs/security.md`](security.md) — the exposure boundary these routes sit behind.
