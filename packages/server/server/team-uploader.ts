/**
 * team-uploader.ts — local → central push for Team Member mode.
 *
 * Pure functions (sessionHash, selectDeltas) are unit-tested.
 * IO functions (loadSentState, saveSentState, pushOnce, startUploader) are
 * integration-tested manually. handleTeamTestConnection exposes the
 * test-connection route handler.
 *
 * Secrets: the bearer token is NEVER logged.
 */

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { SessionMeta, StatsCache, WorkflowRun } from '@agentistics/core'
import { PUSH_INTERVAL, clampPushInterval, DEFAULT_TEAM } from '@agentistics/core'
import type { Preferences } from './preferences'
import { TEAM_SENT_FILE, TEAM_SYNC_FILE, STATS_CACHE_FILE } from './config'
import { loadConsolidated } from './consolidate'
import { loadWorkflowRuns } from './workflow-store'
import { readPreferences, writePreferences } from './preferences'
import { safeReadJson } from './utils'

/** This machine's local workflow runs (computed metrics only — no chat/prompt text) to push
 *  to the central. Mirrors readMemberStatsCache: best-effort, never throws. Full-set push
 *  (not delta) is acceptable — the central upserts idempotently by runId, so re-pushing the
 *  same set never double-counts. */
async function readMemberWorkflows(): Promise<WorkflowRun[]> {
  try {
    const map = await loadWorkflowRuns()
    return Array.from(map.values())
  } catch {
    return []
  }
}

/** This machine's statsCache to push to the central — the SUPPLEMENTED one the local
 *  dashboard actually shows (buildApiResponse gap-fills modelUsage/dailyActivity with recent
 *  sessions past the stale lastComputedDate), NOT the raw ~/.claude/stats-cache.json (which can
 *  lag weeks behind). buildApiResponse is memoized, so this reuses the warm /api/data build.
 *  Falls back to the raw file if the build fails. */
async function readMemberStatsCache(): Promise<StatsCache | undefined> {
  try {
    const { buildApiResponse } = await import('./data')
    const resp = await buildApiResponse()
    if (resp?.statsCache) return resp.statsCache
  } catch { /* fall through to the raw file */ }
  const sc = await safeReadJson<StatsCache>(STATS_CACHE_FILE)
  return sc ?? undefined
}

// Throttle repeated "can't reach central" warnings — a member offline (e.g. a Tailscale
// hostname that doesn't route from inside WSL) would otherwise spam the console every cycle.
let _netErrStreak = 0
// Live connection state for the member-side status pill (/api/team/status).
let _lastSuccessAt: number | null = null
function warnPushError(msg: string): void {
  _netErrStreak++
  if (_netErrStreak === 1 || _netErrStreak % 20 === 0) {
    console.warn(`[team-uploader] cannot reach central (${_netErrStreak}x, silencing repeats): ${msg}`)
  }
}
function clearPushError(): void {
  if (_netErrStreak > 0) console.info('[team-uploader] central reachable again — resuming pushes')
  _netErrStreak = 0
}
/** Record a successful contact with the central (used by the status pill + recovery). */
function markPushSuccess(): void {
  _lastSuccessAt = Date.now()
  _authErrStreak = 0 // any success clears the revoke countdown
}

export interface UploaderStatus {
  /** ms epoch of the last successful contact with the central, or null if never. */
  lastSuccessAt: number | null
  /** current error state: 'auth' (rejected), 'net' (unreachable), or null (ok). */
  errKind: 'auth' | 'net' | null
}
export function getUploaderStatus(): UploaderStatus {
  return { lastSuccessAt: _lastSuccessAt, errKind: _pushErrKind }
}

// Transition-based user notifications — emit once when entering an error state (auth vs
// network) and once on recovery, so a persistent failure never spams the toast/bell.
// The frontend localizes by `code`; `meta` carries interpolation values (e.g. status).
let _pushErrKind: 'auth' | 'net' | null = null
async function notifyPushError(kind: 'auth' | 'net', meta?: Record<string, unknown>): Promise<void> {
  if (_pushErrKind === kind) return
  _pushErrKind = kind
  try {
    const { broadcastNotification } = await import('./sse')
    broadcastNotification({
      type: kind === 'auth' ? 'error' : 'warning',
      code: kind === 'auth' ? 'member.auth_rejected' : 'member.unreachable',
      meta,
    })
  } catch { /* best-effort */ }
}
async function notifyPushRecovered(): Promise<void> {
  if (_pushErrKind === null) return
  _pushErrKind = null
  try {
    const { broadcastNotification } = await import('./sse')
    broadcastNotification({ type: 'success', code: 'member.reconnected' })
  } catch { /* best-effort */ }
}

// A 401/403 means the central revoked/removed this member's token. Count consecutive
// auth-error cycles; after this many the member auto-resets itself to solo (see
// handleAuthError). One transient 401 (e.g. a mid-rotation blip) is tolerated.
const AUTH_ERR_RESET_THRESHOLD = 2
let _authErrStreak = 0

/**
 * Handle a persistent-auth (401/403) push failure. Emits the first-error notification
 * (transition-guarded) and counts consecutive auth-error cycles. Once the count reaches
 * AUTH_ERR_RESET_THRESHOLD the token is treated as revoked and the member auto-resets to
 * solo. Reset the streak to 0 on any success (see markPushSuccess).
 */
async function handleAuthError(status: number): Promise<void> {
  await notifyPushError('auth', { status })
  _authErrStreak++
  if (_authErrStreak >= AUTH_ERR_RESET_THRESHOLD) {
    await autoResetOnRevoke()
  }
}

/**
 * The central revoked this member's token. Auto-reset so the member stops hammering a
 * dead endpoint and the person sees a clear, actionable notification:
 *   (i)   rewrite preferences.team back to solo (clearing endpoint/token/user),
 *   (ii)  reset the local sync state (a future rejoin re-pushes the full history),
 *   (iii) emit a 'member.removed' SSE notification.
 * Idempotent — once prefs are back on solo, subsequent calls no-op.
 */
async function autoResetOnRevoke(): Promise<void> {
  try {
    const prefs = await readPreferences()
    if (!prefs.team || prefs.team.mode !== 'member') return // already reset — don't spam
    await writePreferences({ team: { ...DEFAULT_TEAM } })
    await resetSyncState()
    _authErrStreak = 0
    _pushErrKind = null
    console.warn('[team-uploader] central revoked this token — reset team config to solo')
    try {
      const { broadcastNotification } = await import('./sse')
      broadcastNotification({ type: 'warning', code: 'member.removed' })
    } catch { /* best-effort */ }
  } catch (err) {
    console.warn('[team-uploader] auto-reset on revoke failed:', err instanceof Error ? err.message : String(err))
  }
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

  for (const s of sessions) {
    const id = s.session_id
    if (!id) continue
    const hash = sessionHash(s)
    if (sent[id] !== hash) {
      toSend.push(s)
      nextSent[id] = hash
    }
  }

  return { toSend, nextSent }
}

// ---------------------------------------------------------------------------
// IO — not unit-tested; manual/integration tested
// ---------------------------------------------------------------------------

/** Load sent-state from TEAM_SENT_FILE (= {} if missing or corrupt). */
export async function loadSentState(): Promise<SentState> {
  try {
    const file = Bun.file(TEAM_SENT_FILE)
    if (!(await file.exists())) return {}
    const text = await file.text()
    if (!text.trim()) return {}
    return JSON.parse(text) as SentState
  } catch {
    return {}
  }
}

/** Persist sent-state to TEAM_SENT_FILE. */
export async function saveSentState(state: SentState): Promise<void> {
  await Bun.write(TEAM_SENT_FILE, JSON.stringify(state, null, 2))
}

const BATCH_SIZE = 200

/**
 * One push cycle: load consolidated sessions, select deltas, POST them in
 * batches of 200 to `${team.endpoint}/api/team/ingest`, persist sent-state
 * on success.
 *
 * Returns the count pushed.
 * No-op (returns 0) when mode !== 'member' || !pushEnabled || !endpoint || !user.
 * Never throws — callers are fire-and-forget; logs a concise warning on failure.
 */
export interface PushOnceResult {
  count: number
  error?: string
}

/**
 * Core push implementation — returns count and optional error string.
 * No-op (count=0) when mode !== 'member' || !endpoint || !user.
 * Never throws.
 */
export async function pushOnceDetailed(team: NonNullable<Preferences['team']>): Promise<PushOnceResult> {
  if (team.mode !== 'member' || !team.endpoint || !team.user) {
    return { count: 0 }
  }

  try {
    const consolidatedMap = await loadConsolidated()
    const sessions = Array.from(consolidatedMap.values())
    const sent = await loadSentState()
    const { toSend, nextSent } = selectDeltas(sessions, sent)
    // The member's own statsCache (aggregated Claude history) is pushed so the central can
    // reproduce exact totals; it changes as activity accrues even when no new sessions exist.
    const statsCache = await readMemberStatsCache()
    // Local workflow runs (computed metrics only — no chat/prompt text, same privacy contract
    // as sessions). Pushed as a full set each cycle; the central upserts idempotently by
    // runId, so this never double-counts.
    const workflows = await readMemberWorkflows()

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (team.token) {
      headers['Authorization'] = `Bearer ${team.token}`
    }

    if (toSend.length === 0) {
      // No session deltas — still push the statsCache/workflows on their own so totals
      // and workflow runs stay fresh.
      if (statsCache || workflows.length > 0) {
        try {
          const res = await fetch(`${team.endpoint}/api/team/ingest`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ org: team.org, user: team.user, sessions: [], statsCache, workflows }),
          })
          // A reachable central (even a non-2xx that isn't auth) counts as contact for the pill.
          if (res.ok) { markPushSuccess(); clearPushError(); void notifyPushRecovered() }
          else if (res.status === 401 || res.status === 403) void handleAuthError(res.status)
        } catch (e) {
          warnPushError(e instanceof Error ? e.message : String(e))
          void notifyPushError('net')
        }
      }
      return { count: 0 }
    }

    let pushed = 0

    for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
      const batch = toSend.slice(i, i + BATCH_SIZE)
      let res: Response
      try {
        res = await fetch(`${team.endpoint}/api/team/ingest`, {
          method: 'POST',
          headers,
          // Attach the statsCache/workflows to the first batch only (idempotent upsert on the central).
          body: JSON.stringify({ org: team.org, user: team.user, sessions: batch, ...(i === 0 ? { statsCache, workflows } : {}) }),
        })
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
        warnPushError(msg)
        void notifyPushError('net')
        return { count: pushed, error: msg }
      }

      if (!res.ok) {
        const msg = `ingest returned ${res.status}`
        console.warn(`[team-uploader] ${msg}; stopping push`)
        // 401/403 = the central rejected the token → actionable auth notification (and,
        // after repeated failures, an automatic reset to solo).
        if (res.status === 401 || res.status === 403) void handleAuthError(res.status)
        return { count: pushed, error: msg }
      }

      // Batch succeeded — advance sent-state for this batch
      const batchSent: SentState = {}
      for (const s of batch) {
        if (s.session_id) batchSent[s.session_id] = nextSent[s.session_id]!
      }
      const current = await loadSentState()
      await saveSentState({ ...current, ...batchSent })
      pushed += batch.length
      markPushSuccess()
      clearPushError()
      void notifyPushRecovered()
    }

    return { count: pushed }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[team-uploader] unexpected error in pushOnceDetailed:', msg)
    return { count: 0, error: msg }
  }
}

/**
 * One push cycle — returns count pushed.
 * No-op (returns 0) when mode !== 'member' || !endpoint || !user.
 * Never throws — callers are fire-and-forget; logs a concise warning on failure.
 */
export async function pushOnce(team: NonNullable<Preferences['team']>): Promise<number> {
  const { count } = await pushOnceDetailed(team)
  return count
}

// ---------------------------------------------------------------------------
// Periodic uploader (idempotent start)
// ---------------------------------------------------------------------------

let started = false
let running = false

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
 * Auto-reconcile the sent-state with the central. The sent-state assumes the central still
 * holds everything we pushed — but a destructive action (member revoked + re-added, a new
 * central endpoint, or a wiped central DB) breaks that assumption silently. We fingerprint
 * the current target as endpoint+token+instanceId; when it differs from what the sent-state
 * was built against, we clear the sent-state so the next push re-sends the full history.
 *
 * Re-pushing is idempotent (the central upserts by session_id), so a reset never double-counts.
 * A null instanceId (old/unreachable central) is treated as empty — it never spuriously resets.
 */
async function reconcileSyncState(endpoint: string, token: string, instanceId: string | null): Promise<void> {
  // Only reconcile against a KNOWN central identity. A null instanceId means the central is
  // unreachable or predates this feature — reconciling then would falsely reset on every flap.
  if (!instanceId) return
  const sig = createHash('sha256').update(`${endpoint}\0${token}\0${instanceId}`).digest('hex')
  const prev = await safeReadJson<{ sig?: string }>(TEAM_SYNC_FILE)
  if (prev?.sig === sig) return // target unchanged — nothing to reconcile

  // Signature changed (or first run) → the central may not have our data. Clear the sent-state
  // so the next push re-sends everything, then record the new signature.
  await saveSentState({})
  _lastSuccessAt = null
  try {
    await writeFile(TEAM_SYNC_FILE, JSON.stringify({ sig }), 'utf-8')
  } catch { /* best-effort — worst case we reconcile again next cycle */ }
  if (prev?.sig) console.info('[team-uploader] central sync signature changed — re-pushing full history')
}

/** Fully reset the local sync state (sent-state + signature). Called when leaving a central,
 *  so a later rejoin re-pushes the full history rather than trusting a now-deleted dataset. */
async function resetSyncState(): Promise<void> {
  await saveSentState({})
  _lastSuccessAt = null
  try { await writeFile(TEAM_SYNC_FILE, '{}', 'utf-8') } catch { /* best-effort */ }
}

/**
 * Start the periodic uploader. Idempotent — calling more than once is a no-op.
 * Reads preferences each cycle so changes to mode/endpoint take effect
 * without a server restart.
 *
 * Each cycle:
 *   1. Reads prefs to get endpoint + member-side preference (team.pushIntervalSec).
 *   2. Fetches GET <endpoint>/api/team/policy to get the central interval.
 *   3. Effective interval = clampPushInterval(max(central, memberPref ?? 0)).
 *   4. Schedules the next cycle via recursive setTimeout so the interval can
 *      change between cycles. A `running` flag prevents overlapping cycles.
 *
 * First cycle runs ~5 s after start.
 */
// Push-on-change: coalesce a burst of local file changes into a single push, and never push
// more often than the central's interval floor — so data reaches the central promptly while
// you work, without hammering it. The periodic timer below remains as a fallback.
let _centralIntervalSec: number = PUSH_INTERVAL.DEFAULT_SEC
let _onChangeTimer: ReturnType<typeof setTimeout> | null = null
const ON_CHANGE_DEBOUNCE_MS = 2_000

/** One push cycle's core: read prefs → central policy → reconcile → push. Returns the next
 *  interval (seconds) and records the central floor for the on-change debounce. Shared by the
 *  periodic timer AND the on-change trigger so both go through identical logic. No-op push when
 *  not a member. */
async function pushCycleCore(): Promise<number> {
  let nextIntervalSec: number = PUSH_INTERVAL.DEFAULT_SEC
  const prefs = await readPreferences()
  const team = prefs.team
  // Trim any trailing slash so URL builds don't produce `//api/...` (which misses the
  // central's exact-match routes and silently hits the static handler instead of ingest).
  if (team?.endpoint) team.endpoint = team.endpoint.replace(/\/+$/, '')
  if (team?.mode === 'member' && team.endpoint && team.user) {
    // The central is the sole authority on the interval; members follow it (honoring express
    // intervals below the normal 15s floor). No member-side override.
    const policy = await fetchCentralPolicy(team.endpoint)
    nextIntervalSec = clampPushInterval(policy.intervalSec, PUSH_INTERVAL.EXPRESS_MIN_SEC)
    _centralIntervalSec = nextIntervalSec
    // Auto-heal a sent-state that no longer matches the central (revoke+re-add, new endpoint,
    // or a wiped DB) BEFORE pushing, so this cycle re-sends the full history.
    await reconcileSyncState(team.endpoint, team.token ?? '', policy.instanceId)
    await pushOnce(team)
  }
  return nextIntervalSec
}

/** Fire an extra push now (between timer ticks). The `running` guard prevents overlap with the
 *  timer cycle; it does NOT reschedule the timer (the timer manages its own cadence). */
async function triggerPush(): Promise<void> {
  if (running) return
  running = true
  try {
    await pushCycleCore()
  } catch (err) {
    console.warn('[team-uploader] on-change push error:', err instanceof Error ? err.message : String(err))
  } finally {
    running = false
  }
}

/**
 * Signal that local data changed (called by the file watcher). Schedules a DEBOUNCED push:
 * coalesces a burst of file events into one push and never pushes sooner than the central's
 * interval since the last successful push. No-op until the uploader has started; safe to call
 * on a central/solo instance (pushCycleCore just no-ops when not a member).
 */
export function notifyDataChanged(): void {
  if (!started || _onChangeTimer) return // not running, or a push is already scheduled → coalesce
  const floorMs = _centralIntervalSec * 1_000
  const sinceLast = _lastSuccessAt ? Date.now() - _lastSuccessAt : Infinity
  const delay = Math.max(ON_CHANGE_DEBOUNCE_MS, floorMs - sinceLast)
  _onChangeTimer = setTimeout(() => {
    _onChangeTimer = null
    void triggerPush()
  }, delay)
  _onChangeTimer.unref?.()
}

export function startUploader(): void {
  if (started) return
  started = true

  const schedule = (delaySec: number) => {
    setTimeout(() => { void cycle() }, delaySec * 1_000)
  }

  const cycle = async () => {
    if (running) {
      // Still busy — retry after default interval without running
      schedule(PUSH_INTERVAL.DEFAULT_SEC)
      return
    }
    running = true
    let nextIntervalSec: number = PUSH_INTERVAL.DEFAULT_SEC
    try {
      nextIntervalSec = await pushCycleCore()
    } catch (err) {
      console.warn('[team-uploader] cycle error:', err instanceof Error ? err.message : String(err))
    } finally {
      running = false
      schedule(nextIntervalSec)
    }
  }

  // First cycle ~800 ms after boot — short enough that a member that starts already
  // configured pushes (and shows up on the central) almost immediately, then the cadence
  // becomes dynamic from the central's policy.
  setTimeout(() => { void cycle() }, 800)
}

/**
 * Kick an immediate push cycle out of band (e.g. right after `member connect`), without
 * waiting for the next timer tick. Idempotent-safe: the `running` guard in triggerPush
 * prevents overlap with the periodic cycle. No-op when not a member.
 */
export async function pushNow(): Promise<void> {
  await triggerPush()
}


// ---------------------------------------------------------------------------
// push-now route handler
// ---------------------------------------------------------------------------

interface PushNowResponse {
  ok: boolean
  count?: number
  error?: string
}

/**
 * Server-side handler for POST /api/team/push-now.
 * Reads current preferences, checks mode === 'member', runs pushOnceDetailed,
 * and returns { ok, count } or { ok: false, error }. Always returns 200.
 */
export async function handlePushNow(_req: Request): Promise<Response> {
  const prefs = await readPreferences()
  const team = prefs.team

  if (!team || team.mode !== 'member') {
    const result: PushNowResponse = { ok: false, error: 'Not in member mode' }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { count, error } = await pushOnceDetailed(team)
  const result: PushNowResponse = error
    ? { ok: false, count, error }
    : { ok: true, count }
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
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
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { endpoint, token } = body

  if (!endpoint) {
    const result: TestConnectionResult = { ok: false, status: 0, error: 'endpoint is required' }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
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
        const whoamiJson = await whoamiRes.json() as { ok?: boolean; user?: string; org?: string }
        if (whoamiJson.ok && typeof whoamiJson.user === 'string') {
          result = { ...result, user: whoamiJson.user, org: whoamiJson.org }
        }
      }
    } catch { /* whoami is best-effort; a failed lookup does not fail the connection test */ }
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Member-side proxy for POST /api/team/leave-central. Calls the central's
 * /api/team/leave with the member's token so the central removes this member's data,
 * then the web resets the local config to solo. Keeps the token server-side; never throws.
 */
export async function handleLeaveCentral(req: Request): Promise<Response> {
  let body: { endpoint?: unknown; token?: unknown; org?: unknown; user?: unknown } = {}
  try { body = (await req.json()) as typeof body } catch { /* empty ok */ }
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.replace(/\/+$/, '') : ''
  const token = typeof body.token === 'string' ? body.token : ''
  const org = typeof body.org === 'string' && body.org ? body.org : 'default'
  const user = typeof body.user === 'string' ? body.user : ''

  if (!endpoint) {
    return new Response(JSON.stringify({ ok: false, error: 'endpoint is required' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res = await fetch(`${endpoint}/api/team/leave`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ org, user }),
    })
    const data = (await res.json().catch(() => ({}))) as { deleted?: number; error?: string }
    // Leaving deletes this member's data on the central. Reset the local sync state so a
    // future rejoin (even same token+central) re-pushes everything instead of assuming
    // the central still has it.
    await resetSyncState()
    return new Response(JSON.stringify({ ok: res.ok, deleted: data.deleted, error: res.ok ? undefined : (data.error ?? `HTTP ${res.status}`) }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Network error' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
}
