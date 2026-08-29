/**
 * tmux-cli.ts — PURE. Every tmux argv this feature builds, and every tmux output it reads.
 *
 * Split out from the backend so the parts that can be wrong in an invisible way — a format string
 * that does not match the fields being parsed, a `--` that stops a harness flag being eaten by
 * tmux, seconds read as milliseconds — are tested without a tmux server.
 *
 * We run on our OWN socket (`-L agentop`). The user's sessions are then never listed, never killed
 * and never affected by the server options we set, and `list-sessions` needs no trust in a prefix
 * filter to stay out of their way. The prefix on the name is belt and braces for the case where a
 * user points their own tmux at our socket deliberately.
 *
 * Every field and flag below was probed against tmux 3.2a on 2026-08-12.
 */

import type { BackendSession, PaneInfo } from './types'

export const TMUX_SOCKET = 'agentop'
export const SESSION_PREFIX = 'agentop-'

export function tmuxName(id: string): string {
  return SESSION_PREFIX + id
}

export function idFromTmuxName(name: string): string | null {
  return name.startsWith(SESSION_PREFIX) ? name.slice(SESSION_PREFIX.length) : null
}

/** Must stay in lockstep with `parseTmuxList` — the test asserts the exact string for that reason. */
export const LIST_FORMAT =
  '#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_dead}\t#{session_activity}'

const sock = (rest: string[]): string[] => ['-L', TMUX_SOCKET, ...rest]

/** `--` matters: without it tmux parses the harness's own flags as its own. */
export function newSessionArgs(o: { id: string; cwd: string; argv: string[] }): string[] {
  return sock(['new-session', '-d', '-s', tmuxName(o.id), '-c', o.cwd, '--', ...o.argv])
}

export function killSessionArgs(id: string): string[] {
  return sock(['kill-session', '-t', tmuxName(id)])
}

export function capturePaneArgs(id: string, lines: number): string[] {
  return sock(['capture-pane', '-p', '-t', tmuxName(id), '-S', `-${lines}`])
}

/**
 * The same read as `capturePaneArgs`, but `-e` keeps the SGR escape sequences in the output —
 * colours, bold, reverse — so the browser terminal renders what a person would have seen on attach.
 *
 * A SEPARATE builder rather than a flag on the one above, and deliberately so: the plain capture
 * feeds the readiness and approval REGEXES (`backend-tmux.ts`, `attention.ts`), and a frame carrying
 * `\x1b[38;5;39m` in front of every word would break every one of those patterns silently. The two
 * reads have opposite requirements, so they are two functions — the same reasoning that keeps
 * `sendKeysLiteralArgs` and `sendKeysNamedArgs` apart.
 */
export function capturePaneAnsiArgs(id: string, lines: number): string[] {
  return sock(['capture-pane', '-p', '-e', '-t', tmuxName(id), '-S', `-${lines}`])
}

/**
 * One `display-message` read of the pane's geometry, cursor and liveness — the facts `capture-pane`
 * cannot report. Tab-separated so `parsePaneInfo` can split it without guessing at spaces (a cwd or
 * a title would carry them; these six numeric fields never do, but tab is free insurance).
 *
 * Must stay in lockstep with `parsePaneInfo` — the test asserts the exact format string for that
 * reason, the same contract `LIST_FORMAT` keeps with `parseTmuxList`.
 */
export const PANE_INFO_FORMAT =
  '#{cursor_x}\t#{cursor_y}\t#{pane_width}\t#{pane_height}\t#{pane_dead}\t#{history_size}'

export function paneInfoArgs(id: string): string[] {
  return sock(['display-message', '-p', '-t', tmuxName(id), '-F', PANE_INFO_FORMAT])
}

/**
 * Parse the `PANE_INFO_FORMAT` line. `null` on anything that does not read as the six numbers it
 * must be — a partial `PaneInfo` is worse than none, because the terminal channel would ship a
 * confident wrong cursor or a wrong "alive". `pane_dead` is `1` once the hosted command has exited.
 */
export function parsePaneInfo(stdout: string): PaneInfo | null {
  const line = stdout.split('\n')[0]?.trim() ?? ''
  if (!line) return null
  const parts = line.split('\t')
  if (parts.length < 6) return null
  const [cx, cy, w, h, dead, hist] = parts.map(Number)
  if (![cx, cy, w, h, dead, hist].every(Number.isFinite)) return null
  return {
    cols: w!,
    rows: h!,
    cursorX: cx!,
    cursorY: cy!,
    alive: dead !== 1,
    historySize: hist!,
  }
}

/** `-l` sends the text literally, so a prompt containing `;` or `C-c` is typed, not interpreted. */
export function sendKeysLiteralArgs(id: string, text: string): string[] {
  return sock(['send-keys', '-t', tmuxName(id), '-l', text])
}

/**
 * One NAMED key — `Enter`, `Escape`, `Down` — which is the opposite of `-l` above.
 *
 * Without `-l` tmux interprets the argument as a key name, and that is the whole point here: the
 * approval keystroke is a key, not text. It is a separate builder rather than a flag on the literal
 * one because getting the two the wrong way round fails SILENTLY — `send-keys -l Enter` types the
 * five characters `E n t e r` into the assistant's prompt and reports success.
 */
export function sendKeysNamedArgs(id: string, key: string): string[] {
  return sock(['send-keys', '-t', tmuxName(id), key])
}

export function sendKeysEnterArgs(id: string): string[] {
  return sendKeysNamedArgs(id, 'Enter')
}

export function listSessionsArgs(): string[] {
  return sock(['list-sessions', '-F', LIST_FORMAT])
}

/**
 * How many lines of scrollback each pane keeps.
 *
 * tmux's own default is 2000, which for an assistant transcript is a few minutes of work: attaching
 * to a session that has been running an hour and scrolling up finds the middle of a sentence. This
 * is roughly a day of it, and costs memory only for what was actually printed.
 */
export const HISTORY_LIMIT = 50_000

/**
 * Every option agentop sets on ITS OWN tmux server, applied before the first session exists.
 *
 * On its own socket (`-L agentop`), which is the whole reason this is safe: none of it reaches the
 * user's tmux, their config, or the sessions they started themselves.
 *
 * Applied UP FRONT, not afterwards, and that is not a style choice for any of the three:
 * `remain-on-exit` set after the fact is a race a fast-failing command always wins, and
 * `history-limit` only ever applies to panes created after it — a session started first keeps
 * tmux's 2000 forever, which is the exact case someone hits when they attach to the long-running
 * one and find nothing above the fold.
 *
 * `mouse on` is what makes the wheel scroll at all. Without it the pane is a window onto the last
 * screenful and nothing else, so attaching to a session to read what it did is attaching to a
 * session you cannot read. It has a cost worth stating rather than discovering: with the mouse
 * captured, dragging to select goes to tmux instead of to the terminal, and SHIFT is the bypass —
 * the same trade the control center already documents for its own mouse mode.
 */
export function serverOptionsArgs(): string[][] {
  return [
    // Keeps a finished session listable, with its last frame still capturable — the `exited` state.
    sock(['set-option', '-g', 'remain-on-exit', 'on']),
    sock(['set-option', '-g', 'mouse', 'on']),
    sock(['set-option', '-g', 'history-limit', String(HISTORY_LIMIT)]),
    // No STATUS BAR. tmux draws a green band across the bottom listing the windows, the session
    // name and a clock — useful when you are managing windows, and every one of those facts is
    // wrong here: an agentop session is one window with one pane, its name is `agentop-<id>` rather
    // than anything a person chose, and the cockpit you came from already shows all of it. So the
    // band costs a row of the assistant's screen to say nothing, in a colour that is hard to
    // ignore.
    sock(['set-option', '-g', 'status', 'off']),
  ]
}

export function showPrefixArgs(): string[] {
  return sock(['show-options', '-g', 'prefix'])
}

/** Includes the binary: this argv is EXECED by the caller, not passed to our own tmux runner. */
export function attachArgs(id: string): string[] {
  return ['tmux', '-L', TMUX_SOCKET, 'attach-session', '-t', tmuxName(id)]
}

export function parseTmuxList(stdout: string): BackendSession[] {
  const out: BackendSession[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd()
    if (!line) continue
    const [name, created, attached, dead, activity] = line.split('\t')
    if (!name || created === undefined || activity === undefined) continue
    const id = idFromTmuxName(name)
    if (!id) continue
    const createdSec = Number(created)
    const activitySec = Number(activity)
    if (!Number.isFinite(createdSec)) continue
    out.push({
      id,
      createdMs: createdSec * 1000,
      attached: attached === '1',
      alive: dead !== '1',
      lastActivityMs: Number.isFinite(activitySec) ? activitySec * 1000 : createdSec * 1000,
    })
  }
  return out
}

/** capture-pane pads the frame to the pane height; those trailing blanks are not content. */
export function trimCapture(lines: string[]): string[] {
  let end = lines.length
  while (end > 0 && lines[end - 1]!.trim() === '') end--
  return lines.slice(0, end)
}

/**
 * True when tmux's stderr says the session (or the server behind it) is already gone rather than
 * reporting a real failure to kill it — the wording tmux 3.2a itself uses (probed alongside the
 * rest of this file): `can't find session` (a sibling session survives; ours does not), `no server
 * running` (ours was the last session, so killing it took the server down too), and `error
 * connecting to` (no server has ever started on our socket). Any other stderr is treated as a
 * genuine failure, never guessed into a false "gone".
 */
export function isSessionGoneError(stderr: string): boolean {
  return /can't find session|no server running|error connecting to/i.test(stderr)
}

/**
 * The real detach keystroke, from `show-options -g prefix` (e.g. `prefix C-b`).
 *
 * Read rather than assumed: tmux loads the user's `~/.tmux.conf` on our socket too, so a user who
 * rebound the prefix to `C-a` would be told to press a key that does nothing. When the value is not
 * a recognisable `C-x`, the raw token is shown instead of a confident wrong answer.
 */
export function parsePrefix(stdout: string): string {
  const token = stdout.trim().split(/\s+/)[1] ?? ''
  if (!token) return 'the tmux prefix then d'
  const ctrl = /^C-(.)$/.exec(token)
  return ctrl ? `Ctrl-${ctrl[1]} then d` : `${token} then d`
}
