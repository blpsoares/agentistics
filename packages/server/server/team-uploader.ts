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

import type { SessionMeta, StatsCache } from '@agentistics/core'
import { PUSH_INTERVAL, clampPushInterval } from '@agentistics/core'
import type { Preferences } from './preferences'
import { TEAM_SENT_FILE, STATS_CACHE_FILE } from './config'
import { loadConsolidated } from './consolidate'
import { readPreferences } from './preferences'
import { safeReadJson } from './utils'

/** Read this machine's raw Claude statsCache (aggregated history) to push to the central.
 *  Returns undefined when absent/unreadable — the push proceeds without it. */
async function readMemberStatsCache(): Promise<StatsCache | undefined> {
  const sc = await safeReadJson<StatsCache>(STATS_CACHE_FILE)
  return sc ?? undefined
}

// Throttle repeated "can't reach central" warnings — a member offline (e.g. a Tailscale
// hostname that doesn't route from inside WSL) would otherwise spam the console every cycle.
let _netErrStreak = 0
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

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (team.token) {
      headers['Authorization'] = `Bearer ${team.token}`
    }

    if (toSend.length === 0) {
      // No session deltas — still push the statsCache on its own so totals stay fresh.
      if (statsCache) {
        try {
          await fetch(`${team.endpoint}/api/team/ingest`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ org: team.org, user: team.user, sessions: [], statsCache }),
          })
        } catch { /* best-effort */ }
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
          // Attach the statsCache to the first batch only (idempotent upsert on the central).
          body: JSON.stringify({ org: team.org, user: team.user, sessions: batch, ...(i === 0 ? { statsCache } : {}) }),
        })
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
        warnPushError(msg)
        return { count: pushed, error: msg }
      }

      if (!res.ok) {
        const msg = `ingest returned ${res.status}`
        console.warn(`[team-uploader] ${msg}; stopping push`)
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
      clearPushError()
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
 * Fetch the push interval (seconds) from the central policy endpoint.
 * Falls back to PUSH_INTERVAL.DEFAULT_SEC on any network or parse error.
 */
async function fetchCentralInterval(endpoint: string): Promise<number> {
  try {
    const res = await fetch(`${endpoint}/api/team/policy`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return PUSH_INTERVAL.DEFAULT_SEC
    const json = await res.json() as { pushIntervalSec?: unknown }
    const sec = json.pushIntervalSec
    if (typeof sec !== 'number') return PUSH_INTERVAL.DEFAULT_SEC
    // Honor express intervals (the central may dictate below the normal 15s floor).
    return clampPushInterval(sec, PUSH_INTERVAL.EXPRESS_MIN_SEC)
  } catch {
    return PUSH_INTERVAL.DEFAULT_SEC
  }
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
      const prefs = await readPreferences()
      const team = prefs.team
      if (team?.mode === 'member' && team.endpoint && team.user) {
        // The central is the sole authority on the interval; members follow it (honoring
        // express intervals below the normal 15s floor). No member-side override.
        const centralSec = await fetchCentralInterval(team.endpoint)
        nextIntervalSec = clampPushInterval(centralSec, PUSH_INTERVAL.EXPRESS_MIN_SEC)
        await pushOnce(team)
      }
    } catch (err) {
      console.warn('[team-uploader] cycle error:', err instanceof Error ? err.message : String(err))
    } finally {
      running = false
      schedule(nextIntervalSec)
    }
  }

  // First cycle ~5 s after boot (fixed short delay, then dynamic from there)
  setTimeout(() => { void cycle() }, 5_000)
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
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
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
    return new Response(JSON.stringify({ ok: res.ok, deleted: data.deleted, error: res.ok ? undefined : (data.error ?? `HTTP ${res.status}`) }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Network error' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
}
