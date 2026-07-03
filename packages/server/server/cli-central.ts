/**
 * cli-central.ts — thin wrapper over the repo's central.sh (Docker Compose).
 *
 * This module does NOT reimplement docker or the compose lifecycle: it just
 * locates central.sh in the agentistics repo and shells out to it, inheriting
 * stdio so `init`'s interactive prompts and `logs` streaming work naturally.
 */

import { existsSync } from 'fs'
import { resolve } from 'path'

/** The central.sh subcommands this wrapper forwards. */
export const CENTRAL_ACTIONS = ['up', 'init', 'down', 'logs', 'status', 'restart', 'pull'] as const
export type CentralAction = (typeof CENTRAL_ACTIONS)[number]

export function isCentralAction(value: string): value is CentralAction {
  return (CENTRAL_ACTIONS as readonly string[]).includes(value)
}

/**
 * Best-effort repo root that contains central.sh.
 *
 * ASSUMPTION: this file lives at `<repoRoot>/packages/server/server/cli-central.ts`,
 * so the repo root is three directories up from `import.meta.dir`. When running
 * from the compiled binary that path won't hold central.sh; the CWD is tried as
 * a fallback so `agentop central …` works when invoked from a checkout.
 */
function findCentralScript(): string | null {
  const candidates: string[] = []
  try {
    candidates.push(resolve(import.meta.dir, '..', '..', '..', 'central.sh'))
  } catch { /* import.meta.dir unavailable — skip */ }
  candidates.push(resolve(process.cwd(), 'central.sh'))
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/**
 * Run `bash <repoRoot>/central.sh <action> ...extraArgs`, inheriting stdio so
 * interactive prompts and log streaming pass through. Returns the child's exit
 * code (non-zero when central.sh is missing or the action is invalid).
 */
export async function runCentral(action: string, extraArgs: string[]): Promise<number> {
  if (!isCentralAction(action)) {
    process.stderr.write(
      `Invalid central action: ${action}. Expected one of: ${CENTRAL_ACTIONS.join(', ')}.\n`,
    )
    return 1
  }

  const script = findCentralScript()
  if (!script) {
    process.stderr.write(
      'central mode needs the agentistics repo — run from the repo, or clone it ' +
      '(https://github.com/) and run `agentop central` from inside the checkout.\n',
    )
    return 1
  }

  try {
    const proc = Bun.spawn(['bash', script, action, ...extraArgs], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    return await proc.exited
  } catch (err) {
    process.stderr.write(
      `Could not run central.sh: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 1
  }
}
