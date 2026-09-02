/**
 * Bulk-stop mode — PURE.
 *
 * Pinning a row and choosing rows to STOP are two different gestures, and the danger is only in the
 * second. Pin (`space` in normal mode) is a highlighter: it survives re-sorting and a reboot, and it
 * is where `x` used to reach — so pinning rows to come back to them once armed `x` to offer stopping
 * exactly those. Bulk-stop mode splits them apart: `ctrl+x` arms it, `space` then SELECTS for
 * stopping, `x` stops the selection and leaves.
 *
 * Everything the mode knows lives in `BulkStopState`, and it NEVER reaches disk — the selection is
 * ephemeral by construction (it is React state, written to no preference), so a destructive set can
 * never resurrect on the next open. Pins keep persisting exactly as before, through `marked`.
 */

import type { ControlSession } from './types.ts'

/**
 * The whole of the mode: whether it is armed, and which sessions are selected for stopping.
 *
 * `active` and `selection` move together — leaving the mode always empties the selection, and a
 * selection can only ever hold ids toggled while armed, so an inactive state always carries an empty
 * set. Reading a stale selection off an inactive state would arm rows the user never saw.
 */
export interface BulkStopState {
  readonly active: boolean
  readonly selection: ReadonlySet<string>
}

/** Normal mode: nothing armed, nothing selected. The only value an inactive mode ever takes. */
export const BULK_STOP_OFF: BulkStopState = { active: false, selection: new Set<string>() }

export type BulkStopEvent =
  /** `ctrl+x` from normal mode: arm the mode with a FRESH, empty selection. */
  | { kind: 'enter' }
  /** `ctrl+x` again, or a reset: leave without stopping anything, discarding the selection. */
  | { kind: 'leave' }
  /** `space` on a row while armed: add or remove it from the selection. */
  | { kind: 'toggle'; id: string }
  /** `x` while armed: the stop was dispatched, so leave the mode by itself. */
  | { kind: 'executed' }

/**
 * The mode's one transition function.
 *
 * `enter` always starts EMPTY — a carried-over selection would arm rows off screen. `leave` and
 * `executed` both return to `BULK_STOP_OFF`; the only difference between them is whether a kill was
 * dispatched first, which is the caller's job, not the state's. `toggle` is a no-op unless armed, so
 * a stray `space` outside the mode can never seed a selection.
 */
export function reduceBulkStop(state: BulkStopState, event: BulkStopEvent): BulkStopState {
  switch (event.kind) {
    case 'enter':
      return { active: true, selection: new Set<string>() }
    case 'leave':
    case 'executed':
      return BULK_STOP_OFF
    case 'toggle': {
      if (!state.active) return state
      const next = new Set(state.selection)
      if (next.has(event.id)) next.delete(event.id)
      else next.add(event.id)
      return { active: true, selection: next }
    }
  }
}

/**
 * How a row's leading mark renders — and the whole point is the PRECEDENCE.
 *
 * Selected-for-stop OUTRANKS pinned, so a row that is both never hides its destructive state behind
 * the harmless one. `none` is neither. The caller maps these to a glyph and a colour (stop → red,
 * pinned → the highlighter blue), so the two states can never be told apart by shape alone.
 */
export type RowMark = 'stop' | 'pinned' | 'none'

export function rowMark(pinned: boolean, stopSelected: boolean): RowMark {
  if (stopSelected) return 'stop'
  if (pinned) return 'pinned'
  return 'none'
}

/**
 * The sessions a bulk `x` will stop: exactly the SELECTED ones, resolved against the live fleet.
 *
 * Never the pinned set, never the row under the cursor — the selection is the only input. A selected
 * id no longer in the fleet (it ended, a filter dropped it) simply resolves to nothing, so the plan
 * can only ever name sessions that still exist.
 */
export function bulkKillList(
  sessions: readonly ControlSession[],
  selection: ReadonlySet<string>,
): ControlSession[] {
  return sessions.filter(s => selection.has(s.id))
}
