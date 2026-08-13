# Task 2 report — capture real frames and write the attention classifier

**Status:** complete.
**Commit:** `c4d4c95 feat(sessions): attention classifier with real captured frames as fixtures`
**Branch:** `worktree-agentop-sessions-tui` (worktree `.claude/worktrees/agentop-sessions-tui`)

---

## 1. Frames captured, per harness

All captures used a dedicated tmux socket, `-L agentop-fixtures`, a fixed 120x40 pane, and exactly
the command the backend runs (`capturePaneArgs` in `tmux-cli.ts` emits
`capture-pane -p -t <name> -S -<lines>`). Nothing else on the machine was touched.

### claude — 3 frames (idle + TWO different approvals)

```bash
tmux -L agentop-fixtures new-session -d -s probe -x 120 -y 40 -c /home/mithrandir/agentistics -- claude
# 20s later
tmux -L agentop-fixtures capture-pane -p -t probe -S -40 > packages/server/server/sessions/fixtures/claude-idle.txt
```

| fixture | how it was produced |
|---|---|
| `claude-idle.txt` | fresh `claude` in the (trusted) repo root, left alone 20s |
| `claude-approval-tool.txt` | typed a prompt asking claude to create `/tmp/agentop-probe-fixture.txt`; the `Write` tool raised the real permission dialog. Captured while the dialog was up, then answered with `Esc` (the file was never created — verified absent afterwards) |
| `claude-approval-trust.txt` | started `claude` with `-c /tmp/agentop-trust-probe` (a directory it had never seen), which raised the workspace-trust dialog |

Claude Code v2.1.229.

**The Bash permission prompt could not be raised on this machine, and that is worth recording.**
The first attempt was a prompt asking claude to run `df -h /` — a command allowlisted nowhere in
`~/.claude/settings.local.json`, `.claude/settings.local.json` or `~/.claude/settings.json`. It ran
without asking. The cause is the user's own global `PreToolUse` hook with `"matcher": "Bash"`
(`~/.claude/hooks/rtk-rewrite.sh`), which auto-approves every Bash call. So I switched to a `Write`,
which that matcher does not cover, and got a genuine tool-permission dialog. The rules are therefore
read from a real permission dialog — just a `Write` one rather than a `Bash` one. The two share the
dialog chrome the rules key on (`❯ 1. …` and the `Esc to cancel` footer).

**Confirming the brief's table:** yes, both the idle frame and the approval frames contain `❯`.

- idle line 37 is `'❯\xa0'` — the caret followed by a **U+00A0 NO-BREAK SPACE**, not an ASCII space.
  This is why a `grep -E '^\s*❯\s*$'` over the fixture reports **zero** matches while the same
  pattern in JavaScript matches: POSIX `\s` excludes U+00A0, JS `\s` includes it. The rule spells
  the codepoint out (`[ \t\u00a0]`) rather than trusting whichever class happens to cover it.
- `claude-approval-tool.txt` line 27 is `' ❯ 1. Yes'`; `claude-approval-trust.txt` line 13 is
  `' ❯ 1. Yes, I trust this folder'`.
- Neither approval fixture contains a bare-caret line, and neither contains `? for shortcuts`;
  the idle fixture contains neither `❯ N.` nor `Esc to cancel`. Cross-checked mechanically in the
  test (`every rule still matches the fixture it was read from`).

### codex — 3 frames (idle + TWO different approvals)

```bash
tmux -L agentop-fixtures new-session -d -s codexp -x 120 -y 40 -c /home/mithrandir/agentistics -- codex
```

| fixture | how it was produced |
|---|---|
| `codex-approval-trust.txt` | codex's own directory-trust dialog, shown on first start in this directory (after dismissing an "Update available" prompt with `2`) |
| `codex-idle.txt` | after answering the trust dialog with `1` + Enter, left at the composer |
| `codex-approval-tool.txt` | prompt: `Now run: touch /agentop-codex-probe-root.txt`. A path outside the sandbox writable roots, so codex raised its real escalation dialog (`Would you like to run the following command?` / `Press enter to confirm or esc to cancel`). Captured, then answered with `Esc` — the file was never created (verified absent afterwards) |

codex v0.113.0. A first attempt (`touch /tmp/agentop-codex-probe.txt`) ran with no prompt — `/tmp`
is inside codex's default writable roots — so the second prompt aimed at `/` instead. That file
was cleaned up.

### kimi — idle frame only; **no approval frame, so kimi gets `null` rules**

```bash
tmux -L agentop-fixtures new-session -d -s kimip -x 120 -y 40 -c /home/mithrandir/agentistics -- kimi
tmux -L agentop-fixtures capture-pane -p -t kimip -S -40 > packages/server/server/sessions/fixtures/kimi-idle.txt
```

`kimi-idle.txt` is a clean idle frame (Kimi Code 0.33.0). Driving it into an approval prompt was
attempted and **failed**, precisely:

1. Sent `Run the shell command: touch /tmp/agentop-kimi-probe.txt` and waited ~90s.
2. The pane showed the spinner, then
   `Error: [provider.connection_error] Connection error.` — the turn never reached a model, so no
   tool call and no permission prompt was ever possible.
3. Cause, read from `~/.kimi-code/config.toml` (read-only): kimi's `default_model` is
   `ollama-local/qwen2.5-3b-instruct`, and the only provider configured is
   `ollama-local → http://localhost:11434/v1`.
4. `curl -m 3 http://localhost:11434/api/tags` fails — ollama is installed
   (`/usr/local/bin/ollama`) but not running, and `~/.ollama/models/manifests/` is **empty**, so no
   model is pulled locally either.

Making kimi answer would have meant starting a daemon and pulling a multi-GB model, and switching
`default_model` would have rewritten the user's config. Neither is in scope for capturing a frame,
so I stopped and recorded the gap. Per the brief, **kimi keeps `null` rules and always reports
`idle-unknown`** — an input-only rule set built from the idle frame alone would name a kimi approval
prompt "waiting-input", a confident and specific wrong sentence. The idle fixture is committed
anyway: it is the evidence a follow-up task starts from, and it is live test data (a test asserts
that kimi's frame classifies as `idle-unknown`).

### gemini, copilot, antigravity — not captured

Out of the task's scope (the session manager does not start them). `null` rules, `idle-unknown`.

---

## 2. The one design change the evidence forced: positional matching

The brief's skeleton joins the frame and tests approval patterns, then input patterns, anywhere in
the whole string. **A fixture I captured breaks that**, and it is not a contrived one:

`codex-idle.txt` is an ordinary idle frame. `capture-pane -S -40` returns scrollback as well as the
live screen, and lines 0–8 of that idle frame still hold the directory-trust dialog codex opened
with — `Do you trust the contents of this directory?`, `› 1. Yes, continue`,
`Press enter to continue` — sitting above the composer that was drawn after it was answered. A
whole-frame match reports that session `waiting-approval` for the rest of its life. This is the
common case, not an artifact: the session manager spawning codex in a new directory produces exactly
this scrollback.

The rule was wrong, so the rule was fixed (never the fixture). `classifyAttention` now compares the
**position of the last matching line** for each side:

```ts
const approvalAt = lastMatch(rules.approval, input.capture.lines)
const inputAt = lastMatch(rules.input, input.capture.lines)
if (approvalAt < 0 && inputAt < 0) return 'idle-unknown'
return inputAt > approvalAt ? 'waiting-input' : 'waiting-approval'
```

A terminal UI draws its current state at the bottom, so the lower match is the more recent one.
**The brief's ordering guarantee is preserved and strengthened:** approval wins every tie and wins
outright unless the composer was redrawn *strictly below* the dialog — i.e. unless the harness
itself has already moved past it. A live approval prompt still cannot be reported as idle, which is
the error in the reassuring direction. The same reasoning covers claude's scrollback once a user has
answered a dialog there, which the whole-frame version would also have got wrong.

Patterns are matched **per line** rather than against a joined string, which is what makes `^`/`$`
mean line boundaries without the `m` flag and makes the position available at all.

---

## 3. TDD evidence

### RED — test written first, before `attention.ts` existed

```
$ bun test packages/server/server/sessions/attention.test.ts
bun test v1.3.14 (0d9b296a)

packages/server/server/sessions/attention.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './attention' from
'/home/mithrandir/agentistics/.claude/worktrees/agentop-sessions-tui/packages/server/server/sessions/attention.test.ts'
-------------------------------

 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [107.00ms]
```

### GREEN — after writing `attention.ts` and filling the rules from the fixtures

```
$ bun test packages/server/server/sessions/attention.test.ts
bun test v1.3.14 (0d9b296a)

 23 pass
 0 fail
 38 expect() calls
Ran 23 tests across 1 file. [100.00ms]
```

### Mutation check — proving the per-rule tests are not decorative

A rule that quietly stops matching is invisible while a sibling rule in the same array still fires,
so each rule is held to its own fixture individually. To prove that guard actually bites, I changed
the claude bare-caret rule from `[ \t\u00a0]` to `[ \t]` (i.e. re-introduced the U+00A0 bug) and
re-ran. The classification tests all stayed green — masked by the `? for shortcuts` sibling — and
the per-rule test caught it alone:

```
✗ every rule still matches the fixture it was read from > claude input rule 0 — ^[ \t]*❯[ \t]*$

Expected: > 0
Received: 0

 22 pass
 1 fail
```

The mutation was reverted immediately; the committed file has `[ \t\u00a0]`.

### Whole repo, via the pre-commit hook (`bun tsc --noEmit` + `bun test`)

```
 2952 pass
 0 fail
 23216 expect() calls
Ran 2952 tests across 174 files. [9.14s]
```

`bun tsc --noEmit` produced no output. (The stderr lines interleaved in the run are the deliberate
log output of other suites' negative-path tests, not failures.)

---

## 4. Files changed

Added (all in commit `c4d4c95`):

| file | what |
|---|---|
| `packages/server/server/sessions/attention.ts` | the pure classifier: `SessionState`, `AttentionRules`, `AttentionInput`, `QUIET_MS`, `ATTENTION_RULES`, `classifyAttention`, `needsAttention`. No I/O, no spawning |
| `packages/server/server/sessions/attention.test.ts` | 23 tests, fixtures loaded from disk with `readFileSync` |
| `packages/server/server/sessions/fixtures/claude-idle.txt` | evidence |
| `packages/server/server/sessions/fixtures/claude-approval-tool.txt` | evidence |
| `packages/server/server/sessions/fixtures/claude-approval-trust.txt` | evidence |
| `packages/server/server/sessions/fixtures/codex-idle.txt` | evidence |
| `packages/server/server/sessions/fixtures/codex-approval-tool.txt` | evidence |
| `packages/server/server/sessions/fixtures/codex-approval-trust.txt` | evidence |
| `packages/server/server/sessions/fixtures/kimi-idle.txt` | evidence (no rule reads it; a test pins the honest `idle-unknown`) |

Nothing else was modified. `sessions/index.ts` was deliberately left alone — the barrel export
belongs to whichever task first consumes the classifier.

### The rules, and the fixture line each was read from

| harness | side | pattern | fixture evidence |
|---|---|---|---|
| claude | approval | `/^[ \t\u00a0]*❯[ \t\u00a0]+\d+\.[ \t\u00a0]/` | `claude-approval-tool` L27 `❯ 1. Yes`; `claude-approval-trust` L13 `❯ 1. Yes, I trust this folder` |
| claude | approval | `/Esc to cancel/` | tool L31 `Esc to cancel · Tab to amend`; trust L16 `Enter to confirm · Esc to cancel` |
| claude | input | `/^[ \t\u00a0]*❯[ \t\u00a0]*$/` | `claude-idle` L37 `❯\xa0` |
| claude | input | `/\? for shortcuts/` | `claude-idle` L39 (while claude runs the same bar reads `esc to interrupt`) |
| codex | approval | `/Press enter to (?:continue\|confirm)/` | `codex-approval-trust` L8; `codex-approval-tool` L56 |
| codex | approval | `/^[ \t]*›[ \t]+\d+\.[ \t]/` | trust L5 `› 1. Yes, continue`; tool L52 `› 1. Yes, proceed (y)` |
| codex | input | `/\d+%[ \t]+left/` | `codex-idle` L31 `gpt-5.4-mini low · 100% left · ~/agentistics` |
| kimi / gemini / copilot / antigravity | — | `null` | see §1 |

---

## 5. Cleanup

- `tmux -L agentop-fixtures kill-server` — verified: `/tmp/tmux-1000/` is empty and
  `tmux -L agentop-fixtures ls` reports `no server running`. The user's own tmux sockets were never
  touched (a dedicated `-L` socket throughout).
- One stray polling shell left over from a `until … capture-pane` wait loop was killed (PID 2807363).
- Probe artifacts removed / verified absent: `/tmp/agentop-trust-probe/` (removed),
  `/tmp/agentop-probe-fixture.txt` (never created — dialog cancelled),
  `/tmp/agentop-codex-probe.txt` (removed), `/agentop-codex-probe-root.txt` (never created —
  dialog cancelled).
- Scratch files removed: `/tmp/claude-raw.txt`, `/tmp/c2.txt`, `/tmp/c3.txt`, `/tmp/codex1.txt`,
  `/tmp/check-nbsp.ts`, `/tmp/mutate.ts`, `/tmp/mutate2.ts`, `/tmp/attention.bak.ts`.
- No user configuration was modified. `~/.kimi-code/config.toml`, `~/.ollama` and every `settings*.json`
  were read only.

## 6. Concerns for the next task

1. **kimi has no approval rule.** Anyone who gets a working provider on this machine (or captures on
   another) should add `kimi-approval*.txt` and fill the entry. Until then kimi sessions render
   `idle-unknown`, which the UI must say in those words.
2. **The claude approval rules were read from a `Write` dialog, not a `Bash` one**, because a global
   `PreToolUse` hook auto-approves Bash here. Both patterns key on the dialog chrome (`❯ N.`, the
   `Esc to cancel` footer) rather than on anything tool-specific, so a Bash dialog should match — but
   that is inference, not evidence, and a `claude-approval-bash.txt` from a machine without that hook
   would close the gap.
3. **The `codex` input rule (`N% left`) is also present while codex is working.** That is harmless
   under the quiescence gate (a working pane never reaches the patterns) but means a codex session
   that stalls mid-task with no output for QUIET_MS reads as `waiting-input` rather than something
   more precise. Acceptable; noted so it is not mistaken for a bug later.
4. **Whoever calls `capture(id, lines)` in Task 3 chooses how much scrollback the classifier sees.**
   The positional rule makes a large window safe, but a small one is still cheaper; `-S -40` is what
   every fixture was captured with and what the rules are validated against.


---

## 7. Fix pass — code review findings (post-`c4d4c95`)

Addresses four review findings on the classifier committed above. Scope held to
`attention.ts` + `attention.test.ts` only; fixtures untouched.

### Finding 1 (Important) — the safety property was not tested

No fixture has both an approval match and an input match with the approval positioned LOWER
(more recent) than the input match, so the reviewer's mutation
(`return inputAt >= 0 ? 'waiting-input' : 'waiting-approval'` — input unconditionally beating
approval) passed all 23 original tests.

Added three synthetic-frame tests against the real `claude` rules in
`describe('classifyAttention — positional ordering, synthetic frames', ...)`:

1. `['? for shortcuts', ' ❯ 1. Yes']` — input above, approval below (more recent) -> expects
   `waiting-approval`.
2. `['❯ 1. Yes', '? for shortcuts']` — the mirror: approval above, input below (more recent) ->
   expects `waiting-input`. This pins that the rule is positional in *both* directions rather than
   "approval always wins" — a different hardcode than the one the reviewer's mutation names, so it
   is not expected to fail against that specific mutation (see mutation results below); it guards
   the opposite regression.
3. `['❯ 1. Yes ? for shortcuts']` — one line matching both patterns (a tie) -> expects
   `waiting-approval` (ties go to approval).

**Mutation check**, applying the reviewer's exact mutation to `classifyAttention`'s return line:

```
$ bun test packages/server/server/sessions/attention.test.ts   # mutated
 24 pass
 3 fail
Ran 27 tests across 1 file. [164.00ms]

✗ recognises a codex approval prompt for a command outside the sandbox
  Expected: "waiting-approval"  Received: "waiting-input"
✗ classifyAttention — positional ordering, synthetic frames > an input match ABOVE an approval
  match still classifies waiting-approval (approval is lower, i.e. more recent)
  Expected: "waiting-approval"  Received: "waiting-input"
✗ classifyAttention — positional ordering, synthetic frames > a tie — one line matching both an
  approval and an input pattern — classifies waiting-approval
  Expected: "waiting-approval"  Received: "waiting-input"
```

Test 1 and test 3 fail exactly as predicted. Test 2 stays green under this mutation, as reasoned
above — it is not powerless, it just guards a different bug (a hardcoded "approval always wins").
A bonus catch: the existing `codex-approval-tool` fixture test *also* now fails under this
mutation, because Finding 3's new codex input rule (`/model to change`, added below) gives that
fixture an input match it did not have before, so the mutation now breaks real fixture coverage too
— not just the synthetic tests.

Mutation reverted; full suite confirmed green again afterward (`27 pass, 0 fail`).

### Finding 2 (Minor) — two unanchored patterns

`/Esc to cancel/` (claude) and `/Press enter to (?:continue|confirm)/` (codex) were unanchored
substrings — an assistant explaining a terminal UI can print those exact words, and a quiet frame
with no input match at all would let that transcript line decide the classification.

Anchored both to line-start, leading whitespace only:

- claude: `/^[ \t\u00a0]*Esc to cancel/` — still matches `claude-approval-tool.txt` line 32
  (` Esc to cancel · Tab to amend`, one leading space). It no longer matches
  `claude-approval-trust.txt` line 17 (`Enter to confirm · Esc to cancel`), where `Esc to cancel`
  is not at line-start — per the finding's own instruction ("if an anchored pattern stops matching
  its fixture, the ANCHOR is wrong — fix the anchor, never the fixture") I checked whether the
  anchor was wrong here: it is not, because that fixture is still caught by the numbered-option
  approval rule above it (trust line 14, `❯ 1. Yes, I trust this folder`), so the fixture's
  classification is unaffected. Confirmed by the still-passing
  `recognises a claude workspace-trust prompt` test.
- codex: `/^[ \t]*Press enter to (?:continue|confirm)/` — still matches both
  `codex-approval-trust.txt` line 9 and `codex-approval-tool.txt` line 57 (both two leading
  spaces), no fixture coverage lost.

### Finding 3 (Minor) — codex idle rests on one weak regex

Added a second codex input pattern, `/\/model to change/`, read from `codex-idle.txt` line 23
(`model:     gpt-5.4-mini low   /model to change │` — the static composer-banner hint).
Commented in place as redundancy against `\d+%[ \t]+left` breaking. Verified positionally safe:
the hint line also appears in both approval fixtures (it is part of the static startup banner),
but always above the live approval match there, so positional matching still resolves
`codex-approval-tool.txt` / `codex-approval-trust.txt` to `waiting-approval` unchanged. Confirmed
by the unchanged `recognises a codex approval prompt for a command outside the sandbox` /
`recognises a codex directory-trust prompt` / `does not read an answered dialog left in the
scrollback as a live one` tests all staying green with the new rule in place. The dynamic
`every rule still matches the fixture it was read from` test picked up the new rule automatically
(it iterates `ATTENTION_RULES.codex!.input` by index) and passes.

### Finding 4 (Minor) — comment only

Added a `CAVEAT, not a fix` comment beside both numbered-option approval patterns (claude's
`❯[ \t\u00a0]+\d+\.` and codex's `›[ \t]+\d+\.`), noting that each harness echoes the
user's own prompt behind the same character the rule keys on (`claude-approval-tool.txt` line 8,
`❯ Run the shell command: ...`; `codex-idle.txt` line 30 — corrected from the finding's stated
line 25 after re-reading the actual fixture, `› Explain this codebase`), so a user prompt
beginning `1. ` would match. No code change; the comment states this is the alarming direction and
is usually demoted by the live composer redrawn below it.

### Full verification, this pass

```
$ bun test packages/server/server/sessions/attention.test.ts
 27 pass
 0 fail
 42 expect() calls
Ran 27 tests across 1 file. [132.00ms]

$ bun tsc --noEmit
(no output)

$ bun test   # whole repo
 2956 pass
 0 fail
 23220 expect() calls
Ran 2956 tests across 174 files. [18.19s]
```

### Files changed

Only `packages/server/server/sessions/attention.ts` and
`packages/server/server/sessions/attention.test.ts`. No fixtures modified.
