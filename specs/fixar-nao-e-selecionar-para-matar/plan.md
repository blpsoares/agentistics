# Implementation Plan — Pinning is not selecting-to-stop (`packages/tui`)

Journey `j-20260902-71` · task `fixar-nao-e-selecionar-para-matar` · unit `agentistics/tui`

## Approach

Keep the internal `marked` state and its persistence untouched (it is the pin, and R8 requires pins
to persist exactly as before). Change only the user-visible words to pinned/`fixada`. Disarm `x`
from the pinned set. Add a separate, ephemeral bulk-stop mode with its own state, held in React and
never written to `onView`, so it can never reach disk (R8).

The decision logic is a new pure, tested module so the component only renders — matching the
package's architecture (`selectors.ts`, `sessions.ts`, `chrome.ts` … are pure and tested; `.tsx`
render).

## New pure module — `src/control/bulk-stop.ts` (+ `bulk-stop.test.ts`)

- `BulkStopState = { active, selection }`; `BULK_STOP_OFF`.
- `reduceBulkStop(state, event)` — `enter` (fresh empty selection), `leave`/`executed` (→ OFF),
  `toggle` (only while armed). Covers R3/R6/R7.
- `rowMark(pinned, stopSelected) -> 'stop' | 'pinned' | 'none'` — stop outranks pinned (R4).
- `bulkKillList(sessions, selection)` — exactly the selection resolved against the fleet, never the
  pinned set, never the cursor (R5).

## Wiring — `src/control/tabs/Sessions.tsx`

- New `bulk` state (`BulkStopState`), reset to `BULK_STOP_OFF` on mount (ephemeral, R8).
- Key handler: `ctrl+x` toggles the mode; while armed, `space` selects a stoppable row (`canClose`),
  `x` stops the selection (raises the batch confirm and leaves the mode), `esc`/`ctrl+x` cancel,
  navigation still works, every other verb is swallowed.
- `runAction('kill')` no longer batches on the pinned set — normal-mode `x` falls through to the
  single-session confirm on the cursor row (R1).
- Rendering: pass `stopSelected` to `SessionRowView` and `SessionCard`; the leading mark is a red
  full block `█` for stop vs a cyan half block `▌` for pinned (`rowMark`), and the title reddens for
  stop (R4). The list pane gains a red frame and a "STOP MANY …" title while armed (R3).
- Footer hints and the `ctrl+r` reset account for the mode.

## i18n — `src/control/i18n.ts` (en + pt)

- Change the string VALUES for the pin concept to pinned/`fixada` (grouping label,
  `sessionsMarkedBand`, `sessionsUnfiled.marked`, `sessionsKeyWhat.mark`, `keySessionsMark`). Keep
  the object KEYS (`marked`) — they are internal and the persisted grouping id (R2, R8).
- Add `sessionsBulkTitle`, `sessionsBulkKillConfirm` (states the count, R5), `sessionsBulkHints`,
  `keySessionsBulkStop`, and `sessionsKeyWhat.bulkStop`.

## Shared primitive — `src/control/Pane.tsx`

- Add an `alert` prop: red border + red title, overriding focus — the visible mode frame (R3).

## Key reference — `src/control/sessions.ts`

- Add `bulkStop` to `sessionKeyHelp`'s word set and a `ctrl+x` row.

## Tests / verification

- `bun-test` for `bulk-stop.ts`; existing `sessions.test.ts` key-help fixture extended with
  `bulkStop`.
- `bun tsc --noEmit`, `bun test packages/tui`, `bun test packages/core/src/tokens.lint.test.ts`,
  `bun run build`, `bun run build:binary` (R9 + the TUI compile check).
- Live drive via `scripts/preview.tsx` for A1–A7 (the mode announcement, red rows, confirmations,
  vocabulary in en+pt), inspecting raw ANSI for the red vs cyan marks.
