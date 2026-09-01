/**
 * ansi.ts — PURE. One terminal frame, rendered as HTML.
 *
 * `GET /api/fleet/stream` sends the pane as `tmux capture-pane -e` produced it: a RENDERED grid
 * with SGR escape sequences intact. tmux has already resolved the spinners, the redraws and the
 * cursor moves into final glyphs, so what is left to do is colour — no cursor arithmetic, no
 * scrollback model, no alternate buffer. That is why this is 200 lines and not a terminal emulator.
 *
 * The dashboard feeds the same frames to xterm.js. This does not, and the reason is the surface:
 * xterm is a 300 KB dependency that wants a fixed character grid and a fit addon, in a panel that
 * is routinely 300px wide and resized by dragging. What it would buy — a real cursor, an alternate
 * screen, selection — is either already resolved by `capture-pane` or is the integrated terminal's
 * job, one click away on every row. What it must NOT cost is colour fidelity, so the palette is
 * imported from the dashboard's own `xtermTheme`: the same session reads the same in both places.
 *
 * **Everything is escaped.** The content is a coding assistant's terminal output — file contents,
 * diffs, error messages, whatever it was asked to print — so it is the least trustworthy string in
 * this extension. It is escaped once, on the way in, and nothing downstream un-escapes it.
 */

import { xtermTheme, type XtermTheme } from '../../web/src/lib/terminalStream'

/** The eight ANSI colours, in code order (30-37 / 40-47), then their bright twins (90-97 / 100-107). */
const BASE: (keyof XtermTheme)[] = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
]
const BRIGHT: (keyof XtermTheme)[] = [
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
]

interface Pen {
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
}

const BLANK: Pen = {
  fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false,
}

export function escapeHtml(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The xterm 256-colour cube, as hex.
 *
 * 0-15 are the palette's own sixteen (so a 256-indexed red matches a `31` red), 16-231 the 6x6x6
 * cube, 232-255 the greyscale ramp. Computed rather than tabulated: a 256-entry literal is 256
 * chances to mistype one.
 */
function xterm256(index: number, theme: XtermTheme): string | null {
  if (index < 0 || index > 255) return null
  if (index < 8) return theme[BASE[index]!] as string
  if (index < 16) return theme[BRIGHT[index - 8]!] as string
  if (index < 232) {
    const n = index - 16
    const steps = [0, 95, 135, 175, 215, 255]
    const r = steps[Math.floor(n / 36) % 6]!
    const g = steps[Math.floor(n / 6) % 6]!
    const b = steps[n % 6]!
    return rgb(r, g, b)
  }
  const level = 8 + (index - 232) * 10
  return rgb(level, level, level)
}

function rgb(r: number, g: number, b: number): string {
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Apply one SGR sequence's parameters to the pen.
 *
 * Extended colour (`38;5;n`, `38;2;r;g;b`) consumes the parameters that follow it, which is why
 * this is an index loop and not a `for…of`: reading them as independent codes turns a truecolour
 * foreground into three unrelated attributes, one of which is usually "bright background".
 */
function applySgr(pen: Pen, params: number[], theme: XtermTheme): Pen {
  let next = { ...pen }
  for (let i = 0; i < params.length; i++) {
    const code = params[i]!
    if (code === 0) { next = { ...BLANK }; continue }
    if (code === 1) { next.bold = true; continue }
    if (code === 2) { next.dim = true; continue }
    if (code === 3) { next.italic = true; continue }
    if (code === 4) { next.underline = true; continue }
    if (code === 7) { next.inverse = true; continue }
    if (code === 22) { next.bold = false; next.dim = false; continue }
    if (code === 23) { next.italic = false; continue }
    if (code === 24) { next.underline = false; continue }
    if (code === 27) { next.inverse = false; continue }
    if (code === 39) { next.fg = null; continue }
    if (code === 49) { next.bg = null; continue }
    if (code >= 30 && code <= 37) { next.fg = theme[BASE[code - 30]!] as string; continue }
    if (code >= 40 && code <= 47) { next.bg = theme[BASE[code - 40]!] as string; continue }
    if (code >= 90 && code <= 97) { next.fg = theme[BRIGHT[code - 90]!] as string; continue }
    if (code >= 100 && code <= 107) { next.bg = theme[BRIGHT[code - 100]!] as string; continue }
    if (code === 38 || code === 48) {
      const mode = params[i + 1]
      if (mode === 5) {
        const colour = xterm256(params[i + 2] ?? -1, theme)
        if (code === 38) next.fg = colour
        else next.bg = colour
        i += 2
      } else if (mode === 2) {
        const colour = rgb(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0)
        if (code === 38) next.fg = colour
        else next.bg = colour
        i += 4
      }
      continue
    }
    // Anything else (blink, strike, fonts, the rest of SGR) is ignored rather than guessed at.
  }
  return next
}

function penStyle(pen: Pen, theme: XtermTheme): string {
  // `inverse` is resolved HERE rather than left to CSS: selected rows, diff markers and a lot of
  // TUI chrome are drawn with it, and a viewer that ignored it would render a highlighted line as
  // ordinary text — the one thing on screen that was meant to stand out.
  const fg = pen.inverse ? (pen.bg ?? theme.background) : pen.fg
  const bg = pen.inverse ? (pen.fg ?? theme.foreground) : pen.bg
  const parts: string[] = []
  if (fg) parts.push(`color:${fg}`)
  if (bg) parts.push(`background:${bg}`)
  if (pen.bold) parts.push('font-weight:600')
  if (pen.dim) parts.push('opacity:.6')
  if (pen.italic) parts.push('font-style:italic')
  if (pen.underline) parts.push('text-decoration:underline')
  return parts.join(';')
}

const SGR = /\x1b\[([0-9;]*)m/
/** Every other CSI/OSC sequence, removed. `capture-pane` should emit none; belt and braces. */
const OTHER_ESCAPES = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\x1b\[[0-9;?]*[ -/]*[@-~]/g
/**
 * A sequence the text ENDS in the middle of.
 *
 * Each frame is a whole pane, but a pane is a slice and tmux will cut one at a byte boundary inside
 * an escape. Printing the leftover `ESC[38;5` as text puts machine noise on the screen at the exact
 * moment somebody is trying to read what their session is doing.
 */
const DANGLING_ESCAPE = /\x1b\[?[0-9;?]*$/

/**
 * One frame's `content` → HTML.
 *
 * Total: any string in, HTML out, no throw. An empty frame yields an empty string rather than a
 * stray element, so "no output yet" and "one blank line" stay distinguishable.
 */
export function ansiToHtml(content: string, theme: 'dark' | 'light'): string {
  const palette = xtermTheme(theme)
  let pen: Pen = { ...BLANK }
  let out = ''
  let rest = content

  for (;;) {
    const match = SGR.exec(rest)
    if (!match) break
    const before = rest.slice(0, match.index)
    if (before) out += paint(before, pen, palette)
    const params = (match[1] ?? '')
      .split(';')
      .map(p => (p === '' ? 0 : Number(p)))
      .filter(n => Number.isFinite(n))
    pen = applySgr(pen, params.length > 0 ? params : [0], palette)
    rest = rest.slice(match.index + match[0].length)
  }
  // The tail is the only place a cut sequence can be, so it is the only place that pays for the
  // check — running it on every segment would strip a legitimate `[1;` typed into a file.
  if (rest) out += paint(rest.replace(DANGLING_ESCAPE, ''), pen, palette)
  return out
}

function paint(text: string, pen: Pen, theme: XtermTheme): string {
  const clean = escapeHtml(text.replace(OTHER_ESCAPES, ''))
  if (!clean) return ''
  const style = penStyle(pen, theme)
  return style ? `<span style="${style}">${clean}</span>` : clean
}
