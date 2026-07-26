import { rename, chmod, unlink } from 'fs/promises'
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { platform } from 'os'
import { join } from 'path'
import { getVersionInfo, CURRENT_VERSION } from './version.ts'
import { restartAutostart } from './autostart.ts'
import { AGENTISTICS_DATA_DIR } from './config.ts'

const GITHUB_REPO = 'blpsoares/agentistics'
const DOWNLOAD_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/agentop`

const _ESC = '\x1b'
const _R  = `${_ESC}[0m`
const _B  = `${_ESC}[1m`
const _GR = `${_ESC}[92m`
const _WH = `${_ESC}[97m`
const _D  = `${_ESC}[2m`
const _Y  = `${_ESC}[33m`

// central.sh sets PROJECT=${PROJECT:-team-mode}; docker-compose.machine.yml builds `agentistics-machine`.
const CENTRAL_PROJECT = 'team-mode'
const MACHINE_IMAGE = 'agentistics-machine'

/** Run a command, capturing trimmed stdout (stderr discarded). Never throws. */
async function sh(cmd: string[]): Promise<{ code: number; out: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' })
    const out = (await new Response(p.stdout).text()).trim()
    const code = await p.exited
    return { code, out }
  } catch {
    return { code: 1, out: '' }
  }
}

/** Run a command with inherited stdio so the user sees progress (docker pull/up, etc.). */
async function shInherit(cmd: string[]): Promise<number> {
  try {
    const p = Bun.spawn(cmd, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
    return await p.exited
  } catch {
    return 1
  }
}

async function dockerRunning(filter: string): Promise<boolean> {
  const r = await sh(['docker', 'ps', '-q', '-f', filter])
  return r.out.split(/\s+/).filter(Boolean).length > 0
}

/**
 * After the new binary is in place, bounce whatever is actually running so it runs the new
 * version — the whole point of `upgrade` is that the user doesn't have to restart by hand.
 *
 * Self-restart is safe: `agentop upgrade` runs as a foreground CLI, a *separate* process from
 * the systemd user service or Docker container it restarts, so restarting those never kills
 * this process. `systemctl --user restart` is handled out-of-process by systemd, and the
 * central/machine live in their own containers.
 *
 * @param newBin path to the just-installed binary — the central/machine restart is driven by
 *   THIS binary so the image tag matches the version we just installed (the running process
 *   still carries the old version number).
 */
async function restartRunningServices(newBin: string): Promise<void> {
  let didSomething = false

  // 1) Native systemd user services: solo/member run as `agentop server`; `agentop watch` is the
  //    OTel daemon. Restart only the ones that are actually active so we never start a stopped one.
  if (platform() === 'linux') {
    for (const mode of ['server', 'watch'] as const) {
      const active = await sh(['systemctl', '--user', 'is-active', `agentop-${mode}`])
      if (active.out === 'active') {
        process.stdout.write(`  Restarting the agentop-${mode} service…\n`)
        const res = await restartAutostart(mode)
        process.stdout.write(`    ${res.message.split('\n')[0]}\n`)
        didSomething = true
      }
    }
  }

  // 2) Central (Docker): pull the new version-tagged image and recreate. Driven through the NEW
  //    binary so `agentop central` resolves the image tag to the version we just installed.
  if (await dockerRunning(`label=com.docker.compose.project=${CENTRAL_PROJECT}`)) {
    process.stdout.write('  Updating the central (Docker): pulling the new image and recreating…\n')
    await shInherit([newBin, 'central', 'pull'])
    await shInherit([newBin, 'central', 'up'])
    didSomething = true
  }

  // 3) Machine-in-Docker: best-effort recreate. The machine image is built from a repo checkout
  //    (docker-compose.machine.yml), so this only applies when that compose is reachable.
  if (await dockerRunning(`ancestor=${MACHINE_IMAGE}`)) {
    const compose = join(process.cwd(), 'docker-compose.machine.yml')
    if (await Bun.file(compose).exists()) {
      process.stdout.write('  Recreating the machine container (Docker)…\n')
      await shInherit(['docker', 'compose', '-f', compose, 'up', '-d', '--build'])
      didSomething = true
    } else {
      process.stdout.write(
        `  ${_Y}A machine container is running but docker-compose.machine.yml was not found here.${_R}\n` +
        '    Re-run `agentop start` from the repo to recreate it on the new version.\n',
      )
    }
  }

  if (!didSomething) {
    process.stdout.write(
      `  ${_D}No managed services detected running. If agentop is running in the foreground, ` +
      `restart it to apply.${_R}\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// Unattended (critical) upgrade — lock + detached spawn
//
// `agentop check-update` runs from a shell rc hook on every terminal open. When the
// newest release is flagged critical it installs the update WITHOUT asking, but it
// must never hold the user's terminal — so it spawns a detached `agentop upgrade`,
// logs to a file and returns immediately. Two terminals opening at once would race,
// hence the lock file below.
// ---------------------------------------------------------------------------

/** Guards concurrent unattended upgrades. Holds the pid of the running upgrade. */
export const UPGRADE_LOCK_FILE = join(AGENTISTICS_DATA_DIR, 'upgrade.lock')
/** Where the detached upgrade's output goes (the terminal gets nothing). */
export const AUTO_UPGRADE_LOG = join(AGENTISTICS_DATA_DIR, 'auto-upgrade.log')
/** A lock older than this is treated as abandoned (crash / killed -9 / pid reuse). */
export const UPGRADE_LOCK_TTL_MS = 30 * 60 * 1000

export interface UpgradeLock {
  pid: number
  version: string
  startedAt: number
}

/** Pure: parse a lock file's contents. Returns null for junk/truncated content. */
export function parseUpgradeLock(raw: string): UpgradeLock | null {
  try {
    const o = JSON.parse(raw) as Partial<UpgradeLock>
    if (!o || typeof o.pid !== 'number' || !Number.isFinite(o.pid) || o.pid <= 0) return null
    return {
      pid: o.pid,
      version: typeof o.version === 'string' ? o.version : '',
      startedAt: typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) ? o.startedAt : 0,
    }
  } catch {
    return null
  }
}

/**
 * Pure: is an existing lock still held? A lock counts as active only while its process
 * is alive AND it is younger than the TTL — so a crashed upgrade can never wedge the
 * mechanism permanently, and a reused pid can't keep it alive forever either.
 */
export function isUpgradeLockActive(
  lock: UpgradeLock | null,
  now: number,
  isPidAlive: (pid: number) => boolean,
  ttlMs: number = UPGRADE_LOCK_TTL_MS,
): boolean {
  if (!lock) return false
  if (now - lock.startedAt >= ttlMs) return false
  return isPidAlive(lock.pid)
}

/** signal 0 probes liveness without delivering anything. EPERM = alive but not ours. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err?.code === 'EPERM'
  }
}

export type BackgroundUpgradeResult = 'started' | 'in-progress' | 'not-installed' | 'failed'

/**
 * Pure: is this process the installed `agentop` binary (as opposed to `bun bin/cli.ts` in a
 * source checkout)? runUpgrade replaces process.execPath — from a checkout that path is the
 * BUN runtime itself, so an unattended upgrade there would clobber the user's bun install.
 * Auto-install is therefore restricted to the compiled binary; source checkouts get the
 * normal banner and can still run `agentop upgrade` deliberately.
 */
export function isInstalledBinary(execPath: string, scriptPath: string | undefined): boolean {
  if (scriptPath && (scriptPath.endsWith('.ts') || scriptPath.endsWith('.js'))) return false
  const base = (execPath.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '')
  return base !== 'bun' && base !== 'node'
}

/**
 * Starts `agentop upgrade` as a DETACHED background process and returns immediately —
 * the caller's terminal is never held. Output is appended to AUTO_UPGRADE_LOG.
 *
 * Concurrency-safe: the lock is created with the exclusive `wx` flag (atomic), so of two
 * shells opening at the same instant exactly one wins; the loser gets 'in-progress'. A
 * stale lock (dead pid or past the TTL) is taken over.
 */
export async function startBackgroundUpgrade(version: string): Promise<BackgroundUpgradeResult> {
  // Never self-install over a dev checkout's runtime — see isInstalledBinary.
  if (!isInstalledBinary(process.execPath, process.argv[1])) return 'not-installed'

  const payload = (pid: number) => JSON.stringify({ pid, version, startedAt: Date.now() })
  try {
    mkdirSync(AGENTISTICS_DATA_DIR, { recursive: true })
    try {
      writeFileSync(UPGRADE_LOCK_FILE, payload(process.pid), { flag: 'wx' })
    } catch (err: any) {
      if (err?.code !== 'EEXIST') return 'failed'
      let existing: UpgradeLock | null = null
      try { existing = parseUpgradeLock(readFileSync(UPGRADE_LOCK_FILE, 'utf8')) } catch { /* unreadable → stale */ }
      if (isUpgradeLockActive(existing, Date.now(), pidAlive)) return 'in-progress'
      writeFileSync(UPGRADE_LOCK_FILE, payload(process.pid))
    }
  } catch {
    return 'failed'
  }

  try {
    // Guaranteed by isInstalledBinary above: execPath IS agentop, so it takes the
    // subcommand directly (no script argument to forward).
    appendFileSync(AUTO_UPGRADE_LOG, `\n=== ${new Date().toISOString()} — auto-installing v${version} ===\n`)
    const fd = openSync(AUTO_UPGRADE_LOG, 'a')
    const { spawn } = await import('node:child_process')
    const child = spawn(process.execPath, ['upgrade'], { detached: true, stdio: ['ignore', fd, fd] })
    // Detach fully: a new process group + unref so this process can exit right now.
    child.unref()
    try { closeSync(fd) } catch { /* the child kept its own dup */ }
    // Re-stamp the lock with the pid that actually does the work, so liveness tracks it.
    if (child.pid) writeFileSync(UPGRADE_LOCK_FILE, payload(child.pid))
    return 'started'
  } catch {
    try { unlinkSync(UPGRADE_LOCK_FILE) } catch { /* nothing to release */ }
    return 'failed'
  }
}

/**
 * Releases the lock on exit when THIS process owns it. Registered by runUpgrade so every
 * exit path (success, `process.exit(1)`, throw) frees the lock without extra bookkeeping.
 */
function armUpgradeLockRelease(): void {
  process.on('exit', () => {
    try {
      const lock = parseUpgradeLock(readFileSync(UPGRADE_LOCK_FILE, 'utf8'))
      if (lock?.pid === process.pid) unlinkSync(UPGRADE_LOCK_FILE)
    } catch { /* no lock (manual upgrade) or already gone */ }
  })
}

export async function runUpgrade(): Promise<void> {
  armUpgradeLockRelease()
  process.stdout.write('Checking for updates...\n')

  let info
  try {
    info = await getVersionInfo()
  } catch {
    console.error('Failed to check for updates. Check your internet connection.')
    process.exit(1)
  }

  if (!info.hasUpdate) {
    console.log(`Already on the latest version (${_GR}${_B}v${info.current}${_R}).`)
    process.exit(0)
  }

  process.stdout.write(
    `\n  ${_D}Current:${_R} ${_WH}v${info.current}${_R}\n` +
    `  ${_D}Latest: ${_R} ${_GR}${_B}v${info.latest}${_R}\n\n`,
  )
  process.stdout.write('Downloading...\n')

  let resp: Response
  try {
    resp = await fetch(DOWNLOAD_URL, {
      headers: { 'User-Agent': `agentistics/${CURRENT_VERSION}` },
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err: any) {
    console.error(`Download failed: ${err.message}`)
    process.exit(1)
  }

  if (!resp.ok) {
    console.error(`Download failed: HTTP ${resp.status}`)
    process.exit(1)
  }

  const currentBin = process.execPath
  const tmpPath = `${currentBin}.new`

  const buf = await resp.arrayBuffer()
  await Bun.write(tmpPath, buf)
  await chmod(tmpPath, 0o755)

  try {
    await rename(tmpPath, currentBin)
  } catch (err: any) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      process.stderr.write(
        `\n${_Y}Permission denied.${_R} The binary was downloaded to:\n` +
        `  ${tmpPath}\n\n` +
        `Run the following to finish the upgrade:\n` +
        `  ${_WH}sudo mv ${tmpPath} ${currentBin}${_R}\n\n`,
      )
    } else {
      await unlink(tmpPath).catch(() => {})
      console.error(`Upgrade failed: ${err.message}`)
    }
    process.exit(1)
  }

  process.stdout.write(`\n${_GR}${_B}Updated to v${info.latest}!${_R}\n\n`)

  // Auto-apply: bounce any running services so they run the new version immediately.
  process.stdout.write('Applying the update to running services…\n')
  try {
    await restartRunningServices(currentBin)
  } catch (err: any) {
    process.stderr.write(
      `\n${_Y}Could not auto-restart services: ${err?.message ?? String(err)}${_R}\n` +
      'Restart agentop manually (e.g. `agentop restart server` or `agentop central up`) to apply.\n',
    )
  }

  process.stdout.write(`\n${_GR}${_B}Done — now running v${info.latest}.${_R}\n\n`)
}
