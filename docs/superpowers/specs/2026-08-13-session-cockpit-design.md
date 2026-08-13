# Session cockpit — design

**Date:** 2026-08-13
**Status:** approved, ready for planning
**Builds on:** the session manager Phase 1 already on `dev`
(`packages/server/server/sessions/`, `docs/session-manager.md`)

---

## 1. The problem

Running several assistants at once means several terminals, and a terminal is a poor index: you
cannot see from one which of the others is waiting for you, what each is working on, or which
project it sits in. The result is the thing this feature exists to remove — a screen full of
windows nobody can name, where the assistant that finished twenty minutes ago is indistinguishable
from the one still thinking.

`agentop` already owns a full-screen control center. The fleet belongs there.

## 2. What already exists (Phase 1, on `dev`)

Nothing in this design replaces it. Every piece below is an extension behind an interface that is
already in place.

| Module | What it settles |
|---|---|
| `sessions/types.ts` | `SessionBackend` (where a session runs) and `SpawnSpec`/`planSpawn` (what to run). Neither knows the other: the planner emits an argv, the backend hosts an argv. |
| `sessions/backend-tmux.ts` + `tmux-cli.ts` | The Unix backend on its OWN socket (`-L agentop`), so agentop sessions never mix with the user's tmux. Every argv and parse is pure and tested; every field was probed against tmux 3.2a. |
| `sessions/spawn-spec.ts` | `Record<HarnessId, SpawnSpec \| null>` — claude, codex, kimi. A harness with no spec is ABSENT from the wizard, never offered and failing. |
| `sessions/registry.ts` | `~/.agentistics/managed-sessions.json`, with `label` and `note`. tmp-then-rename, corrupt-file quarantine, one in-process writer. |
| `sessions/session-ref.ts` | `resolveSessionRef` (ambiguity-averse) and `reconcileSessions` (registry ∪ backend; neither side's facts dropped). |
| `sessions/cli-parse.ts` + `cli-session.ts` | `agentop session <harness> [-p …] [--bg] [--model] [--effort] [--cwd] [--name]`, plus `list/attach/kill/rename/note`. |

Two properties of that work are load-bearing for everything below:

- **`attachCommand(id)` returns an argv rather than executing it.** The attach needs the real tty,
  which it can only have once the caller has released it. This is exactly the terminal-takeover
  model the cockpit needs.
- **`detachHint()` reads the user's real tmux prefix** rather than assuming `Ctrl-b`.
- **`BackendSession.lastActivityMs` already exists**, annotated for this design's quiescence gate.

## 3. Decisions taken

| # | Question | Decision |
|---|---|---|
| 1 | Windows, where tmux does not exist | Keep the abstract `SessionBackend`. tmux on Unix; a per-session ConPTY host on Windows. |
| 2 | How "needs attention" is detected | Hybrid: probed screen rules first, output movement second, and **a harness with no probed approval rule says so rather than reporting a confident "fine"**. |
| 3 | Which sessions the monitor shows | Managed AND external, with honest per-row capabilities. |
| 4 | What attach does | Full terminal takeover; the cockpit remounts where it was on detach. |
| 5 | What the project picker searches | agentistics history (fuzzy, recency-ranked, grouped by git remote) with a typed path accepted as a fallback. |
| 6 | Where the user's label/note live | Local store (already built), and the dashboard shows the same name. |
| 7 | How attention is announced | Counter in the cockpit header + terminal BEL on transition. Nothing OS-specific. |
| 8 | Harness coverage | claude + codex + kimi first; the rest by declaring a `SpawnSpec`. |
| A | Who polls | The cockpit. The polling logic is pure, so a server-side caller can be added later without a rewrite. |
| B | How a background session survives on Windows | One detached host process per session — the same semantics tmux gives on Unix. |

---

## 4. Architecture

```
packages/server/server/sessions/
  types.ts            (extended)  SessionActivity, SessionView, SessionSnapshot
  attention.ts        NEW, PURE   frame + quiescence -> SessionActivity
  attention-rules.ts  NEW, PURE   Record<HarnessId, AttentionRules>, probed from real frames
  session-view.ts     NEW, PURE   reconciled ∪ external -> SessionView[]; grouping; bell
  project-search.ts   NEW, PURE   fuzzy rank over project/repo candidates
  project-source.ts   NEW         reads the local consolidate store -> candidates (cached)
  sessions-host.ts    NEW         the impure poller: backend + registry + /proc, feeds the TUI
  backend-pty.ts      NEW         Windows backend (per-session host)
  pty-protocol.ts     NEW, PURE   the host's newline-delimited control protocol
  pty-host.ts         NEW         `agentop session-host` — owns one ConPTY, detached

packages/tui/src/control/
  types.ts            (extended)  ControlHost session verbs; ControlExit 'attach'
  tabs/Sessions.tsx   NEW         the monitor tab
  sessions.ts         NEW, PURE   the tab's layout arithmetic and key reducers
```

The dependency direction the repo already mandates holds: **the TUI owns no logic.** Every decision
— what a session's state is, what the wizard may offer, whether a verb can work here — is made in
`packages/server/server/sessions/` and reaches the Ink layer as already-resolved data through
`ControlHost`.

### 4.1 `attention.ts` — pure, and deliberately unable to lie

```ts
export type SessionActivity =
  | 'working'           // a proof marker is on screen, or the frame moved since the last poll
  | 'waiting-approval'  // a probed approval question is on screen
  | 'waiting'           // alive and quiet — it is waiting for you
  | 'exited'            // the hosted command finished

export interface AttentionRules {
  /** A frame matching one of these is a question the session is blocked on. */
  approval: RegExp[]
  /** Proof the session is working even if it did not redraw between two polls. Absent for a
   *  harness whose frames carry no such marker — codex genuinely has none. */
  working?: RegExp[]
  /** Provenance: the exact CLI version the frames came from, and the date. */
  probed: string
}

export function attentionOf(o: {
  alive: boolean
  lastActivityMs: number
  nowMs: number
  frameDigest: string
  prevDigest?: string
  rules?: AttentionRules      // absent for a harness with no verified rules
  frame: readonly string[]
}): SessionActivity
```

Order of evidence, strongest first:

1. `!alive` → `exited`.
2. `rules.approval` matches the frame → `waiting-approval`. A blocked question outranks every
   movement signal: the dialog IS the frame, and nothing else is running behind it.
3. `rules.working` matches the frame → `working`. This is a PROOF marker, consulted before the
   movement test so a session that is genuinely thinking without redrawing is never called quiet.
4. `frameDigest !== prevDigest`, or `nowMs - lastActivityMs < QUIET_MS` (6s, one poll interval plus
   slack) → `working`. Two signals because each alone is wrong somewhere: tmux's `session_activity`
   has one-second resolution and a spinner redrawing the same bytes moves it, while a frame digest
   cannot see a process that is thinking without drawing.
5. Otherwise → `waiting`.

`needsAttention` is `waiting-approval | waiting`, and step 5 is a sound inference rather than a
guess: an interactive assistant whose process is alive and whose screen has stopped moving is, by
construction, waiting for the person in front of it. There is no third thing it could be doing.

**Where the honesty gap actually lives is `rules.approval` being absent**, and that is where the UI
must state it: for a harness with no probed rules the detail pane says approval detection is
unavailable for it, so a session blocked on a permission prompt is reported as `waiting` (correct,
and it still raises the counter) rather than as a confidently distinct state the system cannot see.
This replaces an earlier `idle` state that tried to encode "we do not know why" — probing showed the
uncertainty is about the REASON, never about the fact, and a state word is the wrong place to put it.

`digestFrame(lines)` is a dependency-free FNV-1a over the joined frame, so the pure function takes
strings and the caller does no hashing of its own.

#### Probed frames — provenance

`attention-rules.ts` carries a dated provenance string per harness, in the style `tmux-cli.ts`
already uses. The rules below were captured from real sessions on **2026-08-13** by starting each
CLI under tmux and reading `capture-pane`; nothing here is written from memory of what a CLI prints.

| Harness | Version | `approval` (probed) | `working` (probed) |
|---|---|---|---|
| claude | 2.1.231 | `Enter to confirm · Esc to cancel` | `esc to interrupt` |
| codex | 0.113.0 | `Press enter to continue` | — none exists — |
| kimi | 0.35.0 | `↑↓ navigate · Enter select · Esc exit` | — none exists — |

Two findings from that probe are load-bearing and would have been got wrong from memory:

- **Claude's input box is not a discriminator.** The `❯` prompt line is drawn identically while
  working and while idle; only the footer changes (`esc to interrupt` versus `? for shortcuts`).
  A rule keyed on the input box would have reported every working session as waiting.
- **Codex has no working marker at all.** Its footer and its ghost placeholder
  (`› Find and fix a bug in @filename`) are byte-identical while it streams output and while it sits
  idle. For codex, movement is the only working signal there is — which is precisely why step 4
  exists and why `rules.working` is optional rather than required.

### 4.2 `session-view.ts` — pure

```ts
export interface SessionView {
  id: string
  harness: HarnessId
  cwd: string
  label?: string
  note?: string
  model?: string
  status: 'running' | 'exited' | 'lost' | 'unregistered' | 'external'
  activity?: SessionActivity   // ABSENT for external sessions — not capturable, so not knowable
  createdMs?: number
  attached: boolean
}
```

`status === 'external'` is the whole of "this row cannot be acted on" — there is deliberately no
separate `managed` boolean saying the same thing twice, because two fields encoding one fact are
two fields that can disagree. `unregistered` is still ours: the backend hosts it, so it attaches
and kills like any other; only the registry has forgotten what it means.

Merges `reconcileSessions(registry, backend)` with the external processes from
`live-sessions.ts`, dropping an external process whose harness and cwd are already covered by a
managed session — the same `sessionAtCwd` predicate the live panel uses, so the two surfaces cannot
disagree about whether one running assistant is one row or two.

External rows carry `activity: undefined` and offer no attach, no kill, no rename. They are on the
list because "the fleet in one place" is the point; they are labelled as external because pretending
otherwise would be offering verbs that cannot work.

Also pure and here: `groupSessions(views, by)` for the view modes
(`'harness' | 'model' | 'project' | 'none'`) and `bellTransitions(prev, next)`, which returns the
ids that JUST entered attention — so the BEL fires on a transition and not once every five seconds.

### 4.3 `sessions-host.ts` — the poller

Every 5 seconds (`SESSION_POLL_MS`, env-overridable), it:

1. reads the registry and `backend.list()`,
2. captures a frame **only** for sessions that are alive and did not move on the cheap signal —
   a session already known to be `working` costs no `capture-pane`,
3. runs the pure functions,
4. reads `scanProcesses()` for the external half,
5. emits a `SessionSnapshot`.

Concurrency is bounded by the existing `createLimiter` from `utils.ts`. Every backend call is
already total (`unavailable()` rather than a throw), so a poll that fails yields the previous
snapshot plus a reason, never a crash and never an empty list rendered as zero.

`SessionSnapshot.unavailable?: string` carries the backend's own localized reason (no tmux
installed, for instance). The tab always exists; what it says when it cannot work is a sentence,
not an empty pane.

### 4.4 The `sessions` tab

A new `TabId` inserted after `services` in `TAB_ORDER`, following every rule the control center
already enforces: a band of panes over a full-width detail pane, `Pane` for containment, pure
layout arithmetic in `sessions.ts` with tests, `windowOffset` scrolling on the list, `flexShrink={0}`
on the root, and a footer that names only keys that work in the current focus.

- **List** — one row per session, attention-first ordering, then recency. Cells give up the label
  first under width pressure and the state word last, mirroring `serviceCells`.
- **Detail** — harness, model, effort, cwd (and the repo it belongs to), age, the note, and the last
  few captured lines of the frame.
- **Keys** — `enter` attach · `n` new · `r` rename · `t` note · `k` kill (confirm) · `v` cycle view
  · `/` filter · `esc` back.
- **Header** — `ControlStatus.attention?: number` drives a counter in the header tag, visible from
  every tab. `headerLayout`/`headerMetaWidth` are updated to measure it, since the tag's width is
  what decides block wordmark versus compact mark.

### 4.5 Attach — a new `ControlExit`

```ts
type ControlExit =
  | { kind: 'quit'; code: number }
  | { kind: 'foreground' }
  | { kind: 'attach'; argv: string[]; detachHint: string; label: string }   // NEW
```

The Ink app never execs anything. It reports the intent; `cli-start.ts` unmounts Ink, leaves the
alternate buffer, prints the real detach hint, spawns the argv with inherited stdio, and — when that
returns — **re-enters the control center on the `sessions` tab**. The loop is what makes "volta pro
cockpit ao sair" true, and it costs no new escape hatch inside the mounted app.

This is the same discipline `central.sh init` already follows through `suspend`: a child that needs
the real tty gets it only after the buffer is released.

### 4.6 The wizard

A question flow inside the tab, using the existing `Prompt`/`Menu` primitives, reporting `capture`
exactly as the cockpit's questions already do (global keys stand down; the footer names the three
keys that work):

1. **Harness** — only those with a `SpawnSpec`.
2. **Where** — the search field. Fuzzy over candidates from the local consolidate store
   (`~/.agentistics/sessions/<harness>/*.json`), deduped by `project_path`, grouped by
   `normalizeGitRemote` so a repo reads as one entry, ranked by last activity. The current directory
   is always the first candidate. A typed string that resolves to an existing directory is accepted
   even when the history has never seen it.
3. **Model** — `modelSuggestions` as a picker, free text allowed (the spec's own comment already
   explains why this is not a validation list). Skipped when the harness has no `modelFlag`.
4. **Effort** — a genuine closed enum, so this one IS validated. Skipped when the harness has none.
5. **Prompt** — optional.
6. **Attached or background.**

Then `planSpawn` → `backend.spawn` → `registry.add`. An attached choice returns the `attach`
`ControlExit` above, so starting attached and attaching to an existing session are the same code path.

`project-source.ts` reads the store directly rather than through the API: the control center must
work with the server stopped, which is the state a user is most likely to be in when they open it.
The candidate list is cached in-process with a TTL — the wizard opening is the only thing that
reads it, never the 5-second poll.

### 4.7 `backend-pty.ts` — Windows

One detached host process per session (`agentop session-host --id <id>`), which owns a ConPTY,
keeps a bounded scrollback ring, and serves a newline-delimited JSON protocol over a named pipe.
Discovery is `~/.agentistics/session-hosts/<id>.json`, written by the host at startup and removed
on exit.

This mirrors tmux rather than inventing a second model: killing one host kills one session, a
crashed host does not take the fleet with it, and `agentop session --bg` works with the agentistics
server stopped. `attachCommand(id)` returns `['agentop', 'session-attach', '<id>']` — a raw
passthrough that pipes stdin/stdout to the pipe and detaches on a documented key sequence, printed
before entry exactly as the tmux hint is.

`pty-protocol.ts` holds the framing and every message shape, pure and tested, for the same reason
`tmux-cli.ts` exists: the parts that fail invisibly are the parts that must be testable without a
running host.

### 4.8 Labels reaching the dashboard

`ManagedSession` gains `sessionId?: string` — the harness's OWN session id, once it can be
established beyond doubt. A pure `linkManagedSession()` resolves it from harness + cwd + the
creation instant, and **returns nothing when more than one candidate fits**. `data.ts` then stamps
`label`/`note` onto the matching `SessionMeta`, and `sessionLabel()` prefers the user's label over
the harness's title.

Ambiguity yields no link and no stamp. A metrics store is the last place to be lucky, and an
unlabelled session is a smaller failure than a label on the wrong one.

---

## 5. Error handling

- Every backend method is already total. `unavailable()` is the way a backend says it cannot work,
  and the tab renders that sentence instead of an empty list.
- A failed poll keeps the previous snapshot and says the refresh failed. It never renders zero.
- `kill` already returns a confirmed-gone boolean; the cockpit deletes the registry entry only on
  `true`, so a session that survived its kill is never left unnameable.
- A corrupt registry degrades to "no sessions" and quarantines the bytes; that is existing behaviour
  and the cockpit inherits it.
- A harness with no `SpawnSpec` and a runtime with no backend are both ABSENT from the wizard rather
  than present and failing.

## 6. Testing

Pure, so tested without a tmux server, a `/proc` or a filesystem:
`attention.ts`, `attention-rules.ts` (against captured frame fixtures), `session-view.ts`,
`project-search.ts`, `pty-protocol.ts`, and the tab's `sessions.ts` layout arithmetic.

Filesystem-touching modules follow the `createSessionRegistry(file)` pattern already established —
bound to a path, pointed at a temp directory by the test, exercising the real filesystem. No fs
mocks, per the repo rule.

TUI work is verified against the **compiled binary**, not `bun run`, and at the narrow widths the
layout tests assert.

## 7. Phasing

Each phase is independently shippable and leaves the product working.

| Phase | Content |
|---|---|
| **2** | `attention.ts`, `attention-rules.ts`, `session-view.ts`, `sessions-host.ts`, and the `sessions` tab READ-ONLY: list, views, detail, 5s refresh, header counter, BEL. The monitor, delivered. |
| **3** | Cockpit actions: attach (the new `ControlExit` + the re-entry loop), kill, rename, note. |
| **4** | The wizard: `project-search.ts`, `project-source.ts`, the question flow. |
| **5** | `backend-pty.ts`, `pty-protocol.ts`, `pty-host.ts` — Windows. |
| **6** | `SpawnSpec`s for gemini / copilot / antigravity, and `linkManagedSession` → labels in the dashboard. |

## 8. Out of scope

- Adopting an external process into the backend (`reptyr`) — it does not exist on macOS or Windows
  and fails often on Linux, so it would be a verb that cannot work.
- Rendering a session inside an Ink pane — the harnesses use the alternate screen and heavy ANSI;
  a terminal emulator inside Ink would render them wrong.
- Desktop notifications and a server-side `/api/sessions` — deliberately deferred; the polling
  module is pure so either can be added as a caller.
- Multi-machine session management from a central. Sessions are a property of the machine they run
  on, and a central has no visibility into a member's processes.
