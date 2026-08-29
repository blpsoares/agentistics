/**
 * SessionTerminal — the xterm.js emulator that renders one terminal frame.
 *
 * This module statically imports `@xterm/xterm` (and its CSS), and is itself loaded through
 * `React.lazy` by the card, so the emulator's weight lands in its OWN chunk — downloaded only when
 * a viewer actually opens a terminal, never on the initial dashboard load.
 *
 * Each `frame` from the channel is a COMPLETE snapshot (tmux `capture-pane` already resolved every
 * spinner, redraw and cursor move into final glyphs), so rendering is `reset()` then `write()` — we
 * never append. The cursor is placed from the frame's own `cursor` field and hidden entirely on a
 * dead frame, because the channel sends `cursor: null` once the pane is dead and a cursor blinking
 * on a finished screen is exactly the "looks alive" lie this feature must not tell.
 *
 * FIDELITY vs the box — the fix for the "scattered words" bug. The frame was captured at the pane's
 * OWN width (`f.cols`, routinely 157/200+) and every line is already hard-broken at that width by
 * tmux. Rendering it into an emulator of ANY other column count reflows those lines and scatters the
 * text — so the emulator is always resized to EXACTLY `f.cols × f.rows` and never fitted to the box.
 * A 157-column grid does not fit a card, so instead of reflowing (wrong) or clipping to a scroll
 * window (what read as broken), the whole grid is SCALED to the box with a CSS transform: the layout
 * stays byte-for-byte what `capture-pane` drew, only smaller. `transform` is visual only — it never
 * changes the buffer's column count — so nothing wraps.
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
  /** Display multiplier from the zoom control. Scales the PIXELS only — never the column count — so
   *  a bigger font can never reflow the capture. Above the fit-to-box scale the box scrolls. */
  zoom?: number
}

const FONT_SIZE = 13
/** The smallest cell the fit will shrink a wide pane to before it lets the box scroll instead — a
 *  readability floor, so a 200-column pane in a narrow card is small but never a 3px smear. */
const MIN_FIT_SCALE = 9 / FONT_SIZE
const FONT_FAMILY =
  "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace"

/**
 * Has the renderer measured its cell dimensions yet? `resize()` schedules a viewport sync that reads
 * `renderService.dimensions`, and doing that before the first measured render (or after dispose)
 * throws asynchronously — uncatchable by try/catch, and a site-origin console error. So every resize
 * is gated on this being true, read defensively off xterm's core so a version bump degrades to "not
 * ready" rather than crashing.
 */
function dimensionsReady(term: Terminal): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rs = (term as any)?._core?._renderService
    const cell = rs?.dimensions?.css?.cell
    return typeof cell?.width === 'number' && cell.width > 0
  } catch {
    return false
  }
}

/**
 * The emulator's true unscaled pixel size — `cols × rows` times the measured cell — read from
 * xterm's OWN dimensions, never from `.xterm`'s `offsetWidth`. The `.xterm` element has no intrinsic
 * width and collapses to a few pixels while its `.xterm-screen` child overflows to the real size; a
 * fit that measured the collapsed element computed `scale(1)` and let a 252-column pane overflow a
 * narrow box unscaled — the exact scattered rendering. Falls back to the element only if the private
 * dimensions cannot be read.
 */
function naturalSize(term: Terminal): { w: number; h: number } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const css = (term as any)?._core?._renderService?.dimensions?.css
    const cw = css?.cell?.width
    const ch = css?.cell?.height
    if (typeof cw === 'number' && cw > 0 && typeof ch === 'number' && ch > 0) {
      return { w: term.cols * cw, h: term.rows * ch }
    }
  } catch { /* fall through to the element measurement */ }
  const el = term.element
  if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return { w: el.offsetWidth, h: el.offsetHeight }
  return null
}

export default function SessionTerminal({ frame, theme, showCursor, zoom = 1 }: Props) {
  // boxRef is the fixed viewport the parent sizes; scaleRef takes the SCALED footprint so the page
  // lays out correctly; hostRef holds the emulator at its natural cols×rows pixels and is the thing
  // the transform shrinks.
  const boxRef = useRef<HTMLDivElement | null>(null)
  const scaleRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const readyRef = useRef(false)
  const disposedRef = useRef(false)
  // The geometry last applied to the emulator; a resize runs only when it actually changes, so a
  // steady stream of same-size frames never re-triggers the viewport sync that can throw.
  const geomRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 })
  // The latest frame + cursor intent, so the ready-gate can paint whatever is current once xterm
  // has measured itself, even if several frames arrived during that first animation frame.
  const pendingRef = useRef<{ frame: TerminalFrame | null; showCursor: boolean }>({ frame: null, showCursor: false })
  // The latest zoom, so `fit()` (called from the ResizeObserver and the paint callback, not only on
  // a zoom change) always uses the current multiplier.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  /**
   * Fit the natural cols×rows grid into the box by scaling the PIXELS — never by resizing the
   * buffer, so the column count (and therefore the line breaks) never change.
   *
   * The base is fit-to-WIDTH, so every column is shown; it is never enlarged past 1:1, and never
   * shrunk below a readability floor (a very wide pane then scrolls horizontally instead of becoming
   * an unreadable smear). The user's zoom multiplies that base — above what the box holds, the box
   * simply scrolls. At every scale the bytes on screen are exactly what `capture-pane` drew.
   */
  function fit() {
    const box = boxRef.current
    const host = hostRef.current
    const scale = scaleRef.current
    const term = termRef.current
    if (!box || !host || !scale || !term?.element) return
    const nat = naturalSize(term)
    if (!nat) return
    const { w: natW, h: natH } = nat
    // Pin the host to the emulator's true size so `.xterm` cannot collapse and the transform scales
    // the whole grid rather than an overflowing sliver.
    host.style.width = `${natW}px`
    host.style.height = `${natH}px`
    const availW = box.clientWidth
    if (!availW) return
    const fitWidth = availW / natW
    const base = Math.min(1, Math.max(MIN_FIT_SCALE, fitWidth))
    const s = base * zoomRef.current
    host.style.transform = `scale(${s})`
    host.style.transformOrigin = 'top left'
    scale.style.width = `${Math.ceil(natW * s)}px`
    scale.style.height = `${Math.ceil(natH * s)}px`
  }

  function paint() {
    const term = termRef.current
    const { frame: f, showCursor: cur } = pendingRef.current
    if (!term || disposedRef.current || !readyRef.current || !f) return

    // EXACTLY the pane's geometry — the one column count at which its lines do not reflow — but only
    // when it CHANGED and the renderer has measured, so a resize never schedules a viewport sync it
    // is not ready for (the async `dimensions` throw). If it is not ready this frame, skip the
    // resize and paint at the current size; the next frame, or the ready-gate, catches up.
    if (f.cols > 0 && f.rows > 0 && (f.cols !== geomRef.current.cols || f.rows !== geomRef.current.rows) && dimensionsReady(term)) {
      try {
        term.resize(f.cols, f.rows)
        geomRef.current = { cols: f.cols, rows: f.rows }
      } catch {
        /* geometry can momentarily disagree with the DOM; the next frame corrects it */
      }
    }

    term.reset()
    term.write(f.content, () => {
      // The write callback fires asynchronously; the terminal may have been disposed since (the
      // accordion collapsed, the id changed). Writing to a disposed terminal throws, so bail.
      if (disposedRef.current || termRef.current !== term) return
      // After the content is laid out, place (or hide) the block cursor. Done in the write callback
      // so it lands after xterm has parsed the snapshot, not racing it.
      if (cur && f.cursor) {
        term.write(`\x1b[?25h\x1b[${f.cursor.y + 1};${f.cursor.x + 1}H`)
      } else {
        term.write('\x1b[?25l')
      }
      // Re-fit AFTER the write settles — the grid's natural size is only final once the new
      // geometry has rendered.
      fit()
    })
  }

  // Create the emulator once.
  //
  // `open()` is deferred to a `requestAnimationFrame`, and the terminal is not even constructed until
  // it fires. Under React StrictMode (dev) an effect is mounted, unmounted and re-mounted in the same
  // tick; opening synchronously meant the FIRST terminal was disposed a moment after `open()`
  // scheduled xterm's own viewport sync, and that scheduled callback then read `dimensions` off a
  // torn-down render service — the uncatchable async `dimensions` throw, once per mount. Deferring
  // open past the rAF means the throwaway StrictMode mount is cancelled BEFORE anything is opened, so
  // nothing is ever scheduled against a terminal that is about to die.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    disposedRef.current = false

    let fallback: ReturnType<typeof setInterval> | null = null
    let ro: ResizeObserver | null = null
    let disposeRender: { dispose: () => void } | null = null
    const stopFallback = () => { if (fallback) { clearInterval(fallback); fallback = null } }

    // Gate the first paint on the renderer having actually MEASURED its cells — not merely on a
    // render event firing, since an early render can precede the measurement and a resize then throws
    // asynchronously. `onRender` retries this on every frame until the measurement lands; a timed
    // fallback re-checks in case it never fires while the box is briefly hidden, and stops itself
    // once ready so it is not a forever-timer.
    const markReady = () => {
      if (readyRef.current || disposedRef.current) return
      const term = termRef.current
      if (!term || !dimensionsReady(term)) return
      readyRef.current = true
      stopFallback()
      paint()
    }
    // Every render can change the emulator's natural size — a `resize()` to a new column count only
    // reflows the DOM on xterm's OWN next render, AFTER the paint that requested it. So the fit runs
    // on `onRender` (once ready), not merely in the write callback: otherwise a 240-column pane is
    // measured at its OLD width and left unscaled, overflowing the box. That is the exact "wrong
    // width" the scattered rendering came from.
    const onRender = () => { markReady(); if (readyRef.current) fit() }

    const raf = requestAnimationFrame(() => {
      if (disposedRef.current) return
      const term = new Terminal({
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE,
        // Read-only: Phase 1 has no write channel, so the terminal accepts no input at all. A cursor
        // is drawn for fidelity, but nothing typed here reaches the session.
        disableStdin: true,
        cursorBlink: false,
        cursorStyle: 'block',
        scrollback: 5000,
        // The frame separates its already-hard-wrapped lines with a bare LF and carries NO carriage
        // return (tmux `capture-pane -p` emits `\n`, never `\r\n`). With `convertEol: false` xterm
        // treats each LF as a line-feed ONLY — the cursor drops a row but keeps its COLUMN — so every
        // line is drawn starting at the previous line's end column, the columns accumulate, and a
        // wide pane scatters across the grid (the exact "fragments at arbitrary positions" bug). EOL
        // conversion makes each LF a CR+LF, returning to column 0, so the layout is byte-for-byte
        // what `capture-pane` drew. This is what the transform-scale fidelity actually depends on.
        convertEol: true,
        theme: xtermTheme(theme),
      })
      termRef.current = term
      disposeRender = term.onRender(onRender)
      term.open(host)
      fallback = setInterval(markReady, 60)

      // Re-fit whenever the BOX changes width (accordion open, window resize) OR the emulator's own
      // natural size changes (a resize to a new column count). `hostRef` wraps the emulator and is
      // transformed, but `transform` does not affect its reported content size, so observing it
      // catches every geometry change without feeding back on itself.
      ro = new ResizeObserver(() => { if (!disposedRef.current) fit() })
      if (boxRef.current) ro.observe(boxRef.current)
      if (hostRef.current) ro.observe(hostRef.current)
    })

    return () => {
      // Mark disposed FIRST, so a pending onRender / ResizeObserver callback becomes a no-op rather
      // than touching a terminal that is being torn down.
      disposedRef.current = true
      cancelAnimationFrame(raf)
      stopFallback()
      ro?.disconnect()
      disposeRender?.dispose()
      readyRef.current = false
      geomRef.current = { cols: 0, rows: 0 }
      if (termRef.current) { termRef.current.dispose(); termRef.current = null }
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

  // Re-fit when the zoom changes — only the scale moves, never the buffer, so nothing reflows.
  useEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  return (
    <div
      ref={boxRef}
      // The box the parent sizes. At the default zoom the grid is fit to the box width, so it does
      // not scroll; zoomed in past the box it scrolls INSIDE here rather than pushing the page
      // sideways (the repo's responsive rule). The buffer is untouched, so scrolling never reflows.
      style={{ width: '100%', height: '100%', overflow: 'auto' }}
    >
      <div ref={scaleRef}>
        <div ref={hostRef} />
      </div>
    </div>
  )
}
