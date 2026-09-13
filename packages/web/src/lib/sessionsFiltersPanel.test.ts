import { describe, test, expect } from 'bun:test'
import {
  filtrosPanelInert, sessionsFiltersShouldReturnFocus,
  filtrosPanelBounds, FILTROS_PANEL_PREFERRED_WIDTH, FILTROS_PANEL_MIN_WIDTH,
} from './sessionsFiltersPanel'

describe('filtrosPanelInert', () => {
  test('collapsed panel is inert', () => {
    expect(filtrosPanelInert(false)).toBe(true)
  })

  test('open panel is NOT inert — the attribute is absent, not false', () => {
    expect(filtrosPanelInert(true)).toBeUndefined()
  })
})

describe('sessionsFiltersShouldReturnFocus', () => {
  test('collapsing while focus is inside the panel returns it to the trigger', () => {
    expect(sessionsFiltersShouldReturnFocus(false, true)).toBe(true)
  })

  test('collapsing while focus is elsewhere leaves it alone', () => {
    expect(sessionsFiltersShouldReturnFocus(false, false)).toBe(false)
  })

  test('opening never moves focus, whatever it is doing right now', () => {
    expect(sessionsFiltersShouldReturnFocus(true, true)).toBe(false)
    expect(sessionsFiltersShouldReturnFocus(true, false)).toBe(false)
  })
})

describe('filtrosPanelBounds', () => {
  // Figures verbatim from the review's re-review, §1: at 1440 the fleet aside puts the left edge
  // at x:320 and the artifacts aside at its DEFAULT (620px) width starts at x:820 — 500px of room,
  // more than the panel wants, so it gets its full preferred width.
  test('1440×900, artifacts aside at its default width — full preferred width, no clamp', () => {
    const bounds = filtrosPanelBounds({ left: 0, right: 320 }, { left: 820, right: 1440 }, 1440)
    expect(bounds).toEqual({ left: 320, width: FILTROS_PANEL_PREFERRED_WIDTH })
  })

  // The residual defect this function exists to close: at 1024×768 the SAME default-width aside
  // renders at 439px, not 620px, so it starts at x:585 (reproduced live, review §1) — 265px of
  // room. A fixed 440px cap overlapped it by 15px, painting over the "Studio" and "Live" tabs
  // (measured centres at x:628 and x:694). The clamped width must not cross the aside's left edge.
  test('1024×768, artifacts aside at its ACTUAL default width — clamped to the room, no overlap', () => {
    const bounds = filtrosPanelBounds({ left: 0, right: 320 }, { left: 585, right: 1024 }, 1024)
    expect(bounds).toEqual({ left: 320, width: 265 })
    expect(bounds.left + bounds.width).toBeLessThanOrEqual(585)
    // The two tabs the review found occluded are both now clear of the panel's right edge.
    expect(bounds.left + bounds.width).toBeLessThan(593) // "Studio" tab's own left edge
  })

  test('artifacts aside CLOSED — the viewport is the right edge, not the aside', () => {
    const bounds = filtrosPanelBounds({ left: 0, right: 320 }, null, 1440)
    expect(bounds).toEqual({ left: 320, width: FILTROS_PANEL_PREFERRED_WIDTH })
  })

  test('a closed aside and a present aside agree when the room is the same either way', () => {
    const withAside = filtrosPanelBounds({ left: 0, right: 200 }, { left: 500, right: 900 }, 900)
    const closedAtSameEdge = filtrosPanelBounds({ left: 0, right: 200 }, null, 500)
    expect(withAside.width).toBe(closedAtSameEdge.width)
  })

  test('room narrower than the floor still returns the floor, not a negative or zero width', () => {
    const bounds = filtrosPanelBounds({ left: 0, right: 1000 }, { left: 1050, right: 1440 }, 1440)
    expect(bounds).toEqual({ left: 1000, width: FILTROS_PANEL_MIN_WIDTH })
  })

  test('an aside crossing the left edge entirely (no room at all) still floors rather than going negative', () => {
    const bounds = filtrosPanelBounds({ left: 0, right: 800 }, { left: 700, right: 1440 }, 1440)
    expect(bounds.width).toBe(FILTROS_PANEL_MIN_WIDTH)
  })
})
