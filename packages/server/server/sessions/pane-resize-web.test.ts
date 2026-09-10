import { describe, expect, test } from 'bun:test'
import { createPaneResizer } from './pane-resize-web'
import { PANE_COLS, PANE_ROWS, SHELL_SOCKET, TMUX_SOCKET } from './tmux-cli'

const PANE = (cols: number, rows: number) => `3\t7\t${cols}\t${rows}\t0\t120`

function fake(paneOut: string, resizeCode = 0) {
  const calls: string[][] = []
  const run = async (args: string[]) => {
    calls.push(args)
    if (args.includes('display-message')) return { code: paneOut ? 0 : 1, out: paneOut, err: '' }
    return { code: resizeCode, out: '', err: '' }
  }
  return { calls, resize: createPaneResizer(run) }
}

describe('the resize reaches the right socket', () => {
  test('a shell is resized on the shell socket', async () => {
    const f = fake(PANE(120, 50))
    await f.resize('shell', 's1', { cols: 200, rows: 60 })
    for (const args of f.calls) expect(args.slice(0, 2)).toEqual(['-L', SHELL_SOCKET])
  })

  test('an assistant on the fleet socket', async () => {
    const f = fake(PANE(120, 50))
    await f.resize('fleet', 's1', { cols: 200, rows: 60 })
    for (const args of f.calls) expect(args.slice(0, 2)).toEqual(['-L', TMUX_SOCKET])
  })
})

describe('the outcome says what actually happened', () => {
  test('a pane that cannot be read is REPORTED, never guessed at', async () => {
    expect(await fake('').resize('shell', 's1', { cols: 100, rows: 40 }))
      .toEqual({ ok: false, reason: 'unreadable' })
  })

  test('nothing to change costs no resize call', async () => {
    const f = fake(PANE(120, 50))
    expect(await f.resize('shell', 's1', { cols: 120, rows: 50 })).toEqual({ ok: true, changed: false })
    expect(f.calls.some(a => a.includes('resize-window'))).toBe(false)
  })

  test('a clamp reports what the pane BECAME, not what was asked for', async () => {
    // A phone asking for 40x20 gets the floor, and the caller is told the real numbers rather than
    // its own request echoed back.
    const f = fake(PANE(200, 80))
    expect(await f.resize('fleet', 's1', { cols: 40, rows: 20 }))
      .toEqual({ ok: true, changed: true, cols: PANE_COLS, rows: PANE_ROWS })
  })

  test('tmux refusing is a failure, not a silent success', async () => {
    expect(await fake(PANE(120, 50), 1).resize('shell', 's1', { cols: 200, rows: 60 }))
      .toEqual({ ok: false, reason: 'failed' })
  })
})
