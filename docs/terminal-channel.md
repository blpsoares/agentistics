# Live terminal channel

`GET /api/fleet/stream` streams a managed session's terminal — the actual screen a coding assistant
is drawing, colours and all — to the browser over SSE, so the sessions tab can show what an agent is
doing without anyone opening a terminal and running `tmux attach`.

This is the **server contract** the web dashboard consumes. The web side (the terminal panel and its
emulator) must build on exactly this — it does not invent its own endpoint.

**Phase 1 is read-only.** There is no write path yet: no keystrokes reach the session through this
channel. A write channel (`Phase 2`) is a separate, later delivery with its own security contract;
until it exists the web must show **no input box**, because a text field that does nothing is the
same kind of lie as a frozen terminal that looks live.

## Transport, and why

**SSE (Server-Sent Events), snapshot-based, viewer-gated, one shared loop per session.**

- **SSE over WebSocket.** The read channel is one-directional (server → browser). SSE is plain
  HTTP, reconnects on its own, and is already the dashboard's push transport (`/api/events`). A
  WebSocket would buy bidirectionality Phase 1 does not use and a dependency the repo does not have.
- **Snapshot (`tmux capture-pane`) over a raw byte stream (`pipe-pane`).** `capture-pane` returns
  the *rendered grid* — a spinner, a redrawn line, a moved cursor are already resolved to their
  final glyphs by tmux before we see them. So every frame is a **complete, self-contained picture**:
  a reader that joins late or reconnects needs no replay, and what we show is what the pane actually
  rendered (the `attention-rules.ts` discipline: never a reconstruction from memory of what a CLI
  prints). Colours survive because we capture with `-e`.
- **Viewer-gated + shared.** A session is captured **only while at least one browser is watching**
  it. Many readers of the same session share **one** capture loop and **one** tmux read per tick; an
  unchanged frame is sent to nobody. So the server's work scales with the number of open *terminals*
  (usually one), never with the size of the fleet — the criterion the spec set.

Tuning constants live in `packages/server/server/sessions/terminal-stream.ts`
(`TERMINAL_VIEW_LINES`, `TERMINAL_POLL_MS`) and `terminal-web.ts` (`MAX_TERMINAL_STREAMS`,
`KEEPALIVE_MS`). The poll cadence is overridable with `AGENTISTICS_TERMINAL_POLL_MS`.

## Request

```
GET /api/fleet/stream?id=<sessionId>
Accept: text/event-stream
```

- `id` — the session's id, the **same `id`** carried on every row of `GET /api/fleet` and accepted
  by `POST /api/fleet/act`. No other identifier.
- Same-origin only; no body.

### Status codes (before the stream opens)

| Code | Meaning |
|------|---------|
| `200` | Stream opens (`text/event-stream`). |
| `400` | `{"error":"bad_request"}` — `id` missing. |
| `404` | `{"error":"not_found"}` — `id` is not a session this machine manages (**scope**). |
| `404` | `{"error":"fleet_central"}` — called on a team central (the fleet lives on members). |
| `403` | `{"error":"capability_disabled","capability":"localShell"}` — exposed profile (see Security). |
| `503` | `{"error":"too_many_streams"}` — process at `MAX_TERMINAL_STREAMS`. |

## Events

The stream emits named SSE events. `: keepalive` comment lines arrive ~every 15s and are ignored.

### `open` — once, first

```json
{ "id": "3f5f", "viewLines": 200, "historyLimit": 50000 }
```

### `frame` — the screen, on every change (deduped)

```json
{
  "seq": 7,
  "content": "[1m[35mclaude[0m … ",
  "cols": 120,
  "rows": 40,
  "cursor": { "x": 6, "y": 12 },
  "alive": true,
  "lines": 53,
  "historyLimit": 50000,
  "truncated": false
}
```

| Field | Meaning |
|-------|---------|
| `seq` | Monotonic within one stream; advances **only when the screen changed**. A late reader's first frame is the current one, whatever its `seq`. |
| `content` | The rendered pane, `\n`-joined, **with SGR escape sequences intact**. Feed it to a terminal emulator. |
| `cols` / `rows` | Pane geometry (`0` cols is a rare "don't know" fallback; the emulator sizes itself). |
| `cursor` | Block-cursor position, or **`null` once the pane is dead** — never draw a cursor on a dead frame. |
| `alive` | `false` once the hosted command has exited. The last frame stays readable and must be shown as **finished**, not live. |
| `lines` | How many lines `content` carries — the honest "you are seeing N lines" number. |
| `historyLimit` | The scrollback ceiling tmux keeps (`50000`), for a "showing last N of up to M" line. |
| `truncated` | `true` when there is more scrollback above than this frame carries. |

**Rendering.** Each `frame` is a full snapshot, not a delta: on receipt, reset the emulator and write
`content` (`term.reset(); term.write(frame.content)`), or the equivalent. Do not append frames.

### `end` — once, last (then the stream closes)

```json
{ "reason": "gone" }
```

- `gone` — the session left tmux (killed, or the machine's tmux went away). Mark the terminal
  ended; the last `frame` is the last thing it drew.
- `not-found` — the id stopped being a managed session mid-stream (scope).
- `error` — the backend could not be read.

A session that merely **exits** does **not** end the stream — it keeps arriving as `frame`s with
`alive:false`, so the finished screen stays readable. `end` is only for a session that is gone.

## Security

The read channel inherits the fleet's existing model exactly — it invents no new auth:

- **`localShell` capability** (`capability-guard.ts`). Streaming a session's screen is a coding
  assistant's terminal, transcript and all — shell access with extra steps. So it is **403'd on any
  exposed profile** (`lan`/`public`) regardless of who is authenticated, the same as `/api/fleet`.
  On a `local` profile (127.0.0.1, the machine's own dashboard) it is available, as the fleet is.
- **Scope.** A stream opens only for a session **this machine manages** (its own registry). The read
  power never reaches past the fleet the dashboard already lists — the boundary the Phase 2 *write*
  path will inherit, established here where it is cheap.
- **404 on a central.** Like `/api/fleet`; the fleet is a member/solo concept.

## Status indicators beside the terminal

Any activity indicator the web shows next to the terminal (working / needs-you) must come from the
**fleet's own state** (`GET /api/fleet`, the `activity`/attention the cockpit already computes) —
which, per PR #243, requires **two concordant samples** before it asserts `waiting` and accepts a
return to work immediately. Do **not** recompute a separate "looks idle" signal from the terminal
frames: a still screen is not the same as a session waiting on a person, and inventing a second
source is how the two disagree.

## Files

| File | Role |
|------|------|
| `sessions/tmux-cli.ts` | pure — `capturePaneAnsiArgs` (`-e`), `paneInfoArgs` / `parsePaneInfo`. |
| `sessions/terminal-stream.ts` | pure — frame shape, dedup digest, `buildFrame`, SSE encoder. |
| `sessions/terminal-hub.ts` | the shared, ref-counted, deduped capture loop (injectable). |
| `sessions/backend-tmux.ts` | `captureTerminal` — one ANSI-preserving read + geometry. |
| `sessions/terminal-web.ts` | singleton wiring + SSE plumbing + scope/cap gates. |
| `server/index.ts` | the `GET /api/fleet/stream` route. |
