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
 *  - `live` / `setArtifactLive` / `useArtifactLive` — what the session is doing RIGHT NOW, published
 *    by `SessionsPage` for the session-metrics card's References section, which `App.tsx` draws
 *    outside the page that actually reads the conversation. Orthogonal to the panel/tab machinery
 *    above; it survived this pass unchanged in shape, only re-homed onto the simpler `ArtifactsState`.
 *  - `openArtifacts(tab, ref)` — the compatibility shim every existing caller (note chips, the task
 *    flag, the metrics card's "see everything" link, the edge strip) already calls with a tab id and
 *    an optional row reference. It now opens straight through `panelSlots.showPanel`, and — when a
 *    `ref` is given — publishes it to `panelFocusRequest` below, which `ArtifactsAside` reads once it
 *    is mounted as that tab's active content.
 */

import { useSyncExternalStore } from 'react'
import { isPanelId, showPanel, type PanelId } from './panelSlots'
import type { EdgeHint } from './artifactLayout'

/** What the session is doing this instant — the edge strip's own fact, see `currentAction`. */
export type ArtifactLive = EdgeHint

export interface ArtifactsState {
  /** Which session the count (and the live fact, below) describe. `null` before one is selected. */
  sessionId: string | null
  /** How many files that session has touched, for the header's badge. */
  count: number
  /**
   * WHAT THE SESSION IS DOING RIGHT NOW, for the surfaces that are not descendants of the page that
   * reads the conversation.
   *
   * The turns are polled inside `SessionsPage`, and the session-metrics card is drawn from `App.tsx`
   * — outside it. The card's "Live" reference has to say WHAT is running and open THAT step, so the
   * page publishes the one fact (`currentAction`) here instead of the card parsing a transcript it
   * has no access to. ABSENT, never an empty object, when nothing is in flight or when nobody can
   * say (the terminal view unmounts the conversation, and a stale "running X" is worse than none).
   * Keyed by `sessionId` like everything else here, and reset with it.
   */
  live?: ArtifactLive
}

const EMPTY: ArtifactsState = { sessionId: null, count: 0 }

let state: ArtifactsState = EMPTY
const listeners = new Set<() => void>()

function emit(next: ArtifactsState): void {
  // Reference equality is what `useSyncExternalStore` compares, so an unchanged state must keep the
  // same object or every poll re-renders both consumers.
  if (
    next.sessionId === state.sessionId && next.count === state.count && next.live === state.live
  ) return
  state = next
  for (const l of listeners) l()
}

/** The current record. Exists for tests and for callers that read once rather than subscribe. */
export function getArtifacts(): ArtifactsState {
  return state
}

/**
 * The panel's page reports what the session is doing right now — or `null` when nothing is in
 * flight or nobody can say.
 *
 * The stored object keeps its IDENTITY while its content is unchanged: the conversation is polled
 * every few seconds and yields a fresh object each time, and `useSyncExternalStore` compares by
 * reference, so without this the card would re-render on every poll to say the same thing.
 * A report for a session the store is not describing is dropped when it is `null` (there is
 * nothing to clear) and otherwise starts that session's record, exactly as a count does.
 */
export function setArtifactLive(sessionId: string, live: ArtifactLive | null): void {
  if (state.sessionId !== sessionId) {
    if (live === null) return
    emit({ sessionId, count: 0, live })
    return
  }
  const same = live !== null && state.live !== undefined &&
    state.live.kind === live.kind && state.live.text === live.text && state.live.ref === live.ref
  if (same) return
  const { live: _drop, ...rest } = state
  emit(live === null ? rest : { ...rest, live })
}

/** The live fact for ONE session, or `null` — and only that slice re-renders its reader. */
export function useArtifactLive(sessionId: string | undefined): ArtifactLive | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => (sessionId !== undefined && state.sessionId === sessionId ? state.live ?? null : null),
    () => null,
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
