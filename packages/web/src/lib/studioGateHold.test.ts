import { describe, expect, it } from 'bun:test'
import { studioGateJustClosed, studioGateMounted, studioGateShown } from './studioGateHold'

describe('studioGateJustClosed', () => {
  it('true -> false while the Studio is in use is the edge that must ask', () => {
    expect(studioGateJustClosed(true, false, true)).toBe(true)
  })

  it('true -> undefined counts too — undefined reads as off, same as false', () => {
    expect(studioGateJustClosed(true, undefined, true)).toBe(true)
  })

  it('a steady false is not a new attempt', () => {
    expect(studioGateJustClosed(false, false, true)).toBe(false)
  })

  it('the rising edge (turning it back on) is not a close attempt', () => {
    expect(studioGateJustClosed(false, true, true)).toBe(false)
  })

  it('a steady true is not a close attempt', () => {
    expect(studioGateJustClosed(true, true, true)).toBe(false)
  })

  it('the gate closing while the Studio was never opened has nothing to protect', () => {
    expect(studioGateJustClosed(true, false, false)).toBe(false)
  })
})

describe('studioGateMounted / studioGateShown', () => {
  it('an open gate with the Studio in use is mounted and shown', () => {
    expect(studioGateMounted(true, false, true, false)).toBe(true)
    expect(studioGateShown(true, false, true)).toBe(true)
  })

  it('a closed gate with nothing held drops both', () => {
    expect(studioGateMounted(false, false, true, true)).toBe(false)
    expect(studioGateShown(false, false, true)).toBe(false)
  })

  it('a closed gate with a HELD close attempt stays mounted and shown — nothing drops silently', () => {
    expect(studioGateMounted(false, true, true, false)).toBe(true)
    expect(studioGateShown(false, true, true)).toBe(true)
  })

  it('a held gate mounts even after the reader has stepped out of the Studio (studioOpened alone)', () => {
    expect(studioGateMounted(false, true, false, true)).toBe(true)
    // but is not the thing SHOWN, exactly like the ordinary "left the Studio" case
    expect(studioGateShown(false, true, false)).toBe(false)
  })

  it('a closed, unheld gate is never mounted, whatever `studioOpened` says', () => {
    expect(studioGateMounted(false, false, false, true)).toBe(false)
  })
})
