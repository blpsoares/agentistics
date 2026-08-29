import { describe, test, expect } from 'bun:test'
import {
  INITIAL_TERMINAL_STATE,
  terminalReducer,
  parseOpen,
  parseFrame,
  parseEnd,
  terminalStatus,
  watchableFleetRows,
  xtermTheme,
  type TerminalFrame,
  type TerminalState,
} from './terminalStream'

const frame = (over: Partial<TerminalFrame> = {}): TerminalFrame => ({
  seq: 1,
  content: 'hello',
  cols: 80,
  rows: 24,
  cursor: { x: 0, y: 0 },
  alive: true,
  lines: 1,
  historyLimit: 50000,
  truncated: false,
  ...over,
})

describe('parseOpen / parseFrame / parseEnd', () => {
  test('parseOpen reads the documented shape', () => {
    expect(parseOpen('{"id":"3f5f","viewLines":200,"historyLimit":50000}')).toEqual({
      id: '3f5f',
      viewLines: 200,
      historyLimit: 50000,
    })
  })

  test('parseFrame keeps SGR escapes intact and the cursor', () => {
    const raw = JSON.stringify(frame({ content: '[35mclaude[0m', cursor: { x: 6, y: 12 } }))
    const f = parseFrame(raw)!
    expect(f.content).toBe('[35mclaude[0m')
    expect(f.cursor).toEqual({ x: 6, y: 12 })
    expect(f.alive).toBe(true)
  })

  test('parseFrame accepts a null cursor on a dead frame', () => {
    const f = parseFrame(JSON.stringify(frame({ alive: false, cursor: null })))!
    expect(f.cursor).toBeNull()
    expect(f.alive).toBe(false)
  })

  test('malformed payloads return null rather than throwing', () => {
    expect(parseOpen('not json')).toBeNull()
    expect(parseFrame('{"seq":1}')).toBeNull() // missing content
    expect(parseFrame('42')).toBeNull()
    expect(parseEnd('{"reason":"whatever"}')).toBeNull() // not an allowed reason
  })

  test('parseEnd reads the three allowed reasons', () => {
    expect(parseEnd('{"reason":"gone"}')).toBe('gone')
    expect(parseEnd('{"reason":"not-found"}')).toBe('not-found')
    expect(parseEnd('{"reason":"error"}')).toBe('error')
  })
})

describe('terminalReducer', () => {
  test('connecting clears any previous frame — no leak between sessions', () => {
    const dirty: TerminalState = {
      phase: 'streaming',
      open: { id: 'a', viewLines: 200, historyLimit: 50000 },
      frame: frame({ content: 'SESSION-A-SECRET' }),
      endReason: null,
    }
    const next = terminalReducer(dirty, { type: 'connecting' })
    expect(next.frame).toBeNull()
    expect(next.open).toBeNull()
    expect(next.phase).toBe('connecting')
    expect(next.endReason).toBeNull()
  })

  test('a live frame moves to streaming', () => {
    const next = terminalReducer({ ...INITIAL_TERMINAL_STATE, phase: 'connecting' }, { type: 'frame', frame: frame() })
    expect(next.phase).toBe('streaming')
    expect(next.frame?.content).toBe('hello')
  })

  test('an alive:false frame is FINISHED, not streaming, but stays readable', () => {
    const next = terminalReducer(
      { ...INITIAL_TERMINAL_STATE, phase: 'streaming' },
      { type: 'frame', frame: frame({ alive: false, cursor: null, content: 'done' }) },
    )
    expect(next.phase).toBe('finished')
    expect(next.frame?.content).toBe('done')
  })

  test('end keeps the last frame and records the reason', () => {
    const streaming = terminalReducer(INITIAL_TERMINAL_STATE, { type: 'frame', frame: frame({ content: 'last screen' }) })
    const ended = terminalReducer(streaming, { type: 'end', reason: 'gone' })
    expect(ended.phase).toBe('ended')
    expect(ended.endReason).toBe('gone')
    expect(ended.frame?.content).toBe('last screen') // the last thing it drew stays on screen
  })

  test('reset returns to idle', () => {
    const s = terminalReducer({ ...INITIAL_TERMINAL_STATE, phase: 'streaming', frame: frame() }, { type: 'reset' })
    expect(s).toEqual(INITIAL_TERMINAL_STATE)
  })
})

describe('terminalStatus — the honesty line', () => {
  test('idle prompts for a selection', () => {
    const st = terminalStatus(INITIAL_TERMINAL_STATE, 'en')
    expect(st.tone).toBe('idle')
  })

  test('a live frame says it is the CURRENT screen and shows the cursor', () => {
    const state = terminalReducer(INITIAL_TERMINAL_STATE, { type: 'frame', frame: frame({ lines: 42 }) })
    const st = terminalStatus(state, 'en')
    expect(st.tone).toBe('live')
    expect(st.showCursor).toBe(true)
    expect(st.label.toLowerCase()).toContain('live')
    expect(st.detail).toContain('42')
  })

  test('truncated history is disclosed, not hidden', () => {
    const state = terminalReducer(INITIAL_TERMINAL_STATE, { type: 'frame', frame: frame({ truncated: true, lines: 200 }) })
    const st = terminalStatus(state, 'en')
    expect(st.truncated).toBe(true)
  })

  test('a finished session never shows a cursor and reads as finished', () => {
    const state = terminalReducer(INITIAL_TERMINAL_STATE, { type: 'frame', frame: frame({ alive: false, cursor: null }) })
    const st = terminalStatus(state, 'en')
    expect(st.tone).toBe('finished')
    expect(st.showCursor).toBe(false)
  })

  test('a gone session is signalled, not frozen — and draws no cursor', () => {
    const streaming = terminalReducer(INITIAL_TERMINAL_STATE, { type: 'frame', frame: frame() })
    const state = terminalReducer(streaming, { type: 'end', reason: 'gone' })
    const st = terminalStatus(state, 'en')
    expect(st.tone).toBe('ended')
    expect(st.showCursor).toBe(false)
  })

  test('pt and en differ', () => {
    const state = terminalReducer(INITIAL_TERMINAL_STATE, { type: 'frame', frame: frame() })
    expect(terminalStatus(state, 'pt').label).not.toBe(terminalStatus(state, 'en').label)
  })
})

describe('watchableFleetRows', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'x', title: 't', harness: 'claude', cwd: '/', project: 'p',
    state: 'working', stateLabel: 'working', actionable: true, attachCommand: '', verbs: [],
    ...over,
  }) as never

  test('keeps sessions that have a live pane', () => {
    const rows = [
      row({ id: 'a', state: 'working' }),
      row({ id: 'b', state: 'waiting' }),
      row({ id: 'c', state: 'waiting-approval' }),
    ]
    expect(watchableFleetRows(rows).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  test('drops rows that have no tmux pane to read', () => {
    const rows = [
      row({ id: 'a', state: 'working' }),
      row({ id: 'closed', state: 'closed' }),
      row({ id: 'lost', state: 'lost' }),
    ]
    expect(watchableFleetRows(rows).map(r => r.id)).toEqual(['a'])
  })
})

describe('xtermTheme', () => {
  test('light and dark are different, opaque backgrounds', () => {
    const d = xtermTheme('dark')
    const l = xtermTheme('light')
    expect(d.background).not.toBe(l.background)
    expect(typeof d.foreground).toBe('string')
  })
})
