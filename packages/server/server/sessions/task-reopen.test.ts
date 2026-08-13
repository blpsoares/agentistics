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
