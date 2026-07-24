import type { SessionMeta, HarnessId } from './types'

// ---------------------------------------------------------------------------
// TeamConfig — shared member configuration (single source of truth)
// ---------------------------------------------------------------------------

export interface TeamConfig {
  /** 'solo' = normal local-only behavior; 'member' = push metrics to a central */
  mode: 'solo' | 'member'
  /** Central base URL, e.g. "https://central.example:47291" (no trailing slash) */
  endpoint: string
  /** Org namespace used on the central server */
  org: string
  /** This developer's identity (name or email) */
  user: string
  /** Bearer token for the central ingest endpoint (never logged) */
  token: string
  /**
   * Member-side push interval preference in seconds. The effective interval
   * is max(centralPushIntervalSec, pushIntervalSec ?? 0), then clamped.
   * Absent or 0 means "use whatever central dictates".
   */
  pushIntervalSec?: number
}

export const DEFAULT_TEAM: TeamConfig = {
  mode: 'solo',
  endpoint: '',
  org: 'default',
  user: '',
  token: '',
}

// ---------------------------------------------------------------------------
// Push interval — central-controlled cadence (Phase 6)
// ---------------------------------------------------------------------------

/** Bounds and default for the push interval, in seconds. */
export const PUSH_INTERVAL = {
  MIN_SEC: 15,
  MAX_SEC: 3600,
  DEFAULT_SEC: 30,
  // Express mode floor — the central may dictate intervals shorter than MIN_SEC
  // (down to this value) when the admin enables express mode.
  EXPRESS_MIN_SEC: 5,
} as const

/**
 * Clamp a push-interval value (seconds) to [minSec, MAX_SEC].
 * Non-finite, NaN, or <= 0 values fall back to DEFAULT_SEC.
 * In-range values are rounded to the nearest second. `minSec` defaults to the
 * normal MIN_SEC; pass EXPRESS_MIN_SEC to allow the central's express intervals.
 */
export function clampPushInterval(sec: number, minSec: number = PUSH_INTERVAL.MIN_SEC): number {
  if (!Number.isFinite(sec) || sec <= 0) return PUSH_INTERVAL.DEFAULT_SEC
  const rounded = Math.round(sec)
  if (rounded < minSec) return minSec
  if (rounded > PUSH_INTERVAL.MAX_SEC) return PUSH_INTERVAL.MAX_SEC
  return rounded
}

/** Tag a session with its owning user (team mode). Pure — returns a new object. */
export function tagUser(session: SessionMeta, user: string): SessionMeta {
  return { ...session, user }
}

/** Distinct, sorted list of users present in a session list. Skips undefined. Pure. */
export function distinctUsers(sessions: SessionMeta[]): string[] {
  const set = new Set<string>()
  for (const s of sessions) if (s.user) set.add(s.user)
  return Array.from(set).sort()
}

/** Distinct, sorted list of harnesses present in a session list (missing harness = 'claude').
 *  Sorted by the canonical order claude→codex→gemini→copilot. Pure. */
export function distinctHarnesses(sessions: { harness?: HarnessId }[]): HarnessId[] {
  const order: HarnessId[] = ['claude', 'codex', 'gemini', 'copilot']
  const set = new Set<HarnessId>()
  for (const s of sessions) set.add(s.harness ?? 'claude')
  return order.filter(h => set.has(h))
}

/** Multi-select user predicate. Empty/undefined selection = all sessions pass.
 *  Sessions with no `user` are excluded when a selection is active. Pure. */
export function filterByUsers<T extends { user?: string }>(sessions: T[], users: string[]): T[] {
  if (!users || users.length === 0) return sessions
  const set = new Set(users)
  return sessions.filter(s => !!s.user && set.has(s.user))
}

/** Multi-select harness predicate. Empty/undefined selection = all sessions pass.
 *  Sessions with no `harness` field are treated as 'claude'. Pure. */
export function filterByHarnesses<T extends { harness?: HarnessId }>(sessions: T[], harnesses: HarnessId[]): T[] {
  if (!harnesses || harnesses.length === 0) return sessions
  const set = new Set(harnesses)
  return sessions.filter(s => set.has(s.harness ?? 'claude'))
}

/** Multi-select team predicate (central). Empty/undefined = all pass. A session passes if ANY of its
 *  teams is selected (a machine can be in several teams); falls back to the single `teamId` on legacy
 *  data. Sessions with no team are excluded when a selection is active. Pure. */
export function filterByTeams<T extends { teamId?: string; teamIds?: string[] }>(sessions: T[], teams: string[]): T[] {
  if (!teams || teams.length === 0) return sessions
  const set = new Set(teams)
  return sessions.filter(s => {
    const ids = (s.teamIds && s.teamIds.length) ? s.teamIds : (s.teamId ? [s.teamId] : [])
    return ids.some(t => set.has(t))
  })
}

/** Multi-select machine predicate (central). Empty/undefined = all pass. Matches `session.memberId`
 *  (the machine's token hash); sessions with no memberId are excluded when active. Pure. */
export function filterByMachines<T extends { memberId?: string }>(sessions: T[], machines: string[]): T[] {
  if (!machines || machines.length === 0) return sessions
  const set = new Set(machines)
  return sessions.filter(s => !!s.memberId && set.has(s.memberId))
}


// ── Machine connect token (optionally carries the central endpoint) ──────────────
// The bearer sent to the central is ALWAYS the raw secret. When the central has a public URL
// configured, the token shown to the user is a composite that also carries the endpoint, so
// pasting it on a machine auto-fills the URL. Backward compatible: a raw secret parses fine.

/** Pack a connect token, embedding the endpoint when provided. */
export function packConnectToken(secret: string, endpoint?: string): string {
  const url = (endpoint ?? '').trim().replace(/\/+$/, '')
  if (!url) return secret
  // btoa exists in Bun + browsers; make it URL-safe (no +,/,=).
  const enc = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `act1_${enc}.${secret}`
}

/** Parse a connect token → { endpoint?, secret }. A raw secret (no embedded URL) returns
 *  just { secret }. The secret is what must be sent to the central as the bearer. */
export function unpackConnectToken(token: string): { endpoint?: string; secret: string } {
  const t = (token ?? '').trim()
  if (t.startsWith('act1_') && t.includes('.')) {
    const rest = t.slice('act1_'.length)
    const dot = rest.indexOf('.')
    const enc = rest.slice(0, dot)
    const secret = rest.slice(dot + 1)
    try {
      const endpoint = atob(enc.replace(/-/g, '+').replace(/_/g, '/'))
      if (endpoint && secret) return { endpoint, secret }
    } catch { /* fall through to raw */ }
  }
  return { secret: t }
}
