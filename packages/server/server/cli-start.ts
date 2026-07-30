/**
 * cli-start.ts — `agentop start`, the interactive launcher.
 *
 * A re-runnable, English-by-default (pt-BR available) control panel with arrow-key navigation.
 * It shows a banner and a two-part status — CONFIG (what preferences say: solo / member→central /
 * central) and RUNNING (what's actually up: agentistics on this machine, an agentistics central
 * container, an agentistics machine container — detected live) — then lets you start
 * "agentistics" (this machine) or "agentistics central" (the aggregator), connect/disconnect from
 * a central, stop running services, or switch language. Naming: "agentistics" = the per-machine
 * app, "agentistics central" = the aggregator — never "dashboard" (both have one).
 *
 * Language follows `--lang en|pt`, else `preferences.lang` (shared with the web), else English; the
 * in-launcher toggle persists to that same preference.
 *
 * Non-interactive stdin (a pipe or a systemd unit) skips the panel and behaves like `agentop
 * server`. runStart() returns a numeric exit code or the sentinel 'foreground' (cli.ts then starts
 * the in-process server and does not exit).
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { TeamConnection } from '@agentistics/core'
import { PORT, WEB_PORT } from './config'
import { readPreferences, writePreferences } from './preferences'
import { runCentral } from './cli-central'
import { ensureArchiveModeChosen } from './cli-setup'
import { memberConnect, memberLeave } from './cli-member'
import { enableAutostart } from './autostart'
import { select, confirm, input, pause, clearScreen } from './cli-ui'
import { cliStrings, resolveLang, type CliStrings } from './cli-i18n'

export type StartResult = number | 'foreground'

// ANSI
const ESC = '\x1b'
const R = `${ESC}[0m`
const B = `${ESC}[1m`
const D = `${ESC}[2m`
const O = `${ESC}[38;5;208m`
const CY = `${ESC}[96m`
const GR = `${ESC}[92m`
const YE = `${ESC}[33m`
const WH = `${ESC}[97m`

const CENTRAL_PROJECT = 'team-mode'      // central.sh: PROJECT=${PROJECT:-team-mode}
const MACHINE_IMAGE = 'agentistics-machine' // docker-compose.machine.yml: image

// shell helpers
async function sh(cmd: string[]): Promise<{ code: number; out: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' })
    const out = await new Response(p.stdout).text()
    return { code: await p.exited, out: out.trim() }
  } catch {
    return { code: 127, out: '' }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// state + detection
type Mode = 'solo' | 'central' | 'member'

async function loadState(): Promise<{ mode: Mode; connections: TeamConnection[] }> {
  try {
    const prefs = await readPreferences()
    return { mode: prefs.team?.mode ?? 'solo', connections: prefs.team?.connections ?? [] }
  } catch {
    return { mode: 'solo', connections: [] }
  }
}

interface Services { local: boolean; central: boolean; machine: boolean }

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(600) })
    return res.ok
  } catch {
    return false
  }
}

async function dockerIds(filter: string): Promise<string[]> {
  const r = await sh(['docker', 'ps', '-q', '-f', filter])
  return r.out.split(/\s+/).filter(Boolean)
}

async function detectServices(): Promise<Services> {
  const [local, central, machine] = await Promise.all([
    isServerRunning(),
    dockerIds(`label=com.docker.compose.project=${CENTRAL_PROJECT}`).then((i) => i.length > 0),
    dockerIds(`ancestor=${MACHINE_IMAGE}`).then((i) => i.length > 0),
  ])
  return { local, central, machine }
}

// stopping

/** Parse `lsof -ti` output into a pid list, dropping blanks and the caller's OWN
 *  pid. The health check (`isServerRunning` → fetch to PORT) leaves a keep-alive
 *  client socket open, so `lsof -ti tcp:PORT` returns the CLI's own pid alongside
 *  the server's — killing the raw list SIGTERM'd the CLI itself before it could
 *  restart the server. */
export function pidsToKill(lsofOut: string, selfPid: number): string[] {
  const self = String(selfPid)
  return lsofOut.split(/\s+/).filter(Boolean).filter((pid) => pid !== self)
}

async function stopLocal(s: CliStrings): Promise<void> {
  process.stdout.write(`  ${D}${s.stoppingLocal}${R}\n`)
  // `-sTCP:LISTEN` targets only the listening server, never a client connection
  // (e.g. our own health-check socket); pidsToKill drops our pid as a safety net.
  const lsof = await sh(['lsof', '-ti', `tcp:${PORT}`, '-sTCP:LISTEN'])
  const pids = pidsToKill(lsof.out, process.pid)
  if (pids.length) { for (const pid of pids) await sh(['kill', pid]) }
  else await sh(['pkill', '-f', 'agentop server'])
  for (let i = 0; i < 20; i++) { if (!(await isServerRunning())) return; await sleep(150) }
}

async function stopContainers(filter: string, msg: string): Promise<void> {
  const ids = await dockerIds(filter)
  if (!ids.length) return
  process.stdout.write(`  ${D}${msg}${R}\n`)
  await sh(['docker', 'stop', ...ids])
}

// banner + status
function printBanner(s: CliStrings): void {
  const art = [
    '▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀ █ █▀ ▀█▀ █ █▀▀ █▀',
    '█▀█ █▄█ ██▄ █░▀█ ░█░ █ ▄█ ░█░ █ █▄▄ ▄█',
  ]
  process.stdout.write('\n')
  for (const line of art) process.stdout.write(`  ${O}${B}${line}${R}\n`)
  process.stdout.write(`  ${D}${s.tagline}${R}\n`)
}

const RULE = `  ${D}${R}`

/** 0 connections → solo (unchanged); 1 → today's exact single-line form (unchanged); N → a
 *  header line (`configMembers`) plus one `↳ endpoint[ · k repo(s) blocked]` line per connection
 *  (spec §8.1) — never collapses down to just the first connection's endpoint, which would lie
 *  about every central but one. */
function configLine(s: CliStrings, mode: Mode, connections: TeamConnection[]): string {
  if (mode === 'central') return `${CY}${s.configCentral}${R}`
  if (mode !== 'member' || connections.length === 0) return `${CY}${s.configSolo}${R}`
  if (connections.length === 1) {
    return `${CY}${s.configMember(`${WH}${connections[0]!.endpoint || '(?)'}${R}${CY}`)}${R}`
  }
  const lines = connections.map(c => {
    const suffix = c.deniedRepos.length > 0 ? s.deniedSuffix(c.deniedRepos.length) : ''
    return `  ${D}${s.configMemberLine(`${WH}${c.endpoint || '(?)'}${R}${D}`, `${D}${suffix}${R}`)}${R}`
  })
  return `${CY}${s.configMembers(connections.length)}${R}\n${lines.join('\n')}`
}

function printStatus(s: CliStrings, mode: Mode, connections: TeamConnection[], svc: Services): void {
  const config = configLine(s, mode, connections)

  const running: string[] = []
  if (svc.local) running.push(`${GR}●${R} ${s.runAgentistics}  ${D}http://localhost:${WEB_PORT}${R}`)
  if (svc.central) running.push(`${GR}●${R} ${s.runCentral}`)
  if (svc.machine) running.push(`${GR}●${R} ${s.runMachine}`)
  const runLine = running.length ? running.join(`\n           `) : `${D}○ ${s.nothingRunning}${R}`

  process.stdout.write(
    `${RULE}\n` +
    `  ${D}${s.configLabel}${R}   ${config}\n` +
    `  ${D}${s.runningLabel}${R}  ${runLine}\n` +
    `${RULE}\n`,
  )
}

// run methods
function serverReinvocation(): string {
  const script = process.argv[1]
  const fromSource = !!script && (script.endsWith('.ts') || script.endsWith('.js'))
  return fromSource ? `"${process.execPath}" "${script}" server` : `"${process.execPath}" server`
}

function startBackground(s: CliStrings): void {
  const log = join(homedir(), '.agentistics', 'agentop-server.log')
  const child = spawn('sh', ['-c', `nohup ${serverReinvocation()} >> "${log}" 2>&1 &`], { stdio: 'ignore', detached: true })
  child.unref()
  process.stdout.write(
    `\n  ${GR}${s.startedBg}${R}\n` +
    `  ${D}${s.webLabel}:${R}  ${CY}http://localhost:${WEB_PORT}${R}\n` +
    `  ${D}${s.logsLabel}:${R} ${log}\n`,
  )
}

async function startDocker(s: CliStrings): Promise<void> {
  const compose = join(process.cwd(), 'docker-compose.machine.yml')
  if (!(await Bun.file(compose).exists())) {
    process.stderr.write(`\n  ${YE}${s.noComposeFrom(process.cwd())}${R}\n  ${s.runFromRepo}\n`)
    return
  }
  process.stdout.write(`\n  ${D}${s.buildingMachine}${R}\n\n`)
  const child = spawn('docker', ['compose', '-f', compose, 'up', '-d', '--build'], { stdio: 'inherit' })
  const code = await new Promise<number>((resolve) => child.on('exit', (c) => resolve(c ?? 1)))
  if (code === 0) {
    process.stdout.write(
      `\n  ${GR}${s.containerUp}${R}\n` +
      `  ${D}${s.webLabel}:${R}  ${CY}http://localhost:${WEB_PORT}${R}\n` +
      `  ${D}${s.bootLabel}:${R} ${s.bootNote}\n`,
    )
  }
}

async function offerBoot(s: CliStrings, mode: 'server' | 'central'): Promise<void> {
  if (!(await confirm(s.confirmBoot, false))) return
  const res = await enableAutostart(mode)
  process.stdout.write('  ' + res.message.replace(/\n/g, '\n  ') + '\n')
}

async function clearPortOrAbort(s: CliStrings, localRunning: boolean): Promise<boolean> {
  if (!localRunning) return true
  process.stdout.write(`\n  ${YE}${s.alreadyRunning(`${CY}http://localhost:${WEB_PORT}${R}${YE}`)}${R}\n`)
  if (!(await confirm(s.confirmKill, false))) {
    process.stdout.write(`  ${D}${s.leftRunning}${R}\n`)
    return false
  }
  await stopLocal(s)
  return true
}

// connect / disconnect
async function connectFlow(s: CliStrings): Promise<void> {
  const endpoint = await input(s.promptEndpoint)
  const token = await input(s.promptToken)
  const org = await input(s.promptOrg, { default: 'default' })
  const label = await input(s.promptLabel)
  await memberConnect({ endpoint, token, org: org || undefined, label: label || undefined })
}

// `memberLeave` now prints its own outcome (left one / left all / still connected to N / nothing
// to leave) for every 0/1/N case — the launcher must not ALSO print a blanket "back to solo" on
// top of it, which used to be true unconditionally but is wrong the moment N > 1 and only one
// connection was left. Delegating the whole flow (including the N-connection picker) to
// `memberLeave` is deliberate — see spec §8.1 — so the launcher and the CLI can never diverge.
async function disconnectFlow(): Promise<void> {
  await memberLeave()
}

// stop submenu
async function stopMenu(s: CliStrings, svc: Services): Promise<boolean> {
  const choices: { name: string; value: string }[] = []
  if (svc.local) choices.push({ name: s.stopLocal, value: 'local' })
  if (svc.central) choices.push({ name: s.stopCentral, value: 'central' })
  if (svc.machine) choices.push({ name: s.stopMachine, value: 'machine' })
  if (choices.length > 1) choices.push({ name: s.stopEverything, value: 'all' })
  choices.push({ name: s.cancel, value: 'cancel' })

  const pick = await select({ message: s.stopWhich, choices })
  if (pick === 'cancel') return false
  if (pick === 'local' || pick === 'all') await stopLocal(s)
  if (pick === 'central' || pick === 'all') await stopContainers(`label=com.docker.compose.project=${CENTRAL_PROJECT}`, s.stoppingCentral)
  if (pick === 'machine' || pick === 'all') await stopContainers(`ancestor=${MACHINE_IMAGE}`, s.stoppingMachine)
  return true
}

// "agentistics" (this machine) → how to run
async function runAgentistics(s: CliStrings, localRunning: boolean): Promise<StartResult | 'handled'> {
  const how = await select<string>({
    message: s.howTitle,
    choices: [
      { name: s.foreground, value: 'fg', hint: s.foregroundHint },
      { name: s.background, value: 'bg', hint: s.backgroundHint },
      { name: s.docker, value: 'docker', hint: s.dockerHint },
      { name: s.back, value: 'back' },
    ],
  })
  if (how === 'back') return 'handled'
  if (how === 'fg') {
    if (!(await clearPortOrAbort(s, localRunning))) return 'handled'
    // First-run: pick how history is preserved before the server starts (CLI mirror of the
    // web consent gate). No-op once chosen. The Docker path uses the web gate instead.
    await ensureArchiveModeChosen()
    return 'foreground'
  }
  if (how === 'bg') {
    if (!(await clearPortOrAbort(s, localRunning))) return 'handled'
    await ensureArchiveModeChosen()
    startBackground(s)
    await offerBoot(s, 'server')
    await pause(s.pauseMsg)
    return 'handled'
  }
  // docker
  await startDocker(s)
  await pause(s.pauseMsg)
  return 'handled'
}

// restart (per-service helpers)
// `rebuild` (from `--rebuild`) recreates Docker images/containers instead of just bouncing them.
/** Rebuild + reinstall the native binary from the repo (`bun run bin`: web build → embed assets →
 *  compile → install to ~/.local/bin/agentop). Returns 'not-repo' when not run from a checkout. */
export async function rebuildNativeBinary(): Promise<'built' | 'not-repo' | 'failed'> {
  const inRepo = await Bun.file(join(process.cwd(), 'packages/server/bin/cli.ts')).exists()
  if (!inRepo) return 'not-repo'
  const child = spawn('bun', ['run', 'bin'], { cwd: process.cwd(), stdio: 'inherit' })
  const code = await new Promise<number>(resolve => child.on('exit', c => resolve(c ?? 1)))
  return code === 0 ? 'built' : 'failed'
}

async function restartLocalSvc(s: CliStrings, rebuild = false): Promise<void> {
  // With --rebuild, actually rebuild the native binary (web + embedded assets) so the restart
  // serves the new frontend/code — not just bounce the old build. Needs the repo checkout.
  if (rebuild) {
    process.stdout.write(`  ${D}${s.rebuildingLocal}${R}\n`)
    const r = await rebuildNativeBinary()
    if (r === 'not-repo') process.stderr.write(`  ${YE}${s.localRebuildHint}${R}\n`)
    else if (r === 'failed') process.stderr.write(`  ${YE}${s.localRebuildFailed}${R}\n`)
  }
  process.stdout.write(`  ${D}${s.restartingLocal}${R}\n`)
  await stopLocal(s)
  startBackground(s)
}
async function restartCentralSvc(s: CliStrings, rebuild = false): Promise<void> {
  process.stdout.write(`  ${D}${rebuild ? s.rebuildingCentral : s.restartingCentral}${R}\n`)
  // `up` rebuilds/pulls the image and recreates; `restart` just bounces the running container.
  await runCentral(rebuild ? 'up' : 'restart', [])
}
async function restartMachineSvc(s: CliStrings, rebuild = false): Promise<void> {
  process.stdout.write(`  ${D}${rebuild ? s.rebuildingMachine : s.restartingMachine}${R}\n`)
  if (rebuild) {
    const compose = join(process.cwd(), 'docker-compose.machine.yml')
    if (await Bun.file(compose).exists()) {
      const child = spawn('docker', ['compose', '-f', compose, 'up', '-d', '--build'], { stdio: 'inherit' })
      await new Promise<void>((resolve) => child.on('exit', () => resolve()))
      return
    }
    process.stderr.write(`  ${YE}${s.noComposeFrom(process.cwd())}${R}\n`)
    // fall through to a plain restart so the machine still comes back up
  }
  const ids = await dockerIds(`ancestor=${MACHINE_IMAGE}`)
  if (ids.length) await sh(['docker', 'restart', ...ids])
}

/** Restart every service currently up. `rebuild` recreates Docker images (central + machine). */
async function restartRunning(s: CliStrings, svc: Services, rebuild = false): Promise<boolean> {
  if (!(svc.local || svc.central || svc.machine)) return false
  if (svc.local) await restartLocalSvc(s, rebuild)
  if (svc.central) await restartCentralSvc(s, rebuild)
  if (svc.machine) await restartMachineSvc(s, rebuild)
  process.stdout.write(`\n  ${GR}${s.restartedAll}${R}\n`)
  return true
}

// restart submenu (pick one running service, or all)
async function restartMenu(s: CliStrings, svc: Services): Promise<boolean> {
  const choices: { name: string; value: string }[] = []
  if (svc.local) choices.push({ name: s.stopLocal, value: 'local' })
  if (svc.central) choices.push({ name: s.stopCentral, value: 'central' })
  if (svc.machine) choices.push({ name: s.stopMachine, value: 'machine' })
  if (choices.length > 1) choices.push({ name: s.stopEverything, value: 'all' })
  choices.push({ name: s.cancel, value: 'cancel' })

  const pick = await select({ message: s.restartWhich, choices })
  if (pick === 'cancel') return false
  if (pick === 'all') return restartRunning(s, svc)
  if (pick === 'local') await restartLocalSvc(s)
  if (pick === 'central') await restartCentralSvc(s)
  if (pick === 'machine') await restartMachineSvc(s)
  process.stdout.write(`\n  ${GR}${s.restartedDone}${R}\n`)
  return true
}

/** Non-interactive `agentop restart --all [--rebuild]`: bounce (or rebuild) every running
 *  service. Returns an exit code. */
export async function restartAllServices(rebuild = false): Promise<number> {
  const s = cliStrings(await resolveLang())
  const svc = await detectServices()
  if (!(svc.local || svc.central || svc.machine)) {
    process.stdout.write(`  ${D}○ ${s.nothingRunning}${R}\n`)
    return 0
  }
  await restartRunning(s, svc, rebuild)
  return 0
}

// main loop
export async function runStart(): Promise<StartResult> {
  if (!process.stdin.isTTY) return 'foreground'

  let lang = await resolveLang()

  for (;;) {
    const s = cliStrings(lang)
    const { mode, connections } = await loadState()
    const svc = await detectServices()
    const anyRunning = svc.local || svc.central || svc.machine

    clearScreen()
    printBanner(s)
    printStatus(s, mode, connections, svc)

    const choices: { name: string; value: string; hint?: string }[] = [
      { name: s.itemAgentistics, value: 'agentistics', hint: s.itemAgentisticsHint },
      { name: s.itemCentral, value: 'central', hint: s.itemCentralHint },
    ]
    // ADDITIVE, not either/or: with N ≥ 1 connections, Connect must still be reachable (a second,
    // third… central), relabelled as "add another" once at least one exists. Leaving this as an
    // if/else (only ever showing ONE of the two) makes a second central unreachable from the
    // launcher — this was the single highest-risk line in the multi-central rewrite.
    choices.push({
      name: connections.length > 0 ? s.itemConnectMore : s.itemConnect,
      value: 'connect',
      // The relabelled "add another central" item keeps its own hint, not the original
      // "become a member" framing — the machine is already a member at that point.
      hint: connections.length > 0 ? s.itemConnectMoreHint : s.itemConnectHint,
    })
    if (connections.length > 0) {
      choices.push({
        name: s.itemDisconnect,
        value: 'disconnect',
        hint: connections.length > 1 ? s.itemDisconnectMultiHint : s.itemDisconnectHint,
      })
    }
    if (anyRunning) choices.push({ name: s.itemRestart, value: 'restart', hint: s.itemRestartHint })
    if (anyRunning) choices.push({ name: s.itemStop, value: 'stop' })
    choices.push({ name: s.itemLanguage, value: 'language' })
    choices.push({ name: s.quit, value: 'quit' })

    const action = await select({ message: s.menuTitle, choices })

    let acted = false
    switch (action) {
      case 'agentistics': {
        const r = await runAgentistics(s, svc.local)
        if (r === 'foreground') return 'foreground'
        // 'handled' → the submenu already paused where needed; just redraw.
        break
      }
      case 'central': {
        const code = await runCentral('up', [])
        if (code === 0) await offerBoot(s, 'central')
        acted = true
        break
      }
      case 'connect':
        await connectFlow(s)
        acted = true
        break
      case 'disconnect':
        await disconnectFlow()
        acted = true
        break
      case 'restart':
        acted = await restartMenu(s, svc)
        break
      case 'stop':
        acted = await stopMenu(s, svc)
        break
      case 'language':
        lang = lang === 'en' ? 'pt' : 'en'
        try { await writePreferences({ lang }) } catch { /* best-effort */ }
        break
      case 'quit':
        return 0
    }
    if (acted) await pause(s.pauseMsg)
  }
}
