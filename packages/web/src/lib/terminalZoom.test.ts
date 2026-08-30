import { describe, it, expect } from 'bun:test'
import { clampZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from './terminalZoom'

describe('clampZoom', () => {
  it('keeps a value inside the range', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(1.3)).toBe(1.3)
  })
  it('clamps below the floor and above the ceiling', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
  })
  it('rounds to a clean 2-decimal step so repeated +/- stays exact', () => {
    expect(clampZoom(1.0000001)).toBe(1)
    expect(clampZoom(1.15 + 0.15)).toBe(1.3)
  })
  it('falls back to the default for a non-finite value', () => {
    expect(clampZoom(NaN)).toBe(ZOOM_DEFAULT)
    expect(clampZoom(Infinity)).toBe(ZOOM_DEFAULT)
  })
})
