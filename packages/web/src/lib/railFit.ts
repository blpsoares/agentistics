/**
 * railFit.ts — PURE: how many rail icons fit a given height (spec §4), and which panels overflow
 * into the "more" control.
 *
 * ICON GEOMETRY MIRRORS `PanelRail.tsx`'s OWN BOX EXACTLY — a 32px square button, a 2px gap between
 * them, and 8px of padding above the first icon and below the last (`padding: '8px 4px'` on the
 * rail's own column). This module has no React import (it cannot read CSS back), so the four
 * numbers are named constants here and `PanelRail.tsx` imports them rather than restating them —
 * the two can never drift the way a hand-copied "32" in each file could.
 *
 * THE RAIL NEVER SCROLLS ITS ICONS (spec §4: "overflow is the dropdown, not a scrollbar") — this is
 * the arithmetic behind that rule: once more panels are placed on the rail than the column's own
 * measured height can hold, the trailing ones collapse into ONE "more" control rather than the list
 * growing a scrollbar or shrinking icons to fit.
 */

import type { PanelId } from './panelSlots'

export const RAIL_ICON_SIZE_PX = 32
export const RAIL_ICON_GAP_PX = 2
/** Padding on ONE side (top, or bottom) of the icon column — `padding: '8px 4px'` in `PanelRail.tsx`,
 *  vertical component only; this module never reads the horizontal 4px, which never affects height. */
export const RAIL_PADDING_Y_PX = 8

/**
 * THE RAIL'S OWN RESIZABLE WIDTH (owner, 2026-09-21: "aumentar POUCA COISA da largura... isso
 * aumenta os icones tbm"). FLOOR is today's fixed width, unchanged — the rail's own icon (32px)
 * plus its 4px horizontal padding on each side, so a rail at the floor reproduces today's exact
 * look, pixel for pixel. CEILING is "POUCA COISA" (a little bit) taken literally: half again the
 * floor (`44 * 1.5 = 66`) — past this the rail reads as a panel, which is the one thing spec §2
 * says it must never become ("icons only, VS Code's activity bar").
 */
export const RAIL_WIDTH_FLOOR_PX = 44
export const RAIL_WIDTH_CEILING_PX = 66

/** Clamp a requested rail width to `[FLOOR, CEILING]` — PURE, total: non-finite input reads as the
 *  floor rather than NaN or a thrown error. */
export function clampRailWidth(width: number): number {
  if (!Number.isFinite(width)) return RAIL_WIDTH_FLOOR_PX
  return Math.min(RAIL_WIDTH_CEILING_PX, Math.max(RAIL_WIDTH_FLOOR_PX, width))
}

/**
 * THE ICON SIZE, DERIVED FROM THE RAIL'S WIDTH — never a second constant that happens to agree
 * with it. Scales PROPORTIONALLY to how far the rail has grown past its own floor, so the floor
 * yields exactly `RAIL_ICON_SIZE_PX` (32px, today's untouched size) and the ceiling yields
 * `32 * (66/44) = 48px`. Clamps its OWN input first, so a caller does not have to clamp twice.
 */
export function railIconSize(railWidth: number): number {
  const clamped = clampRailWidth(railWidth)
  return Math.round(RAIL_ICON_SIZE_PX * (clamped / RAIL_WIDTH_FLOOR_PX))
}

/**
 * How many icon slots of `iconSize` fit inside `availableHeight` — PURE, total (never negative,
 * never NaN). `iconSize` defaults to the FLOOR's own 32px for every caller that has not measured a
 * resized rail — see `railIconSize`, above, for where a live width turns into this.
 *
 * `availableHeight` is the icon COLUMN's own measured height — already excluding whatever the
 * caller reserves for the config area at the rail's end (§5's eye), since whether that area is
 * reserved depends on whether anything is currently hidden, which this function has no way to know
 * and should not have to.
 *
 * The arithmetic: `n` icons plus `n-1` gaps between them plus the padding on both ends must fit —
 * `n * ICON + (n-1) * GAP + 2 * PADDING <= height`, solved for the largest integer `n`.
 */
export function railIconCapacity(availableHeight: number, iconSize: number = RAIL_ICON_SIZE_PX): number {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return 0
  const usable = availableHeight - RAIL_PADDING_Y_PX * 2 + RAIL_ICON_GAP_PX
  if (usable <= 0) return 0
  return Math.max(0, Math.floor(usable / (iconSize + RAIL_ICON_GAP_PX)))
}

export interface RailFit {
  /** The panels that show as icons, in order. */
  visible: readonly PanelId[]
  /** The panels behind the "more" control, in order — empty when everything fits. */
  overflow: readonly PanelId[]
}

/**
 * Which panels are icons and which overflow — PURE, total.
 *
 * Reserves exactly ONE slot for the "more" control itself the moment there is anything to put
 * behind it: showing every panel up to `capacity` and THEN adding a "more" button would push the
 * capacity-th icon out of view, defeating the button that was meant to make room for it. A capacity
 * of zero (nothing fits at all, an absurdly short window) still overflows every panel behind the
 * "more" control rather than rendering nothing and no way to reach anything — see this module's own
 * header on "nothing is unreachable" (spec §9).
 */
export function fitRailIcons(
  panels: readonly PanelId[], availableHeight: number, iconSize: number = RAIL_ICON_SIZE_PX,
): RailFit {
  const capacity = railIconCapacity(availableHeight, iconSize)
  if (panels.length <= capacity) return { visible: panels, overflow: [] }
  const forIcons = Math.max(0, capacity - 1)
  return { visible: panels.slice(0, forIcons), overflow: panels.slice(forIcons) }
}
