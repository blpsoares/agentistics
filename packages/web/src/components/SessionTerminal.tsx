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
 *
 * Timing: `resize()` throws asynchronously inside xterm if it runs before the renderer has measured
 * its cell dimensions (an unmeasured `Viewport.syncScrollArea` reads `dimensions` off `undefined`),
 * and a `try/catch` cannot catch that — the throw is scheduled, not synchronous. The renderer
 * measures on its FIRST render, so we gate the first paint on xterm's own `onRender` event (with a
 * timeout as a belt-and-braces fallback). Frames that arrive before then are held and painted on
 * ready.
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
  const readyRef = useRef(false)
  // The latest frame + cursor intent, so the ready-gate can paint whatever is current once xterm
  // has measured itself, even if several frames arrived during that first animation frame.
  const pendingRef = useRef<{ frame: TerminalFrame | null; showCursor: boolean }>({ frame: null, showCursor: false })

  function paint() {
    const term = termRef.current
    const { frame: f, showCursor: cur } = pendingRef.current
    if (!term || !readyRef.current || !f) return

    if (f.cols > 0 && f.rows > 0) {
      try {
        term.resize(f.cols, f.rows)
      } catch {
        /* geometry can momentarily disagree with the DOM; the next frame corrects it */
      }
    }

    term.reset()
    term.write(f.content, () => {
      // After the content is laid out, place (or hide) the block cursor. Done in the write callback
      // so it lands after xterm has parsed the snapshot, not racing it.
      if (cur && f.cursor) {
        term.write(`\x1b[?25h\x1b[${f.cursor.y + 1};${f.cursor.x + 1}H`)
      } else {
        term.write('\x1b[?25l')
      }
    })
  }

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
    termRef.current = term

    // Gate the first paint on the renderer having measured its cells (its first render). Registered
    // BEFORE open() so the initial render is caught; a timeout is the fallback if it never fires.
    const markReady = () => {
      if (readyRef.current) return
      readyRef.current = true
      paint()
    }
    const disposeRender = term.onRender(markReady)
    term.open(host)
    const fallback = setTimeout(markReady, 80)

    return () => {
      clearTimeout(fallback)
      disposeRender.dispose()
      readyRef.current = false
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the palette in step with the dashboard theme. Updating `options.theme` recolours future
  // output but does not repaint what is already on screen, so a theme flip would leave the current
  // frame blank until the next one arrived — re-paint it now so the switch is instant.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = xtermTheme(theme)
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  // Paint each frame as a full snapshot (held until the ready-gate opens on first mount).
  useEffect(() => {
    pendingRef.current = { frame, showCursor }
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
