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
      task?: string
    }
  | { kind: 'list'; json?: boolean }
  /**
   * Start SEVERAL sessions at once, all filed under one task.
   *
   * This is the command an assistant drives. It exists because orchestrating parallel work through
   * the single-session form means N invocations, N ids to collect from N lines of prose, and no way
   * to say "these belong together" — so the caller has to hold state the tool could have held.
   */
  | {
      kind: 'batch'
      task: string
      /** One entry per session to start. */
      specs: BatchSpec[]
      json?: boolean
    }
  | { kind: 'open'; task: string; json?: boolean }
  | { kind: 'attach'; ref: string }
  | { kind: 'kill'; ref: string }
  | { kind: 'rename'; ref: string; label: string }
  | { kind: 'note'; ref: string; text: string }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

/** One session inside a batch, as `--session` spells it. */
export interface BatchSpec {
  harness: HarnessId
  prompt?: string
  cwd?: string
  model?: string
  effort?: string
  name?: string
}

const VALUE_FLAGS = new Set([
  '-p', '--prompt', '--model', '--effort', '--cwd', '--name', '--task', '--session',
])

function isHarness(v: string): v is HarnessId {
  return (HARNESS_ORDER as readonly string[]).includes(v)
}

export function parseSessionArgs(argv: string[]): SessionCommand {
  const head = argv[0]
  if (!head) return { kind: 'help' }

  const jsonFlag = argv.includes('--json')

  if (head === 'list') return { kind: 'list', ...(jsonFlag ? { json: true } : {}) }

  if (head === 'batch') return parseBatch(argv.slice(1), jsonFlag)

  if (head === 'open') {
    const task = argv.slice(1).filter(a => a !== '--json').join(' ').trim()
    if (!task) return { kind: 'error', message: 'Usage: agentop session open "<task>"' }
    return { kind: 'open', task, ...(jsonFlag ? { json: true } : {}) }
  }

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
    if (arg === '--json') continue
    if (arg === '--task') {
      const value = argv[i + 1]
      if (value === undefined || VALUE_FLAGS.has(value)) {
        return { kind: 'error', message: 'Missing value for --task' }
      }
      i++
      cmd.task = value
      continue
    }
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

/**
 * `agentop session batch --task "X" --session "claude: fix the parser" --session "codex: ..."`.
 *
 * Each `--session` is `<harness>[@<cwd>]: <prompt>` — deliberately ONE string per session rather
 * than a repeated set of flags, because the caller composing these is usually a program writing a
 * command line, and one token per session is the shape that survives being built by string
 * concatenation. Anything more elaborate belongs in a config file, which is a different feature.
 *
 * Pure, so the whole grammar is tested without spawning anything.
 */
function parseBatch(argv: string[], json: boolean): SessionCommand {
  let task = ''
  const specs: BatchSpec[] = []
  const shared: { cwd?: string; model?: string; effort?: string } = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--json') continue
    if (!VALUE_FLAGS.has(arg)) return { kind: 'error', message: `Unknown option: ${arg}` }
    const value = argv[i + 1]
    if (value === undefined || VALUE_FLAGS.has(value) || value === '--json') {
      return { kind: 'error', message: `Missing value for ${arg}` }
    }
    i++
    if (arg === '--task') { task = value; continue }
    // `--cwd`, `--model` and `--effort` before the sessions are DEFAULTS for all of them: a batch
    // is usually many assistants on one repository, and repeating the path per session is how a
    // generated command line gets long enough to be got wrong.
    if (arg === '--cwd') { shared.cwd = value; continue }
    if (arg === '--model') { shared.model = value; continue }
    if (arg === '--effort') { shared.effort = value; continue }
    if (arg === '--session') {
      const spec = parseBatchSpec(value, shared)
      if ('error' in spec) return { kind: 'error', message: spec.error }
      specs.push(spec.spec)
      continue
    }
    return { kind: 'error', message: `${arg} is not accepted by batch — use --session for each one.` }
  }

  if (!task) return { kind: 'error', message: 'batch needs --task "<name>" so the sessions belong together.' }
  if (specs.length === 0) return { kind: 'error', message: 'batch needs at least one --session "<harness>: <prompt>".' }
  return { kind: 'batch', task, specs, ...(json ? { json: true } : {}) }
}

/** `<harness>[@<cwd>]: <prompt>` — the one string that describes a session in a batch. */
export function parseBatchSpec(
  value: string,
  shared: { cwd?: string; model?: string; effort?: string } = {},
): { spec: BatchSpec } | { error: string } {
  const colon = value.indexOf(':')
  const head = (colon === -1 ? value : value.slice(0, colon)).trim()
  const prompt = colon === -1 ? '' : value.slice(colon + 1).trim()

  const at = head.indexOf('@')
  const harness = (at === -1 ? head : head.slice(0, at)).trim()
  const cwd = at === -1 ? '' : head.slice(at + 1).trim()

  if (!isHarness(harness)) {
    return { error: `Unknown harness "${harness}". Expected one of ${HARNESS_ORDER.join(', ')}.` }
  }
  return {
    spec: {
      harness,
      ...(prompt ? { prompt } : {}),
      ...(cwd ? { cwd } : shared.cwd ? { cwd: shared.cwd } : {}),
      ...(shared.model ? { model: shared.model } : {}),
      ...(shared.effort ? { effort: shared.effort } : {}),
    },
  }
}
