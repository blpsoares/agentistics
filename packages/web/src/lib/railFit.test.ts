import { describe, expect, test } from 'bun:test'
import {
  clampRailWidth, fitRailIcons, railIconCapacity, railIconSize,
  RAIL_ICON_GAP_PX, RAIL_ICON_SIZE_PX, RAIL_PADDING_Y_PX, RAIL_WIDTH_CEILING_PX, RAIL_WIDTH_FLOOR_PX,
} from './railFit'
import type { PanelId } from './panelSlots'

const P: PanelId[] = [
  'live', 'gallery', 'skills', 'agents', 'forks', 'workflows', 'mcps', 'prs', 'tasks', 'metrics',
  'studio', 'hardware',
]

describe('railIconCapacity', () => {
  test('exact fit for N icons — height built from the formula itself', () => {
    for (let n = 1; n <= 12; n++) {
      const height = n * RAIL_ICON_SIZE_PX + (n - 1) * RAIL_ICON_GAP_PX + 2 * RAIL_PADDING_Y_PX
      expect(railIconCapacity(height)).toBe(n)
    }
  })

  test('one pixel short of the Nth icon fits only N-1', () => {
    const heightForTwo = 2 * RAIL_ICON_SIZE_PX + RAIL_ICON_GAP_PX + 2 * RAIL_PADDING_Y_PX
    expect(railIconCapacity(heightForTwo - 1)).toBe(1)
  })

  test('a height too short for even the padding fits zero, never negative', () => {
    expect(railIconCapacity(RAIL_PADDING_Y_PX)).toBe(0)
    expect(railIconCapacity(0)).toBe(0)
    expect(railIconCapacity(-100)).toBe(0)
  })

  test('non-finite input is total, never throws or yields NaN', () => {
    expect(railIconCapacity(NaN)).toBe(0)
    expect(railIconCapacity(Infinity)).toBe(0)
  })

  test('a very tall column fits every panel this app has, with room to spare', () => {
    expect(railIconCapacity(2000)).toBeGreaterThanOrEqual(P.length)
  })
})

describe('fitRailIcons', () => {
  test('everything fits — no overflow, nothing reserved for "more"', () => {
    const height = P.length * (RAIL_ICON_SIZE_PX + RAIL_ICON_GAP_PX) + 2 * RAIL_PADDING_Y_PX
    const fit = fitRailIcons(P, height)
    expect(fit.visible).toEqual(P)
    expect(fit.overflow).toEqual([])
  })

  test('exactly one too many for the raw capacity — ONE slot goes to "more", not to a 13th icon', () => {
    // Capacity for exactly P.length (12), but P has 13 entries.
    const height = P.length * RAIL_ICON_SIZE_PX + (P.length - 1) * RAIL_ICON_GAP_PX + 2 * RAIL_PADDING_Y_PX
    const thirteen = [...P, 'cli'] as PanelId[]
    const fit = fitRailIcons(thirteen, height)
    // Capacity is 12; one of those 12 slots is spent on the "more" button, so 11 panels show.
    expect(fit.visible.length).toBe(11)
    expect(fit.overflow.length).toBe(2)
    expect(fit.visible).toEqual(thirteen.slice(0, 11))
    expect(fit.overflow).toEqual(thirteen.slice(11))
  })

  test('order is preserved on both sides of the split', () => {
    const fit = fitRailIcons(P, 4 * RAIL_ICON_SIZE_PX + 3 * RAIL_ICON_GAP_PX + 2 * RAIL_PADDING_Y_PX)
    expect(fit.visible).toEqual(P.slice(0, 3)) // 4 fit, one slot reserved for "more"
    expect(fit.overflow).toEqual(P.slice(3))
  })

  test('zero capacity overflows EVERY panel — nothing renders as an icon, but nothing is lost either', () => {
    const fit = fitRailIcons(P, 0)
    expect(fit.visible).toEqual([])
    expect(fit.overflow).toEqual(P)
  })

  test('an empty panel list is a no-op regardless of height', () => {
    expect(fitRailIcons([], 500)).toEqual({ visible: [], overflow: [] })
  })

  // PLANTED-REVERT: a version that does NOT reserve a slot for "more" would show one extra icon
  // and push it (and the more button) out of the measured height — the exact bug this rule exists
  // to prevent.
  test('[planted-revert coverage] not reserving the "more" slot overflows one fewer panel than correct', () => {
    function brokenFit(panels: readonly PanelId[], height: number) {
      const capacity = railIconCapacity(height)
      if (panels.length <= capacity) return { visible: panels, overflow: [] }
      return { visible: panels.slice(0, capacity), overflow: panels.slice(capacity) } // no -1
    }
    const height = 4 * RAIL_ICON_SIZE_PX + 3 * RAIL_ICON_GAP_PX + 2 * RAIL_PADDING_Y_PX
    const broken = brokenFit(P, height)
    const correct = fitRailIcons(P, height)
    expect(broken.visible.length).not.toBe(correct.visible.length)
    expect(broken.visible.length).toBe(correct.visible.length + 1)
  })
})

// -------------------------------------------------------------------------------------------
// clampRailWidth / railIconSize — the resizable rail (owner, 2026-09-21)
// -------------------------------------------------------------------------------------------

describe('clampRailWidth', () => {
  test('within range is unchanged', () => {
    expect(clampRailWidth(50)).toBe(50)
  })

  test('below the floor clamps to the floor', () => {
    expect(clampRailWidth(0)).toBe(RAIL_WIDTH_FLOOR_PX)
    expect(clampRailWidth(-100)).toBe(RAIL_WIDTH_FLOOR_PX)
    expect(clampRailWidth(RAIL_WIDTH_FLOOR_PX - 1)).toBe(RAIL_WIDTH_FLOOR_PX)
  })

  test('above the ceiling clamps to the ceiling', () => {
    expect(clampRailWidth(1000)).toBe(RAIL_WIDTH_CEILING_PX)
    expect(clampRailWidth(RAIL_WIDTH_CEILING_PX + 1)).toBe(RAIL_WIDTH_CEILING_PX)
  })

  test('exactly at either edge is unchanged', () => {
    expect(clampRailWidth(RAIL_WIDTH_FLOOR_PX)).toBe(RAIL_WIDTH_FLOOR_PX)
    expect(clampRailWidth(RAIL_WIDTH_CEILING_PX)).toBe(RAIL_WIDTH_CEILING_PX)
  })

  test('non-finite input reads as the floor, never NaN or a throw', () => {
    expect(clampRailWidth(NaN)).toBe(RAIL_WIDTH_FLOOR_PX)
    expect(clampRailWidth(Infinity)).toBe(RAIL_WIDTH_FLOOR_PX)
    expect(clampRailWidth(-Infinity)).toBe(RAIL_WIDTH_FLOOR_PX)
  })

  test('the ceiling is "half again" the floor, literally', () => {
    expect(RAIL_WIDTH_CEILING_PX).toBe(RAIL_WIDTH_FLOOR_PX * 1.5)
  })
})

describe('railIconSize', () => {
  test('at the floor, the icon is EXACTLY today’s untouched 32px', () => {
    expect(railIconSize(RAIL_WIDTH_FLOOR_PX)).toBe(RAIL_ICON_SIZE_PX)
  })

  test('at the ceiling, the icon scales by the same ratio the rail did', () => {
    expect(railIconSize(RAIL_WIDTH_CEILING_PX)).toBe(Math.round(RAIL_ICON_SIZE_PX * 1.5))
  })

  test('scales monotonically between floor and ceiling', () => {
    const atFloor = railIconSize(RAIL_WIDTH_FLOOR_PX)
    const mid = railIconSize((RAIL_WIDTH_FLOOR_PX + RAIL_WIDTH_CEILING_PX) / 2)
    const atCeiling = railIconSize(RAIL_WIDTH_CEILING_PX)
    expect(mid).toBeGreaterThan(atFloor)
    expect(atCeiling).toBeGreaterThan(mid)
  })

  test('a width past the ceiling or under the floor is clamped BEFORE deriving — never a runaway size', () => {
    expect(railIconSize(10000)).toBe(railIconSize(RAIL_WIDTH_CEILING_PX))
    expect(railIconSize(0)).toBe(railIconSize(RAIL_WIDTH_FLOOR_PX))
  })

  // PLANTED-REVERT: a version that does not clamp its input first would let an out-of-range width
  // (e.g. a corrupt stored value) produce an unbounded icon size — the exact runaway this function's
  // own "clamps its OWN input first" rule exists to prevent.
  test('[planted-revert coverage] skipping the internal clamp lets a corrupt width run away', () => {
    function brokenIconSize(railWidth: number): number {
      return Math.round(RAIL_ICON_SIZE_PX * (railWidth / RAIL_WIDTH_FLOOR_PX)) // no clamp
    }
    const broken = brokenIconSize(10000)
    const correct = railIconSize(10000)
    expect(broken).not.toBe(correct)
    expect(broken).toBeGreaterThan(RAIL_ICON_SIZE_PX * 100) // runs away
    expect(correct).toBeLessThanOrEqual(Math.round(RAIL_ICON_SIZE_PX * 1.5)) // stays bounded
  })
})

describe('railIconCapacity / fitRailIcons — with a derived (resized) icon size', () => {
  test('a LARGER icon fits FEWER panels in the same height', () => {
    const height = 400
    const atFloor = railIconCapacity(height, railIconSize(RAIL_WIDTH_FLOOR_PX))
    const atCeiling = railIconCapacity(height, railIconSize(RAIL_WIDTH_CEILING_PX))
    expect(atCeiling).toBeLessThan(atFloor)
  })

  test('fitRailIcons overflows MORE panels once the rail (and its icons) has grown', () => {
    const height = 6 * RAIL_ICON_SIZE_PX + 5 * RAIL_ICON_GAP_PX + 2 * RAIL_PADDING_Y_PX // fits 6 @ floor
    const atFloor = fitRailIcons(P, height, railIconSize(RAIL_WIDTH_FLOOR_PX))
    const atCeiling = fitRailIcons(P, height, railIconSize(RAIL_WIDTH_CEILING_PX))
    expect(atFloor.overflow.length).toBeLessThan(atCeiling.overflow.length)
  })

  test('omitting iconSize defaults to the floor’s own 32px, unchanged from before this feature', () => {
    const height = 300
    expect(railIconCapacity(height)).toBe(railIconCapacity(height, RAIL_ICON_SIZE_PX))
  })
})
