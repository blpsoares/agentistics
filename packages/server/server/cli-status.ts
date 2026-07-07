/**
 * cli-status.ts — `agentop status`, a one-shot at-a-glance report.
 *
 * Non-interactive: prints CONFIG (team mode + endpoint from preferences), SERVICES (local server,
 * central container, machine container — detected live) and HEALTH (a one-line summary from the
 * local server's /api/health when it's up). Mirrors the detection helpers in cli-start.ts, but
 * reimplements the tiny shell/docker helpers locally rather than importing private members.
 */

import { PORT, WEB_PORT } from './config'
import { readPreferences } from './preferences'

// ── ANSI (same palette as cli-start.ts) ──────────────────────────────────────
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

// ── shell helpers (local copy of cli-start.ts's pattern) ──────────────────────
async function sh(cmd: string[]): Promise<{ code: number; out: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' })
    const out = await new Response(p.stdout).text()
    return { code: await p.exited, out: out.trim() }
  } catch {
    return { code: 127, out: '' }
  }
}

async function dockerIds(filter: string): Promise<string[]> {
  const r = await sh(['docker', 'ps', '-q', '-f', filter])
  return r.out.split(/\s+/).filter(Boolean)
}

// ── detection ─────────────────────────────────────────────────────────────────
async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(600) })
    return res.ok
  } catch {
    return false
  }
}

/** Green dot for a live service, dim circle for a down one. */
function dot(up: boolean): string {
  return up ? `${GR}●${R}` : `${D}○${R}`
}

/** One-line health summary from /api/health. Counts passing checks when the shape allows. */
async function healthLine(): Promise<string> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(600) })
    if (!res.ok) return `${D}health: unreachable (HTTP ${res.status})${R}`
    const data: unknown = await res.json().catch(() => null)
    const checks = (data as { checks?: unknown } | null)?.checks
    if (Array.isArray(checks) && checks.length > 0) {
      const ok = checks.filter((c) => (c as { ok?: boolean; healthy?: boolean })?.ok ?? (c as { healthy?: boolean })?.healthy).length
      const total = checks.length
      const label = ok === total ? `${GR}healthy${R}` : `${YE}degraded${R}`
      return `${label} ${D}(${ok}/${total} checks passing)${R}`
    }
    return `${GR}reachable${R}`
  } catch {
    return `${D}health: n/a (server down)${R}`
  }
}

const RULE = `  ${D}────────────────────────────────────────${R}`

type Mode = 'solo' | 'central' | 'member'

async function loadConfig(): Promise<{ mode: Mode; endpoint?: string }> {
  try {
    const prefs = await readPreferences()
    return { mode: prefs.team?.mode ?? 'solo', endpoint: prefs.team?.endpoint }
  } catch {
    return { mode: 'solo' }
  }
}

export async function runStatus(): Promise<number> {
  // CONFIG
  const { mode, endpoint } = await loadConfig()

  // SERVICES (detected live)
  const [local, central, machine] = await Promise.all([
    isServerRunning(),
    dockerIds(`label=com.docker.compose.project=${CENTRAL_PROJECT}`).then((i) => i.length > 0),
    dockerIds(`ancestor=${MACHINE_IMAGE}`).then((i) => i.length > 0),
  ])

  const configValue =
    mode === 'member' ? `${CY}member${R} ${D}→${R} ${WH}${endpoint ?? '(?)'}${R}`
    : mode === 'central' ? `${CY}central${R}`
    : `${CY}solo${R}`

  process.stdout.write('\n')
  process.stdout.write(`  ${O}${B}agentop status${R}\n`)
  process.stdout.write(`${RULE}\n`)
  process.stdout.write(`  ${D}CONFIG${R}\n`)
  process.stdout.write(`    ${D}mode${R}      ${configValue}\n`)
  process.stdout.write(`${RULE}\n`)
  process.stdout.write(`  ${D}SERVICES${R}\n`)
  const localLine = local
    ? `${dot(true)} ${WH}local server${R}   ${D}http://localhost:${WEB_PORT}${R}`
    : `${dot(false)} ${D}local server${R}   ${D}offline${R}`
  process.stdout.write(`    ${localLine}\n`)
  process.stdout.write(`    ${dot(central)} ${central ? WH : D}central container${R} ${D}${central ? 'running' : 'stopped'}${R}\n`)
  process.stdout.write(`    ${dot(machine)} ${machine ? WH : D}machine container${R} ${D}${machine ? 'running' : 'stopped'}${R}\n`)
  process.stdout.write(`${RULE}\n`)
  process.stdout.write(`  ${D}HEALTH${R}\n`)
  const health = local ? await healthLine() : `${D}health: n/a (server down)${R}`
  process.stdout.write(`    ${health}\n`)
  process.stdout.write(`${RULE}\n\n`)

  return 0
}
