import { describe, expect, it } from 'bun:test'

import { createAltScreen, createFrameWriter } from './altScreen'

const ENTER = '\x1b[?1049h\x1b[H'
const LEAVE = '\x1b[?1049l'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h'
const MOUSE_OFF = '\x1b[?1006l\x1b[?1000l'

/** Records every chunk so the ORDER of the escape sequences can be asserted, not just the end state. */
function fakeIo() {
  const writes: string[] = []
  return { writes, write: (chunk: string) => { writes.push(chunk) } }
}

describe('createAltScreen', () => {
  it('enters the alternate buffer and hides the cursor', () => {
    const io = fakeIo()
    const alt = createAltScreen(io)

    expect(alt.active).toBe(false)
    alt.enter()

    expect(alt.active).toBe(true)
    expect(io.writes.join('')).toBe(ENTER + HIDE_CURSOR)
  })

  it('is idempotent on a second enter', () => {
    const io = fakeIo()
    const alt = createAltScreen(io)

    alt.enter()
    alt.enter()

    expect(io.writes).toHaveLength(1)
    expect(alt.active).toBe(true)
  })

  it('restores the cursor before leaving the buffer', () => {
    const io = fakeIo()
    const alt = createAltScreen(io)

    alt.enter()
    io.writes.length = 0
    alt.leave()

    expect(alt.active).toBe(false)
    expect(io.writes.join('')).toBe(SHOW_CURSOR + LEAVE)
  })

  it('is idempotent on leave before enter', () => {
    const io = fakeIo()
    const alt = createAltScreen(io)

    alt.leave()

    expect(io.writes).toHaveLength(0)
    expect(alt.active).toBe(false)
  })

  it('leaves before running fn and re-enters after it, in that order', async () => {
    const io = fakeIo()
    const alt = createAltScreen(io)
    alt.enter()
    io.writes.length = 0

    // The whole contract: a docker build must write to the REAL terminal, never into the
    // alternate buffer, so the leave has to be flushed before fn starts.
    await alt.suspend(async () => {
      io.writes.push('<fn>')
      expect(alt.active).toBe(false)
    })

    expect(io.writes).toEqual([SHOW_CURSOR + LEAVE, '<fn>', ENTER + HIDE_CURSOR])
    expect(alt.active).toBe(true)
  })

  /**
   * The window a FRAME may not be drawn in. `writeFrame` (what Ink is given) drops what it is handed
   * while this is true, because an Ink frame erases the lines above itself before it draws — and
   * while a command is suspended, those lines are the user's own scrollback.
   */
  it('reports itself suspended only while fn is running', async () => {
    const alt = createAltScreen(fakeIo())
    alt.enter()
    expect(alt.suspended).toBe(false)

    await alt.suspend(async () => { expect(alt.suspended).toBe(true) })
    expect(alt.suspended).toBe(false)
  })

  it('stops reporting itself suspended when fn throws', async () => {
    const alt = createAltScreen(fakeIo())
    alt.enter()

    await expect(alt.suspend(async () => { throw new Error('compose failed') })).rejects.toThrow()
    expect(alt.suspended).toBe(false)
  })

  it('resolves with the value fn returns', async () => {
    const alt = createAltScreen(fakeIo())
    alt.enter()

    await expect(alt.suspend(async () => 42)).resolves.toBe(42)
  })

  it('re-enters when fn rejects, and propagates the rejection', async () => {
    const io = fakeIo()
    const alt = createAltScreen(io)
    alt.enter()
    io.writes.length = 0

    const boom = new Error('compose failed')
    await expect(alt.suspend(async () => { throw boom })).rejects.toBe(boom)

    expect(io.writes).toEqual([SHOW_CURSOR + LEAVE, ENTER + HIDE_CURSOR])
    expect(alt.active).toBe(true)
  })

  it('does not enter the buffer when suspending while inactive', async () => {
    const io = fakeIo()
    const alt = createAltScreen(io)

    await alt.suspend(async () => {
      expect(alt.active).toBe(false)
    })

    expect(io.writes).toHaveLength(0)
    expect(alt.active).toBe(false)
  })

  it('does not enter the buffer when an inactive suspend rejects', async () => {
    const io = fakeIo()
    const alt = createAltScreen(io)

    await expect(alt.suspend(async () => { throw new Error('nope') })).rejects.toThrow('nope')

    expect(io.writes).toHaveLength(0)
    expect(alt.active).toBe(false)
  })
})

describe('createAltScreen — mouse tracking', () => {
  it('enables exactly ?1000 and ?1006, and nothing else', () => {
    const io = fakeIo()
    const alt = createAltScreen(io)

    alt.enableMouse()

    // ?1002 / ?1003 would swallow the drag the terminal's own selection needs; the wheel arrives
    // under ?1000 as buttons 64/65, so neither buys anything here.
    expect(io.writes.join('')).toBe(MOUSE_ON)
    expect(io.writes.join('')).not.toContain('?1002')
    expect(io.writes.join('')).not.toContain('?1003')
    expect(alt.mouseOn).toBe(true)
  })

  it('is idempotent in both directions', () => {
    const io = fakeIo()
    const alt = createAltScreen(io)

    alt.enableMouse()
    alt.enableMouse()
    alt.disableMouse()
    alt.disableMouse()

    expect(io.writes).toEqual([MOUSE_ON, MOUSE_OFF])
    expect(alt.mouseOn).toBe(false)
  })

  it('entering the buffer does not turn the mouse on by itself', () => {
    const io = fakeIo()
    const alt = createAltScreen(io)

    alt.enter()

    // Whether the mouse reports is a preference; the buffer is not.
    expect(alt.mouseOn).toBe(false)
    expect(io.writes.join('')).toBe(ENTER + HIDE_CURSOR)
  })

  it('disables tracking BEFORE it leaves the buffer', () => {
    const io = fakeIo()
    const alt = createAltScreen(io)
    alt.enter()
    alt.enableMouse()
    io.writes.length = 0

    alt.leave()

    // The whole guarantee: no exit path can end with the terminal still reporting, and the mode is
    // turned off in the same buffer it was turned on in.
    expect(io.writes).toEqual([MOUSE_OFF, SHOW_CURSOR + LEAVE])
    expect(alt.mouseOn).toBe(false)
  })

  it('disables tracking even when the buffer was never entered', () => {
    const io = fakeIo()
    const alt = createAltScreen(io)
    alt.enableMouse()
    io.writes.length = 0

    alt.leave()

    // `leave` is what the exit and signal handlers call, so its mouse half may not sit behind the
    // buffer's guard — a process holding tracking without the alternate screen must still give it
    // back, or the user's shell is left typing `<35;40;12M` until they run `reset`.
    expect(io.writes).toEqual([MOUSE_OFF])
  })

  it('hands the mouse to a suspended command and takes it back afterwards', async () => {
    const io = fakeIo()
    const alt = createAltScreen(io)
    alt.enter()
    alt.enableMouse()
    io.writes.length = 0

    await alt.suspend(async () => {
      io.writes.push('<fn>')
      // A docker build must not receive `<35;40;12M` on its stdin every time the pointer moves.
      expect(alt.mouseOn).toBe(false)
      expect(alt.active).toBe(false)
    })

    expect(io.writes).toEqual([MOUSE_OFF, SHOW_CURSOR + LEAVE, '<fn>', ENTER + HIDE_CURSOR, MOUSE_ON])
    expect(alt.mouseOn).toBe(true)
  })

  it('restores the mouse when the suspended command throws', async () => {
    const io = fakeIo()
    const alt = createAltScreen(io)
    alt.enter()
    alt.enableMouse()
    io.writes.length = 0

    await expect(alt.suspend(async () => { throw new Error('compose failed') })).rejects.toThrow()

    expect(io.writes).toEqual([MOUSE_OFF, SHOW_CURSOR + LEAVE, ENTER + HIDE_CURSOR, MOUSE_ON])
    expect(alt.mouseOn).toBe(true)
  })

  it('never turns the mouse on behind the preference — a suspension only restores what was on', async () => {
    const io = fakeIo()
    const alt = createAltScreen(io)
    alt.enter()
    io.writes.length = 0

    await alt.suspend(async () => { io.writes.push('<fn>') })

    expect(io.writes).toEqual([SHOW_CURSOR + LEAVE, '<fn>', ENTER + HIDE_CURSOR])
    expect(alt.mouseOn).toBe(false)
  })
})

/**
 * The gate Ink's own frames go through — `inkStdout` in `index.ts` hands Ink `writeFrame`, which is
 * this factory bound to the real stdout and the real alternate screen.
 */
describe('createFrameWriter', () => {
  const spy = () => {
    const chunks: unknown[][] = []
    return { chunks, write: (...args: unknown[]) => { chunks.push(args); return true } }
  }

  it('writes the frame through when the terminal is ours', () => {
    const out = spy()
    const write = createFrameWriter(out.write, () => false)
    write('frame')
    expect(out.chunks).toEqual([['frame']])
  })

  /**
   * An Ink frame erases the lines above itself before it draws. While a command is suspended those
   * lines are the user's own scrollback, so the frame is dropped rather than drawn.
   */
  it('drops the frame while a command is suspended', () => {
    const out = spy()
    let suspended = true
    const write = createFrameWriter(out.write, () => suspended)
    write('frame during a build')
    expect(out.chunks).toEqual([])
    suspended = false
    write('frame after it')
    expect(out.chunks).toEqual([['frame after it']])
  })

  // THE REGRESSION THIS EXISTS FOR: Ink's teardown writes with a callback and waits for it. A gate
  // that dropped the frame AND the callback turned `q` into a hang — the app unmounted, the promise
  // never settled, and the terminal was left in the alternate buffer with no prompt.
  it('always fires the callback, dropped frame or not', async () => {
    const out = spy()
    const write = createFrameWriter(out.write, () => true)
    await new Promise<void>(resolve => { write('dropped', () => resolve()) })
    expect(out.chunks).toEqual([])
  })

  it('passes the encoding and the callback through when it does write', () => {
    const out = spy()
    const write = createFrameWriter(out.write, () => false)
    const cb = () => {}
    write('frame', 'utf8', cb)
    expect(out.chunks).toEqual([['frame', 'utf8', cb]])
  })
})
