import { describe, expect, it } from 'bun:test'
import {
  BULK_STOP_OFF,
  bulkKillList,
  reduceBulkStop,
  rowMark,
  type BulkStopState,
} from './bulk-stop'
import type { ControlSession, SessionState } from './types'

const session = (id: string, over: Partial<ControlSession> = {}): ControlSession => ({
  id,
  title: id,
  harness: 'claude',
  cwd: `/repo/${id}`,
  project: id,
  state: 'working' as SessionState,
  stateLabel: 'working',
  actionable: true,
  attached: false,
  searchFields: { name: id, folder: '', harness: '', note: '', task: '', prompt: '' },
  ...over,
})

describe('reduceBulkStop — the mode is armed, selected, and left by itself', () => {
  it('enters with a fresh, empty selection', () => {
    const next = reduceBulkStop(BULK_STOP_OFF, { kind: 'enter' })
    expect(next.active).toBe(true)
    expect([...next.selection]).toEqual([])
  })

  it('never carries a stale selection into a new arming', () => {
    const dirty: BulkStopState = { active: false, selection: new Set(['a', 'b']) }
    const next = reduceBulkStop(dirty, { kind: 'enter' })
    expect([...next.selection]).toEqual([])
  })

  it('toggles ids only while armed', () => {
    let s = reduceBulkStop(BULK_STOP_OFF, { kind: 'enter' })
    s = reduceBulkStop(s, { kind: 'toggle', id: 'a' })
    s = reduceBulkStop(s, { kind: 'toggle', id: 'b' })
    expect([...s.selection].sort()).toEqual(['a', 'b'])
    s = reduceBulkStop(s, { kind: 'toggle', id: 'a' })
    expect([...s.selection]).toEqual(['b'])
  })

  it('ignores a toggle when not armed — a stray space seeds nothing', () => {
    const next = reduceBulkStop(BULK_STOP_OFF, { kind: 'toggle', id: 'a' })
    expect(next).toBe(BULK_STOP_OFF)
  })

  it('leaves without keeping anything (A7): the selection is discarded and the mode is off', () => {
    let s = reduceBulkStop(BULK_STOP_OFF, { kind: 'enter' })
    s = reduceBulkStop(s, { kind: 'toggle', id: 'a' })
    s = reduceBulkStop(s, { kind: 'toggle', id: 'b' })
    const left = reduceBulkStop(s, { kind: 'leave' })
    expect(left.active).toBe(false)
    expect([...left.selection]).toEqual([])
  })

  it('leaves by itself after executing (A6): mode off, selection empty, ready to pin again', () => {
    let s = reduceBulkStop(BULK_STOP_OFF, { kind: 'enter' })
    s = reduceBulkStop(s, { kind: 'toggle', id: 'a' })
    const done = reduceBulkStop(s, { kind: 'executed' })
    expect(done).toEqual(BULK_STOP_OFF)
    // A `space` after executing toggles nothing, because the mode is off — the caller pins instead.
    expect(reduceBulkStop(done, { kind: 'toggle', id: 'a' })).toBe(BULK_STOP_OFF)
  })
})

describe('rowMark — selected-for-stop outranks pinned (A4)', () => {
  it('reads a pinned-and-selected row as selected-for-stop', () => {
    expect(rowMark(true, true)).toBe('stop')
  })
  it('reads a pinned-only row as pinned', () => {
    expect(rowMark(true, false)).toBe('pinned')
  })
  it('reads a selected-only row as stop', () => {
    expect(rowMark(false, true)).toBe('stop')
  })
  it('reads a plain row as none', () => {
    expect(rowMark(false, false)).toBe('none')
  })
})

describe('bulkKillList — exactly the selection, never the pinned set, never the cursor (A5)', () => {
  it('resolves only the selected ids against the fleet', () => {
    const fleet = [session('cursor'), session('pinned'), session('a'), session('b')]
    // `a` and `b` are selected; `cursor` is under the cursor and `pinned` is pinned — neither counts.
    const targets = bulkKillList(fleet, new Set(['a', 'b']))
    expect(targets.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('drops a selected id that is no longer in the fleet', () => {
    const fleet = [session('a')]
    expect(bulkKillList(fleet, new Set(['a', 'gone'])).map(s => s.id)).toEqual(['a'])
  })

  it('is empty when nothing is selected', () => {
    const fleet = [session('a'), session('b')]
    expect(bulkKillList(fleet, new Set())).toEqual([])
  })
})
