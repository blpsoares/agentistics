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

/**
 * THE RESTING LEFT EDGE — the "which box to read" decision `SessionsPage.tsx`'s measuring effect
 * defers to. A plain `getBoundingClientRect().left` answers "where is this box on screen right
 * now", which is the wrong question for an aside that opens by sliding in on `transform` alone
 * (overlay layout, below `SPLIT_MIN_WIDTH`): `transform` never touches the LAYOUT box
 * `ResizeObserver` watches, so a rect read while the aside still sits translated off-screen
 * (`translateX(100%)`, its mount-time value before the open animation has even started) sticks
 * there for the life of the component — `ResizeObserver` has nothing to fire on, because the box's
 * content/border dimensions never change, only its paint-time position. `filtrosPanelBounds` then
 * reads that stale off-screen edge as "plenty of room" and the Filtros panel overlaps the aside's
 * own tabs (review's Critical finding, re-review 2).
 *
 * `restingLeftEdge` discounts the box's own X translation, so the answer is the position the box
 * will SETTLE at — correct at the very first frame (still off-screen), correct mid-slide, and
 * correct once the animation is done, because `visualLeft` and the translation move together by
 * construction (both come from the same transform) and their difference is the untransformed
 * layout position throughout.
 */
export function transformTranslateX(computedTransform: string): number {
  const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(computedTransform)
  if (matrix3d?.[1] !== undefined) {
    const parts = matrix3d[1].split(',').map(s => Number(s.trim()))
    const tx = parts.length === 16 ? parts[12] : undefined
    return typeof tx === 'number' && Number.isFinite(tx) ? tx : 0
  }
  const matrix = /^matrix\(([^)]+)\)$/.exec(computedTransform)
  if (matrix?.[1] !== undefined) {
    const parts = matrix[1].split(',').map(s => Number(s.trim()))
    const tx = parts.length === 6 ? parts[4] : undefined
    return typeof tx === 'number' && Number.isFinite(tx) ? tx : 0
  }
  // 'none', or a shape this codebase never produces for this box (skew/rotate) — no translation to
  // discount, so the visual and resting positions already agree.
  return 0
}

/**
 * `visualLeft` is a live `getBoundingClientRect().left`; `computedTransform` is the SAME element's
 * `getComputedStyle(...).transform` read at the same moment — the browser resolves any
 * `translateX(...)` (percentage included) into this matrix form, mid-transition or not, so the two
 * inputs never disagree about which instant they describe.
 */
export function restingLeftEdge(visualLeft: number, computedTransform: string): number {
  return visualLeft - transformTranslateX(computedTransform)
}

/**
 * A FULL-SCREEN OVERLAY'S OWN RIGHT INSET — every "cover the whole viewport in place" surface
 * (`PANEL_FULLSCREEN_Z` in `SessionPanel.tsx`'s `StudioBand`/`SimpleDockedBand`, docked at the
 * BOTTOM band) used to hard-code `inset: 0`, which reaches all the way to the viewport's own right
 * edge regardless of what the artifacts aside — a SIBLING box, controlled by `SessionsPage.tsx`,
 * never a descendant of the bottom band — happens to be showing at that moment. Reported: "o studio
 * por exemplo em fullscreen SOME com o aside da direita" — the Studio full-screened from the bottom
 * band while Contents sat open on the right, and the fixed overlay painted straight over it.
 *
 * `rightAsideEdge` is the aside's own LIVE left edge (`useRightAsideEdge()`, reported by
 * `SessionsPage.tsx`'s own `ResizeObserver` through this same module) — `null` meaning there is no
 * aside on screen to protect (closed, minimized, or a route with no `SessionsPage` mounted), in
 * which case the overlay covers the whole viewport exactly as `inset: 0` always did. Reading the
 * edge through the REACTIVE hook rather than a one-time snapshot is what makes "minimize the aside
 * and full screen takes that space too" work WITHOUT leaving and re-entering full screen — closing
 * or parking the aside drives `rightAsideEdge` back to `null`, and every consumer of this function
 * re-renders on that same external-store notification.
 *
 * Deliberately NOT applied to `SessionsPage.tsx`'s own right-slot full-screen wrapper: when the
 * panel going full screen already IS the artifacts aside's own occupant (Studio/Contents/Hardware
 * sitting in the RIGHT slot itself), there is no OTHER aside content to protect — the box this
 * function would read edges off is the very box asking to grow, and constraining it against its own
 * former position would make "full screen" a no-op there instead of covering the header and the
 * fleet list beside it.
 */
export function fullscreenInsetRight(rightAsideEdge: number | null, viewportWidth: number): number {
  if (rightAsideEdge === null) return 0
  return Math.max(0, viewportWidth - rightAsideEdge)
}
