/**
 * leftAsideEdge.ts — the LEFT sessions list's own live width, in pixels, bridged the same way
 * `rightAsideEdge.ts` bridges the artifacts aside's edge — `App.tsx` (which owns the state:
 * `sidebarCollapsed` / `liveAsideWidth`) is the one publisher, and every full-screen surface deep
 * inside `SessionsPage.tsx` (`StudioBand`, `SimpleDockedBand`, `ShellBand`'s docked branch) reads
 * this SAME bridge rather than three independent guesses that could disagree.
 *
 * WHY THIS EXISTS (owner, 2026-09-21): "a esquerda da listagem de sessoes deveria continuar
 * visivel, porem, automaticamente eh minimizada" — a panel's full screen used to cover the WHOLE
 * viewport left of the artifacts aside (`left: 0`), which reached straight through the left
 * sessions list. The fix mirrors `fullscreenInsetRight` exactly, on the other side: full screen now
 * runs from the left list's own right edge to the rail's own left edge, and NEVER collapses the
 * list on the reader's behalf — if they want the width back, collapsing the list themselves
 * (`sidebarCollapsed`) is the same lever `fullscreenInsetRight` already defers to for the artifacts
 * aside on the right.
 *
 * `0` (never `null`) is the "nothing to reserve" value — unlike the right edge, there is no state
 * where the left list is absent from a desktop `SessionsPage`: `isMobile` is a separate question
 * every caller of `fullscreenInsetLeft` already asks (mobile has no full-screen inset arithmetic at
 * all, since mobile panels cover the viewport by design), and a value of `0` published before
 * `App.tsx`'s own first layout effect runs is the honest "not measured yet" answer a `left: 0` full
 * screen would have drawn anyway.
 */

import { useSyncExternalStore } from 'react'

let edge = 0
const listeners = new Set<() => void>()

export function getLeftAsideEdge(): number {
  return edge
}

export function setLeftAsideEdge(next: number): void {
  if (next === edge) return
  edge = next
  for (const l of listeners) l()
}

export function useLeftAsideEdge(): number {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => edge,
    () => 0,
  )
}

/** For tests: forget everything. */
export function resetLeftAsideEdge(): void {
  edge = 0
  for (const l of listeners) l()
}
