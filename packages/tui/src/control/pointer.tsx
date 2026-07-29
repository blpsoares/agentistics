/**
 * pointer.tsx — how a mouse event reaches the thing under the pointer.
 *
 * `usePointer` is deliberately shaped like Ink's `useInput`: a handler plus an `isActive` flag, and
 * the component decides what the event means. That symmetry is the point — every screen already
 * gates its keyboard on the same flag, so the mouse cannot end up answered by a screen that is
 * mounted but hidden (all six are, so they keep their scroll positions), and a reviewer reading a
 * screen sees its two input paths side by side rather than one of them threaded through props.
 *
 * WHAT TRAVELS ON THE BUS IS ALREADY LOCAL. The shell resolves its own chrome, works out which frame
 * the pointer is in, and emits a `Pointer` in THAT frame — so a screen never sees a terminal
 * coordinate and never subtracts an offset it would have to keep in step with its own layout. Only
 * one screen is active at a time, so one frame per event is all that is ever needed.
 *
 * Several components can subscribe at once — a screen and the menu drawn inside it — and each
 * ignores what is not theirs. A click that lands on nothing does nothing, silently.
 */

import React, { createContext, useContext, useEffect, useRef } from 'react'
import type { MouseReport, Pointer } from './mouse'

export interface PointerBus {
  subscribe(handler: (p: Pointer) => void): () => void
  emit(p: Pointer): void
}

/**
 * Everything the shell needs from the mouse, as ONE value.
 *
 * The three halves are deliberately not three props: they are one feature that is either wired up or
 * absent, and a surface rendered outside `runControlCenter` — the preview script, a test — passes
 * nothing and gets a keyboard-only app rather than a half-connected one.
 *
 * `setTracking` is the shell's only reach into the escape sequences. Whether the mouse is ON is a
 * preference the component reads from the host; turning it on and off is `altScreen`'s, because that
 * is the module whose guarantee covers every way this process can end.
 */
export interface MouseChannel {
  /** Raw terminal reports. The SHELL subscribes: it is the only thing that knows the row bands. */
  onReport(handler: (report: MouseReport) => void): () => void
  /** Already-local events, for whatever the shell resolved the pointer to be over. */
  pointer: PointerBus
  setTracking(on: boolean): void
}

/** A bus with no listeners — what a surface rendered outside the control center gets. */
export function createPointerBus(): PointerBus {
  const handlers = new Set<(p: Pointer) => void>()
  return {
    subscribe(handler) {
      handlers.add(handler)
      return () => { handlers.delete(handler) }
    },
    emit(p) {
      // A copy, because a handler may unsubscribe as it runs — a menu that answers a click unmounts
      // itself, and mutating the set mid-iteration would skip whoever came after it.
      for (const handler of [...handlers]) handler(p)
    },
  }
}

const PointerContext = createContext<PointerBus | null>(null)

export function PointerProvider({ bus, children }: { bus: PointerBus; children: React.ReactNode }) {
  return <PointerContext.Provider value={bus}>{children}</PointerContext.Provider>
}

/**
 * Handle pointer events while `isActive`, in whatever frame the shell is emitting.
 *
 * The handler is held in a ref and the subscription is made once per bus: a handler rebuilt on every
 * render — which it is, since it closes over the selection — would otherwise resubscribe on every
 * keystroke, and a `Set` churned that hard is the kind of thing that eventually drops an event under
 * a re-render.
 */
export function usePointer(
  handler: (p: Pointer) => void,
  options: { isActive?: boolean } = {},
): void {
  const bus = useContext(PointerContext)
  const isActive = options.isActive ?? true
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => {
    if (!bus || !isActive) return
    return bus.subscribe(p => { latest.current(p) })
  }, [bus, isActive])
}
