# B3 risk spike — can a single-binary Bun/TS program run a persistent PTY shell?

**Date:** 2026-09-20 · **Bun installed here:** 1.3.14 (Linux x64, WSL2) · **Verdict: YES, and the
premise the runtime spec is built on is now stale.**

## Headline finding — the repo's own comment is out of date

`packages/server/server/sessions/index.ts` states, and `CLAUDE.md`'s session-manager section
repeats: *"Bun exposes no PTY primitive... The only real option is a native module... and this
project compiles to ONE portable binary... A native addon cannot be embedded in it."* That was
true when written. **It stopped being true with Bun 1.3.5, which shipped a first-party
`Bun.Terminal` API, and Bun 1.3.14 — the exact version installed in this worktree — extended it to
Windows via ConPTY.** This is not a third-party shim: it is `Bun.Terminal` + `Bun.spawn({ terminal
})`, built into the runtime, in the `bun-types` package already vendored in this repo
(`node_modules/bun-types/bun.d.ts:7490-7620`).

I verified this locally, not just from docs — see "Local probes" below. Every claim below that says
"confirmed" was run on this machine in `/tmp/pty-probe`, including through a compiled
`bun build --compile` binary.

## 1. Bun's own primitives today

- `Bun.spawn(...)` with `stdio: 'pipe'` or `'inherit'` gives the child **pipes, never a tty** —
  confirmed: `process.stdout.isTTY` reads `undefined` in the child either way. This is the
  long-standing behavior the repo's comment is correct about.
- `Bun.$` (shell helper) is pipe-based too, same limitation.
- **New in 1.3.5, extended in 1.3.14: `Bun.Terminal`.** A native PTY class:
  `new Bun.Terminal({ cols, rows, name, data, exit, drain })`, and `Bun.spawn(cmd, { terminal })`
  attaches it as stdin+stdout+stderr in one step. Methods: `.write()`, `.resize(cols, rows)`,
  `.setRawMode(bool)`, `.close()`, plus raw termios flag getters/setters on POSIX. **Confirmed
  locally**: child's `process.stdout.isTTY === true`, `columns`/`rows` match what was requested,
  `.resize()` mid-run fires the child's own `resize` event with the new dimensions (SIGWINCH
  propagation works), `.write()` delivers to the child's stdin through the pty (cooked-mode local
  echo observed, exactly as a real terminal would).
- **Platform support, per the 1.3.14 release notes (fetched from bun.com/blog/bun-v1.3.14):**
  POSIX (Linux/macOS) via `openpty()` since 1.3.5; **Windows via `CreatePseudoConsole`
  (ConPTY) since 1.3.14**, plus FreeBSD and Android. Windows caveats stated by Bun itself: no
  termios (the four flag properties read 0 and setting them is a no-op), no line-discipline echo
  without a child reading it, and the `data` callback receives *semantically equivalent, not
  byte-identical* escape sequences versus what the child emitted. I could not verify the Windows
  path locally (Linux-only sandbox) — treat it as vendor-stated, not independently measured, and
  put it in the afternoon test plan below.

## 2. bun:ffi + openpty — the fallback that would have been necessary before 1.3.5, still useful as a mental model

Before finding `Bun.Terminal`, I built and verified a from-scratch approach: `dlopen("libc.so.6")`
via `bun:ffi`, call `openpty(&master, &slave, name, NULL, NULL)` (glibc ≥2.34 folded libutil into
libc; older/musl systems would need `libutil.so.1` instead — untested here), then `Bun.spawn(cmd,
{ stdio: [slaveFd, slaveFd, slaveFd] })`, closing the parent's copy of the slave fd so the master
sees EOF correctly. **This worked**: child's `isTTY` read `true`, and it **survived
`bun build --compile` into a standalone binary** with identical output — `dlopen` resolves the
system's `libc.so.6` at runtime, so this is not "embedding a native module," it's calling a shared
library that already exists on every real Linux box, which is why the compile constraint doesn't
bite here the way it would for a `.node` addon.

This matters for the recommendation only as a **fallback for Bun versions before 1.3.5** or if
`Bun.Terminal` ever regresses — since 1.3.14 is already installed and the native API is strictly
better (no manual fd juggling, proper resize/rawmode/close lifecycle, cross-platform including
Windows), FFI-openpty should not be the primary path.

## 3. node-pty and friends under Bun

Confirmed via search (not installed locally — `find . -name node-pty` returned nothing in this
repo, consistent with the repo never having added it): **node-pty has a known, unresolved lifecycle
bug under Bun** — the PTY master fd is not held the way Bun's process/fd model expects, so it
closes prematurely and the child's stdin sees EOF immediately (spawned shells exit right away).
This is exactly the "native module + single-binary compile" problem the repo's comment anticipated
— and it's moot now that `Bun.Terminal` exists as a first-party alternative. Third-party
FFI-based packages (`bun-pty`, wrapping Rust's `portable-pty` and claiming Linux/macOS/Windows
support) exist for exactly this gap, but with the native API present they're now redundant for new
code — worth knowing only if a project is stuck on Bun <1.3.5.

## 4. tmux delegation — what the repo already does, and why it isn't fully obsoleted

`tmux`, `script`, `python3`, `stdbuf` are installed on this machine; `socat`, `expect`, `unbuffer`
are **not** (`command -v` checked for all seven). tmux delegation (what `backend-tmux.ts` /
`tmux-cli.ts` do today) buys something `Bun.Terminal` structurally cannot: **the pty's lifetime is
decoupled from the process that opened it.** tmux runs its own long-lived server; if `agentop
server` crashes or is restarted, the shell inside tmux keeps running and every front door (cockpit,
web Sessions workspace, VS Code, `agentop session attach`) can reattach to the *same* pty. A
`Bun.Terminal` is owned by the Bun process that created it — closing the master (or exiting that
process) delivers SIGHUP to the pty's foreground process group the same as unplugging a real
terminal, and `Bun.Terminal` exposes no fd or device path a second process could attach to (its
interface is `write`/`resize`/`setRawMode`/`close` plus a `data` callback — an owned object, not a
handle). So: **for the existing multi-surface, detachable, crash-surviving session manager, tmux
delegation is still correct and should not be ripped out.** The cost tmux pays for that
persistence is everything the repo's `attention.ts`/`submit-check.ts`/`dialog-choice.ts` exist to
work around: no push-based byte stream, only polled `capture-pane` snapshots parsed for markers.

## 5. `script` / `unbuffer` / `socat` as PTY-granting wrappers

- **`script`** (installed): wraps a command in a pty and can tee its output to a file
  (`script -qc "cmd" /dev/null`), portable across Linux/macOS/BSD, but it's a blunt instrument —
  no programmatic resize, no clean way to pipe structured stdin, and it forks a full extra
  process per invocation. Fine for "run this one command as if from a terminal," wrong shape for a
  request/response tool contract.
- **`expect`/`unbuffer`** (not installed here, and not universally present): `unbuffer` (from the
  `expect` package) allocates a pty purely to defeat stdio buffering in the child; same shape as
  `script`, same limitations, plus an extra apt/brew dependency the binary would have to shell out
  to and hope is present.
- **`socat`** (not installed): can bridge a pty to a socket (`socat -d -d pty,raw,echo=0
  tcp:host:port`), which is architecturally close to what a persistent shell tool needs, but it's
  one more external binary dependency for a product whose whole distribution story is "one
  portable binary." Not needed now that `Bun.Terminal` exists in-process.

None of these three beat `Bun.Terminal` for the tool-catalogue's `shell.start/read/write/stop`
contract — they all exist to paper over the exact gap `Bun.Terminal` now fills natively.

## 6. Do we even need a PTY for D-T2's shell tool?

For an **agent-facing** shell (not a human sitting at a terminal), most of what a PTY buys is
narrower than it looks:

- **Colour / progress bars**: real, but the agent reads text, not pixels — ANSI codes in tool
  output are noise unless the model is specifically asked to interpret a progress bar, which is
  rare. Not a strong argument for a PTY.
- **Interactive prompts (`sudo`, `npm login`, a REPL)**: this is the one that matters. Plenty of
  tools refuse to prompt, or behave differently, when `!isatty(stdin)` — `npm login`, `gh auth
  login`, some installers, and any TUI (`vim`, `htop`, a REPL like `python3` without `-i` behaving
  oddly under pipes) all check `isatty()` and change behavior. Codex, Gemini and Copilot all found
  this worth solving (see below) precisely because "an agent that can't run `npm login`
  interactively" is a real capability gap, not a cosmetic one.
- **`isatty()` checks in general**: many CLIs (git, cargo, docker) change output shape (colour,
  progress, pager invocation) based on this, and getting it "right" (i.e., matching what a human
  running the same command would see) reduces surprising divergence between what the agent
  observes and what a human would.
- **SIGWINCH / resize**: only matters for genuinely full-screen programs (`vim`, `htop`, a paged
  `git log`). An agent shell that mostly runs one-shot commands can live without this, but if the
  tool is meant to also host a REPL or editor, it's needed — confirmed working via `Bun.Terminal`.
- **Job control** (`Ctrl-Z`, `fg`/`bg`, process groups): rarely relevant to a tool-driven shell; an
  agent doesn't suspend jobs interactively. Low priority.

**What other harnesses do** (from the tool-catalogue spec already in this repo, §D-T2, plus general
knowledge of these products): **Codex** collapsed run/background/PTY into one `exec_command` +
`write_stdin` pair returning a `session_id` — a persistent session abstraction, PTY-backed, that
the model addresses by handle rather than by raw fd. **Gemini** is one-shot by default with
**opt-in** PTY — i.e., it agrees a PTY is not always worth paying for, only sometimes. **Copilot**
exposes four separately-permissioned verbs (`bash`, `read_bash`, `write_bash`, `stop_bash`) — the
same start/read/write/stop shape the spec's D-T2 recommends, and persistent by construction (the
process outlives one tool call). None of the three public write-ups I could find go into whether
their PTY is native, wrapped, or FFI-based; that detail isn't published. The convergent design
signal across all three, independent of PTY-or-not, is: **one persistent session, addressed by a
handle, non-blocking (a slow call returns a handle instead of hanging the tool loop)** — exactly
D-T2's recommendation.

**Conclusion: PTY should be opt-in, not mandatory**, matching Gemini's choice and D-T2's own
phrasing ("optional PTY"). Default to pipes (`Bun.spawn` plain) for the common case — faster,
simpler, no termios edge cases — and let the model (or a per-call flag) ask for a pty when it needs
one (an installer prompting, a REPL, anything that behaves differently under `isatty()`).

## 7. Windows

Bun 1.3.14's ConPTY support (`CreatePseudoConsole`) means the "Windows needs WSL" framing in
`CLAUDE.md`/`index.ts` no longer describes a hard technical wall for a brand-new shell tool — it
describes a wall that existed before this Bun release. That said: (a) I could not verify the
Windows path on this machine, and Bun's own release notes flag real behavioral differences (no
termios control, different echo semantics, re-encoded rather than byte-identical escape sequences)
that a from-scratch tool would need to test against; (b) this finding is about the **new
tool-catalogue's shell tool**, a narrower surface than the existing tmux-based multi-surface
session manager, which has its own reasons (detachability, multiple front doors) to keep pointing
Windows users at WSL for now. Don't rewrite the existing session manager's Windows story off this
finding alone — validate on real Windows first (see test plan).

## 8. Local probes — exact commands and results

Environment: `bun --version` → `1.3.14`. Installed: `tmux`, `script`, `python3`, `stdbuf`. Missing:
`socat`, `expect`, `unbuffer`. All experiments ran in `/tmp/pty-probe`, nothing touched the repo.

1. **Bun.spawn gives pipes, not ttys** (baseline): child's `process.stdout.isTTY` → `undefined`
   under both `stdio: 'pipe'` and `stdio: 'inherit'`.
2. **bun:ffi + openpty via libc.so.6**: `dlopen("libc.so.6", { openpty: ... })` succeeded,
   `openpty()` returned `rc=0`, allocated `/dev/pts/0`. Spawning a child with
   `stdio: [slaveFd, slaveFd, slaveFd]` and closing the parent's slave fd copy gave a child whose
   `process.stdout.isTTY === true`, confirmed by reading the master fd back
   (`isTTY: true / cols 0` — cols 0 because winsize wasn't set via ioctl in this quick probe).
   **Survived `bun build --compile`** — identical output from the compiled binary.
3. **Native `Bun.Terminal`**: `new Bun.Terminal({cols:100,rows:30})` + `Bun.spawn(cmd, {terminal})`
   → child's `isTTY === true`, `columns === 100`, `rows === 30`. `proc.terminal.write("hello
   world\n")` piped into `cat` produced `"hello world\r\nhello world\r\n"` (pty local-echo plus
   `cat`'s own output — expected cooked-mode behavior). `.resize(120, 50)` on a running child fired
   the child's own `process.stdout` `'resize'` event with the new dimensions — SIGWINCH
   propagation confirmed. `.setRawMode(true)` did not throw. **Survived `bun build --compile`**:
   compiled binary produced byte-identical output to `bun run`.

## Recommendation

**Primary mechanism for the tool-catalogue's shell tool (D-T2): `Bun.Terminal` +
`Bun.spawn(cmd, { terminal })`, used opt-in (default pipes, pty only on request).** It is native,
already installed (Bun 1.3.14), survives `bun build --compile` (verified), and as of 1.3.14 covers
Linux, macOS and Windows (ConPTY) from one code path — no `libutil`/musl fallback branching needed
on POSIX, no external binary dependency, no FFI plumbing. This directly satisfies D-T2's four verbs:
`shell.start` = `Bun.spawn(cmd, {terminal})` (or plain pipes when no pty requested), `shell.read` =
drain the `data` callback's buffer (or the plain stdout stream), `shell.write` =
`terminal.write()` (or stdin), `shell.stop` = `proc.kill()` + `terminal.close()`.

**Fallback, only if a target platform's Bun build predates 1.3.5 or the native API regresses:**
`bun:ffi` + `openpty()` via `dlopen("libc.so.6")` on Linux (glibc ≥2.34; note the musl/`libutil.so.1`
case is unverified and should be tested on an Alpine target before shipping there) — verified
working end-to-end and compile-safe in this spike. This is strictly a contingency; don't build it
speculatively.

**No PTY at all (plain `Bun.spawn` pipes) remains the right default** for the common case — most
shell calls an agent makes (`ls`, `git status`, a build command) don't need one, and skipping the
pty avoids termios/echo edge cases entirely. Gate the pty on an explicit flag or a detected need
(the tool declines a bare pipe and the caller retries with `terminal: true`).

**Keep tmux delegation exactly as-is for the existing session manager** (`packages/server/server/
sessions/*`). That feature's requirement — a shell that survives an `agentop server` restart and
can be attached from four different front doors — is not something `Bun.Terminal` provides (it has
no exposed fd/path a second process could join), and rebuilding that on `Bun.Terminal` would mean
reinventing tmux's own persistence server. These are two different problems that happen to both
say "PTY."

**Update the stale comment.** `packages/server/server/sessions/index.ts`'s header comment
("Bun exposes no PTY primitive... When a PTY primitive lands in Bun, backend-pty.ts goes here") is
now factually wrong and should be corrected in the runtime-architecture spec and, separately, in a
follow-up patch to that file — not as part of this read-only spike, but flagged here so it isn't
silently copied forward into the new design.

## How to verify this in an afternoon

1. **Linux** (this environment or CI): re-run the three scripts in `/tmp/pty-probe` (openpty FFI,
   native Terminal, resize test) — all three already pass here. Add a real interactive-prompt test:
   spawn `python3 -c "import sys; print(sys.stdin.isatty()); input('pw: ')"` under `terminal:` vs
   plain pipes and confirm the behavior differs the way `npm login`/`sudo` would.
2. **macOS**: repeat the native-Terminal script (`native-terminal2.ts`) unmodified — Bun's release
   notes claim macOS parity with Linux via `openpty()`; verify `isTTY`, `resize`, and that
   `bun build --compile` produces a working universal/arm64 binary with the same behavior.
3. **Windows** (the one platform not tested here): repeat the same script on a Windows box with
   Bun 1.3.14+. Specifically check the three caveats Bun's own notes flag: (a) confirm
   `terminal.inputFlags` etc. read 0 and setting them is a silent no-op — decide if the tool
   contract needs to expose that difference to the caller; (b) test echo behavior without a reading
   child, since ConPTY has no line discipline; (c) diff a captured escape-sequence-heavy output
   (e.g. `git log --color` output) between POSIX and Windows runs to see how much "semantically
   equivalent but not byte-identical" matters in practice for a model reading the text.
4. **musl/Alpine** (if that's a packaging target): re-run the FFI fallback probe there — `libc.so.6`
   won't exist under musl; test whether musl's own `libc.so` exports `openpty` directly (it does on
   most musl builds, folded in like glibc ≥2.34) before assuming the fallback needs `libutil.so.1`.
5. **Compile-size / cold-start check**: confirm `Bun.Terminal` doesn't materially change
   `bun build --compile` binary size or startup time versus the current tmux-only build — quick
   `ls -la` + `time ./binary --version` before/after wiring the shell tool in.
6. **Concurrency**: open 5-10 `Bun.Terminal`s in one process (simulating several parallel agent
   shell calls) and confirm fd usage stays sane (`lsof -p <pid> | wc -l` before/after) and no
   master fd leaks across `shell.stop` calls.
