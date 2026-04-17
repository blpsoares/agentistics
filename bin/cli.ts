#!/usr/bin/env bun
/**
 * agentop — AI agent usage dashboard
 *
 * Single entry point for the compiled binary.
 */

import { join } from 'path'
import { version as currentVersion } from '../package.json'

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

// ---------------------------------------------------------------------------
// Version check — runs before any command. Silent on error or no update.
// ---------------------------------------------------------------------------

async function checkVersion(): Promise<void> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/blpsoares/agentistics/releases/latest',
      {
        headers: { 'User-Agent': 'agentistics-version-check' },
        signal: AbortSignal.timeout(4000),
      }
    )
    if (!res.ok) return

    const data = await res.json() as { tag_name?: string }
    const latest = data.tag_name?.replace(/^v/, '')
    if (!latest || latest === currentVersion) return

    // Update available
    console.log()
    console.log(`\x1b[33m╭─ Update available\x1b[0m`)
    console.log(`\x1b[33m│\x1b[0m  Current: \x1b[2mv${currentVersion}\x1b[0m`)
    console.log(`\x1b[33m│\x1b[0m  Latest:  \x1b[1;32mv${latest}\x1b[0m`)
    console.log(`\x1b[33m╰─\x1b[0m`)
    console.log()

    const { confirm } = await import('@inquirer/prompts')
    const wantUpdate = await confirm({
      message: 'Update now and restart?',
      default: true,
    }).catch(() => false)

    if (!wantUpdate) {
      console.log('\x1b[2mRunning with current version.\x1b[0m\n')
      return
    }

    // Determine repo directory (works in both dev and compiled binary)
    const repoDir = join(import.meta.dir, '..')
    const { spawnSync } = await import('child_process')

    console.log('\n\x1b[2mPulling latest changes...\x1b[0m')
    const pull = spawnSync('git', ['-C', repoDir, 'pull'], { stdio: 'inherit' })
    if (pull.status !== 0) {
      console.error('\x1b[31mGit pull failed. Please update manually.\x1b[0m')
      return
    }

    console.log('\x1b[2mInstalling dependencies...\x1b[0m')
    const install = spawnSync('bun', ['install'], { cwd: repoDir, stdio: 'inherit' })
    if (install.status !== 0) {
      console.error('\x1b[31mbun install failed. Please update manually.\x1b[0m')
      return
    }

    console.log('\n\x1b[32m✓ Updated to v' + latest + '. Restarting...\x1b[0m\n')

    // Re-exec the same command with the updated code
    const { execFileSync } = await import('child_process')
    try {
      execFileSync('bun', ['run', join(repoDir, 'bin/cli.ts'), command as string, ...args], {
        stdio: 'inherit',
        cwd: repoDir,
      })
    } catch { /* process exited, that's fine */ }
    process.exit(0)
  } catch {
    // Network unavailable or timeout — proceed silently
  }
}

await checkVersion()

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

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
