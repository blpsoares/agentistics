#!/usr/bin/env bun
/**
 * agentop — AI agent usage dashboard
 *
 * Single entry point for the compiled binary.
 */

const command = process.argv[2]
const args = process.argv.slice(3)

const HELP = `
Usage: agentop <command> [options]

Commands:
  start         Interactive launcher — pick mode + how to run (foreground/bg/docker/boot)
  setup         Interactive first-run wizard (solo / central / member)
  server        Start the web dashboard + background daemon (non-interactive)
  restart       Restart a running mode's service so it picks up new code/config
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

Start:
  agentop start
    Interactive launcher. Shows the current mode, offers to (re)configure, then asks
    how to run: foreground, background (detached), Docker, or a boot service (systemd).
    A central is started via its Docker flow. Non-interactive stdin runs like 'agentop server'.

Restart:
  agentop restart [server|watch|central]
    Restart a running mode so it picks up new code (after an upgrade/pull) or config.
    server/watch bounce the systemd user service; central rebuilds/restarts its container.

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

if (command === 'restart') {
  const modeArg = args[0] ?? 'server'
  // The central runs in Docker — delegate to its own restart (systemctl can't bounce a container).
  if (modeArg === 'central') {
    const { runCentral } = await import('../server/cli-central.ts')
    const code = await runCentral('restart', [])
    process.exit(code)
  }
  const { restartAutostart, isAutostartMode } = await import('../server/autostart.ts')
  if (!isAutostartMode(modeArg)) {
    console.error(`Invalid mode: ${modeArg}. Expected one of: server, watch, central.\n`)
    process.exit(1)
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
