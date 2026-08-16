import { describe, expect, it } from 'bun:test'

import {
  DOUBLE_CLICK_MS,
  isActivation,
  splitMouse,
  trackClick,
  wheelDelta,
  WHEEL_ROWS,
  type ClickTrack,
  type Pointer,
} from './mouse'

/** Written as a code point rather than typed, so this file stays plain text. */
const ESC = String.fromCharCode(27)

const sgr = (b: number, x: number, y: number, press = true) =>
  `${ESC}[<${b};${x};${y}${press ? 'M' : 'm'}`

describe('splitMouse — SGR reports', () => {
  it('decodes a left press', () => {
    const { keys, events, rest } = splitMouse(sgr(0, 10, 5))

    expect(keys).toBe('')
    expect(rest).toBe('')
    expect(events).toEqual([{
      kind: 'press', button: 'left', column: 10, row: 5,
      shift: false, alt: false, ctrl: false, motion: false,
    }])
  })

  it('decodes a release from the final byte', () => {
    const { events } = splitMouse(sgr(0, 10, 5, false))
    expect(events[0]?.kind).toBe('release')
    // SGR keeps the button bits on a release, which is what makes them usable at all.
    expect(events[0]?.button).toBe('left')
  })

  it('decodes the middle and right buttons', () => {
    expect(splitMouse(sgr(1, 1, 1)).events[0]?.button).toBe('middle')
    expect(splitMouse(sgr(2, 1, 1)).events[0]?.button).toBe('right')
  })

  it('decodes the wheel, which needs no tracking mode of its own', () => {
    // 64/65 under ?1000 — the whole reason scrolling works without ?1002 or ?1003.
    expect(splitMouse(sgr(64, 3, 4)).events[0]?.button).toBe('wheel-up')
    expect(splitMouse(sgr(65, 3, 4)).events[0]?.button).toBe('wheel-down')
  })

  it('decodes the modifier bits', () => {
    const { events } = splitMouse(sgr(0 + 4 + 8 + 16, 2, 2))
    expect(events[0]).toMatchObject({ shift: true, alt: true, ctrl: true, button: 'left' })
  })

  it('classifies a motion report rather than reading it as a press', () => {
    // We never enable ?1002/?1003, so this only arrives when something else turned one on.
    expect(splitMouse(sgr(32, 2, 2)).events[0]?.motion).toBe(true)
  })

  it('keeps coordinates past column 223, which is why SGR is enabled at all', () => {
    const { events } = splitMouse(sgr(0, 240, 61))
    expect(events[0]).toMatchObject({ column: 240, row: 61 })
  })
})

describe('splitMouse — chunking', () => {
  it('decodes several reports in one chunk', () => {
    const { events, keys } = splitMouse(sgr(0, 1, 1) + sgr(0, 1, 1, false) + sgr(65, 4, 9))

    expect(keys).toBe('')
    expect(events.map(e => `${e.kind}:${e.button}`)).toEqual([
      'press:left', 'release:left', 'press:wheel-down',
    ])
  })

  it('buffers a report split across two chunks and decodes it on the second', () => {
    const whole = sgr(0, 12, 7)
    const first = splitMouse(whole.slice(0, 6))

    expect(first.events).toEqual([])
    expect(first.keys).toBe('')
    expect(first.rest).toBe(whole.slice(0, 6))

    const second = splitMouse(first.rest + whole.slice(6))
    expect(second.rest).toBe('')
    expect(second.events[0]).toMatchObject({ column: 12, row: 7 })
  })

  it('buffers every prefix of a report, at every split point', () => {
    const whole = sgr(0, 100, 40)
    // From the introducer onward: no split may leak a byte into `keys`, because every one of them
    // is a character that means something on these screens.
    for (let cut = 3; cut < whole.length; cut++) {
      const first = splitMouse(whole.slice(0, cut))
      expect(first.keys).toBe('')
      expect(first.events).toEqual([])
      expect(splitMouse(first.rest + whole.slice(cut)).events).toHaveLength(1)
    }
  })

  it('keeps ordinary keys interleaved with reports, in their original order', () => {
    const { keys, events } = splitMouse(`q${sgr(0, 1, 1)}ab${sgr(65, 2, 2)}z`)

    expect(keys).toBe('qabz')
    expect(events).toHaveLength(2)
  })

  it('passes escape sequences that are not mouse reports through untouched', () => {
    const input = `${ESC}[A${ESC}[B${ESC}[5~\r`
    expect(splitMouse(input)).toEqual({ keys: input, events: [], rest: '' })
  })

  it('never holds back a bare escape or a bare CSI', () => {
    // `esc` is this app's "back" key; buffering it until the next chunk would make it appear to do
    // nothing. A terminal writes a mouse report in one write, so the split we must survive lands
    // inside the coordinates, never inside the three-byte introducer.
    expect(splitMouse(ESC)).toEqual({ keys: ESC, events: [], rest: '' })
    expect(splitMouse(`${ESC}[`)).toEqual({ keys: `${ESC}[`, events: [], rest: '' })
  })
})

describe('splitMouse — malformed input', () => {
  it('drops a report with junk where the coordinates should be, and never throws', () => {
    const { keys, events } = splitMouse(`${ESC}[<abcMq`)

    expect(events).toEqual([])
    // The `ESC [ <` and the byte that ended the run go with it: leaving `[<abcM` in the key stream
    // is the stray-key bug the splitter exists to prevent.
    expect(keys).toBe('bcMq')
  })

  it('drops a truncated report that was terminated by a real key', () => {
    const { keys, events } = splitMouse(`${ESC}[<0;10Xtail`)
    expect(events).toEqual([])
    expect(keys).toBe('tail')
  })

  it('recovers and decodes the next report after junk', () => {
    const { events } = splitMouse(`${ESC}[<;;;;X${sgr(0, 5, 5)}`)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ column: 5, row: 5 })
  })

  it('does not scan an unbounded run of digits as a report', () => {
    const long = `${ESC}[<${'9'.repeat(40)}M`
    expect(() => splitMouse(long)).not.toThrow()
    expect(splitMouse(long).events).toEqual([])
  })
})

describe('splitMouse — the legacy X10 encoding', () => {
  // Never requested (we ask for ?1006), but a terminal that ignores it answers this way, and six
  // unrecognised bytes per click in the key stream is exactly what the splitter must prevent.
  const x10 = (b: number, x: number, y: number) =>
    `${ESC}[M${String.fromCharCode(b + 32, x + 32, y + 32)}`

  it('decodes a press and removes it from the keys', () => {
    const { keys, events } = splitMouse(`a${x10(0, 10, 5)}b`)

    expect(keys).toBe('ab')
    expect(events[0]).toMatchObject({ kind: 'press', button: 'left', column: 10, row: 5 })
  })

  it('reads button code 3 as a release, since the encoding has no release byte', () => {
    expect(splitMouse(x10(3, 1, 1)).events[0]?.kind).toBe('release')
  })

  it('buffers an incomplete legacy report', () => {
    const whole = x10(0, 4, 4)
    const first = splitMouse(whole.slice(0, 4))

    expect(first.keys).toBe('')
    expect(first.rest).toBe(whole.slice(0, 4))
    expect(splitMouse(first.rest + whole.slice(4)).events).toHaveLength(1)
  })
})

describe('trackClick', () => {
  const press = { column: 4, row: 9 }

  it('counts a lone press as one', () => {
    expect(trackClick(null, press, 1000).count).toBe(1)
  })

  it('counts a second press on the same cell inside the window as two', () => {
    const first = trackClick(null, press, 1000)
    expect(trackClick(first, press, 1000 + DOUBLE_CLICK_MS).count).toBe(2)
  })

  it('restarts once the window has passed', () => {
    const first = trackClick(null, press, 1000)
    expect(trackClick(first, press, 1001 + DOUBLE_CLICK_MS).count).toBe(1)
  })

  it('restarts on a different cell, so a fast click across two rows is not a double', () => {
    const first = trackClick(null, press, 1000)
    expect(trackClick(first, { column: 4, row: 10 }, 1010).count).toBe(1)
  })

  it('never counts past two, so a third rapid press does not act twice', () => {
    let track: ClickTrack | null = null
    const counts = [0, 10, 20, 30].map(t => (track = trackClick(track, press, 1000 + t)).count)
    expect(counts).toEqual([1, 2, 1, 2])
  })
})

describe('wheelDelta / isActivation', () => {
  it('turns the wheel into a clamped row delta and everything else into zero', () => {
    expect(wheelDelta('wheel-up')).toBe(-WHEEL_ROWS)
    expect(wheelDelta('wheel-down')).toBe(WHEEL_ROWS)
    expect(wheelDelta('left')).toBe(0)
    expect(wheelDelta('other')).toBe(0)
  })

  it('acts on a plain left press only', () => {
    const base: Pointer = { x: 0, y: 0, kind: 'press', button: 'left', shift: false, double: false }

    expect(isActivation(base)).toBe(true)
    expect(isActivation({ ...base, kind: 'release' })).toBe(false)
    expect(isActivation({ ...base, button: 'right' })).toBe(false)
    // Shift belongs to the terminal's own selection and must never be read as a control press.
    expect(isActivation({ ...base, shift: true })).toBe(false)
  })
})
