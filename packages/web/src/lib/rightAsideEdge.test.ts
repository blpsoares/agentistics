import { describe, test, expect } from 'bun:test'
import { transformTranslateX, restingLeftEdge, fullscreenInsetRight } from './rightAsideEdge'

describe('transformTranslateX', () => {
  test('no transform at all — nothing to discount', () => {
    expect(transformTranslateX('none')).toBe(0)
  })

  test('a 2D matrix — the X translation is its 5th component', () => {
    // `translateX(100%)` on a 440px-wide overlay aside resolves to this matrix.
    expect(transformTranslateX('matrix(1, 0, 0, 1, 440, 0)')).toBe(440)
  })

  test('the settled, non-translated matrix reads as zero', () => {
    expect(transformTranslateX('matrix(1, 0, 0, 1, 0, 0)')).toBe(0)
  })

  test('a negative translation (sliding the other way) is preserved, not floored to zero', () => {
    expect(transformTranslateX('matrix(1, 0, 0, 1, -120, 0)')).toBe(-120)
  })

  test('a 3D matrix — the X translation is its 13th component', () => {
    const parts = Array.from({ length: 16 }, (_, i) => (i === 0 || i === 5 || i === 10 || i === 15 ? 1 : i === 12 ? 264 : 0))
    expect(transformTranslateX(`matrix3d(${parts.join(', ')})`)).toBe(264)
  })

  test('a shape this box never produces (rotate/skew) discounts nothing rather than guessing', () => {
    expect(transformTranslateX('rotate(45deg)')).toBe(0)
  })

  test('an empty or malformed string is treated as no translation, never NaN', () => {
    expect(transformTranslateX('')).toBe(0)
    expect(transformTranslateX('matrix(garbage)')).toBe(0)
  })
})

describe('restingLeftEdge', () => {
  // The exact shape from the review's Critical finding: the overlay aside at 1024×768 settles at
  // left:584 (viewport 1024 minus its own 440px width) and starts translated fully off-screen.
  test('a translated element off-screen still yields its resting position', () => {
    // Mount-time frame: visually parked at 1024 (off the right edge), translateX(100%) → 440px.
    expect(restingLeftEdge(1024, 'matrix(1, 0, 0, 1, 440, 0)')).toBe(584)
  })

  test('mid-slide, the visual position and the translation move together — the resting edge never changes', () => {
    // Halfway through the open animation: visually at 804, half of the 440px translation left.
    expect(restingLeftEdge(804, 'matrix(1, 0, 0, 1, 220, 0)')).toBe(584)
  })

  test('settled open (translateX(0)) — the visual and resting positions already agree', () => {
    expect(restingLeftEdge(584, 'matrix(1, 0, 0, 1, 0, 0)')).toBe(584)
  })

  test('a box with no transform at all (the split shell) is read at face value', () => {
    expect(restingLeftEdge(585, 'none')).toBe(585)
  })
})

describe('fullscreenInsetRight', () => {
  test('the aside open at 1440×900, default 620px width settling at x=820 — the overlay stops there', () => {
    expect(fullscreenInsetRight(820, 1440)).toBe(620)
  })

  test('no aside on screen at all — the overlay covers the whole viewport, exactly as inset:0 did', () => {
    expect(fullscreenInsetRight(null, 1440)).toBe(0)
  })

  test('the aside minimized (its edge goes back to null) — the SAME viewport now yields zero inset', () => {
    // The reactive half of the fix: minimizing never re-enters full screen, it just changes what
    // this function is fed on the next render.
    const open = fullscreenInsetRight(820, 1440)
    const minimized = fullscreenInsetRight(null, 1440)
    expect(open).toBeGreaterThan(0)
    expect(minimized).toBe(0)
  })

  test('a narrower aside (dragged in) yields a smaller inset, never negative', () => {
    expect(fullscreenInsetRight(1200, 1440)).toBe(240)
  })

  test('an edge past the viewport (a stale measurement) floors at zero rather than going negative', () => {
    expect(fullscreenInsetRight(1500, 1440)).toBe(0)
  })

  test('a narrow viewport with the aside occupying most of it — the overlay is a thin strip', () => {
    expect(fullscreenInsetRight(585, 1024)).toBe(439)
  })

  // THE RAIL (right-icon-rail pass): it sits to the right of the aside and exists even when the
  // aside itself is closed — see this function's own header.
  test('aside closed, rail present (default machine, desktop) — the rail alone is respected', () => {
    expect(fullscreenInsetRight(null, 1440, 44)).toBe(44)
  })

  test('aside OPEN — the rail is already inside rightAsideEdge’s own arithmetic, railWidth adds nothing more', () => {
    expect(fullscreenInsetRight(820, 1440, 44)).toBe(620)
  })

  test('mobile (no rail at all) — omitting railWidth behaves exactly as before this pass', () => {
    expect(fullscreenInsetRight(null, 390)).toBe(0)
  })
})
