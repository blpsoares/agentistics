/**
 * headerFit.ts — PURE: what the unified top strip gives up when it runs out of width, and in which
 * order.
 *
 * The strip holds, left to right: the session's title, the filter controls, the view tabs and the
 * actions. Three of those four are the answer to "what am I looking at" and "how do I act on it";
 * only the filters have a second home — every dimension they drop is still in the `+ Filtro`
 * popover, and the date range is still whatever it already was. So the filters are what shrinks,
 * and this module is the one place that decides how far.
 *
 * IT SHRINKS RATHER THAN CLIPS. The strip's middle is `overflow: hidden`, which is what stops it
 * painting over the view tabs (reported at 1920: the "Chat" label rendered on top of itself). But a
 * clipped control is worse than an overlapping one — it is simply unreachable, with nothing on
 * screen saying so. So the middle must give width back BEFORE the clip bites, and the date block is
 * what gives: `full` is the four presets plus the from/to range; `compact` is one button carrying
 * the range that is in force, which opens both.
 *
 * The thresholds are DERIVED from the controls' own metrics in `FiltersBar` (`CTL`: 12px text,
 * 10px horizontal padding, 1px border, 30px tall; 3px between presets, 8px between groups), not
 * read off a screenshot. Being a few pixels out costs one extra state change at one width; it
 * cannot make the strip wrong.
 */

/** The four presets: three two-character labels plus one word, with 3px between them. */
export const PRESETS_W = 191
/** The from/to range: the calendar glyph, two date fields and the dash between them. */
export const RANGE_W = 253
/** The divider between the two, plus the 8px gap on each side of it. */
export const DATE_GAP_W = 17
/** The `+ Filtro` button, with room for its count badge. */
export const ADD_FILTER_W = 95
/** One inter-group gap. */
export const GAP_W = 8

/** The date block at full size: presets, divider, range. */
export const DATE_FULL_W = PRESETS_W + DATE_GAP_W + RANGE_W
/** The date block collapsed to one button carrying the range in force. */
export const DATE_COMPACT_W = 96

/** Everything the inline bar needs to draw the date block at full size. */
export const FULL_BAR_W = DATE_FULL_W + GAP_W + ADD_FILTER_W

export interface HeaderFit {
  /**
   * `full` — the presets and the from/to range, side by side on the line.
   * `compact` — ONE button showing the range in force, which opens the same two in a popover.
   *
   * Never `none`: a date control with no way back is a filter the reader cannot see or lift, and
   * the strip is the only place either lives.
   */
  date: 'full' | 'compact'
}

/**
 * Decide from the width the filter bar actually has.
 *
 * A non-finite or negative measurement (a first paint, a detached node) answers `full` — the
 * layout the widest screens get. Guessing `compact` from a measurement that has not happened yet
 * would collapse the control on every mount and expand it a frame later, which reads as a fault.
 */
export function headerFit(available: number): HeaderFit {
  if (!Number.isFinite(available) || available <= 0) return { date: 'full' }
  return { date: available >= FULL_BAR_W ? 'full' : 'compact' }
}
