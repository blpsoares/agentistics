import React from 'react'
import { Text } from 'ink'

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

/**
 * Renders a series as block characters. Scaling is relative to the series maximum, so the shape
 * of the rhythm is what reads — not the absolute magnitude, which the KPIs already state.
 *
 * A zero value always renders as the shortest block rather than a blank, so silent days stay
 * visible as gaps in the line instead of vanishing and compressing the timeline.
 */
export function sparkline(values: number[]): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  if (max <= 0) return BLOCKS[0]!.repeat(values.length)
  return values
    .map(v => {
      if (v <= 0) return BLOCKS[0]!
      const idx = Math.min(BLOCKS.length - 1, Math.max(0, Math.round((v / max) * (BLOCKS.length - 1))))
      return BLOCKS[idx]!
    })
    .join('')
}

export function Sparkline({ values, color }: { values: number[]; color?: string }) {
  return <Text color={color}>{sparkline(values)}</Text>
}
