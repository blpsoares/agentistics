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

import type { BackendSession } from './types'

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

/** `-l` sends the text literally, so a prompt containing `;` or `C-c` is typed, not interpreted. */
export function sendKeysLiteralArgs(id: string, text: string): string[] {
  return sock(['send-keys', '-t', tmuxName(id), '-l', text])
}

export function sendKeysEnterArgs(id: string): string[] {
  return sock(['send-keys', '-t', tmuxName(id), 'Enter'])
}

export function listSessionsArgs(): string[] {
  return sock(['list-sessions', '-F', LIST_FORMAT])
}

/** Keeps a finished session listable, with its last frame still capturable — the `exited` state. */
export function remainOnExitArgs(): string[] {
  return sock(['set-option', '-g', 'remain-on-exit', 'on'])
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
