/**
 * cli-central.ts — the `agentop central …` command handler.
 *
 * Two paths, chosen automatically:
 *
 *  1. REPO path — when a `central.sh` is found in the agentistics checkout (dev, or running
 *     `agentop central` from inside the repo). We just shell out to that script, inheriting
 *     stdio so its interactive prompts and log streaming work naturally. Behavior unchanged.
 *
 *  2. STANDALONE path — the compiled binary run from ANY directory, with no repo present.
 *     We can't build the image from source, so we materialize a small Docker Compose that
 *     PULLS the published central image (ghcr.io/blpsoares/agentistics:<version>) into
 *     ~/.agentistics/central/, generate central.env interactively on first run, and drive
 *     `docker compose` directly — no repo, no clone required.
 *
 * Either path can also be STREAMED (`CentralRunOptions.streamed`), which is how the control center
 * runs it: children are piped instead of inheriting the terminal, so their output can be shown
 * inside a pane rather than over the frame Ink is painting. A streamed run asks NOTHING — see
 * `planCentralStart`, which is how a caller knows whether the action it wants has a question in it.
 */

import { existsSync } from 'fs'
import { mkdir, writeFile, chmod } from 'fs/promises'
import { randomBytes } from 'crypto'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { version as APP_VERSION } from '../../../package.json'
import { input, confirm, select } from './cli-ui'
import { createChunkSink, pumpStream } from './cli-stream'

/** The central.sh subcommands this handler forwards / implements. */
export const CENTRAL_ACTIONS = ['up', 'init', 'down', 'logs', 'status', 'restart', 'pull'] as const
export type CentralAction = (typeof CENTRAL_ACTIONS)[number]

export function isCentralAction(value: string): value is CentralAction {
  return (CENTRAL_ACTIONS as readonly string[]).includes(value)
}

/** Published central image. The tag defaults to this binary's version so the central matches
 *  the CLI; override with AGENTISTICS_IMAGE (e.g. to pin :latest or a specific build). */
const IMAGE = process.env.AGENTISTICS_IMAGE || `ghcr.io/blpsoares/agentistics:${APP_VERSION}`
const PROJECT = process.env.PROJECT || 'team-mode'
const STANDALONE_DIR = join(homedir(), '.agentistics', 'central')

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
 * How a central command is allowed to talk.
 *
 * `streamed` is set by the control center, which is drawing into the alternate screen: an inherited
 * child would write straight onto the frame Ink is repainting. The child then gets NO stdin either,
 * which is what makes central.sh take its non-interactive path (`[ -t 0 ]` is false) — see
 * `planCentralStart`, which is how the caller knows in advance that this is safe for the action it
 * is about to run.
 */
export interface CentralRunOptions {
  streamed?: boolean
}

/** stdio for a child, in the two modes: the user's terminal, or the control center's pane. */
function childIo(streamed: boolean) {
  return streamed
    ? { stdin: 'ignore' as const, stdout: 'pipe' as const, stderr: 'pipe' as const }
    : { stdin: 'inherit' as const, stdout: 'inherit' as const, stderr: 'inherit' as const }
}

/**
 * Wait for a child, publishing its piped output when there is any.
 *
 * One sink per stream — stdout and stderr are read concurrently, and a shared decoder would splice
 * a half-line of one into the other.
 */
async function awaitChild(proc: Bun.Subprocess, streamed: boolean): Promise<number> {
  if (!streamed) return proc.exited
  const out = createChunkSink()
  const err = createChunkSink()
  try {
    await Promise.all([
      pumpStream(proc.stdout as ReadableStream<Uint8Array> | null, out),
      pumpStream(proc.stderr as ReadableStream<Uint8Array> | null, err),
    ])
    return await proc.exited
  } finally {
    out.flush()
    err.flush()
  }
}

/**
 * Run `bash <repoRoot>/central.sh <action> ...extraArgs`. Returns the child's exit code.
 *
 * Normally it inherits stdio, so its interactive prompts and its log streaming pass straight
 * through. Streamed, its output is published as pane lines instead and it gets no stdin.
 */
async function runCentralRepo(
  script: string,
  action: string,
  extraArgs: string[],
  opts: CentralRunOptions,
): Promise<number> {
  const streamed = opts.streamed === true
  try {
    const proc = Bun.spawn(['bash', script, action, ...extraArgs], childIo(streamed))
    return await awaitChild(proc, streamed)
  } catch (err) {
    process.stderr.write(
      `Could not run central.sh: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 1
  }
}

/**
 * Dispatch a central action. Uses the repo's central.sh when present (unchanged behavior),
 * otherwise falls back to the standalone Docker-image path so it works from anywhere.
 */
export async function runCentral(
  action: string,
  extraArgs: string[],
  opts: CentralRunOptions = {},
): Promise<number> {
  if (!isCentralAction(action)) {
    process.stderr.write(
      `Invalid central action: ${action}. Expected one of: ${CENTRAL_ACTIONS.join(', ')}.\n`,
    )
    return 1
  }

  const script = findCentralScript()
  if (script) return runCentralRepo(script, action, extraArgs, opts)
  return runCentralStandalone(action, opts)
}

// ---------------------------------------------------------------------------
// What a `central up` would DO here — asked before it is run
// ---------------------------------------------------------------------------

/**
 * The four shapes a `central up` can take on a given box.
 *
 * The distinction the control center needs is not "repo or image" but "does this need the real
 * TERMINAL": `init` asks questions (central.sh refuses outright without a tty) and `native` becomes
 * a foreground server that never exits, so both must keep the `suspend` path. `script` and `image`
 * are pure docker compose runs with no question in them, which is exactly what a streaming pane is
 * for.
 */
export type CentralStartPlan = 'script' | 'image' | 'native' | 'init'

/**
 * PURE: which shape a `central up` takes, given what is on disk.
 *
 * A missing env file leads, whichever path we are on: both central.sh and the standalone path
 * generate it interactively on first run, and that is a question rather than a build.
 */
export function planCentralStart(facts: {
  /** A `central.sh` was found. */
  script: boolean
  /** Its env file — `central.env` — exists. */
  envFile: boolean
  /** The env file's `MONGO_URL`, for deciding Docker versus native. */
  mongoUrl: string
}): CentralStartPlan {
  if (!facts.envFile) return 'init'
  // central.sh drives compose either way: with an external DB it merely leaves the bundled Mongo
  // out. Only the standalone path can end up running the binary itself.
  if (facts.script) return 'script'
  return isBundledMongo(facts.mongoUrl) ? 'image' : 'native'
}

/** The env file central.sh would read: beside the script, honoring an ENV_FILE override. */
function repoEnvFile(script: string): string {
  return resolve(dirname(script), process.env.ENV_FILE || 'central.env')
}

/** `planCentralStart`, with the facts gathered from this box. */
export async function centralStartPlan(): Promise<CentralStartPlan> {
  const script = findCentralScript()
  const envFile = script ? repoEnvFile(script) : join(STANDALONE_DIR, 'central.env')
  const exists = existsSync(envFile)
  return planCentralStart({
    script: Boolean(script),
    envFile: exists,
    mongoUrl: exists ? (await readEnvValue(envFile, 'MONGO_URL')) ?? '' : '',
  })
}

// ---------------------------------------------------------------------------
// Standalone path — no repo, pull the published image
// ---------------------------------------------------------------------------

/** Compose file that PULLS the published image instead of building from source. Host harness
 *  dirs are intentionally NOT mounted here (self-contribution is a repo/advanced feature) so a
 *  dedicated central never fails on a missing ~/.codex etc. Values come from central.env. */
export const STANDALONE_COMPOSE = `# Generated by \`agentop central\` — pulls the published central image (no repo needed).
# Managed file: re-created on each \`agentop central up\`. Edit central.env, not this file.
services:
  mongo:
    image: mongo:7
    command: --replSet rs0
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "try { rs.status() } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] }) }"]
      interval: 10s
      timeout: 10s
      retries: 10
      start_period: 20s
    # mongo is NOT published to the host — only the app service reaches it.
    volumes:
      - mongo_data:/data/db

  app:
    image: \${AGENTISTICS_IMAGE:-ghcr.io/blpsoares/agentistics:latest}
    depends_on:
      mongo:
        condition: service_healthy
    environment:
      MONGO_URL: \${MONGO_URL:-mongodb://mongo:27017/?replicaSet=rs0}
      MONGO_DB: \${MONGO_DB:-agentistics}
      AGENTISTICS_TEAM_CENTRAL: "1"
      AGENTISTICS_TEAM_ORG: \${AGENTISTICS_TEAM_ORG:-default}
      AGENTISTICS_TEAM_PASSWORD: \${AGENTISTICS_TEAM_PASSWORD:-}
      AGENTISTICS_TEAM_SESSION_SECRET: \${AGENTISTICS_TEAM_SESSION_SECRET:-}
      AGENTISTICS_TEAM_INGEST_TOKEN: \${AGENTISTICS_TEAM_INGEST_TOKEN:-}
      PORT: "47291"
      SERVE_STATIC: "1"
    ports:
      - "\${BIND_IP:-0.0.0.0}:\${APP_PORT:-48080}:47291"
    # Writable data dir (preferences, consolidate store). A named volume so it survives the
    # \`--force-recreate\` that every \`agentop central up\` does — otherwise the archive-mode
    # consent gate + install prompt reappear on every up.
    volumes:
      - agentistics_data:/root/.agentistics
    restart: unless-stopped

volumes:
  mongo_data:
  agentistics_data:
`

const hex = (bytes: number) => randomBytes(bytes).toString('hex')

export interface CentralEnvOpts {
  port?: string
  org?: string
  /** When omitted, a random session secret is generated. */
  sessionSecret?: string
  ingestToken?: string
  bind?: string
  /** External Mongo connection string (Atlas/remote). When set, the central runs NATIVELY (no
   *  Docker, no bundled Mongo). When omitted, the bundled Docker Mongo service is used. */
  mongoUrl?: string
}

/** Connection string for the bundled Docker Mongo service (single-node replica set). */
export const BUNDLED_MONGO_URL = 'mongodb://mongo:27017/?replicaSet=rs0'

/** True when MONGO_URL targets the bundled Docker `mongo` service (→ run via Docker), as opposed
 *  to an external URI like Atlas (→ run natively, no Docker). Pure. */
export function isBundledMongo(mongoUrl: string): boolean {
  return /(?:\/\/|@)mongo:\d+/.test(mongoUrl)
}

/** Cheap validation that a string is a Mongo connection URI. Pure. */
export function looksLikeMongoUri(raw: string): boolean {
  return /^mongodb(\+srv)?:\/\/\S+/.test(raw.trim())
}

/**
 * Build the central.env contents (pure). Applies defaults (port 48080, org 'default',
 * bind 0.0.0.0) and auto-generates the session secret when not supplied.
 * Kept side-effect-free (except crypto randomness) so it is unit-testable.
 *
 * NO shared dashboard password is generated: a central authenticates ACCOUNTS
 * (owner → members), created on first boot through the one-time setup token the server
 * prints to its log. `AGENTISTICS_TEAM_PASSWORD` is the legacy pre-accounts gate and is not
 * part of this flow — writing one only makes the operator believe it is a credential they
 * need to keep and share.
 */
export function buildCentralEnv(opts: CentralEnvOpts = {}): string {
  const port = opts.port || '48080'
  const bind = opts.bind || '0.0.0.0'
  const org = opts.org || 'default'
  const sessionSecret = opts.sessionSecret || hex(32)
  const ingest = opts.ingestToken ?? ''
  const mongoUrl = opts.mongoUrl?.trim() || BUNDLED_MONGO_URL
  return (
    `# agentistics Team Mode — generated by \`agentop central\`. Holds secrets; keep it private.\n` +
    `APP_PORT=${port}\n` +
    `BIND_IP=${bind}\n` +
    `MONGO_URL=${mongoUrl}\n` +
    `MONGO_DB=agentistics\n` +
    `AGENTISTICS_TEAM_CENTRAL=1\n` +
    `AGENTISTICS_TEAM_ORG=${org}\n` +
    `AGENTISTICS_TEAM_SESSION_SECRET=${sessionSecret}\n` +
    `AGENTISTICS_TEAM_INGEST_TOKEN=${ingest}\n` +
    `AGENTISTICS_CENTRAL_USER=\n`
  )
}

/** docker compose for the standalone central, with project + env-file + compose-file pre-set. */
function composeArgs(envFile: string, composeFile: string, rest: string[]): string[] {
  return ['docker', 'compose', '-p', PROJECT, '--env-file', envFile, '-f', composeFile, ...rest]
}

async function runCompose(
  envFile: string,
  composeFile: string,
  rest: string[],
  opts: CentralRunOptions = {},
): Promise<number> {
  const streamed = opts.streamed === true
  try {
    const proc = Bun.spawn(composeArgs(envFile, composeFile, rest), {
      ...childIo(streamed),
      // Plain progress while streamed: docker's fancy renderer redraws its step table with cursor
      // moves, which a pane cannot hold — see cli-stream.ts.
      env: {
        ...process.env,
        AGENTISTICS_IMAGE: IMAGE,
        ...(streamed ? { NO_COLOR: '1', BUILDKIT_PROGRESS: 'plain' } : {}),
      },
    })
    return await awaitChild(proc, streamed)
  } catch (err) {
    process.stderr.write(
      `Could not run docker compose: ${err instanceof Error ? err.message : String(err)}\n` +
      'Is Docker installed and running?\n',
    )
    return 1
  }
}

/** Interactively generate central.env (secrets auto-filled). Called on first `up`, or `init`. */
async function initEnv(envFile: string): Promise<void> {
  process.stdout.write(`\nSetting up ${envFile} — press Enter to accept the [default] / auto-generate.\n\n`)
  const port = await input('Host port (APP_PORT)', { default: '48080' })
  const org = await input('Org name (AGENTISTICS_TEAM_ORG)', { default: 'default' })
  const bind = await input('Bind IP (BIND_IP, blank = 0.0.0.0 all interfaces)', { default: '0.0.0.0' })

  // Database: bundled Docker Mongo, or an external URI (Atlas/remote) → runs natively, no Docker.
  const db = await select<'bundled' | 'external'>({
    message: 'Database',
    choices: [
      { name: 'Bundled Mongo (Docker starts it for you)', value: 'bundled' },
      { name: 'External URI — Atlas/remote (runs natively, no Docker)', value: 'external' },
    ],
  })
  let mongoUrl: string | undefined
  if (db === 'external') {
    for (;;) {
      const uri = await input('Mongo connection URI (mongodb+srv://…)', { default: '' })
      if (looksLikeMongoUri(uri)) { mongoUrl = uri.trim(); break }
      process.stdout.write('  Invalid URI — must start with mongodb:// or mongodb+srv://\n')
    }
    process.stdout.write('  -> external DB: the central will run natively (no Docker, no local Mongo).\n')
  }

  const env = buildCentralEnv({ port, org, bind, mongoUrl })
  await writeFile(envFile, env, 'utf-8')
  await chmod(envFile, 0o600).catch(() => {})
  process.stdout.write(
    `\nWrote ${envFile} (chmod 600).\n` +
    `  No dashboard password is set here — the first thing you do in the browser is create the\n` +
    `  OWNER account, using the one-time setup token the central prints on its first boot.\n\n`,
  )
}

/** Read a single KEY=value from central.env (no full dotenv parse needed). */
async function readEnvValue(envFile: string, key: string): Promise<string | undefined> {
  try {
    const text = await Bun.file(envFile).text()
    for (const line of text.split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`))
      if (m) return m[1]
    }
  } catch { /* missing file */ }
  return undefined
}

/** Print the dashboard / central endpoint URL(s) after the central is up. */
async function printAccessUrl(envFile: string): Promise<void> {
  const port = (await readEnvValue(envFile, 'APP_PORT')) || '48080'
  const bind = (await readEnvValue(envFile, 'BIND_IP')) || '0.0.0.0'
  process.stdout.write('\nDashboard / central endpoint:\n')
  if (bind === '0.0.0.0' || bind === '') {
    process.stdout.write(`  local: http://localhost:${port}\n`)
    process.stdout.write('  Members connect to a reachable address of this host (LAN/Tailscale IP) on that port.\n')
  } else {
    process.stdout.write(`  http://${bind}:${port}\n`)
  }
  if (await needsOwnerSetup(port)) {
    const token = await readSetupTokenFromLogs()
    process.stdout.write(
      `\nFirst boot — no owner account exists yet.\n` +
      `  Open the dashboard above: it asks you to CREATE THE OWNER ACCOUNT (name, e-mail, password)\n` +
      `  plus the one-time setup token the central printed to its log.\n` +
      (token
        ? `\n  setup token: ${token}\n`
        : `\n  Read it with: docker compose -p ${PROJECT} logs app | grep -A6 "OWNER SETUP"\n`) +
      `\n  There is no shared team password — everyone else gets their own account, invited by the owner.\n`,
    )
  }
}

/**
 * The one-time setup token the server printed to its log, or null.
 * Best-effort: no Docker, no logs, or a rotated/consumed banner just yields the command hint.
 */
async function readSetupTokenFromLogs(): Promise<string | null> {
  try {
    const proc = Bun.spawn(['docker', 'compose', '-p', PROJECT, 'logs', '--no-color', 'app'], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    // The banner prints the token alone on its line; take the LAST one (a re-issued token wins).
    const matches = [...text.matchAll(/^\s*(?:\S+\s+\|)?\s*([0-9a-f]{48})\s*$/gm)]
    return matches.length > 0 ? matches[matches.length - 1]![1]! : null
  } catch {
    return null
  }
}

/**
 * True when the central is up and still has no owner account (first boot).
 * Best-effort and BOUNDED: a central that is slow to answer, or answers something unexpected,
 * simply prints no setup hint — it must never make `up` hang or fail.
 */
async function needsOwnerSetup(port: string): Promise<boolean> {
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${port}/api/iam/status`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (res.ok) {
        const body = (await res.json()) as { needsBootstrap?: unknown }
        return body.needsBootstrap === true
      }
    } catch { /* not listening yet */ }
    if (Date.now() >= deadline) return false
    await new Promise(r => setTimeout(r, 1_000))
  }
}

/** Parse the KEY=value lines of a central.env into a map (ignores comments/blanks). */
async function loadEnvFile(envFile: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const text = await Bun.file(envFile).text()
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      out[line.slice(0, eq).trim()] = line.slice(eq + 1)
    }
  } catch { /* missing file → empty */ }
  return out
}

/**
 * Native central lifecycle (external DB → no Docker): the compiled binary IS the server, so we
 * re-invoke `agentop server` with the central env. It runs in the FOREGROUND; for a background
 * service use `agentop autostart central`. Docker-style down/logs/status don't apply here.
 */
async function runNativeCentral(
  envFile: string,
  action: CentralAction,
  opts: CentralRunOptions = {},
): Promise<number> {
  const env = await loadEnvFile(envFile)
  const port = env.APP_PORT || '48080'

  // A foreground server cannot be watched from inside the control center: it never exits, so the
  // pane would stream a startup banner and then wait forever. The caller normally knows this in
  // advance (`planCentralStart` answers `native`) and keeps the terminal-handover path; this is the
  // backstop for the case where the env file changed under us between the plan and the run.
  if (opts.streamed && action === 'up') {
    process.stdout.write(
      `\nThis central uses an EXTERNAL database, so it runs NATIVELY in the foreground.\n` +
      `  Start it from a terminal:  agentop central up\n` +
      `  Or as a background service: agentop autostart central\n`,
    )
    return 1
  }

  if (action !== 'up') {
    process.stdout.write(
      `\nThis central uses an EXTERNAL database, so it runs NATIVELY (no Docker).\n` +
      `  • start:   agentop central up            (foreground — Ctrl-C to stop)\n` +
      `  • service: agentop autostart central     (run it as a background service)\n`,
    )
    return 0
  }

  process.stdout.write(`\nStarting NATIVE central (external DB) on port ${port} …\n`)
  await printAccessUrl(envFile)
  process.stdout.write('  (running in the foreground — Ctrl-C to stop)\n\n')
  try {
    // Re-invoke this same binary as `agentop server`, but in central mode on APP_PORT. The child
    // reads MONGO_URL / password / secret / org from the central.env we pass through.
    const proc = Bun.spawn([process.execPath, 'server'], {
      env: { ...process.env, ...env, PORT: port, AGENTISTICS_TEAM_CENTRAL: '1', SERVE_STATIC: '1' } as Record<string, string>,
      stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
    })
    return await proc.exited
  } catch (err) {
    process.stderr.write(`Could not start native central: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

/**
 * Standalone central lifecycle. With the bundled Mongo it materializes a compose and drives
 * `docker compose`; with an external DB (Atlas/remote) it runs the binary NATIVELY (no Docker).
 * Mirrors central.sh's commands.
 */
async function runCentralStandalone(action: CentralAction, opts: CentralRunOptions = {}): Promise<number> {
  const envFile = join(STANDALONE_DIR, 'central.env')
  const composeFile = join(STANDALONE_DIR, 'docker-compose.yml')

  // Streamed means the control center is drawing and Ink owns the keyboard, so there is no terminal
  // to ask a question with — the same thing `[ -t 0 ]` tells central.sh on the repo path.
  const isTTY = process.stdin.isTTY && opts.streamed !== true

  try {
    await mkdir(STANDALONE_DIR, { recursive: true })
  } catch (err) {
    process.stderr.write(`Could not prepare ${STANDALONE_DIR}: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }

  if (action === 'init') {
    if (!isTTY) { process.stderr.write('init needs an interactive terminal.\n'); return 1 }
    await initEnv(envFile)
    return 0
  }

  // On `up`, ensure central.env exists (prompt if TTY) BEFORE deciding Docker vs native.
  if (action === 'up') {
    if (!existsSync(envFile)) {
      if (!isTTY) { process.stderr.write(`${envFile} not found and stdin is not a TTY — run \`agentop central init\` first.\n`); return 1 }
      process.stdout.write(`${envFile} not found — let's create it.\n`)
      await initEnv(envFile)
    } else if (isTTY) {
      const rerun = await confirm(`${envFile} exists. Re-run interactive setup?`, false)
      if (rerun) await initEnv(envFile)
    }
  } else if (!existsSync(envFile)) {
    process.stderr.write(`No central configured yet at ${envFile}. Run \`agentop central up\` first.\n`)
    return 1
  }

  // External DB → run natively (no Docker); bundled → Docker compose.
  const mongoUrl = (await readEnvValue(envFile, 'MONGO_URL')) ?? ''
  if (!isBundledMongo(mongoUrl)) {
    return runNativeCentral(envFile, action, opts)
  }

  try {
    await writeFile(composeFile, STANDALONE_COMPOSE, 'utf-8')
  } catch (err) {
    process.stderr.write(`Could not write ${composeFile}: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }

  if (action === 'up') {
    process.stdout.write(`\nStarting central from image ${IMAGE} …\n\n`)
    const code = await runCompose(envFile, composeFile, ['up', '-d', '--pull', 'always', '--force-recreate'], opts)
    if (code === 0) {
      await runCompose(envFile, composeFile, ['ps'], opts)
      await printAccessUrl(envFile)
    }
    return code
  }

  switch (action) {
    case 'restart': {
      const code = await runCompose(envFile, composeFile, ['restart', 'app'], opts)
      if (code === 0) await printAccessUrl(envFile)
      return code
    }
    case 'logs':
      return runCompose(envFile, composeFile, ['logs', '-f', 'app'], opts)
    case 'status':
      return runCompose(envFile, composeFile, ['ps'], opts)
    case 'down':
      // No `-v` — the Mongo data volume is preserved.
      return runCompose(envFile, composeFile, ['down'], opts)
    case 'pull': {
      const code = await runCompose(envFile, composeFile, ['pull'], opts)
      if (code === 0) return runCompose(envFile, composeFile, ['up', '-d', '--force-recreate'], opts)
      return code
    }
  }
  return 0
}
