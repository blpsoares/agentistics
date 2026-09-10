import { describe, expect, test } from 'bun:test'
import { createPaneResizer } from './paneResizeRequest'

function harness(scope: 'fleet' | 'shell' = 'fleet') {
  const sent: { url: string; body: unknown }[] = []
  let fire: (() => void) | null = null
  const r = createPaneResizer({
    scope, id: 's1',
    send: (url, body) => sent.push({ url, body: JSON.parse(body) }),
    setTimeout: (fn) => { fire = fn; return 1 as unknown as ReturnType<typeof setTimeout> },
    clearTimeout: () => { fire = null },
  })
  return { r, sent, tick: () => { const f = fire; fire = null; f?.() } }
}

describe('a drag is ONE request, not one per frame', () => {
  test('only the last geometry is sent', () => {
    const h = harness()
    h.r.request({ cols: 100, rows: 40 })
    h.r.request({ cols: 140, rows: 40 })
    h.r.request({ cols: 180, rows: 40 })
    expect(h.sent).toHaveLength(0)
    h.tick()
    expect(h.sent).toEqual([{ url: '/api/fleet/resize', body: { id: 's1', cols: 180, rows: 40 } }])
  })

  test('nothing is sent until the debounce fires', () => {
    const h = harness()
    h.r.request({ cols: 100, rows: 40 })
    expect(h.sent).toHaveLength(0)
  })
})

describe('each scope asks its own route', () => {
  test('a shell resize never reaches the fleet route', () => {
    const h = harness('shell')
    h.r.request({ cols: 100, rows: 40 })
    h.tick()
    expect(h.sent[0]!.url).toBe('/api/shell/resize')
  })
})

describe('cancel drops what was pending', () => {
  test('an unmount sends nothing', () => {
    const h = harness()
    h.r.request({ cols: 100, rows: 40 })
    h.r.cancel()
    h.tick()
    expect(h.sent).toHaveLength(0)
  })
})
