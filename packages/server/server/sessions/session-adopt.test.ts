import { describe, expect, test } from 'bun:test'
import type { HarnessSessionFile } from './harness-session-file'
import { planAdoptions } from './session-adopt'

const NOW = '2026-08-15T20:00:00.000Z'

function file(over: Partial<HarnessSessionFile> = {}): HarnessSessionFile {
  return { cwd: '/home/u/proj', sessionId: 'conv-1', name: 'renomeada', ...over }
}

function plan(
  rows: { id: string; status: string }[],
  entries: [string, HarnessSessionFile][] = [],
) {
  return planAdoptions({
    rows,
    byManagedId: new Map(entries),
    harness: 'claude',
    nowIso: NOW,
  })
}

describe('planAdoptions', () => {
  test('takes back a running session whose record is gone', () => {
    expect(plan([{ id: 'a2b569c123', status: 'unregistered' }], [['a2b569c123', file()]])).toEqual([{
      id: 'a2b569c123',
      harness: 'claude',
      cwd: '/home/u/proj',
      createdAt: NOW,
      label: 'renomeada',
      conversationId: 'conv-1',
    }])
  })

  test('leaves every other status alone — adoption is not reconciliation', () => {
    for (const status of ['running', 'exited', 'lost']) {
      expect(plan([{ id: 'x', status }], [['x', file()]])).toEqual([])
    }
  })

  test('an unregistered row with no harness record is left visible, never invented', () => {
    // No exact link. Filing it would mean guessing a directory, which is the error `repo-facts.ts`
    // exists to have stopped.
    expect(plan([{ id: 'orphan', status: 'unregistered' }])).toEqual([])
  })

  test('a harness record naming no directory is not enough', () => {
    expect(plan([{ id: 'x', status: 'unregistered' }], [['x', file({ cwd: undefined })]])).toEqual([])
    expect(plan([{ id: 'x', status: 'unregistered' }], [['x', file({ cwd: '' })]])).toEqual([])
  })

  test('a DERIVED name is never adopted as a label', () => {
    // `aipe-46` is not a name a person chose, and the registry outlives the process that invented it.
    const [rec] = plan(
      [{ id: 'x', status: 'unregistered' }],
      [['x', file({ name: 'aipe-46', nameSource: 'derived' })]],
    )
    expect(rec?.label).toBeUndefined()
    expect(rec?.cwd).toBe('/home/u/proj')
  })

  test('a record with no conversation id still adopts — the link is the tmux name', () => {
    const [rec] = plan([{ id: 'x', status: 'unregistered' }], [['x', file({ sessionId: undefined })]])
    expect(rec?.conversationId).toBeUndefined()
    expect(rec?.id).toBe('x')
  })

  test('nothing to do yields an empty list, so the caller can skip the write', () => {
    expect(plan([{ id: 'a', status: 'running' }, { id: 'b', status: 'lost' }])).toEqual([])
  })

  test('adopts several at once and only the linked ones', () => {
    const out = plan(
      [
        { id: 'linked', status: 'unregistered' },
        { id: 'orphan', status: 'unregistered' },
        { id: 'alive', status: 'running' },
      ],
      [['linked', file()], ['alive', file()]],
    )
    expect(out.map(r => r.id)).toEqual(['linked'])
  })

  test('createdAt is the moment of adoption, not the harness process start', () => {
    // The harness record's own timestamps describe the process holding the conversation NOW, which
    // after a takeover or a resume is not when the work began.
    const [rec] = plan([{ id: 'x', status: 'unregistered' }], [['x', file({ nameSince: 1 })]])
    expect(rec?.createdAt).toBe(NOW)
  })
})
