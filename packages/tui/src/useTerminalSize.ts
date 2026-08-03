/**
 * useTerminalSize — terminal dimensions that follow a resize.
 *
 * Ink re-renders on state change, not on SIGWINCH, so the layout would keep the width it booted
 * with until the next data push without this. Falls back to a sane 80x24 when stdout is not a
 * TTY (piped output, CI), which keeps the width-dependent column math well-defined.
 */

import { useEffect, useState } from 'react'

export interface TerminalSize {
  columns: number
  rows: number
}

export function currentSize(): TerminalSize {
  return {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  }
}

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(currentSize)

  useEffect(() => {
    const onResize = () => setSize(currentSize())
    process.stdout.on('resize', onResize)
    return () => { process.stdout.off('resize', onResize) }
  }, [])

  return size
}
