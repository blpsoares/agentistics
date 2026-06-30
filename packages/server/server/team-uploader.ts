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

import type { SessionMeta } from '@agentistics/core'
import { PUSH_INTERVAL, clampPushInterval } from '@agentistics/core'
import type { Preferences } from './preferences'
import { TEAM_SENT_FILE } from './config'
import { loadConsolidated } from './consolidate'
import { readPreferences } from './preferences'

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
export async function pushOnce(team: NonNullable<Preferences['team']>): Promise<number> {
  if (team.mode !== 'member' || !team.pushEnabled || !team.endpoint || !team.user) {
    return 0
  }

  try {
    const consolidatedMap = await loadConsolidated()
    const sessions = Array.from(consolidatedMap.values())
    const sent = await loadSentState()
    const { toSend, nextSent } = selectDeltas(sessions, sent)

    if (toSend.length === 0) return 0

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (team.token) {
      headers['Authorization'] = `Bearer ${team.token}`
    }

    let pushed = 0

    for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
      const batch = toSend.slice(i, i + BATCH_SIZE)
      let res: Response
      try {
        res = await fetch(`${team.endpoint}/api/team/ingest`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ org: team.org, user: team.user, sessions: batch }),
        })
      } catch (fetchErr) {
        console.warn('[team-uploader] network error pushing batch:', fetchErr instanceof Error ? fetchErr.message : String(fetchErr))
        // Stop; do not advance sent-state for this or subsequent batches
        break
      }

      if (!res.ok) {
        console.warn(`[team-uploader] ingest returned ${res.status}; stopping push`)
        break
      }

      // Batch succeeded — advance sent-state for this batch
      const batchSent: SentState = {}
      for (const s of batch) {
        if (s.session_id) batchSent[s.session_id] = nextSent[s.session_id]!
      }
      const current = await loadSentState()
      await saveSentState({ ...current, ...batchSent })
      pushed += batch.length
    }

    return pushed
  } catch (err) {
    console.warn('[team-uploader] unexpected error in pushOnce:', err instanceof Error ? err.message : String(err))
    return 0
  }
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
    return clampPushInterval(sec)
  } catch {
    return PUSH_INTERVAL.DEFAULT_SEC
  }
}

/**
 * Start the periodic uploader. Idempotent — calling more than once is a no-op.
 * Reads preferences each cycle so toggling pushEnabled / mode takes effect
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
      if (team?.mode === 'member' && team.pushEnabled && team.endpoint) {
        // Determine effective interval: max(central, member preference)
        const centralSec = await fetchCentralInterval(team.endpoint)
        const memberPref = typeof team.pushIntervalSec === 'number' ? team.pushIntervalSec : 0
        nextIntervalSec = clampPushInterval(Math.max(centralSec, memberPref))
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
// test-connection route handler
// ---------------------------------------------------------------------------

interface TestConnectionBody {
  endpoint: string
  org: string
  user: string
  token: string
}

interface TestConnectionResult {
  ok: boolean
  status: number
  error?: string
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

  const { endpoint, org, user, token } = body

  if (!endpoint) {
    const result: TestConnectionResult = { ok: false, status: 0, error: 'endpoint is required' }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!org || !user) {
    const result: TestConnectionResult = { ok: false, status: 0, error: 'org and user are required' }
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
    const res = await fetch(`${endpoint}/api/team/ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ org, user, sessions: [] }),
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

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
