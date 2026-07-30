import { describe, test, expect } from 'bun:test'
import { COPY, PLURAL_COPY, plural, interpolate } from './copy'

/** Every `{word}` placeholder token found in a string, deduped. */
function placeholders(s: string): Set<string> {
  return new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1] ?? ''))
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

describe('COPY — plain rows', () => {
  const rows = Object.entries(COPY)

  test('has at least one row', () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  test('every en key exists in pt and vice versa', () => {
    for (const [, entry] of rows) {
      expect(entry).toHaveProperty('en')
      expect(entry).toHaveProperty('pt')
    }
  })

  test('no row has an empty en or pt string', () => {
    let checked = 0
    for (const [, entry] of rows) {
      expect(entry.en.length).toBeGreaterThan(0)
      expect(entry.pt.length).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBe(rows.length)
  })

  test('placeholder parity: the {…} tokens in en match those in pt, for every row', () => {
    let checked = 0
    for (const [, entry] of rows) {
      const enPh = placeholders(entry.en)
      const ptPh = placeholders(entry.pt)
      expect(sameSet(enPh, ptPh)).toBe(true)
      checked++
    }
    expect(checked).toBe(rows.length)
  })
})

describe('PLURAL_COPY — {one, other} rows', () => {
  const rows = Object.entries(PLURAL_COPY)

  test('has at least one row', () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  test('every row has one and other in both languages, all non-empty', () => {
    let checked = 0
    for (const [, entry] of rows) {
      expect(entry.en.one.length).toBeGreaterThan(0)
      expect(entry.en.other.length).toBeGreaterThan(0)
      expect(entry.pt.one.length).toBeGreaterThan(0)
      expect(entry.pt.other.length).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBe(rows.length)
  })

  test('placeholder parity holds for the one form and for the other form independently', () => {
    let checked = 0
    for (const [, entry] of rows) {
      expect(sameSet(placeholders(entry.en.one), placeholders(entry.pt.one))).toBe(true)
      expect(sameSet(placeholders(entry.en.other), placeholders(entry.pt.other))).toBe(true)
      checked++
    }
    expect(checked).toBe(rows.length)
  })
})

describe('plural()', () => {
  const entry = { one: 'one thing', other: 'many things' }

  test('picks one at n === 1', () => {
    expect(plural(entry, 1)).toBe('one thing')
  })

  test('picks other at n === 0', () => {
    expect(plural(entry, 0)).toBe('many things')
  })

  test('picks other at n === 2', () => {
    expect(plural(entry, 2)).toBe('many things')
  })
})

describe('interpolate()', () => {
  test('substitutes a single placeholder', () => {
    expect(interpolate('last sync {t}', { t: '2m ago' })).toBe('last sync 2m ago')
  })

  test('substitutes multiple distinct placeholders', () => {
    expect(interpolate('Removes {sessions} sessions (~{cost}) from this central.', { sessions: 12, cost: '$0.40' }))
      .toBe('Removes 12 sessions (~$0.40) from this central.')
  })

  test('leaves an unmatched placeholder untouched rather than throwing', () => {
    expect(interpolate('{known} and {unknown}', { known: 'x' })).toBe('x and {unknown}')
  })
})
