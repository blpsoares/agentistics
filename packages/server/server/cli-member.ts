/**
 * cli-member.ts — configure this machine as a Team Member from the CLI, no browser.
 *
 * Per spec §8 (docs/superpowers/specs/2026-07-28-multi-central-and-repo-sharing-design.md):
 * `connect` adds or UPDATES one central keyed by normalized endpoint; `leave` handles 0/1/N
 * connections (arrow-key select on a TTY, an explicit exit on a non-TTY with N and no flag —
 * never a silent `connections[0]`); `status`/`list` print one block per connection, querying the
 * LOCAL SERVER for live push status instead of `getUploaderStatus()` IN THIS PROCESS (which never
 * ran `startUploader()` and always printed "last sync: never").
 *
 * Every mutation goes through the local server's routes when one is reachable — the way
 * `nudgeLocalServer` used to, but now as the PRIMARY path, not a nudge after a raw preferences
 * write. `writePreferences({ team })` with a snapshot `connections[]` read seconds earlier would
 * clobber a browser-added central. When no server is running, this file performs the exact same
 * sequence itself (`addOrUpdateConnection`/`leaveConnectionById` from team-connections.ts) under
 * the Task 5 cross-process preferences lock, instead of writing a raw `team` block.
 *
 * A server ANSWER (any HTTP status) is authoritative and must never be silently second-guessed by
 * falling back to the direct sequence — only a genuine network failure (nothing listening, a
 * timeout) falls back. Getting this backwards was review finding I1: a 404/409/500 from the
 * server was being swallowed by a blanket try/catch and treated as "no server", so the CLI wrote
 * preferences itself behind the running server's back — exactly the write-write race HTTP-first
 * exists to prevent.
 *
 * The bearer token is never logged.
 */

import { defaultTeam, normalizeEndpointKey, unpackConnectToken, type TeamConnection } from '@agentistics/core'
import { PORT } from './config'
import { readPreferencesOrExit, type Preferences } from './preferences'
import { cliStrings, resolveLang, type CliStrings } from './cli-i18n'

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

export interface MemberConnectOptions {
  endpoint: string
  token: string
  org?: string
  label?: string
}

type ConnectResult =
  | { ok: true; action: 'insert' | 'update'; connId: string }
  // `ownerEndpoint` is set only for `reason: 'conflict'` — the endpoint of the DIFFERENT
  // connection that already holds this token (review finding N4: the message built from this
  // must name that owner, not the endpoint the caller just tried to connect to).
  | { ok: false; reason: 'conflict' | 'other'; error: string; ownerEndpoint?: string }

/** Try the local server's POST /api/team/connections first. `null` = no server reachable (a
 *  network failure, or a 404 — an OLDER local server binary that predates this route, which must
 *  fall back exactly like "no server" rather than hard-failing on a route that will never exist
 *  until the server itself is upgraded). Any OTHER answer (2xx or a real error status) is
 *  authoritative and is returned as-is, never silently bypassed. */
async function connectViaLocalServer(body: { endpoint: string; token: string; org?: string; label?: string }): Promise<ConnectResult | null> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/team/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    })
    if (res.status === 404) return null // an older server binary without this route — fall back
    const json = await res.json().catch(() => null) as { ok?: boolean; id?: string; action?: string; error?: string; ownerEndpoint?: string } | null
    if (res.ok && json?.ok && typeof json.id === 'string') {
      return { ok: true, action: json.action === 'update' ? 'update' : 'insert', connId: json.id }
    }
    return {
      ok: false,
      reason: res.status === 409 ? 'conflict' : 'other',
      error: json?.error ?? `local server returned HTTP ${res.status}`,
      ownerEndpoint: json?.ownerEndpoint,
    }
  } catch {
    return null // no local server reachable — caller falls back to the direct sequence
  }
}

/** No local server is running: perform the exact same whoami-verify + upsert sequence the route
 *  handler runs, under the Task 5 cross-process preferences lock, so a concurrently-starting
 *  server (or a second CLI invocation) cannot interleave with this write. */
async function connectDirect(body: { endpoint: string; token: string; org?: string; label?: string }): Promise<ConnectResult> {
  const { validateConnectionBody, addOrUpdateConnection } = await import('./team-connections')
  const validated = validateConnectionBody(body)
  if ('error' in validated) return { ok: false, reason: 'other', error: validated.error }
  const outcome = await addOrUpdateConnection(validated)
  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.reason === 'conflict' ? 'conflict' : 'other',
      error: outcome.error,
      ownerEndpoint: outcome.reason === 'conflict' ? outcome.ownerEndpoint : undefined,
    }
  }
  return { ok: true, action: outcome.action, connId: outcome.connId }
}

/**
 * Connect this machine to a central as a member — adds a new connection, or UPDATES an existing
 * one keyed by normalized endpoint (the token-rotation path: id/label/deniedRepos preserved).
 * Returns 0 on success, non-zero (with an actionable message) on failure.
 */
export async function memberConnect(opts: MemberConnectOptions): Promise<number> {
  // The token may embed the central URL (act1_ composite). Unpack it: --endpoint wins, else the
  // endpoint carried inside the token; the bearer sent to the central is always the raw secret.
  const { endpoint: embeddedEndpoint, secret } = unpackConnectToken((opts.token ?? '').trim())
  const token = secret
  const endpoint = ((opts.endpoint ?? '').trim() || embeddedEndpoint || '').replace(/\/+$/, '')
  const org = opts.org?.trim() || undefined
  const label = opts.label?.trim() || undefined

  const s = cliStrings(await resolveLang())

  if (!token) {
    process.stderr.write('member connect needs --token <token>.\n')
    return 1
  }
  if (!endpoint) {
    process.stderr.write('member connect needs --endpoint <url> (or a token with the URL embedded).\n')
    return 1
  }

  const body = { endpoint, token, org, label }
  const viaServer = await connectViaLocalServer(body)
  const result = viaServer ?? await connectDirect(body)

  if (!result.ok) {
    // `s.tokenInUse` must name the OWNER of the token, never the endpoint the caller just tried
    // to connect to — those are different connections (review finding N4). Fall back to the raw
    // server error only if the owner endpoint genuinely wasn't reported (should not happen in
    // practice; addOrUpdateConnection always sets it on a conflict).
    const message = result.reason === 'conflict' && result.ownerEndpoint
      ? s.tokenInUse(result.ownerEndpoint)
      : result.error
    process.stderr.write(`${message}\n`)
    return 1
  }

  const prefs = await readPreferencesOrExit()
  const connections = prefs.team?.connections ?? []
  const mine = connections.find(c => c.id === result.connId)

  if (result.action === 'update') {
    process.stdout.write(`${s.updatedExisting(endpoint)}\n`)
  }
  process.stdout.write(`${s.connectedAs(mine?.user || '?', connections.length)}\n`)
  return 0
}

// ---------------------------------------------------------------------------
// leave
// ---------------------------------------------------------------------------

export interface MemberLeaveOptions {
  endpoint?: string
  all?: boolean
}

/** Pure decision for what `memberLeave` should do, given the current connections and the parsed
 *  options — extracted so the 0/1/N/`--endpoint`/`--all`/TTY branching (spec §8) is unit-tested
 *  directly instead of only through the impure, network-touching command. `--endpoint` matches
 *  via `normalizeEndpointKey` — the SAME identity rule `connect` uses (host lowercased, default
 *  port folded) — a raw string compare here made `leave --endpoint https://Central.example.com`
 *  report not-found for a connection stored as `https://central.example.com`, even though
 *  `connect` with the identical argument correctly updates it in place (review finding I3). */
export type LeaveDecision =
  | { type: 'none' }
  | { type: 'not-found' }
  | { type: 'single'; conn: TeamConnection }
  | { type: 'all' }
  | { type: 'ambiguous' }
  | { type: 'prompt' }

export function decideLeaveTarget(
  connections: TeamConnection[],
  opts: { endpoint?: string; all?: boolean; isTTY: boolean },
): LeaveDecision {
  if (connections.length === 0) return { type: 'none' }
  if (opts.all) return { type: 'all' }
  if (opts.endpoint) {
    const norm = normalizeEndpointKey(opts.endpoint)
    const match = connections.find(c => normalizeEndpointKey(c.endpoint) === norm)
    return match ? { type: 'single', conn: match } : { type: 'not-found' }
  }
  if (connections.length === 1) return { type: 'single', conn: connections[0]! }
  return opts.isTTY ? { type: 'prompt' } : { type: 'ambiguous' }
}

type LeaveResult = { ok: true } | { ok: false; error: string }

/**
 * Try the local server's DELETE route. `null` = unreachable (network failure) — falls back to
 * the direct sequence below. Any ANSWER from the server (2xx or an error status, e.g. 404 for an
 * already-gone connection) is authoritative and is returned as-is — see the module docstring
 * (review finding I1): silently falling back on an answered error is exactly what HTTP-first
 * exists to prevent, and printing success for a 404 asserts a removal that never happened.
 *
 * Deliberately does NOT fall back to `null` on a 404 the way `connectViaLocalServer` does for an
 * older server binary predating its route — a DELETE 404 is far more often a genuine "unknown
 * connection" than a missing route, and treating it as "try the direct sequence instead" would
 * risk two very different situations (the connection is already gone vs. this server doesn't
 * even have the route) looking identical to the caller. The asymmetry is intentional; the error
 * message below says so explicitly instead of implying a specific cause ("no connection
 * matches") that may not be what happened.
 */
async function leaveViaLocalServer(connId: string, port: number): Promise<LeaveResult | null> {
  try {
    const res = await fetch(`http://localhost:${port}/api/team/connections/${encodeURIComponent(connId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(8_000),
    })
    if (res.ok) return { ok: true }
    const json = await res.json().catch(() => null) as { error?: string } | null
    if (res.status === 404 && !json?.error) {
      // A CURRENT server answers 404 for an unknown id with a real {error: "..."} JSON body
      // (handled by the branch below). No such body means the router itself has nothing to
      // match — most likely a local server binary that predates this route, but possibly a
      // genuinely unknown connection too; say the ambiguity plainly rather than guess.
      return {
        ok: false,
        error: 'the local server answered 404 with no details — either this connection is '
          + 'already gone, or the running agentop predates this route (upgrade and retry)',
      }
    }
    return { ok: false, error: json?.error ?? `local server returned HTTP ${res.status}` }
  } catch {
    return null
  }
}

/** No local server is running: perform the exact same sequence the route handler runs, under the
 *  Task 5 cross-process preferences lock. The default (real) implementation — overridable via
 *  `MemberLeaveDeps.leaveDirect` so a test can prove the local-server-vs-direct CHOICE without
 *  ever touching a real preferences file (review finding I5). */
/** Silences `removeConnection`'s own `[team-uploader] removed connection ...` line — `member
 *  leave` already prints its own "left <endpoint>" / error line for this exact event, so the
 *  default `console` logger would double it up in the user's terminal. */
const SILENT_LOG = { info: () => {}, warn: () => {} }

async function leaveDirectDefault(connId: string): Promise<LeaveResult> {
  const { leaveConnectionById } = await import('./team-connections')
  const outcome = await leaveConnectionById(connId, { log: SILENT_LOG })
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error }
}

async function leaveOne(
  conn: TeamConnection,
  deps: { port: number; leaveDirect: (connId: string) => Promise<LeaveResult> },
): Promise<LeaveResult> {
  const viaServer = await leaveViaLocalServer(conn.id, deps.port)
  return viaServer ?? await deps.leaveDirect(conn.id)
}

/** Leave several connections without letting one failure abort the batch (review finding I2 — the
 *  previous `Promise.all` meant one rejection lost `leftAll` entirely and could escape as an
 *  unhandled rejection). `leaveOne` itself never throws, but `Promise.allSettled` is still used
 *  defensively — a caller's injected `leaveDirect` in a test, or a future code path, might. */
async function leaveMany(
  connections: TeamConnection[],
  deps: { port: number; leaveDirect: (connId: string) => Promise<LeaveResult> },
): Promise<{ conn: TeamConnection; result: LeaveResult }[]> {
  const settled = await Promise.allSettled(connections.map(c => leaveOne(c, deps)))
  return connections.map((conn, i) => {
    const outcome = settled[i]!
    const result: LeaveResult = outcome.status === 'fulfilled'
      ? outcome.value
      : { ok: false, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) }
    return { conn, result }
  })
}

/** Print one line per connection's real outcome — never a blanket "left all" when some failed. */
function reportLeaveOutcomes(s: ReturnType<typeof cliStrings>, outcomes: { conn: TeamConnection; result: LeaveResult }[]): number {
  const succeeded = outcomes.filter(o => o.result.ok)
  const failed = outcomes.filter((o): o is { conn: TeamConnection; result: { ok: false; error: string } } => !o.result.ok)
  for (const o of succeeded) process.stdout.write(`${s.leftOne(o.conn.endpoint)}\n`)
  for (const o of failed) process.stderr.write(`${o.conn.endpoint}: ${o.result.error}\n`)
  if (failed.length === 0 && succeeded.length > 0) {
    process.stdout.write(`${s.leftAll(succeeded.length)}\n`)
  }
  return failed.length > 0 ? 1 : 0
}

/** Injectable for tests — see `leaveDirectDefault`'s docstring and review finding I5. `port`
 *  points `leaveViaLocalServer` at a specific local server instead of the real `PORT`, so a test
 *  can stand up a `Bun.serve` fixture on an ephemeral port. `readPreferences` overrides how the
 *  current connection list is obtained, so a test never touches the developer's real preferences
 *  file (the production default, `readPreferencesOrExit`, also prints a friendly message and
 *  exits 1 on a corrupt file — a real CLI invocation must keep that safety net). `isTTY` overrides
 *  `process.stdin.isTTY` — review finding N1: inferring it directly meant a test run under a REAL
 *  pty (a developer's own terminal, not CI's piped stdin) hit the `'prompt'` branch and drove the
 *  actual interactive `select()`, consuming that terminal's stdin and hanging for 5s. `strings`
 *  overrides the whole localized string table — review finding N2: `resolveLang()` calls
 *  `readPreferences()`, so every un-injected test silently depended on the machine's real
 *  `preferences.json`'s `lang` field and its hardcoded English assertions would fail on any
 *  machine actually configured for `pt`. */
export interface MemberLeaveDeps {
  readPreferences?: () => Promise<Preferences>
  port?: number
  leaveDirect?: (connId: string) => Promise<LeaveResult>
  isTTY?: boolean
  strings?: CliStrings
}

/**
 * Leave a central. See `decideLeaveTarget` for the exact branching. Returns 0 for the "nothing to
 * leave" / a fully successful leave; 1 for an ambiguous non-TTY N-connection call, an unmatched
 * `--endpoint`, or when leaving actually failed (a local-server error answer, or a failed direct
 * write) — leaving must succeed even if the CENTRAL itself is down, but "I don't know which
 * connection you mean" and "the removal did not actually happen" are both refused, not asserted.
 */
export async function memberLeave(opts: MemberLeaveOptions = {}, deps: MemberLeaveDeps = {}): Promise<number> {
  const _readPreferences = deps.readPreferences ?? readPreferencesOrExit
  const port = deps.port ?? PORT
  const leaveDirect = deps.leaveDirect ?? leaveDirectDefault
  const oneDeps = { port, leaveDirect }

  const prefs = await _readPreferences()
  const connections = prefs.team?.connections ?? []
  const s = deps.strings ?? cliStrings(await resolveLang())
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY)

  const decision = decideLeaveTarget(connections, { ...opts, isTTY })

  switch (decision.type) {
    case 'none':
      process.stdout.write(`${s.noConnections}\n`)
      return 0

    case 'not-found':
      process.stderr.write(`${s.noMatchEndpoint(opts.endpoint ?? '')}\n`)
      return 1

    case 'ambiguous':
      process.stderr.write(`${s.ambiguousLeave(connections.length)}\n`)
      return 1

    case 'all': {
      const outcomes = await leaveMany(connections, oneDeps)
      return reportLeaveOutcomes(s, outcomes)
    }

    case 'single': {
      const result = await leaveOne(decision.conn, oneDeps)
      if (!result.ok) {
        process.stderr.write(`${result.error}\n`)
        return 1
      }
      process.stdout.write(`${s.leftOne(decision.conn.endpoint)}\n`)
      const remaining = connections.length - 1
      if (remaining > 0) process.stdout.write(`${s.stillConnected(remaining)}\n`)
      return 0
    }

    case 'prompt': {
      const { select } = await import('./cli-ui')
      const ALL = '__all__'
      const CANCEL = '__cancel__'
      const choices: { name: string; value: string; hint?: string }[] = connections.map(c => ({
        name: c.label ?? c.endpoint,
        value: c.id,
        hint: c.user || undefined,
      }))
      choices.push({ name: s.leaveAll, value: ALL })
      choices.push({ name: s.cancel, value: CANCEL })
      const picked = await select<string>({ message: s.leaveWhich, choices })
      if (picked === CANCEL) return 0
      if (picked === ALL) {
        const outcomes = await leaveMany(connections, oneDeps)
        return reportLeaveOutcomes(s, outcomes)
      }
      const match = connections.find(c => c.id === picked)
      if (!match) return 0 // shouldn't happen — the picker only offers real ids
      const result = await leaveOne(match, oneDeps)
      if (!result.ok) {
        process.stderr.write(`${result.error}\n`)
        return 1
      }
      process.stdout.write(`${s.leftOne(match.endpoint)}\n`)
      process.stdout.write(`${s.stillConnected(connections.length - 1)}\n`)
      return 0
    }
  }
}

// ---------------------------------------------------------------------------
// status / list
// ---------------------------------------------------------------------------

export interface MemberStatusOptions {
  endpoint?: string
}

interface RemoteStatusEntry {
  id: string
  lastSuccessAt: number | null
  errKind: 'auth' | 'net' | null
}

interface RemoteStatusResponse {
  connections?: RemoteStatusEntry[]
}

interface LocalStatusResult {
  /** False only on a genuine network failure (nothing listening, a timeout) — a server that
   *  answered but with a non-2xx or unparseable body is still REACHABLE, just erroring, and must
   *  not be reported as "not running" (review finding: those are different facts). */
  reachable: boolean
  connections: RemoteStatusEntry[]
}

/** Query the LOCAL SERVER's live push status — `getUploaderStatus()` lives IN the server process
 *  (populated by its own running uploader); calling it from the CLI's own short-lived process
 *  always returned "never synced" for every connection, which got worse (N wrong lines) as
 *  connections grew. */
async function fetchLocalStatus(): Promise<LocalStatusResult> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/team/status`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return { reachable: true, connections: [] } // server IS running, just answered badly
    const json = await res.json().catch(() => null) as RemoteStatusResponse | null
    return { reachable: true, connections: json?.connections ?? [] }
  } catch {
    return { reachable: false, connections: [] }
  }
}

/** Print the current team mode and, per connection, its endpoint/org/user + live push status —
 *  one independent block per central. `--endpoint` matches via `normalizeEndpointKey`, the same
 *  identity rule `connect`/`leave` use (review finding I3). `list` is an alias with the same
 *  implementation. */
export async function memberStatus(opts: MemberStatusOptions = {}): Promise<number> {
  const prefs = await readPreferencesOrExit()
  const team = prefs.team ?? defaultTeam()
  const s = cliStrings(await resolveLang())

  process.stdout.write(`mode: ${team.mode}\n`)
  if (team.mode !== 'member') return 0

  const connections = team.connections ?? []
  if (connections.length === 0) return 0

  const targets = opts.endpoint
    ? connections.filter(c => normalizeEndpointKey(c.endpoint) === normalizeEndpointKey(opts.endpoint!))
    : connections

  if (opts.endpoint && targets.length === 0) {
    process.stderr.write(`${s.noMatchEndpoint(opts.endpoint)}\n`)
    return 1
  }

  const remote = await fetchLocalStatus()
  const byId = new Map(remote.connections.map(c => [c.id, c]))

  targets.forEach((conn, i) => {
    if (i > 0) process.stdout.write('\n')
    const st = byId.get(conn.id)
    const last = !remote.reachable ? s.localServerUnknown
      : st?.lastSuccessAt ? new Date(st.lastSuccessAt).toISOString()
      : s.neverSynced
    const state = !remote.reachable ? s.localServerUnknown
      : st?.errKind === 'auth' ? s.stateAuthRejected
      : st?.errKind === 'net' ? s.stateNetUnreachable
      : s.stateOk
    process.stdout.write(`connection: ${conn.label ?? conn.id}\n`)
    process.stdout.write(`endpoint:   ${conn.endpoint || '(none)'}\n`)
    process.stdout.write(`org:        ${conn.org || 'default'}\n`)
    process.stdout.write(`user:       ${conn.user || '(unknown)'}\n`)
    process.stdout.write(`last sync:  ${last}\n`)
    process.stdout.write(`state:      ${state}\n`)
  })
  return 0
}

/** `agentop member list` — an alias for `status` (spec §8), and now genuinely reachable: bin/cli.ts
 *  routes `list` here specifically, rather than both `status` and `list` calling `memberStatus`
 *  directly (which left this export unreachable). Kept as a distinct export rather than a bare
 *  re-assignment so a future divergence between the two has an obvious place to land. */
export async function memberList(opts: MemberStatusOptions = {}): Promise<number> {
  return memberStatus(opts)
}
