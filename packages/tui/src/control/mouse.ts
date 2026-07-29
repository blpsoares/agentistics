/**
 * mouse.ts — PURE decoding of the terminal's mouse reports, and the click clock.
 *
 * Bytes in, `{ keys, events, rest }` out. Nothing here touches a stream, a component or a clock of
 * its own, so every case that matters can be asserted against a string: several reports in one
 * chunk, one report split across two, reports interleaved with ordinary keys, and the malformed
 * sequences a resized xterm or a multiplexer will eventually produce.
 *
 * THE REASON THIS IS A SPLITTER AND NOT A LISTENER. Ink has no mouse support (checked: `ink@7`
 * exports no `useMouse` and writes no `?1000h`), and it reads whatever stream it is handed through
 * its own keypress parser. A second `data` listener on the real stdin would leave the mouse bytes in
 * Ink's stream as well, where `\x1b[<0;10;5M` reads as an escape followed by the literal characters
 * `[<0;10;5M` — digits and letters that mean something on these screens. So the mouse reports are
 * REMOVED here and only `keys` is forwarded; see `mouseStdin.ts`.
 *
 * WHAT THE TERMINAL SENDS. We enable `?1000` (button press/release) and `?1006` (SGR coordinates),
 * and nothing else — see `altScreen.ts` for why motion tracking is deliberately absent. The wheel
 * needs no extra mode: under `?1000` it arrives as ordinary button reports with bit 64 set, buttons
 * 64 and 65, which is why scrolling works with the same two modes.
 *
 *   SGR   `ESC [ < b ; x ; y M`   press      `ESC [ < b ; x ; y m`   release
 *   X10   `ESC [ M  b+32 x+32 y+32`          (legacy, see below)
 *
 * The X10 form is parsed even though we never ask for it. A terminal that ignores `?1006` still
 * honours `?1000` and answers in the legacy encoding, and the whole point of this module is that
 * mouse bytes never reach the keyboard — leaving six unrecognised bytes per click in the key stream
 * would reproduce the exact bug the splitter exists to prevent. Its coordinates are only reliable to
 * column 223 (and, once the stream is decoded as UTF-8, to 95), which is why `?1006` exists and why
 * we ask for it first.
 */

/**
 * Which button a report names.
 *
 * `other` covers the buttons this app has no use for — the horizontal wheel, the extra buttons some
 * mice report — and the "no button" code a release carries in the legacy encoding. Naming them
 * rather than dropping them keeps the decoder total: every byte the terminal can send has a value
 * here, and the consumers ignore what they do not want.
 */
export type MouseButton = 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down' | 'other'

/** One decoded mouse report, in the terminal's own 1-based screen coordinates. */
export interface MouseReport {
  kind: 'press' | 'release'
  button: MouseButton
  /** 1-based terminal column, exactly as reported. */
  column: number
  /** 1-based terminal row. */
  row: number
  shift: boolean
  alt: boolean
  ctrl: boolean
  /**
   * A drag / hover report, which only `?1002` / `?1003` produce.
   *
   * We never enable either — motion tracking would swallow the drag that the terminal's own
   * selection needs, and nothing on these screens hovers — so this is always false in practice. It
   * is decoded anyway so that a report arriving from a mode someone else turned on is CLASSIFIED
   * rather than mistaken for a press.
   */
  motion: boolean
}

/** What one chunk of stdin was made of. */
export interface MouseSplit {
  /** Everything that was not a mouse report, in its original order — the bytes Ink must receive. */
  keys: string
  events: MouseReport[]
  /**
   * The trailing bytes of a report that has not finished arriving. The caller prepends it to the
   * next chunk; it is never forwarded as keys, because half a report is not a keystroke.
   */
  rest: string
}

/** `ESC [ <` — the SGR introducer, and the only prefix this module will hold back. */
const SGR_INTRO = '\x1b[<'
/** A complete SGR report. The digit caps are what stop a corrupt stream from being scanned forever. */
const SGR_COMPLETE = /^\x1b\[<(\d{1,6});(\d{1,6});(\d{1,6})([Mm])/
/** The prefixes of one — a report split across two chunks ends somewhere inside this. */
const SGR_PARTIAL = /^\x1b\[<\d{0,6}(;\d{0,6}(;\d{0,6})?)?$/
/** Everything a malformed report can be made of, plus the byte that ended it. */
const SGR_JUNK = /^\x1b\[<[0-9;]*[\s\S]?/

/** `ESC [ M` plus exactly three payload bytes. */
const X10_INTRO = '\x1b[M'
const X10_LENGTH = X10_INTRO.length + 3
/** The legacy encoding biases every byte by 32 so none of them is a control character. */
const X10_BIAS = 32

/**
 * Splits one chunk into the keys Ink must see and the mouse reports it must not.
 *
 * `rest` is only ever a prefix of a SGR or X10 report — never a bare `ESC` or `ESC [`. That is a
 * deliberate asymmetry: those two are also the start of every arrow key and of `esc` itself, which
 * this app uses for "back", and holding one back until the next chunk would make the key appear to
 * do nothing until the user pressed another. A terminal writes a mouse report in ONE write, so the
 * split this module has to survive lands inside the coordinates, not inside the three-byte
 * introducer.
 */
export function splitMouse(input: string): MouseSplit {
  const events: MouseReport[] = []
  let keys = ''
  let rest = ''
  let i = 0

  while (i < input.length) {
    const at = input.indexOf('\x1b[', i)
    if (at < 0) {
      keys += input.slice(i)
      i = input.length
      break
    }

    const marker = input[at + 2]
    if (marker !== '<' && marker !== 'M') {
      // Not a mouse report — and a bare `ESC [` at the end is forwarded rather than held, for the
      // reason above. Ink's own parser already buffers a pending escape and flushes it on a timer.
      keys += input.slice(i, at + 2)
      i = at + 2
      continue
    }

    keys += input.slice(i, at)
    const tail = input.slice(at)

    if (marker === '<') {
      const m = SGR_COMPLETE.exec(tail)
      if (m) {
        events.push(decodeSgr(Number(m[1]), Number(m[2]), Number(m[3]), m[4] === 'M'))
        i = at + m[0].length
        continue
      }
      if (SGR_PARTIAL.test(tail)) {
        rest = tail
        i = input.length
        break
      }
      // Malformed: the introducer, whatever digits followed, and the byte that ended it, dropped
      // whole. Dropping only the `ESC` would hand `[<` and the rest to Ink as literal keys, which is
      // the failure this module exists to prevent — quietly losing a click is the cheaper mistake.
      i = at + (SGR_JUNK.exec(tail)?.[0].length ?? SGR_INTRO.length)
      continue
    }

    if (tail.length < X10_LENGTH) {
      rest = tail
      i = input.length
      break
    }
    events.push(decodeX10(
      tail.charCodeAt(3) - X10_BIAS,
      tail.charCodeAt(4) - X10_BIAS,
      tail.charCodeAt(5) - X10_BIAS,
    ))
    i = at + X10_LENGTH
  }

  return { keys, events, rest }
}

/**
 * The modifier and button bits, which both encodings share.
 *
 * Bit 64 turns the low two bits into a wheel direction rather than a button, which is why the wheel
 * needs no tracking mode of its own: it is a button press as far as `?1000` is concerned.
 */
function decodeBits(b: number): Omit<MouseReport, 'kind' | 'column' | 'row'> {
  const low = b & 3
  const button: MouseButton = (b & 64) !== 0
    ? (low === 0 ? 'wheel-up' : low === 1 ? 'wheel-down' : 'other')
    : (low === 0 ? 'left' : low === 1 ? 'middle' : low === 2 ? 'right' : 'other')
  return {
    button,
    shift: (b & 4) !== 0,
    alt: (b & 8) !== 0,
    ctrl: (b & 16) !== 0,
    motion: (b & 32) !== 0,
  }
}

function decodeSgr(b: number, column: number, row: number, press: boolean): MouseReport {
  // SGR is the encoding that made release events usable: the final byte says which it is, and the
  // button bits stay meaningful, so a release names the button that was let go.
  return { kind: press ? 'press' : 'release', column, row, ...decodeBits(b) }
}

function decodeX10(b: number, column: number, row: number): MouseReport {
  // The legacy encoding has no release byte: `b & 3 === 3` is "all buttons up", and that — not a
  // final `m` — is the only thing marking a release.
  const bits = decodeBits(b)
  const released = (b & 64) === 0 && (b & 3) === 3
  return { kind: released ? 'release' : 'press', column, row, ...bits }
}

// ---------------------------------------------------------------------------
// the click clock
// ---------------------------------------------------------------------------

/**
 * How close together two presses on the SAME cell have to be to read as one double click.
 *
 * Generous rather than snappy: this is not a text editor, and the actions a double click reaches
 * here (open a dashboard, start a service) are ones the user aims at rather than drums out.
 */
export const DOUBLE_CLICK_MS = 400

/** What the previous press was, and how many in a row it was. */
export interface ClickTrack {
  column: number
  row: number
  at: number
  /** 1 for a single press, 2 for the second on the same cell inside the window. */
  count: number
}

/**
 * The click counter, as a reducer over the previous press.
 *
 * PURE, and the clock is passed in, so the whole behaviour — including the two rules worth stating —
 * is testable without waiting. Those rules: a press on a DIFFERENT cell always restarts the count
 * (otherwise a fast click across two service rows would double-click the second one), and the count
 * never goes past two, so a third rapid press starts over rather than firing the default action a
 * second time.
 */
export function trackClick(
  prev: ClickTrack | null,
  at: { column: number; row: number },
  now: number,
): ClickTrack {
  const again = prev !== null
    && prev.column === at.column
    && prev.row === at.row
    && now - prev.at <= DOUBLE_CLICK_MS
    && prev.count < 2
  return { column: at.column, row: at.row, at: now, count: again ? prev.count + 1 : 1 }
}

// ---------------------------------------------------------------------------
// what a region receives
// ---------------------------------------------------------------------------

/**
 * A mouse report translated into ONE region's own coordinates.
 *
 * The absolute report never reaches a component: the shell resolves its own chrome and converts the
 * rest into the frame of whatever is under the pointer, so a screen resolves the event against the
 * very layout values it rendered from and no coordinate arithmetic is ever written down twice.
 */
export interface Pointer {
  /** Column inside the region, 0-based. */
  x: number
  /** Row inside the region, 0-based. */
  y: number
  kind: 'press' | 'release'
  button: MouseButton
  shift: boolean
  /** The second press on this cell inside `DOUBLE_CLICK_MS`. */
  double: boolean
}

/** How many rows one wheel notch moves a document. Three is the terminal convention. */
export const WHEEL_ROWS = 3

/** The wheel's direction as a row delta, or `0` for anything that is not the wheel. */
export function wheelDelta(button: MouseButton): number {
  if (button === 'wheel-up') return -WHEEL_ROWS
  if (button === 'wheel-down') return WHEEL_ROWS
  return 0
}

/**
 * Is this the plain left press a control should act on?
 *
 * Releases are ignored (a click acts on the press, which is where the pointer was aimed), and so is
 * a press carrying a modifier: `shift` is the terminal's own copy gesture and must reach the
 * terminal untouched, and `ctrl` / `alt` clicks belong to whatever the user's terminal does with
 * them.
 */
export function isActivation(p: Pointer): boolean {
  return p.kind === 'press' && p.button === 'left' && !p.shift
}
