/**
 * pinnedSessions.ts — the up-to-three sessions a person keeps in sight.
 *
 * With a busy fleet the two or three sessions that matter right now scatter every time the grouping
 * changes. Pinning says "these I always want to hand": they sit in their own block at the top,
 * OUTSIDE the grouping, and survive a reload. The store is the persisted, shared source of truth
 * (localStorage + an external store), the same shape as `terminalZoom.ts`.
 *
 * The rules are deliberate and pinned by the pure `planPinToggle`:
 *  - a HARD limit (MAX_PINNED), and the one past it is REFUSED, never a silent swap — a swap
 *    surprises, a refusal is predictable;
 *  - pinning/unpinning is the ONLY thing that changes the set — a filter, a grouping or a search
 *    never touches it, and a pinned session that dies stays pinned (shown as ended) until the person
 *    unpins it, so a slot is never taken away behind their back.
 */

const KEY = 'agentistics-pinned-sessions'
export const MAX_PINNED = 10

export interface PinToggleResult {
  next: string[]
  ok: boolean
  /** Why a pin was refused. `limit` = already at MAX_PINNED. */
  reason?: 'limit'
}

/** PURE: the whole rule of toggling a pin. Unpin always succeeds; pinning a new id succeeds only
 *  below the limit, and the fourth is refused with the set left unchanged. */
export function planPinToggle(current: readonly string[], id: string, max = MAX_PINNED): PinToggleResult {
  if (current.includes(id)) return { next: current.filter(x => x !== id), ok: true }
  if (current.length >= max) return { next: [...current], ok: false, reason: 'limit' }
  return { next: [...current, id], ok: true }
}

function readInitial(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_PINNED)
  } catch {
    return []
  }
}

let current: string[] = readInitial()
const subscribers = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* storage may be unavailable; the in-memory set still drives this session */
  }
  for (const fn of subscribers) fn()
}

export function getPinnedIds(): string[] {
  return current
}

export function isSessionPinned(id: string): boolean {
  return current.includes(id)
}

/** Toggle a pin, returning whether it happened (a refused fourth returns ok:false, reason:'limit'). */
export function togglePinnedSession(id: string): PinToggleResult {
  const result = planPinToggle(current, id)
  if (result.ok && (result.next.length !== current.length || !result.next.every((x, i) => x === current[i]))) {
    current = result.next
    persist()
  }
  return result
}

export function subscribePinnedSessions(fn: () => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

const EMPTY: string[] = []
/** Stable empty array for `useSyncExternalStore`'s server snapshot (a new [] each call loops). */
export function pinnedServerSnapshot(): string[] {
  return EMPTY
}
