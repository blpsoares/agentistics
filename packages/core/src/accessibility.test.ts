import { describe, test, expect } from 'bun:test'
import {
  sanitizeAccessibilityPrefs,
  DEFAULT_ACCESSIBILITY_PREFS,
  ZOOM_MIN,
  ZOOM_MAX,
  LENS_MIN_PX,
} from './accessibility'

describe('sanitizeAccessibilityPrefs', () => {
  test('junk input yields the defaults', () => {
    expect(sanitizeAccessibilityPrefs(null)).toEqual(DEFAULT_ACCESSIBILITY_PREFS)
    expect(sanitizeAccessibilityPrefs('nope')).toEqual(DEFAULT_ACCESSIBILITY_PREFS)
    expect(sanitizeAccessibilityPrefs(42)).toEqual(DEFAULT_ACCESSIBILITY_PREFS)
    expect(sanitizeAccessibilityPrefs({})).toEqual(DEFAULT_ACCESSIBILITY_PREFS)
  })

  test('enabled is true only for the literal boolean', () => {
    expect(sanitizeAccessibilityPrefs({ enabled: true }).enabled).toBe(true)
    expect(sanitizeAccessibilityPrefs({ enabled: 'true' }).enabled).toBe(false)
    expect(sanitizeAccessibilityPrefs({ enabled: 1 }).enabled).toBe(false)
  })

  test('zoom and size are clamped, not rejected', () => {
    const out = sanitizeAccessibilityPrefs({
      lensesByPage: { '/costs': [{ id: 'a', x: 10, y: 20, zoom: 999, width: 1, height: 1 }] },
    })
    const lens = out.lensesByPage['/costs']![0]!
    expect(lens.zoom).toBe(ZOOM_MAX)
    expect(lens.width).toBe(LENS_MIN_PX)
    expect(lens.height).toBe(LENS_MIN_PX)
  })

  test('a zoom below the floor is raised to it', () => {
    const out = sanitizeAccessibilityPrefs({
      lensesByPage: { '/': [{ id: 'a', x: 0, y: 0, zoom: 0.1 }] },
    })
    expect(out.lensesByPage['/']![0]!.zoom).toBe(ZOOM_MIN)
  })

  test('an unknown shape falls back to rect, and a circle mirrors width into height', () => {
    const out = sanitizeAccessibilityPrefs({
      lensesByPage: {
        '/': [
          { id: 'a', x: 0, y: 0, shape: 'triangle' },
          { id: 'b', x: 0, y: 0, shape: 'circle', width: 200, height: 999 },
        ],
      },
    })
    expect(out.lensesByPage['/']![0]!.shape).toBe('rect')
    const circle = out.lensesByPage['/']![1]!
    expect(circle.shape).toBe('circle')
    expect(circle.width).toBe(200)
    expect(circle.height).toBe(circle.width)
  })

  test('duplicate and missing ids are re-minted deterministically', () => {
    const out = sanitizeAccessibilityPrefs({
      lensesByPage: {
        '/': [
          { id: 'dup', x: 0, y: 0 },
          { id: 'dup', x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    })
    const ids = out.lensesByPage['/']!.map(l => l.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('dup')
  })

  test('page keys that are not paths, and non-array pages, are dropped', () => {
    const out = sanitizeAccessibilityPrefs({
      lensesByPage: { costs: [{ id: 'a', x: 0, y: 0 }], '/ok': [{ id: 'b', x: 0, y: 0 }], '/bad': 'x' },
    })
    expect(Object.keys(out.lensesByPage)).toEqual(['/ok'])
  })

  test('an empty page is dropped rather than stored empty', () => {
    const out = sanitizeAccessibilityPrefs({ lensesByPage: { '/costs': [] } })
    expect(out.lensesByPage).toEqual({})
  })

  test('it is idempotent', () => {
    const messy = {
      enabled: true,
      followLens: { shape: 'circle', width: 300, zoom: 6 },
      lensesByPage: { '/costs': [{ id: 'dup', x: 5, y: 5, zoom: 99 }, { id: 'dup', x: 1, y: 1 }] },
    }
    const once = sanitizeAccessibilityPrefs(messy)
    expect(sanitizeAccessibilityPrefs(once)).toEqual(once)
  })

  test('Finding 1: garbage array items are skipped, not turned into default lenses', () => {
    // A page of only non-object entries should yield no page key at all
    const out1 = sanitizeAccessibilityPrefs({
      lensesByPage: { '/costs': ['garbage', 42, null, undefined, true] },
    })
    expect(out1.lensesByPage).toEqual({})

    // A page mixing one real lens with garbage entries should yield exactly that one lens
    const out2 = sanitizeAccessibilityPrefs({
      lensesByPage: {
        '/mixed': [
          'garbage',
          { id: 'lens-real', x: 10, y: 20 },
          42,
          null,
          undefined,
          true,
        ],
      },
    })
    expect(out2.lensesByPage['/mixed']).toBeDefined()
    expect(out2.lensesByPage['/mixed']!.length).toBe(1)
    expect(out2.lensesByPage['/mixed']![0]!.id).toBe('lens-real')
  })

  test('Finding 2: explicit ids are reserved before auto-minting new ones', () => {
    // The case from the finding: [anonymous, anonymous, explicit 'lens-2']
    // should keep the explicit 'lens-2' and give the anonymous entries different ids
    const out = sanitizeAccessibilityPrefs({
      lensesByPage: {
        '/test': [
          { x: 0, y: 0 }, // anonymous
          { x: 1, y: 1 }, // anonymous
          { id: 'lens-2', x: 2, y: 2 }, // explicit
        ],
      },
    })
    const lenses = out.lensesByPage['/test']!
    expect(lenses.length).toBe(3)

    // All three ids should be distinct
    const ids = lenses.map(l => l.id)
    expect(new Set(ids).size).toBe(3)

    // Find each lens by its position (which is preserved through sanitization)
    const lens0 = lenses.find(l => l.x === 0 && l.y === 0)!
    const lens1 = lenses.find(l => l.x === 1 && l.y === 1)!
    const lens2 = lenses.find(l => l.x === 2 && l.y === 2)!

    // The explicit 'lens-2' must be assigned to the entry that declared it
    expect(lens2.id).toBe('lens-2')

    // The anonymous entries must get different ids, not 'lens-2'
    expect(lens0.id).not.toBe('lens-2')
    expect(lens1.id).not.toBe('lens-2')
    expect(lens0.id).not.toBe(lens1.id)

    // The anonymous ids should be from the minted sequence
    expect(['lens-1', 'lens-3']).toContain(lens0.id)
    expect(['lens-1', 'lens-3']).toContain(lens1.id)
  })

  test('idempotency still holds with explicit ids and garbage entries', () => {
    const messy = {
      lensesByPage: {
        '/test': [
          'garbage',
          { x: 0, y: 0 },
          { id: 'custom-id', x: 1, y: 1 },
          42,
        ],
      },
    }
    const once = sanitizeAccessibilityPrefs(messy)
    expect(sanitizeAccessibilityPrefs(once)).toEqual(once)
  })
})
