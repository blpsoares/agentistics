/**
 * altScreen.ts — the alternate screen buffer, and stepping out of it for raw-output commands.
 *
 * The control center runs entirely in the terminal's alternate buffer. Everything it draws lands
 * there and vanishes on exit, so navigating tabs and submenus adds NOTHING to the scrollback —
 * which is the whole point: the previous launcher re-rendered Ink once per step and printed its
 * prompts inline, so each selection appended a block of output and the terminal scrolled forever.
 *
 * `\x1b[?1049h` also clears the alternate buffer on entry, so a command that takes over the tty
 * (docker compose, a build, the foreground server) cannot simply write over us — see `suspend`,
 * which leaves the buffer for the duration and re-enters afterwards.
 *
 * Restoring is guarded: if the process dies while the alternate buffer is active the terminal is
 * left showing an empty screen with no prompt, which reads as a hang. The handlers installed on
 * entry make that unrecoverable-by-the-user state impossible.
 *
 * MOUSE TRACKING LIVES HERE FOR EXACTLY THE SAME REASON, and its failure is worse. A process that
 * dies with tracking on leaves the terminal reporting every movement as text — `<35;40;12M` typed
 * into whatever prompt comes back — until the user runs `reset`. That is damage OUTSIDE our process,
 * on a shell we do not own, and unlike the empty alternate buffer it survives the session. So the
 * two are one guarantee: whatever restores the buffer disables tracking first, `suspend` gives the
 * mouse back to the child along with the screen, and the `exit`/signal handlers cover both.
 */

const ENTER = '\x1b[?1049h\x1b[H'
const LEAVE = '\x1b[?1049l'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'

/**
 * The ONLY two modes we turn on, and the ones we deliberately do not.
 *
 * `?1000` reports button press and release; `?1006` asks for those reports in SGR form, which is
 * the only encoding that survives past column 223 and the only one with a usable release byte. The
 * WHEEL needs nothing further — under `?1000` it arrives as buttons 64 and 65.
 *
 * `?1002` (drag) and `?1003` (any motion) are NOT enabled, on purpose. They would hand us every
 * movement, which is the one thing that breaks the terminal's own selection: with motion tracking on
 * there is no drag left for the terminal to interpret, and copying text — the thing this app's cheat
 * sheet exists to be copied FROM — stops working. Nothing here hovers, so they buy nothing either.
 */
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h'
/** Disabled in the reverse order, so the encoding goes before the reporting that uses it. */
const MOUSE_OFF = '\x1b[?1006l\x1b[?1000l'

export interface AltScreenIo {
  write(chunk: string): void
}

export interface AltScreen {
  /** Enter the alternate buffer and hide the cursor. Idempotent. */
  enter(): void
  /**
   * Leave the alternate buffer, restore the cursor, and — always — stop mouse tracking.
   *
   * Idempotent, and it disables the mouse whether or not the buffer was ever entered: this is the
   * function every exit path funnels through, so it has to be the one place that cannot leave
   * tracking on.
   */
  leave(): void
  readonly active: boolean
  /**
   * Start reporting mouse buttons and the wheel. Idempotent.
   *
   * Deliberately NOT called by `enter`: whether the mouse is on is a preference the user can toggle,
   * and the buffer is not.
   */
  enableMouse(): void
  /** Stop reporting. Idempotent. */
  disableMouse(): void
  readonly mouseOn: boolean
  /**
   * True while `suspend` is running its command — the window in which the user's own screen is back.
   *
   * Exposed because it is the one fact a FRAME has to consult: `writeFrame` drops what Ink draws for
   * as long as this is true, and an Ink frame erases the lines above itself before it draws, so one
   * arriving now would take the user's scrollback with it.
   */
  readonly suspended: boolean
  /**
   * Leave the alternate buffer, run `fn` against the real terminal, then re-enter.
   *
   * Used for commands whose output the user must actually see and that write to the tty
   * themselves (`stdio: 'inherit'`). The output scrolls the real buffer while it runs and is
   * gone once we re-enter — the caller is responsible for pausing first if it should be read.
   *
   * The MOUSE is handed over with the screen: a `docker compose build` running under a terminal we
   * left in tracking mode would receive `<35;40;12M` on its stdin every time the pointer moved. It
   * is restored afterwards only if it was on, so a suspension can never turn it on behind the
   * preference's back.
   *
   * Restores both even when `fn` throws; the error propagates unchanged.
   */
  suspend<T>(fn: () => Promise<T>): Promise<T>
}

export function createAltScreen(io: AltScreenIo): AltScreen {
  let active = false
  let mouseOn = false
  let handedOver = false

  const enter = () => {
    if (active) return
    active = true
    io.write(ENTER + HIDE_CURSOR)
  }

  const enableMouse = () => {
    if (mouseOn) return
    mouseOn = true
    io.write(MOUSE_ON)
  }

  const disableMouse = () => {
    if (!mouseOn) return
    mouseOn = false
    io.write(MOUSE_OFF)
  }

  const leave = () => {
    // BEFORE the buffer, and outside the `active` guard. Some terminals tie mode state to the
    // buffer that was current when it was set, so tracking is turned off in the same buffer it was
    // turned on in; and a process that somehow holds tracking without the alternate screen must
    // still be able to give it back.
    disableMouse()
    if (!active) return
    active = false
    io.write(SHOW_CURSOR + LEAVE)
  }

  return {
    enter,
    leave,
    enableMouse,
    disableMouse,
    get active() { return active },
    get mouseOn() { return mouseOn },
    get suspended() { return handedOver },
    async suspend<T>(fn: () => Promise<T>): Promise<T> {
      const wasActive = active
      const wasMouse = mouseOn
      disableMouse()
      if (wasActive) leave()
      // Set AFTER the buffer is given up and cleared BEFORE it is taken back, so the gate is open
      // for exactly the window in which the terminal is not ours.
      handedOver = true
      try {
        return await fn()
      } finally {
        handedOver = false
        if (wasActive) enter()
        if (wasMouse) enableMouse()
      }
    },
  }
}

/**
 * The process-wide alternate screen, bound to stdout — and bound EARLY, on purpose.
 *
 * `process.stdout.write` is swapped out while an action runs (the host collects what it printed, or
 * streams it into a pane), and a mode-setting escape is not text: sent through a diversion it would
 * either vanish — stranding the terminal in a buffer, or leaving mouse tracking on after exit, which
 * is damage outside this process — or be rendered as characters inside a pane. Capturing the real
 * `write` at module load is what keeps these sequences reaching the terminal no matter what is
 * patched over the stream when they are sent.
 */
const realStdoutWrite = process.stdout.write.bind(process.stdout)

export const altScreen: AltScreen = createAltScreen({
  write: chunk => { realStdoutWrite(chunk) },
})

/**
 * The write Ink draws through — see `inkStdout` in `index.ts`, which hands it over.
 *
 * TWO GUARANTEES IN ONE FUNCTION, and both were learned the hard way:
 *
 *  - It bypasses `process.stdout.write`, which the host swaps out while an action runs. A frame
 *    written through a capture is a frame that vanishes (the screen freezes for the length of the
 *    action); a frame written through the STREAMING diversion is fed into the pane that is drawing
 *    it, and the pane fills with its own borders.
 *  - It DROPS the frame while a command is suspended. An Ink frame is not just text — it erases the
 *    lines above itself first — so a frame arriving while the user's real screen is back would take
 *    their scrollback with it. That protection used to come from the host muting
 *    `process.stdout.write`, which the bypass above would otherwise have quietly removed.
 */
export function createFrameWriter(
  write: (...args: unknown[]) => boolean,
  suspended: () => boolean,
): NodeJS.WriteStream['write'] {
  return ((...args: unknown[]): boolean => {
    // A faithful `write`, not a one-argument stand-in. Node's signature is
    // `write(chunk, encoding?, callback?)` and Ink's TEARDOWN uses the callback form: a callback that
    // never fires is a promise that never settles, which is how the first version of this gate turned
    // `q` into a hang — the app unmounted and the process sat there with the buffer still swapped in.
    const done = args.find(arg => typeof arg === 'function') as ((err?: Error | null) => void) | undefined
    if (suspended()) {
      // The frame is dropped; the writer waiting on it is not.
      if (done) queueMicrotask(() => done())
      return true
    }
    return write(...args)
  }) as NodeJS.WriteStream['write']
}

export const writeFrame = createFrameWriter(
  (...args) => (realStdoutWrite as (...a: unknown[]) => boolean)(...args),
  () => altScreen.suspended,
)

let guardsInstalled = false

/** Told about SIGINT/SIGTERM/SIGHUP so the app can unwind before the process goes. */
type ShutdownHook = (code: number) => void

let shutdownHook: ShutdownHook | null = null

/**
 * How long a registered hook gets before the process is killed anyway.
 *
 * Installing a signal listener disables Node's default terminate, so a teardown that wedges would
 * leave a process nothing short of SIGKILL can stop. The deadline is the escape hatch.
 */
const FORCE_EXIT_MS = 2000

/**
 * Route signals through `hook` instead of exiting on the spot; returns an unregister function.
 *
 * Leaving the alternate buffer is NOT enough on its own: a mounted Ink app tears itself down from
 * its own exit handler, and whatever it writes then lands on whichever buffer is current. Restore
 * first and that teardown frame is painted over the user's real terminal — Ink prefixes it with a
 * clear-scrollback, so the shell history above it is destroyed, which is worse than the stray
 * output the alternate screen exists to prevent. The hook lets the app unmount FIRST, exactly as
 * it does for `q`, and the buffer is left on the same path as every other exit.
 */
export function onAltScreenSignal(hook: ShutdownHook): () => void {
  shutdownHook = hook
  return () => { if (shutdownHook === hook) shutdownHook = null }
}

/**
 * Enter the alternate buffer and make sure it is left again no matter how the process ends.
 *
 * `exit` covers a normal return and `process.exit`; the signals cover a kill, which would
 * otherwise terminate us with the buffer still swapped in.
 */
export function enterAltScreenGuarded(): void {
  if (!guardsInstalled) {
    guardsInstalled = true
    const restore = () => { altScreen.leave() }
    process.on('exit', restore)
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      const code = sig === 'SIGINT' ? 130 : 143
      process.on(sig, () => {
        const hook = shutdownHook
        if (!hook) { restore(); process.exit(code) }
        hook(code)
        setTimeout(() => { restore(); process.exit(code) }, FORCE_EXIT_MS).unref()
      })
    }
  }
  altScreen.enter()
}
