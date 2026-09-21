import { describe, expect, it } from 'bun:test'
import { selectSharedTasks, toSharedTask, type ShareInputs } from './task-share'
import { rowsOfTask } from './task-report'
import type { Subtask, Task, TaskComment, TaskFile } from './task-model'
import type { ManagedSession } from './types'

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'a delivery', status: 'in_progress',
  createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z',
  ...over,
})

const row = (over: Partial<ManagedSession> = {}): ManagedSession => ({
  id: 'r1', harness: 'claude', cwd: '/repo', createdAt: '2026-09-05T10:00:00.000Z',
  taskId: 't1', conversationId: 'c1',
  ...over,
} as ManagedSession)

const inputs = (over: Partial<ShareInputs> = {}): ShareInputs => ({
  tasks: [task({ shared: true })],
  rows: [row()],
  comments: [],
  subtasks: [],
  files: [],
  sharedIds: new Set(['c1']),
  knownIds: new Set(['c1']),
  rowsOf: rowsOfTask,
  ...over,
})

describe('selectSharedTasks', () => {
  it('sends a conversation under ONE delivery only, the one it was last filed on', () => {
    // Filing is a move written on one row: the older row still names t1. Both deliveries used to
    // ship the conversation, and the central then priced it under each.
    const out = selectSharedTasks(inputs({
      tasks: [task({ id: 't1', shared: true }), task({ id: 't2', title: 'other', shared: true })],
      rows: [
        row({ id: 'r-old', taskId: 't1', createdAt: '2026-09-05T09:00:00.000Z' }),
        row({ id: 'r-new', taskId: 't2', createdAt: '2026-09-05T11:00:00.000Z' }),
      ],
    }))
    expect(out.map(s => [s.task.id, s.sessionIds])).toEqual([['t1', []], ['t2', ['c1']]])
  })

  it('sends nothing when nobody said to share', () => {
    // Absent reads as NOT shared — the `chat-gate.ts` rule, never the `shareMode` one.
    expect(selectSharedTasks(inputs({ tasks: [task()] }))).toEqual([])
    expect(selectSharedTasks(inputs({ tasks: [task({ shared: false })] }))).toEqual([])
  })

  it('sends a shared task', () => {
    const out = selectSharedTasks(inputs())
    expect(out).toHaveLength(1)
    expect(out[0]!.task.title).toBe('a delivery')
  })

  it('omits an unshared task entirely rather than sending it empty', () => {
    const out = selectSharedTasks(inputs({
      tasks: [task({ id: 't1', shared: true }), task({ id: 't2', title: 'private', shared: false })],
      rows: [row({ id: 'r1', taskId: 't1' })],
    }))
    expect(out.map(s => s.task.id)).toEqual(['t1'])
  })
})

describe('toSharedTask', () => {
  it('ships the record and NO sessions when the repository rules withhold them', () => {
    // Sharing a task may never widen what a repository rule already withholds.
    const out = toSharedTask(task({ shared: true }), inputs({ sharedIds: new Set() }))
    expect(out.sessionIds).toEqual([])
    expect(out.sessionsWithheld).toBe(1)
  })

  it('counts as withheld only what this machine actually measured', () => {
    // A conversation the store never heard of was not withheld from anybody — reporting it as a
    // shortfall would blame the connection for a session nobody ever had.
    const out = toSharedTask(task({ shared: true }), inputs({
      rows: [row({ id: 'r1', conversationId: 'c1' }), row({ id: 'r2', conversationId: 'unknown' })],
      sharedIds: new Set(),
      knownIds: new Set(['c1']),
    }))
    expect(out.sessionIds).toEqual([])
    expect(out.sessionsWithheld).toBe(1)
  })

  it('counts a withheld CONVERSATION once, however many rows a reopening left behind', () => {
    // `sessionsWithheld` is a count of SESSIONS: the central prints it as "measured short by N".
    // Four rows of one withheld conversation are one withheld session, not four.
    const out = toSharedTask(task({ shared: true }), inputs({
      rows: [
        row({ id: 'r1', conversationId: 'c1' }),
        row({ id: 'r2', conversationId: 'c1' }),
        row({ id: 'r3', conversationId: 'c1' }),
        row({ id: 'r4', conversationId: 'c2' }),
      ],
      sharedIds: new Set(),
      knownIds: new Set(['c1', 'c2']),
    }))
    expect(out.sessionsWithheld).toBe(2)
  })

  it('ships each shared session once, and never a row with no conversation', () => {
    const out = toSharedTask(task({ shared: true }), inputs({
      rows: [
        row({ id: 'r1', conversationId: 'c1' }),
        row({ id: 'r2', conversationId: 'c1' }),
        row({ id: 'r3', conversationId: undefined }),
      ],
    }))
    expect(out.sessionIds).toEqual(['c1'])
    expect(out.sessionsWithheld).toBe(0)
  })

  it('carries the board a delivery hangs off, and a file NAME without its bytes', () => {
    const comments: TaskComment[] = [
      { id: 'c1', taskId: 't1', author: 'scion', body: 'shipped', createdAt: '2026-09-05T10:00:00.000Z' },
      { id: 'c2', taskId: 'other', author: 'scion', body: 'not mine', createdAt: '2026-09-05T10:00:00.000Z' },
    ]
    const subtasks: Subtask[] = [{
      id: 's1', taskId: 't1', title: 'half of it', done: true, status: 'done',
      createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z',
    }]
    const files: TaskFile[] = [{
      id: 'f1', taskId: 't1', name: 'plan.md', size: 120, createdAt: '2026-09-05T10:00:00.000Z',
    }]
    const out = toSharedTask(task({ shared: true }), inputs({ comments, subtasks, files }))
    expect(out.comments.map(c => c.id)).toEqual(['c1'])
    expect(out.subtasks).toHaveLength(1)
    expect(out.files[0]).toEqual({ id: 'f1', name: 'plan.md', size: 120, createdAt: '2026-09-05T10:00:00.000Z' })
  })

  it('carries no numbers and no claim', () => {
    // The central resolves the rollup through `task-rollup.ts` over the sessions it already holds:
    // a total computed here would be a second answer. A 30-minute lease pushed on a 30-second
    // cadence arrives stale and reads as "somebody is on this right now".
    const out = toSharedTask(
      task({ shared: true, claim: { by: 'someone', at: 'x', expiresAt: 'y' } }),
      inputs(),
    )
    expect(out.task).not.toHaveProperty('claim')
    expect(out).not.toHaveProperty('rollup')
    expect(out).not.toHaveProperty('costUSD')
  })
})
