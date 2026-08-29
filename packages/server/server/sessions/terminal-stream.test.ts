import { describe, expect, it } from 'bun:test'
import { buildFrame, captureDigest, encodeSse } from './terminal-stream'
import type { PaneInfo } from './types'

const info = (over: Partial<PaneInfo> = {}): PaneInfo => ({
  cols: 80, rows: 40, cursorX: 5, cursorY: 2, alive: true, historySize: 0, ...over,
})

describe('captureDigest', () => {
  it('is stable for an identical capture, so an unchanged frame is sent to nobody', () => {
    expect(captureDigest(['a', 'b'], info())).toBe(captureDigest(['a', 'b'], info()))
  })

  it('changes when the CONTENT changes', () => {
    expect(captureDigest(['a'], info())).not.toBe(captureDigest(['a', 'b'], info()))
  })

  it('changes when only the CURSOR moves — a still screen with a moved cursor still moved', () => {
    expect(captureDigest(['a'], info({ cursorX: 5 }))).not.toBe(captureDigest(['a'], info({ cursorX: 6 })))
  })

  it('changes when a line scrolled off into history though the visible text looks the same', () => {
    // historySize is part of the digest precisely so a tail-follower learns the pane moved.
    expect(captureDigest(['x'], info({ historySize: 10 }))).not.toBe(captureDigest(['x'], info({ historySize: 11 })))
  })

  it('changes when the pane dies', () => {
    expect(captureDigest(['x'], info({ alive: true }))).not.toBe(captureDigest(['x'], info({ alive: false })))
  })
})

describe('buildFrame', () => {
  const VIEW = 200

  it('joins the lines with newlines and carries the geometry', () => {
    const f = buildFrame(3, ['one', 'two'], info({ cols: 100, rows: 30 }), 50_000, VIEW)
    expect(f.seq).toBe(3)
    expect(f.content).toBe('one\ntwo')
    expect(f.cols).toBe(100)
    expect(f.rows).toBe(30)
    expect(f.lines).toBe(2)
    expect(f.historyLimit).toBe(50_000)
  })

  it('carries the cursor while alive', () => {
    expect(buildFrame(1, ['x'], info({ cursorX: 7, cursorY: 4 }), 100, VIEW).cursor).toEqual({ x: 7, y: 4 })
  })

  it('drops the cursor once the pane is dead — a cursor on a frozen frame is the frozen-looks-alive lie', () => {
    expect(buildFrame(1, ['x'], info({ alive: false }), 100, VIEW).cursor).toBeNull()
    expect(buildFrame(1, ['x'], info({ alive: false }), 100, VIEW).alive).toBe(false)
  })

  it('flags truncation when the pane holds more history than the shipped window', () => {
    // 300 lines of scrollback, only 200 shipped → there is more above the fold.
    expect(buildFrame(1, ['a'], info({ historySize: 300 }), 50_000, VIEW).truncated).toBe(true)
  })

  it('does not flag truncation when the whole backlog fits the window', () => {
    // 40 lines of scrollback, window of 200 → nothing is above the fold.
    expect(buildFrame(1, ['a'], info({ historySize: 40 }), 50_000, VIEW).truncated).toBe(false)
    expect(buildFrame(1, ['a'], info({ historySize: 0 }), 50_000, VIEW).truncated).toBe(false)
  })
})

describe('encodeSse', () => {
  it('frames one event with the trailing blank line the protocol needs', () => {
    expect(encodeSse('frame', { seq: 1 })).toBe('event: frame\ndata: {"seq":1}\n\n')
  })

  it('preserves ANSI escapes through JSON, so colours survive the wire', () => {
    const chunk = encodeSse('frame', { content: '\x1b[31mred\x1b[0m' })
    expect(chunk).toContain('\\u001b[31mred')
    expect(JSON.parse(chunk.split('data: ')[1]!.trim()).content).toBe('\x1b[31mred\x1b[0m')
  })
})
