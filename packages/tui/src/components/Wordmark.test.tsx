import React from 'react'
import { describe, test, expect } from 'bun:test'
import { render } from 'ink-testing-library'
import { Logo, WORDMARK_WIDTH } from './Wordmark'
import { LOGO_WIDTH, LOGO_SEGMENTS, rampAt } from './logoArt'

const plain = (f: string | undefined) => (f ?? '').replace(/\x1b\[[0-9;]*m/g, '')

/**
 * Tiers are identified by the glyphs unique to each: the full logo is drawn with `░█` runs,
 * the compact mark with the half-block `▄▀█` alphabet, and the fallback is plain text.
 *
 * Line counting cannot be used here — ink-testing-library's virtual stdout is fixed at 100
 * columns, so the 113-column art wraps inside the harness regardless of the width prop.
 */
// `░█` alone is not unique — the compact mark contains it inside `█▄░█`.
const FULL_ART_GLYPH = '░████'
const COMPACT_GLYPH = '▄▀█'

describe('Logo width tiers', () => {
  test('renders the full art when the terminal can hold it', () => {
    const { lastFrame } = render(<Logo width={LOGO_WIDTH} />)
    expect(plain(lastFrame())).toContain(FULL_ART_GLYPH)
  })

  test('falls back to the compact mark one column below the full art', () => {
    const out = plain(render(<Logo width={LOGO_WIDTH - 1} />).lastFrame())
    expect(out).toContain(COMPACT_GLYPH)
    expect(out).not.toContain(FULL_ART_GLYPH)
  })

  test('falls back to plain text below the compact mark width', () => {
    const out = plain(render(<Logo width={WORDMARK_WIDTH - 1} />).lastFrame())
    expect(out).toContain('agentistics')
    expect(out).not.toContain(COMPACT_GLYPH)
  })

  test('shows the tagline in every tier', () => {
    for (const width of [LOGO_WIDTH, WORDMARK_WIDTH, 10]) {
      expect(plain(render(<Logo width={width} tagline="a tagline" />).lastFrame()))
        .toContain('a tagline')
    }
  })

  test('never emits a line wider than the terminal', () => {
    // Capped at the harness's own 100-column stdout, so the assertion measures the component
    // rather than the harness's wrapping.
    for (const width of [20, 39, 60, 80, 100]) {
      const out = plain(render(<Logo width={width} tagline="tag" />).lastFrame())
      for (const line of out.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(width)
      }
    }
  })

  test('every logo row spans exactly the logo width, so the ramp cannot go ragged', () => {
    for (const row of LOGO_SEGMENTS) {
      expect(row.reduce((n, s) => n + s.t.length, 0)).toBe(LOGO_WIDTH)
    }
  })

  test('colours every visible glyph and never the whitespace', () => {
    for (const row of LOGO_SEGMENTS) {
      for (const seg of row) {
        if (seg.t.trim() === '') expect(seg.c).toBeUndefined()
        else expect(seg.c).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  test('runs the ramp HORIZONTALLY — every glyph takes the colour of its own column', () => {
    // The whole point of the fix: colour depends on x, not on the row. Walking the segments and
    // rebuilding each glyph's column proves it for all 579 glyphs at once.
    let checked = 0
    for (const row of LOGO_SEGMENTS) {
      let col = 0
      for (const seg of row) {
        if (seg.c) {
          expect(seg.c).toBe(rampAt(col / (LOGO_WIDTH - 1)))
          checked++
        }
        col += seg.t.length
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  test('the same column is the same colour on every row', () => {
    const byColumn = new Map<number, string>()
    for (const row of LOGO_SEGMENTS) {
      let col = 0
      for (const seg of row) {
        if (seg.c) {
          const seen = byColumn.get(col)
          if (seen) expect(seg.c).toBe(seen)
          else byColumn.set(col, seg.c)
        }
        col += seg.t.length
      }
    }
    expect(byColumn.size).toBeGreaterThan(100)
  })
})
