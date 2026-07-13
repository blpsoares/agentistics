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

export type AutostartMode = 'server' | 'central' | 'watch'

export interface AutostartResult {
  ok: boolean
  message: string
}

const MODES: AutostartMode[] = ['server', 'central', 'watch']

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
 * Best-effort repo root, used only by the `central` mode command.
 *
 * ASSUMPTION: this file lives at `<repoRoot>/packages/server/server/autostart.ts`,
 * so the repo root is three directories up from `import.meta.dir`. When running
 * from the compiled binary that path does not exist; in that case we fall back
 * to the current working directory. Either way the resulting command is only a
 * best-effort default the user can edit in the generated unit file.
 */
function repoRoot(): string {
  try {
    return resolve(import.meta.dir, '..', '..', '..')
  } catch {
    return process.cwd()
  }
}

/** The exact shell command each mode's service should run. */
export function serviceCommandFor(mode: AutostartMode): string {
  const bin = process.execPath
  switch (mode) {
    case 'server':
      return `${bin} server`
    case 'watch':
      return `${bin} watch`
    case 'central':
      return `bash ${join(repoRoot(), 'central.sh')} up`
  }
}

function unitPath(mode: AutostartMode): string {
  return join(homedir(), '.config', 'systemd', 'user', `agentop-${mode}.service`)
}

function unitContents(mode: AutostartMode): string {
  return [
    '[Unit]',
    `Description=agentop ${mode} (agentistics autostart)`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${serviceCommandFor(mode)}`,
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

  const path = unitPath(mode)
  try {
    await mkdir(join(homedir(), '.config', 'systemd', 'user'), { recursive: true })
    await writeFile(path, unitContents(mode), 'utf8')
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

/** Disables and removes an agentop autostart service for the given mode. */
export async function disableAutostart(mode: AutostartMode): Promise<AutostartResult> {
  if (platform() !== 'linux') return notSupported('disable')

  const lines: string[] = []
  const disable = await run(['systemctl', '--user', 'disable', '--now', `agentop-${mode}`])
  if (disable.code === 0) {
    lines.push(`Disabled and stopped agentop-${mode}.`)
  } else {
    lines.push(`systemctl --user disable --now agentop-${mode}: ${disable.stderr || `exit ${disable.code}`}`)
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
    lines.push(`agentop-${m}: enabled=${enabledState}, active=${activeState}`)
  }
  return { ok: true, message: lines.join('\n') }
}

/** Type guard used by the cli to validate the user-supplied mode. */
export function isAutostartMode(value: string): value is AutostartMode {
  return (MODES as string[]).includes(value)
}
