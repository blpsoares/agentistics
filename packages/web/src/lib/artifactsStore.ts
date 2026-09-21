/**
 * artifactsStore.ts — the session's own file-count badge, plus a compatibility `openArtifacts` shim.
 *
 * BEFORE THE RIGHT ICON RAIL, this store carried an `open`/`dismissed`/`tabRequest` trio for the
 * SINGLE `contents` panel — the ten tabs it now covers shared one open flag because they shared one
 * container. Each of the ten is its own `PanelId` now (`panelSlots.ts`), with its own occupancy
 * tracked directly in `SlotLayout` exactly like `studio`/`cli`/`shell`/`hardware` always were — so
 * `open`/`dismissed` have nothing left to answer that `panelSlots.isPanelShown` does not already.
 *
 * WHAT SURVIVES:
 *  - `count` — the header's "N files" badge, a fact about the SESSION, unrelated to which panel (if
 *    any) is currently showing.
 *  - `openArtifacts(tab, ref)` — the compatibility shim every existing caller (note chips, the task
 *    flag, the metrics card's "see everything" link, the edge strip) already calls with a tab id and
 *    an optional row reference. It now opens straight through `panelSlots.showPanel`, and — when a
 *    `ref` is given — publishes it to `panelFocusRequest` below, which `ArtifactsAside` reads once it
 *    is mounted as that tab's active content.
 */

import { useSyncExternalStore } from 'react'
import { isPanelId, showPanel, type PanelId } from './panelSlots'

export interface ArtifactsState {
  /** Which session the count describes. `null` before one is selected. */
  sessionId: string | null
  /** How many files that session has touched, for the header's badge. */
  count: number
}

const EMPTY: ArtifactsState = { sessionId: null, count: 0 }

let state: ArtifactsState = EMPTY
const listeners = new Set<() => void>()

function emit(next: ArtifactsState): void {
  if (next.sessionId === state.sessionId && next.count === state.count) return
  state = next
  for (const l of listeners) l()
}

/** The current record. Exists for tests and for callers that read once rather than subscribe. */
export function getArtifacts(): ArtifactsState {
  return state
}

export function useArtifacts(): ArtifactsState {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => state,
    () => EMPTY,
  )
}

/** The panel's page reports which session it is showing and how many files it found. */
export function setArtifactCount(sessionId: string, count: number): void {
  emit(state.sessionId === sessionId ? { ...state, count } : { sessionId, count })
}

// ---------------------------------------------------------------------------------------------
// A REQUESTED ROW, for a tab an opener asked to land ON, not merely open.
// ---------------------------------------------------------------------------------------------

export interface PanelFocusRequest {
  tab: PanelId
  ref?: string
  /** The stamp that makes this a REQUEST rather than a setting — see `openArtifacts`'s own header
   *  on why. */
  at: number
}

let focus: PanelFocusRequest | null = null
const focusListeners = new Set<() => void>()

export function getPanelFocusRequest(): PanelFocusRequest | null {
  return focus
}

export function usePanelFocusRequest(): PanelFocusRequest | null {
  return useSyncExternalStore(
    cb => { focusListeners.add(cb); return () => { focusListeners.delete(cb) } },
    () => focus,
    () => null,
  )
}

function setPanelFocusRequest(next: PanelFocusRequest): void {
  focus = next
  for (const l of focusListeners) l()
}

/**
 * Open a panel by id (compatibility shim; see this module's own header). `tab` defaults to `'live'`
 * — the historical default tab, and the sentence every no-argument caller (the session-actions menu,
 * a displaced-Contents re-open) already relied on before `contents` had ten separate ids.
 *
 * `ref` names a STEP to land on once the tab is there — the edge strip names an action, and pressing
 * it should land on that row rather than on the top of a feed to be searched. It is published
 * through `panelFocusRequest`, stamped so a second request for the SAME tab/ref is still a distinct
 * request (asking twice for "Live" must still re-focus the latest row, not be a no-op because the
 * tab id did not change).
 */
export function openArtifacts(tab?: string, ref?: string): void {
  const panel: PanelId = isPanelId(tab) ? tab : 'live'
  showPanel(panel)
  if (ref !== undefined) setPanelFocusRequest({ tab: panel, ref, at: Date.now() })
}

/** For tests: forget everything. */
export function resetArtifacts(): void {
  state = EMPTY
  focus = null
  for (const l of listeners) l()
  for (const l of focusListeners) l()
}
