import { describe, expect, it } from 'bun:test'
import { ansiToHtml, escapeHtml } from './ansi'

const ESC = '\x1b'

describe('ansiToHtml', () => {
  it('escapes the content before anything else', () => {
    // The frame is a coding assistant's terminal output — file contents, diffs, whatever it was
    // asked to print. It is the least trustworthy string in this extension.
    const out = ansiToHtml('<script>alert(1)</script> & "quotes"', 'dark')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&amp;')
  })

  it('paints the sixteen ANSI colours from the dashboard\'s own palette', () => {
    // Same session, same colours in both surfaces — the palette is imported, not restated.
    const red = ansiToHtml(`${ESC}[31mfail${ESC}[0m`, 'dark')
    expect(red).toContain('color:')
    expect(red).toContain('fail')
    const bright = ansiToHtml(`${ESC}[91mfail${ESC}[0m`, 'dark')
    expect(bright).not.toBe(red)
  })

  it('reads an extended colour as ONE code, not as three attributes', () => {
    // `38;5;n` and `38;2;r;g;b` consume what follows them; reading those as independent codes turns
    // a truecolour foreground into an unrelated bright background.
    const truecolour = ansiToHtml(`${ESC}[38;2;255;0;0mred${ESC}[0m`, 'dark')
    expect(truecolour).toContain('color:#ff0000')
    expect(truecolour).not.toContain('background')

    const indexed = ansiToHtml(`${ESC}[38;5;196mred${ESC}[0m`, 'dark')
    expect(indexed).toContain('color:#ff0000')
  })

  it('maps the 256-colour cube and its greyscale ramp', () => {
    expect(ansiToHtml(`${ESC}[38;5;16mx`, 'dark')).toContain('color:#000000')
    expect(ansiToHtml(`${ESC}[38;5;231mx`, 'dark')).toContain('color:#ffffff')
    expect(ansiToHtml(`${ESC}[38;5;232mx`, 'dark')).toContain('color:#080808')
    // 0-15 come from the palette, so an indexed red equals a `31` red.
    expect(ansiToHtml(`${ESC}[38;5;1mx`, 'dark')).toBe(ansiToHtml(`${ESC}[31mx`, 'dark'))
  })

  it('resolves inverse rather than dropping it', () => {
    // Selected rows, diff markers and much TUI chrome are drawn with it: ignoring it renders the
    // one thing meant to stand out as ordinary text.
    const out = ansiToHtml(`${ESC}[7mselected${ESC}[27m`, 'dark')
    expect(out).toContain('background:')
    expect(out).toContain('color:')
  })

  it('carries the pen across segments and resets it on 0', () => {
    const out = ansiToHtml(`${ESC}[1;32mok${ESC}[0m plain`, 'dark')
    expect(out).toContain('font-weight:600')
    expect(out).toMatch(/plain/)
    // The text after the reset is unstyled — no span wrapping it.
    expect(out.endsWith(' plain')).toBe(true)
  })

  it('turns attributes off individually', () => {
    expect(ansiToHtml(`${ESC}[1mbold${ESC}[22mnot`, 'dark')).toContain('bold')
    const out = ansiToHtml(`${ESC}[4munder${ESC}[24mnot`, 'dark')
    expect(out).toContain('text-decoration:underline')
    expect(out.endsWith('not')).toBe(true)
  })

  it('treats a bare ESC[m as a reset, the way a terminal does', () => {
    const out = ansiToHtml(`${ESC}[31mred${ESC}[mplain`, 'dark')
    expect(out.endsWith('plain')).toBe(true)
  })

  it('drops escape sequences that are not colour instead of printing them', () => {
    const out = ansiToHtml(`${ESC}[2Jcleared${ESC}[10;5H`, 'dark')
    expect(out).toBe('cleared')
  })

  it('is total — an empty frame is an empty string, not a stray element', () => {
    expect(ansiToHtml('', 'dark')).toBe('')
    expect(ansiToHtml(`${ESC}[999;999mx`, 'dark')).toContain('x')
  })

  it('drops a sequence the frame was cut in the middle of', () => {
    // A pane is a slice and tmux will cut one inside an escape. `ESC[38;5` printed as text is
    // machine noise at the exact moment somebody is reading what their session is doing.
    expect(ansiToHtml(`${ESC}[`, 'dark')).toBe('')
    expect(ansiToHtml(`done${ESC}[38;5`, 'dark')).toBe('done')
    // …and only at the END: a `[1;` sitting in a file being printed is ordinary text.
    expect(ansiToHtml('a [1; b', 'dark')).toBe('a [1; b')
  })

  it('renders differently in the two themes', () => {
    expect(ansiToHtml(`${ESC}[32mok`, 'dark')).not.toBe(ansiToHtml(`${ESC}[32mok`, 'light'))
  })
})

describe('escapeHtml', () => {
  it('closes every way into a tag', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;')
  })
})
