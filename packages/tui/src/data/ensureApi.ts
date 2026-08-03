/**
 * ensureApi — make sure the agentistics API is answering before the UI mounts.
 *
 * Ported from the previous TUI. If nothing is listening we spawn a server ourselves and kill it
 * again on exit, so `agentop tui` works from a cold start without the user having to run
 * `agentop server` first. A server that was ALREADY running is never touched or killed.
 */

import { join } from 'path'

let spawned: ReturnType<typeof Bun.spawn> | null = null

export async function probeApi(apiBase: string, timeoutMs = 1000): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/api/data`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}

export interface EnsureResult {
  ok: boolean
  /** True when this process started the server (and is therefore responsible for stopping it). */
  spawnedByUs: boolean
}

export async function ensureApi(apiBase: string): Promise<EnsureResult> {
  if (await probeApi(apiBase, 2000)) return { ok: true, spawnedByUs: false }

  // As a compiled binary, re-invoke ourselves with the `server` subcommand; under `bun run`,
  // start the server entry point directly.
  const isBinary = !process.execPath.includes('bun')
  const args = isBinary
    ? [process.execPath, 'server']
    : ['bun', 'run', join(import.meta.dir, '../../../server/server/index.ts')]

  try {
    spawned = Bun.spawn(args, {
      stdout: 'ignore',
      stderr: 'ignore',
      env: { ...process.env, SERVE_STATIC: '1' },
    })
  } catch {
    return { ok: false, spawnedByUs: false }
  }

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 300))
    if (await probeApi(apiBase, 800)) return { ok: true, spawnedByUs: true }
  }

  stopSpawnedApi()
  return { ok: false, spawnedByUs: false }
}

export function stopSpawnedApi(): void {
  if (spawned) {
    spawned.kill()
    spawned = null
  }
}

export function registerApiCleanup(): void {
  const kill = () => stopSpawnedApi()
  process.on('exit', kill)
  process.on('SIGINT', () => { kill(); process.exit(0) })
  process.on('SIGTERM', () => { kill(); process.exit(0) })
}
