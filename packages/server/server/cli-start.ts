/**
 * cli-start.ts — `agentop start`, the interactive launcher.
 *
 * A re-runnable control panel: it prints a banner + live status (current mode, whether a server
 * is already running), then lists what you can do. Starting a server that's already up isn't
 * silently duplicated — it warns and offers to kill + restart. Non-interactive stdin (a pipe or a
 * systemd unit) skips all of this and behaves exactly like `agentop server`, so the same command
 * works in scripts and services.
 *
 * runStart() returns a numeric exit code, or the sentinel 'foreground' meaning "the caller should
 * start the in-process server and NOT exit" (so cli.ts keeps the Bun.serve alive).
 */

import { createInterface, type Interface } from 'readline'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { PORT, WEB_PORT } from './config'
import { readPreferences } from './preferences'
import { runSetup } from './cli-setup'
import { runCentral } from './cli-central'
import { enableAutostart } from './autostart'

export type StartResult = number | 'foreground'

// ── ANSI ────────────────────────────────────────────────────────────────────
const ESC = '\x1b'
const R = `${ESC}[0m`
const B = `${ESC}[1m`
const D = `${ESC}[2m`
const O = `${ESC}[38;5;208m` // Anthropic orange
const CY = `${ESC}[96m`
const GR = `${ESC}[92m`
const YE = `${ESC}[33m`
const WH = `${ESC}[97m`

// ── readline helpers ──────────────────────────────────────────────────────────
function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())))
}

/** One-shot prompt: open a readline, ask, close. Ctrl-C aborts the whole launcher cleanly. */
async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => { process.stdout.write('\n'); rl.close(); process.exit(130) })
  try {
    return await ask(rl, question)
  } finally {
    rl.close()
  }
}
function isYes(a: string): boolean { return /^y(es)?$/i.test(a.trim()) }

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

// ── state ─────────────────────────────────────────────────────────────────────
type Mode = 'solo' | 'central' | 'member'

async function loadState(): Promise<{ mode: Mode; endpoint?: string }> {
  try {
    const prefs = await readPreferences()
    return { mode: prefs.team?.mode ?? 'solo', endpoint: prefs.team?.endpoint }
  } catch {
    return { mode: 'solo' }
  }
}

/** Is a local agentop server already answering on the api port? */
async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(600) })
    return res.ok
  } catch {
    return false
  }
}

/** Kill whatever holds the api port (by pid), falling back to a name match; wait for it to free. */
async function stopServer(): Promise<void> {
  process.stdout.write(`  ${D}stopping the running server…${R}\n`)
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

/**
 * A start action was chosen. If a server is already up, warn and offer to kill + restart.
 * Returns true when it's safe to proceed (nothing running, or the user agreed to kill).
 */
async function clearPortOrAbort(running: boolean): Promise<boolean> {
  if (!running) return true
  process.stdout.write(
    `\n  ${YE}A server is already running${R} on ${CY}http://localhost:${WEB_PORT}${R}.\n`,
  )
  if (!isYes(await prompt(`  Kill it and start fresh? [y/N]: `))) {
    process.stdout.write(`  ${D}left the running server as-is.${R}\n`)
    return false
  }
  await stopServer()
  return true
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

function printStatus(mode: Mode, endpoint: string | undefined, running: boolean): void {
  const modeLabel =
    mode === 'member' ? `member ${D}→ ${endpoint ?? '(no endpoint)'}${R}${CY}` :
    mode === 'central' ? 'central' :
    `solo ${D}(nothing leaves this machine)${R}`
  const server = running
    ? `${GR}● running${R} ${D}web http://localhost:${WEB_PORT}${R}`
    : `${D}○ not running${R}`
  process.stdout.write(
    `  ${D}────────────────────────────────────${R}\n` +
    `  ${D}mode${R}    ${CY}${modeLabel}${R}\n` +
    `  ${D}server${R}  ${server}\n` +
    `  ${D}────────────────────────────────────${R}\n`,
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
      `  ${D}stop:${R} docker compose -f docker-compose.machine.yml down\n`,
    )
  }
}

// ── menus (numbered; each returns the chosen action key) ─────────────────────────
async function soloMemberMenu(running: boolean): Promise<string> {
  process.stdout.write(
    `\n  ${B}What would you like to do?${R}\n` +
    `    ${O}1${R}) Start — foreground ${D}(this terminal)${R}\n` +
    `    ${O}2${R}) Start — background ${D}(detached)${R}\n` +
    `    ${O}3${R}) Start — Docker ${D}(container)${R}\n` +
    `    ${O}4${R}) Autostart — install a boot service\n` +
    `    ${O}5${R}) Reconfigure mode ${D}(solo / central / member)${R}\n` +
    (running ? `    ${O}6${R}) Stop the running server\n` : '') +
    `    ${O}0${R}) Quit\n\n`,
  )
  return prompt(`  ${D}choose${R} [1]: `)
}

async function centralMenu(running: boolean): Promise<string> {
  process.stdout.write(
    `\n  ${B}What would you like to do?${R}\n` +
    `    ${O}1${R}) Start / rebuild the central ${D}(Docker)${R}\n` +
    `    ${O}2${R}) Autostart — start the central on boot\n` +
    `    ${O}3${R}) Reconfigure mode ${D}(solo / central / member)${R}\n` +
    (running ? `    ${O}4${R}) Stop the central\n` : '') +
    `    ${O}0${R}) Quit\n\n`,
  )
  return prompt(`  ${D}choose${R} [1]: `)
}

// ── main loop ─────────────────────────────────────────────────────────────────
export async function runStart(): Promise<StartResult> {
  // Piped / systemd / non-interactive: just be the server.
  if (!process.stdin.isTTY) return 'foreground'

  // Re-runnable control panel. Terminal actions (foreground start, quit) return; everything else
  // loops back so the refreshed status reflects what just happened.
  for (;;) {
    const { mode, endpoint } = await loadState()
    const running = await isServerRunning()
    printBanner()
    printStatus(mode, endpoint, running)

    if (mode === 'central') {
      const choice = await centralMenu(running)
      switch (choice) {
        case '': case '1': {
          const code = await runCentral('up', [])
          if (code !== 0) return code
          break
        }
        case '2': {
          const res = await enableAutostart('central')
          process.stdout.write('\n  ' + res.message.replace(/\n/g, '\n  ') + '\n')
          break
        }
        case '3': await runSetup(); break
        case '4': if (running) await runCentral('down', []); break
        case '0': case 'q': return 0
        default: process.stdout.write(`  ${YE}unrecognized choice.${R}\n`)
      }
      continue
    }

    // solo / member
    const choice = await soloMemberMenu(running)
    switch (choice) {
      case '': case '1': // foreground
        if (!(await clearPortOrAbort(running))) break
        return 'foreground'
      case '2': // background
        if (!(await clearPortOrAbort(running))) break
        startBackground()
        break
      case '3': // docker
        if (!(await clearPortOrAbort(running))) break
        await startDocker()
        break
      case '4': { // autostart
        const res = await enableAutostart('server')
        process.stdout.write('\n  ' + res.message.replace(/\n/g, '\n  ') + '\n')
        break
      }
      case '5': await runSetup(); break
      case '6': if (running) await stopServer(); break
      case '0': case 'q': return 0
      default: process.stdout.write(`  ${YE}unrecognized choice.${R}\n`)
    }
  }
}
