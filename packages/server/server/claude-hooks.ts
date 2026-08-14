/**
 * claude-hooks.ts — **pure**: what agentop puts into a user's `~/.claude/settings.json`, how it
 * merges with whatever is already in there, and how it takes it back out again.
 *
 * That file is not ours. It holds other people's hooks, other tools' keys, and keys this version of
 * agentop has never heard of. So every function here READS a settings object and RETURNS a new one
 * with exactly one thing changed — it never rebuilds the document from a schema it believes in, and
 * it never touches a key it did not write. A `JSON.parse` → mutate-what-I-know → `JSON.stringify`
 * round-trip that drops an unknown key destroys configuration that was working, silently, which is
 * the failure this module is shaped to make impossible.
 *
 * Three rules the tests pin:
 *  - **Refuse rather than overwrite.** A `settings.json` whose `hooks` is a string is not a file to
 *    fix; it is a file to leave alone and report. Every plan returns a discriminated result, and the
 *    caller writes nothing on `ok: false`.
 *  - **Installing twice changes nothing.** `changed: false` is what the second run reports, and the
 *    settings object comes back untouched (=== the input), so the caller does not even rewrite it.
 *  - **Uninstalling is the exact inverse.** It removes OUR hook entry and the containers that exist
 *    only to hold it, and nothing else. A group that also carries someone else's hook keeps that
 *    hook and its group.
 *
 * ## Why the command string is the identity
 *
 * A Claude Code hook entry is `{ type, command, timeout }`. There is no field for "who installed
 * this", and inventing an unknown key inside someone else's schema is how a settings file stops
 * validating on the next release. So OUR entry is recognised by the command it runs — an `agentop`
 * binary invoked with the verb pair `hooks context` — and the version it was written at travels in
 * that same command as `--hook-version N`. It is self-describing: `agentop hooks status` can read a
 * file it has no memory of writing, including one a user hand-edited or copied from another
 * machine, without a second store on the side that could disagree with it.
 */

/** Bumped when the hook's CONTRACT changes (the verb it calls, what that verb prints). An installed
 *  hook at a lower version is reported as stale by `status` and rewritten in place by `install`. */
export const HOOK_VERSION = 1

/** The Claude Code event we register on. See `docs/claude-integration.md` for why this one. */
export const HOOK_EVENT = 'SessionStart'

/** Seconds. The hook talks to tmux and reads `/proc`; ten is generous and bounded — a hook that
 *  hangs holds up the session it was supposed to inform. */
export const HOOK_TIMEOUT_SEC = 10

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/** Shell-quote only when it is actually needed — an unquoted `agentop` reads better in a file a
 *  person opens, and a path with a space in it must not become two arguments. */
function shellQuote(s: string): string {
  return /[\s"'\\]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s
}

/**
 * How this installation of agentop should be invoked from a hook, given what is available.
 *
 * Prefer the bare name on PATH: the hook then survives an upgrade that replaces the binary at a
 * different path, which `agentop upgrade` can do. Only when there is no `agentop` on PATH do we
 * pin an absolute one — and running from a source checkout (`bun …/cli.ts`) needs the interpreter
 * as well, or the settings file would carry `bun hooks context`, which is not a command.
 */
export function hookInvocation(o: { onPath?: boolean; execPath: string; script?: string }): string {
  if (o.onPath) return 'agentop'
  const fromSource = !!o.script && (o.script.endsWith('.ts') || o.script.endsWith('.js'))
  return fromSource
    ? `${shellQuote(o.execPath)} ${shellQuote(o.script!)}`
    : shellQuote(o.execPath)
}

/** The full command string an installed hook runs. */
export function hookCommand(invocation: string, version = HOOK_VERSION): string {
  return `${invocation} hooks context --hook-version ${version}`
}

/**
 * Is this command one of ours?
 *
 * The verb pair `hooks context` is required, and then one of two corroborating marks: the word
 * `agentop` somewhere in the command, or the `--hook-version` flag every install writes. Either
 * alone would be wrong — a source checkout runs `bun …/packages/server/bin/cli.ts`, which contains
 * no `agentop` at all, and `hooks context` on its own is a verb pair another tool could plausibly
 * use. Deliberately loose about everything else: an absolute path, a quoted path, an interpreter
 * prefix and a hand-added `--lang pt` all still match, and all of them are still our hook.
 */
export function isAgentopHookCommand(command: string): boolean {
  if (!/(^|[\s"'])hooks\s+context(\s|$|["'])/.test(command)) return false
  return /agentop/i.test(command) || /--hook-version/.test(command)
}

/** The version an installed command declares, or null when it declares none (a pre-versioned or
 *  hand-written one — treated as stale, never as current). */
export function hookVersionOf(command: string): number | null {
  const m = /--hook-version[=\s]+(\d+)/.exec(command)
  if (!m || m[1] === undefined) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Reading and planning
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Why a settings document cannot be planned against. The caller reports it and writes NOTHING. */
export type HookPlanError =
  | { code: 'settings-not-object' }
  | { code: 'hooks-not-object' }
  | { code: 'event-not-array'; event: string }

export type HookPlan =
  | { ok: true; settings: Obj; changed: boolean }
  | { ok: false; error: HookPlanError }

export interface HookStatus {
  installed: boolean
  /** Every one of our entries found. More than one is possible in a hand-edited file. */
  commands: string[]
  /** The version of the first entry, or null when it declares none. */
  version: number | null
  /** Installed, but written by a different (older or newer) agentop than this one. */
  stale: boolean
}

/** Read-only: what is in this settings document, as far as we are concerned. Never throws — an
 *  unreadable shape simply carries no hook of ours, which is the truth. */
export function readHookStatus(settings: unknown, version = HOOK_VERSION): HookStatus {
  const commands: string[] = []
  if (isObj(settings) && isObj(settings.hooks) && Array.isArray(settings.hooks[HOOK_EVENT])) {
    for (const group of settings.hooks[HOOK_EVENT] as unknown[]) {
      if (!isObj(group) || !Array.isArray(group.hooks)) continue
      for (const hook of group.hooks as unknown[]) {
        if (!isObj(hook) || typeof hook.command !== 'string') continue
        if (isAgentopHookCommand(hook.command)) commands.push(hook.command)
      }
    }
  }
  const first = commands[0]
  const found = first !== undefined ? hookVersionOf(first) : null
  return {
    installed: commands.length > 0,
    commands,
    version: found,
    stale: commands.length > 0 && found !== version,
  }
}

/**
 * Add (or bring up to date) our SessionStart hook.
 *
 * An entry of ours that is already there is UPDATED IN PLACE — its `timeout`, and any other key a
 * user added to it, is kept. Replacing the whole entry would quietly undo a deliberate edit, and
 * "install refreshed my hook" is not a licence to discard the rest of the line it lives on.
 */
export function planHookInstall(settings: unknown, command: string): HookPlan {
  if (settings === undefined || settings === null) settings = {}
  if (!isObj(settings)) return { ok: false, error: { code: 'settings-not-object' } }

  const hooksRaw = settings.hooks ?? {}
  if (!isObj(hooksRaw)) return { ok: false, error: { code: 'hooks-not-object' } }

  const eventRaw = hooksRaw[HOOK_EVENT] ?? []
  if (!Array.isArray(eventRaw)) return { ok: false, error: { code: 'event-not-array', event: HOOK_EVENT } }

  let changed = false
  let found = false

  const groups = eventRaw.map(group => {
    if (!isObj(group) || !Array.isArray(group.hooks)) return group
    let touched = false
    const hooks = (group.hooks as unknown[]).map(hook => {
      if (!isObj(hook) || typeof hook.command !== 'string') return hook
      if (!isAgentopHookCommand(hook.command)) return hook
      found = true
      if (hook.command === command) return hook
      touched = true
      return { ...hook, command }
    })
    if (!touched) return group
    changed = true
    return { ...group, hooks }
  })

  if (!found) {
    groups.push({
      // No `matcher`: every SessionStart source is one where the facts this hook reports are worth
      // having — a fresh start, a resume and a compact have all just lost or never had them.
      hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SEC }],
    })
    changed = true
  }

  // Nothing to write: hand back the very object we were given, so the caller can skip the write and
  // leave the file's bytes (and its mtime) exactly as they were.
  if (!changed) return { ok: true, settings, changed: false }

  return {
    ok: true,
    settings: { ...settings, hooks: { ...hooksRaw, [HOOK_EVENT]: groups } },
    changed: true,
  }
}

/**
 * Remove our hook and nothing else.
 *
 * Containers are pruned when they become empty — the group we appended, the `SessionStart` array,
 * and `hooks` itself — because those exist only to hold the entry we are taking back. The one
 * ambiguity is a `"hooks": {}` a user wrote by hand before installing: it is indistinguishable from
 * the one an install created, and it is pruned. An empty object either way changes no behaviour.
 */
export function planHookRemoval(settings: unknown): HookPlan {
  if (settings === undefined || settings === null) settings = {}
  if (!isObj(settings)) return { ok: false, error: { code: 'settings-not-object' } }

  const hooksRaw = settings.hooks
  if (hooksRaw === undefined) return { ok: true, settings, changed: false }
  if (!isObj(hooksRaw)) return { ok: false, error: { code: 'hooks-not-object' } }

  const eventRaw = hooksRaw[HOOK_EVENT]
  if (eventRaw === undefined) return { ok: true, settings, changed: false }
  if (!Array.isArray(eventRaw)) return { ok: false, error: { code: 'event-not-array', event: HOOK_EVENT } }

  let changed = false
  const groups: unknown[] = []
  for (const group of eventRaw) {
    if (!isObj(group) || !Array.isArray(group.hooks)) { groups.push(group); continue }
    const kept = (group.hooks as unknown[]).filter(hook =>
      !(isObj(hook) && typeof hook.command === 'string' && isAgentopHookCommand(hook.command)))
    if (kept.length === (group.hooks as unknown[]).length) { groups.push(group); continue }
    changed = true
    // A group emptied by that removal was ours; one that still carries someone else's hook stays,
    // with everything else on it intact.
    if (kept.length > 0) groups.push({ ...group, hooks: kept })
  }

  if (!changed) return { ok: true, settings, changed: false }

  const hooks: Obj = { ...hooksRaw }
  if (groups.length > 0) hooks[HOOK_EVENT] = groups
  else delete hooks[HOOK_EVENT]

  const next: Obj = { ...settings }
  if (Object.keys(hooks).length > 0) next.hooks = hooks
  else delete next.hooks

  return { ok: true, settings: next, changed: true }
}

/** The sentence a refusal deserves. Pure so the CLI and the tests read the same words. */
export function explainHookPlanError(e: HookPlanError, file: string): string {
  switch (e.code) {
    case 'settings-not-object':
      return `${file} does not hold a JSON object, so agentop will not write to it. Fix or move the file and run this again.`
    case 'hooks-not-object':
      return `${file} has a "hooks" key that is not an object, so agentop cannot merge into it without guessing. Nothing was written.`
    case 'event-not-array':
      return `${file} has a "hooks".${e.event} that is not an array, so agentop cannot merge into it without guessing. Nothing was written.`
  }
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

export type HooksCommand =
  | { kind: 'install'; hook: boolean; skill: boolean }
  | { kind: 'uninstall'; hook: boolean; skill: boolean }
  | { kind: 'status' }
  | { kind: 'context' }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

/**
 * `agentop hooks …`. Pure, so what the words mean is tested rather than inferred from behaviour.
 *
 * `--hook-only` / `--skill-only` narrow install and uninstall to one half; passing both is refused
 * rather than resolved to "everything", which is the opposite of what either flag asks for.
 */
export function parseHooksArgs(argv: string[]): HooksCommand {
  const [verb, ...rest] = argv
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') return { kind: 'help' }

  const hookOnly = rest.includes('--hook-only')
  const skillOnly = rest.includes('--skill-only')
  // `--hook-version` is passed BY the installed hook to itself; it carries the version for `status`
  // to read out of the settings file and is not an argument `context` acts on.
  const unknown = rest.find(a =>
    a.startsWith('-') && !['--hook-only', '--skill-only'].includes(a) && !a.startsWith('--hook-version'))

  switch (verb) {
    case 'install':
    case 'uninstall': {
      if (unknown) return { kind: 'error', message: `Unknown option ${unknown}.` }
      if (hookOnly && skillOnly) {
        return { kind: 'error', message: 'Pass --hook-only or --skill-only, not both — together they mean neither.' }
      }
      return { kind: verb, hook: !skillOnly, skill: !hookOnly }
    }
    case 'status':
      return { kind: 'status' }
    case 'context':
      return { kind: 'context' }
    default:
      return { kind: 'error', message: `Unknown hooks action "${verb}".` }
  }
}
