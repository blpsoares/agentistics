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
  server      Start the web dashboard + background daemon
  tui         Start the live terminal dashboard (standalone)
  watch       Start the background metrics daemon only
  upgrade     Upgrade agentop to the latest version

Options:
  --help, -h       Show this help message
  --version, -v    Show current version
  --port <n>       Port for the web server (default: 47291)  [server only]

Examples:
  agentop server
  agentop server --port 4000
  agentop tui
  agentop watch
  agentop upgrade
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

async function checkVersionAndWarn(): Promise<void> {
  try {
    const { getVersionInfo } = await import('../server/version.ts')
    const info = await getVersionInfo()
    if (!info.hasUpdate) return

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
