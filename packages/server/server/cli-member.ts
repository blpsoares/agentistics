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
 * The bearer token is never logged.
 */

import { defaultTeam, unpackConnectToken, type TeamConnection } from '@agentistics/core'
import { PORT } from './config'
import { readPreferencesOrExit } from './preferences'
import { cliStrings, resolveLang } from './cli-i18n'

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
  | { ok: false; error: string }

/** Try the local server's POST /api/team/connections first. A network failure (no server
 *  listening, or unreachable) is distinguished from the server ANSWERING with an error — the
 *  former falls back to the direct sequence below, the latter is a real failure to report. */
async function connectViaLocalServer(body: { endpoint: string; token: string; org?: string; label?: string }): Promise<ConnectResult | null> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/team/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    })
    const json = await res.json().catch(() => null) as { ok?: boolean; id?: string; action?: string; error?: string } | null
    if (res.ok && json?.ok && typeof json.id === 'string') {
      return { ok: true, action: json.action === 'update' ? 'update' : 'insert', connId: json.id }
    }
    return { ok: false, error: json?.error ?? `local server returned HTTP ${res.status}` }
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
  if ('error' in validated) return { ok: false, error: validated.error }
  const outcome = await addOrUpdateConnection(validated)
  if (!outcome.ok) return { ok: false, error: outcome.error }
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

  const s = cliStrings(await resolveLang())

  if (!result.ok) {
    process.stderr.write(`${result.error}\n`)
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
 *  directly instead of only through the impure, network-touching command. */
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
    const norm = opts.endpoint.trim().replace(/\/+$/, '')
    const match = connections.find(c => c.endpoint.replace(/\/+$/, '') === norm)
    return match ? { type: 'single', conn: match } : { type: 'not-found' }
  }
  if (connections.length === 1) return { type: 'single', conn: connections[0]! }
  return opts.isTTY ? { type: 'prompt' } : { type: 'ambiguous' }
}

/** Leave ONE connection: local server's DELETE route first, direct sequence as fallback —
 *  mirrors `connectViaLocalServer`/`connectDirect` above. Never throws. */
async function leaveOne(conn: TeamConnection): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/team/connections/${encodeURIComponent(conn.id)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(8_000),
    })
    if (res.ok) return
    throw new Error(`local server returned HTTP ${res.status}`)
  } catch {
    const { leaveConnectionById } = await import('./team-connections')
    await leaveConnectionById(conn.id)
  }
}

/**
 * Leave a central. See `decideLeaveTarget` for the exact branching. Always returns 0 for the
 * "nothing to leave" / a successful leave cases; 1 for an ambiguous non-TTY N-connection call or
 * an unmatched `--endpoint` (leaving locally must succeed even if the central itself is down —
 * only "I don't know WHICH connection you mean" is refused).
 */
export async function memberLeave(opts: MemberLeaveOptions = {}): Promise<number> {
  const prefs = await readPreferencesOrExit()
  const connections = prefs.team?.connections ?? []
  const s = cliStrings(await resolveLang())

  const decision = decideLeaveTarget(connections, { ...opts, isTTY: Boolean(process.stdin.isTTY) })

  switch (decision.type) {
    case 'none':
      process.stdout.write(`${s.noConnections}\n`)
      return 0

    case 'not-found':
      process.stderr.write(`no connection matches endpoint ${opts.endpoint}\n`)
      return 1

    case 'ambiguous':
      process.stderr.write(`${s.ambiguousLeave(connections.length)}\n`)
      return 1

    case 'all': {
      const n = connections.length
      await Promise.all(connections.map(leaveOne))
      process.stdout.write(`${s.leftAll(n)}\n`)
      return 0
    }

    case 'single': {
      await leaveOne(decision.conn)
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
        const n = connections.length
        await Promise.all(connections.map(leaveOne))
        process.stdout.write(`${s.leftAll(n)}\n`)
        return 0
      }
      const match = connections.find(c => c.id === picked)
      if (!match) return 0 // shouldn't happen — the picker only offers real ids
      await leaveOne(match)
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

/** Query the LOCAL SERVER's live push status — `getUploaderStatus()` lives IN the server process
 *  (populated by its own running uploader); calling it from the CLI's own short-lived process
 *  always returned "never synced" for every connection, which got worse (N wrong lines) as
 *  connections grew. Returns null when no local server is reachable. */
async function fetchLocalStatus(): Promise<RemoteStatusResponse | null> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/team/status`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    return await res.json() as RemoteStatusResponse
  } catch {
    return null
  }
}

/** Print the current team mode and, per connection, its endpoint/org/user + live push status —
 *  one independent block per central. `list` is an alias with the same implementation. */
export async function memberStatus(opts: MemberStatusOptions = {}): Promise<number> {
  const prefs = await readPreferencesOrExit()
  const team = prefs.team ?? defaultTeam()

  process.stdout.write(`mode: ${team.mode}\n`)
  if (team.mode !== 'member') return 0

  const connections = team.connections ?? []
  if (connections.length === 0) return 0

  const targets = opts.endpoint
    ? connections.filter(c => c.endpoint.replace(/\/+$/, '') === opts.endpoint!.trim().replace(/\/+$/, ''))
    : connections

  if (opts.endpoint && targets.length === 0) {
    process.stderr.write(`no connection matches endpoint ${opts.endpoint}\n`)
    return 1
  }

  const remote = await fetchLocalStatus()
  const byId = new Map((remote?.connections ?? []).map(c => [c.id, c]))
  const localServerDown = remote === null

  targets.forEach((conn, i) => {
    if (i > 0) process.stdout.write('\n')
    const st = byId.get(conn.id)
    const last = localServerDown ? 'unknown (local server not running)'
      : st?.lastSuccessAt ? new Date(st.lastSuccessAt).toISOString()
      : 'never'
    const state = localServerDown ? 'unknown (local server not running)'
      : st?.errKind === 'auth' ? 'token rejected by central'
      : st?.errKind === 'net' ? 'central unreachable'
      : 'ok'
    process.stdout.write(`connection: ${conn.label ?? conn.id}\n`)
    process.stdout.write(`endpoint:   ${conn.endpoint || '(none)'}\n`)
    process.stdout.write(`org:        ${conn.org || 'default'}\n`)
    process.stdout.write(`user:       ${conn.user || '(unknown)'}\n`)
    process.stdout.write(`last sync:  ${last}\n`)
    process.stdout.write(`state:      ${state}\n`)
  })
  return 0
}

/** `agentop member list` — new alias for `status`, per spec §8 (kept as a distinct export rather
 *  than a bare re-assignment so a future divergence between the two has an obvious place to land). */
export async function memberList(opts: MemberStatusOptions = {}): Promise<number> {
  return memberStatus(opts)
}
