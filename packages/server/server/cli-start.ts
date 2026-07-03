/**
 * cli-start.ts — `agentop start`, the interactive launcher.
 *
 * One command to bring a machine up. It reads the current mode, optionally lets you reconfigure
 * (reusing the setup wizard), then asks HOW to run: foreground, background, Docker, or installed
 * as a boot service. A central is started via its Docker flow. Non-interactive stdin (a pipe or a
 * systemd unit) skips every prompt and behaves exactly like `agentop server` — so the same command
 * works in scripts and services.
 *
 * runStart() returns either a numeric exit code, or the sentinel 'foreground' meaning "the caller
 * should start the in-process server and NOT exit" (so cli.ts keeps the Bun.serve alive).
 */

import { createInterface, type Interface } from 'readline'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readPreferences } from './preferences'
import { runSetup } from './cli-setup'
import { runCentral } from './cli-central'
import { enableAutostart } from './autostart'

export type StartResult = number | 'foreground'

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())))
}
function isYes(a: string): boolean { return /^y(es)?$/i.test(a.trim()) }

async function currentMode(): Promise<'solo' | 'central' | 'member'> {
  try {
    const prefs = await readPreferences()
    return prefs.team?.mode ?? 'solo'
  } catch {
    return 'solo'
  }
}

/**
 * Command that re-invokes agentop's `server`. From the compiled binary this is just
 * `<agentop> server`; from source (`bun cli.ts start`) it's `<bun> <cli.ts> server`.
 */
function serverReinvocation(): string {
  const script = process.argv[1]
  const fromSource = !!script && (script.endsWith('.ts') || script.endsWith('.js'))
  return fromSource
    ? `"${process.execPath}" "${script}" server`
    : `"${process.execPath}" server`
}

/** Spawn the server detached (nohup + &), logging to ~/.agentistics/agentop-server.log. */
function startBackground(): number {
  const log = join(homedir(), '.agentistics', 'agentop-server.log')
  const child = spawn('sh', ['-c', `nohup ${serverReinvocation()} >> "${log}" 2>&1 &`], {
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  process.stdout.write(
    `\nStarted agentop in the background.\n` +
    `  web:  http://localhost:47292\n` +
    `  logs: ${log}\n` +
    `  stop: pkill -f "agentop server"\n`,
  )
  return 0
}

/** Build + run the machine container via docker-compose.machine.yml (must run from the repo). */
async function startDocker(): Promise<number> {
  const compose = join(process.cwd(), 'docker-compose.machine.yml')
  if (!(await Bun.file(compose).exists())) {
    process.stderr.write(
      `\nCouldn't find docker-compose.machine.yml in ${process.cwd()}.\n` +
      `Run \`agentop start\` from the agentistics repo to use the Docker option, or start natively instead.\n`,
    )
    return 1
  }
  process.stdout.write('\nBuilding and starting the machine container…\n\n')
  const child = spawn('docker', ['compose', '-f', compose, 'up', '-d', '--build'], { stdio: 'inherit' })
  const code = await new Promise<number>((resolve) => child.on('exit', (c) => resolve(c ?? 1)))
  if (code === 0) {
    process.stdout.write(
      `\nMachine container is up.\n` +
      `  web:  http://localhost:47292\n` +
      `  logs: docker compose -f docker-compose.machine.yml logs -f\n` +
      `  stop: docker compose -f docker-compose.machine.yml down\n`,
    )
  }
  return code
}

/** Start-a-central flow: bounce/build the Docker service and optionally install it at boot. */
async function startCentral(): Promise<StartResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let up = true
  let boot = false
  try {
    const a = await ask(rl, '\nStart the central now (Docker build + up)? [Y/n]: ')
    up = a === '' || isYes(a)
    if (up) boot = isYes(await ask(rl, 'Also start it on boot? [y/N]: '))
  } finally {
    rl.close() // central.sh owns stdin for its own prompts
  }
  if (!up) return 0
  const code = await runCentral('up', [])
  if (code === 0 && boot) {
    const res = await enableAutostart('central')
    process.stdout.write('\n' + res.message + '\n')
  }
  return code
}

/** Ask how to run a solo/member machine and do it. Opens its own readline. */
async function runChoices(mode: 'solo' | 'member'): Promise<StartResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => { process.stdout.write('\nCancelled — nothing started.\n'); rl.close(); process.exit(130) })

  let choice: string
  try {
    process.stdout.write(`\nHow do you want to run this ${mode} machine?\n`)
    process.stdout.write('  1) foreground   — in this terminal\n')
    process.stdout.write('  2) background    — detached, logs to a file\n')
    process.stdout.write('  3) docker        — build & run this machine in a container\n')
    process.stdout.write('  4) autostart     — install a boot service (systemd) and start it\n\n')
    choice = (await ask(rl, 'Choose [1]: ')) || '1'
  } finally {
    rl.close()
  }

  switch (choice) {
    case '1': case 'foreground':
      return 'foreground'
    case '2': case 'background':
      return startBackground()
    case '3': case 'docker':
      return await startDocker()
    case '4': case 'autostart': {
      const res = await enableAutostart('server')
      process.stdout.write('\n' + res.message + '\n')
      return res.ok ? 0 : 1
    }
    default:
      process.stderr.write(`\nUnrecognized choice: ${choice}. Run \`agentop start\` again.\n`)
      return 1
  }
}

/**
 * Run the interactive launcher. Non-TTY stdin → 'foreground' immediately (be `agentop server`).
 * Never throws. Ctrl-C aborts without starting anything.
 */
export async function runStart(): Promise<StartResult> {
  // Piped / systemd / non-interactive: just be the server.
  if (!process.stdin.isTTY) return 'foreground'

  let mode = await currentMode()

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => { process.stdout.write('\nCancelled — nothing started.\n'); rl.close(); process.exit(130) })
  let reconfigure = false
  try {
    process.stdout.write(`\nagentop start\n  current mode: ${mode}\n\n`)
    const prompt = mode === 'solo'
      ? 'Set up team mode (central / member) first? [y/N]: '
      : 'Reconfigure the mode first? [y/N]: '
    reconfigure = isYes(await ask(rl, prompt))
  } finally {
    rl.close() // release stdin before delegating to the setup wizard / run flows
  }

  if (reconfigure) {
    const code = await runSetup()
    if (code !== 0) return code
    mode = await currentMode()
  }

  if (mode === 'central') return await startCentral()
  return await runChoices(mode)
}
