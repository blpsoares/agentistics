# Feature Spec — Pinning is not selecting-to-stop (`packages/tui`)

Journey `j-20260902-71` · task `fixar-nao-e-selecionar-para-matar` · unit `agentistics/tui`

## Objective

Pinning a session row and choosing sessions to stop become two distinct gestures — distinct
words, distinct colours. Whoever pins rows to come back to them no longer risks `x` offering to
stop exactly those. Whoever wants to stop several enters an explicit mode, sees in red what will
die, and leaves the mode by itself the moment it stops them.

This closes the defect the PE reported: `x` acted on the pinned set, so pinning rows to return to
them armed `x` to stop precisely those.

## User scenarios

- A person pins a couple of rows (`space`) to find them again later. Pressing `x` on any other row
  stops only that row — pinning never arms a stop.
- A person wants to stop several sessions at once. They press `ctrl+x`; the screen visibly says it
  is in bulk-stop mode. `space` now selects rows (shown red); `x` stops the selection and returns
  to normal. `ctrl+x` again or `esc` cancels with nothing stopped.

## Requirements

- **R1** — In normal mode, `x` acts on the one row under the cursor. Its confirmation names that
  single session and shows no count. Pinned rows are irrelevant to it.
- **R2** — The user-visible concept formerly called `marked` reads as **pinned / `fixada`** in every
  place a person reads it (row/grouping label, grouping band, the band's "not" side, key help line,
  key reference), in both `en` and `pt`. "marked" / "marcada" no longer names this concept on screen.
- **R3** — `ctrl+x` enters bulk-stop mode, announced visibly (a person can tell from the screen
  alone that `space` now selects for stopping).
- **R4** — In bulk-stop mode, selected rows render **red**, distinct from a pinned row. A row that is
  both pinned and selected-for-stop reads as selected-for-stop (the destructive state is never
  hidden behind the harmless one).
- **R5** — In bulk-stop mode, `x` stops exactly the selected sessions (not the pinned set, not the
  cursor row) and its confirmation states their count.
- **R6** — Immediately after that `x`, the interface is back in normal mode by itself: the
  announcement is gone, the red is gone, the ephemeral selection is empty, and `space` pins again.
- **R7** — Leaving bulk-stop mode without `x` (`esc`, or `ctrl+x` again) stops nothing, discards the
  red selection, and leaves whatever was pinned unchanged.
- **R8** — The stop selection is ephemeral — it never reaches disk. What is pinned persists exactly
  as before.
- **R9** — `bun tsc --noEmit`, the tui test suite, and `bun run build` all pass.

## Acceptance criteria

The approved task spec `.aipe/journeys/j-20260902-71/task-specs/agentistics__tui.md` (criteria
A1–A9) is the authority. This spec mirrors it; the QA runs A1–A9 against the delivered code.

## Constraints

- `space` still pins in normal mode. `ctrl+x` enters bulk-stop; `x` inside it executes and leaves.
  These keys are as the PE specified.
- Selected-for-stop is **red** and must be distinguishable from pinned.
- The stop selection never goes to disk. Pinning persists exactly as today.
- Only `packages/tui`. No `packages/agentop`, no web, no stopping sessions outside the TUI.

## Out of scope

- Changing how pinned state is persisted.
- Any other TUI key.
- Renaming internal identifiers nobody reads on screen (permitted, not the goal, must not leak
  outside this unit).
