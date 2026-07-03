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
  server        Start the web dashboard + background daemon
  tui           Start the live terminal dashboard (standalone)
  watch         Start the background metrics daemon only
  upgrade       Upgrade agentop to the latest version
  autostart     Start a mode with the system (systemd user service on Linux)
  check-update  Print a notice if a newer version is available (else silent)

Options:
  --help, -h       Show this help message
  --version, -v    Show current version
  --port <n>       Port for the web server (default: 47291)  [server only]

Autostart:
  agentop autostart <mode> <enable|disable|status>
    mode ∈ { server, central, watch }
    enable   Register + start the service at boot (also adds a terminal
             update-check hook to ~/.bashrc)
    disable  Stop and remove the service
    status   Show enabled/active state (omit mode to list all)

Examples:
  agentop server
  agentop server --port 4000
  agentop tui
  agentop watch
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

if (!command || command === '--help' || command === '-h') {
  console.log(HELP)
  process.exit(0)
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

if (command === 'server') {
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
