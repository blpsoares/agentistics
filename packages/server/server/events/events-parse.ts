/**
 * events-parse.ts — PURE. `agentop events …`, and what each word means.
 *
 * ## Why this is not `agentop watch`
 *
 * `agentop watch` already exists: it is the OpenTelemetry metrics daemon, documented in the help
 * and wired into `agentop restart watch` and the systemd unit. Taking that verb for a second,
 * unrelated thing would make `agentop restart watch` ambiguous and would silently retarget a name
 * people already have in scripts. So the channel is `agentop events`, and the register/deregister
 * verbs are `watch` / `unwatch` under it — which reads better anyway (`agentop events watch --task
 * X`).
 *
 * ## Two namespaces that must not be confused, and are not
 *
 * `--session` names an AGENTOP session (the fleet's own id or label) and filters what is heard
 * about. `--notify` names a CLAUDE CODE session (the name or pid it registered in
 * `~/.claude/sessions`) and says who to tell. They are different kinds of thing, so they are
 * different flags — one flag doing both would resolve against whichever namespace answered first.
 */

import { DEFAULT_EVENT_KINDS, EVENT_KINDS, type EventKind } from './event-types'

export interface WatchOptions {
  task?: string
  session?: string
  kinds: EventKind[]
  notify?: string
  desktop: boolean
  note?: string
  json: boolean
}

export interface TailOptions {
  /** How many of the most recent events. */
  count: number
  /** Read from this byte offset instead of the tail. Paired with `sinceSeq`. */
  since?: number
  sinceSeq?: number
  task?: string
  kinds?: EventKind[]
  json: boolean
  follow: boolean
}

export type EventsCommand =
  | { kind: 'watch'; options: WatchOptions }
  | { kind: 'unwatch'; id?: string; all: boolean }
  | { kind: 'status'; json: boolean }
  | { kind: 'tail'; options: TailOptions }
  | { kind: 'run'; once: boolean }
  | { kind: 'emit' }
  | { kind: 'test'; notify?: string; desktop: boolean }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

const DEFAULT_TAIL = 20

/** `--flag value` and `--flag=value` both. Returns null when the flag is absent, undefined-ish
 *  errors are the caller's to report. */
function takeValue(argv: string[], i: number, flag: string): { value?: string; next: number } {
  const arg = argv[i]!
  const eq = arg.indexOf('=')
  if (arg.startsWith(`${flag}=`) && eq > 0) return { value: arg.slice(eq + 1), next: i + 1 }
  const value = argv[i + 1]
  if (value === undefined || value.startsWith('-')) return { next: i + 1 }
  return { value, next: i + 2 }
}

/**
 * `--on waiting,exited` → the kinds.
 *
 * An unknown word is REFUSED rather than ignored: `--on waitin` silently subscribing to the
 * defaults is a subscription that appears to work and reports the wrong things. The message names
 * what is accepted, because a closed set the user cannot see is a closed set they will guess at.
 */
export function parseKinds(value: string): { kinds: EventKind[] } | { error: string } {
  const words = value.split(',').map(w => w.trim()).filter(w => w !== '')
  if (words.length === 0) return { error: `--on needs at least one state (one of: ${EVENT_KINDS.join(', ')}).` }
  const bad = words.filter(w => !(EVENT_KINDS as readonly string[]).includes(w))
  if (bad.length > 0) {
    return { error: `Unknown state${bad.length > 1 ? 's' : ''} ${bad.join(', ')} — accepted: ${EVENT_KINDS.join(', ')}.` }
  }
  return { kinds: [...new Set(words as EventKind[])] }
}

export function parseEventsArgs(argv: string[]): EventsCommand {
  const [verb, ...rest] = argv
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') return { kind: 'help' }

  switch (verb) {
    case 'watch': return parseWatch(rest)
    case 'unwatch': return parseUnwatch(rest)
    case 'status': return { kind: 'status', json: rest.includes('--json') }
    case 'tail': return parseTail(rest)
    case 'run': {
      const unknown = rest.find(a => a.startsWith('-') && a !== '--once')
      if (unknown) return { kind: 'error', message: `Unknown option ${unknown}.` }
      return { kind: 'run', once: rest.includes('--once') }
    }
    case 'emit': return { kind: 'emit' }
    case 'test': return parseTest(rest)
    default: return { kind: 'error', message: `Unknown events action "${verb}".` }
  }
}

function parseWatch(rest: string[]): EventsCommand {
  const o: WatchOptions = { kinds: [...DEFAULT_EVENT_KINDS], desktop: false, json: false }
  for (let i = 0; i < rest.length;) {
    const a = rest[i]!
    if (a === '--desktop') { o.desktop = true; i++; continue }
    if (a === '--json') { o.json = true; i++; continue }
    if (a.startsWith('--task')) {
      const t = takeValue(rest, i, '--task')
      if (t.value === undefined) return { kind: 'error', message: '--task needs a task name.' }
      o.task = t.value; i = t.next; continue
    }
    if (a.startsWith('--session')) {
      const t = takeValue(rest, i, '--session')
      if (t.value === undefined) return { kind: 'error', message: '--session needs a session id or label.' }
      o.session = t.value; i = t.next; continue
    }
    if (a.startsWith('--notify')) {
      const t = takeValue(rest, i, '--notify')
      if (t.value === undefined) return { kind: 'error', message: '--notify needs a Claude Code session name or pid.' }
      o.notify = t.value; i = t.next; continue
    }
    if (a.startsWith('--note')) {
      const t = takeValue(rest, i, '--note')
      if (t.value === undefined) return { kind: 'error', message: '--note needs some text.' }
      o.note = t.value; i = t.next; continue
    }
    if (a.startsWith('--on')) {
      const t = takeValue(rest, i, '--on')
      if (t.value === undefined) return { kind: 'error', message: `--on needs states (one of: ${EVENT_KINDS.join(', ')}).` }
      const parsed = parseKinds(t.value)
      if ('error' in parsed) return { kind: 'error', message: parsed.error }
      o.kinds = parsed.kinds; i = t.next; continue
    }
    return { kind: 'error', message: `Unknown option ${a}.` }
  }
  // A subscription that tells nobody anything is almost certainly a mistake, but it is a legal and
  // useful one: it still shapes what the producer RECORDS, and `agentop events tail` reads that.
  // So it is allowed and said out loud by `status`, never refused here.
  return { kind: 'watch', options: o }
}

function parseUnwatch(rest: string[]): EventsCommand {
  const all = rest.includes('--all')
  const id = rest.find(a => !a.startsWith('-'))
  const unknown = rest.find(a => a.startsWith('-') && a !== '--all')
  if (unknown) return { kind: 'error', message: `Unknown option ${unknown}.` }
  if (all && id !== undefined) {
    return { kind: 'error', message: 'Pass an id or --all, not both — together they mean two different removals.' }
  }
  if (!all && id === undefined) return { kind: 'error', message: 'Which subscription? Pass its id, or --all.' }
  return { kind: 'unwatch', ...(id !== undefined ? { id } : {}), all }
}

function parseTail(rest: string[]): EventsCommand {
  const o: TailOptions = { count: DEFAULT_TAIL, json: false, follow: false }
  for (let i = 0; i < rest.length;) {
    const a = rest[i]!
    if (a === '--json') { o.json = true; i++; continue }
    if (a === '--follow' || a === '-f') { o.follow = true; i++; continue }
    if (a === '-n' || a.startsWith('--count')) {
      const t = takeValue(rest, i, a === '-n' ? '-n' : '--count')
      const n = Number(t.value)
      if (t.value === undefined || !Number.isFinite(n) || n <= 0) {
        return { kind: 'error', message: 'How many events? Pass a positive number to -n.' }
      }
      o.count = Math.floor(n); i = t.next; continue
    }
    if (a.startsWith('--since')) {
      const t = takeValue(rest, i, '--since')
      if (t.value === undefined) return { kind: 'error', message: '--since needs a cursor, as printed by `agentop events tail --json`.' }
      const cursor = parseCursorRef(t.value)
      if ('error' in cursor) return { kind: 'error', message: cursor.error }
      o.since = cursor.offset; o.sinceSeq = cursor.seq; i = t.next; continue
    }
    if (a.startsWith('--task')) {
      const t = takeValue(rest, i, '--task')
      if (t.value === undefined) return { kind: 'error', message: '--task needs a task name.' }
      o.task = t.value; i = t.next; continue
    }
    if (a.startsWith('--on')) {
      const t = takeValue(rest, i, '--on')
      if (t.value === undefined) return { kind: 'error', message: `--on needs states (one of: ${EVENT_KINDS.join(', ')}).` }
      const parsed = parseKinds(t.value)
      if ('error' in parsed) return { kind: 'error', message: parsed.error }
      o.kinds = parsed.kinds; i = t.next; continue
    }
    return { kind: 'error', message: `Unknown option ${a}.` }
  }
  return { kind: 'tail', options: o }
}

/**
 * `offset:seq` — the cursor `--json` prints.
 *
 * Both halves are required. A bare offset would be a cursor that cannot survive a rotation, which
 * is the one thing `event-rotate.ts` exists to catch; accepting one would put the ambiguity back.
 */
export function parseCursorRef(value: string): { offset: number; seq: number } | { error: string } {
  const m = /^(\d+):(\d+)$/.exec(value.trim())
  if (!m) return { error: `--since takes a cursor of the form offset:seq (as printed by \`agentop events tail --json\`), not "${value}".` }
  return { offset: Number(m[1]), seq: Number(m[2]) }
}

function parseTest(rest: string[]): EventsCommand {
  let notify: string | undefined
  let desktop = false
  for (let i = 0; i < rest.length;) {
    const a = rest[i]!
    if (a === '--desktop') { desktop = true; i++; continue }
    if (a.startsWith('--notify')) {
      const t = takeValue(rest, i, '--notify')
      if (t.value === undefined) return { kind: 'error', message: '--notify needs a Claude Code session name or pid.' }
      notify = t.value; i = t.next; continue
    }
    return { kind: 'error', message: `Unknown option ${a}.` }
  }
  // With neither flag there is nothing to test but the inbox, which `tail` already shows. Both
  // channels are exercised instead, which is what someone typing `agentop events test` means.
  if (notify === undefined && !desktop) desktop = true
  return { kind: 'test', ...(notify !== undefined ? { notify } : {}), desktop }
}
