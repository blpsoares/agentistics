import { describe, expect, test } from 'bun:test'
import { bandBarCompact, panelBarEntries, studioLocationLabel, type PanelBarGates } from './panelBar'

const OPEN: PanelBarGates = {
  editorEnabled: true, shellEnabled: true, relayed: false, hardwareOffered: true,
}

describe('panelBarEntries — order and presence', () => {
  test('every gate open: all five, in the fixed order', () => {
    const entries = panelBarEntries(null, null, OPEN)
    expect(entries.map(e => e.id)).toEqual(['contents', 'studio', 'cli', 'shell', 'hardware'])
  })

  test('contents is never gated — always present', () => {
    const entries = panelBarEntries(null, null, {
      editorEnabled: false, shellEnabled: false, relayed: true, hardwareOffered: false,
    })
    expect(entries.map(e => e.id)).toEqual(['contents'])
  })

  test('studio absent when editorEnabled is off — never greyed, simply not there', () => {
    const entries = panelBarEntries(null, null, { ...OPEN, editorEnabled: false })
    expect(entries.some(e => e.id === 'studio')).toBe(false)
  })

  test('cli and shell absent on a relayed session', () => {
    const entries = panelBarEntries(null, null, { ...OPEN, relayed: true })
    expect(entries.map(e => e.id)).toEqual(['contents', 'studio', 'hardware'])
  })

  test('shell absent when shellEnabled is off, cli untouched', () => {
    const entries = panelBarEntries(null, null, { ...OPEN, shellEnabled: false })
    expect(entries.map(e => e.id)).toEqual(['contents', 'studio', 'cli', 'hardware'])
  })

  test('hardware absent when not offered (a central)', () => {
    const entries = panelBarEntries(null, null, { ...OPEN, hardwareOffered: false })
    expect(entries.some(e => e.id === 'hardware')).toBe(false)
  })
})

describe('contents/hardware — right-slot-only panels, on exactly when they occupy the right slot', () => {
  test('EXACTLY ONE of contents/hardware is on at a time — the right slot\'s occupant, and no other', () => {
    for (const active of ['contents', 'hardware'] as const) {
      const entries = panelBarEntries(active, null, OPEN)
      const lit = entries.filter(e => e.on)
      expect(lit).toHaveLength(1)
      expect(lit[0]?.id).toBe(active)
    }
  })

  test('nothing active: every entry reads off — never a confident default', () => {
    const entries = panelBarEntries(null, null, OPEN)
    expect(entries.every(e => !e.on)).toBe(true)
  })

  test('a panel absent from this gate set is simply never lit even if named the right occupant', () => {
    const entries = panelBarEntries('studio', null, { ...OPEN, editorEnabled: false })
    expect(entries.every(e => !e.on)).toBe(true)
  })

  // A real `SlotLayout` never puts `contents`/`hardware` in the bottom slot (`panelSlots.allowed`
  // refuses it outright), so a bottom occupant of either id is a state this bar should never be
  // handed — but the pure function reads it the same "either slot" way as cli/shell would, rather
  // than trusting the caller never to pass it. Defensive, not load-bearing.
  test('contents/hardware would also read on for a (never-real) bottom occupant', () => {
    expect(panelBarEntries(null, 'contents', OPEN).find(e => e.id === 'contents')?.on).toBe(true)
  })
})

// New in this pass (design item 1): the bottom band's own occupant switcher merges into this bar,
// so cli/shell must light for the BOTTOM slot too, or the band's own occupant would show no lit tab.
describe('cli/shell — lit in EITHER slot (owner: the band merges into this bar)', () => {
  test('cli lit as the bottom band\'s own occupant, nothing on the right', () => {
    const entries = panelBarEntries(null, 'cli', OPEN)
    expect(entries.find(e => e.id === 'cli')?.on).toBe(true)
    expect(entries.find(e => e.id === 'shell')?.on).toBe(false)
  })

  test('shell lit as the bottom band\'s own occupant', () => {
    const entries = panelBarEntries(null, 'shell', OPEN)
    expect(entries.find(e => e.id === 'shell')?.on).toBe(true)
  })

  test('cli lit when moved to the right instead, bottom showing something else', () => {
    const entries = panelBarEntries('cli', 'shell', OPEN)
    const lit = entries.filter(e => e.on).map(e => e.id).sort()
    expect(lit).toEqual(['cli', 'shell'])
  })
})

describe('studio — lit in EITHER slot, tagged with where it sits', () => {
  test('studio in the right slot: on, tagged "side"', () => {
    const entries = panelBarEntries('studio', null, OPEN)
    const studio = entries.find(e => e.id === 'studio')
    expect(studio).toEqual({ id: 'studio', on: true, studioAt: 'side' })
  })

  test('studio in the bottom slot, nothing on the right: on, tagged "bottom"', () => {
    const entries = panelBarEntries(null, 'studio', OPEN)
    const studio = entries.find(e => e.id === 'studio')
    expect(studio).toEqual({ id: 'studio', on: true, studioAt: 'bottom' })
  })

  test('studio shown nowhere: off, no tag', () => {
    const entries = panelBarEntries('contents', null, OPEN)
    const studio = entries.find(e => e.id === 'studio')
    expect(studio).toEqual({ id: 'studio', on: false })
  })

  // The one case two entries may read `on` at once for studio (design item 1): Studio docked at the
  // bottom while another panel occupies the right slot.
  test('studio at the bottom AND contents on the right: BOTH lit', () => {
    const entries = panelBarEntries('contents', 'studio', OPEN)
    const lit = entries.filter(e => e.on)
    expect(lit.map(e => e.id).sort()).toEqual(['contents', 'studio'])
    expect(entries.find(e => e.id === 'studio')?.studioAt).toBe('bottom')
  })

  // Exhaustive: every (rightOccupant, bottomOccupant) combination a real `SlotLayout` can produce —
  // a panel sits in at most one slot, so `right` and `bottom` are never the SAME id (except both
  // `null`). cli/shell/studio may each light from either side; contents/hardware only from the right
  // (a bottom occupant of either never occurs in a real layout, covered defensively above).
  const PANELS = ['contents', 'studio', 'cli', 'shell', 'hardware'] as const
  test('exhaustive: every entry\'s `on` matches its own either-slot/right-only rule', () => {
    for (const right of [...PANELS, null]) {
      for (const bottom of [...PANELS, null]) {
        if (right !== null && bottom !== null && right === bottom) continue // impossible in a real layout
        const entries = panelBarEntries(right, bottom, OPEN)
        const studio = entries.find(e => e.id === 'studio')
        if (right === 'studio') expect(studio).toMatchObject({ on: true, studioAt: 'side' })
        else if (bottom === 'studio') expect(studio).toMatchObject({ on: true, studioAt: 'bottom' })
        else if (studio) expect(studio.on).toBe(false)
        for (const e of entries) {
          if (e.id === 'studio') continue
          expect(e.on).toBe(right === e.id || bottom === e.id)
        }
      }
    }
  })
})

describe('bandBarCompact — the bar\'s own measured width, never the window\'s', () => {
  test('unmeasured (0) reads as WIDE, never compact', () => {
    expect(bandBarCompact(0)).toBe(false)
  })
  test('below the breakpoint is compact', () => {
    expect(bandBarCompact(1099)).toBe(true)
    expect(bandBarCompact(600)).toBe(true)
  })
  test('at or above the breakpoint is not compact', () => {
    expect(bandBarCompact(1100)).toBe(false)
    expect(bandBarCompact(1440)).toBe(false)
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
