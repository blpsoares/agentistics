import { describe, expect, test } from 'bun:test'
import { headerSwitcherEntries, type HeaderSwitcherGates } from './sessionHeaderSwitcher'

const OPEN: HeaderSwitcherGates = {
  editorEnabled: true, shellEnabled: true, relayed: false, hardwareOffered: true,
}

describe('headerSwitcherEntries — order and presence', () => {
  test('every gate open: all five, in the fixed order', () => {
    const entries = headerSwitcherEntries(null, OPEN)
    expect(entries.map(e => e.id)).toEqual(['contents', 'studio', 'cli', 'shell', 'hardware'])
  })

  test('contents is never gated — always present', () => {
    const entries = headerSwitcherEntries(null, {
      editorEnabled: false, shellEnabled: false, relayed: true, hardwareOffered: false,
    })
    expect(entries.map(e => e.id)).toEqual(['contents'])
  })

  test('studio absent when editorEnabled is off — never greyed, simply not there', () => {
    const entries = headerSwitcherEntries(null, { ...OPEN, editorEnabled: false })
    expect(entries.some(e => e.id === 'studio')).toBe(false)
  })

  test('cli and shell absent on a relayed session', () => {
    const entries = headerSwitcherEntries(null, { ...OPEN, relayed: true })
    expect(entries.map(e => e.id)).toEqual(['contents', 'studio', 'hardware'])
  })

  test('shell absent when shellEnabled is off, cli untouched', () => {
    const entries = headerSwitcherEntries(null, { ...OPEN, shellEnabled: false })
    expect(entries.map(e => e.id)).toEqual(['contents', 'studio', 'cli', 'hardware'])
  })

  test('hardware absent when not offered (a central)', () => {
    const entries = headerSwitcherEntries(null, { ...OPEN, hardwareOffered: false })
    expect(entries.some(e => e.id === 'hardware')).toBe(false)
  })

  test('EXACTLY ONE entry is on at a time — the active panel, and no other', () => {
    for (const active of ['contents', 'studio', 'cli', 'shell', 'hardware'] as const) {
      const entries = headerSwitcherEntries(active, OPEN)
      const lit = entries.filter(e => e.on)
      expect(lit).toHaveLength(1)
      expect(lit[0]?.id).toBe(active)
    }
  })

  test('nothing active: every entry reads off — never a confident default', () => {
    const entries = headerSwitcherEntries(null, OPEN)
    expect(entries.every(e => !e.on)).toBe(true)
  })

  // Plant-and-restore: this is the exact regression the design calls out (screenshot 3) — TWO
  // entries lit because the caller passed the WRONG active panel (or forgot to gate it through
  // `rightSlotShowing`). If `active` accidentally names a panel this function did not intend as
  // exclusive, more than one entry would read `on`. Since `active` is a single value by
  // construction, the only way this fails is a caller bug — which is exactly why every reader must
  // go through `rightSlotShowing`/`isPanelShown` rather than compare its own flag.
  test('a panel absent from this gate set is simply never lit even if named active', () => {
    const entries = headerSwitcherEntries('studio', { ...OPEN, editorEnabled: false })
    expect(entries.every(e => !e.on)).toBe(true)
  })
})
