# agentop session manager — design

**Date:** 2026-08-12
**Status:** approved (design), pending implementation plan

## Problem

Running several coding assistants at once means running several terminals at once. There is no
single place that answers "what am I running, where, and which of them is waiting on me". Sessions
get lost between tabs, a session blocked on a permission prompt can sit idle for an hour unnoticed,
and starting a new session in a specific project means finding that project's directory by hand
first.

Agentistics already knows a great deal about sessions **after the fact** (`SessionMeta`, the
consolidate store, per-harness adapters) and knows a little about them **live**
(`live-sessions.ts` reads `/proc` and matches processes to persisted sessions). What it cannot do is
*create*, *attach to*, *name*, or *observe the state of* a session.

This design adds a session manager: a `SessionBackend` abstraction that owns spawning and attaching,
a pure monitor that answers "which sessions need attention", a new `Sessions` tab in the existing
`agentop` control center, and an `agentop session` CLI.

## Scope

**In scope**

- Start a harness session detached (background) or attached (foreground), from the CLI or a TUI wizard.
- Attach to / detach from a managed session.
- List every session — managed *and* external (started by hand in another terminal).
- Classify each session's state, including "waiting for input" and "waiting for approval".
- Name a session (label) and describe it (note); fall back to what the harness itself recorded.
- Search projects and repositories when picking where a new session starts.
- Linux, macOS, and Windows (cmd/PowerShell).

**Out of scope for this design**

- Sending input to a session from the TUI without attaching (no remote typing).
- Showing session state on the web dashboard or the team central (the pure monitor makes this an
  added caller later, not a rewrite).
- Adopting an external process into the manager (`reptyr` is Linux-only and unreliable — a verb that
  cannot work is worse than a missing one).

## Decisions

Each of these was an explicit fork during design. They are recorded with the reason, because the
reason is what makes them reviewable later.

### D1 — Two backends behind one interface

`SessionBackend` is the only thing that knows how a session is hosted.

- **Unix (Linux, macOS): `TmuxBackend`.** tmux *is* the daemon. A detached session survives the
  `agentop` process exiting, a machine-wide `tmux list-sessions` is the source of truth, and
  `capture-pane` gives the last rendered frame for free.
- **Windows: `PtyBackend`.** No tmux. One detached host process per session
  (`agentop session-host --id <id>`) owns a ConPTY and exposes a named pipe. This mirrors tmux's
  semantics exactly: killing one host kills one session, and `agentop session --bg` works with the
  agentistics server stopped.

Rejected: requiring WSL on Windows (fails the stated requirement); the agentistics server hosting
every PTY (makes `--bg` depend on the server being up, and a server restart takes the whole fleet
down); Windows Terminal panes (cannot re-attach to an already-running process).

### D2 — Attention is quiescence-gated, then pattern-matched, and honest when neither settles it

A permission prompt (*"Do you want to allow this edit?"*) **never appears in the transcript** — it
exists only on the terminal screen. So the transcript alone cannot answer the product's central
question. Conversely, screen patterns alone break silently on every upstream CLI release.

The rule is therefore two-stage:

1. **Quiescence is the gate.** A session that wrote bytes to its PTY within `QUIET_MS` is `working`.
   No pattern is consulted. This half never breaks.
2. **Patterns classify the quiet ones.** The last rendered frame is matched against that harness's
   `AttentionRules` to separate `waiting-approval` from `waiting-input`.
3. **Nothing matched → `idle-unknown`**, rendered with those words. Never a confident "fine".

This is the same N/A-versus-a-real-0 rule `HARNESS_CAPABILITIES` already imposes on the dashboard:
a wrong reassuring answer is worse than an admitted gap, and here the user *acts* on the answer.

### D3 — The monitor shows the whole fleet, with per-row capabilities

Managed sessions and external ones (a `claude` the user started by hand, found by the existing
`harnessProcesses()`) appear in one list. External rows carry harness / project / uptime and are
labelled **external**: not attachable, and **no attention state at all** — there is no PTY to read,
so claiming one would be fabricating it.

Rejected: managed-only (opening `claude` by hand would make it vanish from the cockpit, which is the
original complaint restated).

### D4 — Attach is a full-terminal takeover

`enter` on a session unmounts Ink, hands the real tty to the session (`tmux attach` on Unix, raw
PTY passthrough on Windows), and remounts the cockpit at the same place on detach. The control
center already has this primitive: `altScreen.suspend`, used today by `central.sh init`.

This is the only option with full fidelity — the harnesses use the alternate screen, heavy ANSI, and
mouse reporting. Rendering a session inside an Ink pane would mean writing a terminal emulator
inside Ink, and it would look broken.

Rejected: an embedded pane (above); a tmux status bar overlay (no Windows equivalent, so the two
platforms would diverge in what the user sees).

### D5 — Project search reads the local store, with a typed path as fallback

The picker fuzzy-searches projects and repositories the machine has already seen, read straight from
`~/.agentistics/sessions/` (the consolidate store) — instant, and it does **not** require the server
to be running. Repositories group by `normalizeGitRemote`, which is already the only legal repo key.
If the typed text resolves to an existing directory that is not in history, that directory is
accepted as-is, so a freshly cloned repo does not force the user out of the cockpit.

Rejected: history-only (cannot start in a new clone); scanning configured roots (more disk I/O and
one more setting to maintain, for a case the path fallback already covers).

### D6 — Label and note are a separate store, and they reach the dashboard

`SessionMeta.title` is the harness's own title and `first_prompt` is the harness's own text; neither
may be overwritten by a user-supplied name. So label/note live in their own local store,
`~/.agentistics/session-labels.json`, keyed by `session_id`, and `data.ts` stamps them onto
`SessionMeta` on read. The TUI and the web dashboard then show the same name for the same work.

When no label is set the existing `sessionLabel()` fallback (`title` → `first_prompt`, wrappers
stripped) is unchanged. The label travels to a central exactly as `first_prompt` does today —
subject to the per-connection sharing rules and scrubbed by `redactSecrets` at both boundaries.

### D7 — The cockpit polls; the monitor is pure

The 5-second poll runs in the control center while it is open. That is enough, because the chosen
notification surface (D8) is the cockpit itself: there is no consumer outside it in v1.

`monitor.ts` is a **pure** function — `(backendSnapshot, harnessProcesses, registry, labels, nowMs)
→ SessionView[]` — so making the server a second caller later is adding a caller, not a rewrite.

Rejected: the server owning the poll and exposing `/api/sessions` (inverts the dependency: managing
sessions would require the server to be up).

### D8 — Notification is the cockpit counter plus a terminal BEL

Sessions needing attention sort to the top with a colour **and a word**; the header carries a count
(`2 waiting`, localized like the rest of the chrome) visible from any tab; a `BEL` fires on the transition into a waiting state, which
most terminals already surface as a tab badge.

Rejected: native desktop notifications (three per-OS paths to maintain, and none of them works over
ssh — the exact case where background sessions matter most); the web notification store (needs the
server up and a browser open).

### D9 — `SpawnSpec` is a total Record, and a harness without one is absent

```ts
const SPAWN_SPECS: Record<HarnessId, SpawnSpec | null>
```

A `Record` rather than an array, for the reason CLAUDE.md already states about `HARNESS_SORT`: the
compiler then refuses a build that forgot a harness, whereas an array literal with a member missing
compiles clean and the harness silently disappears from half the product.

`null` means "not spawnable by us yet", and such a harness **does not appear in the wizard** rather
than appearing and failing. Phase 1 fills `claude`, `codex`, `kimi`; the rest are `null` and become
real by declaring an object, with no logic change.

## Architecture

```
packages/server/server/sessions/
  types.ts          SessionBackend, ManagedSession, SessionView, SessionState  (the contract)
  spawn-spec.ts     PURE   Record<HarnessId, SpawnSpec|null>; spec + options -> argv
  attention.ts      PURE   quiescence + AttentionRules + frame -> SessionState
  monitor.ts        PURE   backend snapshot + processes + registry + labels -> SessionView[]
  registry.ts       ~/.agentistics/sessions/managed.json  (id, harness, cwd, spec, createdAt)
  labels.ts         ~/.agentistics/session-labels.json    (label, note), read by data.ts
  backend-tmux.ts   IO     Unix
  backend-pty.ts    IO     Windows, talks to the per-session host
  host.ts           IO     `agentop session-host` — owns one ConPTY, serves one named pipe
  index.ts          resolveBackend(): the only place that branches on platform

packages/server/server/cli-session.ts    `agentop session …` command handler
packages/server/server/cli-start.ts      ControlHost gains the session verbs
packages/tui/src/control/tabs/Sessions.tsx   the new tab
packages/tui/src/control/types.ts        'sessions' joins TabId / TAB_ORDER
```

The layering rule from CLAUDE.md holds unchanged: **the control center owns no logic.**
`cli-start.ts` performs every action behind `ControlHost` and returns already-localized
`ActionResult`s; `Sessions.tsx` renders and reports intents.

### `SessionBackend`

```ts
interface SessionBackend {
  readonly id: 'tmux' | 'pty'
  /** Why this backend cannot run here, already localized. Absent when it can. */
  unavailable(): Promise<string | undefined>
  spawn(req: SpawnRequest): Promise<{ id: string }>
  list(): Promise<BackendSession[]>
  /** Last rendered frame, for attention classification. */
  capture(id: string, lines: number): Promise<string[]>
  kill(id: string): Promise<void>
  /** argv the caller execs after unmounting Ink. Never spawned by the backend itself. */
  attachCommand(id: string): string[]
}
```

`attachCommand` returns a command rather than performing the attach, because the attach has to run
on the real tty **after** Ink has unmounted — the ordering rule `altScreen.ts` already enforces.

### `SessionState`

```ts
type SessionState =
  | 'working'            // wrote bytes within QUIET_MS
  | 'waiting-approval'   // quiet, frame matched an approval pattern
  | 'waiting-input'      // quiet, frame matched an input-prompt pattern
  | 'idle-unknown'       // quiet, nothing matched — said in those words
  | 'exited'             // the process is gone; the pane is holding the output
  | 'external'           // not ours: no PTY, therefore no attention state
```

## CLI

```
agentop session <harness> [-p "prompt"] [--bg] [--model <id>] [--effort <level>]
                          [--cwd <path>] [--name "label"]
agentop session list
agentop session attach <id|name>
agentop session kill   <id|name>
agentop session rename <id|name> "label"
agentop session note   <id|name> "text"
```

- No `--cwd` means the current working directory.
- Without `--bg` the command attaches. Before handing over the terminal it prints the detach
  instruction (`Ctrl-b d` on tmux; the Windows backend's equivalent), because a user who cannot get
  out is stranded in a buffer that hides their shell.
- `--model` / `--effort` are validated against that harness's `SpawnSpec`; an unknown value is
  refused with the list of accepted ones rather than passed through to fail inside the CLI.
- A harness whose `SpawnSpec` is `null` is refused by name, listing the ones that do work.

## TUI — the `Sessions` tab

Same shape as the Services cockpit, reusing `Pane`, `cockpitLayout`, `fitDetailLines` and
`footerHints`: a band of `list | detail` over a full-width detail region, with a focus-scoped action
row underneath.

- **List** — one row per session: state glyph **and word**, harness, label (or the fallback), project.
  Rows needing attention sort to the top.
- **Detail** — the selected session's harness, model, cwd, uptime, state with its reason, note, and
  the last frame's tail.
- **Keys** — `enter` attach · `n` new (wizard) · `r` rename · `d` note · `k` kill · `v` cycle view
  (harness / model / project / state) · `tab` cycle panes. Screens still change with `←`/`→` only.
- **Wizard** — harness → project/repo search → model → effort → prompt → background or attached.
  Every option the CLI accepts is reachable here, which is the stated requirement.
- **Refresh** — every 5 s, plus immediately after any action.

Mobile is not applicable (this is terminal-only); the web dashboard change is limited to rendering
the label that `data.ts` now stamps, which the existing `sessionLabel()` path already covers.

## Error handling

- **No tmux on Unix** — `unavailable()` returns the localized reason. The Sessions tab states it in
  words and offers **no** spawn verbs; `agentop session` exits with the install instruction. A verb
  that cannot work is absent, never present and failing.
- **Windows host process died** — its registry entry is reconciled to `exited` on the next poll; the
  row stays visible with its last frame so the output is not lost, and offers only `kill` (cleanup).
- **Frame capture fails** — the session keeps its last known state and the detail pane says the
  frame could not be read. It never silently becomes `idle-unknown`, which would read as a fact.
- **Registry and backend disagree** — the backend wins for existence, the registry for metadata.
  An id in the registry that the backend does not list is `exited`; one the backend lists that the
  registry does not know is shown as managed-but-unlabelled, never dropped.
- **Corrupt label/registry JSON** — read through the existing `safeReadJson`; a bad file yields an
  empty store and a warning, never a crash of the control center.

## Testing

Pure functions only, no filesystem mocking — the same discipline the repo already applies.

- `spawn-spec.test.ts` — spec + options → exact argv, per harness; unknown model/effort refused;
  every `HarnessId` has an entry (the Record's totality asserted at runtime too, so a future harness
  cannot be forgotten in a way only the type checker would have caught).
- `attention.test.ts` — real captured frames per harness as fixtures: a running turn, an approval
  prompt, an idle prompt, and an unrecognised frame that **must** yield `idle-unknown`.
- `monitor.test.ts` — the merge of managed and external sessions. Specifically: a managed session
  must never also appear as an external process (the same double-count trap `resolveLiveSnapshot`
  already documents), and an external row must carry no attention state.
- `registry.test.ts` / `labels.test.ts` — round-trip, reconciliation of a missing backend session,
  and label precedence over `title` / `first_prompt`.

Backend IO (`backend-tmux.ts`, `backend-pty.ts`, `host.ts`) is verified by hand against the compiled
binary, per the existing TUI rule — the devtools stub problem is invisible under `bun run`.

## Phases

Each phase is independently useful and independently shippable.

1. **Backend + CLI.** `TmuxBackend`, `spawn-spec.ts`, `registry.ts`, `agentop session` with
   `--bg` / attach / list / kill. No TUI yet.
2. **Monitor + Sessions tab.** `attention.ts`, `monitor.ts`, the tab, the 5 s poll, the header
   counter and the BEL. External sessions appear here.
3. **Wizard + labels.** Project/repo search, the new-session wizard, `rename` / `note`, and the
   `data.ts` stamp that carries labels to the dashboard.
4. **Windows.** `PtyBackend`, `host.ts`, `resolveBackend()`.
5. **Remaining harnesses.** `gemini`, `copilot`, `antigravity` — each is a `SpawnSpec` object plus
   its `AttentionRules` fixtures.

## Open risks

- **Attention patterns age.** Every upstream CLI release can change the frame. Mitigated
  structurally, not by vigilance: the quiescence gate keeps `working` correct regardless, and an
  unmatched frame degrades to `idle-unknown` rather than to a wrong answer. Fixtures are captured
  from real runs so a break shows up as a failing test rather than as a quietly wrong cockpit.
- **Windows ConPTY fidelity.** The harnesses' alternate-screen usage under a raw passthrough is the
  least-proven part of the design. Phase 4 is deliberately last so the whole product is already
  working on Unix before that risk is taken, and the phase's first task is a spike against the
  compiled binary.
