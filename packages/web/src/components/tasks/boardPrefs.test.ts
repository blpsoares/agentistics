import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readBoardPrefs, writeBoardPrefs } from './boardPrefs'

// The board's arrangement is `localStorage`, and the accessor can THROW (a private window). A tiny
// in-memory stand-in is enough: what is under test is what the reader keeps and what it drops.
const store = new Map<string, string>()
const g = globalThis as unknown as { localStorage?: unknown }
let saved: unknown

beforeEach(() => {
  store.clear()
  saved = g.localStorage
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
  }
})
afterEach(() => { g.localStorage = saved })

describe('boardPrefs.columnSort', () => {
  it('defaults to no per-column order', () => {
    expect(readBoardPrefs().columnSort).toEqual({})
  })

  it('round-trips a column order beside the board order', () => {
    writeBoardPrefs({ columnSort: { todo: { key: 'cost', dir: 'desc' } } })
    const p = readBoardPrefs()
    expect(p.columnSort).toEqual({ todo: { key: 'cost', dir: 'desc' } })
    expect(p.sort).toEqual({ key: 'manual', dir: 'asc' })
  })

  it('drops entries that are not a sort, and tolerates a stored non-object', () => {
    store.set('agentistics-task-board-v1', JSON.stringify({
      columnSort: { ok: { key: 'title', dir: 'asc' }, junk: 'x', empty: null, nokey: { dir: 'asc' } },
    }))
    expect(readBoardPrefs().columnSort).toEqual({ ok: { key: 'title', dir: 'asc' } })
    store.set('agentistics-task-board-v1', JSON.stringify({ columnSort: ['a'] }))
    expect(readBoardPrefs().columnSort).toEqual({})
    store.set('agentistics-task-board-v1', JSON.stringify({ columnSort: 'no' }))
    expect(readBoardPrefs().columnSort).toEqual({})
  })

  it('an unreadable store falls back to the defaults instead of throwing', () => {
    g.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readBoardPrefs().columnSort).toEqual({})
    expect(() => writeBoardPrefs({ columnSort: {} })).not.toThrow()
  })
})
