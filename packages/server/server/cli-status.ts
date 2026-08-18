/**
 * cli-status.ts — `agentop status`, a one-shot at-a-glance report.
 *
 * Non-interactive: prints CONFIG (team mode + endpoint from preferences), SERVICES (local server,
 * central container, machine container — detected live) and HEALTH (a one-line summary from the
 * local server's /api/health when it's up). Mirrors the detection helpers in cli-start.ts, but
 * reimplements the tiny shell/docker helpers locally rather than importing private members.
 */

import type { TeamConnection } from '@agentistics/core'
import { PORT, WEB_PORT } from './config'
import { readPreferencesOrExit } from './preferences'
import { cliStrings, resolveLang, type CliStrings } from './cli-i18n'

// ANSI (same palette as cli-start.ts)
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
const MACHINE_IMAGE = 'agentistics-machine' // docker/machine.yml: image

// shell helpers (local copy of cli-start.ts's pattern)
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

// detection
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

const RULE = `  ${D}${R}`

type Mode = 'solo' | 'central' | 'member'

/** A corrupt preferences file must NOT be reported as `solo` — that is precisely the lie the
 *  refusal in readJsonPrefs exists to prevent. `readPreferencesOrExit` names the file and
 *  exits non-zero instead. */
async function loadConfig(): Promise<{ mode: Mode; connections: TeamConnection[] }> {
  const prefs = await readPreferencesOrExit()
  return { mode: prefs.team?.mode ?? 'solo', connections: prefs.team?.connections ?? [] }
}

/** 0 → solo; 1 → today's exact single-line form, unchanged; N → `member → N centrals` plus one
 *  indented `↳ endpoint[ · k repo(s) blocked]` line per connection (spec §8.1) — collapsing to
 *  just the first connection would silently misreport every central but one. */
export function configLines(s: CliStrings, mode: Mode, connections: TeamConnection[]): string[] {
  if (mode === 'central') return [`${CY}central${R}`]
  if (mode !== 'member' || connections.length === 0) return [`${CY}solo${R}`]
  if (connections.length === 1) {
    // `||`, not `??` — `endpoint` is a non-optional string, so a connection whose endpoint is ''
    // (a shape `migrateTeamConfig` can produce) printed a blank line under `??`. The N-connection
    // branch below and cli-start.ts both use `||`; this was the one place out of step.
    return [`${CY}member${R} ${D}→${R} ${WH}${connections[0]!.endpoint || '(?)'}${R}`]
  }
  const header = `${CY}member${R} ${D}→${R} ${WH}${connections.length} centrals${R}`
  // `s.deniedSuffix` is the SAME shared string cli-start.ts's launcher uses for the identical
  // fact — a hand-copied literal here duplicated its English text instead of calling it, so a
  // pt-BR user saw untranslated text in `agentop status` even though the launcher localizes it.
  const lines = connections.map(c => {
    // s.deniedSuffix already begins with its own leading space (" · N repo(s) blocked") — do
    // not prepend a second one here (that was a double-space bug this round found).
    const suffix = c.deniedRepos.length > 0 ? `${D}${s.deniedSuffix(c.deniedRepos.length)}${R}` : ''
    return `      ${D}↳${R} ${c.endpoint || '(?)'}${suffix}`
  })
  return [header, ...lines]
}

export async function runStatus(): Promise<number> {
  const s = cliStrings(await resolveLang())

  // CONFIG
  const { mode, connections } = await loadConfig()

  // SERVICES (detected live)
  const [local, central, machine] = await Promise.all([
    isServerRunning(),
    dockerIds(`label=com.docker.compose.project=${CENTRAL_PROJECT}`).then((i) => i.length > 0),
    dockerIds(`ancestor=${MACHINE_IMAGE}`).then((i) => i.length > 0),
  ])

  process.stdout.write('\n')
  process.stdout.write(`  ${O}${B}agentop status${R}\n`)
  process.stdout.write(`${RULE}\n`)
  process.stdout.write(`  ${D}CONFIG${R}\n`)
  const [firstLine, ...restLines] = configLines(s, mode, connections)
  process.stdout.write(`    ${D}mode${R}      ${firstLine}\n`)
  for (const line of restLines) process.stdout.write(`${line}\n`)
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
