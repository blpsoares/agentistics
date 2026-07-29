/**
 * mouseStdin.ts — the one real listener on stdin, and the stream Ink is given instead.
 *
 * THE PROBLEM THIS SOLVES, stated once. Ink has no mouse support: it reads whatever stream it is
 * handed through its keypress parser, so `\x1b[<0;10;5M` arriving there is an escape followed by the
 * literal characters `[<0;10;5M` — a `<`, three digits and an `M`, every one of which means
 * something on these screens. Merely ADDING a second `data` listener does not help, because the
 * bytes are still in Ink's stream too. So the stream is SPLIT: we take the only listener on the real
 * stdin, `splitMouse` removes the reports, and the remainder is written into a `PassThrough` that
 * Ink is given as its `stdin`.
 *
 * WHAT THE FAKE STREAM HAS TO CARRY. Ink checks `isTTY` and then calls `setRawMode`, `ref` and
 * `unref` on whatever it was handed (see `ink/build/components/App.js`), and it reads by attaching a
 * `readable` listener and calling `.read()` — which a `PassThrough` does natively. The three
 * lifecycle methods are no-ops here because they belong to the REAL descriptor, which this module
 * owns: raw mode is set on it directly, and it is deliberately left referenced, since it is what
 * keeps the process alive while a screen with no timers is on top.
 *
 * `cli-start.ts`'s `makeSuspend` takes stdin over for a suspended command by removing every `data`
 * listener and putting them back afterwards. That still works, and it works on exactly one listener
 * now: this one.
 */

import { PassThrough } from 'node:stream'
import { splitMouse, type MouseReport } from './mouse'

/** The real descriptor, reduced to what this module needs — so a test can hand it a fake. */
export interface RawStdin {
  isTTY?: boolean
  setRawMode?(mode: boolean): unknown
  setEncoding(encoding: BufferEncoding): unknown
  resume(): unknown
  pause(): unknown
  on(event: 'data', listener: (chunk: string | Buffer) => void): unknown
  off(event: 'data', listener: (chunk: string | Buffer) => void): unknown
}

export interface MouseInput {
  /** Hand this to `render(..., { stdin })`. It carries only the bytes that are not mouse reports. */
  stdin: NodeJS.ReadStream
  /** Detach from the real stdin, drop raw mode and end the forwarded stream. Idempotent. */
  stop(): void
}

/**
 * Take over stdin, forward the keys, and report the mouse.
 *
 * `onReport` is called for every decoded report, in arrival order and synchronously with the chunk
 * that carried it — so a click and the keystroke typed before it cannot swap places.
 */
export function createMouseInput(
  real: RawStdin,
  onReport: (report: MouseReport) => void,
): MouseInput {
  const forwarded = new PassThrough()

  // Ink asks a stream three things about itself before it will read from it. `isTTY` is what makes
  // it take the interactive path at all; `setRawMode`/`ref`/`unref` are no-ops because the real
  // descriptor below is the one with a terminal mode and a place in the event loop.
  Object.assign(forwarded, {
    isTTY: true,
    setRawMode: () => forwarded,
    ref: () => forwarded,
    unref: () => forwarded,
  })

  /** The tail of a report that has not finished arriving; never forwarded, never a keystroke. */
  let rest = ''
  let stopped = false

  const onData = (chunk: string | Buffer) => {
    const split = splitMouse(rest + (typeof chunk === 'string' ? chunk : chunk.toString('utf8')))
    rest = split.rest
    // Keys first: they were typed before the events in the same chunk were clicked as often as not,
    // and forwarding them in order is the only ordering guarantee we can honestly make.
    if (split.keys) forwarded.write(split.keys)
    for (const report of split.events) onReport(report)
  }

  // Decoding here rather than letting Ink do it on the PassThrough: a multi-byte character split
  // across two reads has to be reassembled BEFORE the mouse reports are cut out of the stream.
  real.setEncoding('utf8')
  real.on('data', onData)
  real.setRawMode?.(true)
  real.resume()

  return {
    stdin: forwarded as unknown as NodeJS.ReadStream,
    stop() {
      if (stopped) return
      stopped = true
      real.off('data', onData)
      real.setRawMode?.(false)
      real.pause()
      forwarded.end()
    },
  }
}
