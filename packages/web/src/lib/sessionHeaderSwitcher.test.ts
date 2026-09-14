import { describe, expect, test } from 'bun:test'
import { headerSwitcherEntries, studioLocationLabel, type HeaderSwitcherGates } from './sessionHeaderSwitcher'

const OPEN: HeaderSwitcherGates = {
  editorEnabled: true, shellEnabled: true, relayed: false, hardwareOffered: true,
}

describe('headerSwitcherEntries — order and presence', () => {
  test('every gate open: all five, in the fixed order', () => {
    const entries = headerSwitcherEntries(null, null, OPEN)
    expect(entries.map(e => e.id)).toEqual(['contents', 'studio', 'cli', 'shell', 'hardware'])
  })

  test('contents is never gated — always present', () => {
    const entries = headerSwitcherEntries(null, null, {
      editorEnabled: false, shellEnabled: false, relayed: true, hardwareOffered: false,
    })
    expect(entries.map(e => e.id)).toEqual(['contents'])
  })

  test('studio absent when editorEnabled is off — never greyed, simply not there', () => {
    const entries = headerSwitcherEntries(null, null, { ...OPEN, editorEnabled: false })
    expect(entries.some(e => e.id === 'studio')).toBe(false)
  })

  test('cli and shell absent on a relayed session', () => {
    const entries = headerSwitcherEntries(null, null, { ...OPEN, relayed: true })
    expect(entries.map(e => e.id)).toEqual(['contents', 'studio', 'hardware'])
  })

  test('shell absent when shellEnabled is off, cli untouched', () => {
    const entries = headerSwitcherEntries(null, null, { ...OPEN, shellEnabled: false })
    expect(entries.map(e => e.id)).toEqual(['contents', 'studio', 'cli', 'hardware'])
  })

  test('hardware absent when not offered (a central)', () => {
    const entries = headerSwitcherEntries(null, null, { ...OPEN, hardwareOffered: false })
    expect(entries.some(e => e.id === 'hardware')).toBe(false)
  })
})

describe('the right-slot entries — on exactly when they occupy the right slot', () => {
  test('EXACTLY ONE of contents/cli/shell/hardware is on at a time — the right slot\'s occupant, and no other', () => {
    for (const active of ['contents', 'cli', 'shell', 'hardware'] as const) {
      const entries = headerSwitcherEntries(active, null, OPEN)
      const lit = entries.filter(e => e.on)
      expect(lit).toHaveLength(1)
      expect(lit[0]?.id).toBe(active)
    }
  })

  test('nothing active: every entry reads off — never a confident default', () => {
    const entries = headerSwitcherEntries(null, null, OPEN)
    expect(entries.every(e => !e.on)).toBe(true)
  })

  test('a panel absent from this gate set is simply never lit even if named the right occupant', () => {
    const entries = headerSwitcherEntries('studio', null, { ...OPEN, editorEnabled: false })
    expect(entries.every(e => !e.on)).toBe(true)
  })
})

// Owner follow-up (screenshot 5): "the Studio must be ACTIVE from the moment it is open... with a
// small tag saying where it is open (side, bottom)". `isPanelShown` reads `true` for EITHER slot —
// unlike every other entry here, which answers only for the right one.
describe('studio — lit in EITHER slot, tagged with where it sits', () => {
  test('studio in the right slot: on, tagged "side"', () => {
    const entries = headerSwitcherEntries('studio', null, OPEN)
    const studio = entries.find(e => e.id === 'studio')
    expect(studio).toEqual({ id: 'studio', on: true, studioAt: 'side' })
  })

  test('studio in the bottom slot, nothing on the right: on, tagged "bottom"', () => {
    const entries = headerSwitcherEntries(null, 'studio', OPEN)
    const studio = entries.find(e => e.id === 'studio')
    expect(studio).toEqual({ id: 'studio', on: true, studioAt: 'bottom' })
  })

  test('studio shown nowhere: off, no tag', () => {
    const entries = headerSwitcherEntries('contents', null, OPEN)
    const studio = entries.find(e => e.id === 'studio')
    expect(studio).toEqual({ id: 'studio', on: false })
  })

  // The one case two entries may read `on` at once (design item 1): Studio docked at the bottom
  // while another panel occupies the right slot. Plant: read `rightOccupant === 'studio'` as
  // studio's ONLY `on` condition (the pre-fix shape) and this fails — studio reads `off` here.
  test('studio at the bottom AND contents on the right: BOTH lit — the one allowed exception', () => {
    const entries = headerSwitcherEntries('contents', 'studio', OPEN)
    const lit = entries.filter(e => e.on)
    expect(lit.map(e => e.id).sort()).toEqual(['contents', 'studio'])
    expect(entries.find(e => e.id === 'studio')?.studioAt).toBe('bottom')
  })

  // Exhaustive: every (rightOccupant, bottomOccupant) combination a real `SlotLayout` can produce —
  // a panel sits in at most one slot, so `right` and `bottom` are never the SAME id (except both
  // `null`) — yields at most one lit entry besides Studio, and Studio's own tag always matches
  // whichever slot (if either) actually holds it.
  const PANELS = ['contents', 'studio', 'cli', 'shell', 'hardware'] as const
  test('exhaustive: at most 2 lit (studio + right occupant), never more, tag always correct', () => {
    for (const right of [...PANELS, null]) {
      for (const bottom of [...PANELS, null]) {
        if (right !== null && bottom !== null && right === bottom) continue // impossible in a real layout
        const entries = headerSwitcherEntries(right, bottom, OPEN)
        const lit = entries.filter(e => e.on)
        expect(lit.length).toBeLessThanOrEqual(2)
        const studio = entries.find(e => e.id === 'studio')
        if (right === 'studio') expect(studio).toMatchObject({ on: true, studioAt: 'side' })
        else if (bottom === 'studio') expect(studio).toMatchObject({ on: true, studioAt: 'bottom' })
        else if (studio) expect(studio.on).toBe(false)
        // Every non-studio entry only ever lights for the RIGHT occupant.
        for (const e of entries) {
          if (e.id === 'studio') continue
          expect(e.on).toBe(right === e.id)
        }
      }
    }
  })
})

describe('studioLocationLabel — the tag\'s own words', () => {
  test('side, EN/PT', () => {
    expect(studioLocationLabel('side', false)).toBe('side')
    expect(studioLocationLabel('side', true)).toBe('lateral')
  })

  test('bottom, EN/PT', () => {
    expect(studioLocationLabel('bottom', false)).toBe('bottom')
    expect(studioLocationLabel('bottom', true)).toBe('embaixo')
  })
})
