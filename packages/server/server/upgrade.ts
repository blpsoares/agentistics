import { rename, chmod, unlink } from 'fs/promises'
import { platform } from 'os'
import { join } from 'path'
import { getVersionInfo, CURRENT_VERSION } from './version.ts'
import { restartAutostart } from './autostart.ts'

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

export async function runUpgrade(): Promise<void> {
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
