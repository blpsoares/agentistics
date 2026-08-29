/**
 * SessionTerminal — the xterm.js emulator that renders one terminal frame.
 *
 * This module statically imports `@xterm/xterm` (and its CSS), and is itself loaded through
 * `React.lazy` by the panel, so the emulator's weight lands in its OWN chunk — downloaded only when
 * a viewer actually opens a terminal, never on the initial dashboard load.
 *
 * Each `frame` from the channel is a COMPLETE snapshot (tmux `capture-pane` already resolved every
 * spinner, redraw and cursor move into final glyphs), so rendering is `reset()` then `write()` — we
 * never append. The cursor is placed from the frame's own `cursor` field and hidden entirely on a
 * dead frame, because the channel sends `cursor: null` once the pane is dead and a cursor blinking
 * on a finished screen is exactly the "looks alive" lie this feature must not tell.
 */

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { xtermTheme, type TerminalFrame } from '../lib/terminalStream'

interface Props {
  frame: TerminalFrame | null
  theme: 'dark' | 'light'
  /** Draw the block cursor at the frame's position. False on a finished/gone screen. */
  showCursor: boolean
}

const FONT_SIZE = 12
const FONT_FAMILY =
  "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace"

export default function SessionTerminal({ frame, theme, showCursor }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)

  // Create the emulator once.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      // Read-only: Phase 1 has no write channel, so the terminal accepts no input at all. A cursor
      // is drawn for fidelity, but nothing typed here reaches the session.
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: 'block',
      scrollback: 5000,
      convertEol: false,
      theme: xtermTheme(theme),
    })
    term.open(host)
    termRef.current = term
    return () => {
      term.dispose()
      termRef.current = null
    }
  }, [])

  // Keep the palette in step with the dashboard theme.
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = xtermTheme(theme)
  }, [theme])

  // Paint each frame as a full snapshot.
  useEffect(() => {
    const term = termRef.current
    if (!term || !frame) return

    if (frame.cols > 0 && frame.rows > 0) {
      try {
        term.resize(frame.cols, frame.rows)
      } catch {
        /* geometry can momentarily disagree with the DOM; the next frame corrects it */
      }
    }

    term.reset()
    term.write(frame.content, () => {
      // After the content is laid out, place (or hide) the block cursor. Done in the write callback
      // so it lands after xterm has parsed the snapshot, not racing it.
      if (showCursor && frame.cursor) {
        term.write(`\x1b[?25h\x1b[${frame.cursor.y + 1};${frame.cursor.x + 1}H`)
      } else {
        term.write('\x1b[?25l')
      }
    })
  }, [frame, showCursor])

  return (
    <div
      ref={hostRef}
      // The pane is exactly cols×rows wide; on a narrow screen it scrolls inside this box rather
      // than pushing the page body sideways (the repo's responsive rule).
      style={{ width: '100%', height: '100%', overflow: 'auto' }}
    />
  )
}
