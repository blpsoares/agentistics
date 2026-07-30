/**
 * team-connections.ts — HTTP handlers for the multi-central connection lifecycle: add/rotate,
 * rename, delete, probe, and the aggregated status the browser polls.
 *
 * Pure decisions (`validateConnectionBody`, `validatePatchBody`, `decideConnectionUpsert`) are
 * unit-tested directly in team-connections.test.ts. Everything else here is I/O glue: read/mutate
 * preferences through `updateTeamConfig` (whose mutator runs INSIDE preferences.ts's single write
 * chain — see its docstring; the two uniqueness decisions below are made from the array current
 * AT WRITE TIME, never from a snapshot read outside the chain), talk to the central over HTTP,
 * and nudge team-uploader/team-agent-client to react immediately instead of waiting out their own
 * ~5s reconciliation poll.
 *
 * Never logs a token, a TeamConnection, or a whole preferences object.
 */

import type { TeamConnection, TeamConfig } from '@agentistics/core'
import { connectionId, defaultTeam, normalizeTeamConfig, normalizeEndpointKey } from '@agentistics/core'
import { readPreferences, updateTeamConfig, PreferencesLockTimeoutError } from './preferences'
import { safeConnId } from './config'
import { readJsonLimited, LIMITS } from './limits'
import { removeConnection, getUploaderStatus, reconcileUploaderNow, pushNow } from './team-uploader'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** R4 (round-2 review of Task 5): a `PreferencesLockTimeoutError` means another process is
 *  mid-write, not that this request is malformed — 503 + Retry-After tells the caller to try
 *  again shortly, instead of a 400/500 that reads as "this will never work". */
function lockTimeoutResponse(): Response {
  return new Response(JSON.stringify({ error: 'another process is writing preferences — retry shortly' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
  })
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

// ---------------------------------------------------------------------------
// Pure decisions — the substance of this module. Unit-tested.
// ---------------------------------------------------------------------------

export interface ConnectionBody {
  endpoint: string
  token: string
  org?: string
  label?: string
}

/** Validate + normalize the POST /api/team/connections body. Pure. */
export function validateConnectionBody(raw: unknown): ConnectionBody | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid JSON body' }
  const r = raw as Record<string, unknown>
  const endpoint = trimSlashes(typeof r.endpoint === 'string' ? r.endpoint.trim() : '')
  if (!endpoint) return { error: 'endpoint is required' }
  try {
    const u = new URL(endpoint)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'endpoint must be http(s)' }
  } catch {
    return { error: 'endpoint must be a valid URL' }
  }
  const token = typeof r.token === 'string' ? r.token : ''
  const org = typeof r.org === 'string' && r.org.trim() ? r.org.trim() : undefined
  const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : undefined
  return { endpoint, token, org, label }
}

export interface PatchBody {
  label: string
}

/** Validate the PATCH /api/team/connections/:id body. Pure. An empty string is a legitimate
 *  "clear the label" — the card then falls back to the endpoint host for display. */
export function validatePatchBody(raw: unknown): PatchBody | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid JSON body' }
  const r = raw as Record<string, unknown>
  if (typeof r.label !== 'string') return { error: 'label must be a string' }
  return { label: r.label.trim() }
}

export type ConnectionUpsertDecision =
  | { action: 'insert' }
  | { action: 'update'; existing: TeamConnection }
  | { action: 'conflict'; existing: TeamConnection }

/**
 * The two uniqueness rules, decided together so a token rotation on a known endpoint is
 * distinguished from a genuine token collision:
 *  - a KNOWN normalized endpoint always updates in place, whatever the new token is — token
 *    rotation is a documented admin action and is exactly when a user re-runs connect. Appending
 *    a second connection there would double-count the machine on the central under two
 *    `memberId`s, since the central keys members by `sha256(token)`. Endpoint identity uses
 *    `normalizeEndpointKey` (lower-cased host, default port folded — see its docstring), not a
 *    plain string compare: `https://Central.example.com` and `https://central.example.com` are
 *    the same central, and comparing case-sensitively would insert a second connection for it.
 *  - a token that already belongs to a DIFFERENT connection is refused — two connections sharing
 *    one token collapse onto one `memberId` and would alternately `replaceOne` the same stats
 *    document, flipping the machine's reported totals on every push.
 * An empty token never triggers the conflict branch: it is the legitimate shape for a
 * token-less member against an open/legacy central, and several such connections may coexist.
 * In practice `handleAddConnection` never reaches this function with an empty token today —
 * `whoamiVerify` requires a bearer this central's `validateIngestToken` accepts, and it rejects a
 * missing one before `decideConnectionUpsert` runs — but the branch stays correct standalone
 * (this function's own contract, and what its unit tests exercise) for a central that one day
 * accepts anonymous whoami, or a future caller that skips verification.
 * The endpoint match is checked first and wins even when the new token happens to collide with
 * some OTHER connection's token — that combination is still refused (see below): a token owned
 * by a connection other than the one being updated is a conflict regardless of which branch found
 * it first. Pure.
 */
export function decideConnectionUpsert(
  connections: TeamConnection[],
  endpoint: string,
  token: string,
): ConnectionUpsertDecision {
  const norm = normalizeEndpointKey(endpoint)
  const byEndpoint = connections.find(c => normalizeEndpointKey(c.endpoint) === norm)
  const byToken = token ? connections.find(c => c.token === token) : undefined
  if (byToken && (!byEndpoint || byToken.id !== byEndpoint.id)) {
    return { action: 'conflict', existing: byToken }
  }
  if (byEndpoint) return { action: 'update', existing: byEndpoint }
  return { action: 'insert' }
}

// ---------------------------------------------------------------------------
// I/O glue
// ---------------------------------------------------------------------------

interface WhoamiResult {
  ok: boolean
  user?: string
  org?: string
  error?: string
}

/**
 * whoami-verify a candidate endpoint/token pair. Deliberately asserts on the response BODY
 * (`json.ok === true`), never on `res.ok` — this central answers HTTP 200 with `{ ok: false }`
 * for a revoked or unknown token, which reading `res.ok` alone would misreport as success.
 */
async function whoamiVerify(endpoint: string, token: string): Promise<WhoamiResult> {
  try {
    const res = await fetch(`${endpoint}/api/team/whoami`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8_000),
    })
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { ok: false, error: `central returned an invalid response (HTTP ${res.status})` }
    }
    const b = body as { ok?: unknown; user?: unknown; org?: unknown }
    if (b && b.ok === true && typeof b.user === 'string') {
      return { ok: true, user: b.user, org: typeof b.org === 'string' ? b.org : undefined }
    }
    return { ok: false, error: 'the central rejected this token' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

/** Best-effort, fire-and-forget socket reconciliation — never throws, never delays the HTTP
 *  response. `team-agent-client`'s own diff is fingerprint-based (endpoint+token), so this is
 *  correct for BOTH a brand-new connection and a rotated token: either way the stored fingerprint
 *  changed and the client will (re)connect. */
function nudgeSocket(): void {
  void import('./team-agent-client').then(m => m.reconcileNow()).catch(() => { /* best-effort */ })
}

/**
 * Best-effort nudge after a successful insert: starts this connection's push chain right now
 * instead of waiting out `supervisorTick`'s ~5s poll. Never throws, never delays the response.
 */
function nudgeAfterInsert(): void {
  void reconcileUploaderNow().catch(() => { /* best-effort */ })
  nudgeSocket()
}

/**
 * Best-effort nudge after a successful update (token rotation on a known endpoint): fires an
 * IMMEDIATE push for this connection rather than relying on `reconcileUploaderNow`/
 * `supervisorTick`, which only starts chains for ids NOT already in `_activeChains` — an existing
 * connection's chain is already active, so the supervisor is a no-op for it and the new token
 * would otherwise sit unused until the connection's current interval elapses (up to an hour on a
 * non-express central). `pushNow` also reschedules that connection's recurring timer relative to
 * now, so the cadence doesn't drift. The socket needs a separate nudge regardless — a rotated
 * token changes its fingerprint too. Never throws, never delays the response.
 */
function nudgeAfterUpdate(connId: string): void {
  void pushNow(connId).catch(() => { /* best-effort */ })
  nudgeSocket()
}

/** Unambiguous wrapper around `readJsonLimited` — unlike stashing the error inside the parsed
 *  value, this never collides with a legitimately-shaped body that happens to carry an `error`
 *  key of its own. */
async function readBody<T>(req: Request): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const parsed = await readJsonLimited<T>(req, LIMITS.bodyBytes)
  if (!parsed.ok) return { ok: false, error: parsed.error === 'too_large' ? 'body too large' : 'invalid JSON body' }
  return { ok: true, value: parsed.value }
}

export type AddConnectionOutcome =
  | { ok: true; action: 'insert' | 'update'; connId: string }
  | { ok: false; reason: 'verify-failed' | 'conflict' | 'lock-timeout'; error: string }

/**
 * Core logic behind POST /api/team/connections — whoami-verifies BEFORE storing anything (see
 * whoamiVerify), then a known normalized endpoint updates in place (token/org/user refreshed; id
 * and label preserved — label changes go through PATCH); a token already owned by another
 * connection is refused; otherwise a fresh connection is minted and appended.
 *
 * Deliberately HTTP-agnostic (no `Request`/`Response`) so `cli-member.ts`'s no-local-server
 * fallback path (Task 6, spec §8) can call the EXACT SAME decision the route uses instead of
 * re-implementing whoami-verify + decideConnectionUpsert by hand and risking drift between the
 * two. Never returns a token.
 */
export async function addOrUpdateConnection(body: ConnectionBody): Promise<AddConnectionOutcome> {
  const who = await whoamiVerify(body.endpoint, body.token)
  if (!who.ok) return { ok: false, reason: 'verify-failed', error: who.error ?? 'connection could not be verified' }

  let outcome: { action: 'insert' | 'update' | 'conflict'; connId?: string } = { action: 'insert' }
  try {
    await updateTeamConfig((current: TeamConfig) => {
      const decision = decideConnectionUpsert(current.connections, body.endpoint, body.token)
      if (decision.action === 'conflict') {
        outcome = { action: 'conflict' }
        return undefined
      }
      if (decision.action === 'update') {
        const existing = decision.existing
        const updated: TeamConnection = {
          ...existing,
          endpoint: body.endpoint,
          token: body.token,
          // Same precedence as the insert branch below — an explicit body value wins, else the
          // fresh whoami reading, else what's already stored: an explicit caller-supplied org must
          // never be silently overridden by whoami on every reconnect.
          org: body.org ?? who.org ?? existing.org,
          user: who.user ?? existing.user,
          // id and label are preserved on an update — renaming goes through PATCH.
        }
        outcome = { action: 'update', connId: existing.id }
        const connections = current.connections.map(c => (c.id === existing.id ? updated : c))
        return normalizeTeamConfig({ ...defaultTeam(), mode: 'member', connections })
      }
      const id = connectionId()
      const created: TeamConnection = {
        id,
        endpoint: body.endpoint,
        token: body.token,
        org: body.org ?? who.org ?? 'default',
        user: who.user ?? '',
        deniedRepos: [],
        addedAt: new Date().toISOString(),
        ...(body.label !== undefined ? { label: body.label } : {}),
      }
      outcome = { action: 'insert', connId: id }
      return normalizeTeamConfig({ ...defaultTeam(), mode: 'member', connections: [...current.connections, created] })
    })
  } catch (err) {
    if (err instanceof PreferencesLockTimeoutError) {
      return { ok: false, reason: 'lock-timeout', error: 'another process is writing preferences — retry shortly' }
    }
    throw err
  }

  if (outcome.action === 'conflict') {
    return { ok: false, reason: 'conflict', error: 'this token is already used by another connection' }
  }
  if (outcome.action === 'update' && outcome.connId) {
    nudgeAfterUpdate(outcome.connId)
  } else if (outcome.connId) {
    nudgeAfterInsert()
  }
  return { ok: true, action: outcome.action as 'insert' | 'update', connId: outcome.connId! }
}

/**
 * POST /api/team/connections — { endpoint, token, org?, label? }. Thin HTTP wrapper around
 * `addOrUpdateConnection` (see its docstring for the decision itself).
 */
export async function handleAddConnection(req: Request): Promise<Response> {
  const parsed = await readBody<unknown>(req)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const body = validateConnectionBody(parsed.value)
  if ('error' in body) return json({ error: body.error }, 400)

  const result = await addOrUpdateConnection(body)
  if (!result.ok) {
    if (result.reason === 'lock-timeout') return lockTimeoutResponse()
    return json({ error: result.error }, result.reason === 'conflict' ? 409 : 400)
  }
  return json({ ok: true, id: result.connId, action: result.action })
}

/** PATCH /api/team/connections/:id — { label } — read-modify-write that entry only. */
export async function handlePatchConnection(req: Request, rawId: string): Promise<Response> {
  let id: string
  try {
    id = safeConnId(rawId)
  } catch {
    return json({ error: 'invalid connection id' }, 400)
  }

  const parsed = await readBody<unknown>(req)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const body = validatePatchBody(parsed.value)
  if ('error' in body) return json({ error: body.error }, 400)

  let found = false
  try {
    await updateTeamConfig((current: TeamConfig) => {
      const existing = current.connections.find(c => c.id === id)
      if (!existing) return undefined
      found = true
      const connections = current.connections.map(c =>
        c.id === id ? { ...c, label: body.label || undefined } : c)
      return normalizeTeamConfig({ ...defaultTeam(), mode: 'member', connections })
    })
  } catch (err) {
    if (err instanceof PreferencesLockTimeoutError) return lockTimeoutResponse()
    throw err
  }

  if (!found) return json({ error: 'unknown connection' }, 404)
  return json({ ok: true })
}

export type LeaveConnectionOutcome =
  | { ok: true; endpoint: string }
  | { ok: false; error: string }

/**
 * Core logic behind DELETE /api/team/connections/:id — whoami is implicit (the stored token is
 * used as-is): best-effort POST to the central's /api/team/leave with that connection's token (an
 * offline or already-revoked central must not block local removal), then removes the entry and
 * its state files via `removeConnection` (team-uploader.ts), which runs the removal inside the
 * same preferences write chain and tears down this connection's timers/socket immediately.
 *
 * HTTP-agnostic for the same reason `addOrUpdateConnection` is — `cli-member.ts`'s no-server
 * fallback path calls this directly instead of duplicating it.
 */
export async function leaveConnectionById(rawId: string): Promise<LeaveConnectionOutcome> {
  let id: string
  try {
    id = safeConnId(rawId)
  } catch {
    return { ok: false, error: 'invalid connection id' }
  }

  const prefs = await readPreferences()
  const conn = (prefs.team?.connections ?? []).find(c => c.id === id)
  if (!conn) return { ok: false, error: 'unknown connection' }

  try {
    const endpoint = trimSlashes(conn.endpoint)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (conn.token) headers['Authorization'] = `Bearer ${conn.token}`
    await fetch(`${endpoint}/api/team/leave`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ org: conn.org, user: conn.user }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // Best-effort — the central may be offline or the token already revoked; the connection is
    // still removed locally below.
  }

  await removeConnection(id, 'manual')
  return { ok: true, endpoint: conn.endpoint }
}

/** DELETE /api/team/connections/:id — thin HTTP wrapper around `leaveConnectionById`. */
export async function handleDeleteConnection(_req: Request, rawId: string): Promise<Response> {
  const result = await leaveConnectionById(rawId)
  if (!result.ok) {
    return json({ error: result.error }, result.error === 'unknown connection' ? 404 : 400)
  }
  return json({ ok: true })
}

interface ProbeResult {
  ok: boolean
  latencyMs: number
  user?: string
  org?: string
  error?: string
}

/** POST /api/team/connections/:id/probe — server-side identity/latency probe using the STORED
 *  token (never one supplied by the caller). Never returns the token. */
export async function handleProbeConnection(_req: Request, rawId: string): Promise<Response> {
  let id: string
  try {
    id = safeConnId(rawId)
  } catch {
    return json({ error: 'invalid connection id' }, 400)
  }

  const prefs = await readPreferences()
  const conn = (prefs.team?.connections ?? []).find(c => c.id === id)
  if (!conn) return json({ error: 'unknown connection' }, 404)

  const endpoint = trimSlashes(conn.endpoint)
  const t0 = Date.now()
  const who = await whoamiVerify(endpoint, conn.token)
  const latencyMs = Date.now() - t0
  const result: ProbeResult = who.ok
    ? { ok: true, latencyMs, user: who.user, org: who.org }
    : { ok: false, latencyMs, error: who.error }
  return json(result)
}

export interface ConnectionStatusEntry {
  id: string
  endpoint: string
  org: string
  user: string
  label?: string
  lastSuccessAt: number | null
  errKind: 'auth' | 'net' | null
  latencyMs: number | null
}

export interface AggregatedConnectionStatus {
  lastSuccessAt: number | null
  errKind: 'auth' | 'net' | null
  latencyMs: number | null
}

/**
 * Aggregate several connections' statuses into the single top-level status the member-side pill
 * (`MemberConnectionStatus.tsx`) has always read — `{lastSuccessAt, errKind, latencyMs}` at the
 * TOP of the response, not nested under `connections[]`. `lastSuccessAt` is the MOST RECENT
 * success across connections; `errKind` is the WORST currently in force ('auth' outranks 'net',
 * since a revoked token is the more actionable state) — 'auth' if any connection has it, else
 * 'net' if any does, else null only when every connection is clean; `latencyMs` is the one
 * measured on the connection that produced the chosen `lastSuccessAt` (the freshest sample, and
 * the one most representative of "how things stand right now" — an average across connections to
 * unrelated centrals with unrelated RTTs would not mean anything). Pure.
 */
export function aggregateConnectionStatuses(entries: ConnectionStatusEntry[]): AggregatedConnectionStatus {
  let lastSuccessAt: number | null = null
  let latencyMs: number | null = null
  for (const e of entries) {
    if (e.lastSuccessAt != null && (lastSuccessAt === null || e.lastSuccessAt > lastSuccessAt)) {
      lastSuccessAt = e.lastSuccessAt
      latencyMs = e.latencyMs
    }
  }
  const errKind: 'auth' | 'net' | null =
    entries.some(e => e.errKind === 'auth') ? 'auth' :
    entries.some(e => e.errKind === 'net') ? 'net' :
    null
  return { lastSuccessAt, errKind, latencyMs }
}

/**
 * GET /api/team/status — the per-connection shape (spec §9.5, minus `deniedCount`/`boundary`)
 * PLUS the aggregated `{lastSuccessAt, errKind, latencyMs}` at the top level, for
 * `MemberConnectionStatus.tsx` (the status pill), which does not yet read `connections[]`. Reads
 * CACHED values only (`getUploaderStatus`, populated by the uploader's own push cycle, latency
 * included) — never makes its own blocking network call. The previous single-connection handler
 * did a fresh ~4s-timeout probe on every call while the frontend polls every 5s, which with two
 * offline centrals alone exceeds its own poll interval. Never returns a token.
 */
export async function handleTeamStatus(_req: Request): Promise<Response> {
  const prefs = await readPreferences()
  const team = prefs.team
  const connections = team?.connections ?? []
  const byConn = getUploaderStatus()
  const entries: ConnectionStatusEntry[] = connections.map(c => {
    const st = byConn[c.id]
    return {
      id: c.id,
      endpoint: c.endpoint,
      org: c.org,
      user: c.user,
      ...(c.label ? { label: c.label } : {}),
      lastSuccessAt: st?.lastSuccessAt ?? null,
      errKind: st?.errKind ?? null,
      latencyMs: st?.latencyMs ?? null,
    }
  })
  const aggregated = aggregateConnectionStatuses(entries)
  return json({ mode: team?.mode ?? 'solo', ...aggregated, connections: entries })
}
