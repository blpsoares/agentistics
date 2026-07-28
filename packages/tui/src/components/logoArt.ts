/**
 * logoArt.ts — the AGENTISTICS logo, generated from the exported ANSI art.
 *
 * The palette is a HORIZONTAL ramp: a glyph's colour is a function of its COLUMN alone. This was
 * verified against the export — all 113 columns carry one colour each, identical on every row —
 * running red #cd3131 on the left to yellow #e5e510 on the right, as a linear interpolation
 * accurate to within one 8-bit step.
 *
 * Only the GLYPHS are stored. Colour is derived by `rampAt`, so there is a single source of
 * truth: an earlier version baked colours into the data as well, and the two disagreed by one
 * step wherever the two languages' rounding rules differed.
 *
 * 9 rows x 113 columns — wider than a normal terminal, so `Logo` only uses this when it fits.
 */

/** Leftmost colour of the ramp. */
export const LOGO_FROM = { r: 0xcd, g: 0x31, b: 0x31 }
/** Rightmost colour of the ramp. */
export const LOGO_TO = { r: 0xe5, g: 0xe5, b: 0x10 }

const hex = (n: number) => n.toString(16).padStart(2, '0')

/** Colour at position `t` (0..1) along the logo ramp. Pure; clamps hostile input. */
export function rampAt(t: number): string {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  const mix = (a: number, b: number) => Math.round(a + (b - a) * clamped)
  return `#${hex(mix(LOGO_FROM.r, LOGO_TO.r))}${hex(mix(LOGO_FROM.g, LOGO_TO.g))}${hex(mix(LOGO_FROM.b, LOGO_TO.b))}`
}

export const LOGO_ART: string[] = [
  "      \u2591\u2588\u2588\u2588\u2588                                                \u2591\u2588\u2588\u2588\u2588                      \u2591\u2588\u2588\u2588\u2588                      ",
  "    \u2591\u2588\u2588\u2588\u2588\u2588\u2588                                                \u2591\u2588\u2588\u2588\u2588                      \u2591\u2588\u2588\u2588\u2588                      ",
  "    \u2591\u2588\u2588\u2588\u2588\u2588\u2588      \u2591\u2588\u2588\u2588\u2588\u2588\u2588      \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588   \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       \u2591\u2588\u2588\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       \u2591\u2588\u2588\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588\u2588\u2588  ",
  "    \u2591\u2588\u2588 \u2591\u2588\u2588    \u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588",
  "  \u2591\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588      \u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588        \u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588      \u2591\u2588\u2588\u2588\u2588      ",
  "  \u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588        \u2591\u2588\u2588\u2588\u2588\u2588\u2588  ",
  "\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588      \u2591\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588            \u2591\u2588\u2588\u2588\u2588",
  "\u2591\u2588\u2588\u2588\u2588     \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588   \u2591\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588 \u2591\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2591\u2588\u2588\u2588\u2588     \u2591\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588     \u2591\u2588\u2588  \u2591\u2588\u2588        \u2591\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588    \u2591\u2588\u2588        \u2591\u2588\u2588  \u2591\u2588\u2588\u2588\u2588\u2588\u2588    \u2591\u2588\u2588\u2588\u2588\u2588\u2588  ",
]

export const LOGO_WIDTH = 113

/** One drawable run: `t` is the text, `c` its colour (absent = uncoloured whitespace). */
export interface LogoSegment {
  t: string
  c?: string
}

/**
 * Splits a row into drawable runs: whitespace merged and uncoloured, each visible glyph carrying
 * the colour of its own column. Pure, and done once at module load rather than per frame.
 */
export function buildSegments(row: string, width = LOGO_WIDTH): LogoSegment[] {
  const segs: LogoSegment[] = []
  let buf = ''
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!
    if (ch === ' ') {
      buf += ch
      continue
    }
    if (buf) {
      segs.push({ t: buf })
      buf = ''
    }
    segs.push({ t: ch, c: rampAt(i / Math.max(1, width - 1)) })
  }
  if (buf) segs.push({ t: buf })
  return segs
}

export const LOGO_SEGMENTS: LogoSegment[][] = LOGO_ART.map(row => buildSegments(row))
