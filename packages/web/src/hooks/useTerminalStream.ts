/**
 * useTerminalStream — the EventSource wiring for the live terminal read channel.
 *
 * The pure decisions (what each event means, what the user is told) live in `lib/terminalStream.ts`.
 * This hook is the thin, impure glue: open `GET /api/fleet/stream?id=<id>` as SSE, funnel its named
 * `open`/`frame`/`end` events through the reducer, and tear the connection down when the id changes
 * or the component unmounts.
 *
 * Two things it is careful about:
 *  - **No leak between sessions.** When `id` changes it dispatches `connecting` FIRST (which drops
 *    the previous frame) before opening the new stream, so one session's screen can never be shown
 *    under another session's name for even a single render.
 *  - **`end` closes the socket.** EventSource reconnects on its own after any drop; that is right for
 *    a transient network blip, but an `end` event is the channel saying the session is GONE, so we
 *    close the socket to stop it silently reopening a stream the server has finished.
 */

import { useEffect, useReducer } from 'react'
import {
  INITIAL_TERMINAL_STATE,
  terminalReducer,
  parseOpen,
  parseFrame,
  parseEnd,
  type TerminalState,
} from '../lib/terminalStream'

export function useTerminalStream(id: string | null): TerminalState {
  const [state, dispatch] = useReducer(terminalReducer, INITIAL_TERMINAL_STATE)

  useEffect(() => {
    if (!id) {
      dispatch({ type: 'reset' })
      return
    }

    // Fresh id → clear any previous session's frame before a single byte of the new one arrives.
    dispatch({ type: 'connecting' })

    const es = new EventSource(`/api/fleet/stream?id=${encodeURIComponent(id)}`)

    // The server sends a NAMED `open` event, which collides with EventSource's own native
    // connection-open event. The native one carries no `data`; the server's does — so branch on it.
    es.addEventListener('open', (e: MessageEvent) => {
      if (!e.data) return
      const open = parseOpen(e.data)
      if (open) dispatch({ type: 'open', open })
    })

    es.addEventListener('frame', (e: MessageEvent) => {
      const frame = parseFrame(e.data)
      if (frame) dispatch({ type: 'frame', frame })
    })

    es.addEventListener('end', (e: MessageEvent) => {
      const reason = parseEnd(e.data) ?? 'error'
      dispatch({ type: 'end', reason })
      // GONE means gone — do not let EventSource reopen a stream the server has closed for good.
      es.close()
    })

    // Native errors (a dropped connection) are left to EventSource's own auto-reconnect. We do NOT
    // blank the screen here: the last frame stays on show until a real new frame replaces it, so a
    // momentary blip does not read as "the session died".

    return () => es.close()
  }, [id])

  return state
}
