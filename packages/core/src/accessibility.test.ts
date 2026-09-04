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
})
