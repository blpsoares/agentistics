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

const ART = [
  '▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀ █ █▀ ▀█▀ █ █▀▀ █▀',
  '█▀█ █▄█ ██▄ █░▀█ ░█░ █ ▄█ ░█░ █ █▄▄ ▄█',
] as const

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
