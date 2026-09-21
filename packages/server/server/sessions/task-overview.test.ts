/**
 * `buildBoardOverview`'s `daily` field — the board's activity over time.
 *
 * Focused on the new day-bucketing rule: a day nobody touched is ABSENT (never a zero-filled row),
 * `sessionsStarted` is keyed on each session's OWN `start_time`, and `created`/`delivered` are keyed
 * on the task's own dates. The pre-existing headline arithmetic (`task-rollup.test.ts` and friends)
 * is not re-tested here.
 */

import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '@agentistics/core'
import { buildBoardOverview } from './task-overview'
import type { Task } from './task-model'
import type { ManagedSession } from './types'

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Task', status: 'in_progress',
  createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
  ...over,
} as Task)

const row = (over: Partial<ManagedSession> = {}): ManagedSession => ({
  id: 'r1', harness: 'claude', cwd: '/repo', createdAt: '2026-09-01T10:00:00.000Z',
  taskId: 't1', conversationId: 'c1',
  ...over,
} as ManagedSession)

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  session_id: 'c1', project_path: '/repo', start_time: '2026-09-01T10:00:00.000Z',
  harness: 'claude', model: 'claude-sonnet-5',
  ...over,
} as SessionMeta)

const metasOf = (...ms: SessionMeta[]) =>
  new Map(ms.map(m => [m.session_id, m] as [string, SessionMeta]))

const costOf = () => 1

describe('buildBoardOverview deliveredWithoutCost', () => {
  it('counts only DELIVERED tasks that could not be priced, not every open one', () => {
    const o = buildBoardOverview({
      tasks: [
        task({ id: 't1', status: 'done' }), // delivered, no rows -> no cost
        task({ id: 't2', status: 'in_progress' }), // open, no rows -> no cost, but not delivered
      ],
      rows: [], metas: metasOf(), costOf,
    })
    expect(o.tasksWithoutCost).toBe(2)
    expect(o.deliveredWithoutCost).toBe(1)
  })

  it('a delivered task WITH a cost contributes nothing to either counter', () => {
    const o = buildBoardOverview({
      tasks: [task({ id: 't1', status: 'done' })],
      rows: [row({ id: 'r1', taskId: 't1', conversationId: 'c1' })],
      metas: metasOf(meta({ session_id: 'c1' })),
      costOf,
    })
    expect(o.tasksWithoutCost).toBe(0)
    expect(o.deliveredWithoutCost).toBe(0)
  })
})

describe('buildBoardOverview daily', () => {
  it('a day with no task and no session is absent from the list — never a zero-filled row', () => {
    const o = buildBoardOverview({ tasks: [], rows: [], metas: metasOf(), costOf })
    expect(o.daily).toEqual([])
  })

  it('counts a task creation on its own day', () => {
    const o = buildBoardOverview({
      tasks: [task({ id: 't1', createdAt: '2026-09-03T08:00:00.000Z' })],
      rows: [], metas: metasOf(), costOf,
    })
    expect(o.daily).toEqual([{ date: '2026-09-03', sessionsStarted: 0, delivered: 0, created: 1 }])
  })

  it('counts a delivery on its OWN day, separate from the creation day', () => {
    const o = buildBoardOverview({
      tasks: [task({
        id: 't1', status: 'done',
        createdAt: '2026-09-01T08:00:00.000Z', deliveredAt: '2026-09-05T18:00:00.000Z',
      })],
      rows: [], metas: metasOf(), costOf,
    })
    expect(o.daily).toEqual([
      { date: '2026-09-01', sessionsStarted: 0, delivered: 0, created: 1 },
      { date: '2026-09-05', sessionsStarted: 0, delivered: 1, created: 0 },
    ])
  })

  it('a task marked done with no deliveredAt contributes no delivered day (nothing to date it by)', () => {
    const o = buildBoardOverview({
      tasks: [task({ id: 't1', status: 'done', createdAt: '2026-09-01T08:00:00.000Z' })],
      rows: [], metas: metasOf(), costOf,
    })
    expect(o.daily.find(d => d.delivered > 0)).toBeUndefined()
  })

  it('sessionsStarted is bucketed by the SESSION\'s own start_time, not the task\'s createdAt', () => {
    const o = buildBoardOverview({
      tasks: [task({ id: 't1', createdAt: '2026-09-01T08:00:00.000Z' })],
      rows: [row({ id: 'r1', taskId: 't1', conversationId: 'c1' })],
      metas: metasOf(meta({ session_id: 'c1', start_time: '2026-09-04T22:00:00.000Z' })),
      costOf,
    })
    const created = o.daily.find(d => d.date === '2026-09-01')
    const started = o.daily.find(d => d.date === '2026-09-04')
    expect(created?.created).toBe(1)
    expect(created?.sessionsStarted).toBe(0)
    expect(started?.sessionsStarted).toBe(1)
  })

  it('one conversation reopened across several rows counts once, on its own start day', () => {
    const o = buildBoardOverview({
      tasks: [task({ id: 't1' })],
      rows: [
        row({ id: 'r1', taskId: 't1', conversationId: 'c1' }),
        row({ id: 'r2', taskId: 't1', conversationId: 'c1' }), // same conversation, reopened
      ],
      metas: metasOf(meta({ session_id: 'c1', start_time: '2026-09-02T00:00:00.000Z' })),
      costOf,
    })
    const day = o.daily.find(d => d.date === '2026-09-02')
    expect(day?.sessionsStarted).toBe(1)
  })

  it('several tasks/sessions on the same day accumulate into one row, sorted ascending', () => {
    const o = buildBoardOverview({
      tasks: [
        task({ id: 't1', createdAt: '2026-09-05T01:00:00.000Z' }),
        task({ id: 't2', createdAt: '2026-09-05T02:00:00.000Z' }),
        task({ id: 't3', createdAt: '2026-09-01T01:00:00.000Z' }),
      ],
      rows: [], metas: metasOf(), costOf,
    })
    expect(o.daily.map(d => d.date)).toEqual(['2026-09-01', '2026-09-05'])
    expect(o.daily.find(d => d.date === '2026-09-05')?.created).toBe(2)
  })

  it('an unparseable date contributes nothing rather than a garbage bucket', () => {
    const o = buildBoardOverview({
      tasks: [task({ id: 't1', createdAt: 'not-a-date' })],
      rows: [], metas: metasOf(), costOf,
    })
    expect(o.daily).toEqual([])
  })
})

describe('buildBoardOverview — which row stands for a conversation never moves a figure', () => {
  // The overview reads only the conversation's META, so choosing the NEWEST row (rather than the
  // first) for a reopened conversation must leave every total exactly where it was: the cost, the
  // tokens and the session count are all functions of the conversation, not of the row.
  const rows = (): ManagedSession[] => [
    row({ id: 'old', taskId: 't1', conversationId: 'c1', createdAt: '2026-09-10T10:00:00.000Z',
      endedAt: '2026-09-11T10:00:00.000Z' }),
    row({ id: 'mid', taskId: 't1', conversationId: 'c1', subtaskId: 's1', createdAt: '2026-09-12T10:00:00.000Z',
      endedAt: '2026-09-12T20:00:00.000Z' }),
    row({ id: 'live', taskId: 't1', conversationId: 'c1', subtaskId: 's2', createdAt: '2026-09-13T10:00:00.000Z' }),
    row({ id: 'solo', taskId: 't1', conversationId: 'c2', createdAt: '2026-09-13T11:00:00.000Z' }),
  ]
  const metas = metasOf(
    meta({ session_id: 'c1', input_tokens: 100, output_tokens: 50, user_message_count: 9 }),
    meta({ session_id: 'c2', input_tokens: 10, output_tokens: 5, user_message_count: 2 }),
  )
  const overviewOf = (r: ManagedSession[]) =>
    buildBoardOverview({ tasks: [task({ id: 't1' })], rows: r, metas, costOf: m => (m.session_id === 'c1' ? 10 : 5) })

  it('counts each conversation once, however many rows it has and in whatever order', () => {
    const forward = overviewOf(rows())
    const backward = overviewOf([...rows()].reverse())
    expect(forward.totalSessions).toBe(2)
    expect(forward.totalCostUSD).toBe(15)
    expect(forward.totalTokens).toBe(165)
    expect(forward.avgRoundsPerTask).toBe(11)
    expect(backward).toEqual(forward)
  })
})
