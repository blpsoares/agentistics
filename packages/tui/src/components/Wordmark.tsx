import React from 'react'
import { Box, Text } from 'ink'
import { COLORS } from '../theme'

/**
 * The AGENTISTICS wordmark, carried over from the original `agentop start` banner.
 *
 * One flat accent orange — the same `COLORS.accent` the rest of the TUI uses, so the title reads
 * as part of the app rather than as its own artwork. Falls back to plain text on a terminal too
 * narrow to hold the art, so the banner degrades instead of wrapping into noise.
 */

/**
 * The two-line block art, exported so the control center's header can MEASURE it.
 *
 * `chrome.ts` derives the width at which the header degrades to the one-line mark from this array
 * rather than from a column count written down beside it: the art is 38 columns today, and a
 * threshold that repeated that number would silently stop matching the art the day a letter moved.
 */
export const WORDMARK_ART: readonly string[] = [
  '▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀ █ █▀ ▀█▀ █ █▀▀ █▀',
  '█▀█ █▄█ ██▄ █░▀█ ░█░ █ ▄█ ░█░ █ █▄▄ ▄█',
] as const

const ART = WORDMARK_ART

export const WORDMARK_WIDTH = Math.max(...ART.map(l => l.length))

export function Wordmark({ tagline, width }: { tagline?: string; width: number }) {
  if (width < WORDMARK_WIDTH) {
    return (
      <Box flexDirection="column">
        <Text bold color={COLORS.accent}>agentistics</Text>
        {tagline ? <Text dimColor>{tagline}</Text> : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {ART.map((line, row) => (
        <Text key={row} bold color={COLORS.accent}>{line}</Text>
      ))}
      {tagline ? <Text dimColor>{tagline}</Text> : null}
    </Box>
  )
}

/**
 * The one-line form of the same identity: a brand MARK, then the name.
 *
 * The control center's header is one row, so what goes in it has to be a title rather than artwork.
 * It used to be `A G E N T I S T I C S` — the name letter-spaced to read as a mark — which spends
 * twenty-one columns on eleven characters and still reads as a word someone stretched. The two
 * triangles are a mark: they carry the identity in two columns, in accent, and leave the name to be
 * a name.
 *
 * The palette rule holds — the MARK is the only part that is colored; the word is bold and takes
 * the text color like every other title in the app.
 *
 * Degrades as a mark rather than as a string: full form, then the mark alone (still the identity),
 * then whatever of the mark fits. It is a separate export from `Wordmark` because the dashboard TUI
 * still opens on the two-line block and has the rows to afford it.
 */
const MARK = '◢◣'
const WORD = 'agentistics'

/**
 * The columns the mark alone takes.
 *
 * Exported so the header can RESERVE them before it fits anything else. It used to hand the mark
 * whatever the right-hand tag left over, and in Portuguese member mode at twenty-eight columns
 * that was nothing — a frame whose title row named the version and not the application.
 */
export const MARK_WIDTH = MARK.length

/** The two colored runs of the title. Either may be empty on a terminal too narrow for it. */
export interface BrandMark {
  /** The accent glyph. */
  mark: string
  /** The name, bold. Empty once the row can only afford the mark. */
  word: string
}

/**
 * The title as it should be drawn at `width` columns.
 *
 * Pure, and total: `brandWidth(brandMark(w)) <= w` for every `w`, which is what lets the header
 * budget the right-hand tag first and hand the mark whatever is left without a second guarantee.
 */
export function brandMark(width: number): BrandMark {
  if (width >= MARK.length + 1 + WORD.length) return { mark: MARK, word: WORD }
  if (width >= MARK.length) return { mark: MARK, word: '' }
  // Sliced, never ellipsised: a mark is glyphs, and `…` in place of a triangle says nothing at all.
  return { mark: MARK.slice(0, Math.max(0, width)), word: '' }
}

/** Columns `brandMark` occupies, the separating space included. */
export function brandWidth(brand: BrandMark): number {
  return brand.mark.length + (brand.word ? 1 + brand.word.length : 0)
}
