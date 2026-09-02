/**
 * eventStream — ONE shared connection to the `/api/events` SSE broadcast for the whole app.
 *
 * The browser caps simultaneous connections per origin; every extra socket to the same
 * broadcast endpoint spends a slot the rest of the page needs. `/api/events` carries only
 * NAMED, body-less signals (`change`, `notification`) — the arrival is the whole message, the
 * `data` frame is deliberately ignored by every consumer — so a single connection fanned out
 * to N listeners is exactly equivalent to N connections: each listener still hears every event.
 * Before this, three independent consumers (`useData`, `useNotificationStream`, `TeamMembers`)
 * each opened their own `EventSource('/api/events')`, so opening the dashboard cost two-plus
 * connection slots where one is enough.
 *
 * WHY the instance is anchored on `globalThis` and NOT a module-level `const`:
 * Rollup DUPLICATES a small shared module into each chunk that imports it. A
 * `const stream = createEventStream(...)` at module scope therefore becomes ONE INSTANCE PER
 * CHUNK — three importing chunks, three sockets, the very bug this file exists to remove. The
 * bug is invisible under `bun run dev` (one module graph) and only appears on the production
 * build. Anchoring the single instance on `globalThis` makes it a true cross-chunk singleton,
 * so however many chunks Rollup emits, there is exactly one socket.
 *
 * Lifecycle: ref-counted. The socket is opened lazily on the first subscriber and closed only
 * when the LAST subscriber leaves. A consumer unmounting while another stays mounted never
 * tears down the shared socket — that classic socket-dedup failure mode is what the ref count
 * prevents.
 */

/** A subscriber's callback. The SSE frame is passed through, but every current consumer treats
 *  the event's mere arrival as the signal and ignores the payload (see `useNotificationStream`). */
export type EventStreamListener = (ev: MessageEvent) => void

/** The minimal EventSource surface this module uses — narrow enough for a test fake to implement. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (ev: Event) => void): void
  removeEventListener(type: string, listener: (ev: Event) => void): void
  close(): void
  onerror: ((ev: Event) => void) | null
}

export interface SharedEventStream {
  /** Subscribe to a named event. Returns an unsubscribe function; calling it twice is a no-op. */
  subscribe(type: string, listener: EventStreamListener): () => void
  /** Live subscriber count — for tests and diagnostics only. */
  readonly subscriberCount: number
  /** Whether the underlying socket is currently open — for tests and diagnostics only. */
  readonly connected: boolean
}

/**
 * Build a ref-counted shared stream over a single connection created by `makeES(url)`.
 *
 * Pure and dependency-free: the socket factory is injected, so a test drives it with a fake
 * EventSource and never touches the DOM. The app calls {@link sharedEventStream}, which supplies
 * the real `EventSource` and the `globalThis` anchor.
 */
export function createEventStream(
  url: string,
  makeES: (url: string) => EventSourceLike,
): SharedEventStream {
  let es: EventSourceLike | null = null
  let refCount = 0
  // One Set of app listeners per event type…
  const listeners = new Map<string, Set<EventStreamListener>>()
  // …and exactly one real DOM listener per type on the underlying socket, which fans out.
  const domHandlers = new Map<string, (ev: Event) => void>()

  function attachDom(type: string): void {
    if (!es || domHandlers.has(type)) return
    const handler = (ev: Event) => {
      const set = listeners.get(type)
      if (!set) return
      // Copy so a listener that unsubscribes during dispatch can't mutate the set mid-iteration.
      for (const l of [...set]) l(ev as MessageEvent)
    }
    domHandlers.set(type, handler)
    es.addEventListener(type, handler)
  }

  function ensureOpen(): void {
    if (es) return
    es = makeES(url)
    // The browser auto-reconnects the SAME EventSource on a transient error; keep it, do not
    // close and reopen — the DOM listeners stay attached across the reconnect.
    es.onerror = () => { /* browser auto-reconnects; ignore */ }
    for (const type of listeners.keys()) attachDom(type)
  }

  function closeSocket(): void {
    if (es) {
      for (const [type, handler] of domHandlers) es.removeEventListener(type, handler)
      es.close()
    }
    es = null
    domHandlers.clear()
  }

  return {
    subscribe(type, listener) {
      let set = listeners.get(type)
      if (!set) { set = new Set(); listeners.set(type, set) }
      set.add(listener)
      refCount++
      ensureOpen()
      attachDom(type)

      let active = true
      return () => {
        if (!active) return
        active = false
        set!.delete(listener)
        refCount--
        if (refCount <= 0) closeSocket()
      }
    },
    get subscriberCount() { return refCount },
    get connected() { return es !== null },
  }
}

const GLOBAL_KEY = '__agentistics_event_stream__'

/**
 * The app's one shared `/api/events` stream. Anchored on `globalThis` so it survives Rollup
 * chunk duplication (see the file header). Every consumer calls this and subscribes; none
 * constructs an `EventSource('/api/events')` of its own.
 */
export function sharedEventStream(): SharedEventStream {
  const g = globalThis as unknown as Record<string, SharedEventStream | undefined>
  return (g[GLOBAL_KEY] ??= createEventStream('/api/events', (u) => new EventSource(u)))
}
