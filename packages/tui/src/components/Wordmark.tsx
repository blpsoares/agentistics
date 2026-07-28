import React from 'react'
import { Box, Text } from 'ink'
import { COLORS } from '../theme'

/**
 * The AGENTISTICS wordmark, carried over from the original `agentop start` banner.
 *
 * Rendered per-character with a horizontal amber gradient rather than one flat color — the
 * block glyphs are solid enough that a single hue reads as a slab, while the ramp gives the
 * letters depth. Falls back to plain text on a terminal too narrow to hold the art, so the
 * banner degrades instead of wrapping into noise.
 */

const ART = [
  '▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀ █ █▀ ▀█▀ █ █▀▀ █▀',
  '█▀█ █▄█ ██▄ █░▀█ ░█░ █ ▄█ ░█░ █ █▄▄ ▄█',
] as const

export const WORDMARK_WIDTH = Math.max(...ART.map(l => l.length))

/** Light amber → deep amber. Both ends stay legible on light and dark terminals. */
const FROM = { r: 0xfb, g: 0xbf, b: 0x24 }
const TO = { r: 0xd9, g: 0x77, b: 0x06 }

const hex = (n: number) => n.toString(16).padStart(2, '0')

/** Colour at position `t` (0..1) along the ramp. Pure — exported for tests. */
export function gradientAt(t: number): string {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  const mix = (a: number, b: number) => Math.round(a + (b - a) * clamped)
  return `#${hex(mix(FROM.r, TO.r))}${hex(mix(FROM.g, TO.g))}${hex(mix(FROM.b, TO.b))}`
}

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
        <Text key={row} bold>
          {[...line].map((ch, i) => (
            <Text key={i} color={gradientAt(i / Math.max(1, line.length - 1))}>{ch}</Text>
          ))}
        </Text>
      ))}
      {tagline ? <Text dimColor>{tagline}</Text> : null}
    </Box>
  )
}
