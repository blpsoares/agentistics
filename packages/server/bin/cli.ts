#!/usr/bin/env bun
/**
 * agentop — AI agent usage dashboard
 *
 * Single entry point for the compiled binary.
 */

const command = process.argv[2]
const args = process.argv.slice(3)

/**
 * Load a central env file (KEY=VALUE) into process.env for keys not already set, so a NATIVE
 * central (no Docker) picks up MONGO_URL + the AGENTISTICS_TEAM_* secrets the same way the Docker
 * central reads central.env. Search order: $AGENTISTICS_CENTRAL_ENV, ./central.env,
 * ~/.agentistics/central.env. Values are trimmed (a stray space in `MONGO_URL= mongodb+srv…` would
 * otherwise break the driver). Never throws.
 */
function loadCentralEnv(): string | null {
  try {
    const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const { homedir } = require('node:os') as typeof import('node:os')
    const candidates = [
      process.env.AGENTISTICS_CENTRAL_ENV,
      join(process.cwd(), 'central.env'),
      join(homedir(), '.agentistics', 'central.env'),
    ].filter((p): p is string => !!p)
    const file = candidates.find(p => existsSync(p))
    if (!file) return null
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 0) continue
      const key = t.slice(0, eq).trim()
      const value = t.slice(eq + 1).trim()
      if (key && process.env[key] === undefined) process.env[key] = value
    }
    return file
  } catch {
    return null
  }
}

const HELP = `
Usage: agentop <command> [options]

Commands:
  start         Interactive launcher — pick mode + how to run (foreground/bg/docker/boot)
  setup         Interactive first-run wizard (solo / central / member)
  server        Start the web dashboard + background daemon (non-interactive)
                (add --central to run the team central natively, no Docker; --bg to detach)
  restart       Restart a running mode's service so it picks up new code/config
  status        Show services (server/central/member) + health
  tui           Start the live terminal dashboard (standalone)
  watch         Start the background metrics daemon only
  central       Manage the team central (Docker; runs from anywhere)
  member        Configure this machine as a team member
  upgrade       Upgrade agentop to the latest version
  autostart     Start a mode with the system (systemd user service on Linux)
  check-update  Print a notice if a newer version is available (else silent)

Options:
  --help, -h       Show this help message
  --version, -v    Show current version
  --port <n>       Port for the web server (default: 47291)  [server only]
  --central        Run as the team central natively (no Docker) — reads central.env for
                   MONGO_URL + secrets; requires an external MONGO_URL (Atlas/mongod)  [server only]
  --bg             Start detached in the background (logs to ~/.agentistics)  [server only]

Native central (no Docker):
  agentop server --central [--bg] [--port <n>]
    Runs the same server process with AGENTISTICS_TEAM_CENTRAL=1, loading central.env
    (search: $AGENTISTICS_CENTRAL_ENV, ./central.env, ~/.agentistics/central.env). There is no
    bundled Mongo — set MONGO_URL to an external cluster. Use --bg to run in the background like
    the local server. For the all-in-one Docker flow (bundled Mongo) use \`agentop central up\`.

Start:
  agentop start
    Interactive launcher. Shows the current mode, offers to (re)configure, then asks
    how to run: foreground, background (detached), Docker, or a boot service (systemd).
    A central is started via its Docker flow. Non-interactive stdin runs like 'agentop server'.

Restart:
  agentop restart [server|watch|central|--all] [--rebuild]
    Restart a running mode so it picks up new code (after an upgrade/pull) or config.
    server/watch bounce the systemd user service; central restarts its container.
    --all bounces every service currently up (local + central + machine), non-interactively.
    --rebuild recreates the Docker image/container (central + machine) instead of just bouncing
    it — use it to pick up new code in Docker deployments (native server: use bun bin / upgrade).

Setup:
  agentop setup
    Interactive wizard: pick solo, host a central, or join one as a member.
    Running bare agentop on an unconfigured machine launches this too.

Central:
  agentop central <up|init|down|logs|status|restart|pull>
    Manage the team central via Docker. In a repo checkout it uses central.sh; from the
    standalone binary it pulls the published image (ghcr.io/blpsoares/agentistics) and
    materializes a compose in ~/.agentistics/central — no clone required.

Member:
  agentop member connect --endpoint <url> --token <token> [--org <org>]
    Verify the token against the central and save this machine as a member.
  agentop member leave
    Notify the central and reset back to solo.
  agentop member status
    Show the current mode/endpoint/user and last sync state.

CI (GitHub Actions):
  agentop ci-push [--endpoint <url>] [--token <ci-token>] [--org <org>]
    One-shot push of this runner's metrics to a central. Prefers keyless
    GitHub OIDC (needs permissions: id-token: write); falls back to a
    static token. Reads AGENTISTICS_CENTRAL_URL / AGENTISTICS_CI_TOKEN /
    AGENTISTICS_OIDC_AUDIENCE / AGENTISTICS_TEAM_ORG when flags are omitted.
    Never fails the job on a push error.

Autostart:
  agentop autostart <mode> <enable|disable|status>
    mode ∈ { server, central, watch }
    enable   Register + start the service at boot (also adds a terminal
             update-check hook to ~/.bashrc)
    disable  Stop and remove the service
    status   Show enabled/active state (omit mode to list all)

Examples:
  agentop start
  agentop setup
  agentop server
  agentop server --port 4000
  agentop restart server
  agentop tui
  agentop watch
  agentop central up
  agentop member connect --endpoint http://host:48080 --token abc123
  agentop member status
  agentop upgrade
  agentop check-update
  agentop autostart server enable
  agentop autostart status
`.trim()

// ---------------------------------------------------------------------------
// Version check (runs in parallel with command startup — non-blocking)
// ---------------------------------------------------------------------------

const _ESC = '\x1b'
const _R   = `${_ESC}[0m`
const _B   = `${_ESC}[1m`
const _Y   = `${_ESC}[33m`
const _AM  = `${_ESC}[38;5;208m`
const _CY  = `${_ESC}[96m`
const _GR  = `${_ESC}[92m`
const _WH  = `${_ESC}[97m`
const _D   = `${_ESC}[2m`

/** Prints the "new version available" banner for a resolved VersionInfo. */
function printUpdateBanner(info: { current: string; latest: string }): void {
  const sep = `${_D}${'─'.repeat(52)}${_R}`
  process.stdout.write(
    `\n${sep}\n` +
    `  ${_Y}${_B}⚡ New version available!${_R}\n` +
    `${sep}\n` +
    `  ${_D}Current:${_R} ${_WH}v${info.current}${_R}\n` +
    `  ${_D}Latest: ${_R} ${_GR}${_B}v${info.latest}${_R}\n` +
    `${sep}\n` +
    `\n` +
    `  ${_B}Run ${_AM}agentop upgrade${_R}${_B} to update automatically.${_R}\n` +
    `${sep}\n\n`,
  )
}

async function checkVersionAndWarn(): Promise<void> {
  try {
    const { getVersionInfo } = await import('../server/version.ts')
    const info = await getVersionInfo()
    if (!info.hasUpdate) return
    printUpdateBanner(info)
  } catch {
    // Network unavailable — silently skip
  }
}

// ---------------------------------------------------------------------------

if (command === '--help' || command === '-h') {
  console.log(HELP)
  process.exit(0)
}

// Bare `agentop` (no command): if this machine isn't configured yet (no team or
// team.mode==='solo') AND stdin is a TTY, launch the interactive setup wizard.
// Otherwise fall back to printing HELP exactly as before.
if (!command) {
  let unconfigured = true
  try {
    const { readPreferences } = await import('../server/preferences.ts')
    const prefs = await readPreferences()
    unconfigured = !prefs.team || prefs.team.mode === 'solo'
  } catch {
    // If preferences can't be read, treat as unconfigured (wizard is safe/idempotent).
  }
  if (unconfigured && process.stdin.isTTY) {
    const { runSetup } = await import('../server/cli-setup.ts')
    const code = await runSetup()
    process.exit(code)
  }
  console.log(HELP)
  process.exit(0)
}

if (command === 'setup') {
  const { runSetup } = await import('../server/cli-setup.ts')
  const code = await runSetup()
  process.exit(code)
}

if (command === 'central') {
  const { runCentral } = await import('../server/cli-central.ts')
  const action = args[0]
  if (!action) {
    console.error('Missing central action. Expected one of: up, init, down, logs, status, restart, pull.\n')
    console.log(HELP)
    process.exit(1)
  }
  const code = await runCentral(action, args.slice(1))
  process.exit(code)
}

if (command === 'member') {
  const sub = args[0]
  const rest = args.slice(1)
  if (sub === 'connect') {
    const { memberConnect } = await import('../server/cli-member.ts')
    const readFlag = (name: string): string | undefined => {
      const idx = rest.indexOf(name)
      return idx !== -1 && rest[idx + 1] ? rest[idx + 1] : undefined
    }
    const endpoint = readFlag('--endpoint')
    const token = readFlag('--token')
    const org = readFlag('--org')
    if (!endpoint || !token) {
      console.error('Usage: agentop member connect --endpoint <url> --token <token> [--org <org>]\n')
      process.exit(1)
    }
    const code = await memberConnect({ endpoint, token, org })
    process.exit(code)
  }
  if (sub === 'leave') {
    const { memberLeave } = await import('../server/cli-member.ts')
    const code = await memberLeave()
    process.exit(code)
  }
  if (sub === 'status') {
    const { memberStatus } = await import('../server/cli-member.ts')
    const code = await memberStatus()
    process.exit(code)
  }
  console.error(`Invalid member action: ${sub ?? '(none)'}. Expected one of: connect, leave, status.\n`)
  console.log(HELP)
  process.exit(1)
}

if (command === 'ci-push') {
  // One-shot push of this (ephemeral GitHub Actions) runner's metrics to a central.
  const readFlag = (name: string): string | undefined => {
    const idx = args.indexOf(name)
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined
  }
  const { runCiPush } = await import('../server/ci-push.ts')
  const code = await runCiPush({
    endpoint: readFlag('--endpoint'),
    token: readFlag('--token'),
    org: readFlag('--org'),
  })
  process.exit(code)
}

if (command === '--version' || command === '-v') {
  const { CURRENT_VERSION, getVersionInfo } = await import('../server/version.ts')
  process.stdout.write(`agentop v${CURRENT_VERSION}\n`)
  const info = await getVersionInfo()
  if (info.hasUpdate) {
    process.stdout.write(
      `${_Y}${_B}⚡ New version available: v${info.latest}${_R}\n` +
      `  Run ${_AM}agentop upgrade${_R} to update.\n`,
    )
  }
  process.exit(0)
}

if (command === 'upgrade' || command === 'update') {
  const { runUpgrade } = await import('../server/upgrade.ts')
  await runUpgrade()
  process.exit(0)
}

// Lightweight boot/terminal update check — prints the banner only when a newer
// version exists, otherwise stays completely silent. This is what the ~/.bashrc
// hook installed by `agentop autostart ... enable` runs on every terminal open.
if (command === 'check-update') {
  try {
    const { getVersionInfo } = await import('../server/version.ts')
    const info = await getVersionInfo()
    if (info.hasUpdate) printUpdateBanner(info)
  } catch {
    // Network unavailable — stay silent
  }
  process.exit(0)
}

if (command === 'autostart') {
  const {
    isAutostartMode,
    enableAutostart,
    disableAutostart,
    autostartStatus,
  } = await import('../server/autostart.ts')

  const modeArg = args[0]
  const actionArg = args[1]

  // `agentop autostart status` (no mode) lists every service.
  if (modeArg === 'status' && !actionArg) {
    const res = await autostartStatus()
    process.stdout.write(res.message + '\n')
    process.exit(res.ok ? 0 : 1)
  }

  if (!modeArg || !isAutostartMode(modeArg)) {
    console.error(`Invalid mode: ${modeArg ?? '(none)'}. Expected one of: server, central, watch.\n`)
    console.log(HELP)
    process.exit(1)
  }

  const action = actionArg ?? 'status'
  if (action !== 'enable' && action !== 'disable' && action !== 'status') {
    console.error(`Invalid action: ${action}. Expected one of: enable, disable, status.\n`)
    console.log(HELP)
    process.exit(1)
  }

  const res =
    action === 'enable'  ? await enableAutostart(modeArg) :
    action === 'disable' ? await disableAutostart(modeArg) :
                           await autostartStatus(modeArg)

  process.stdout.write(res.message + '\n')
  process.exit(res.ok ? 0 : 1)
}

if (command === 'status') {
  const { runStatus } = await import('../server/cli-status.ts')
  process.exit(await runStatus())
}

if (command === 'restart') {
  // `--rebuild` recreates Docker images/containers (central + machine) instead of just bouncing.
  const rebuild = args.includes('--rebuild')
  const positional = args.filter(a => !a.startsWith('-'))
  const modeArg = positional[0] ?? (args.includes('--all') ? 'all' : 'server')
  // `agentop restart --all [--rebuild]` — bounce (or rebuild) every service currently up.
  if (modeArg === 'all') {
    const { restartAllServices } = await import('../server/cli-start.ts')
    process.exit(await restartAllServices(rebuild))
  }
  // The central runs in Docker — delegate to its own compose. `up` rebuilds/pulls + recreates;
  // `restart` just bounces the running container.
  if (modeArg === 'central') {
    const { runCentral } = await import('../server/cli-central.ts')
    const code = await runCentral(rebuild ? 'up' : 'restart', [])
    process.exit(code)
  }
  const { restartAutostart, isAutostartMode } = await import('../server/autostart.ts')
  if (!isAutostartMode(modeArg)) {
    console.error(`Invalid mode: ${modeArg}. Expected one of: server, watch, central.\n`)
    process.exit(1)
  }
  // --rebuild on a native mode (server/watch) rebuilds + reinstalls the binary from the repo so
  // the restart serves new frontend/code (a plain bounce would keep the old build).
  if (rebuild) {
    const { rebuildNativeBinary } = await import('../server/cli-start.ts')
    const r = await rebuildNativeBinary()
    if (r === 'not-repo') {
      console.error('--rebuild for the native server needs the repo checkout. Run it from the agentistics repo (or `agentop upgrade`).\n')
      process.exit(1)
    }
    if (r === 'failed') { console.error('native rebuild failed.\n'); process.exit(1) }
  }
  const res = await restartAutostart(modeArg)
  process.stdout.write(res.message + '\n')
  process.exit(res.ok ? 0 : 1)
}

// `agentop start` — interactive launcher. It resolves to a run method; when the user picks
// "foreground" (or stdin isn't a TTY) runStart returns 'foreground' and we fall through to the
// same in-process server startup as `agentop server` below (keeping the Bun.serve alive).
if (command === 'start') {
  const { runStart } = await import('../server/cli-start.ts')
  const result = await runStart()
  if (result !== 'foreground') process.exit(result)
  // else: fall through to the shared server startup below.
}

if (command === 'server' || command === 'start') {
  const portIdx = args.indexOf('--port')
  if (portIdx !== -1 && args[portIdx + 1]) {
    process.env.PORT = args[portIdx + 1]
  }
  // Native central (no Docker): same server process with TEAM_CENTRAL=1, reading central.env for
  // MONGO_URL + secrets. Unlike the Docker central there is NO bundled Mongo, so an external
  // MONGO_URL (Atlas or your own mongod) is required.
  const central = args.includes('--central')
  if (central) {
    const envFile = loadCentralEnv()
    process.env.AGENTISTICS_TEAM_CENTRAL = '1'
    if (!process.env.MONGO_URL) {
      console.error('\n  ✗ native central needs MONGO_URL — there is no bundled Mongo without Docker.')
      console.error('    Set MONGO_URL (external Mongo/Atlas) in central.env or the environment.')
      console.error('    (Or use `agentop central up` for the all-in-one Docker flow.)\n')
      process.exit(1)
    }
    if (envFile) console.log(`  central: loaded ${envFile}`)
  }

  // Background: spawn a detached copy (logging to ~/.agentistics) and return the terminal.
  if (args.includes('--bg') || args.includes('--background')) {
    const { spawn } = await import('node:child_process')
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const log = join(homedir(), '.agentistics', 'agentop-server.log')
    const script = process.argv[1]
    const fromSource = !!script && (script.endsWith('.ts') || script.endsWith('.js'))
    const selfBase = fromSource ? `"${process.execPath}" "${script}"` : `"${process.execPath}"`
    // Re-invoke `server` in the foreground (drop --bg), forwarding --central / --port.
    const fwd = [central ? '--central' : '', portIdx !== -1 && args[portIdx + 1] ? `--port ${args[portIdx + 1]}` : '']
      .filter(Boolean).join(' ')
    const cmd = `${selfBase} server ${fwd}`.trim()
    const child = spawn('sh', ['-c', `nohup ${cmd} >> "${log}" 2>&1 &`], { stdio: 'ignore', detached: true })
    child.unref()
    const webPort = parseInt(process.env.WEB_PORT ?? String((parseInt(process.env.PORT ?? '47291', 10)) + 1), 10)
    console.log(`\n  started ${central ? 'central ' : ''}in the background.`)
    console.log(`  web:  http://localhost:${webPort}`)
    console.log(`  logs: ${log}\n`)
    process.exit(0)
  }

  process.env.SERVE_STATIC = '1'
  // Server, daemon and version check run in parallel
  await Promise.all([
    import('../server/index.ts'),
    import('../server/otel-watcher.ts'),
    checkVersionAndWarn(),
  ])
} else if (command === 'tui') {
  checkVersionAndWarn() // fire-and-forget
  await import('../../web/src/tui/index.ts')
} else if (command === 'watch') {
  checkVersionAndWarn() // fire-and-forget
  await import('../server/otel-watcher.ts')
} else {
  console.error(`Unknown command: ${command}\n`)
  console.log(HELP)
  process.exit(1)
}
