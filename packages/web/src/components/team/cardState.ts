import type { ArchiveMode } from '../ArchiveConsentModal'
import type { ConnectionStatusEntry } from './statusTypes'

/**
 * cardState.ts — the pure decisions behind `ConnectionCard.tsx`'s state table (design doc §9.5).
 *
 * Split out of the component (Task 10 follow-up) alongside `statusTypes.ts` and next to
 * `lib/shareRepos.ts` — the same shape of module (pure, no React, unit-tested directly) doing the
 * substantive work behind a UI surface. Kept here rather than inline so Tasks 11–13, which all add
 * to `ConnectionCard`, don't have to grow this logic back out of the component again.
 */

/** Whether this endpoint can be parsed as a URL at all — never throws (same guarantee `hostOf`
 *  makes internally). A connection whose stored endpoint fails this renders the `brokenConn` card
 *  (Disconnect only) instead of trying to derive a host, a status line, or anything else from it. */
export function isBrokenEndpoint(endpoint: string): boolean {
  try {
    new URL(endpoint)
    return false
  } catch {
    return true
  }
}

/** The per-card state table (design doc §9.5) — exported so it can be unit-tested as a pure
 *  function instead of only through rendered DOM assertions. Order encodes priority: a hard
 *  connectivity failure (auth/net) always wins over a softer signal, an active resync is worth
 *  surfacing over a stale "not yet identified", and only once none of those apply does "connected
 *  vs still connecting" get decided from `lastSuccessAt`. */
export type CardState = 'checking' | 'connecting' | 'noIdentity' | 'connected' | 'offline' | 'unauthorized' | 'resyncing'

export function resolveCardState(status: ConnectionStatusEntry | undefined): CardState {
  if (!status) return 'checking'
  if (status.errKind === 'auth') return 'unauthorized'
  if (status.errKind === 'net') return 'offline'
  if (status.resync != null) return 'resyncing'
  if (status.user === '') return 'noIdentity'
  if (status.lastSuccessAt != null) return 'connected'
  return 'connecting'
}

export const DOT: Record<CardState, 'ok' | 'warn' | 'error' | 'unknown'> = {
  checking: 'unknown', connecting: 'unknown', noIdentity: 'unknown',
  connected: 'ok', offline: 'warn', unauthorized: 'error', resyncing: 'warn',
}

/** What occupies the repo-panel slot for a given card state. Pure and exported so the two rules
 *  that matter most — unauthorized HIDES it, offline keeps it EDITABLE (rules are local) — are
 *  asserted directly rather than only through rendered DOM. */
export type RepoPanelMode = 'hidden' | 'centralTooOld' | 'archiveOff' | 'editable'

export function resolveRepoPanelMode(
  state: CardState,
  centralTooOld: boolean,
  archiveMode: ArchiveMode | null,
): RepoPanelMode {
  if (state === 'unauthorized') return 'hidden'
  if (centralTooOld) return 'centralTooOld'
  if (archiveMode === 'off') return 'archiveOff'
  return 'editable'
}

/** The apply-queued banner ("rules saved, not yet enforced") is never rendered while a resync is
 *  actively running — that state has its own progress strip and would otherwise show two
 *  contradictory messages ("queued" and "in progress") at once. */
export function showsApplyQueuedBanner(state: CardState, pendingRules: boolean | undefined): boolean {
  return Boolean(pendingRules) && state !== 'resyncing'
}

export function relTime(iso: string | number, pt: boolean): string {
  const ts = typeof iso === 'number' ? iso : Date.parse(iso)
  const s = Math.floor((Date.now() - ts) / 1000)
  if (!Number.isFinite(s) || s < 5) return pt ? 'agora' : 'now'
  if (s < 60) return pt ? `há ${s}s` : `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return pt ? `há ${m}min` : `${m}min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return pt ? `há ${h}h` : `${h}h ago`
  return pt ? `há ${Math.floor(h / 24)}d` : `${Math.floor(h / 24)}d ago`
}
