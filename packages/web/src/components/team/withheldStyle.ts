/**
 * withheldStyle.ts — the ONE visual token for "this is withheld from somewhere".
 *
 * There are three places that mark something as not-shared (a repository card on the central, a
 * repository's detail header, and the connection card's collapsed rule pill). They used three
 * copies of the same orange, which is the colour this product already spends on *advisory* notices
 * — so a withheld repository read as a warning about itself, and a real advisory next to it read as
 * the same thing.
 *
 * This is a MEANING, not an alarm, and the distinction is load-bearing:
 *
 * - It is RED, weakly. Red is the only hue a reader already associates with "held back / not
 *   passing", and the owner asked for it by name. Nothing else on these cards is red for a
 *   non-fault reason, so it reads as deliberate rather than decorative.
 * - It is never `var(--accent-red)` itself. That exact value IS the fault colour — `offline`,
 *   `unauthorized`, a broken connection, a failed apply all render their text in it. The
 *   foreground here is the red pulled most of the way back toward ordinary secondary text, and the
 *   fill is a tint far below any of the fault fills. A user who hid a repository on purpose is not
 *   being told something is wrong; a user whose connection is genuinely broken must still be able
 *   to tell those two apart at a glance, in the same card.
 *
 * Pure and dependency-free so both the values and that distinction are testable.
 */

/** The full-strength fault colour these markers must never reuse. */
export const FAULT_COLOR = 'var(--accent-red)'

/** Fill behind a withheld marker — a tint, well under the fault fills (which sit at 10-12%). */
export const WITHHELD_BG = 'color-mix(in srgb, var(--accent-red) 8%, transparent)'

/** Text/icon colour: recognisably red, but pulled back toward secondary text so it cannot be
 *  mistaken for the fault colour sitting beside it on the same card. */
export const WITHHELD_FG = 'color-mix(in srgb, var(--accent-red) 55%, var(--text-secondary))'

/** The shared marker style. Spread it; add only layout (padding, radius, direction) per site. */
export function withheldMarkStyle(): { background: string; color: string } {
  return { background: WITHHELD_BG, color: WITHHELD_FG }
}
