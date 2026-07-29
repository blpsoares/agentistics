/**
 * team-uploader.ts — local → central push for Team Member mode, PER CONNECTION.
 *
 * A machine can be a member of several centrals at once (`preferences.team.connections[]`).
 * Every piece of mutable state that used to be a module-level singleton (error streaks, last
 * success, learned interval, the `running` guard, the debounce timer, the sent-state and
 * sync-signature files) is now keyed by connection id, so one central's failure, cadence or
 * revoked token can never affect another.
 *
 * Pure functions (sessionHash, selectDeltas) are unit-tested.
 * IO functions (loadSentState, saveSentState, pushOnceDetailed, startUploader) are
 * integration-tested manually. handleTeamTestConnection exposes the
 * test-connection route handler.
 *
 * Secrets: the bearer token is NEVER logged.
 */

import { createHash } from 'node:crypto'
import { writeFile, unlink } from 'node:fs/promises'
import type { SessionMeta, StatsCache, WorkflowRun, TeamConnection, TeamConfig } from '@agentistics/core'
import { PUSH_INTERVAL, clampPushInterval, defaultTeam, normalizeTeamConfig, redactSessionText } from '@agentistics/core'
import { teamSentFile, teamSyncFile, teamRulesFile, teamForgetFile } from './config'
import { loadConsolidated } from './consolidate'
import { loadWorkflowRuns } from './workflow-store'
import { readPreferences, updateTeamConfig } from './preferences'
import { safeReadJson } from './utils'
import { migrateTeamStateOnce, convertSentStateV1, type SentStateV2 } from './team-migrate'
import type { ServerProject } from './data'

/** This machine's local workflow runs (computed metrics only — no chat/prompt text). Fallback
 *  source when `buildApiResponse` could not be run (see `buildPushContext`). Mirrors the
 *  contract of `buildApiResponse`'s `workflows` field: best-effort, never throws. */
async function readMemberWorkflows(): Promise<WorkflowRun[]> {
  try {
    const map = await loadWorkflowRuns()
    return Array.from(map.values())
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Per-connection mutable state — every singleton from the single-central era is now a Map/Set
// keyed by connection id, so state can never leak from one central to another.
// ---------------------------------------------------------------------------

/** Throttle repeated "can't reach central" warnings per connection. */
const _netErrStreak = new Map<string, number>()
/** ms epoch of the last successful contact with each central, for the status pill. */
const _lastSuccessAt = new Map<string, number>()
/** Current error state per connection: 'auth' | 'net'. Absent = ok. */
const _pushErrKind = new Map<string, 'auth' | 'net'>()
/** Consecutive auth-error cycles per connection (see handleAuthError). */
const _authErrStreak = new Map<string, number>()
/** The interval (seconds) most recently learned from each central's policy. */
const _centralIntervalSec = new Map<string, number>()
/** Connection ids with a push cycle currently in flight. */
const _running = new Set<string>()
/** Connection ids where a change arrived while `_running` — re-run instead of dropping it. */
const _pendingTrigger = new Set<string>()

function hostOf(endpoint: string): string {
  try { return new URL(endpoint).host || endpoint } catch { return endpoint }
}

/** Display label for a connection in notifications — a nickname if set, else the endpoint host.
 *  Never the token. */
function labelOf(conn: TeamConnection): string {
  return conn.label ?? hostOf(conn.endpoint)
}

function notifyMeta(conn: TeamConnection, extra?: Record<string, unknown>): Record<string, unknown> {
  return { ...extra, connectionId: conn.id, central: labelOf(conn) }
}

type NotifyPayload = { type: 'error' | 'warning' | 'info' | 'success'; code?: string; meta?: Record<string, unknown> }
type Notifier = (n: NotifyPayload) => void

/** Every SSE broadcast in this module goes through this ONE indirection, so tests can swap it
 *  for a no-op/recorder instead of writing a real entry into the developer's
 *  `~/.agentistics/notifications.json` every time an error/recovery test scenario runs. */
function realNotify(n: NotifyPayload): void {
  void import('./sse').then(m => m.broadcastNotification(n)).catch(() => { /* best-effort */ })
}
let _notify: Notifier = realNotify

/** Test-only override — never called from production code. */
export function __setNotifierForTests(fn: Notifier | null): void {
  _notify = fn ?? realNotify
}

function warnPushError(connId: string, msg: string): void {
  const n = (_netErrStreak.get(connId) ?? 0) + 1
  _netErrStreak.set(connId, n)
  if (n === 1 || n % 20 === 0) {
    console.warn(`[team-uploader] ${connId} cannot reach central (${n}x, silencing repeats): ${msg}`)
  }
}
function clearPushError(connId: string): void {
  if ((_netErrStreak.get(connId) ?? 0) > 0) {
    console.info(`[team-uploader] ${connId} central reachable again — resuming pushes`)
  }
  _netErrStreak.set(connId, 0)
}
/** Record a successful contact with a central (used by the status pill + recovery). */
function markPushSuccess(connId: string): void {
  _lastSuccessAt.set(connId, Date.now())
  _authErrStreak.set(connId, 0) // any success clears the revoke countdown
}

export interface UploaderStatus {
  /** ms epoch of the last successful contact with the central, or null if never. */
  lastSuccessAt: number | null
  /** current error state: 'auth' (rejected), 'net' (unreachable), or null (ok). */
  errKind: 'auth' | 'net' | null
}

/** A fresh, empty status — what a connection reports before its first cycle ever runs. */
export function emptyStatusFor(_connId: string): UploaderStatus {
  return { lastSuccessAt: null, errKind: null }
}

/** A `lastSuccessAt` this stale relative to a connection's own known interval, with NO error
 *  recorded, means something is silently blocking that a transition-based error would normally
 *  catch — the defense-in-depth half of the B-1 fix (the fetch timeout is the primary fix; this
 *  is what keeps the status pill honest if some other, not-yet-known hang ever slips past it).
 *  Floored at 5 minutes even for express (5s) intervals, so a merely-slow-but-fine cycle never
 *  flickers into "unreachable". */
const STALE_INTERVAL_MULTIPLIER = 3
const STALE_FLOOR_MS = 5 * 60_000

/** Per-connection status snapshot, keyed by connection id. Only connections that have run at
 *  least one cycle (successful or not) appear — a connection with neither key present should be
 *  reported via `emptyStatusFor`. A `lastSuccessAt` far enough in the past is reported as `'net'`
 *  even when no explicit error was ever recorded — see `STALE_INTERVAL_MULTIPLIER`. */
export function getUploaderStatus(): Record<string, UploaderStatus> {
  const out: Record<string, UploaderStatus> = {}
  const now = Date.now()
  for (const id of new Set([..._lastSuccessAt.keys(), ..._pushErrKind.keys()])) {
    const lastSuccessAt = _lastSuccessAt.get(id) ?? null
    let errKind = _pushErrKind.get(id) ?? null
    if (errKind === null && lastSuccessAt !== null) {
      const intervalMs = (_centralIntervalSec.get(id) ?? PUSH_INTERVAL.DEFAULT_SEC) * 1000
      const staleAfterMs = Math.max(STALE_FLOOR_MS, intervalMs * STALE_INTERVAL_MULTIPLIER)
      if (now - lastSuccessAt > staleAfterMs) errKind = 'net'
    }
    out[id] = { lastSuccessAt, errKind }
  }
  return out
}

// Transition-based user notifications — emit once when entering an error state (auth vs
// network) and once on recovery, so a persistent failure never spams the toast/bell.
// The frontend localizes by `code`; `meta` carries interpolation values (status) plus
// `connectionId`/`central` so multiple centrals never collapse into one toast.
async function notifyPushError(conn: TeamConnection, kind: 'auth' | 'net', meta?: Record<string, unknown>): Promise<void> {
  if (_pushErrKind.get(conn.id) === kind) return
  _pushErrKind.set(conn.id, kind)
  _notify({
    type: kind === 'auth' ? 'error' : 'warning',
    code: kind === 'auth' ? 'member.auth_rejected' : 'member.unreachable',
    meta: notifyMeta(conn, meta),
  })
}
async function notifyPushRecovered(conn: TeamConnection): Promise<void> {
  if (!_pushErrKind.has(conn.id)) return
  _pushErrKind.delete(conn.id)
  _notify({ type: 'success', code: 'member.reconnected', meta: notifyMeta(conn) })
}

// A 401/403 means the central revoked/removed this connection's token. Count consecutive
// auth-error cycles; after this many the connection auto-removes itself (see handleAuthError).
// One transient 401 (e.g. a mid-rotation blip) is tolerated.
const AUTH_ERR_RESET_THRESHOLD = 2

/**
 * Handle a persistent-auth (401/403) push failure for one connection. Emits the first-error
 * notification (transition-guarded) and counts consecutive auth-error cycles. Once the count
 * reaches AUTH_ERR_RESET_THRESHOLD the token is treated as revoked and ONLY this connection is
 * removed — the other connections in `connections[]` are untouched. Reset the streak to 0 on
 * any success (see markPushSuccess).
 */
async function handleAuthError(conn: TeamConnection, status: number): Promise<void> {
  await notifyPushError(conn, 'auth', { status })
  const streak = (_authErrStreak.get(conn.id) ?? 0) + 1
  _authErrStreak.set(conn.id, streak)
  if (streak >= AUTH_ERR_RESET_THRESHOLD) {
    await removeConnection(conn.id, 'revoked')
  }
}

/** Fire-and-forget `handleAuthError`, WITH a `.catch()` — it reaches `removeConnection` →
 *  `readPreferences()`/`updateTeamConfig()`, which throw by design on a corrupt preferences file
 *  (see preferences.ts). Bare `void handleAuthError(...)` would turn that into an unhandled
 *  rejection instead of the same best-effort warning every other failure path in this file logs. */
function fireHandleAuthError(conn: TeamConnection, status: number): void {
  void handleAuthError(conn, status).catch(err =>
    console.warn(`[team-uploader] handleAuthError failed for ${conn.id}:`, err instanceof Error ? err.message : String(err)))
}

/**
 * The central revoked this connection's token (or it is being removed for another reason).
 * Splices ONLY this connection out of `connections[]` — never rewrites the whole team config —
 * so with N connections a single revoked token disconnects exactly one central:
 *   (i)   stop this connection's timers (chain + debounce) and clear its in-memory state,
 *   (ii)  splice `connections[]` via `updateTeamConfig`, whose mutator runs INSIDE
 *         preferences.ts's single write chain — the array it reads is the one current at ITS
 *         turn to write, not a snapshot from before this call started. Without this, two
 *         connections crossing `AUTH_ERR_RESET_THRESHOLD` in the same window (routine, not
 *         theoretical, now that up to 2 run concurrently) could both read `[A, B, C]` and the
 *         second write would resurrect the first removal.
 *   (iii) GC this connection's four state files (sent/sync/rules/forget) AFTER the write
 *         persists — never from the supervisor tick, which would race the add path,
 *   (iv)  best-effort nudge the reverse-channel client to re-reconcile its socket,
 *   (v)   emit a 'member.removed' notification naming this connection.
 * Idempotent — once the connection is gone from preferences, a second call is a no-op (and,
 * since the mutator returns `undefined` in that case, does not even re-write the file).
 *
 * `deps.updateTeamConfig` is injectable for tests — the default touches the developer's real
 * ~/.agentistics/preferences.json, which a test must never do.
 */
export async function removeConnection(
  connId: string,
  _reason: 'revoked' | 'manual' = 'revoked',
  deps: { updateTeamConfig?: typeof updateTeamConfig } = {},
): Promise<void> {
  const _updateTeamConfig = deps.updateTeamConfig ?? updateTeamConfig
  teardownConnection(connId)

  let removedConn: TeamConnection | undefined
  try {
    await _updateTeamConfig((current: TeamConfig) => {
      const existing = current.connections ?? []
      removedConn = existing.find(c => c.id === connId)
      if (!removedConn) return undefined // already removed — don't spam, don't re-write
      const remaining = existing.filter(c => c.id !== connId)
      return normalizeTeamConfig({ ...defaultTeam(), connections: remaining })
    })
  } catch (err) {
    console.warn(`[team-uploader] failed to persist removal of ${connId}:`, err instanceof Error ? err.message : String(err))
    return
  }
  if (!removedConn) return

  // GC only after the config write above persisted — a timer-driven GC (e.g. from the
  // supervisor) could otherwise race a concurrent "add connection" write.
  await Promise.allSettled([
    unlink(teamSentFile(connId)),
    unlink(teamSyncFile(connId)),
    unlink(teamRulesFile(connId)),
    unlink(teamForgetFile(connId)),
  ])

  console.warn(`[team-uploader] removed connection ${connId} (${hostOf(removedConn.endpoint)}) — central revoked this token or it was removed`)
  try {
    const { reconcileNow } = await import('./team-agent-client')
    reconcileNow()
  } catch { /* best-effort — the reverse-channel client is still single-socket; see report */ }
  _notify({ type: 'warning', code: 'member.removed', meta: notifyMeta(removedConn) })
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Deterministic content fingerprint of a session (stable JSON). */
export function sessionHash(s: SessionMeta): string {
  return JSON.stringify(s)
}

export interface SentState {
  [sessionId: string]: string // sessionId → last-sent hash
}

export interface SelectDeltasResult {
  toSend: SessionMeta[]
  nextSent: SentState
}

/**
 * Select sessions whose content changed (or are new) vs the sent state.
 * Returns the sessions to push and the next sent-state to persist after a
 * successful push.
 *   toSend   = sessions where sent[session_id] !== sessionHash(s)
 *   nextSent = { ...sent, [each toSend session_id]: its hash }
 *              (merged so unchanged sessions remain in the state)
 */
export function selectDeltas(sessions: SessionMeta[], sent: SentState): SelectDeltasResult {
  const toSend: SessionMeta[] = []
  const nextSent: SentState = { ...sent }

  for (const raw of sessions) {
    const id = raw.session_id
    if (!id) continue
    // Scrub credentials out of the free text BEFORE anything else. This is the last point the
    // data is still purely local, so a secret pasted into a first prompt never crosses the wire.
    // Hashing the REDACTED session keeps sent-state consistent: an unchanged session still hashes
    // the same on every run, so this does not cause a permanent re-send loop.
    const s = redactSessionText(raw)
    const hash = sessionHash(s)
    if (sent[id] !== hash) {
      toSend.push(s)
      nextSent[id] = hash
    }
  }

  return { toSend, nextSent }
}

// ---------------------------------------------------------------------------
// Per-connection sent-state IO
// ---------------------------------------------------------------------------

/** Load the raw (v2) sent-state document for a connection, defaulting to an empty one.
 *  `convertSentStateV1` also accepts an already-v2 file unchanged, so this is the single read
 *  path regardless of which version is on disk (team-migrate.ts writes v2 directly). */
async function loadRawSentState(connId: string): Promise<SentStateV2> {
  const raw = await safeReadJson<unknown>(teamSentFile(connId))
  return convertSentStateV1(raw) ?? { version: 2, hashes: {}, runIds: [] }
}

/** Load sent-state for one connection (= {} if missing or corrupt). */
export async function loadSentState(connId: string): Promise<SentState> {
  const v2 = await loadRawSentState(connId)
  return v2.hashes
}

/** Persist sent-state for one connection. Preserves the file's `runIds` (owned by the
 *  share-rules removal flow, untouched by this module) so a push never clobbers it. */
export async function saveSentState(connId: string, state: SentState): Promise<void> {
  const current = await loadRawSentState(connId)
  const next: SentStateV2 = { version: 2, hashes: state, runIds: current.runIds }
  await writeFile(teamSentFile(connId), JSON.stringify(next, null, 2), 'utf-8')
}

const BATCH_SIZE = 200

// ---------------------------------------------------------------------------
// Shared push-cycle context — built ONCE per cycle window and reused by every connection's
// push, so N centrals never trigger N independent buildApiResponse() + full store scans.
// ---------------------------------------------------------------------------

/**
 * The inputs every connection's push needs, built from a SINGLE `buildApiResponse()` call.
 *
 * `realStatsCache` is the supplemented cache and `liveSessions` is the EXACT array it was
 * supplemented from — they must always travel together (see `buildSplitStatsCache`'s
 * same-array precondition in share-rules.ts, not called from this module yet, but a later plan
 * wires it in and inherits whatever pairing this context establishes).
 *
 * `storedSessions` is a DIFFERENT set — the consolidate store, loaded via `loadConsolidated()`
 * AFTER `buildApiResponse()` (which is what writes that store) so it is never read cold or
 * half-written. `storedSessions` is what is actually pushed to the central as session
 * documents; `liveSessions` only feeds arithmetic that assumes the live, complete array.
 */
export interface PushCycleContext {
  /** The supplemented cache — and the array it was supplemented from. They must be the pair. */
  realStatsCache: StatsCache | null
  /** feeds the split's arithmetic (a later plan) — never pushed to the central directly */
  liveSessions: SessionMeta[]
  /** The consolidate store — what is actually PUSHED as session documents. A different set. */
  storedSessions: SessionMeta[]
  projects: ServerProject[]
  workflows: WorkflowRun[]
  builtAt: number
  /** Ingest fetch timeout override, in ms — injectable for tests so a "central that never
   *  responds" regression test doesn't have to wait out the real production timeout. Production
   *  code never sets this; `pushOnceDetailed` falls back to `DEFAULT_INGEST_TIMEOUT_MS`. */
  ingestTimeoutMs?: number
}

/** Every fetch to a central's `/api/team/ingest` MUST carry a timeout. Without one, a wedged
 *  reverse proxy or a suspended container can accept the TCP connection and simply never
 *  respond — common, not exotic — and `runConnectionPushCycle` holds a concurrency-cap slot
 *  across that fetch, so two such centrals permanently occupy both slots and every OTHER
 *  connection blocks in `acquireSlot()` forever, with no error and a `lastSuccessAt` that is
 *  only ever set, never aged out. 15s is generous enough for a legitimately slow link pushing a
 *  full 200-session batch, while still guaranteeing the slot is released. */
const DEFAULT_INGEST_TIMEOUT_MS = 15_000

let _cachedContext: PushCycleContext | null = null
let _contextPromise: Promise<PushCycleContext> | null = null

/** The minimum interval (seconds) learned from any connection's central so far, used to bound
 *  how long the shared push context stays fresh. Falls back to the default before any policy has
 *  been learned. */
function minKnownIntervalSec(): number {
  const values = Array.from(_centralIntervalSec.values())
  return values.length ? Math.min(...values) : PUSH_INTERVAL.DEFAULT_SEC
}

/** Injectable data sources for `buildPushContext` — production code never passes this; it exists
 *  so tests can supply fakes and assert call ORDER (buildApiResponse before loadConsolidated)
 *  and content, without touching the real `~/.claude`/`~/.agentistics` on the machine running the
 *  test. */
interface PushContextDeps {
  buildApiResponse?: () => Promise<{ sessions: SessionMeta[]; statsCache: StatsCache | null; projects: ServerProject[]; workflows?: WorkflowRun[] }>
  loadConsolidated?: () => Promise<Map<string, SessionMeta>>
  readMemberWorkflows?: () => Promise<WorkflowRun[]>
}

export async function buildPushContext(deps: PushContextDeps = {}): Promise<PushCycleContext> {
  // buildApiResponse() FIRST — it is what WRITES the consolidate store. Loading the store
  // before this runs would read a cold or half-written one (see the class doc above).
  const _buildApiResponse = deps.buildApiResponse ?? (await import('./data')).buildApiResponse
  let resp: Awaited<ReturnType<typeof _buildApiResponse>> | null = null
  try {
    resp = await _buildApiResponse()
  } catch (err) {
    console.warn('[team-uploader] buildApiResponse failed while building the push context:', err instanceof Error ? err.message : String(err))
  }
  const liveSessions = resp?.sessions ?? []
  // NOT falling back to the raw `~/.claude/stats-cache.json` here (unlike the pre-multi-central
  // code, which read it via safeReadJson when buildApiResponse failed): that raw cache would be
  // paired with `liveSessions: []` (buildApiResponse itself threw, so there IS no live array),
  // which is exactly the same-array precondition this context exists to uphold — a later plan's
  // `buildSplitStatsCache` call would either misattribute a cache to an empty session array or
  // (if it re-validates, as it does) simply refuse the whole cycle. `null` here correctly means
  // "no statsCache this cycle" and pushOnceDetailed already treats that as "nothing to push"
  // rather than inventing paired data that isn't there.
  const realStatsCache = resp?.statsCache ?? null
  const projects = resp?.projects ?? []

  let storedSessions: SessionMeta[] = []
  try {
    const _loadConsolidated = deps.loadConsolidated ?? loadConsolidated
    const consolidatedMap = await _loadConsolidated()
    storedSessions = Array.from(consolidatedMap.values())
  } catch { /* best-effort — an empty store just means nothing to push this cycle */ }

  // buildApiResponse already merges live-discovered + stored workflow runs (see data.ts); reuse
  // it rather than re-reading the store a second time. Fall back to the raw store only if the
  // build itself failed above.
  const _readMemberWorkflows = deps.readMemberWorkflows ?? readMemberWorkflows
  const workflows = resp?.workflows ?? await _readMemberWorkflows()

  return { realStatsCache, liveSessions, storedSessions, projects, workflows, builtAt: Date.now() }
}

/**
 * Return the shared push-cycle context, rebuilding it only once every `min(intervals)/2`.
 * Concurrent callers within that window await the SAME in-flight build instead of each starting
 * their own `buildApiResponse()` + full store scan.
 */
export async function getPushContext(deps: PushContextDeps = {}): Promise<PushCycleContext> {
  const ttlMs = Math.max(1_000, (minKnownIntervalSec() * 1000) / 2)
  if (_cachedContext && Date.now() - _cachedContext.builtAt < ttlMs) return _cachedContext
  if (_contextPromise) return _contextPromise
  _contextPromise = buildPushContext(deps)
    .then(ctx => {
      _cachedContext = ctx
      _contextPromise = null
      return ctx
    })
    .catch(err => {
      _contextPromise = null
      throw err
    })
  return _contextPromise
}

/** Drop the cached push-cycle context so the next `getPushContext()` rebuilds instead of serving
 *  a pre-change snapshot. `notifyDataChanged()` calls this on every local data change (see its
 *  docstring); exported so a test can also call it directly without needing `startUploader()`
 *  (which would start the real 5s supervisor against the developer's real preferences file). */
export function invalidatePushContext(): void {
  _cachedContext = null
}

// ---------------------------------------------------------------------------
// Push — per connection
// ---------------------------------------------------------------------------

export interface PushOnceResult {
  count: number
  error?: string
}

/**
 * Core push implementation for ONE connection against the SHARED cycle context.
 * No-op (count=0) when the connection has no endpoint or resolved user (not yet fully
 * connected). Never throws.
 */
export async function pushOnceDetailed(conn: TeamConnection, ctx: PushCycleContext): Promise<PushOnceResult> {
  if (!conn.endpoint || !conn.user) {
    return { count: 0 }
  }
  const endpoint = conn.endpoint.replace(/\/+$/, '')
  const ingestTimeoutMs = ctx.ingestTimeoutMs ?? DEFAULT_INGEST_TIMEOUT_MS

  try {
    const sent = await loadSentState(conn.id)
    const { toSend, nextSent } = selectDeltas(ctx.storedSessions, sent)
    // The member's own statsCache (aggregated Claude history) is pushed so the central can
    // reproduce exact totals; it changes as activity accrues even when no new sessions exist.
    const statsCache = ctx.realStatsCache ?? undefined
    // Local workflow runs (computed metrics only — no chat/prompt text, same privacy contract
    // as sessions). Pushed as a full set each cycle; the central upserts idempotently by
    // runId, so this never double-counts.
    const workflows = ctx.workflows

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (conn.token) {
      headers['Authorization'] = `Bearer ${conn.token}`
    }

    if (toSend.length === 0) {
      // No session deltas — still push the statsCache/workflows on their own so totals
      // and workflow runs stay fresh.
      if (statsCache || workflows.length > 0) {
        try {
          const res = await fetch(`${endpoint}/api/team/ingest`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ org: conn.org, user: conn.user, sessions: [], statsCache, workflows }),
            signal: AbortSignal.timeout(ingestTimeoutMs),
          })
          // A reachable central (even a non-2xx that isn't auth) counts as contact for the pill.
          if (res.ok) { markPushSuccess(conn.id); clearPushError(conn.id); void notifyPushRecovered(conn) }
          else if (res.status === 401 || res.status === 403) fireHandleAuthError(conn, res.status)
        } catch (e) {
          warnPushError(conn.id, e instanceof Error ? e.message : String(e))
          void notifyPushError(conn, 'net')
        }
      }
      return { count: 0 }
    }

    let pushed = 0

    for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
      const batch = toSend.slice(i, i + BATCH_SIZE)
      let res: Response
      try {
        res = await fetch(`${endpoint}/api/team/ingest`, {
          method: 'POST',
          headers,
          // Attach the statsCache/workflows to the first batch only (idempotent upsert on the central).
          body: JSON.stringify({ org: conn.org, user: conn.user, sessions: batch, ...(i === 0 ? { statsCache, workflows } : {}) }),
          signal: AbortSignal.timeout(ingestTimeoutMs),
        })
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
        warnPushError(conn.id, msg)
        void notifyPushError(conn, 'net')
        return { count: pushed, error: msg }
      }

      if (!res.ok) {
        const msg = `ingest returned ${res.status}`
        console.warn(`[team-uploader] ${conn.id} ${msg}; stopping push`)
        // 401/403 = the central rejected the token → actionable auth notification (and,
        // after repeated failures, this connection is auto-removed).
        if (res.status === 401 || res.status === 403) fireHandleAuthError(conn, res.status)
        return { count: pushed, error: msg }
      }

      // Batch succeeded — advance this connection's sent-state for this batch
      const batchSent: SentState = {}
      for (const s of batch) {
        if (s.session_id) batchSent[s.session_id] = nextSent[s.session_id]!
      }
      const current = await loadSentState(conn.id)
      await saveSentState(conn.id, { ...current, ...batchSent })
      pushed += batch.length
      markPushSuccess(conn.id)
      clearPushError(conn.id)
      void notifyPushRecovered(conn)
    }

    return { count: pushed }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[team-uploader] unexpected error in pushOnceDetailed (${conn.id}):`, msg)
    return { count: 0, error: msg }
  }
}

// ---------------------------------------------------------------------------
// Concurrency cap — pushes run sequentially with AT MOST 2 in flight at once, so one hung
// central can never exhaust sockets or starve the others. A plain Promise.all over every
// connection would have no such bound.
// ---------------------------------------------------------------------------

export const MAX_CONCURRENT_PUSHES = 2
let _activeSlots = 0
const _slotWaiters: Array<() => void> = []

/** Test-only accessor onto the semaphore's internal count — lets a test assert the invariant
 *  (`_activeSlots` never exceeds `MAX_CONCURRENT_PUSHES`) directly instead of inferring it from
 *  timing. Never called from production code. */
export function __activeSlotsForTests(): number {
  return _activeSlots
}

/**
 * Release a slot. If a waiter is queued, the slot is TRANSFERRED directly to it (the woken
 * waiter's `acquireSlot()` does NOT increment `_activeSlots` again) rather than decremented and
 * then re-incremented by the waiter — decrement-then-signal briefly counted 3 in flight against
 * a cap of 2 whenever a synchronous arrival raced the woken waiter's own increment.
 */
function releaseSlot(): void {
  const next = _slotWaiters.shift()
  if (next) { next(); return } // ownership transferred — _activeSlots is unchanged
  _activeSlots--
}

/** Exported for tests only (the B-5 semaphore regression test) — every production call site
 *  stays internal to this module. */
export async function acquireSlot(): Promise<() => void> {
  if (_activeSlots < MAX_CONCURRENT_PUSHES) {
    _activeSlots++
    return releaseSlot
  }
  await new Promise<void>(resolve => { _slotWaiters.push(resolve) })
  // The slot was TRANSFERRED by releaseSlot above, not freed — no increment here.
  return releaseSlot
}

// ---------------------------------------------------------------------------
// Periodic per-connection uploader
// ---------------------------------------------------------------------------

/**
 * Fetch the central policy: push interval + the central's data instanceId.
 * Falls back to the default interval / null id on any network or parse error.
 */
async function fetchCentralPolicy(endpoint: string): Promise<{ intervalSec: number; instanceId: string | null }> {
  try {
    const res = await fetch(`${endpoint}/api/team/policy`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return { intervalSec: PUSH_INTERVAL.DEFAULT_SEC, instanceId: null }
    const json = await res.json() as { pushIntervalSec?: unknown; instanceId?: unknown }
    const sec = typeof json.pushIntervalSec === 'number' ? json.pushIntervalSec : PUSH_INTERVAL.DEFAULT_SEC
    const instanceId = typeof json.instanceId === 'string' ? json.instanceId : null
    // Honor express intervals (the central may dictate below the normal 15s floor).
    return { intervalSec: clampPushInterval(sec, PUSH_INTERVAL.EXPRESS_MIN_SEC), instanceId }
  } catch {
    return { intervalSec: PUSH_INTERVAL.DEFAULT_SEC, instanceId: null }
  }
}

/**
 * Auto-reconcile one connection's sent-state with its central. The sent-state assumes the
 * central still holds everything we pushed — but a destructive action (member revoked +
 * re-added, a new central endpoint, or a wiped central DB) breaks that assumption silently. We
 * fingerprint the current target as endpoint+token+instanceId; when it differs from what the
 * sent-state was built against, we clear the sent-state so the next push re-sends the full
 * history.
 *
 * Re-pushing is idempotent (the central upserts by session_id), so a reset never double-counts.
 * A null instanceId (old/unreachable central) is treated as empty — it never spuriously resets.
 */
async function reconcileSyncState(connId: string, endpoint: string, token: string, instanceId: string | null): Promise<void> {
  // Only reconcile against a KNOWN central identity. A null instanceId means the central is
  // unreachable or predates this feature — reconciling then would falsely reset on every flap.
  if (!instanceId) return
  const sig = createHash('sha256').update(`${endpoint}\0${token}\0${instanceId}`).digest('hex')
  const prev = await safeReadJson<{ sig?: string }>(teamSyncFile(connId))
  if (prev?.sig === sig) return // target unchanged — nothing to reconcile

  // Signature changed (or first run) → the central may not have our data. Clear the sent-state
  // so the next push re-sends everything, then record the new signature.
  await saveSentState(connId, {})
  _lastSuccessAt.delete(connId)
  try {
    await writeFile(teamSyncFile(connId), JSON.stringify({ sig }), 'utf-8')
  } catch { /* best-effort — worst case we reconcile again next cycle */ }
  if (prev?.sig) console.info(`[team-uploader] ${connId} central sync signature changed — re-pushing full history`)
}

/** Fully reset one connection's local sync state (sent-state + signature). Called when leaving a
 *  central, so a later rejoin re-pushes the full history rather than trusting a now-deleted
 *  dataset. */
async function resetSyncState(connId: string): Promise<void> {
  await saveSentState(connId, {})
  _lastSuccessAt.delete(connId)
  try { await writeFile(teamSyncFile(connId), '{}', 'utf-8') } catch { /* best-effort */ }
}

// Push-on-change: coalesce a burst of local file changes into a single push per connection, and
// never push more often than that connection's central interval floor.
const ON_CHANGE_DEBOUNCE_MS = 2_000
const SUPERVISOR_INTERVAL_MS = 5_000

/** Recursive chain timers, one per connection with an active chain. */
const _chainTimer = new Map<string, ReturnType<typeof setTimeout>>()
/** Debounce timers for the on-change trigger, one per connection. */
const _onChangeTimer = new Map<string, ReturnType<typeof setTimeout>>()
/** Connection ids with a live recursive schedule chain (what the supervisor diffs against). */
const _activeChains = new Set<string>()

function stopConnectionChain(connId: string): void {
  _activeChains.delete(connId)
  const t = _chainTimer.get(connId)
  if (t) { clearTimeout(t); _chainTimer.delete(connId) }
  const ct = _onChangeTimer.get(connId)
  if (ct) { clearTimeout(ct); _onChangeTimer.delete(connId) }
}

/** Clear ALL in-memory state for a connection — timers plus status/error maps. Does NOT touch
 *  disk; file GC is the exclusive responsibility of `removeConnection`'s serialized write (see
 *  its docstring — a timer-driven GC would race the add path). */
function teardownConnection(connId: string): void {
  stopConnectionChain(connId)
  _running.delete(connId)
  _pendingTrigger.delete(connId)
  _lastSuccessAt.delete(connId)
  _pushErrKind.delete(connId)
  _authErrStreak.delete(connId)
  _netErrStreak.delete(connId)
  _centralIntervalSec.delete(connId)
}

function scheduleConnectionCycle(connId: string, delaySec: number): void {
  const existing = _chainTimer.get(connId)
  if (existing) clearTimeout(existing)
  const t = setTimeout(() => { void runConnectionCycle(connId) }, Math.max(0, delaySec) * 1_000)
  t.unref?.()
  _chainTimer.set(connId, t)
}

/** Injectable for tests — `ctx`, when supplied, is used VERBATIM instead of calling the internal
 *  `getPushContext()`, which otherwise touches the real `~/.claude`/`~/.agentistics` (via
 *  `buildApiResponse()`/`loadConsolidated()`) unless a NEIGHBOURING test happens to have left a
 *  still-fresh fake context in the module-level cache — an accident a test must never depend on. */
interface RunPushCycleDeps {
  ctx?: PushCycleContext
}

/** The bounded (semaphore-limited) network portion of one connection's cycle: learn the
 *  central's policy, reconcile sync state, then push against the SHARED context. Returns the
 *  next interval (seconds) this connection should wait before its next cycle. */
async function runConnectionPushCycle(conn: TeamConnection, deps: RunPushCycleDeps = {}): Promise<number> {
  const release = await acquireSlot()
  try {
    const endpoint = conn.endpoint.replace(/\/+$/, '')
    const policy = await fetchCentralPolicy(endpoint)
    // The central is the sole authority on the interval; this connection follows it (honoring
    // express intervals below the normal 15s floor). No connection-side override.
    const nextIntervalSec = clampPushInterval(policy.intervalSec, PUSH_INTERVAL.EXPRESS_MIN_SEC)
    _centralIntervalSec.set(conn.id, nextIntervalSec)
    // Auto-heal a sent-state that no longer matches this central BEFORE pushing, so this cycle
    // re-sends the full history when needed.
    await reconcileSyncState(conn.id, endpoint, conn.token ?? '', policy.instanceId)
    const ctx = deps.ctx ?? await getPushContext()
    await pushOnceDetailed({ ...conn, endpoint }, ctx)
    return nextIntervalSec
  } finally {
    release()
  }
}

let _migrated = false

/** Injectable for tests — the defaults touch the developer's real preferences file and run the
 *  real (marker-guarded, so normally cheap) state migration; a test must never do either. `ctx`
 *  is threaded straight through to `runConnectionPushCycle` (see `RunPushCycleDeps`). */
interface RunCycleDeps {
  readPreferences?: typeof readPreferences
  migrateTeamStateOnce?: () => Promise<void>
  ctx?: PushCycleContext
}

/**
 * Run one connection's guarded cycle: skip (and remember) if a cycle is already running for
 * this connection — a mid-cycle trigger is DEFERRED via `_pendingTrigger`, never dropped. Always
 * reschedules itself while the chain is active, so this single function is both the periodic
 * timer body and the on-change trigger's target. Exported for tests (see `RunCycleDeps`).
 */
export async function runConnectionCycle(connId: string, deps: RunCycleDeps = {}): Promise<void> {
  if (_running.has(connId)) {
    _pendingTrigger.add(connId)
    return
  }
  _running.add(connId)
  let nextIntervalSec: number = PUSH_INTERVAL.DEFAULT_SEC
  try {
    if (!_migrated) {
      _migrated = true
      // A machine that never boots the full server (member-only) still needs the once-per-
      // install move to the per-connection state layout — run it before the first push.
      const _migrateTeamStateOnce = deps.migrateTeamStateOnce ?? migrateTeamStateOnce
      await _migrateTeamStateOnce().catch(err =>
        console.warn('[team-migrate] state migration failed (will retry next boot):', err instanceof Error ? err.message : String(err)))
    }
    const _readPreferences = deps.readPreferences ?? readPreferences
    const prefs = await _readPreferences()
    const conn = (prefs.team?.connections ?? []).find(c => c.id === connId)
    if (!conn) {
      // Removed between scheduling and firing — the supervisor will also catch this, but stop
      // right away rather than waiting for its next tick.
      stopConnectionChain(connId)
      return
    }
    nextIntervalSec = await runConnectionPushCycle(conn, { ctx: deps.ctx })
  } catch (err) {
    console.warn(`[team-uploader] cycle error for ${connId}:`, err instanceof Error ? err.message : String(err))
  } finally {
    _running.delete(connId)
    const hadPending = _pendingTrigger.delete(connId)
    if (_activeChains.has(connId)) {
      // A change arrived mid-cycle — run again soon instead of waiting a full interval.
      scheduleConnectionCycle(connId, hadPending ? 1 : nextIntervalSec)
    }
  }
}

function startConnectionChain(conn: TeamConnection): void {
  if (_activeChains.has(conn.id)) return
  _activeChains.add(conn.id)
  // First cycle ~800 ms after the chain starts — short enough that a connection added while the
  // server is already running (or a member that starts already configured) shows up on its
  // central almost immediately, then the cadence becomes dynamic from that central's policy.
  scheduleConnectionCycle(conn.id, 0.8)
}

/**
 * Diff `preferences.team.connections` against the live timer map: start a chain for a new
 * connection id, stop (and clear in-memory state for) a chain whose id is no longer present.
 * This is what makes adding/removing a central in the browser take effect without a restart.
 *
 * Deliberately does NOT GC state files for a removed id — that happens only inside
 * `removeConnection`'s serialized preferences write, never from a timer, or a GC here could race
 * a concurrent "add connection" write that reintroduces the same id.
 */
async function supervisorTick(): Promise<void> {
  try {
    const prefs = await readPreferences()
    const conns = prefs.team?.connections ?? []
    const liveIds = new Set(conns.map(c => c.id))

    for (const c of conns) {
      if (!_activeChains.has(c.id)) startConnectionChain(c)
    }
    for (const id of Array.from(_activeChains)) {
      if (!liveIds.has(id)) teardownConnection(id)
    }
  } catch (err) {
    console.warn('[team-uploader] supervisor tick error:', err instanceof Error ? err.message : String(err))
  }
}

let started = false
let _supervisorTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start the per-connection uploader. Idempotent — calling more than once is a no-op.
 * A supervisor tick runs every ~5s, diffing `preferences.team.connections` against the live
 * timer map (see `supervisorTick`), so connections added/removed at runtime take effect without
 * a server restart. Each connection then runs its own independent recursive cycle (see
 * `runConnectionCycle`), with actual network I/O bounded to at most 2 connections at once.
 */
export function startUploader(): void {
  if (started) return
  started = true
  void supervisorTick() // start any already-configured connections immediately, not after 5s
  _supervisorTimer = setInterval(() => { void supervisorTick() }, SUPERVISOR_INTERVAL_MS)
  _supervisorTimer.unref?.()
}

function scheduleOnChangeTrigger(connId: string): void {
  if (_onChangeTimer.has(connId)) return // already scheduled — coalesce a burst of file events
  const floorMs = (_centralIntervalSec.get(connId) ?? PUSH_INTERVAL.DEFAULT_SEC) * 1_000
  const lastSuccess = _lastSuccessAt.get(connId) ?? null
  const sinceLast = lastSuccess ? Date.now() - lastSuccess : Infinity
  const delay = Math.max(ON_CHANGE_DEBOUNCE_MS, floorMs - sinceLast)
  const t = setTimeout(() => {
    _onChangeTimer.delete(connId)
    void runConnectionCycle(connId)
  }, delay)
  t.unref?.()
  _onChangeTimer.set(connId, t)
}

/**
 * Signal that local data changed (called by the file watcher). Schedules a DEBOUNCED push for
 * EVERY connection with an active chain: coalesces a burst of file events into one push per
 * connection, and never pushes a given connection sooner than ITS OWN central's interval since
 * its last successful push. No-op until the uploader has started.
 *
 * ALSO invalidates the shared push-cycle context (`_cachedContext`). Without this, a change that
 * lands while a cached context is still within its TTL window (up to `min(intervals)/2`, e.g.
 * 15s by default) would be invisible to the very push this function schedules: `getPushContext`
 * would keep serving the pre-change snapshot, `selectDeltas` would find no delta against it, and
 * the change would silently wait for the NEXT full interval anyway — the same latency as the
 * dropped-event bug this function's deferral (`_pendingTrigger`) exists to fix, reached by a
 * different route. The single-flight promise in `getPushContext` already prevents the rebuild
 * stampede the TTL exists to avoid, so invalidating on every change is safe.
 */
export function notifyDataChanged(): void {
  invalidatePushContext()
  if (!started) return
  for (const connId of _activeChains) scheduleOnChangeTrigger(connId)
}

/**
 * Kick an immediate push cycle out of band (e.g. right after `member connect`), without waiting
 * for the next timer tick. When `connId` is given, only that connection is pushed; omitted means
 * every configured connection. The concurrency cap (`acquireSlot`) still applies, so this is safe
 * to call even with many connections. No-op for connections not yet configured.
 */
export async function pushNow(connId?: string): Promise<void> {
  const prefs = await readPreferences()
  const conns = prefs.team?.connections ?? []
  const targets = connId ? conns.filter(c => c.id === connId) : conns
  await Promise.all(targets.map(c => runConnectionCycle(c.id)))
}

// ---------------------------------------------------------------------------
// push-now route handler
// ---------------------------------------------------------------------------

interface PushNowResponse {
  ok: boolean
  count?: number
  error?: string
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/**
 * Push one connection against `ctx`, through the SAME `_running` guard and concurrency cap the
 * periodic cycle uses — an explicit push-now (this function's only caller) must never race a
 * periodic/on-change cycle already in flight for the same connection into a lost sent-state
 * update (two concurrent `saveSentState` calls for the same connId, last write wins, dropping
 * whichever batch's advance lost the race). If a cycle is already running for this connection,
 * this defers (matching `runConnectionCycle`'s `_pendingTrigger`) and returns a zero result
 * immediately rather than blocking the HTTP response — the already-running cycle picks up any
 * newer data on its own.
 */
async function guardedManualPush(conn: TeamConnection, ctx: PushCycleContext): Promise<PushOnceResult> {
  if (_running.has(conn.id)) {
    _pendingTrigger.add(conn.id)
    return { count: 0 }
  }
  _running.add(conn.id)
  const release = await acquireSlot()
  try {
    return await pushOnceDetailed(conn, ctx)
  } finally {
    release()
    _running.delete(conn.id)
  }
}

/**
 * Server-side handler for POST /api/team/push-now[?connId=...].
 * Reads current preferences, pushes every connection (or just `connId` when given) via
 * `guardedManualPush` against one shared context, and returns the summed { ok, count } or the
 * first error encountered. Always returns 200.
 */
export async function handlePushNow(req: Request): Promise<Response> {
  const prefs = await readPreferences()
  const conns = prefs.team?.connections ?? []

  if (conns.length === 0) {
    const result: PushNowResponse = { ok: false, error: 'Not in member mode' }
    return jsonResponse(result)
  }

  let connId: string | undefined
  try { connId = new URL(req.url).searchParams.get('connId') ?? undefined } catch { /* ignore */ }
  const targets = connId ? conns.filter(c => c.id === connId) : conns
  if (targets.length === 0) {
    return jsonResponse({ ok: false, error: 'unknown connection' } satisfies PushNowResponse)
  }

  const ctx = await getPushContext()
  let totalCount = 0
  let firstError: string | undefined
  // Sequential — this is an explicit, one-off user action (not the periodic cycle), so a plain
  // loop is simplest; `guardedManualPush` itself still applies the cap (and the running-guard)
  // per connection.
  for (const conn of targets) {
    const { count, error } = await guardedManualPush(conn, ctx)
    totalCount += count
    if (error && !firstError) firstError = error
  }

  const result: PushNowResponse = firstError
    ? { ok: false, count: totalCount, error: firstError }
    : { ok: true, count: totalCount }
  return jsonResponse(result)
}

// ---------------------------------------------------------------------------
// test-connection route handler
// ---------------------------------------------------------------------------

interface TestConnectionBody {
  endpoint: string
  token: string
}

interface TestConnectionResult {
  ok: boolean
  status: number
  error?: string
  user?: string
  org?: string
  machineName?: string
  email?: string
  teamId?: string
  team?: string
}

/**
 * Server-side handler for POST /api/team/test-connection.
 * Sends an empty ingest to the given endpoint and reports success/failure.
 * The bearer token never leaves the server process.
 */
export async function handleTeamTestConnection(req: Request): Promise<Response> {
  let body: TestConnectionBody
  try {
    body = await req.json() as TestConnectionBody
  } catch {
    const result: TestConnectionResult = { ok: false, status: 400, error: 'Invalid JSON body' }
    return jsonResponse(result)
  }

  const { endpoint, token } = body

  if (!endpoint) {
    const result: TestConnectionResult = { ok: false, status: 0, error: 'endpoint is required' }
    return jsonResponse(result)
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let result: TestConnectionResult
  try {
    // Ping the ingest endpoint with an empty sessions array to verify connectivity.
    // org must be non-empty to pass the central's parseIngestBody validation; the value is
    // irrelevant here (no sessions are stored on a ping), so send the default namespace.
    const res = await fetch(`${endpoint}/api/team/ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ org: 'default', user: '', sessions: [] }),
      signal: AbortSignal.timeout(10_000),
    })

    if (res.ok) {
      let responseOk = true
      try {
        const json = await res.json() as { ok?: boolean }
        responseOk = json.ok === true
      } catch {
        // If we can't parse JSON, treat a 2xx as ok
      }
      result = responseOk
        ? { ok: true, status: res.status }
        : { ok: false, status: res.status, error: `Unexpected response from central` }
    } else {
      let errorText = `HTTP ${res.status}`
      try {
        const json = await res.json() as { error?: string }
        if (json.error) errorText = json.error
      } catch { /* ignore */ }
      result = { ok: false, status: res.status, error: errorText }
    }
  } catch (err) {
    result = {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Network error',
    }
  }

  // On success, resolve the member's identity from the central via whoami.
  // The token stays server-side; plaintext is never logged.
  if (result.ok && token) {
    try {
      const whoamiRes = await fetch(`${endpoint}/api/team/whoami`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      })
      if (whoamiRes.ok) {
        const whoamiJson = await whoamiRes.json() as {
          ok?: boolean
          user?: string
          org?: string
          machineName?: string
          email?: string
          teamId?: string
          team?: string
        }
        if (whoamiJson.ok && typeof whoamiJson.user === 'string') {
          result = {
            ...result,
            user: whoamiJson.user,
            org: whoamiJson.org,
            ...(typeof whoamiJson.machineName === 'string' && { machineName: whoamiJson.machineName }),
            ...(typeof whoamiJson.email === 'string' && { email: whoamiJson.email }),
            ...(typeof whoamiJson.teamId === 'string' && { teamId: whoamiJson.teamId }),
            ...(typeof whoamiJson.team === 'string' && { team: whoamiJson.team }),
          }
        }
      }
    } catch { /* whoami is best-effort; a failed lookup does not fail the connection test */ }
  }

  return jsonResponse(result)
}

/**
 * Member-side proxy for POST /api/team/leave-central. Calls the central's
 * /api/team/leave with the given token so the central removes this member's data, then resets
 * the LOCAL sync state for the matching connection (looked up by endpoint/token, since the
 * request body — unchanged since the single-connection era — does not carry a connection id).
 * The web side resets the config to solo/removes the connection separately. Keeps the token
 * server-side; never throws.
 */
export async function handleLeaveCentral(req: Request): Promise<Response> {
  let body: { endpoint?: unknown; token?: unknown; org?: unknown; user?: unknown } = {}
  try { body = (await req.json()) as typeof body } catch { /* empty ok */ }
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.replace(/\/+$/, '') : ''
  const token = typeof body.token === 'string' ? body.token : ''
  const org = typeof body.org === 'string' && body.org ? body.org : 'default'
  const user = typeof body.user === 'string' ? body.user : ''

  if (!endpoint) {
    return jsonResponse({ ok: false, error: 'endpoint is required' })
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res = await fetch(`${endpoint}/api/team/leave`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ org, user }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => ({}))) as { deleted?: number; error?: string }
    // Leaving deletes this member's data on the central. Reset the matching connection's local
    // sync state so a future rejoin (even same token+central) re-pushes everything instead of
    // assuming the central still has it.
    try {
      const prefs = await readPreferences()
      const conn = (prefs.team?.connections ?? []).find(c =>
        c.endpoint.replace(/\/+$/, '') === endpoint || (token && c.token === token))
      if (conn) await resetSyncState(conn.id)
    } catch { /* best-effort — the connection may already be gone from preferences */ }
    return jsonResponse({ ok: res.ok, deleted: data.deleted, error: res.ok ? undefined : (data.error ?? `HTTP ${res.status}`) })
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Network error' })
  }
}
