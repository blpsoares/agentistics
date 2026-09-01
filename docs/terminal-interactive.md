# Interactive live terminal (Phase 2, web half)

`docs/terminal-channel.md` describes the **read** channel — an SSE stream of a managed session's
screen, read-only by design. This document is its **write** half: letting a person at the dashboard
type into that session, and the four design decisions the feature turns on. The pure core is
`packages/web/src/lib/terminalInput.ts`; the UI is `TerminalComposer` in `RecentSessions.tsx`.

## What it is built on — no new endpoint

There is exactly one web-reachable way to write into a managed session, and this feature uses it
unchanged: `POST /api/fleet/act { id, action: 'prompt', text }` → the host's `promptSession`, which

- refuses an empty line,
- refuses when the session is on a dialog (`sessPromptBlocked`),
- refuses when the session is not running,
- otherwise types the line into the session **and submits it** (`sendText`, one `tmux send-keys`
  followed by `Enter`), returning `{ ok, message }`.

So the server already delivers a **whole line atomically** and answers honestly whether it landed.
The web half is the browser-side state machine that keeps a person's typing honest against that one
verb. It invents no route and requires no `packages/server` change.

## The four decisions

### 1. Consent — per session, in-memory, explicit, revocable

Typing into a live session changes another running process (a coding agent mid-work). That is not
something a viewer should do as a side effect of the terminal being on screen, so it is a deliberate
opt-in: the region is **read-only until you press "Type into this session"**, and a **"Stop"** revokes
it and drops any pending line.

- **Per session.** Arming one session never arms its neighbour; several terminals share one page.
- **In-memory, for this surface's lifetime.** It is not persisted — a reload or a re-open re-asks.
  "Drive this session now" is a decision to re-make, not a durable grant a stale or returning tab
  keeps. Re-arming costs one click.
- **It is an INTENT gate, not a security boundary.** The server's `localShell` capability (403 on any
  exposed profile), the scope check (only sessions this machine manages), and the dialog refusal
  remain the real authority. The gate's job is to keep a human decision at the head of every
  interactive session, not to guard the API — a hidden button is not a closed door, and this button
  does not pretend to be one.

### 2. Batched to a line, not key-by-key

**Measured against what the backend can actually do:** the only web-reachable write is `sendText`,
which types a line *and* presses Enter as one act. There is no endpoint for a single raw key —
`sendKey` exists on the backend but is not web-exposed, and `sendText` cannot omit the Enter. So
per-key is not merely expensive here, it is **unrepresentable** on the current server.

It would also be the wrong shape even if it existed. One HTTP round-trip per keystroke means, at an
ordinary ~5 keystrokes/second, ~5 requests/second per typist, each spawning a `tmux send-keys`
process on the host; requests can complete **out of order** (nothing guarantees keystroke N lands
before N+1); and it floods the audit (see decision 4). So the line is edited **locally** — the native
`<input>` is the line editor, so backspace, cursor movement and paste are the browser's, free and
correct — and **one** request carries the finished line, ordered by construction.

Raw char-mode — Ctrl-C, arrow keys, Tab-completion in the target program, typing without an implicit
submit, answering a raw (non-numbered) dialog by keypress — genuinely needs a new server keystroke
channel. That is **Phase 2b** (see "Escalation" below) and is out of `packages/web`'s scope.

### 3. Failure mid-typing — the load-bearing rule

The terminal must never accept a key visually and fail to deliver it. This design **removes the
failure surface** rather than papering over it:

- Keys are **local until submit**. Nothing is delivered per key, so nothing per key can be lost. The
  draft is drawn as a visibly distinct **local line** (an accent rule and a `›` prompt, not the
  session's own colours) so local echo is never mistaken for the session having received it.
- The one delivery is the line, and it moves through explicit states: **composing → sending →
  delivered | failed**. On success the draft clears and the composer stays armed for the next line.
  On failure the **exact line is kept**, marked *not delivered* with the server's own reason, ready
  to edit and resend — it is never silently dropped.
- While **sending** the composer is **locked** (no editing, no second submit), so two lines can never
  race out of order.

The state machine is `composerReducer` in `terminalInput.ts`, pinned by `terminalInput.test.ts`; the
honesty rules live there, not in the JSX.

### 4. Audit without noise

Only the **atomic send** is auditable, through the existing browser-side write-channel record
(`lib/promptAudit.ts` → `recordPromptSend`): who / which session / the exact line / when / the
outcome. Local edits — typing, backspacing, revising a failed line — are **not** audited: they are not
sends, and per-keystroke auditing is exactly the flood this decision warns against. One line,
delivered-or-failed, is one audit entry — the granularity the write channel already recorded for the
"Send a prompt" menu form. This feature adds nothing to that schema; it routes its sends through the
same record, and the persisted log renders unchanged in the session's actions panel.

## When the composer is not offered

A row that cannot be typed into says why in one sentence and shows **no arming button** (the same rule
the session menu applies — a control that does nothing is worse than an honest refusal).
`interactionBlock(row.state)` decides:

| Row state | Block | Sentence |
|-----------|-------|----------|
| `working`, `waiting` | none | typable — a queued line is picked up on the next turn |
| `waiting-approval` | `awaiting-approval` | answer the dialog; you cannot type past it |
| `exited`, `lost`, `closed` | `not-running` | no live process to receive the line |
| `unknown` (external) | `external` | not started by agentop; nothing here can write to it |

A session that goes un-typable *while armed* (killed, or falls onto a dialog) is disarmed
automatically and shows the block sentence, so an armed composer can never sit over a session where
every send would fail.

## Phase 2b — the raw keystroke channel, `POST /api/fleet/input`

Full char-mode interactivity (Ctrl-C, the arrows that move a highlighted option, Esc, Tab
completion inside the tool, typing that does not submit, answering a raw dialog by keypress) needs
individual keys, and the line composer above cannot express one. That endpoint now exists, built
for the VS Code extension's live screen — see [`docs/vscode-extension.md`](vscode-extension.md).

```
POST /api/fleet/input        { id, text }  |  { id, key: { key, ctrl?, alt?, shift? } }
→ { ok, message }            message always present, already localized
```

- **`text` is typed literally and submits NOTHING** (`sendLiteral`, `send-keys -l`), which is the
  whole difference from `prompt`: a person typing presses Enter when they mean it. `sendLiteral` is
  its own backend method rather than a flag on `sendText`, because the two answer different
  questions and a flag lets a caller ask the wrong one by omission — `sendText` delivers a MESSAGE,
  and a message that is never submitted was never sent.
- **`key` is one key, in the BROWSER's vocabulary**, mapped to tmux's by the pure `fleet-input.ts`.
  One mapping, on the side that has to validate it anyway. **Nothing outside the table is sent**:
  `send-keys` given an unrecognised name does not fail cleanly — it falls back to sending the
  string — so a bogus key would become typed text in somebody's live session. An unmapped key is
  refused in a sentence naming the combination.
- **It does NOT refuse an open dialog**, and that is the difference from `prompt` rather than an
  omission. A LINE typed past a question goes into the dialog's own filter and its submit takes
  whichever option is highlighted; a KEY press is what answers that dialog, and the caller is
  looking at the frame. Scope and life are still checked: the session must be one this machine
  manages, and running.
- **Same gate as the read channel** — `localShell` (403 on any exposed profile) via the
  `/api/fleet` prefix in `capability-guard.ts`, and 404 on a central.
- **Ordering is the client's job and is done by construction.** HTTP requests can complete out of
  order, so the extension serialises sends per session (`api.ts`): each waits for the previous one
  to the same session, and printable characters are batched for 25ms into one `text`, so `abc` then
  Enter can never arrive as Enter then `abc`.

The line composer above is unchanged and remains the right shape for the dashboard, where there is
no focusable screen to type into.
