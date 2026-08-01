/**
 * team-elsewhere.ts — MEMBER side. Asks each central "what repositories do you hold for my
 * account", intersects the answer against this machine's own rules locally, and caches the result
 * for `GET /api/team/status` to surface on the connection card.
 *
 * The impure shell only: the question, the response parsing and the intersection all live in the
 * pure `account-repos.ts`, which also documents why this discloses nothing.
 *
 * A central on an older build answers 404 — that reads as "no warning available" (an empty list),
 * never as an error, because a feature the other end has not shipped is not a problem the user can
 * do anything about.
 */
import { createHash } from 'node:crypto'
import type { TeamConnection } from '@agentistics/core'
import { findStillShared, parseAccountRepos, type ElsewhereRepo } from './account-repos'
import { shareRulesOf } from './share-rules'

/** How long a fetched answer stays fresh. The status route is polled every ~5s; a repository set
 *  changes at human speed, and asking a central every poll would be a self-inflicted DoS. */
export const ELSEWHERE_TTL_MS = 5 * 60_000

const REQUEST_TIMEOUT_MS = 5_000

/**
 * The central's machine id for a token is `sha256(token)` — the same rule `hashToken`
 * (`team-tokens.ts`) applies when it mints that id. Recomputed here rather than imported so the
 * member path never pulls the Mongo driver into its module graph; `team-elsewhere.test.ts`
 * cross-checks the two implementations so they cannot drift apart.
 *
 * This is what lets a machine exclude ITSELF from the warning without ever asking the central who
 * it is: it already holds the only input the answer needs.
 */
export function selfMachineId(token: string): string {
  return token ? createHash('sha256').update(token).digest('hex') : ''
}

interface CacheEntry {
  at: number
  repos: ElsewhereRepo[]
}

const _cache = new Map<string, CacheEntry>()
const _inflight = new Set<string>()

/** The cached warning for a connection, or `[]` when nothing has been computed yet. */
export function getElsewhere(connId: string): ElsewhereRepo[] {
  return _cache.get(connId)?.repos ?? []
}

/** Test-only: drop all cached state. */
export function __resetElsewhereForTests(): void {
  _cache.clear()
  _inflight.clear()
}

/** Test-only: seed the cache without a network call. */
export function __seedElsewhereForTests(connId: string, repos: ElsewhereRepo[], at = Date.now()): void {
  _cache.set(connId, { at, repos })
}

/** Only the shape this module actually calls — a narrow injection point, so a test double is a
 *  two-line function rather than a full `typeof fetch` implementation. */
export type ElsewhereFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>

export interface ElsewhereDeps {
  fetch?: ElsewhereFetch
  now?: () => number
}

/**
 * Ask one connection's central and recompute the warning. Returns the list it stored. Never
 * throws: a central that is down, old, or answering junk yields an empty list, which the card
 * renders as "no warning" — the same as a clean intersection.
 */
export async function refreshElsewhere(conn: TeamConnection, deps: ElsewhereDeps = {}): Promise<ElsewhereRepo[]> {
  const _fetch = deps.fetch ?? fetch
  const _now = deps.now ?? Date.now
  if (_inflight.has(conn.id)) return getElsewhere(conn.id)
  _inflight.add(conn.id)
  try {
    const headers: Record<string, string> = {}
    if (conn.token) headers['Authorization'] = `Bearer ${conn.token}`
    const res = await _fetch(`${conn.endpoint}/api/team/account-repos`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      _cache.set(conn.id, { at: _now(), repos: [] })
      return []
    }
    const entries = parseAccountRepos(await res.json())
    const repos = findStillShared(entries, shareRulesOf(conn.shareMode, conn.sources), selfMachineId(conn.token))
    _cache.set(conn.id, { at: _now(), repos })
    return repos
  } catch {
    // A network failure must not clear a previously computed warning — the sibling machine is
    // still sending the repo whether or not this machine can reach the central right now.
    return getElsewhere(conn.id)
  } finally {
    _inflight.delete(conn.id)
  }
}

/**
 * Refresh in the background if the cached answer is older than the TTL. Called from the status
 * route (cheap, rate-limited by the TTL) and unconditionally — via `checkElsewhereNow` — right
 * after a rules change, which is the moment the answer actually matters.
 */
export function scheduleElsewhereCheck(conn: TeamConnection, deps: ElsewhereDeps = {}): void {
  const _now = deps.now ?? Date.now
  const cached = _cache.get(conn.id)
  if (cached && _now() - cached.at < ELSEWHERE_TTL_MS) return
  void refreshElsewhere(conn, deps).catch(() => { /* best-effort */ })
}

/** Force a refresh for one connection id, resolving it from preferences. Fire-and-forget. */
export function checkElsewhereNow(connId: string): void {
  void (async () => {
    const { readPreferences } = await import('./preferences')
    const prefs = await readPreferences().catch(() => null)
    const conn = prefs?.team?.connections?.find(c => c.id === connId)
    if (!conn) return
    await refreshElsewhere(conn)
  })().catch(() => { /* best-effort */ })
}
