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
import {
  removeConnection, getUploaderStatus, emptyStatusFor, reconcileUploaderNow, pushNow,
  getResyncProgress, connectionCanForget, peekPushContext, type UploaderStatus,
} from './team-uploader'
import type { ForgetProgress } from './team-forget-client'
import { loadRulesState } from './team-rules'
import {
  normalizeDenied, hasRestrictions, withUnresolvedDenied, denialSignature,
  attributionBoundary, prehistoryCount,
} from './share-rules'

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
  deniedRepos?: string[]
}

/** Pure: is `v` an array of strings? Used to validate `deniedRepos` on both bodies below —
 *  junk (a bare string, a number, an object, a mixed-type array) is rejected outright rather than
 *  filtered down to whatever happened to be a string, which would silently accept a malformed
 *  request instead of 400ing it. */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
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
  let deniedRepos: string[] | undefined
  if ('deniedRepos' in r && r.deniedRepos !== undefined) {
    if (!isStringArray(r.deniedRepos)) return { error: 'deniedRepos must be an array of strings' }
    deniedRepos = r.deniedRepos
  }
  return { endpoint, token, org, label, deniedRepos }
}

export interface PatchBody {
  label?: string
  deniedRepos?: string[]
}

/** Validate the PATCH /api/team/connections/:id body. Pure. An empty string label is a
 *  legitimate "clear the label" — the card then falls back to the endpoint host for display. An
 *  empty `deniedRepos` array is likewise legitimate — the explicit "un-block everything" shape.
 *  At least one of the two fields must be present, or there is nothing to update. */
export function validatePatchBody(raw: unknown): PatchBody | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid JSON body' }
  const r = raw as Record<string, unknown>
  const out: PatchBody = {}
  if ('label' in r) {
    if (typeof r.label !== 'string') return { error: 'label must be a string' }
    out.label = r.label.trim()
  }
  if ('deniedRepos' in r && r.deniedRepos !== undefined) {
    if (!isStringArray(r.deniedRepos)) return { error: 'deniedRepos must be an array of strings' }
    out.deniedRepos = r.deniedRepos
  }
  if (out.label === undefined && out.deniedRepos === undefined) {
    return { error: 'nothing to update — provide label and/or deniedRepos' }
  }
  return out
}

/**
 * The zero→non-zero transition rule (§4.2), applied HERE and nowhere else — the result is what
 * gets PERSISTED, so `NO_REPO_KEY` lands in the stored list and the picker renders it pre-blocked;
 * only an explicit later edit removes it. An already-restricted connection's edit is honoured
 * AS-IS (no forced re-add of the sentinel), which is also what makes repeated application from the
 * same starting point idempotent: `previous` reflects what is already persisted, so applying the
 * rule twice against an unchanged `previous` yields the same `requested` handling both times.
 */
export function resolveDeniedRepos(previous: readonly string[] | undefined, requested: readonly string[]): string[] {
  const wasRestricted = hasRestrictions(previous)
  if (!wasRestricted && hasRestrictions(requested)) return withUnresolvedDenied(requested)
  return [...requested]
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
  // `ownerEndpoint` is set only for `reason: 'conflict'` — the endpoint of the DIFFERENT
  // connection that already holds this token, not the endpoint the caller tried to connect to.
  // Review finding N4: the message built from this must name the owner, or it asserts something
  // false (a caller retrying against a second central saw "that token already belongs to
  // <the central they were JUST talking to>", which is backwards).
  | { ok: false; reason: 'verify-failed' | 'conflict' | 'lock-timeout'; error: string; ownerEndpoint?: string }

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

  let outcome: { action: 'insert' | 'update' | 'conflict'; connId?: string; ownerEndpoint?: string } = { action: 'insert' }
  try {
    await updateTeamConfig((current: TeamConfig) => {
      const decision = decideConnectionUpsert(current.connections, body.endpoint, body.token)
      if (decision.action === 'conflict') {
        outcome = { action: 'conflict', ownerEndpoint: decision.existing.endpoint }
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
          // id, label AND deniedRepos are preserved on an update (a reconnect/token-rotation),
          // never overwritten from the body — the rules editor is the only writer of an EXISTING
          // connection's denylist (PATCH), so a body.deniedRepos here is silently ignored rather
          // than reset to it.
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
        // R10: deniedRepos travels in the SAME create as the rest of the connection, committed
        // inside this one updateTeamConfig transaction — nudgeAfterInsert() below only runs once
        // it resolves, so the uploader can never see this connection before its rules exist and
        // push the entire unfiltered history first. The zero→non-zero transition (§4.2) applies
        // here too: `previous` is undefined (a brand-new connection has no prior state).
        deniedRepos: resolveDeniedRepos(undefined, body.deniedRepos ?? []),
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
    return {
      ok: false, reason: 'conflict',
      error: `this token is already used by the connection to ${outcome.ownerEndpoint}`,
      ownerEndpoint: outcome.ownerEndpoint,
    }
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
    return json(
      { error: result.error, ...(result.reason === 'conflict' ? { ownerEndpoint: result.ownerEndpoint } : {}) },
      result.reason === 'conflict' ? 409 : 400,
    )
  }
  return json({ ok: true, id: result.connId, action: result.action })
}

/** Best-effort nudge after a rules change (§6.1): the route only PERSISTS the new denylist and
 *  kicks this connection's next cycle off immediately (instead of waiting out its own interval).
 *  Everything past that — the shrink detector, the journal, the batched forget, the rebuilt cache
 *  push — runs SERVER-SIDE inside `runConnectionCycle`. Never orchestrated from the browser: a tab
 *  closing mid-sequence must not leave the journal open with no client left to resume it. Never
 *  throws, never delays the response. */
function nudgeAfterRulesChange(connId: string): void {
  void pushNow(connId).catch(() => { /* best-effort */ })
}

/** PATCH /api/team/connections/:id — { label?, deniedRepos? } — read-modify-write that entry
 *  only. A `deniedRepos` change applies `resolveDeniedRepos`'s zero→non-zero transition against
 *  the entry's OWN previous list (never a global default) and, once persisted, triggers the §6.1
 *  reconcile cycle for this connection. Returns `{ ok, queued: true }` when a rules change was
 *  accepted, so the caller knows the removal (if any) is now running server-side rather than
 *  applied synchronously. */
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
  let rulesChanged = false
  try {
    await updateTeamConfig((current: TeamConfig) => {
      const existing = current.connections.find(c => c.id === id)
      if (!existing) return undefined
      found = true
      let deniedRepos = existing.deniedRepos
      if (body.deniedRepos !== undefined) {
        deniedRepos = resolveDeniedRepos(existing.deniedRepos, body.deniedRepos)
        rulesChanged = true
      }
      const connections = current.connections.map(c => c.id === id
        ? { ...c, ...(body.label !== undefined ? { label: body.label || undefined } : {}), deniedRepos }
        : c)
      return normalizeTeamConfig({ ...defaultTeam(), mode: 'member', connections })
    })
  } catch (err) {
    if (err instanceof PreferencesLockTimeoutError) return lockTimeoutResponse()
    throw err
  }

  if (!found) return json({ error: 'unknown connection' }, 404)
  if (rulesChanged) {
    nudgeAfterRulesChange(id)
    return json({ ok: true, queued: true })
  }
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
 *
 * `deps` is injectable for tests (mirrors `removeConnection`'s own `deps.updateTeamConfig`/
 * `deps.log` seams) — the defaults touch the developer's real preferences file, which a test must
 * never do. `deps.log` is forwarded verbatim to `removeConnection` — see its docstring for why
 * `cli-member.ts`'s no-server fallback is the one production caller that overrides it.
 */
export async function leaveConnectionById(
  rawId: string,
  deps: {
    readPreferences?: typeof readPreferences
    removeConnection?: typeof removeConnection
    log?: { info: (msg: string) => void; warn: (msg: string) => void }
  } = {},
): Promise<LeaveConnectionOutcome> {
  const _readPreferences = deps.readPreferences ?? readPreferences
  const _removeConnection = deps.removeConnection ?? removeConnection

  let id: string
  try {
    id = safeConnId(rawId)
  } catch {
    return { ok: false, error: 'invalid connection id' }
  }

  const prefs = await _readPreferences()
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

  // Check the actual removal result (I1) — a lock-timeout write failure must NOT be reported as
  // a successful leave; the previous version ignored removeConnection's outcome entirely.
  const result = await _removeConnection(id, 'manual', deps.log ? { log: deps.log } : {})
  if (!result.removed) return { ok: false, error: result.error }
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
  /** Size of the stored denylist (including NO_REPO_KEY). NEVER the list itself — see the class
   *  docstring above `handleTeamStatus`: the full list is same-origin-only, via /api/preferences. */
  deniedCount: number
  /** From the STORED list (`hasRestrictions`), never from uploader/push-cycle state — a
   *  connection whose rules were just saved is restricted immediately, even before its first
   *  cycle has run. */
  restricted: boolean
  /** The day after Claude's own rollup watermark — the local honesty marker from §4.4/§5.9.
   *  Shared across every connection (it describes THIS machine's stats-cache, not a connection),
   *  and lives on this route only: never sent to a central. `null` = unknowable this cycle
   *  (no context could be built), NOT the same fact as `''` (nothing rolled up yet). */
  boundary: string | null
  /** How many stored sessions fall before `boundary` — the size of the block no rule can split.
   *  `null` = unknowable, distinct from a real `0`. Never coerce one into the other. */
  prehistorySessions: number | null
  /** Whether this connection's central has ever advertised `forget.sessions`. Absence reads as
   *  `false` (fail closed) — a network flap must never flip a previously-learned `true`. */
  canForget: boolean
  /** The complement of `canForget` — kept as its own field (rather than inferred client-side) so
   *  the UI never has to invert the polarity itself. */
  centralTooOld: boolean
  /** Live progress of an in-flight retroactive removal for this connection, or `null` when none
   *  is running. */
  resync: ForgetProgress | null
  /** True while this connection's declared rules are not yet enforced on its central — a forget
   *  sequence has not completed successfully since the denylist last changed. The UI must never
   *  report success while this is true. */
  pendingRules: boolean
}

/** The local facts `buildConnectionStatusEntry` cannot derive from `conn`/`uploaderStatus` alone —
 *  gathered once per status build (boundary/prehistorySessions are shared across every
 *  connection) and threaded in, so the entry-building itself stays pure and unit-testable without
 *  touching the filesystem or the uploader's module-level state. */
export interface ConnectionLocalFacts {
  boundary: string | null
  prehistorySessions: number | null
  canForget: boolean
  resync: ForgetProgress | null
  /** This connection's persisted `RulesState.rulesHash` (team-rules.ts) — `''` when no rules
   *  cycle has ever run for it, which reads as `denialSignature([])` (never as "changed"), the
   *  same rule `planRulesReconcile` itself follows. */
  rulesHash: string
}

/**
 * Build one connection's `/api/team/status` entry from already-resolved local facts. PURE — the
 * whole point of the split is that "restricted comes from the stored list, not uploader state"
 * (and the rest of §5.9's honesty markers) can be asserted directly, without `readPreferences()`,
 * `getPushContext()` or any of `team-uploader.ts`'s per-connection singletons in the test.
 *
 * Never includes `token` or the denylist's contents — only `deniedCount`. See the class docstring
 * above `handleTeamStatus`.
 */
export function buildConnectionStatusEntry(
  conn: TeamConnection,
  uploaderStatus: UploaderStatus,
  local: ConnectionLocalFacts,
): ConnectionStatusEntry {
  const prevHash = local.rulesHash ? local.rulesHash : denialSignature([])
  const pendingRules = denialSignature(conn.deniedRepos) !== prevHash
  return {
    id: conn.id,
    endpoint: conn.endpoint,
    org: conn.org,
    user: conn.user,
    ...(conn.label ? { label: conn.label } : {}),
    lastSuccessAt: uploaderStatus.lastSuccessAt,
    errKind: uploaderStatus.errKind,
    latencyMs: uploaderStatus.latencyMs,
    deniedCount: normalizeDenied(conn.deniedRepos).size,
    restricted: hasRestrictions(conn.deniedRepos),
    boundary: local.boundary,
    prehistorySessions: local.prehistorySessions,
    canForget: local.canForget,
    centralTooOld: !local.canForget,
    resync: local.resync,
    pendingRules,
  }
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
 * Whether OTel metrics export is configured on THIS machine — the same gate `otel-watcher.ts`
 * uses for its own exporter (`OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? ''`,
 * exporting only when non-empty). Read directly here, as a plain env check, rather than importing
 * `otel-watcher.ts` — that module runs its OWN watcher (chokidar + `setInterval` + `process.on`
 * signal handlers) as an IMPORT-TIME side effect (its trailing `main().catch(...)` call), so
 * pulling it into a request-handling module would start a second, unwanted watcher on every
 * `/api/team/status` request. Machine-wide, not per-connection — OTel export sends the whole
 * machine's unfiltered totals regardless of which central a session belongs to.
 */
export function otelExportEnabled(): boolean {
  return Boolean((process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim())
}

/**
 * GET /api/team/status — the per-connection shape (spec §9.5) PLUS the aggregated
 * `{lastSuccessAt, errKind, latencyMs}` at the top level, for `MemberConnectionStatus.tsx` (the
 * status pill), which does not yet read `connections[]`. Reads CACHED values only
 * (`getUploaderStatus`, populated by the uploader's own push cycle, latency included) — never
 * makes its own blocking network call. The previous single-connection handler did a fresh
 * ~4s-timeout probe on every call while the frontend polls every 5s, which with two offline
 * centrals alone exceeds its own poll interval. Never returns a token, and never the contents of
 * `deniedRepos` — only `deniedCount` (§6.4: the full list is same-origin-only, via
 * `GET /api/preferences`). `boundary`/`prehistorySessions` are local honesty markers (§4.4) that
 * exist on this route and nowhere on the wire to a central. `otelExportEnabled` is likewise
 * local-only and machine-wide (never per-connection) — the repository picker's `otelWarn` reads
 * it to say the rule does not cover OTel's unfiltered export.
 *
 * `deps` is injectable for tests — the default reads the developer's real preferences file.
 */
export async function handleTeamStatus(
  _req: Request,
  deps: { readPreferences?: typeof readPreferences } = {},
): Promise<Response> {
  const prefs = await (deps.readPreferences ?? readPreferences)()
  const team = prefs.team
  const connections = team?.connections ?? []
  const byConn = getUploaderStatus()

  // The local honesty markers (§4.4/§5.9) describe THIS MACHINE's own Claude rollup — the same
  // fact for every connection — so they are computed ONCE and reused per entry, never derived per
  // connection and never put on the wire to any central.
  //
  // Read from the LAST-BUILT push context (`peekPushContext`, stale-tolerant), never
  // `getPushContext()`, which BUILDS one. The browser polls this route every ~5s while
  // `notifyDataChanged()` invalidates the context on every local file change, so during active
  // coding the TTL protects nothing and building here ran `buildApiResponse()` — which also
  // WRITES the consolidate store — plus `loadConsolidated()` at the poll cadence instead of the
  // connection's push interval. These two fields are display-only: serving them one push cycle
  // stale is correct, and `null` ("unknowable", already distinct from `0` on this route and in
  // the UI) is correct before the first cycle has run. Never coerce it to 0.
  const ctx = connections.length > 0 ? peekPushContext() : null
  const boundary = ctx?.realStatsCache ? attributionBoundary(ctx.realStatsCache) : null
  const prehistorySessions = ctx?.realStatsCache ? prehistoryCount(ctx.realStatsCache, boundary) : null

  const entries: ConnectionStatusEntry[] = await Promise.all(connections.map(async c => {
    // A connection that has not run a single cycle yet has no entry at all in
    // `getUploaderStatus()` (it only reports ids that pushed or failed) — `emptyStatusFor` is the
    // one definition of what that state looks like, so the shape can never drift between the
    // "never ran" and "ran" branches of this response.
    const uploaderStatus = byConn[c.id] ?? emptyStatusFor(c.id)
    const rules = await loadRulesState(c.id)
    return buildConnectionStatusEntry(c, uploaderStatus, {
      boundary,
      prehistorySessions,
      canForget: connectionCanForget(c.id),
      resync: getResyncProgress(c.id),
      rulesHash: rules.rulesHash,
    })
  }))
  const aggregated = aggregateConnectionStatuses(entries)
  return json({ mode: team?.mode ?? 'solo', ...aggregated, otelExportEnabled: otelExportEnabled(), connections: entries })
}
