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

Options:
  --help, -h    Show this help message
  --port <n>    Port for the web server (default: 3001)  [server only]

Examples:
  agentop server
  agentop server --port 4000
  agentop tui
  agentop watch
`.trim()

if (!command || command === '--help' || command === '-h') {
  console.log(HELP)
  process.exit(0)
}

if (command === 'server') {
  const portIdx = args.indexOf('--port')
  if (portIdx !== -1 && args[portIdx + 1]) {
    process.env.PORT = args[portIdx + 1]
  }
  process.env.SERVE_STATIC = '1'
  // Server and daemon always start together
  await Promise.all([
    import('../server/index.ts'),
    import('../server/otel-watcher.ts'),
  ])
} else if (command === 'tui') {
  await import('../src/tui/index.ts')
} else if (command === 'watch') {
  await import('../server/otel-watcher.ts')
} else {
  console.error(`Unknown command: ${command}\n`)
  console.log(HELP)
  process.exit(1)
}
