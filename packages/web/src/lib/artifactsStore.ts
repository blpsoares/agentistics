/**
 * artifactsStore.ts — the artifacts panel's open state and its count, shared by two components that
 * do not contain one another.
 *
 * The BUTTON lives in the unified header (`App.tsx`'s sessions strip, beside the Chat/Terminal
 * tabs); the PANEL and the list it counts live in `SessionsPage`. Neither is an ancestor of the
 * other, so the state has to sit beside them both.
 *
 * An external store rather than a context, matching `notifications.ts` — the alternative is
 * threading two values and a setter through the page shell, the strip and the panel, which is four
 * files that must agree about a boolean. Kept deliberately small: an open flag, a count, and which
 * session they describe.
 *
 * `sessionId` is on the record for a reason. The count belongs to ONE conversation, and a stale
 * count on the header of a different session is exactly the class of confident-wrong-answer this
 * codebase refuses elsewhere — so a reader that does not recognise the session shows nothing rather
 * than the last session's number.
 */

import { useSyncExternalStore } from 'react'
import { holdIfUnsaved } from './unsavedBuffers'

export interface ArtifactsState {
  /** Which session the count and the open flag describe. `null` before one is selected. */
  sessionId: string | null
  open: boolean
  /** How many files that session has touched, for the header's badge. */
  count: number
  /**
   * The person closed it for THIS session.
   *
   * Kept so the panel does not open itself again while the same session keeps writing — see
   * `shouldAutoOpen`. Cleared by selecting a different session, because a decision about one
   * conversation says nothing about the next.
   */
  dismissed: boolean
  /**
   * WHICH TAB an opener asked for, and when it asked.
   *
   * The panel remembers the tab the reader last chose, which is right for the header's button —
   * you press it to go back to what you were looking at. It is wrong for the edge marker, whose
   * whole sentence is "the harness is running something": pressing that and landing on the file
   * list is an answer to a question nobody asked.
   *
   * The `at` stamp is what makes it a REQUEST rather than a setting. Without it the panel could
   * never leave the requested tab — the reader clicks Files, the prop still says `live`, and the
   * next render puts them back. Asking twice for the same tab is two requests, so the stamp changes
   * even when the tab does not.
   */
  tabRequest: { tab: string; at: number; ref?: string } | null
}

const EMPTY: ArtifactsState = {
  sessionId: null, open: false, count: 0, dismissed: false, tabRequest: null,
}

let state: ArtifactsState = EMPTY
const listeners = new Set<() => void>()

function emit(next: ArtifactsState): void {
  // Reference equality is what `useSyncExternalStore` compares, so an unchanged state must keep the
  // same object or every poll re-renders both consumers.
  if (
    next.sessionId === state.sessionId && next.open === state.open &&
    next.count === state.count && next.dismissed === state.dismissed &&
    next.tabRequest === state.tabRequest
  ) return
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
  emit(state.sessionId === sessionId
    ? { ...state, count }
    // A different session: the count is its own, and so is the decision to have closed the panel.
    : { sessionId, count, open: false, dismissed: false, tabRequest: null })
}

export function openArtifacts(tab?: string, ref?: string): void {
  emit({
    ...state, open: true,
    // `ref` names a STEP to open once the tab is there — the edge strip names an action, and
    // pressing it should land on that row rather than on the top of a feed to be searched.
    ...(tab === undefined ? {} : { tabRequest: { tab, at: Date.now(), ...(ref ? { ref } : {}) } }),
  })
}

/**
 * Closing is also a DECISION not to be reopened automatically — see `ArtifactsState.dismissed`.
 *
 * AND IT ASKS FIRST WHEN THE STUDIO HOLDS UNSAVED BUFFERS. Closing the panel unmounts the whole
 * pane, Monaco models and all, so a close with dirty buffers is a discard. The question is asked
 * HERE, in the only function that closes, rather than at each button that calls it: the panel's
 * own close, the header's toggle and the page menu's toggle all arrive through this, and a guard
 * at the call sites is a guard the next caller forgets. `unsavedBuffers.ts` holds the question; the
 * close happens only when the reader chooses to discard.
 */
export function closeArtifacts(): void {
  if (state.open && holdIfUnsaved('close', closeNow)) return
  closeNow()
}

function closeNow(): void {
  emit({ ...state, open: false, dismissed: true })
}

export function toggleArtifacts(): void {
  if (state.open) closeArtifacts(); else openArtifacts()
}

/** For tests: forget everything. */
export function resetArtifacts(): void {
  state = EMPTY
  for (const l of listeners) l()
}
