/**
 * cli-parse.ts — PURE. `agentop session …` argv -> a typed command.
 *
 * Pure so the argv shape is tested without spawning anything. Note `-p` here is OURS and means the
 * PROMPT: it is not forwarded to the harness as `-p`, which on `claude` and `kimi` means "print and
 * exit" and on `codex` means "profile". `planSpawn` decides how each harness actually receives it.
 *
 * A flag whose value is missing is an ERROR, never a swallowed neighbour — the exact bug
 * `cli.ts`'s `readFlag` comment already warns about for `agentop member`.
 */

import { HARNESS_ORDER, type HarnessId } from '@agentistics/core'

export type SessionCommand =
  | {
      kind: 'start'
      harness: HarnessId
      background: boolean
      prompt?: string
      model?: string
      effort?: string
      cwd?: string
      label?: string
    }
  | { kind: 'list' }
  | { kind: 'attach'; ref: string }
  | { kind: 'kill'; ref: string }
  | { kind: 'rename'; ref: string; label: string }
  | { kind: 'note'; ref: string; text: string }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

const VALUE_FLAGS = new Set(['-p', '--prompt', '--model', '--effort', '--cwd', '--name'])

function isHarness(v: string): v is HarnessId {
  return (HARNESS_ORDER as readonly string[]).includes(v)
}

export function parseSessionArgs(argv: string[]): SessionCommand {
  const head = argv[0]
  if (!head) return { kind: 'help' }

  if (head === 'list') return { kind: 'list' }

  if (head === 'attach' || head === 'kill') {
    const ref = argv[1]
    if (!ref) return { kind: 'error', message: `Usage: agentop session ${head} <id|name>` }
    return { kind: head, ref }
  }

  if (head === 'rename') {
    const ref = argv[1]
    const label = argv.slice(2).join(' ').trim()
    if (!ref || !label) return { kind: 'error', message: 'Usage: agentop session rename <id|name> "label"' }
    return { kind: 'rename', ref, label }
  }

  if (head === 'note') {
    const ref = argv[1]
    const text = argv.slice(2).join(' ').trim()
    if (!ref || !text) return { kind: 'error', message: 'Usage: agentop session note <id|name> "text"' }
    return { kind: 'note', ref, text }
  }

  if (!isHarness(head)) {
    return {
      kind: 'error',
      message: `Unknown harness or action: ${head}. Expected one of ${HARNESS_ORDER.join(', ')} — or list, attach, kill, rename, note.`,
    }
  }

  const cmd: Extract<SessionCommand, { kind: 'start' }> = {
    kind: 'start', harness: head, background: false,
  }

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--bg' || arg === '--background') { cmd.background = true; continue }
    if (!VALUE_FLAGS.has(arg)) {
      return { kind: 'error', message: `Unknown option: ${arg}` }
    }
    const value = argv[i + 1]
    if (value === undefined || VALUE_FLAGS.has(value) || value === '--bg' || value === '--background') {
      return { kind: 'error', message: `Missing value for ${arg}` }
    }
    i++
    if (arg === '-p' || arg === '--prompt') cmd.prompt = value
    else if (arg === '--model') cmd.model = value
    else if (arg === '--effort') cmd.effort = value
    else if (arg === '--cwd') cmd.cwd = value
    else if (arg === '--name') cmd.label = value
  }

  return cmd
}
