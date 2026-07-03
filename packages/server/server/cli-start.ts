/**
 * cli-start.ts — `agentop start`, the interactive launcher.
 *
 * A re-runnable control panel with arrow-key navigation (see cli-ui.ts). It prints a banner and a
 * two-part status — CONFIG (what your preferences say: solo / member → central / central) and
 * RUNNING (what's actually up right now: the native server, a central container, a machine
 * container) — then a menu of actions. Starting a native server that's already up offers to kill +
 * restart; Stop lists the running services and lets you pick which to take down (or all).
 *
 * Non-interactive stdin (a pipe or a systemd unit) skips the panel and behaves exactly like
 * `agentop server`, so the same command works in scripts and services.
 *
 * runStart() returns a numeric exit code, or the sentinel 'foreground' meaning "the caller should
 * start the in-process server and NOT exit" (so cli.ts keeps the Bun.serve alive).
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { PORT, WEB_PORT } from './config'
import { readPreferences } from './preferences'
import { runSetup } from './cli-setup'
import { runCentral } from './cli-central'
import { enableAutostart } from './autostart'
import { select, confirm, pause, clearScreen } from './cli-ui'

export type StartResult = number | 'foreground'

// ── ANSI ────────────────────────────────────────────────────────────────────
const ESC = '\x1b'
const R = `${ESC}[0m`
const B = `${ESC}[1m`
const D = `${ESC}[2m`
const O = `${ESC}[38;5;208m`
const CY = `${ESC}[96m`
const GR = `${ESC}[92m`
const YE = `${ESC}[33m`
const WH = `${ESC}[97m`

// The default docker-compose project name of the central (central.sh: PROJECT=${PROJECT:-team-mode})
// and the machine container's image tag (docker-compose.machine.yml: image: agentistics-machine).
const CENTRAL_PROJECT = 'team-mode'
const MACHINE_IMAGE = 'agentistics-machine'

// ── shell helper ──────────────────────────────────────────────────────────────
async function sh(cmd: string[]): Promise<{ code: number; out: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' })
    const out = await new Response(p.stdout).text()
    const code = await p.exited
    return { code, out: out.trim() }
  } catch {
    return { code: 127, out: '' }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── state + service detection ────────────────────────────────────────────────
type Mode = 'solo' | 'central' | 'member'

async function loadState(): Promise<{ mode: Mode; endpoint?: string }> {
  try {
    const prefs = await readPreferences()
    return { mode: prefs.team?.mode ?? 'solo', endpoint: prefs.team?.endpoint }
  } catch {
    return { mode: 'solo' }
  }
}

interface Services {
  local: boolean   // native agentop server answering on the api port
  central: boolean // a central container (docker compose project) is up
  machine: boolean // a machine container (agentistics-machine image) is up
}

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(600) })
    return res.ok
  } catch {
    return false
  }
}

/** Container ids matching a `docker ps` filter (empty when docker is absent or none match). */
async function dockerIds(filter: string): Promise<string[]> {
  const r = await sh(['docker', 'ps', '-q', '-f', filter])
  return r.out.split(/\s+/).filter(Boolean)
}

async function detectServices(): Promise<Services> {
  const [local, central, machine] = await Promise.all([
    isServerRunning(),
    dockerIds(`label=com.docker.compose.project=${CENTRAL_PROJECT}`).then((ids) => ids.length > 0),
    dockerIds(`ancestor=${MACHINE_IMAGE}`).then((ids) => ids.length > 0),
  ])
  return { local, central, machine }
}

// ── stopping ────────────────────────────────────────────────────────────────
/** Kill whatever native process holds the api port (by pid, then by name); wait for it to free. */
async function stopLocal(): Promise<void> {
  process.stdout.write(`  ${D}stopping the local server…${R}\n`)
  const lsof = await sh(['lsof', '-ti', `tcp:${PORT}`])
  const pids = lsof.out.split(/\s+/).filter(Boolean)
  if (pids.length) {
    for (const pid of pids) await sh(['kill', pid])
  } else {
    await sh(['pkill', '-f', 'agentop server'])
  }
  for (let i = 0; i < 20; i++) {
    if (!(await isServerRunning())) return
    await sleep(150)
  }
}

async function stopContainers(filter: string, label: string): Promise<void> {
  const ids = await dockerIds(filter)
  if (!ids.length) return
  process.stdout.write(`  ${D}stopping ${label}…${R}\n`)
  await sh(['docker', 'stop', ...ids])
}

// ── banner + status ────────────────────────────────────────────────────────────
function printBanner(): void {
  const art = [
    '▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀ █ █▀ ▀█▀ █ █▀▀ █▀',
    '█▀█ █▄█ ██▄ █░▀█ ░█░ █ ▄█ ░█░ █ █▄▄ ▄█',
  ]
  process.stdout.write('\n')
  for (const line of art) process.stdout.write(`  ${O}${B}${line}${R}\n`)
  process.stdout.write(`  ${D}AI coding-assistant analytics · agentop${R}\n`)
}

const RULE = `  ${D}──────────────────────────────────────${R}`

function printStatus(mode: Mode, endpoint: string | undefined, svc: Services): void {
  const config =
    mode === 'member'
      ? `${CY}member${R} ${D}— sends metrics to a central at${R} ${WH}${endpoint ?? '(no endpoint set)'}${R}`
      : mode === 'central'
        ? `${CY}central${R} ${D}— this machine hosts the team central${R}`
        : `${CY}solo${R} ${D}— nothing leaves this machine${R}`

  const running: string[] = []
  if (svc.local) running.push(`${GR}●${R} local server  ${D}http://localhost:${WEB_PORT}${R}`)
  if (svc.central) running.push(`${GR}●${R} central       ${D}(docker)${R}`)
  if (svc.machine) running.push(`${GR}●${R} machine       ${D}(docker)${R}`)
  const runningLine = running.length ? running.join(`\n           `) : `${D}○ nothing running${R}`

  process.stdout.write(
    `${RULE}\n` +
    `  ${D}config${R}   ${config}\n` +
    `  ${D}running${R}  ${runningLine}\n` +
    `${RULE}\n`,
  )
}

// ── run methods ─────────────────────────────────────────────────────────────────
/** Command that re-invokes agentop's `server` (binary → `<agentop> server`; source → `<bun> <cli> server`). */
function serverReinvocation(): string {
  const script = process.argv[1]
  const fromSource = !!script && (script.endsWith('.ts') || script.endsWith('.js'))
  return fromSource ? `"${process.execPath}" "${script}" server` : `"${process.execPath}" server`
}

function startBackground(): void {
  const log = join(homedir(), '.agentistics', 'agentop-server.log')
  const child = spawn('sh', ['-c', `nohup ${serverReinvocation()} >> "${log}" 2>&1 &`], {
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  process.stdout.write(
    `\n  ${GR}started in the background.${R}\n` +
    `  ${D}web:${R}  ${CY}http://localhost:${WEB_PORT}${R}\n` +
    `  ${D}logs:${R} ${log}\n`,
  )
}

async function startDocker(): Promise<void> {
  const compose = join(process.cwd(), 'docker-compose.machine.yml')
  if (!(await Bun.file(compose).exists())) {
    process.stderr.write(
      `\n  ${YE}couldn't find docker-compose.machine.yml${R} in ${process.cwd()}.\n` +
      `  Run ${WH}agentop start${R} from the agentistics repo to use Docker.\n`,
    )
    return
  }
  process.stdout.write(`\n  ${D}building & starting the machine container…${R}\n\n`)
  const child = spawn('docker', ['compose', '-f', compose, 'up', '-d', '--build'], { stdio: 'inherit' })
  const code = await new Promise<number>((resolve) => child.on('exit', (c) => resolve(c ?? 1)))
  if (code === 0) {
    process.stdout.write(
      `\n  ${GR}machine container is up.${R}\n` +
      `  ${D}web:${R}  ${CY}http://localhost:${WEB_PORT}${R}\n` +
      `  ${D}boot:${R} it already restarts with Docker (restart: unless-stopped)\n`,
    )
  }
}

/** After a background/central start, offer to also persist across reboots (systemd user service). */
async function offerBoot(mode: 'server' | 'central'): Promise<void> {
  if (!(await confirm('Also start it on every boot (systemd service)?', false))) return
  const res = await enableAutostart(mode)
  process.stdout.write('  ' + res.message.replace(/\n/g, '\n  ') + '\n')
}

/** A native start was chosen while a server is already up: offer to kill + restart. */
async function clearPortOrAbort(localRunning: boolean): Promise<boolean> {
  if (!localRunning) return true
  process.stdout.write(`\n  ${YE}A server is already running${R} on ${CY}http://localhost:${WEB_PORT}${R}.\n`)
  if (!(await confirm('Kill it and start fresh?', false))) {
    process.stdout.write(`  ${D}left the running server as-is.${R}\n`)
    return false
  }
  await stopLocal()
  return true
}

// ── Stop submenu ───────────────────────────────────────────────────────────────
async function stopMenu(svc: Services): Promise<boolean> {
  const choices: { name: string; value: string }[] = []
  if (svc.local) choices.push({ name: `Local server ${D}(:${WEB_PORT})${R}`, value: 'local' })
  if (svc.central) choices.push({ name: `Central ${D}(docker)${R}`, value: 'central' })
  if (svc.machine) choices.push({ name: `Machine ${D}(docker)${R}`, value: 'machine' })
  if (choices.length > 1) choices.push({ name: 'Everything', value: 'all' })
  choices.push({ name: 'Cancel', value: 'cancel' })

  const pick = await select({ message: 'Stop which?', choices })
  if (pick === 'cancel') return false
  if (pick === 'local' || pick === 'all') await stopLocal()
  if (pick === 'central' || pick === 'all') await stopContainers(`label=com.docker.compose.project=${CENTRAL_PROJECT}`, 'the central container')
  if (pick === 'machine' || pick === 'all') await stopContainers(`ancestor=${MACHINE_IMAGE}`, 'the machine container')
  return true
}

// ── main loop ─────────────────────────────────────────────────────────────────
export async function runStart(): Promise<StartResult> {
  // Piped / systemd / non-interactive: just be the server.
  if (!process.stdin.isTTY) return 'foreground'

  for (;;) {
    const { mode, endpoint } = await loadState()
    const svc = await detectServices()
    const anyRunning = svc.local || svc.central || svc.machine

    // Redraw the panel in place each iteration so navigating back never stacks copies.
    clearScreen()
    printBanner()
    printStatus(mode, endpoint, svc)

    // Build the action menu from the current config + what's running.
    const choices: { name: string; value: string; hint?: string }[] = []
    if (mode === 'central') {
      choices.push({ name: 'Start / rebuild the central', value: 'central-up', hint: 'Docker' })
    } else {
      choices.push({ name: 'Start the dashboard — foreground', value: 'fg', hint: 'this terminal' })
      choices.push({ name: 'Start the dashboard — background', value: 'bg', hint: 'detached' })
    }
    choices.push({ name: 'Run this machine in Docker', value: 'docker', hint: 'container' })
    choices.push({ name: 'Reconfigure mode', value: 'reconfigure', hint: 'solo / central / member' })
    if (anyRunning) choices.push({ name: 'Stop a running service…', value: 'stop' })
    choices.push({ name: 'Quit', value: 'quit' })

    const action = await select({ message: 'What would you like to do?', choices })

    // `acted` = the action produced output worth reading before the panel redraws → pause first.
    let acted = false
    switch (action) {
      case 'fg':
        if (!(await clearPortOrAbort(svc.local))) break
        return 'foreground'
      case 'bg':
        if (!(await clearPortOrAbort(svc.local))) break
        startBackground()
        await offerBoot('server')
        acted = true
        break
      case 'central-up': {
        const code = await runCentral('up', [])
        if (code === 0) await offerBoot('central')
        acted = true
        break
      }
      case 'docker':
        await startDocker()
        acted = true
        break
      case 'reconfigure':
        await runSetup()
        acted = true
        break
      case 'stop':
        acted = await stopMenu(svc)
        break
      case 'quit':
        return 0
    }
    if (acted) await pause()
  }
}
