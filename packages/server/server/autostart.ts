/**
 * autostart — register agentop to start with the system, plus a lightweight
 * terminal/boot update-check hook.
 *
 * Linux is implemented fully via systemd *user* services (no root required):
 * a unit is written to ~/.config/systemd/user/agentop-<mode>.service, enabled
 * with `systemctl --user enable --now`, and `loginctl enable-linger` is set for
 * the current user so the service also starts at boot without an active login.
 *
 * macOS (launchd) and Windows (Task Scheduler / startup) are not yet wired up —
 * those platforms return a clear, non-throwing message describing the manual
 * step instead.
 */

import { homedir, platform, userInfo } from 'os'
import { join, resolve } from 'path'
import { mkdir, writeFile, readFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'

export type AutostartMode = 'server' | 'central' | 'watch' | 'machine'

export interface AutostartResult {
  ok: boolean
  message: string
}

const MODES: AutostartMode[] = ['server', 'central', 'watch', 'machine']

// --- shell-rc update-check hook markers (kept stable so uninstall is exact) ---
const HOOK_BEGIN = '# >>> agentop update check >>>'
const HOOK_END = '# <<< agentop update check <<<'
// POSIX one-liner — valid in both bash and zsh (the two shells we manage).
const HOOK_LINE = 'command -v agentop >/dev/null 2>&1 && agentop check-update 2>/dev/null'

/** Shell rc files we manage the update-check hook in. Different login shells source
 *  different files (bash → ~/.bashrc, zsh → ~/.zshrc), so a bash-only hook was invisible
 *  to zsh users. We install into whichever of these already exist. */
function hookRcCandidates(): string[] {
  return [join(homedir(), '.bashrc'), join(homedir(), '.zshrc')]
}

/** Pure: append the guarded hook block to rc `content` when absent. Returns null when the
 *  block is already present (idempotent no-op). */
export function addHookBlock(content: string): string | null {
  if (content.includes(HOOK_BEGIN)) return null
  return content + `\n${HOOK_BEGIN}\n${HOOK_LINE}\n${HOOK_END}\n`
}

/** Pure: remove the guarded hook block from rc `content`. Returns null when absent, or
 *  throws when the block is corrupt (a BEGIN with no matching END). */
export function removeHookBlock(content: string): string | null {
  const beginIdx = content.indexOf(HOOK_BEGIN)
  if (beginIdx === -1) return null
  const endIdx = content.indexOf(HOOK_END, beginIdx)
  if (endIdx === -1) throw new Error('corrupt hook block')
  // Consume the newline addHookBlock prepended before BEGIN and the one after END, so this is
  // an exact inverse of addHookBlock (no stray blank line left behind).
  let start = beginIdx
  if (start > 0 && content[start - 1] === '\n') start -= 1
  let end = endIdx + HOOK_END.length
  if (content[end] === '\n') end += 1
  return content.slice(0, start) + content.slice(end)
}

/** ~/.bashrc → "~/.bashrc" for user-facing messages. */
function tildeRc(rc: string): string {
  return rc.replace(homedir(), '~')
}

/**
 * Locate the repo checkout holding `central.sh`, used only by the `central` mode command.
 *
 * The old version derived it as three directories up from `import.meta.dir` and guarded that
 * with a try/catch. `resolve` does not throw, so the guard never fired: under the COMPILED
 * BINARY `import.meta.dir` is Bun's virtual root (`/$bunfs/root`), three up is `/`, and the
 * unit shipped `ExecStart=bash /central.sh up` — a service that exits 127 and is restarted
 * every 5 seconds forever. Existence is the only thing that distinguishes a real checkout from
 * a path that merely parses, so check for the file rather than assuming the layout.
 *
 * Returns null when no candidate holds the script — see `serviceCommandFor`.
 */
function findCentralScript(): string | null {
  const candidates = [
    // Running from source: <repoRoot>/packages/server/server/autostart.ts
    resolve(import.meta.dir, '..', '..', '..'),
    // Compiled binary invoked from inside a checkout.
    process.cwd(),
  ]
  for (const dir of candidates) {
    const script = join(dir, 'central.sh')
    if (existsSync(script)) return script
  }
  return null
}

/**
 * Locate `docker-compose.machine.yml`, the same way `findCentralScript` locates `central.sh` — it
 * only exists in a repo checkout, so a boot unit for the Docker `machine` runtime can only be
 * written from one. Returns null otherwise, which `serviceCommandFor('machine')` turns into a
 * refusal rather than a unit whose `ExecStart` cannot resolve.
 */
function findMachineCompose(): string | null {
  const candidates = [
    resolve(import.meta.dir, '..', '..', '..'),
    process.cwd(),
  ]
  for (const dir of candidates) {
    const compose = join(dir, 'docker-compose.machine.yml')
    if (existsSync(compose)) return compose
  }
  return null
}

/**
 * The exact shell command each mode's service should run, or null when this machine cannot run
 * that mode at all. `central` needs `central.sh`, which only exists in a repo checkout; from an
 * installed binary there is nothing to point at. Null means the caller must REFUSE — the same
 * rule the control center applies to a rebuild it cannot perform: absent beats present-and-failing.
 */
export function serviceCommandFor(mode: AutostartMode): string | null {
  const bin = process.execPath
  switch (mode) {
    case 'server':
      return `${bin} server`
    case 'watch':
      return `${bin} watch`
    case 'central': {
      const script = findCentralScript()
      return script ? `bash ${script} up` : null
    }
    case 'machine': {
      // No `--build`: the boot-time unit brings back whatever image is already there. A rebuild
      // is a deliberate action (the control center's "Rebuild & restart"), never something that
      // should happen silently every time the machine reboots.
      const compose = findMachineCompose()
      return compose ? `docker compose -f ${compose} up -d` : null
    }
  }
}

/**
 * The systemd unit that brings a mode back — the name a user has to be given.
 *
 * Exported because "starts at boot" is not an answer anyone can act on: the whole complaint this
 * module grew a `disable` path for was a central that came back with nothing on screen naming what
 * brought it. With the unit named, `systemctl --user status <unit>` answers, `agentop autostart
 * status` answers, and the cockpit's detail pane can print it beside the state.
 */
export function unitName(mode: AutostartMode): string {
  return `agentop-${mode}.service`
}

function unitPath(mode: AutostartMode): string {
  return join(homedir(), '.config', 'systemd', 'user', unitName(mode))
}

function unitContents(mode: AutostartMode, command: string): string {
  return [
    '[Unit]',
    `Description=agentop ${mode} (agentistics autostart)`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${command}`,
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}

/**
 * Runs a command, capturing stdout/stderr. Never throws — a non-zero exit or a
 * missing binary is reported through the returned object.
 */
async function run(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { code, stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (err: any) {
    return { code: 127, stdout: '', stderr: err?.message ?? String(err) }
  }
}

function notSupported(action: string): AutostartResult {
  const plat = platform()
  if (plat === 'darwin') {
    return {
      ok: false,
      message:
        `autostart is not yet supported on macOS.\n` +
        `Manual step: create a launchd agent that runs "${serviceCommandFor('server')}" ` +
        `(a plist under ~/Library/LaunchAgents with RunAtLoad=true), then ` +
        `\`launchctl load\` it. See https://www.launchd.info for details.`,
    }
  }
  if (plat === 'win32') {
    return {
      ok: false,
      message:
        `autostart is not yet supported on Windows.\n` +
        `Manual step: register a Task Scheduler task (or a Startup-folder shortcut) ` +
        `that runs "${serviceCommandFor('server')}" at logon.`,
    }
  }
  return {
    ok: false,
    message: `autostart (${action}) is not supported on this platform (${plat}).`,
  }
}

/**
 * Appends a single guarded line to each present shell rc (~/.bashrc and ~/.zshrc) that runs
 * `agentop check-update` on every terminal open (and thus at boot for login shells). Installs
 * into whichever candidates already exist; if NEITHER exists, creates ~/.bashrc as the default.
 * Idempotent per file.
 */
export async function installUpdateHook(): Promise<AutostartResult> {
  const candidates = hookRcCandidates()
  const present: string[] = []
  for (const rc of candidates) {
    try { await readFile(rc, 'utf8'); present.push(rc) } catch { /* missing */ }
  }
  // If the user has neither rc yet, seed ~/.bashrc (the historical default).
  const targets = present.length ? present : [join(homedir(), '.bashrc')]

  const touched: string[] = []
  for (const rc of targets) {
    let existing = ''
    try { existing = await readFile(rc, 'utf8') } catch { existing = '' }
    const next = addHookBlock(existing)
    if (next === null) { touched.push(`${tildeRc(rc)} (already present)`); continue }
    try {
      await writeFile(rc, next, 'utf8')
      touched.push(tildeRc(rc))
    } catch (err: any) {
      return { ok: false, message: `Could not write ${tildeRc(rc)}: ${err?.message ?? err}` }
    }
  }
  return { ok: true, message: `Update-check hook ensured in: ${touched.join(', ')}.` }
}

/** Removes the guarded update-check block from every present shell rc (exact marker match). */
export async function uninstallUpdateHook(): Promise<AutostartResult> {
  const candidates = hookRcCandidates()
  const removedFrom: string[] = []
  for (const rc of candidates) {
    let existing = ''
    try { existing = await readFile(rc, 'utf8') } catch { continue /* no such rc */ }
    let next: string | null
    try {
      next = removeHookBlock(existing)
    } catch {
      return { ok: false, message: `${tildeRc(rc)} has a corrupt hook block — remove it manually.` }
    }
    if (next === null) continue // not present in this file
    try {
      await writeFile(rc, next, 'utf8')
      removedFrom.push(tildeRc(rc))
    } catch (err: any) {
      return { ok: false, message: `Could not write ${tildeRc(rc)}: ${err?.message ?? err}` }
    }
  }
  return removedFrom.length
    ? { ok: true, message: `Removed update-check hook from: ${removedFrom.join(', ')}.` }
    : { ok: true, message: 'Update-check hook not present in any shell rc — nothing to remove.' }
}

/** Enables an agentop autostart service for the given mode (Linux/systemd). */
export async function enableAutostart(mode: AutostartMode): Promise<AutostartResult> {
  if (platform() !== 'linux') return notSupported('enable')

  // Refuse before writing anything. A unit whose ExecStart cannot resolve is not a partial
  // success — it is a service systemd restarts every 5 seconds for the life of the machine.
  const command = serviceCommandFor(mode)
  if (!command) {
    const missing = mode === 'machine' ? 'docker-compose.machine.yml' : 'central.sh'
    return {
      ok: false,
      message: `Cannot enable agentop-${mode} here: ${missing} was not found. ` +
        `That file lives in the repository checkout, so run this from one ` +
        `(the installed binary has nothing to point the service at).`,
    }
  }

  const path = unitPath(mode)
  try {
    await mkdir(join(homedir(), '.config', 'systemd', 'user'), { recursive: true })
    await writeFile(path, unitContents(mode, command), 'utf8')
  } catch (err: any) {
    return { ok: false, message: `Could not write unit file ${path}: ${err?.message ?? err}` }
  }

  const lines: string[] = [`Wrote ${path}`]

  const reload = await run(['systemctl', '--user', 'daemon-reload'])
  if (reload.code !== 0) {
    lines.push(`systemctl --user daemon-reload failed: ${reload.stderr || `exit ${reload.code}`}`)
    return { ok: false, message: lines.join('\n') }
  }

  const enable = await run(['systemctl', '--user', 'enable', '--now', `agentop-${mode}`])
  if (enable.code !== 0) {
    lines.push(`systemctl --user enable --now agentop-${mode} failed: ${enable.stderr || `exit ${enable.code}`}`)
    return { ok: false, message: lines.join('\n') }
  }
  lines.push(`Enabled and started agentop-${mode}.`)

  // Allow the user's services to run at boot without an active login session.
  const linger = await run(['loginctl', 'enable-linger', userInfo().username])
  if (linger.code === 0) {
    lines.push('Enabled linger so it starts at boot without login.')
  } else {
    lines.push(`Note: could not enable linger (${linger.stderr || `exit ${linger.code}`}); ` +
      `the service will start on your next login instead of at boot.`)
  }

  const hook = await installUpdateHook()
  lines.push(hook.message)

  return { ok: true, message: lines.join('\n') }
}

/**
 * Options for `disableAutostart`.
 *
 * `stop` is the whole of it, and it exists because the two callers mean genuinely different things.
 * `agentop autostart <mode> disable` has always meant "turn this service off, now and forever", and
 * changing that under people scripting it would be a silent behaviour change. The control center's
 * boot switch means only "do not bring it back", and a switch that also killed the running service
 * would be two actions behind one label — the cockpit has a `Stop` verb for the other one, sitting
 * two cells away on the same row.
 */
export interface DisableOptions {
  /** Also stop it right now (`--now`). Default true, which is what the CLI has always done. */
  stop?: boolean
}

/** Disables and removes an agentop autostart service for the given mode. */
export async function disableAutostart(
  mode: AutostartMode,
  opts: DisableOptions = {},
): Promise<AutostartResult> {
  if (platform() !== 'linux') return notSupported('disable')

  const stop = opts.stop ?? true
  const lines: string[] = []
  const argv = stop
    ? ['systemctl', '--user', 'disable', '--now', `agentop-${mode}`]
    : ['systemctl', '--user', 'disable', `agentop-${mode}`]
  const disable = await run(argv)
  if (disable.code === 0) {
    lines.push(stop
      ? `Disabled and stopped agentop-${mode}.`
      : `Disabled agentop-${mode} — it will not start at boot. Anything running now keeps running.`)
  } else {
    lines.push(`${argv.slice(0, -1).join(' ')} agentop-${mode}: ${disable.stderr || `exit ${disable.code}`}`)
  }

  const path = unitPath(mode)
  try {
    await unlink(path)
    lines.push(`Removed ${path}`)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      lines.push(`No unit file at ${path}.`)
    } else {
      lines.push(`Could not remove ${path}: ${err?.message ?? err}`)
    }
  }

  await run(['systemctl', '--user', 'daemon-reload'])
  return { ok: true, message: lines.join('\n') }
}

/**
 * Restarts an agentop mode so it picks up new code (after an upgrade or a local change) or a
 * changed config. Only meaningful when the mode runs as a systemd user service — a foreground
 * `agentop server` has no service to bounce. `central` is redirected to `agentop central restart`
 * (that path rebuilds/restarts the Docker service, which a systemctl bounce can't do).
 */
/** Is `mode` installed as a systemd user unit? The one fact that decides whether a restart goes
 *  through systemd or through the detached process the control center starts. */
export async function unitInstalled(mode: AutostartMode): Promise<boolean> {
  if (platform() !== 'linux') return false
  try {
    await readFile(unitPath(mode), 'utf8')
    return true
  } catch {
    return false
  }
}

export async function restartAutostart(mode: AutostartMode): Promise<AutostartResult> {
  if (platform() !== 'linux') return notSupported('restart')

  if (mode === 'central') {
    return {
      ok: false,
      message:
        'The central runs in Docker, not as a systemd service.\n' +
        'Use `agentop central restart` to bounce it, or `agentop central up` to rebuild it after a code change.',
    }
  }

  // A restart only makes sense when the mode is installed as a service.
  let unitExists = true
  try {
    await readFile(unitPath(mode), 'utf8')
  } catch {
    unitExists = false
  }
  if (!unitExists) {
    return {
      ok: false,
      message:
        `No agentop-${mode} service is installed, so there is nothing to restart.\n` +
        `Run it in the foreground with \`agentop ${mode}\`, or install autostart first ` +
        `with \`agentop autostart ${mode} enable\`.`,
    }
  }

  const res = await run(['systemctl', '--user', 'restart', `agentop-${mode}`])
  if (res.code !== 0) {
    return {
      ok: false,
      message: `systemctl --user restart agentop-${mode} failed: ${res.stderr || `exit ${res.code}`}`,
    }
  }
  return { ok: true, message: `Restarted agentop-${mode} — it now runs the current code and config.` }
}

/**
 * Reports the enabled/active status of one or all agentop autostart services.
 *
 * It states WHAT each enabled unit runs, and it says the consequence in a sentence. `enabled=enabled,
 * active=inactive` is the exact shape of the bug people report — a central that is not running right
 * now and comes back anyway — and read as two words it looks like nothing is wrong. The unit is the
 * thing that brings it back; the sentence and the `ExecStart` are what make that discoverable
 * without reading systemd's manual.
 */
export async function autostartStatus(mode?: AutostartMode): Promise<AutostartResult> {
  if (platform() !== 'linux') return notSupported('status')

  const targets = mode ? [mode] : MODES
  const lines: string[] = []
  for (const m of targets) {
    const enabled = await run(['systemctl', '--user', 'is-enabled', `agentop-${m}`])
    const active = await run(['systemctl', '--user', 'is-active', `agentop-${m}`])
    // systemctl prints the state to stdout even on non-zero exit.
    const enabledState = enabled.stdout || enabled.stderr || 'unknown'
    const activeState = active.stdout || active.stderr || 'unknown'
    lines.push(`${unitName(m)}: enabled=${enabledState}, active=${activeState}`)
    // Only for a unit that is actually registered: reading the ExecStart of a unit that does not
    // exist would print an empty promise about a mechanism that is not installed.
    if (enabledState.startsWith('enabled') || enabledState.startsWith('linked')) {
      const exec = await run(['systemctl', '--user', 'show', `agentop-${m}`, '-p', 'ExecStart', '--value'])
      const cmd = exec.stdout.match(/argv\[\]=([^;]+);/)?.[1]?.trim()
      lines.push(`  → comes back at boot${cmd ? `, running: ${cmd}` : ''}`)
      lines.push(`  → \`agentop autostart ${m} disable\` removes it`)
    }
  }
  return { ok: true, message: lines.join('\n') }
}

/** Type guard used by the cli to validate the user-supplied mode. */
export function isAutostartMode(value: string): value is AutostartMode {
  return (MODES as string[]).includes(value)
}
