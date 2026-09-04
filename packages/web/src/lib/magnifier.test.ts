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
  // lens: x:100 y:100 width:400 height:300 zoom:4 borderWidth:3
  // interior (content-box) size: 400 - 2*3 = 394 wide, 300 - 2*3 = 294 tall
  // source size: 394/4 = 98.5 wide, 294/4 = 73.5 tall
  // frame centre: (100 + 400/2, 100 + 300/2) = (300, 250)
  // source origin: (300 - 98.5/2, 250 - 73.5/2) = (300 - 49.25, 250 - 36.75) = (250.75, 213.25)
  test('is the region under the lens interior, shrunk by the zoom and centred on the lens', () => {
    expect(sourceRect(lens())).toEqual({ x: 250.75, y: 213.25, width: 98.5, height: 73.5 })
  })
  test('at 1.5x it is larger than at 10x, centred on the same point', () => {
    const low = sourceRect(lens({ zoom: 1.5 }))
    const high = sourceRect(lens({ zoom: 10 }))
    expect(low.width).toBeGreaterThan(high.width)
    expect(low.x + low.width / 2).toBeCloseTo(high.x + high.width / 2)
  })
  test('centres on the lens FRAME centre exactly, even with a non-zero border', () => {
    // This is the invariant the off-by-border bug broke: the magnified image's centre must
    // land exactly on the frame's centre, never offset by the border width.
    const l = lens()
    const s = sourceRect(l)
    const frameCentreX = l.x + l.width / 2
    const frameCentreY = l.y + l.height / 2
    expect(s.x + s.width / 2).toBe(frameCentreX)
    expect(s.y + s.height / 2).toBe(frameCentreY)
  })
})

describe('stageTransform', () => {
  // Using the same sourceRect derivation above: source origin (250.75, 213.25).
  test('scales by the zoom and translates the source origin to zero', () => {
    expect(stageTransform(lens())).toEqual({ scale: 4, tx: -250.75, ty: -213.25 })
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
