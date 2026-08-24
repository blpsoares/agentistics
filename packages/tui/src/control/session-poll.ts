/**
 * session-poll.ts — PURE. The presets the config pane's refresh row cycles through, and the cycle
 * itself.
 *
 * The floor/ceiling and the persisted default live in the server's `preferences.ts`
 * (`SESSION_POLL_MIN_MS`/`SESSION_POLL_MAX_MS`/`SESSION_POLL_DEFAULT_MS`) — this file duplicates
 * only the four values a person actually picks between, the same way `ControlCenter.tsx` keeps its
 * own `5_000` fallback rather than importing across the `server -> tui` boundary. The TUI reads no
 * preferences of its own; it only needs to know what the row should say and do next.
 */

/** Fastest first, so a user pressing the row repeatedly reaches the floor before the default. */
export const SESSION_POLL_PRESETS_MS = [1_000, 2_000, 5_000, 10_000] as const

const FIRST_PRESET_MS: number = SESSION_POLL_PRESETS_MS[0]

/**
 * The preset the row moves to next. Wraps from the last preset back to the first.
 *
 * A value that is not itself one of the presets (an older or hand-edited preference) is treated as
 * sitting just before the smallest preset greater than it, so pressing the row always lands on a
 * preset rather than repeating a number the row cannot itself produce.
 */
export function nextSessionPollMs(current: number): number {
  const next: number | undefined = SESSION_POLL_PRESETS_MS.find(ms => ms > current)
  return next ?? FIRST_PRESET_MS
}
