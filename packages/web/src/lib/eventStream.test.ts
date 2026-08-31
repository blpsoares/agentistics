import { describe, test, expect } from 'bun:test'
import { createEventStream } from './eventStream'

/** A minimal fake EventSource that records lifecycle and lets a test emit named events. */
class FakeES {
  static instances: FakeES[] = []
  closed = false
  listeners = new Map<string, Set<(e: MessageEvent) => void>>()
  constructor() { FakeES.instances.push(this) }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(fn)
  }
  close() { this.closed = true }
  emit(type: string, data = '') {
    this.listeners.get(type)?.forEach(fn => fn({ data } as MessageEvent))
  }
}

function fresh() {
  FakeES.instances = []
  const stream = createEventStream(() => new FakeES() as unknown as EventSource)
  return { stream, live: () => FakeES.instances.filter(i => !i.closed), all: () => FakeES.instances }
}

describe('createEventStream — one shared socket, ref-counted', () => {
  test('the first subscriber opens exactly one socket', () => {
    const { stream, live } = fresh()
    stream.subscribe('change', () => {})
    expect(live().length).toBe(1)
  })

  test('two subscribers (different types) SHARE one socket — the whole point', () => {
    const { stream, all, live } = fresh()
    stream.subscribe('change', () => {})
    stream.subscribe('notification', () => {})
    expect(all().length).toBe(1)
    expect(live().length).toBe(1)
  })

  test('an event is delivered only to that type\'s handlers', () => {
    const { stream, all } = fresh()
    let change = 0, notif = 0
    stream.subscribe('change', () => { change++ })
    stream.subscribe('notification', () => { notif++ })
    const es = all()[0]!
    es.emit('change')
    es.emit('change')
    es.emit('notification')
    expect(change).toBe(2)
    expect(notif).toBe(1)
  })

  test('multiple handlers of the SAME type all fire', () => {
    const { stream, all } = fresh()
    let a = 0, b = 0
    stream.subscribe('change', () => { a++ })
    stream.subscribe('change', () => { b++ })
    all()[0]!.emit('change')
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  test('the socket closes only when the LAST subscriber leaves', () => {
    const { stream, live } = fresh()
    const off1 = stream.subscribe('change', () => {})
    const off2 = stream.subscribe('notification', () => {})
    off1()
    expect(live().length).toBe(1) // notification still holds it open
    off2()
    expect(live().length).toBe(0) // now nobody wants it
  })

  test('after everyone leaves, a new subscriber opens a fresh socket', () => {
    const { stream, all, live } = fresh()
    stream.subscribe('change', () => {})()  // subscribe then immediately unsubscribe
    expect(live().length).toBe(0)
    stream.subscribe('change', () => {})
    expect(all().length).toBe(2) // a second socket was created
    expect(live().length).toBe(1)
  })

  test('an unsubscribed handler no longer receives events', () => {
    const { stream, all } = fresh()
    let n = 0
    const off = stream.subscribe('change', () => { n++ })
    stream.subscribe('change', () => {}) // keep the socket open
    all()[0]!.emit('change')
    off()
    all()[0]!.emit('change')
    expect(n).toBe(1)
  })
})
