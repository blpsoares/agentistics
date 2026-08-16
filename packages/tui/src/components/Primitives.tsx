import React from 'react'
import { Box, Text } from 'ink'
import { COLORS } from '../theme'

/** A single headline number with its label underneath. */
export function Kpi({ label, value, color, width }: {
  label: string
  value: string
  color?: string
  width?: number
}) {
  return (
    <Box flexDirection="column" width={width} marginRight={2}>
      <Text bold color={color ?? COLORS.text}>{value}</Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <Box flexDirection="row">{children}</Box>
}

/** A proportional bar. `pct` is 0..1; anything outside is clamped rather than overflowing. */
export function Bar({ pct, width, color }: { pct: number; width: number; color?: string }) {
  const safe = Number.isFinite(pct) ? Math.min(1, Math.max(0, pct)) : 0
  const filled = Math.round(safe * width)
  return (
    <Text>
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(Math.max(0, width - filled))}</Text>
    </Text>
  )
}

/** A labelled bar row: name, bar, then the value — used for harness and model shares. */
export function BarRow({ label, pct, value, color, labelWidth, barWidth }: {
  label: string
  pct: number
  value: string
  color?: string
  labelWidth: number
  barWidth: number
}) {
  return (
    <Box flexDirection="row">
      <Box width={labelWidth}><Text color={color}>{truncate(label, labelWidth - 1)}</Text></Box>
      <Box marginRight={1}><Bar pct={pct} width={barWidth} color={color} /></Box>
      <Text dimColor>{value}</Text>
    </Box>
  )
}

/** Section heading with a rule, so screens read as panels rather than a wall of rows. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={COLORS.accent}>{title}</Text>
      <Box flexDirection="column" marginTop={0}>{children}</Box>
    </Box>
  )
}

export function Empty({ message }: { message: string }) {
  return <Box marginTop={1}><Text dimColor>{message}</Text></Box>
}

/**
 * The line under a paged list: where you are, how much there IS, and the keys that move.
 *
 * The total is the point. These screens used to slice to whatever the terminal afforded and say
 * nothing about the rest, so a machine holding hundreds of sessions answered with the twenty-five
 * that happened to fit — a confident wrong number in the one place a person goes to find out. What
 * is on screen is a WINDOW, and a window that does not say so is a total.
 */
export function Pager({ window: win, total, s }: {
  window: { page: number; pages: number; from: number; to: number }
  total: number
  s: { pageOf: (page: number, pages: number) => string; showing: (from: number, to: number, total: number) => string; pagerHint: string }
}) {
  return (
    <Text dimColor>
      {s.pageOf(win.page + 1, win.pages)}
      {'  ·  '}
      {s.showing(win.from + 1, win.to, total)}
      {win.pages > 1 ? `  ·  ${s.pagerHint}` : ''}
    </Text>
  )
}

/**
 * Truncates to a visible width with an ellipsis. Terminal cells are the constraint here, and an
 * over-long project path or session title would otherwise wrap and break every row below it.
 */
export function truncate(s: string, max: number): string {
  if (max <= 0) return ''
  if (s.length <= max) return s
  if (max === 1) return '…'
  return s.slice(0, max - 1) + '…'
}

export interface Column<T> {
  key: string
  header: string
  width: number
  align?: 'left' | 'right'
  render: (row: T) => string
  color?: (row: T) => string | undefined
}

/** Each column is followed by a one-column margin. */
const COL_MARGIN = 1

const totalWidth = <T,>(cols: Column<T>[]) =>
  cols.reduce((n, c) => n + c.width + COL_MARGIN, 0)

/**
 * Fits columns to the terminal: drops them from the RIGHT until they fit, then gives the
 * remaining space to the first (identity) column.
 *
 * Columns must therefore be declared most-important-first. Without this a narrow terminal wraps
 * every row — measured at 60 columns, the Sessions table rendered 85 columns wide and each row
 * spilled onto the next line, destroying the alignment of the whole screen.
 */
export function fitColumns<T>(columns: Column<T>[], width: number): Column<T>[] {
  if (columns.length === 0) return columns
  const kept = [...columns]
  while (kept.length > 1 && totalWidth(kept) > width) kept.pop()

  const rest = totalWidth(kept.slice(1))
  const firstWidth = Math.max(8, width - rest - COL_MARGIN)
  return [{ ...kept[0]!, width: firstWidth }, ...kept.slice(1)]
}

/**
 * A fixed-width table. Ink's flexbox handles the layout, but each cell is still padded to a
 * known width so columns line up across rows regardless of content.
 */
export function DataTable<T>({ columns, rows, keyOf, highlightIndex, width }: {
  columns: Column<T>[]
  rows: T[]
  keyOf: (row: T, i: number) => string
  highlightIndex?: number
  /** Terminal width; columns that do not fit are dropped rather than wrapped. */
  width: number
}) {
  const fitted = fitColumns(columns, width)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {fitted.map(c => (
          <Box key={c.key} width={c.width} marginRight={1}>
            {/* Truncated like every cell under it. A header is not exempt: `participação` in an
                eight-column share column is fourteen characters that Ink WRAPS, which costs the
                table a second header row and pushes every result down — and the Portuguese words
                are the long ones, so it shows up in one language only. */}
            <Text dimColor bold>{pad(truncate(c.header, c.width - 1), c.width - 1, c.align)}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, i) => (
        <Box key={keyOf(row, i)} flexDirection="row">
          {fitted.map(c => (
            <Box key={c.key} width={c.width} marginRight={1}>
              <Text
                color={c.color?.(row)}
                inverse={highlightIndex === i}
              >
                {pad(truncate(c.render(row), c.width - 1), c.width - 1, c.align)}
              </Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const space = ' '.repeat(Math.max(0, width - s.length))
  return align === 'right' ? space + s : s + space
}
