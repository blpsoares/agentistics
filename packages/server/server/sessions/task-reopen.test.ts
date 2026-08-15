import { describe, expect, it } from 'bun:test'
import { planTaskReopen, taskReopenSucceeded } from './task-reopen'
import type { ManagedSession } from './types'

const entry = (id: string, over: Partial<ManagedSession> = {}): ManagedSession => ({
  id, harness: 'claude', cwd: `/repo/${id}`, createdAt: '2026-08-13T10:00:00.000Z', ...over,
})

const conv = (sessionId: string, title = 'a conversation') => () => ({ sessionId, title })

describe('planTaskReopen', () => {
  it('leaves a RUNNING row alone, and does not call that a failure', () => {
    // After a reboot one session sometimes survives. Reopening the task must not spawn a second
    // copy of it, and reporting that as a skip announces a problem where there is none.
    const plan = planTaskReopen({
      entries: [entry('a'), entry('b')],
      liveIds: new Set(['a']),
      conversationFor: conv('c1'),
    })
    expect(plan.already).toEqual(['a'])
    expect(plan.skipped).toEqual([])
    expect(plan.reopen.map(r => r.entry.id)).toEqual(['b'])
    expect(taskReopenSucceeded(plan, 1)).toBe(true)
  })

  it('does not resurrect a row the user FINISHED', () => {
    // Ending a session is a decision; opening the task must not quietly undo every one of them.
    const plan = planTaskReopen({
      entries: [entry('a', { endedAt: '2026-08-13T11:00:00.000Z' })],
      liveIds: new Set(),
      conversationFor: conv('c1'),
    })
    expect(plan.reopen).toEqual([])
    expect(plan.skipped).toEqual([])
  })

  it('counts what it could not resolve, rather than reporting a partial reopen as a success', () => {
    const plan = planTaskReopen({
      entries: [entry('a'), entry('b')],
      liveIds: new Set(),
      conversationFor: e => (e.id === 'a' ? { sessionId: 'c1', title: 't' } : null),
    })
    expect(plan.skipped).toEqual(['b'])
    expect(taskReopenSucceeded(plan, 0)).toBe(false)
  })

  it("keeps the user's own label over the transcript's title", () => {
    // A reopen that renamed the row back to whatever the transcript called it undoes the rename
    // every single time.
    const plan = planTaskReopen({
      entries: [entry('a', { label: 'the auth work' }), entry('b')],
      liveIds: new Set(),
      conversationFor: conv('c1', 'Refactor the token store'),
    })
    expect(plan.reopen.map(r => r.label)).toEqual(['the auth work', 'Refactor the token store'])
  })

  it('keeps registry order, so a task comes back the way it was built', () => {
    const plan = planTaskReopen({
      entries: [entry('a'), entry('b'), entry('c')],
      liveIds: new Set(),
      conversationFor: conv('c1'),
    })
    expect(plan.reopen.map(r => r.entry.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('a conversation another live session already has', () => {
  it('is not opened a second time, and the row NAMES what has it', () => {
    // The measured defect: `liveIds` is keyed by ROW, so a row that is down while a DIFFERENT row
    // drives its conversation passed every check here — and the reopen put a second assistant into
    // a live transcript and a live working tree. Five conversations were in that state on this
    // machine on 2026-08-14.
    const plan = planTaskReopen({
      entries: [entry('a')],
      liveIds: new Set(),
      conversationFor: conv('c1'),
      inUse: new Map([['c1', { id: 'twin', label: 'the one already running it', kind: 'managed' as const }]]),
    })
    expect(plan.reopen).toEqual([])
    expect(plan.skipped).toEqual([])
    expect(plan.heldElsewhere).toEqual([
      { id: 'a', holder: { id: 'twin', label: 'the one already running it', kind: 'managed' as const } },
    ])
  })

  it('counts as the task being up, not as a failure', () => {
    // Nothing is missing after such a reopen: the work is on screen under another row. Reporting it
    // as a failure sends someone looking for a problem the refusal just prevented.
    const plan = planTaskReopen({
      entries: [entry('a')],
      liveIds: new Set(),
      conversationFor: conv('c1'),
      inUse: new Map([['c1', { id: 'twin', label: 'twin', kind: 'managed' as const }]]),
    })
    expect(taskReopenSucceeded(plan, 0)).toBe(true)
  })

  it('is judged on the conversation the RESOLVER picked, not the one the row remembers', () => {
    // The resolver decides which conversation this reopen would actually open — a row's recorded id
    // may be stale, and locking on it would refuse a reopen of something else entirely.
    const plan = planTaskReopen({
      entries: [entry('a', { conversationId: 'stale' })],
      liveIds: new Set(),
      conversationFor: conv('c1'),
      inUse: new Map([['stale', { id: 'twin', label: 'twin', kind: 'managed' as const }]]),
    })
    expect(plan.reopen.map(r => r.resumeId)).toEqual(['c1'])
    expect(plan.heldElsewhere).toEqual([])
  })

  it('never refuses a row because of its own id', () => {
    const plan = planTaskReopen({
      entries: [entry('a')],
      liveIds: new Set(),
      conversationFor: conv('c1'),
      inUse: new Map([['c1', { id: 'a', label: 'itself', kind: 'managed' as const }]]),
    })
    expect(plan.reopen.map(r => r.entry.id)).toEqual(['a'])
    expect(plan.heldElsewhere).toEqual([])
  })

  it('degrades to the old behaviour when nothing could be established', () => {
    // Absent is "we do not know", never "everything is free" — but a caller that cannot look must
    // still be able to reopen, or an unreadable registry would take the verb down with it.
    const plan = planTaskReopen({
      entries: [entry('a')],
      liveIds: new Set(),
      conversationFor: conv('c1'),
    })
    expect(plan.reopen.map(r => r.entry.id)).toEqual(['a'])
    expect(plan.heldElsewhere).toEqual([])
  })
})
