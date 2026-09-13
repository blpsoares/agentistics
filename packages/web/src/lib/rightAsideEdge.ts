/**
 * rightAsideEdge.ts — the artifacts aside's live LEFT EDGE, in viewport pixels, shared between
 * `SessionsPage` (which measures it) and `App.tsx` (which reads it so the Filtros panel never
 * crosses it) — see `filtrosPanelBounds` in `sessionsFiltersPanel.ts` for the arithmetic this feeds.
 *
 * The same bridge `artifactsStore.ts` already is for the panel's open flag and count, kept
 * SEPARATE from it on purpose: that store's `emit` is gated on reference-equal state so an
 * unrelated field never re-renders a consumer that only reads `open`, and this one updates on every
 * drag pixel — folding a continuously-moving number into that store would make every geometry
 * update also re-check (and, incorrectly, possibly skip) the open/count/dismissed fields it has
 * nothing to do with.
 *
 * `null` means "no aside on screen right now" — closed, or a route with no `SessionsPage` mounted
 * at all — and the caller falls back to the viewport's own right edge, exactly as
 * `resolveArtifactLayout` already treats a closed panel as "the aside is not there."
 */

import { useSyncExternalStore } from 'react'

let edge: number | null = null
const listeners = new Set<() => void>()

/** The current value. For a one-time read; most callers should subscribe via the hook below. */
export function getRightAsideEdge(): number | null {
  return edge
}

export function setRightAsideEdge(next: number | null): void {
  if (next === edge) return
  edge = next
  for (const l of listeners) l()
}

export function useRightAsideEdge(): number | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => edge,
    () => null,
  )
}

/** For tests: forget everything. */
export function resetRightAsideEdge(): void {
  edge = null
  for (const l of listeners) l()
}
