/**
 * cli-start.ts — the logic behind the `agentop` control center.
 *
 * This module owns everything the control center DOES: what the current mode is, which services
 * are up, which assistant sessions are running, and what each action performs. The real work of
 * the last two lives under `sessions/`; what is here is the composition and the wording. The Ink
 * layer (`@agentistics/tui/control`) owns only how
 * that is drawn — the two meet at `ControlHost`, implemented here, whose methods return an
 * already-localized `ActionResult` instead of printing.
 *
 * Nothing here may write to stdout while the alternate screen is live: a stray line lands in a
 * buffer Ink is repainting and corrupts the frame. There are three ways an action obeys that, and
 * which one it takes is a judgement about what the action SAYS:
 *
 *  - `captureOutput` — it prints a sentence. The prints are swallowed and the last line becomes the
 *    failure message in the status line.
 *  - `streamOutput` — its output is the point and there is nothing to ask. `docker compose up
 *    --build`, `central.sh up`, `bun run bin`: the child is spawned with BOTH pipes captured (never
 *    `inherit`, never a tty of its own) and every line it produces is published on the output
 *    channel, which the control center draws into a pane. This is what replaced leaving the screen.
 *  - `suspend` — it asks a QUESTION, so it needs the real terminal. `central.sh init` is the whole
 *    of that list: it refuses outright without a tty, and a prompt streamed into a pane is a
 *    question nobody can answer.
 *
 * Language follows `--lang en|pt`, else `preferences.lang` (shared with the web), else English;
 * the in-app toggle persists to that same preference.
 *
 * Non-interactive stdin (a pipe or a systemd unit) never opens the control center and behaves like
 * `agentop server`. runStart() returns a numeric exit code or the sentinel 'foreground' (cli.ts
 * then starts the in-process server and does not exit).
 */

import { spawn } from 'node:child_process'
import { writeSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { DEFAULT_TEAM, type TeamConnection } from '@agentistics/core'
import type {
  ActionResult,
  ActionTarget,
  BootState,
  ControlHost,
  ControlService,
  ControlStatus,
  HarnessChoice,
  LogSource,
  NewSessionRequest,
  RestartOption,
  RuntimeId,
  ServiceId,
  ServiceRef,
  ServiceRuntimeState,
  ServiceState,
  SessionSnapshot,
  StartOption,
  StartRequest,
  // The re-declared halves of the session contract. Aliased so the server's own declarations keep
  // their plain names below — see SESSION_CONTRACT_MATCHES, which holds the two together.
  ProjectChoice as ControlProjectChoice,
  SessionState as ControlSessionState,
  SessionView as ControlSessionView,
} from '@agentistics/tui/control'
import { PORT, WEB_PORT } from './config'
import { harnessProcesses, type HarnessProcess } from './live-sessions'
import { loadConsolidated } from './consolidate'
import { createLimiter } from './utils'
import { resolveBackend } from './sessions/index'
import { patchSession, readRegistry } from './sessions/registry'
import { reconcileSessions } from './sessions/session-ref'
import { buildSessionViews, type SessionView } from './sessions/monitor'
import { buildProjectChoices, searchProjects, type ProjectChoice } from './sessions/project-search'
import { SPAWN_SPECS, STARTABLE_HARNESSES } from './sessions/spawn-spec'
import { killManagedSession, startManagedSession } from './sessions/verbs'
import type { SessionState } from './sessions/attention'
import type { CaptureResult, ManagedSession, SessionBackend } from './sessions/types'
import { readPreferences, writePreferences, resolveArchiveMode, type ArchiveMode } from './preferences'
import { centralStartPlan, runCentral, type CentralStartPlan } from './cli-central'
import { onOutputLine, publishLines, streamCommand } from './cli-stream'
import {
  centralRebuildArgs,
  composeRebuildCommands,
  rebuildFlags,
  type RebuildFlags,
} from './rebuild-flags'
// The pure line decoder, by its own subpath: `@agentistics/tui/control` pulls in Ink and React, and
// this module is loaded by every `agentop` subcommand.
import { createLineDecoder } from '@agentistics/tui/control/stream'
import { ensureArchiveModeChosen } from './cli-setup'
import { memberConnect, memberLeave } from './cli-member'
import { enableAutostart, type AutostartMode } from './autostart'
import { confirm } from './cli-ui'
import { CURRENT_VERSION, getVersionInfo } from './version'
import { cliStrings, explainSpawnError, type CliLang, type CliStrings } from './cli-i18n'
import { resolveLang } from './cli-lang'

export type StartResult = number | 'foreground'

// ANSI, for the output this module still writes to the REAL terminal: the suspended commands,
// the foreground handover and the non-interactive `agentop restart --all`.
const ESC = '\x1b'
const R = `${ESC}[0m`
const D = `${ESC}[2m`
const CY = `${ESC}[96m`
const GR = `${ESC}[92m`
const YE = `${ESC}[33m`

const CENTRAL_PROJECT = 'team-mode'      // central.sh: PROJECT=${PROJECT:-team-mode}
const MACHINE_IMAGE = 'agentistics-machine' // docker-compose.machine.yml: image
const CENTRAL_FILTER = `label=com.docker.compose.project=${CENTRAL_PROJECT}`
const MACHINE_FILTER = `ancestor=${MACHINE_IMAGE}`

/**
 * Inside a container the app always listens on 47291 — both compose files pin `PORT: 47291`, so the
 * INTERNAL port is a constant even though the published one is the user's choice (APP_PORT).
 * Asking docker which host port that maps to is the only way to state the central's URL without
 * guessing; 48080 is merely the default the wizard offers.
 */
const CONTAINER_APP_PORT = '47291/tcp'
const CENTRAL_DEFAULT_PORT = 48080

const SERVER_LOG = join(homedir(), '.agentistics', 'agentop-server.log')

// shell helpers
async function sh(cmd: string[]): Promise<{ code: number; out: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' })
    const out = await new Response(p.stdout).text()
    return { code: await p.exited, out: out.trim() }
  } catch {
    return { code: 127, out: '' }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// language
// resolveLang lives in cli-lang.ts so `agentop tui` resolves the language identically.

// state + detection
type Mode = 'solo' | 'central' | 'member'

/**
 * `connections` is the authority; `endpoint` is only the legacy MIRROR of `connections[0]` that
 * `normalizeTeamConfig` keeps writing for downgrades. Every member-mode decision below reads the
 * array, because the mirror cannot answer "how many centrals" — and a control center that answers
 * that question with one endpoint out of three is the same misreport `agentop status` was fixed
 * for.
 */
async function loadState(): Promise<{ mode: Mode; endpoint?: string; connections: TeamConnection[]; mouse: boolean }> {
  try {
    const prefs = await readPreferences()
    // Mouse ON unless the preference says otherwise — the default the control center assumes, and
    // the one an unreadable preferences file falls back to below. It is the reachable-by-default
    // half of the setting; `m` in the app is how it is turned off, and it is written back here.
    return {
      mode: prefs.team?.mode ?? 'solo',
      endpoint: prefs.team?.endpoint,
      connections: prefs.team?.connections ?? [],
      mouse: prefs.mouse !== false,
    }
  } catch {
    return { mode: 'solo', connections: [], mouse: true }
  }
}

/**
 * Which runtimes are up, by runtime id.
 *
 * A RUNTIME, not a service: `local` and `machine` are two ways of running the ONE logical service
 * the user calls "agentistics", and the whole point of the logical model is that this map is the
 * host's business and never reaches the screen as three rows.
 */
type RuntimeUp = Record<RuntimeId, boolean>

/**
 * The runtimes each target names, most-preferred first.
 *
 * One total record rather than a lookup with a fallback, so the compiler is the thing that notices
 * a new runtime or a new service — and so a logical target and a runtime target resolve through
 * exactly the same table. `central` appears on both sides because the central has a single runtime:
 * naming the service and naming its runtime are the same instruction.
 */
export const TARGET_RUNTIMES: Record<ServiceRef, readonly RuntimeId[]> = {
  agentistics: ['local', 'machine'],
  central: ['central'],
  local: ['local'],
  machine: ['machine'],
}

/** Canonical order, used wherever a set of runtimes has to be listed or acted on in sequence. */
export const RUNTIME_ORDER: readonly RuntimeId[] = ['local', 'machine', 'central']

/**
 * The runtimes an action target names, restricted to the ones actually RUNNING.
 *
 * This is where a logical target becomes something to act on: `stop('agentistics')` means "stop
 * whichever way it happens to be running", which is one runtime normally and two in the conflict
 * case — and nothing at all when it is already down, which the caller reports rather than
 * pretending it stopped something.
 */
export function targetRuntimes(target: ActionTarget, up: readonly RuntimeId[]): RuntimeId[] {
  const named = target === 'all' ? RUNTIME_ORDER : TARGET_RUNTIMES[target]
  return named.filter(id => up.includes(id))
}

/**
 * The runtime whose log a source names.
 *
 * A logical source reads whichever runtime is up; with none up it falls back to the service's
 * primary runtime, because the most useful log of a server that is NOT running is the file the last
 * one left behind. A runtime source resolves to itself, which is what the full-screen Logs screen's
 * selector needs in order to read a container the cockpit does not have selected.
 */
export function logRuntime(source: LogSource, up: readonly RuntimeId[]): RuntimeId {
  const candidates = TARGET_RUNTIMES[source]
  return candidates.find(id => up.includes(id)) ?? candidates[0]!
}

/**
 * A logical service's state, from the states of its runtimes.
 *
 * `up` if any runtime is up. Otherwise `unknown` if an AVAILABLE runtime could not be probed — the
 * old "never assume down" rule, scoped so it cannot spread: a container runtime on a box without
 * docker is not undetectable, it is impossible, so it must not make the whole service read as
 * unknown on every machine that has no docker installed. Only when every runtime that could be
 * running is confidently down is the service down.
 */
export function aggregateState(
  runtimes: readonly Pick<ServiceRuntimeState, 'state' | 'available' | 'reason'>[],
): { state: ServiceState; reason?: string } {
  if (runtimes.some(r => r.state === 'up')) return { state: 'up' }
  const blind = runtimes.find(r => r.available && r.state === 'unknown')
  return blind ? { state: 'unknown', reason: blind.reason } : { state: 'down' }
}

/**
 * Facts `startOptionsFor` needs beyond the runtime id and the strings — everything a caller can
 * only learn by asking this box, never by looking at the runtime's name.
 */
export interface StartFacts {
  /**
   * Which shape `central up` would take here — see `planCentralStart` in cli-central.ts. `native`
   * is the ONLY state that offers a native start at all: it means an external (non-bundled) Mongo
   * is configured and this is the standalone (no-repo) path, which is the one case
   * `runCentral`/`runNativeCentral` can run the binary directly instead of Docker. Every other
   * value (including `undefined`, before a plan was ever computed) keeps the Docker-only option
   * this screen has always offered — a native option that could not actually reach a database
   * would be a verb that fails on principle.
   */
  centralPlan?: CentralStartPlan
}

/**
 * The starts a single runtime offers.
 *
 * Each option carries what must happen AROUND it — the port it contends for, whether the archive
 * consent applies, whether it is worth bringing back on boot. Those are facts about this box and
 * this product, so they are stated here with the option rather than re-derived from the runtime id
 * by the screen drawing it: a UI that knows `local` is the runtime with a port is a UI holding a
 * piece of the model.
 *
 * `offersBoot` is never set on a foreground option, for any runtime: a foreground process holds
 * the terminal (or, for Docker, blocks it under `suspend` until Ctrl-C), so "start it at boot" is
 * not a thing it can be — that question only makes sense for something that is going to keep
 * running after this command returns.
 */
export function startOptionsFor(runtime: RuntimeId, s: CliStrings, facts: StartFacts = {}): StartOption[] {
  switch (runtime) {
    case 'local':
      return [
        {
          runtime: 'local', how: 'fg', label: s.optForeground, hint: s.optForegroundHint,
          // The foreground path hands the terminal back to `runStart()`, which clears the port and
          // asks the gate itself; the flags describe the start either way.
          blockedBy: 'local', asksArchive: true,
        },
        {
          runtime: 'local', how: 'bg', label: s.optBackground, hint: s.optBackgroundHint,
          blockedBy: 'local', asksArchive: true, offersBoot: true,
        },
      ]
    case 'machine':
      return [
        {
          // Foreground here means genuinely attached — `docker compose up --build` without `-d`,
          // run under `suspend()` exactly like `central.sh init`: it needs the real tty because
          // Ctrl-C is how you stop it, not because it asks a question. No `offersBoot`: it never
          // returns until you interrupt it. No `asksArchive` either — a container start never has
          // (see the field's own doc): the gate belongs to the process writing to ~/.agentistics,
          // which here is the containerized server, not this CLI.
          runtime: 'machine', how: 'fg', label: s.optDockerForeground, hint: s.optDockerForegroundHint,
          blockedBy: 'local',
        },
        {
          runtime: 'machine', how: 'bg', label: s.optDockerBackground, hint: s.optDockerBackgroundHint,
          blockedBy: 'local',
          // Honoured by the systemd `agentop-machine` unit (`docker compose … up -d`) — a genuinely
          // separate mechanism from the native `agentop-server` unit `local` uses, so `enableBoot`
          // is told which runtime asked (see `ControlHost.enableBoot`).
          offersBoot: true,
        },
      ]
    case 'central': {
      if (facts.centralPlan === 'native') {
        return [
          {
            runtime: 'central', how: 'fg', label: s.optCentralNativeForeground, hint: s.optCentralNativeForegroundHint,
          },
          {
            runtime: 'central', how: 'bg', label: s.optCentralNativeBackground, hint: s.optCentralNativeBackgroundHint,
            // No native-central systemd unit exists (`agentop-central` always runs `central.sh up`,
            // the Docker path) — installing that unit for a process started natively would claim a
            // boot mechanism that does not match what is actually running. Absent beats a boot
            // toggle that quietly does nothing.
          },
        ]
      }
      return [
        {
          runtime: 'central', how: 'bg', label: s.optCentral, hint: s.optCentralHint, offersBoot: true,
        },
      ]
    }
  }
}

/**
 * Which runtimes this box could REBUILD, keyed by runtime.
 *
 * Absent or false means the pieces are not here — no repo checkout for `bun run bin`, no compose
 * file for the machine image — and the option is then not offered at all. A rebuild that could not
 * work is worse than a missing one: it is a verb that fails on principle, and the user pressed it
 * because the screen said they could.
 */
export type RebuildAbility = Partial<Record<RuntimeId, boolean>>

/**
 * The restarts a RUNNING service offers: the plain bounce, plus a rebuild per runtime that can.
 *
 * PURE, and the mirror of `startOptionsFor` — including the reason it is here rather than in the
 * screen: what a rebuild MEANS is per runtime (recompile the binary, rebuild the image, go through
 * the central's own `up`) and whether it can happen at all is a fact about this box.
 *
 * In a CONFLICT each copy is rebuilt on its own, exactly as it is stopped on its own: "rebuild it"
 * has no single meaning while the same program is running twice, and rebuilding both would leave
 * the conflict standing.
 */
function restartOptionsFor(
  id: ServiceId,
  up: readonly ServiceRuntimeState[],
  s: CliStrings,
  can: RebuildAbility,
): RestartOption[] {
  const out: RestartOption[] = [
    { target: id, rebuild: false, label: s.optRestart, hint: s.optRestartHint },
  ]
  const named = up.length > 1
  for (const runtime of up) {
    if (!can[runtime.id]) continue
    out.push({
      target: named ? runtime.id : id,
      rebuild: true,
      label: named ? s.optRebuildRuntime(runtime.kind) : s.optRebuild,
      hint: runtime.kind === 'native' ? s.optRebuildNativeHint : s.optRebuildDockerHint,
    })
  }
  return out
}

/**
 * One logical service, assembled from the runtimes it could be running under.
 *
 * PURE — states and strings in, the value the screen draws out — because every judgement worth
 * getting right is in here: that a running service offers NO start (which is the whole answer to
 * "it offered to start a docker copy while one was already running"), that a service with two
 * runtimes up says so instead of showing one of them, and that a stopped service still gets a row
 * with the starts this box can actually perform.
 */
export function buildService(
  id: ServiceId,
  label: string,
  runtimes: ServiceRuntimeState[],
  s: CliStrings,
  /**
   * What only a probe of this box can answer. Optional and absent by default, so a caller that
   * cannot ask — or a platform with no user systemd — produces a service that says nothing about
   * boot rather than one that says "no", and offers no rebuild rather than one that cannot work.
   */
  facts: { boot?: BootState; rebuild?: RebuildAbility; centralPlan?: CentralStartPlan } = {},
): ControlService {
  const up = runtimes.filter(r => r.state === 'up')
  const { state, reason } = aggregateState(runtimes)
  return {
    id,
    label,
    state,
    runtimes,
    running: up.map(r => r.id),
    active: up[0],
    boot: facts.boot,
    // Named, not merely coloured, and never reduced to whichever copy we happened to find first.
    conflict: up.length > 1 ? s.svcConflict(up.map(r => r.kind)) : undefined,
    reason,
    // The single most important line in the model: while anything is up there is nothing to start.
    startOptions: up.length > 0
      ? []
      : runtimes.filter(r => r.available).flatMap(r => startOptionsFor(r.id, s, { centralPlan: facts.centralPlan })),
    // …and its mirror: nothing to restart until something is running.
    restartOptions: up.length > 0 ? restartOptionsFor(id, up, s, facts.rebuild ?? {}) : [],
    stopOptions: up.length > 1
      ? up.map(r => ({ runtime: r.id, label: s.stopRuntime(r.kind) }))
      : [],
  }
}

/**
 * `systemctl --user is-enabled` answers, mapped onto the three things the screen can say.
 *
 * PURE, and deliberately exhaustive on the KNOWN answers only: anything systemd does not recognise
 * — `not-found`, an empty line, an error it printed to stderr, a version that invents a new word —
 * comes back `undefined`, which the detail pane renders as no boot row at all. The one answer this
 * function may never invent is "off", because a user who reads that installs a boot unit they
 * already have.
 */
export function parseBootState(out: string): BootState | undefined {
  const word = out.trim().split('\n')[0]?.trim() ?? ''
  // `linked`/`enabled-runtime` are enabled by another name; `alias` follows its target, so it is
  // only ever reported for a unit that IS installed.
  if (word === 'enabled' || word === 'enabled-runtime' || word === 'linked' || word === 'linked-runtime') return 'on'
  if (word === 'disabled' || word === 'masked' || word === 'masked-runtime') return 'off'
  return undefined
}

/**
 * Does this AUTOSTART MODE come back after a reboot?
 *
 * Only Linux can be asked: `enableAutostart` writes a systemd USER unit, and macOS (launchd) and
 * Windows are not wired up at all — so on those platforms the honest answer is silence, which costs
 * one `platform()` check rather than a subprocess that would fail anyway.
 *
 * Named by MODE rather than by service: `agentistics` now has TWO distinct boot mechanisms
 * (`agentop-server` for the native runtime, `agentop-machine` for the Docker one), and a single
 * `service`-keyed probe could only ever answer for one of them — the same reason `enableBoot` now
 * needs to know which runtime asked.
 */
async function bootState(mode: AutostartMode): Promise<BootState | undefined> {
  if (platform() !== 'linux') return undefined
  const r = await sh(['systemctl', '--user', 'is-enabled', `agentop-${mode}`])
  // systemctl prints the state to stdout even when it exits non-zero, so the code is not the
  // signal — the word is. A missing binary answers 127 with nothing, which parses to `undefined`.
  return parseBootState(r.out)
}

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(600) })
    return res.ok
  } catch {
    return false
  }
}

async function dockerIds(filter: string): Promise<string[]> {
  const r = await sh(['docker', 'ps', '-q', '-f', filter])
  return r.out.split(/\s+/).filter(Boolean)
}

async function detectRuntimes(): Promise<RuntimeUp> {
  const [local, central, machine] = await Promise.all([
    isServerRunning(),
    dockerIds(CENTRAL_FILTER).then((i) => i.length > 0),
    dockerIds(MACHINE_FILTER).then((i) => i.length > 0),
  ])
  return { local, central, machine }
}

/** The running runtimes, in canonical order — the input every target resolution needs. */
async function runningRuntimes(): Promise<RuntimeId[]> {
  const up = await detectRuntimes()
  return RUNTIME_ORDER.filter(id => up[id])
}

/** Is exactly this runtime up? Used where probing all three would be wasted work. */
async function isRuntimeUp(id: RuntimeId): Promise<boolean> {
  if (id === 'local') return isServerRunning()
  return (await dockerIds(id === 'central' ? CENTRAL_FILTER : MACHINE_FILTER)).length > 0
}

/**
 * A container's state, distinguishing "not running" from "we could not tell" from "impossible here".
 *
 * Reporting `down` when docker's daemon is unreachable would be a lie the user then acts on —
 * starting a central that is already up, or believing one stopped. `sh` answers 127 when the binary
 * cannot be spawned at all and a non-zero code when docker itself refused, and those two are NOT
 * the same fact: with no docker installed there is no container to be uncertain about, so the
 * runtime is reported unavailable and stops colouring its service's state (and stops being offered
 * as a start that could not possibly work). With docker present but silent we still know nothing.
 */
async function dockerState(
  filter: string,
  s: CliStrings,
): Promise<{ state: ServiceState; reason?: string; available: boolean }> {
  const r = await sh(['docker', 'ps', '-q', '-f', filter])
  if (r.code === 127) return { state: 'unknown', reason: s.dockerMissing, available: false }
  if (r.code !== 0) return { state: 'unknown', reason: s.dockerUnreachable, available: true }
  return { state: r.out.split(/\s+/).filter(Boolean).length > 0 ? 'up' : 'down', available: true }
}

// stopping

/** Parse `lsof -ti` output into a pid list, dropping blanks and the caller's OWN
 *  pid. The health check (`isServerRunning` → fetch to PORT) leaves a keep-alive
 *  client socket open, so `lsof -ti tcp:PORT` returns the CLI's own pid alongside
 *  the server's — killing the raw list SIGTERM'd the CLI itself before it could
 *  restart the server. */
export function pidsToKill(lsofOut: string, selfPid: number): string[] {
  const self = String(selfPid)
  return lsofOut.split(/\s+/).filter(Boolean).filter((pid) => pid !== self)
}

/**
 * The pids listening on the api port, which is what "the local server" means here.
 *
 * One mechanism, two readers: the stop path kills this list and the control center's detail pane
 * names its first entry. A second way of finding the server would eventually disagree with this
 * one, and then the screen would offer to stop a process it is not showing.
 */
async function listeningServerPids(): Promise<string[]> {
  // `-sTCP:LISTEN` targets only the listening server, never a client connection
  // (e.g. our own health-check socket); pidsToKill drops our pid as a safety net.
  const lsof = await sh(['lsof', '-ti', `tcp:${PORT}`, '-sTCP:LISTEN'])
  return pidsToKill(lsof.out, process.pid)
}

/**
 * Elapsed-seconds output from `ps`, in either spelling it comes in.
 *
 * `-o etimes=` prints whole seconds and is a GNU/procps extension; BSD `ps` (macOS) only knows
 * `-o etime=`, which prints `[[DD-]HH:]MM:SS`. Anything else — an error line, an empty answer from
 * a pid that has just exited — is `undefined`, so the caller reports no uptime instead of a zero.
 */
export function parseElapsedSeconds(out: string): number | undefined {
  const text = out.trim()
  if (/^\d+$/.test(text)) return Number(text)
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text)
  if (!m) return undefined
  const secs = Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)
  return Number.isFinite(secs) ? secs : undefined
}

/** When a native process started, as epoch ms, or `undefined` when the OS would not say. */
async function processStartedAt(pid: number): Promise<number | undefined> {
  const primary = await sh(['ps', '-o', 'etimes=', '-p', String(pid)])
  let secs = primary.code === 0 ? parseElapsedSeconds(primary.out) : undefined
  if (secs === undefined) {
    const fallback = await sh(['ps', '-o', 'etime=', '-p', String(pid)])
    secs = fallback.code === 0 ? parseElapsedSeconds(fallback.out) : undefined
  }
  // Derived from an elapsed time rather than read directly, so it is accurate to the second — which
  // is a thousand times finer than the coarsest unit any uptime is ever rendered in.
  return secs === undefined ? undefined : Date.now() - secs * 1000
}

/** What `docker inspect` can tell us about a running container, each part independently absent. */
export interface ContainerFacts {
  pid?: number
  startedAt?: number
  /** Host port the container's 47291 is published as; absent under host networking. */
  hostPort?: number
}

/**
 * The one-line inspect template, and its parser.
 *
 * `range` over the port map rather than indexing into it: a template that indexes a key which does
 * not exist FAILS the whole command, and the machine container runs on host networking, so asking
 * for its published port that way would cost us its pid and start time as well.
 */
const INSPECT_FORMAT =
  '{{.State.Pid}}|{{.State.StartedAt}}|{{range $p, $c := .NetworkSettings.Ports}}{{range $c}}{{$p}}={{.HostPort}} {{end}}{{end}}'

export function parseContainerFacts(out: string, containerPort: string = CONTAINER_APP_PORT): ContainerFacts {
  const [rawPid = '', rawStarted = '', rawPorts = ''] = out.trim().split('|')
  const pid = Number(rawPid.trim())
  // A container that is not running inspects as pid 0 and as the zero time `0001-01-01T00:00:00Z`
  // — both are real values that are not facts, so they are filtered rather than rendered.
  const started = Date.parse(rawStarted.trim())
  const mapping = rawPorts.trim().split(/\s+/).find(p => p.startsWith(`${containerPort}=`))
  const hostPort = mapping ? Number(mapping.slice(containerPort.length + 1)) : Number.NaN
  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : undefined,
    startedAt: Number.isFinite(started) && started > 0 ? started : undefined,
    hostPort: Number.isInteger(hostPort) && hostPort > 0 ? hostPort : undefined,
  }
}

/** Inspect the first container matching `filter`. Every failure path yields an empty answer. */
async function containerFacts(filter: string): Promise<ContainerFacts> {
  const ids = await dockerIds(filter)
  const id = ids[0]
  if (!id) return {}
  const r = await sh(['docker', 'inspect', '-f', INSPECT_FORMAT, id])
  if (r.code !== 0) return {}
  return parseContainerFacts(r.out)
}

/**
 * The native server's pid and start time.
 *
 * Only the first listener is named: a second pid on that port means something we did not start is
 * also there, and picking one of several to call "the server" is a guess the detail pane should not
 * be making on the user's behalf. Without lsof there are no pids at all, and both fields stay away.
 */
interface ProcessFacts { pid?: number; startedAt?: number }

async function nativeServerFacts(): Promise<ProcessFacts> {
  const pid = Number((await listeningServerPids())[0])
  if (!Number.isInteger(pid) || pid <= 0) return {}
  return { pid, startedAt: await processStartedAt(pid) }
}

async function stopLocal(s: CliStrings): Promise<void> {
  process.stdout.write(`  ${D}${s.stoppingLocal}${R}\n`)
  const pids = await listeningServerPids()
  if (pids.length) { for (const pid of pids) await sh(['kill', pid]) }
  else await sh(['pkill', '-f', 'agentop server'])
  for (let i = 0; i < 20; i++) { if (!(await isServerRunning())) return; await sleep(150) }
}

async function stopContainers(filter: string, msg: string): Promise<void> {
  const ids = await dockerIds(filter)
  if (!ids.length) return
  process.stdout.write(`  ${D}${msg}${R}\n`)
  await sh(['docker', 'stop', ...ids])
}

// run methods
function serverReinvocation(): string {
  const script = process.argv[1]
  const fromSource = !!script && (script.endsWith('.ts') || script.endsWith('.js'))
  return fromSource ? `"${process.execPath}" "${script}" server` : `"${process.execPath}" server`
}

/** Detach a server into the background. Silent: the caller is the one that knows whether it may
 *  print (the control center reports through the status line instead). Returns the log path. */
function startBackground(): string {
  const child = spawn('sh', ['-c', `nohup ${serverReinvocation()} >> "${SERVER_LOG}" 2>&1 &`], { stdio: 'ignore', detached: true })
  child.unref()
  return SERVER_LOG
}

/** The machine container's compose file, which only exists inside a repo checkout. */
function machineComposePath(): string {
  return join(process.cwd(), 'docker-compose.machine.yml')
}

/**
 * Build + start the machine container, STREAMED into the control center's pane.
 *
 * It used to run suspended, with the child inheriting the real tty and `tty()` writing the lines
 * around it past the mute a suspension installs. Now the child is piped and these lines are plain
 * `process.stdout` writes: the caller runs this inside `streamOutput`, which diverts them onto the
 * output channel, so the whole thing — the notice, the build, the addresses — arrives as pane lines
 * in the order they were said, and the screen never has to be given up.
 */
async function startDocker(s: CliStrings): Promise<number> {
  const compose = machineComposePath()
  if (!(await Bun.file(compose).exists())) {
    // Diverted like everything else here, so the REASON lands in the pane rather than in a status
    // line that has room for one sentence.
    process.stderr.write(`  ${YE}${s.noComposeFrom(process.cwd())}${R}\n  ${s.runFromRepo}\n`)
    return 1
  }
  process.stdout.write(`  ${D}${s.buildingMachine}${R}\n`)
  const code = await streamCommand(['docker', 'compose', '-f', compose, 'up', '-d', '--build'])
  if (code === 0) {
    process.stdout.write(
      `\n  ${GR}${s.containerUp}${R}\n` +
      `  ${D}${s.webLabel}:${R}  ${CY}http://localhost:${WEB_PORT}${R}\n` +
      `  ${D}${s.bootLabel}:${R} ${s.bootNote}\n`,
    )
  }
  return code
}

/**
 * Build + start the machine container ATTACHED — `docker compose up --build` with no `-d`, so this
 * terminal streams its logs directly and Ctrl-C stops the container (the standard, unsurprising
 * meaning of "run it in the foreground" for a compose service).
 *
 * Run under `suspend()`, the same wrapper `central.sh init` uses: not because this asks a question,
 * but because it needs the REAL tty for the same reason a question does — Ctrl-C has to reach the
 * child, which a piped/streamed child (Ink still owns the keyboard) cannot receive. `tty()` is used
 * for the notices around it because `suspend()` mutes `process.stdout.write`; the child's own
 * output bypasses that mute entirely by inheriting the real fd.
 */
async function startDockerForeground(s: CliStrings): Promise<number> {
  const compose = machineComposePath()
  if (!(await Bun.file(compose).exists())) {
    tty(`\n  ${YE}${s.noComposeFrom(process.cwd())}${R}\n  ${s.runFromRepo}\n`)
    return 1
  }
  tty(`\n  ${D}${s.buildingMachine}${R}\n`)
  return new Promise<number>(resolve => {
    const child = spawn('docker', ['compose', '-f', compose, 'up', '--build'], { stdio: 'inherit' })
    child.on('exit', c => resolve(c ?? 1))
    child.on('error', () => resolve(1))
  })
}

/**
 * The "a server is already running — kill it?" gate, for the FOREGROUND handover.
 *
 * Foreground is the one path that still runs on the real terminal (the control center has exited
 * by then), so the confirmation is asked the way it always was. The background path asks the same
 * question inside the control center, as an Ink prompt, and calls `stop('local')` on a yes.
 */
async function clearPortOrAbort(s: CliStrings, localRunning: boolean): Promise<boolean> {
  if (!localRunning) return true
  process.stdout.write(`\n  ${YE}${s.alreadyRunning(`${CY}http://localhost:${WEB_PORT}${R}${YE}`)}${R}\n`)
  if (!(await confirm(s.confirmKill, false))) {
    process.stdout.write(`  ${D}${s.leftRunning}${R}\n`)
    return false
  }
  await stopLocal(s)
  return true
}

// restart (per-service helpers)
// `rebuild` (from `--rebuild`, or from a `RestartOption` the control center offered) makes a NEW
// build before bouncing: the native binary is recompiled, a Docker image is rebuilt and recreated.
/**
 * Is this a repo checkout? The one thing the native rebuild cannot do without.
 *
 * Asked in two places — before OFFERING the rebuild (`RebuildAbility`) and before running it — and
 * they have to agree, so there is one function rather than two copies of the same path.
 */
export async function inRepoCheckout(): Promise<boolean> {
  return Bun.file(join(process.cwd(), 'packages/server/bin/cli.ts')).exists()
}

/** How a rebuild is allowed to talk: the user's terminal, or the control center's output channel. */
export interface RunMode {
  /** Pipe every child and publish its output as pane lines instead of inheriting the terminal. */
  stream?: boolean
}

/** Rebuild + reinstall the native binary from the repo (`bun run bin`: web build → embed assets →
 *  compile → install to ~/.local/bin/agentop). Returns 'not-repo' when not run from a checkout. */
export async function rebuildNativeBinary(mode: RunMode = {}): Promise<'built' | 'not-repo' | 'failed'> {
  if (!(await inRepoCheckout())) return 'not-repo'
  // Inside the control center the build is watched in a pane, so its output is piped; from the
  // plain `agentop restart --rebuild` it belongs on the terminal the user is looking at.
  const code = mode.stream
    ? await streamCommand(['bun', 'run', 'bin'], { cwd: process.cwd() })
    : await new Promise<number>(resolve => {
        const child = spawn('bun', ['run', 'bin'], { cwd: process.cwd(), stdio: 'inherit' })
        child.on('exit', c => resolve(c ?? 1))
      })
  return code === 0 ? 'built' : 'failed'
}

/** What a restart is doing, and how it is allowed to talk. */
interface RestartMode extends RunMode {
  rebuild?: boolean
  /** What the user said about the setup prompt and the Docker cache (`rebuild-flags.ts`). */
  flags?: RebuildFlags
}

/** Returns whether the local server actually came back up. `startBackground` is fire-and-forget
 *  by design (it detaches and returns immediately) — without polling the health endpoint here, a
 *  freshly (re)compiled binary that crashes on boot, or a port still held by the process just
 *  killed, was reported as a successful restart with nothing left listening. */
async function restartLocalSvc(s: CliStrings, mode: RestartMode = {}): Promise<boolean> {
  // With a rebuild, actually rebuild the native binary (web + embedded assets) so the restart
  // serves the new frontend/code — not just bounce the old build. Needs the repo checkout.
  if (mode.rebuild) {
    process.stdout.write(`  ${D}${s.rebuildingLocal}${R}\n`)
    const r = await rebuildNativeBinary(mode)
    if (r === 'not-repo') process.stderr.write(`  ${YE}${s.localRebuildHint}${R}\n`)
    else if (r === 'failed') process.stderr.write(`  ${YE}${s.localRebuildFailed}${R}\n`)
  }
  process.stdout.write(`  ${D}${s.restartingLocal}${R}\n`)
  await stopLocal(s)
  const log = startBackground()
  // A fresh compile + boot can take longer than the plain bounce this loop also covers, so it
  // gets more headroom than `stopLocal`'s symmetric wait-for-down loop (20 * 150ms).
  let up = false
  for (let i = 0; i < 40; i++) {
    if (await isServerRunning()) { up = true; break }
    await sleep(250)
  }
  if (!up) {
    process.stderr.write(`  ${YE}${s.localStartFailed}${R}\n`)
    return false
  }
  // `agentop restart --all` is a plain CLI command with no screen to report into, and it is the one
  // caller of this that the user is watching. `startBackground` fell silent when the control center
  // took it over — which left that command saying "restarted" and never where the server now is or
  // where its output went. Inside the control center these lines are swallowed by `captureOutput`
  // or by the suspension, so saying them costs the alternate screen nothing.
  process.stdout.write(
    `  ${D}${s.webLabel}:${R}  ${CY}http://localhost:${WEB_PORT}${R}\n` +
    `  ${D}${s.logsLabel}:${R} ${log}\n`,
  )
  return true
}
/** Returns whether the central actually came back up — a non-zero exit here means the old
 *  container (or none at all) is what's left running, and that must never be reported as a
 *  restart that happened. */
async function restartCentralSvc(s: CliStrings, mode: RestartMode = {}): Promise<boolean> {
  process.stdout.write(`  ${D}${mode.rebuild ? s.rebuildingCentral : s.restartingCentral}${R}\n`)
  // `up` rebuilds/pulls the image and recreates; `restart` just bounces the running container.
  // A rebuild states its answer to central.sh's setup prompt rather than relying on a piped child
  // happening to fail `[ -t 0 ]`, and rebuilds from scratch unless `--cache` was asked for.
  let code: number
  if (!mode.rebuild) {
    code = await runCentral('restart', [], { streamed: mode.stream })
  } else {
    const flags = rebuildFlags(mode.flags ?? {})
    if (flags.cache === 'fresh') process.stdout.write(`  ${D}${s.rebuildNoCache}${R}\n`)
    code = await runCentral('up', centralRebuildArgs(mode.flags ?? {}, { streamed: mode.stream }), {
      streamed: mode.stream,
    })
  }
  if (code !== 0) process.stderr.write(`  ${YE}${s.centralFailed}${R}\n`)
  return code === 0
}
/** Same contract as {@link restartCentralSvc}: false means the machine container did NOT end up
 *  running the new build (or running at all), and the caller must say so rather than "restarted". */
async function restartMachineSvc(s: CliStrings, mode: RestartMode = {}): Promise<boolean> {
  process.stdout.write(`  ${D}${mode.rebuild ? s.rebuildingMachine : s.restartingMachine}${R}\n`)
  if (mode.rebuild) {
    const compose = machineComposePath()
    if (await Bun.file(compose).exists()) {
      const flags = rebuildFlags(mode.flags ?? {})
      if (flags.cache === 'fresh') process.stdout.write(`  ${D}${s.rebuildNoCache}${R}\n`)
      // A cacheless rebuild is `build --no-cache` THEN `up` — compose's `up` has no --no-cache.
      // A failed build stops there: recreating on top of it would serve the OLD image while
      // reporting a rebuild. Every command in the sequence must exit 0, or this never happened.
      let ok = true
      for (const cmd of composeRebuildCommands(compose, flags)) {
        const code = mode.stream
          ? await streamCommand(cmd)
          : await new Promise<number>(resolve => {
              const child = spawn(cmd[0]!, cmd.slice(1), { stdio: 'inherit' })
              child.on('exit', c => resolve(c ?? 1))
            })
        if (code !== 0) { ok = false; break }
      }
      if (!ok) process.stderr.write(`  ${YE}${s.dockerStartFailed}${R}\n`)
      return ok
    }
    process.stderr.write(`  ${YE}${s.noComposeFrom(process.cwd())}${R}\n`)
    // fall through to a plain restart so the machine still comes back up
  }
  const ids = await dockerIds(MACHINE_FILTER)
  if (!ids.length) {
    process.stderr.write(`  ${YE}${s.dockerStartFailed}${R}\n`)
    return false
  }
  const { code } = await sh(['docker', 'restart', ...ids])
  if (code !== 0) process.stderr.write(`  ${YE}${s.dockerStartFailed}${R}\n`)
  return code === 0
}

/** Bounce exactly these runtimes. `rebuild` makes a new build first; `stream` pipes every child.
 *  Returns whether every targeted runtime actually came back up — a rebuild whose docker command
 *  failed leaves the old (or no) container running, and that is never a success. */
async function restartRuntimes(
  s: CliStrings,
  targets: readonly RuntimeId[],
  mode: RestartMode = {},
): Promise<boolean> {
  let ok = true
  if (targets.includes('local')) ok = (await restartLocalSvc(s, mode)) && ok
  if (targets.includes('central')) ok = (await restartCentralSvc(s, mode)) && ok
  if (targets.includes('machine')) ok = (await restartMachineSvc(s, mode)) && ok
  return ok
}

/** Non-interactive `agentop restart --all [--rebuild]`: bounce (or rebuild) every running
 *  runtime. Returns an exit code. */
/**
 * Restart the NATIVE server (`agentop restart server [--rebuild]`), whatever way it was started.
 *
 * `restartAutostart` knows exactly one way for a server to be running: a systemd user unit. But
 * the control center — and `agentop server --bg` — start a DETACHED process instead, which is the
 * common case and the one this tool sets up by default. Against that server, `restart` reported
 * "no agentop-server service is installed … install autostart first": it named the thing it could
 * not find rather than the running process it was asked to bounce, and then did nothing at all.
 * With --rebuild that is worse than nothing, because the rebuild HAD already happened and the
 * old build kept serving.
 *
 * So the way it is running decides: a unit is restarted through systemd (which is what keeps it
 * supervised), a detached process is stopped and started again — the same `restartLocalSvc` the
 * cockpit uses — and a server that is not running at all is reported as such instead of being
 * silently "restarted".
 */
export async function restartNativeServer(
  rebuild = false,
  flags: RebuildFlags = {},
): Promise<{ ok: boolean; message: string }> {
  const s = cliStrings(await resolveLang())
  const { unitInstalled, restartAutostart } = await import('./autostart')
  if (await unitInstalled('server')) {
    if (rebuild) {
      const r = await rebuildNativeBinary()
      if (r === 'not-repo') return { ok: false, message: s.localRebuildHint }
      if (r === 'failed') return { ok: false, message: s.localRebuildFailed }
    }
    return restartAutostart('server')
  }
  if (!(await isRuntimeUp('local'))) {
    return { ok: false, message: s.nothingRunning }
  }
  const ok = await restartLocalSvc(s, { rebuild, flags })
  return ok ? { ok: true, message: s.restartedDone } : { ok: false, message: s.localStartFailed }
}

export async function restartAllServices(rebuild = false, flags: RebuildFlags = {}): Promise<number> {
  const s = cliStrings(await resolveLang())
  const targets = await runningRuntimes()
  if (targets.length === 0) {
    process.stdout.write(`  ${D}○ ${s.nothingRunning}${R}\n`)
    return 0
  }
  // No stream: this is a plain command on the user's own terminal, and inherited output is right.
  const ok = await restartRuntimes(s, targets, { rebuild, flags })
  process.stdout.write(ok ? `\n  ${GR}${s.restartedAll}${R}\n` : `\n  ${YE}${s.restartFailed}${R}\n`)
  return ok ? 0 : 1
}

// ---------------------------------------------------------------------------
// Sessions — the fleet the Sessions tab draws, and the verbs it performs
// ---------------------------------------------------------------------------

/**
 * The compile-time cross-check that holds the two declarations of the session contract together.
 *
 * `SessionView`, `ProjectChoice` and `SessionState` exist TWICE: here, in the modules that compute
 * them, and in `packages/tui/src/control/types.ts`, which re-declares them structurally because
 * CLAUDE.md fixes the dependency direction as `server -> tui` — the TUI may not import
 * `packages/server/server/*`. Two declarations of one shape drift in silence: a field is added on
 * this side, the screen keeps rendering the old shape, and nothing anywhere fails.
 *
 * So the compiler is made to fail instead. `SameShape` compares the KEY SETS as well as mutual
 * assignability, because assignability alone accepts an optional field added to only one side —
 * which is exactly the shape of the drift worth catching. Anything but `true` in the tuple below is
 * a type error, and `bun tsc --noEmit` runs in the pre-commit hook.
 */
type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type SameShape<A, B> = SameType<keyof A, keyof B> extends true ? SameType<A, B> : false

export const SESSION_CONTRACT_MATCHES: [
  SameShape<SessionView, ControlSessionView>,
  SameShape<ProjectChoice, ControlProjectChoice>,
  SameType<SessionState, ControlSessionState>,
] = [true, true, true]

/**
 * Why a backend cannot run here, in the host's language.
 *
 * The backend answers in English — it is a platform module with no language of its own — and this
 * screen speaks the user's. Keyed by the backend ID rather than by matching its sentence, which
 * would silently stop translating the day the wording changes, and a `Record` so a new backend
 * cannot be added without deciding what to say about it.
 */
const BACKEND_UNAVAILABLE: Record<SessionBackend['id'], (s: CliStrings) => string | undefined> = {
  tmux: s => s.sessionsNoTmux,
  // Phase 4 (Windows). Until that backend exists there is no sentence of ours to say, and its own
  // words are then the truest thing available.
  pty: () => undefined,
}

async function backendBlocked(backend: SessionBackend, s: CliStrings): Promise<string | undefined> {
  const raw = await backend.unavailable()
  return raw ? BACKEND_UNAVAILABLE[backend.id](s) ?? raw : undefined
}

/**
 * How much of a pane the attention classifier is shown, and how many panes are read at once.
 *
 * 40 lines is what every fixture under `sessions/fixtures/` was captured at, so it is the frame the
 * rules in `attention.ts` were actually read from — asking for more would show the classifier
 * scrollback no rule was written against, and asking for less could cut a dialog in half.
 *
 * A capture is a `tmux` process, and this runs on a timer for every running session, so it is the
 * one place this feature can get expensive: the limiter bounds the burst rather than the total.
 */
const CAPTURE_LINES = 40
const CAPTURE_CONCURRENCY = 4

/**
 * What `sessionSnapshot` reads besides the backend, injectable so the composition can be exercised
 * without a registry file or a `/proc` scan. The defaults are the real thing; nothing but a test
 * passes this.
 */
export interface SessionSources {
  registry?: () => Promise<ManagedSession[]>
  processes?: () => Promise<HarnessProcess[]>
  nowMs?: () => number
}

/**
 * The whole fleet: what the registry believes, what the backend hosts, what `/proc` shows, and a
 * frame per running session for the attention classifier.
 *
 * NEVER THROWS, and never answers a bare empty list. The Sessions screen polls this on a timer, so
 * a rejection would take the control center down seconds after it opened — and an empty list
 * rendered as "nothing is running" when the truth is "nothing could be looked at" is the confident
 * zero this codebase forbids everywhere else.
 */
export async function sessionSnapshot(
  backend: SessionBackend,
  s: CliStrings,
  sources: SessionSources = {},
): Promise<SessionSnapshot> {
  try {
    const blocked = await backendBlocked(backend, s)
    if (blocked) return { views: [], unavailable: blocked }

    const [registry, hosted, processes] = await Promise.all([
      (sources.registry ?? readRegistry)(),
      backend.list(),
      (sources.processes ?? harnessProcesses)(),
    ])
    const reconciled = reconcileSessions(registry, hosted)

    // Only the ALIVE ones: this must be the same predicate `buildSessionViews` classifies on
    // (`r.backend?.alive`, not `r.status`), or the two disagree about what "running" means. An
    // `unregistered` row — the backend hosts it, the registry lost track — carries a real
    // `backend.alive` and is classified exactly like a registered running session; filtering on
    // `status === 'running'` alone skips it, and the missing capture is then substituted with an
    // empty `{ ok: true, lines: [] }` that `classifyAttention` reads as an ordinary idle frame —
    // the reassuring-direction error `attention.ts` exists to forbid, and worse than `unreadable`
    // because it never even admits the frame was never read. A `lost` session has no pane to read,
    // and an `exited` one's last frame cannot change what `buildSessionViews` already knows.
    const limit = createLimiter(CAPTURE_CONCURRENCY)
    const captures: Record<string, CaptureResult> = {}
    await Promise.all(reconciled
      .filter(r => r.backend?.alive === true)
      .map(r => limit(async () => { captures[r.id] = await backend.capture(r.id, CAPTURE_LINES) })
        // One pane failing to read must not cost the rest of the fleet their real states — that is
        // what a bare `Promise.all` did here before, collapsing every session into
        // `sessionsReadFailed` on a single rejection. `unreadable` says the truth about exactly
        // this row and nothing about the others.
        .catch(() => { captures[r.id] = { ok: false, reason: 'backend-error' } })))

    const nowMs = (sources.nowMs ?? Date.now)()
    return { views: buildSessionViews({ nowMs, reconciled, captures, processes }) }
  } catch {
    // Something under this composition failed in a way none of its modules promised to survive.
    // Saying so is the only honest answer: the list is unknown, not empty.
    return { views: [], unavailable: s.sessionsReadFailed }
  }
}

/**
 * The project picker's list, rebuilt at most every TTL.
 *
 * The wizard calls `projectChoices` on every KEYSTROKE, and building the list means reading the
 * whole consolidate store — hundreds of small JSON files. The search itself is pure and cheap, so
 * only the list is cached, in module scope: one control center per process, and a directory that
 * appears mid-wizard is worth exactly nothing to the person typing its name right now.
 */
const PROJECT_CHOICES_TTL_MS = 30_000
let projectChoiceCache: { at: number; choices: ProjectChoice[] } | null = null

async function projectChoiceList(): Promise<ProjectChoice[]> {
  const now = Date.now()
  const cached = projectChoiceCache
  if (cached && now - cached.at < PROJECT_CHOICES_TTL_MS) return cached.choices
  try {
    const store = await loadConsolidated()
    const choices = buildProjectChoices([...store.values()])
    projectChoiceCache = { at: now, choices }
    return choices
  } catch {
    // A failed read keeps whatever was already built rather than emptying the picker under the
    // cursor; with nothing built yet the list is empty, and a typed path still starts a session.
    return cached?.choices ?? []
  }
}

// ---------------------------------------------------------------------------
// Talking to the terminal while Ink owns it
// ---------------------------------------------------------------------------

/**
 * Run `fn` with process stdout/stderr handed to `sink` instead of the terminal.
 *
 * The one mechanism behind both of the ways an action's prints are dealt with: `captureOutput`
 * collects them into a string, `streamOutput` turns them into pane lines. Both streams go to the
 * same sink — the action modules interleave them (a note on stdout, a warning on stderr) and reading
 * them apart would reorder the story.
 *
 * Always restored, including when `fn` throws: a process left with a patched stdout is a process
 * that has gone silent.
 */
async function divertOutput<T>(sink: (chunk: string) => void, fn: () => Promise<T>): Promise<T> {
  const realOut = process.stdout.write.bind(process.stdout)
  const realErr = process.stderr.write.bind(process.stderr)
  const patched = ((chunk: unknown) => {
    sink(typeof chunk === 'string' ? chunk : String(chunk))
    return true
  }) as typeof process.stdout.write
  process.stdout.write = patched
  process.stderr.write = patched
  try {
    return await fn()
  } finally {
    process.stdout.write = realOut
    process.stderr.write = realErr
  }
}

/**
 * Run `fn` with stdout/stderr diverted into a string.
 *
 * The action modules (`cli-member`, the stop/restart helpers) report by printing, which is right
 * for their own CLI subcommands and fatal inside the alternate screen. Capturing keeps them
 * unchanged and turns their output into something better: the failure message shown in the status
 * line, which is otherwise a generic sentence.
 */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ value: T; text: string }> {
  const chunks: string[] = []
  const value = await divertOutput(chunk => { chunks.push(chunk) }, fn)
  return { value, text: chunks.join('') }
}

/**
 * Run `fn` with everything it and its children print flowing into the OUTPUT CHANNEL as lines.
 *
 * This is what replaced leaving the alternate screen. Two halves meet here: the children are piped
 * by `streamCommand` / `runCentral({ streamed })` and publish themselves, and the host's own prints
 * — "building & starting the machine container…", the addresses afterwards, a warning about a
 * missing compose file — are diverted through the same decoder, so the pane reads as one story in
 * the order it was told. The decoder is per-scope and flushed at the end, so a note written without
 * a trailing newline still arrives.
 */
async function streamOutput<T>(fn: () => Promise<T>): Promise<T> {
  const decoder = createLineDecoder()
  try {
    return await divertOutput(chunk => publishLines(decoder.push(chunk)), fn)
  } finally {
    publishLines(decoder.flush())
  }
}

/**
 * Write straight to the terminal's own descriptor, past whatever is patched over
 * `process.stdout`. This is how the suspend wrapper and the commands it hosts talk to the user
 * while the JS-level stream is muted.
 */
function tty(text: string): void {
  try { writeSync(1, text) } catch { /* the terminal went away — nothing to say and no one to tell */ }
}

/**
 * Swallow JS-level stdout for the duration.
 *
 * Ink keeps rendering while a command has the tty: its spinner ticks and the frame queued just
 * before we left both arrive after the alternate screen is gone, and an Ink frame is not just
 * text — it erases the lines above itself first, which here means erasing the user's real
 * scrollback. Stderr is deliberately left alone, so a command that fails still says why.
 */
async function muteStdout<T>(fn: () => Promise<T>): Promise<T> {
  const real = process.stdout.write.bind(process.stdout)
  process.stdout.write = (() => true) as typeof process.stdout.write
  try {
    return await fn()
  } finally {
    process.stdout.write = real
  }
}

const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

/** The most specific thing a captured failure said: its last non-empty line, undecorated. */
function lastLine(text: string): string {
  const lines = text.replace(ANSI_RE, '').split('\n').map(l => l.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

/** Only the shape of `altScreen` this module uses — the value arrives by dynamic import. */
interface Suspendable {
  suspend<T>(fn: () => Promise<T>): Promise<T>
}

type Suspend = <T>(fn: () => Promise<T>) => Promise<T>

/** Wait for Enter on a terminal we have just handed back to the user. */
function pauseForEnter(message: string): Promise<void> {
  return new Promise(resolve => {
    tty(`\n  ${D}${message}${R} `)
    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      if (!text.includes('\n') && !text.includes('\r')) return
      process.stdin.off('data', onData)
      resolve()
    }
    process.stdin.on('data', onData)
    process.stdin.resume()
  })
}

/**
 * Hand the real terminal to `fn`, then pause so its output can be read.
 *
 * RESERVED FOR COMMANDS THAT ASK SOMETHING. Everything whose output was merely worth watching now
 * streams into a pane instead (`streamOutput`), which is the whole point of the change: leaving the
 * alternate screen costs the user their place, and coming back costs them a keypress. What is left
 * on this path is `central.sh init`, which reads answers from the tty and refuses without one — and
 * a prompt streamed into a pane is a question nobody can answer.
 *
 * Leaving the alternate screen is only half of it: Ink is still mounted and still listening on
 * stdin in raw mode, so without detaching its `data` handlers a `q` typed at the paused prompt
 * would quit the app and every keystroke meant for the child would be read as navigation. The
 * handlers are put back exactly as they were, so Ink resumes unaware anything happened.
 */
function makeSuspend(altScreen: Suspendable, strings: () => CliStrings): Suspend {
  return async function suspend<T>(fn: () => Promise<T>): Promise<T> {
    const stdin = process.stdin
    const listeners = stdin.rawListeners('data') as Array<(chunk: Buffer) => void>
    stdin.removeAllListeners('data')
    const wasRaw = stdin.isRaw === true
    if (wasRaw) stdin.setRawMode(false)
    try {
      // The mute goes INSIDE the suspension: leaving and re-entering the alternate screen are
      // themselves stdout writes, and swallowing those would strand the terminal in one buffer.
      return await altScreen.suspend(() => muteStdout(async () => {
        try {
          return await fn()
        } finally {
          await pauseForEnter(strings().pauseMsg)
        }
      }))
    } finally {
      if (wasRaw) stdin.setRawMode(true)
      for (const listener of listeners) stdin.on('data', listener)
    }
  }
}

// ---------------------------------------------------------------------------
// ControlHost — every action the control center can ask for
// ---------------------------------------------------------------------------

/** The host, plus the language it currently speaks (runStart needs it after the app exits). */
interface StartHost extends ControlHost {
  readonly lang: CliLang
}

/** Neither question the setup wizard asks has an answer yet. Fails closed: unreadable ≠ fresh. */
async function isUnconfigured(): Promise<boolean> {
  try {
    const prefs = await readPreferences()
    return !prefs.team || resolveArchiveMode(prefs) === undefined
  } catch {
    return false
  }
}

async function tailFile(path: string, maxLines: number): Promise<string[]> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return []
    const lines = (await file.text()).split('\n')
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    return lines.slice(-maxLines)
  } catch {
    return []
  }
}

function createControlHost(initialLang: CliLang, altScreen: Suspendable): StartHost {
  let lang = initialLang
  const S = () => cliStrings(lang)
  // Built here so it always reports in the language the host is currently speaking.
  const suspend = makeSuspend(altScreen, S)

  // The update check is fired once and never awaited. `refresh()` runs on every action and on
  // every `r`, and a GitHub call on that path would stall the whole screen behind the network;
  // an answer that arrives late simply lights the header up on the next refresh.
  let latestVersion: string | undefined
  if (process.env.AGENTISTICS_NO_UPDATE_CHECK !== '1') {
    void getVersionInfo()
      .then(info => { if (info.hasUpdate) latestVersion = info.latest })
      .catch(() => { /* offline — the header simply says nothing */ })
  }

  /** Has the archive consent never been answered? Used only to append a hint, so it fails open. */
  const archivePending = async (): Promise<boolean> => {
    try {
      return resolveArchiveMode(await readPreferences()) === undefined
    } catch {
      return false
    }
  }

  /** The setting in force, for the Setup tab to state. `undefined` while it is still unanswered. */
  const currentArchiveMode = async (): Promise<ArchiveMode | undefined> => {
    try {
      return resolveArchiveMode(await readPreferences())
    } catch {
      return undefined
    }
  }

  /**
   * The service panel, in two passes: is a runtime up, and — only then — what is it.
   *
   * The second pass is skipped for anything not running, which is what keeps `refresh()` cheap on
   * the common machine where two of the three runtimes are down: no `docker inspect` for a
   * container that does not exist, no `ps` for a pid nobody found. Every fact in it is
   * independently optional and every command behind it is guarded, so a box without lsof, or with
   * docker installed but not answering, loses detail and never the screen.
   *
   * The three runtimes then fold into TWO rows, which is the whole point: `local` and `machine` are
   * one program run two ways, and `buildService` is what decides what that row says and offers.
   */
  const serviceRows = async (): Promise<ControlService[]> => {
    const s = S()
    const [local, central, machine, bootAgentistics, bootMachine, bootCentral, repo, machineCompose, centralPlan] = await Promise.all([
      isServerRunning(),
      dockerState(CENTRAL_FILTER, s),
      dockerState(MACHINE_FILTER, s),
      // Two more probes on the refresh path, both local, both guarded, both answering `undefined`
      // rather than throwing — and both skipped outright off Linux.
      bootState('server'),
      bootState('machine'),
      bootState('central'),
      // What a REBUILD would need, asked before it is offered: the native one recompiles this repo,
      // the machine one needs its compose file. Two `stat`s, and the answer is what keeps a verb
      // that cannot work off the action row.
      inRepoCheckout(),
      Bun.file(machineComposePath()).exists(),
      // Whether `central up` would be Docker or native here — the one fact that decides whether a
      // native start option even exists (see `StartFacts.centralPlan`).
      centralStartPlan(),
    ])
    const [nativeFacts, centralFacts, machineFacts] = await Promise.all([
      local ? nativeServerFacts() : Promise.resolve<ProcessFacts>({}),
      central.state === 'up' ? containerFacts(CENTRAL_FILTER) : Promise.resolve<ContainerFacts>({}),
      machine.state === 'up' ? containerFacts(MACHINE_FILTER) : Promise.resolve<ContainerFacts>({}),
    ])
    // The published port is the central's own business and never reaches a runtime row; splitting
    // it off here keeps the rows to fields `ServiceRuntimeState` actually declares.
    const { hostPort: centralPort, ...centralProc } = centralFacts
    const { hostPort: _machinePort, ...machineProc } = machineFacts

    const localUrls = { webUrl: `http://localhost:${WEB_PORT}`, apiUrl: `http://localhost:${PORT}` }

    const nativeRuntime: ServiceRuntimeState = {
      id: 'local',
      kind: 'native',
      state: local ? 'up' : 'down',
      // Nothing to install and nothing to ask: this binary is the runtime.
      available: true,
      ...(local ? { ...localUrls, ...nativeFacts } : {}),
    }
    const machineRuntime: ServiceRuntimeState = {
      id: 'machine',
      kind: 'docker',
      state: machine.state,
      available: machine.available,
      reason: machine.reason,
      // Host networking (docker-compose.machine.yml): the container's ports land directly on the
      // host, which is why it publishes nothing and its URLs are the native ones.
      ...(machine.state === 'up' ? { ...localUrls, ...machineProc } : {}),
    }
    const centralRuntime: ServiceRuntimeState = {
      id: 'central',
      kind: 'docker',
      state: central.state,
      available: central.available,
      reason: central.reason,
      // The central publishes ONE port and serves the dashboard and the api on it, so there is no
      // second URL to name — `apiUrl` is for the split the native server has, not for repeating
      // the same address under another word.
      ...(central.state === 'up'
        ? { webUrl: `http://localhost:${centralPort ?? CENTRAL_DEFAULT_PORT}`, ...centralProc }
        : {}),
    }

    return [
      buildService('agentistics', s.svcAgentistics, [nativeRuntime, machineRuntime], s, {
        // Two distinct boot mechanisms now exist for this one service (native `agentop-server` vs
        // Docker `agentop-machine`); the detail pane can only state one, so it states the one that
        // matches whichever runtime is actually up — the native unit otherwise, matching this
        // field's behavior before the Docker runtime had a boot mechanism of its own at all.
        boot: machine.state === 'up' ? bootMachine : bootAgentistics,
        rebuild: { local: repo, machine: machineCompose },
      }),
      // The central's rebuild always works: `central.sh up` inside a checkout, and the published
      // image outside one — `cli-central.ts` picks between them, and a central that is RUNNING
      // (the only state that offers a restart) has already proved whichever path it took.
      buildService('central', s.svcCentral, [centralRuntime], s, {
        boot: bootCentral,
        rebuild: { central: true },
        centralPlan,
      }),
    ]
  }

  /**
   * Which runtime a log source means, probing as little as possible.
   *
   * A log pane polls once a second, in two places, so resolving a source that names exactly one
   * runtime must cost nothing at all — and even the logical `agentistics` stops probing the moment
   * it finds a runtime up, because that is the one `logRuntime` would pick anyway.
   */
  const resolveLogRuntime = async (source: LogSource): Promise<RuntimeId> => {
    const candidates = TARGET_RUNTIMES[source]
    if (candidates.length === 1) return candidates[0]!
    const up: RuntimeId[] = []
    for (const id of candidates) {
      if (await isRuntimeUp(id)) { up.push(id); break }
    }
    return logRuntime(source, up)
  }

  const modeSentence = (s: CliStrings, mode: Mode, connections: number): string =>
    // The endpoint travels in its own field and the header prints it separately; embedding it
    // here too would render it twice. With MORE than one central the count is the fact the
    // endpoint field cannot carry on its own, so the sentence names it.
    mode === 'member' ? (connections > 1 ? s.configMembers(connections) : s.configMemberBare)
    : mode === 'central' ? s.configCentral
    : s.configSolo

  return {
    get lang() { return lang },

    async refresh(): Promise<ControlStatus> {
      const s = S()
      const [{ mode, endpoint, connections, mouse }, services] = await Promise.all([loadState(), serviceRows()])
      return {
        mode,
        modeLabel: modeSentence(s, mode, connections.length),
        // Every endpoint, not the mirror's first one: the detail pane is where the user checks
        // WHICH centrals this machine feeds, and naming one of three there reads as a machine that
        // is connected to one. `fitValue` degrades the joined list the same way it degrades a
        // single URL.
        endpoint: mode !== 'member' ? undefined
          : connections.length > 1 ? connections.map(c => c.endpoint).join(' · ')
          : (connections[0]?.endpoint ?? endpoint),
        services,
        version: CURRENT_VERSION,
        latestVersion,
        archiveMode: await currentArchiveMode(),
        mouse,
      }
    },

    /**
     * Start ONE runtime — the one the user picked off the service's own start options.
     *
     * There is no "which service?" left to decide here: the screen offers a runtime only when its
     * logical service has nothing up, so the case that produced the complaint — an offer to start a
     * container copy of a server already running natively — cannot be reached rather than being
     * refused after the fact. The port check below stays anyway, for the seconds between a refresh
     * and a keypress.
     */
    async start(req: StartRequest): Promise<ActionResult> {
      const s = S()

      if (req.runtime === 'central') {
        const plan = await centralStartPlan()
        // Native + background is the one shape that neither streams nor suspends: it returns
        // immediately with the server detached, so its own prints (which side, which port, the log
        // path) are just captured for the status line like any other quick action.
        if (plan === 'native' && req.how === 'bg') {
          const { value: code } = await captureOutput(() => runCentral('up', [], { detached: true }))
          return code === 0
            ? { ok: true, message: s.centralStarted }
            : { ok: false, message: s.centralFailed }
        }
        // Asked BEFORE it is run, because the answer decides who gets the terminal. A first-ever
        // central (`init`) has questions, a native foreground start becomes a server that never
        // exits until Ctrl-C — both need the real tty. Everything else is docker compose with
        // nothing to answer, which is what the pane is for.
        const streamable = plan === 'script' || plan === 'image'
        const code = streamable
          ? await streamOutput(() => runCentral('up', [], { streamed: true }))
          : await suspend(() => runCentral('up', []))
        return code === 0
          ? { ok: true, message: s.centralStarted }
          : { ok: false, message: s.centralFailed }
      }

      if (req.runtime === 'machine') {
        // Foreground needs the real tty (Ctrl-C has to reach the child), so it is suspended in
        // place rather than streamed — it never reports `foregroundLater`/exits the control center
        // the way `local`'s foreground does, because a container start does not need to become
        // this PROCESS's own foreground job to give the user a live, interruptible view of it.
        const code = req.how === 'fg'
          ? await suspend(() => startDockerForeground(s))
          : await streamOutput(() => startDocker(s))
        return code === 0
          ? { ok: true, message: s.containerUp }
          : { ok: false, message: s.dockerStartFailed }
      }

      // Foreground can only start once we no longer own the tty, so the control center reports it
      // as an exit and `runStart` takes over; this branch is unreachable from the Ink layer.
      if (req.how === 'fg') return { ok: false, message: s.foregroundLater }

      // The control center asks about a port collision before it ever gets here (and stops the
      // old server itself if the user says so), so reaching this means one came up in between.
      // Killing a server the user was never asked about is not a substitute for the question.
      if (await isServerRunning()) {
        return { ok: false, message: `${s.alreadyRunning(`http://localhost:${WEB_PORT}`)} ${s.useRestartInstead}` }
      }

      startBackground()
      const hint = (await archivePending()) ? ` · ${s.archiveUnsetHint}` : ''
      return { ok: true, message: `${s.startedBg} http://localhost:${WEB_PORT}${hint}` }
    },

    async connect(v): Promise<ActionResult> {
      const s = S()
      const { value: code, text } = await captureOutput(() =>
        memberConnect({ endpoint: v.endpoint, token: v.token, org: v.org || undefined }),
      )
      if (code === 0) return { ok: true, message: s.connected }
      return { ok: false, message: lastLine(text) || s.connectFailed }
    },

    /**
     * Leave a central — and with several connected, WHICH one is a question.
     *
     * `memberLeave()` handles 0/1/N itself and refuses to guess `connections[0]`; its N-connection
     * branch opens a picker, so that case goes through `suspend` (a question needs the real tty —
     * a prompt captured into the status line is one nobody can answer, and Ink still owns the
     * keyboard). One connection asks nothing and stays captured, which is the common path.
     *
     * The message is derived from what is LEFT afterwards rather than asserted: "back to solo" was
     * simply false when a machine that fed three centrals left one.
     */
    async disconnect(): Promise<ActionResult> {
      const s = S()
      const before = (await loadState()).connections.length
      const { code, text } = before > 1
        ? { code: await suspend(() => memberLeave()), text: '' }
        : await captureOutput(() => memberLeave()).then(r => ({ code: r.value, text: r.text }))
      if (code !== 0) return { ok: false, message: lastLine(text) || s.disconnectFailed }
      const after = (await loadState()).connections.length
      return { ok: true, message: after > 0 ? s.stillConnected(after) : s.disconnected }
    },

    /**
     * Bounce whatever the target names, resolved against what is RUNNING.
     *
     * The resolution is the reason the screen can stop naming runtimes: `restart('agentistics')`
     * bounces the native server or the container, whichever is actually up — and both of them when
     * they are in conflict, which is the only honest reading of "restart it". Naming something that
     * is not running is answered plainly instead of reported as a restart that never happened.
     */
    async restart(target: ActionTarget, rebuild = false): Promise<ActionResult> {
      const s = S()
      const targets = targetRuntimes(target, await runningRuntimes())
      if (targets.length === 0) return { ok: false, message: s.svcNotRunning }
      /**
       * Streamed when there is something to WATCH: a rebuild, or anything going through docker
       * compose. A native bounce says three lines and its outcome is the status line, so it stays
       * captured — the output pane must not take over the detail region for the most common action
       * on this screen. The central used to be suspended here for the opposite reason (its child
       * inherited the terminal and wrote past any capture); piping it is what removed that.
       */
      const watchable = rebuild || targets.includes('central') || targets.includes('machine')
      const work = () => restartRuntimes(s, targets, { rebuild, stream: watchable })
      const ok = watchable ? await streamOutput(work) : (await captureOutput(work)).value
      if (!ok) return { ok: false, message: s.restartFailed }
      return { ok: true, message: target === 'all' ? s.restartedAll : s.restartedDone }
    },

    async stop(target: ActionTarget): Promise<ActionResult> {
      const s = S()
      const targets = targetRuntimes(target, await runningRuntimes())
      if (targets.length === 0) return { ok: false, message: s.svcNotRunning }
      await captureOutput(async () => {
        if (targets.includes('local')) await stopLocal(s)
        if (targets.includes('central')) await stopContainers(CENTRAL_FILTER, s.stoppingCentral)
        if (targets.includes('machine')) await stopContainers(MACHINE_FILTER, s.stoppingMachine)
      })
      return { ok: true, message: target === 'all' ? s.stoppedAll : s.stoppedDone }
    },

    // `solo` is the only mode a preference write can establish on its own: central and member
    // both need a real action to succeed first (`initCentral`, `connect`), which writes it.
    async setMode(): Promise<ActionResult> {
      const s = S()
      /**
       * Going solo with centrals attached is a LEAVE, not a preference write.
       *
       * `{ ...DEFAULT_TEAM }` carries an explicit `connections: []`, which `mergeTeamPayload`
       * honours as a replacement of the whole array — so this used to drop every connection AND
       * every token in one write. A member token is minted on the central and stored nowhere else
       * on this machine, so that is unrecoverable without re-minting one per central; worse, each
       * central kept serving this machine's data while the machine had no way left to ask it to
       * stop. `--all` asks nothing, so it stays captured, and a leave that FAILED aborts the write
       * instead of orphaning the tokens it could not surrender.
       */
      const { connections } = await loadState()
      if (connections.length > 0) {
        const { value: code, text } = await captureOutput(() => memberLeave({ all: true }))
        if (code !== 0) return { ok: false, message: lastLine(text) || s.disconnectFailed }
      }
      try {
        await writePreferences({ team: { ...DEFAULT_TEAM } })
        return { ok: true, message: s.soloSet }
      } catch {
        return { ok: false, message: s.prefsWriteFailed }
      }
    },

    async initCentral(): Promise<ActionResult> {
      const s = S()
      // The ONE action still suspended, and the reason is not its output but its INPUT: `init` reads
      // the port, the org and the secrets from the terminal — central.sh exits rather than run
      // without a tty. Streaming it would put the questions in a pane and leave the answers nowhere.
      const code = await suspend(() => runCentral('init', []))
      return code === 0
        ? { ok: true, message: s.centralInitDone }
        : { ok: false, message: s.centralInitFailed }
    },

    async pendingArchiveMode(): Promise<ArchiveMode | null> {
      // `null` is "nothing left to ask" — the same rule as `ensureArchiveModeChosen()`, which
      // never re-asks. Otherwise the recommended default comes back as the preselected answer.
      try {
        return resolveArchiveMode(await readPreferences()) === undefined ? 'consolidate' : null
      } catch {
        // Unreadable preferences are not consent; ask rather than assume.
        return 'consolidate'
      }
    },

    async upgrade(): Promise<ActionResult> {
      const s = S()
      // A CHILD process, not `runUpgrade()` in here. That command prints — a lot, for minutes —
      // and nothing may print while the alternate buffer is live; run as a child under
      // `streamCommand` both pipes are captured and every line lands in the detail pane instead.
      // It is also what makes the self-replacement safe: the binary being overwritten is this
      // process's own, and upgrade.ts installs by rename, which a running process survives.
      const code = await streamCommand([process.execPath, 'upgrade'])
      return code === 0
        ? { ok: true, message: s.upgradeDone }
        : { ok: false, message: s.upgradeFailed(code) }
    },

    async setArchiveMode(mode: ArchiveMode): Promise<ActionResult> {
      const s = S()
      try {
        await writePreferences({ archiveMode: mode })
        return { ok: true, message: s.archiveSet(mode) }
      } catch {
        return { ok: false, message: s.prefsWriteFailed }
      }
    },

    async enableBoot(service: ServiceId, runtime?: RuntimeId): Promise<ActionResult> {
      // `agentistics` boots as the native server by default — the manual "enable boot" action row
      // (offered while the service is down, with nothing yet running to name a runtime) has always
      // meant that, and still does when `runtime` is absent. `runtime: 'machine'` is the ONE case
      // that now means something else: the option that just started the Docker runtime in the
      // background hands its own runtime back here, so answering "yes" writes the `agentop-machine`
      // unit (`docker compose … up -d`) instead of a native unit that would not match what is
      // actually running. `central` has one mechanism regardless of `runtime` — `agentop-central`
      // already runs `central.sh up` (Docker) — so it is passed through unchanged.
      const mode = service === 'central' ? 'central' : runtime === 'machine' ? 'machine' : 'server'
      const res = await enableAutostart(mode)
      // enableAutostart formats for a printed block; the status line is one row.
      return { ok: res.ok, message: res.message.split('\n').map(l => l.trim()).filter(Boolean).join(' · ') }
    },

    /**
     * Hand a URL to the desktop's browser.
     *
     * Tried in the order a box is likely to answer: `xdg-open` on Linux, `open` on macOS,
     * `cmd /c start` under WSL and Windows. Every one is spawned DETACHED with its output
     * discarded — `xdg-open` keeps a child around and its stderr would land in the alternate
     * screen Ink is repainting, which is the one thing this module may never do.
     *
     * `openUrl` is optional on `ControlHost` precisely because this can legitimately have nowhere
     * to go: on a headless box every candidate fails, we say so in one line, and the cockpit stops
     * offering the action rather than leaving a key that does nothing.
     */
    async openUrl(url: string): Promise<ActionResult> {
      const s = S()
      const candidates: string[][] = [
        ['xdg-open', url],
        ['open', url],
        // `start` is a cmd builtin, and the empty string is the window TITLE — without it cmd reads
        // a quoted URL as the title and opens nothing.
        ['cmd.exe', '/c', 'start', '', url],
      ]
      for (const cmd of candidates) {
        try {
          const p = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' })
          // A launcher that is going to fail does so immediately; one that worked has usually not
          // exited yet, and waiting for the browser itself would freeze the screen.
          const code = await Promise.race([
            p.exited,
            new Promise<number>(resolve => setTimeout(() => resolve(0), 400)),
          ])
          if (code === 0) return { ok: true, message: s.urlOpened(url) }
        } catch {
          // Not installed on this box — try the next spelling.
        }
      }
      return { ok: false, message: s.urlOpenFailed }
    },

    async setLang(next: CliLang): Promise<void> {
      lang = next
      try { await writePreferences({ lang: next }) } catch { /* best-effort */ }
    },

    // Best-effort, exactly like the language: a box that cannot write its preferences still gets
    // the toggle for this session, because the control center holds the answer itself and only
    // asks us to remember it.
    async setMouse(on: boolean): Promise<void> {
      try { await writePreferences({ mouse: on }) } catch { /* best-effort */ }
    },

    /**
     * The output channel, straight from `cli-stream.ts`.
     *
     * A pass-through rather than a second registry: the streaming helpers are module-level (one
     * control center per process), and a host that kept its own subscriber set would be a second
     * place for a line to get lost.
     */
    onOutput(handler: (line: string) => void): () => void {
      return onOutputLine(handler)
    },

    async readLog(source: LogSource, maxLines: number): Promise<string[]> {
      const runtime = await resolveLogRuntime(source)
      if (runtime === 'local') return tailFile(SERVER_LOG, maxLines)
      const ids = await dockerIds(runtime === 'central' ? CENTRAL_FILTER : MACHINE_FILTER)
      if (!ids.length) return []
      // `2>&1` inside the shell rather than two pipes read separately: a container writes to both
      // streams and reading them apart would interleave the log in the wrong order.
      const r = await sh(['sh', '-c', `docker logs --tail ${maxLines} ${ids[0]} 2>&1`])
      if (r.code !== 0) return []
      return r.out.split('\n').filter(line => line.length > 0)
    },

    // -- the sessions tab ----------------------------------------------------
    //
    // Every verb below composes the `sessions/` modules and says the outcome; none of them decides
    // anything the modules there already decide. A throw is deliberately not caught in the four
    // action verbs — the control center's `run()` turns one into a failed `ActionResult` carrying
    // the error's own message, which is more truthful than a sentence of ours guessing at it.
    // `sessions()` is the exception, because it is POLLED rather than run through `run()`.

    async sessions(): Promise<SessionSnapshot> {
      const s = S()
      // `resolveBackend()` sits OUTSIDE `sessionSnapshot`'s own try — that guard only starts once a
      // backend value exists, so a throw resolving the backend itself would still escape the "never
      // throws" contract `ControlHost.sessions()` documents. This is a polled method, not one run
      // through `run()`'s throw-to-`ActionResult` wrapper, so the guard has to live here.
      try {
        return await sessionSnapshot(await resolveBackend(), s)
      } catch {
        return { views: [], unavailable: s.sessionsReadFailed }
      }
    },

    async startSession(req: NewSessionRequest): Promise<ActionResult & { id?: string }> {
      const s = S()
      const backend = await resolveBackend()
      const blocked = await backendBlocked(backend, s)
      if (blocked) return { ok: false, message: blocked }

      const started = await startManagedSession(req, backend)
      if (started.ok) {
        return { ok: true, id: started.id, message: s.sessionStarted(req.harness, started.id) }
      }
      // A plan error is a rule about what the harness supports, worded once for both front ends;
      // a spawn failure is the backend's own sentence, which has no localized form.
      return {
        ok: false,
        message: started.kind === 'plan'
          ? explainSpawnError(started.error, s)
          : s.sessionStartFailed(started.message),
      }
    },

    async killSession(id: string): Promise<ActionResult> {
      const s = S()
      const backend = await resolveBackend()
      const blocked = await backendBlocked(backend, s)
      if (blocked) return { ok: false, message: blocked }

      switch (await killManagedSession(id, backend)) {
        case 'killed': return { ok: true, message: s.sessionKilled(id) }
        // Not "killed anyway": the entry was kept on purpose, and the row stays so the user can
        // see what is still there and try again.
        case 'unconfirmed': return { ok: false, message: s.sessionKillUnconfirmed(id) }
        case 'not-found': return { ok: false, message: s.sessionGone(id) }
      }
    },

    /**
     * A label and a note are registry METADATA, so neither verb touches the backend: an
     * `unregistered` row (the backend hosts it, the registry never knew it) has nothing to patch
     * and is told so, and a `lost` one — the tmux server was restarted — can still be tidied up.
     */
    async renameSession(id: string, label: string): Promise<ActionResult> {
      const s = S()
      return (await patchSession(id, { label }))
        ? { ok: true, message: s.sessionRenamed(label) }
        : { ok: false, message: s.sessionNotRegistered }
    },

    async noteSession(id: string, note: string): Promise<ActionResult> {
      const s = S()
      return (await patchSession(id, { note }))
        ? { ok: true, message: s.sessionNoted }
        : { ok: false, message: s.sessionNotRegistered }
    },

    /**
     * The argv, or `null` — and the liveness check is what makes the `null` mean something.
     *
     * `SessionView.attachable` already says this, and the screen offers the verb accordingly; this
     * is the same question asked again at the moment of the keypress, because a session can exit
     * between two polls and handing back an argv for a session that is gone would hand the user a
     * terminal takeover that dies immediately.
     */
    async attachCommand(id: string): Promise<string[] | null> {
      const backend = await resolveBackend()
      if (await backend.unavailable()) return null
      const alive = (await backend.list()).some(b => b.id === id && b.alive)
      return alive ? backend.attachCommand(id) : null
    },

    async detachHint(): Promise<string> {
      return (await resolveBackend()).detachHint()
    },

    async projectChoices(query: string, limit: number): Promise<ProjectChoice[]> {
      return searchProjects(await projectChoiceList(), query, limit)
    },

    /**
     * DERIVED from `SPAWN_SPECS`, never a second list: a harness with no spec is absent here, so
     * the wizard cannot offer a start that `planSpawn` would refuse by name a keypress later.
     */
    async sessionHarnesses(): Promise<HarnessChoice[]> {
      return STARTABLE_HARNESSES.map(id => {
        // Non-null by construction: `STARTABLE_HARNESSES` is exactly the ids whose spec is not null.
        const spec = SPAWN_SPECS[id]!
        return {
          id,
          // The harness id IS the word — it is what the CLI prints, what the docs use and what the
          // user types. Untranslated for the same reason `native`/`docker` are.
          label: id,
          models: spec.modelSuggestions,
          efforts: spec.efforts ?? [],
        }
      })
    },
  }
}

// ---------------------------------------------------------------------------

/**
 * `agentop` / `agentop start` — open the control center, then act on how it exited.
 *
 * Without an interactive stdin nothing is drawn at all: the caller runs the server, exactly as a
 * systemd unit or a pipe has always done.
 */
export async function runStart(): Promise<StartResult> {
  if (!process.stdin.isTTY) return 'foreground'

  const lang = await resolveLang()
  const [{ runControlCenter }, { altScreen }] = await Promise.all([
    import('@agentistics/tui/control'),
    import('@agentistics/tui/control/altScreen'),
  ])

  const host = createControlHost(lang, altScreen)

  // A machine that has never been configured opens on Setup rather than on Services. Bare
  // `agentop` used to run the wizard outright; the control center replaced that, and landing an
  // unconfigured user on a list of services to start would leave the mode and the history-
  // preservation consent — the two things the wizard existed to ask — behind a tab they have no
  // reason to look for.
  const exit = await runControlCenter({ lang, host, tab: (await isUnconfigured()) ? 'setup' : undefined })
  if (exit.kind !== 'foreground') return exit.code

  // The terminal is ours again, so the two questions the foreground start has always asked can be
  // asked the way they always were — and in the same order: free the port first (a refusal aborts
  // the start), then the archive consent, which must not be answered for a server that never runs.
  const s = cliStrings(host.lang)
  if (!(await clearPortOrAbort(s, await isServerRunning()))) return 0
  await ensureArchiveModeChosen()
  return 'foreground'
}
