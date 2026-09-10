/**
 * paneResizeRequest.ts — the browser half of "make the pane fit the box".
 *
 * The emulator reports a geometry on every layout change (`SessionTerminal`'s `onGeometry`), and a
 * dragged divider produces one of those per animation frame. So this DEBOUNCES, keeps only the
 * latest, and never has two requests in flight for one pane.
 *
 * It is deliberately fire-and-forget in the UI's terms: a resize that fails changes nothing on
 * screen — the terminal keeps rendering the pane exactly as it is — so there is no honest sentence
 * to show and nothing for the reader to do. That is the opposite of the WRITE channel, where a
 * keystroke that did not land must be said out loud.
 */

import type { TerminalScope } from './terminalEndpoint'

/** Long enough that a drag settles, short enough that a single layout change feels immediate. */
export const RESIZE_DEBOUNCE_MS = 250

export interface PaneResizer {
  /** Ask for this geometry. Later calls replace an unsent earlier one. */
  request(g: { cols: number; rows: number }): void
  /** Drop anything pending — call on unmount. */
  cancel(): void
}

export function createPaneResizer(o: {
  scope: TerminalScope
  id: string
  /** Injected so the debounce and the coalescing are testable without a network or a clock. */
  send?: (url: string, body: string) => void
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (h: never) => void
}): PaneResizer {
  const setT = (o.setTimeout ?? setTimeout) as (fn: () => void, ms: number) => unknown
  const clearT = (o.clearTimeout ?? clearTimeout) as (h: unknown) => void
  const url = o.scope === 'shell' ? '/api/shell/resize' : '/api/fleet/resize'
  const send = o.send ?? ((u, body) => {
    void fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .catch(() => {})
  })
  let handle: unknown = null
  let pending: { cols: number; rows: number } | null = null

  return {
    request(g) {
      pending = g
      if (handle !== null) clearT(handle)
      handle = setT(() => {
        handle = null
        const g2 = pending
        pending = null
        if (g2) send(url, JSON.stringify({ id: o.id, cols: g2.cols, rows: g2.rows }))
      }, RESIZE_DEBOUNCE_MS)
    },
    cancel() {
      if (handle !== null) { clearT(handle); handle = null }
      pending = null
    },
  }
}
