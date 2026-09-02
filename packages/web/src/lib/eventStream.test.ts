import { describe, test, expect } from 'bun:test'
import { createEventStream, sharedEventStream, type EventSourceLike } from './eventStream'

/**
 * A fake EventSource that records how many times it was constructed and closed, and lets a test
 * dispatch a named event to whatever listeners the stream attached. This is the unit-level stand-in
 * for the browser socket; the production-build spy in the QA recipe measures the real thing.
 */
class FakeES implements EventSourceLike {
  static constructed = 0
  static live = 0
  closed = false
  onerror: ((ev: Event) => void) | null = null
  private handlers = new Map<string, Set<(ev: Event) => void>>()
  constructor(public url: string) { FakeES.constructed++; FakeES.live++ }
  addEventListener(type: string, listener: (ev: Event) => void): void {
    let set = this.handlers.get(type)
    if (!set) { set = new Set(); this.handlers.set(type, set) }
    set.add(listener)
  }
  removeEventListener(type: string, listener: (ev: Event) => void): void {
    this.handlers.get(type)?.delete(listener)
  }
  close(): void { if (!this.closed) { this.closed = true; FakeES.live-- } }
  /** Test-only: how many app-facing DOM listeners are attached for a type. */
  handlerCount(type: string): number { return this.handlers.get(type)?.size ?? 0 }
  /** Test-only: fire a named event to the attached listeners. */
  emit(type: string): void {
    for (const l of [...(this.handlers.get(type) ?? [])]) l({ type } as Event)
  }
}

function freshFactory() {
  FakeES.constructed = 0
  FakeES.live = 0
  const sockets: FakeES[] = []
  const make = (u: string) => { const s = new FakeES(u); sockets.push(s); return s }
  return { make, sockets }
}

describe('createEventStream — one shared socket', () => {
  // A1 (mechanism): N subscribers, ONE underlying connection.
  test('many subscribers open exactly one connection', () => {
    const { make } = freshFactory()
    const stream = createEventStream('/api/events', make)
    stream.subscribe('change', () => {})
    stream.subscribe('change', () => {})
    stream.subscribe('notification', () => {})
    expect(FakeES.constructed).toBe(1)
    expect(FakeES.live).toBe(1)
    expect(stream.subscriberCount).toBe(3)
    expect(stream.connected).toBe(true)
  })

  test('the socket is opened lazily — no subscriber, no connection', () => {
    const { make } = freshFactory()
    const stream = createEventStream('/api/events', make)
    expect(FakeES.constructed).toBe(0)
    expect(stream.connected).toBe(false)
  })

  // A2 (mechanism): both consumers receive the same single event.
  test('one emitted event reaches every subscriber of that type', () => {
    const { make, sockets } = freshFactory()
    const stream = createEventStream('/api/events', make)
    let a = 0, b = 0
    stream.subscribe('change', () => { a++ })
    stream.subscribe('change', () => { b++ })
    // Exactly one DOM listener is attached to the real socket for the type; it fans out.
    expect(sockets[0]!.handlerCount('change')).toBe(1)
    sockets[0]!.emit('change')
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  test('a listener only hears its own event type', () => {
    const { make, sockets } = freshFactory()
    const stream = createEventStream('/api/events', make)
    let change = 0, notif = 0
    stream.subscribe('change', () => { change++ })
    stream.subscribe('notification', () => { notif++ })
    sockets[0]!.emit('change')
    expect(change).toBe(1)
    expect(notif).toBe(0)
    sockets[0]!.emit('notification')
    expect(change).toBe(1)
    expect(notif).toBe(1)
  })

  // A3: one consumer unmounting must not tear down the socket the other still uses.
  test('unsubscribing one of two keeps the socket open for the remaining consumer', () => {
    const { make, sockets } = freshFactory()
    const stream = createEventStream('/api/events', make)
    let remaining = 0
    const off = stream.subscribe('change', () => {})
    stream.subscribe('change', () => { remaining++ })
    off() // the first consumer leaves
    expect(stream.connected).toBe(true)
    expect(sockets[0]!.closed).toBe(false)
    expect(FakeES.live).toBe(1) // NOT closed and reopened
    sockets[0]!.emit('change')
    expect(remaining).toBe(1) // the survivor still receives
  })

  test('the last subscriber leaving closes the one socket', () => {
    const { make, sockets } = freshFactory()
    const stream = createEventStream('/api/events', make)
    const off1 = stream.subscribe('change', () => {})
    const off2 = stream.subscribe('notification', () => {})
    off1()
    expect(stream.connected).toBe(true)
    off2()
    expect(stream.connected).toBe(false)
    expect(sockets[0]!.closed).toBe(true)
    expect(FakeES.live).toBe(0)
  })

  test('resubscribing after full teardown opens a fresh single socket', () => {
    const { make } = freshFactory()
    const stream = createEventStream('/api/events', make)
    stream.subscribe('change', () => {})()  // subscribe then immediately leave
    expect(FakeES.constructed).toBe(1)
    expect(stream.connected).toBe(false)
    stream.subscribe('change', () => {})
    expect(FakeES.constructed).toBe(2) // a new one, but still only ever one live
    expect(FakeES.live).toBe(1)
  })

  test('calling an unsubscribe twice is a no-op (ref count cannot go negative)', () => {
    const { make } = freshFactory()
    const stream = createEventStream('/api/events', make)
    const off = stream.subscribe('change', () => {})
    stream.subscribe('change', () => {})
    off()
    off() // second call must not decrement again and close the survivor's socket
    expect(stream.connected).toBe(true)
    expect(stream.subscriberCount).toBe(1)
  })

  test('a transient socket error does not close or reopen the socket', () => {
    const { make, sockets } = freshFactory()
    const stream = createEventStream('/api/events', make)
    stream.subscribe('change', () => {})
    sockets[0]!.onerror?.({ type: 'error' } as Event) // browser would auto-reconnect this same object
    expect(sockets[0]!.closed).toBe(false)
    expect(FakeES.constructed).toBe(1)
    expect(stream.connected).toBe(true)
  })
})

describe('sharedEventStream — cross-chunk singleton', () => {
  // The durable pitfall: a module-const is duplicated per Rollup chunk. Anchoring on globalThis
  // makes repeated resolutions return the SAME instance, so however many chunks import it, one socket.
  test('every call returns the identical instance', () => {
    const a = sharedEventStream()
    const b = sharedEventStream()
    expect(a).toBe(b)
  })
})
