import { describe, test, expect } from 'bun:test'
import type { MagnifierLens } from '@agentistics/core'
import { ZOOM_MAX, ZOOM_MIN, LENS_MIN_PX } from '@agentistics/core'
import {
  pageKey,
  sourceRect,
  stageTransform,
  clampLens,
  applyLensKey,
  newLens,
  lensControls,
  MOVE_STEP_PX,
  MOVE_FINE_PX,
  RESIZE_STEP_PX,
  ZOOM_STEP,
} from './magnifier'

const lens = (over: Partial<MagnifierLens> = {}): MagnifierLens => ({
  id: 'a', x: 100, y: 100, width: 400, height: 300, zoom: 4,
  shape: 'rect', borderWidth: 3, cornerRadius: 12, pinned: false,
  ...over,
})

const NO_MODS = { shift: false, alt: false, ctrl: false, meta: false }

// A generously large viewport: every pre-existing `sourceRect`/`stageTransform` case below is
// deliberately far from any edge, so a viewport this size never triggers the new clamp — that is
// the proof the common (away-from-edge) case did not move.
const VP = { width: 1920, height: 1080 }

describe('pageKey', () => {
  test('drops query and hash', () => {
    expect(pageKey('/costs?range=30d')).toBe('/costs')
    expect(pageKey('/costs#top')).toBe('/costs')
    expect(pageKey('/costs?a=1#top')).toBe('/costs')
  })
  test('normalises a trailing slash but keeps the root', () => {
    expect(pageKey('/costs/')).toBe('/costs')
    expect(pageKey('/')).toBe('/')
    expect(pageKey('')).toBe('/')
  })
  test('keeps distinct dynamic routes distinct', () => {
    expect(pageKey('/repo/github.com/org/api')).not.toBe(pageKey('/repo/github.com/org/web'))
  })
})

describe('sourceRect', () => {
  // A lens CENTRED in the viewport: x = (1920-400)/2 = 760, y = (1080-300)/2 = 390.
  // interior (content-box) size: 400 - 2*3 = 394 wide, 300 - 2*3 = 294 tall
  // source size: 394/4 = 98.5 wide, 294/4 = 73.5 tall
  //
  // Agreement with the old centred rule, derived algebraically (this is the property that makes
  // the new pan rule invisible for a freshly-created lens, which `newLens` always centres):
  //   old:  source.x = lens.x + lens.width/2 - width/2
  //       = (vp.width-lens.width)/2 + lens.width/2 - width/2 = (vp.width - width)/2
  //   new:  clampedLensX = lensRange/2 (lens.x IS lensRange/2 when centred), so
  //       source.x = (lensRange/2 / lensRange) * srcRange = srcRange/2 = (vp.width - width)/2
  // Both reduce to the same expression, so a centred lens produces the exact old numbers:
  //   source origin: (1920-98.5)/2, (1080-73.5)/2) = (910.75, 503.25)
  const CENTRED = { x: 760, y: 390 }

  test('agreement: a lens centred in the viewport produces exactly the region the old centred rule produced', () => {
    expect(sourceRect(lens(CENTRED), VP)).toEqual({ x: 910.75, y: 503.25, width: 98.5, height: 73.5 })
  })
  test('at 1.5x it is larger than at 10x, centred on the same point (lens itself centred)', () => {
    const low = sourceRect(lens({ ...CENTRED, zoom: 1.5 }), VP)
    const high = sourceRect(lens({ ...CENTRED, zoom: 10 }), VP)
    expect(low.width).toBeGreaterThan(high.width)
    expect(low.x + low.width / 2).toBeCloseTo(high.x + high.width / 2)
  })
  test('renders source region edges exactly at the content-box edges', () => {
    // The true invariant the off-by-border bug broke: sourceRect and stageTransform work
    // together so that a page coordinate at the source region's edge renders at the
    // viewport position of the lens's content-box edge. Rendering formula:
    //   viewportX = (lens.x + borderWidth) + zoom * (pageX - sourceRect.x)
    // For the source region's left edge (pageX = sourceRect.x):
    //   viewportX = lens.x + borderWidth ✓ (left edge of content box)
    // For the source region's right edge (pageX = sourceRect.x + sourceRect.width):
    //   viewportX = lens.x + borderWidth + zoom * sourceRect.width
    //            = lens.x + borderWidth + (interior_width) = lens.x + lens.width - borderWidth ✓

    function renderViewportX(pageX: number, lensX: number, borderWidth: number, sourceX: number, zoom: number): number {
      const contentBoxX = lensX + borderWidth
      return contentBoxX + zoom * (pageX - sourceX)
    }

    function renderViewportY(pageY: number, lensY: number, borderWidth: number, sourceY: number, zoom: number): number {
      const contentBoxY = lensY + borderWidth
      return contentBoxY + zoom * (pageY - sourceY)
    }

    const testCases = [
      { borderWidth: 1, zoom: 2, width: 400, height: 300, x: 100, y: 100 },
      { borderWidth: 12, zoom: 2, width: 400, height: 300, x: 100, y: 100 },
      { borderWidth: 3, zoom: 7.5, width: 500, height: 400, x: 50, y: 75 },
      { borderWidth: 6, zoom: 3, width: 350, height: 280, x: 200, y: 150 },
      { borderWidth: 1, zoom: 5, width: 200, height: 200, x: 0, y: 0 },
    ]

    testCases.forEach(({ borderWidth, zoom, width, height, x, y }) => {
      const l = lens({ borderWidth, zoom, width, height, x, y })
      const s = sourceRect(l, VP)
      const z = l.zoom

      // Content box edges in viewport coords
      const contentLeft = l.x + borderWidth
      const contentRight = l.x + l.width - borderWidth
      const contentTop = l.y + borderWidth
      const contentBottom = l.y + l.height - borderWidth

      // Source region edges should render at content box edges
      expect(renderViewportX(s.x, l.x, borderWidth, s.x, z)).toBeCloseTo(contentLeft, 5)
      expect(renderViewportX(s.x + s.width, l.x, borderWidth, s.x, z)).toBeCloseTo(contentRight, 5)
      expect(renderViewportY(s.y, l.y, borderWidth, s.y, z)).toBeCloseTo(contentTop, 5)
      expect(renderViewportY(s.y + s.height, l.y, borderWidth, s.y, z)).toBeCloseTo(contentBottom, 5)
    })
  })
})

describe('stageTransform', () => {
  // Using the same sourceRect derivation above (a lens centred in the viewport):
  // source origin (910.75, 503.25).
  test('scales by the zoom and translates the source origin to zero', () => {
    expect(stageTransform(lens({ x: 760, y: 390 }), VP)).toEqual({ scale: 4, tx: -910.75, ty: -503.25 })
  })
})

describe('sourceRect — proportional pan, so every corner of the page is reachable', () => {
  // A wrong implementation each test below would still accept: any that RESIZES the region
  // (ruled out by asserting `width`/`height` stay the geometric interior/zoom value) or that
  // still centres on the lens's own centre instead of panning by its position (ruled out because
  // the centred formula gives a different, and in the corner cases unreachable, answer).
  const vp = { width: 1200, height: 900 }

  test('left/top edge: a lens at x=0, y=0 yields source.x === 0 and source.y === 0 — the corner is reachable', () => {
    // This is the test that would have caught the original bug: under the old centred rule this
    // lens's region started at a NEGATIVE x (nothing to its left was ever inside any region).
    const l = lens({ x: 0, y: 0, width: 200, height: 200, borderWidth: 5, zoom: 2 })
    const s = sourceRect(l, vp)
    expect(s.x).toBe(0)
    expect(s.y).toBe(0)
    const interior = (200 - 10) / 2
    expect(s.width).toBeCloseTo(interior) // never resized
    expect(s.height).toBeCloseTo(interior)
  })

  test('right/bottom edge: a lens at its maximum position yields source.x/y at the viewport\'s far edge', () => {
    const width = 200
    const height = 200
    const borderWidth = 5
    const zoom = 2
    const l = lens({ x: vp.width - width, y: vp.height - height, width, height, borderWidth, zoom })
    const s = sourceRect(l, vp)
    expect(s.x).toBe(vp.width - s.width)
    expect(s.y).toBe(vp.height - s.height)
  })

  test('a region wider than the viewport (reachable below 1x) is centred on that axis, not resized', () => {
    // interior width = (2000 - 10) / 0.55 = 3618.18..., far bigger than the 1024px viewport. The
    // lens is vertically centred so the y-axis pan reduces to the old centred formula too,
    // keeping this test's height assertion simple and focused on the width branch under test.
    const vpNarrow = { width: 1024, height: 900 }
    const height = 200
    const l = lens({ x: 400, y: (vpNarrow.height - height) / 2, width: 2000, height, borderWidth: 5, zoom: ZOOM_MIN })
    const s = sourceRect(l, vpNarrow)
    const width = (2000 - 10) / ZOOM_MIN
    expect(width).toBeGreaterThan(vpNarrow.width)
    expect(s.x).toBeCloseTo((vpNarrow.width - width) / 2)
    expect(s.width).toBeCloseTo(width) // never resized to fit
    const heightInterior = (height - 10) / ZOOM_MIN
    expect(s.y).toBeCloseTo((vpNarrow.height - heightInterior) / 2)
  })

  test('off-screen lens position (follow-lens case): a negative x still yields a source origin of 0, not negative', () => {
    // The cursor-following lens is not clamped by `clampLens`, so its raw x can be negative; the
    // ratio must be computed off the CLAMPED position, or this would produce a negative origin.
    const l = lens({ x: -50, y: 300, width: 200, height: 200, borderWidth: 5, zoom: 2 })
    const s = sourceRect(l, vp)
    expect(s.x).toBe(0)
    expect(s.x).toBeGreaterThanOrEqual(0)
  })
})

describe('clampLens', () => {
  const vp = { width: 1000, height: 800 }
  test('keeps a lens fully on screen', () => {
    expect(clampLens(lens({ x: 5000, y: 5000 }), vp)).toMatchObject({ x: 600, y: 500 })
    expect(clampLens(lens({ x: -999, y: -999 }), vp)).toMatchObject({ x: 0, y: 0 })
  })
  test('clamps zoom to the bounds', () => {
    expect(clampLens(lens({ zoom: 999 }), vp).zoom).toBe(ZOOM_MAX)
    expect(clampLens(lens({ zoom: 0 }), vp).zoom).toBe(ZOOM_MIN)
  })
  test('never lets a lens be smaller than the floor or wider than the viewport', () => {
    expect(clampLens(lens({ width: 1 }), vp).width).toBe(LENS_MIN_PX)
    expect(clampLens(lens({ width: 9999 }), vp).width).toBe(1000)
  })
  test('a circle keeps one dimension and fits the shorter viewport side', () => {
    const c = clampLens(lens({ shape: 'circle', width: 9999, height: 10 }), vp)
    expect(c.width).toBe(c.height)
    expect(c.width).toBe(800)
  })
})

describe('applyLensKey', () => {
  test('arrows move by the coarse step, alt by the fine one', () => {
    expect(applyLensKey(lens(), 'ArrowRight', NO_MODS)).toMatchObject({ x: 100 + MOVE_STEP_PX })
    expect(applyLensKey(lens(), 'ArrowUp', { ...NO_MODS, alt: true })).toMatchObject({ y: 100 - MOVE_FINE_PX })
  })
  test('shift+arrows resize instead of moving', () => {
    expect(applyLensKey(lens(), 'ArrowRight', { ...NO_MODS, shift: true })).toMatchObject({
      x: 100, width: 400 + RESIZE_STEP_PX,
    })
    expect(applyLensKey(lens(), 'ArrowDown', { ...NO_MODS, shift: true })).toMatchObject({
      height: 300 + RESIZE_STEP_PX,
    })
  })
  test('a circle resizes on every arrow, because it has one dimension: right/up grow, left/down shrink', () => {
    const circle = lens({ shape: 'circle', width: 400, height: 400 })
    const shiftMods = { ...NO_MODS, shift: true }
    const right = applyLensKey(circle, 'ArrowRight', shiftMods)
    expect(right).toMatchObject({ width: 400 + RESIZE_STEP_PX, height: 400 + RESIZE_STEP_PX })
    const up = applyLensKey(circle, 'ArrowUp', shiftMods)
    expect(up).toMatchObject({ width: 400 + RESIZE_STEP_PX, height: 400 + RESIZE_STEP_PX })
    const left = applyLensKey(circle, 'ArrowLeft', shiftMods)
    expect(left).toMatchObject({ width: 400 - RESIZE_STEP_PX, height: 400 - RESIZE_STEP_PX })
    const down = applyLensKey(circle, 'ArrowDown', shiftMods)
    expect(down).toMatchObject({ width: 400 - RESIZE_STEP_PX, height: 400 - RESIZE_STEP_PX })
  })
  test('plus and minus step the zoom', () => {
    expect(applyLensKey(lens(), '+', NO_MODS)).toMatchObject({ zoom: 4 + ZOOM_STEP })
    expect(applyLensKey(lens(), '-', NO_MODS)).toMatchObject({ zoom: 4 - ZOOM_STEP })
    expect(applyLensKey(lens(), '=', NO_MODS)).toMatchObject({ zoom: 4 + ZOOM_STEP })
    expect(applyLensKey(lens(), '_', NO_MODS)).toMatchObject({ zoom: 4 - ZOOM_STEP })
  })
  test('P toggles pinned, in either direction', () => {
    expect(applyLensKey(lens(), 'p', NO_MODS)).toMatchObject({ pinned: true })
    expect(applyLensKey(lens({ pinned: true }), 'P', NO_MODS)).toMatchObject({ pinned: false })
  })
  test('Delete removes and Escape deselects', () => {
    expect(applyLensKey(lens(), 'Delete', NO_MODS)).toBe('remove')
    expect(applyLensKey(lens(), 'Backspace', NO_MODS)).toBe('remove')
    expect(applyLensKey(lens(), 'Escape', NO_MODS)).toBe('deselect')
  })
  test('an unrelated key falls through to the page', () => {
    expect(applyLensKey(lens(), 'a', NO_MODS)).toBeNull()
    expect(applyLensKey(lens(), 'Tab', NO_MODS)).toBeNull()
  })
  test('a ctrl or meta chord is never ours — the app keeps its own shortcuts', () => {
    expect(applyLensKey(lens(), 'ArrowRight', { ...NO_MODS, ctrl: true })).toBeNull()
    expect(applyLensKey(lens(), 'p', { ...NO_MODS, meta: true })).toBeNull()
  })
})

describe('lensControls', () => {
  test('a 60px lens with 44px mobile controls yields only the drag handle', () => {
    expect(lensControls(60, 44, 30)).toEqual(['drag'])
  })

  test('a wide desktop lens yields every control, config right after drag', () => {
    // A default 360px lens with a 3px border and 26px desktop controls: 360 - 2*3 = 354px inner.
    // Everything costs drag+config+pin+remove (4*26=104) + the zoom pair (52) + the label (30) =
    // 186px, well inside 354.
    expect(lensControls(354, 26, 30))
      .toEqual(['drag', 'config', 'pin', 'remove', 'zoomOut', 'zoomIn', 'zoomLabel'])
  })

  test('width enough for drag+config+pin+remove but not the zoom pair yields exactly those four', () => {
    // 4 controls (104px) fit; a 5th slot (130px) would not, so the pair (which needs 2 more) is
    // refused as a pair rather than one of the two slipping in alone.
    expect(lensControls(155, 26, 30)).toEqual(['drag', 'config', 'pin', 'remove'])
  })

  test('drag survives at every width, including absurd ones', () => {
    expect(lensControls(0, 26, 30)).toEqual(['drag'])
    expect(lensControls(-50, 26, 30)).toEqual(['drag'])
    expect(lensControls(1, 44, 30)).toEqual(['drag'])
  })

  test('config only joins once its own width is spared beyond the drag handle', () => {
    // Exactly two controls' worth of room: drag + config fit exactly, nothing is wasted. `config`
    // is second in priority — right after `drag` — because it alone reaches every other setting,
    // so a lens too narrow for more than one extra control still gives full command of itself.
    expect(lensControls(52, 26, 30)).toEqual(['drag', 'config'])
    // One pixel short: config cannot be drawn intact, so it is withheld rather than clipped.
    expect(lensControls(51, 26, 30)).toEqual(['drag'])
  })

  test('the zoom pair needs its own two full widths beyond drag+config+pin+remove, not merely nonzero room', () => {
    // 104px used by drag+config+pin+remove; 155px total leaves 51px, one short of the 52px the
    // pair costs.
    expect(lensControls(155, 26, 30)).toEqual(['drag', 'config', 'pin', 'remove'])
    // 156px leaves exactly 52px: the pair fits whole.
    expect(lensControls(156, 26, 30))
      .toEqual(['drag', 'config', 'pin', 'remove', 'zoomOut', 'zoomIn'])
  })

  test('the zoom label is gated by its OWN width, not the control width', () => {
    // Room for drag+config+pin+remove+pair (156px) plus 20px more — enough for a narrow label
    // (18px) but not a wide one (25px). This would pass even a buggy implementation that reused
    // `controlPx` for the label gate only if the two happened to be numerically close, so the
    // two branches below use label widths that straddle a value controlPx could never produce.
    expect(lensControls(176, 26, 18))
      .toEqual(['drag', 'config', 'pin', 'remove', 'zoomOut', 'zoomIn', 'zoomLabel'])
    expect(lensControls(176, 26, 25))
      .toEqual(['drag', 'config', 'pin', 'remove', 'zoomOut', 'zoomIn'])
  })

  test('pin only joins once config already fit — the priority order is enforced, not just the count', () => {
    // Enough total width for two controls (drag + one more) is ambiguous only if priority order
    // is ignored; this pins that the second control admitted is config, never pin or remove.
    const result = lensControls(52, 26, 30)
    expect(result).toContain('config')
    expect(result).not.toContain('pin')
    expect(result).not.toContain('remove')
  })
})

describe('newLens', () => {
  test('lands centred in the viewport with an id nobody else holds', () => {
    const style = { shape: 'rect' as const, width: 400, height: 300, zoom: 3, borderWidth: 3, cornerRadius: 12 }
    const made = newLens(style, { width: 1000, height: 800 }, new Set(['lens-1']))
    expect(made.id).toBe('lens-2')
    expect(made.x).toBe(300)
    expect(made.y).toBe(250)
    expect(made.pinned).toBe(false)
  })
})
