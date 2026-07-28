import React from 'react'
import { Box, Text } from 'ink'
import { COLORS } from '../theme'
import { LOGO_SEGMENTS, LOGO_WIDTH, rampAt } from './logoArt'

/**
 * The AGENTISTICS logo, in three tiers chosen by terminal width.
 *
 * All tiers share ONE palette — the horizontal red-to-yellow ramp from the exported art
 * (`rampAt`). An earlier version coloured the compact mark amber and ramped it vertically, which
 * made the two marks look like different products.
 *
 * Tiers, widest first: the 113-column art, a compact two-line mark, then plain text. Drawing the
 * big art into a narrower terminal would wrap every row and turn the logo into confetti, so each
 * tier is gated on real width rather than assumed.
 */

const ART = [
  '▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀ █ █▀ ▀█▀ █ █▀▀ █▀',
  '█▀█ █▄█ ██▄ █░▀█ ░█░ █ ▄█ ░█░ █ █▄▄ ▄█',
] as const

export const WORDMARK_WIDTH = Math.max(...ART.map(l => l.length))

export { LOGO_WIDTH, rampAt }

export function Logo({ tagline, width }: { tagline?: string; width: number }) {
  if (width < LOGO_WIDTH) return <Wordmark tagline={tagline} width={width} />
  return (
    <Box flexDirection="column">
      {LOGO_SEGMENTS.map((row, y) => (
        <Text key={y}>
          {row.map((seg, i) =>
            seg.c
              ? <Text key={i} color={seg.c}>{seg.t}</Text>
              : <Text key={i}>{seg.t}</Text>,
          )}
        </Text>
      ))}
      {tagline ? <Text dimColor>{tagline}</Text> : null}
    </Box>
  )
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
            <Text key={i} color={rampAt(i / Math.max(1, line.length - 1))}>{ch}</Text>
          ))}
        </Text>
      ))}
      {tagline ? <Text dimColor>{tagline}</Text> : null}
    </Box>
  )
}
