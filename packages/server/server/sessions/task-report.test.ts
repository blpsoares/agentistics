/**
 * A task belongs to a repository through its SESSIONS, and this pins that rule.
 *
 * The Repositories page keys everything on `normalizeGitRemote` and nothing else; `buildTaskList`'s
 * `repos` is that same key, read off the sessions' metas. The cases below are the ones that decide
 * whether the Repositories → Tasks tab lists the right rows: a task spanning two repositories, the
 * "no linked repository" bucket, and a row nobody could place.
 */

import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '@agentistics/core'
import { buildTaskDetail, buildTaskList, reposOfRows } from './task-report'
import type { Task } from './task-model'
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

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  session_id: 'c1', project_path: '/repo', start_time: '2026-09-05T10:00:00.000Z',
  harness: 'claude', git_remote: 'github.com/org/repo',
  ...over,
} as SessionMeta)

const metasOf = (...ms: SessionMeta[]) =>
  new Map(ms.map(m => [m.session_id, m] as [string, SessionMeta]))

const listOf = (rows: ManagedSession[], metas: ReadonlyMap<string, SessionMeta>) =>
  buildTaskList({ tasks: [task()], attempts: [], rows, metas, costOf: () => 1 })

describe('reposOfRows', () => {
  it('names every repository the task touched, once, in first-seen order', () => {
    // A task spanning two repositories appears under BOTH — that is the point of keying on the
    // sessions rather than on one field.
    const repos = reposOfRows(
      [row({ id: 'r1', conversationId: 'c1' }), row({ id: 'r2', conversationId: 'c2' }),
        row({ id: 'r3', conversationId: 'c3' })],
      metasOf(
        meta({ session_id: 'c1', git_remote: 'github.com/org/a' }),
        meta({ session_id: 'c2', git_remote: 'github.com/org/b' }),
        meta({ session_id: 'c3', git_remote: 'github.com/org/a' }),
      ),
    )
    expect(repos).toEqual(['github.com/org/a', 'github.com/org/b'])
  })

  it('keeps the "no linked repository" bucket as a real value', () => {
    // `''` is the bucket the repositories page already shows, and `sessionInScope` matches it. A
    // session outside a repository is not a session with no session.
    const repos = reposOfRows([row()], metasOf(meta({ git_remote: undefined })))
    expect(repos).toEqual([''])
  })

  it('names nothing for a row whose conversation is not in the store', () => {
    // No link, no repository. A `cwd` is not the key this dimension is measured by, and guessing
    // one from it would file the task under a repository nothing observed.
    expect(reposOfRows([row({ conversationId: undefined })], metasOf(meta()))).toEqual([])
    expect(reposOfRows([row({ conversationId: 'gone' })], metasOf(meta()))).toEqual([])
  })
})

describe('buildTaskList repos', () => {
  it('carries the repositories beside the harnesses', () => {
    const [only] = listOf([row()], metasOf(meta()))
    expect(only!.repos).toEqual(['github.com/org/repo'])
    expect(only!.harnesses).toEqual(['claude'])
  })

  it('names no repository when the caller scoped every session out', () => {
    // The metas arrive already scoped, so a task with nothing inside the window names nothing —
    // which is what keeps a repository tab from listing work it has not seen in that window.
    const [only] = listOf([row()], metasOf())
    expect(only!.repos).toEqual([])
    expect(only!.rollup.sessionsUsed).toBe(1)
  })
})

describe('rollupSessionsFor', () => {
  const meta2 = (over: Partial<SessionMeta> = {}): SessionMeta => ({
    session_id: 'c1', project_path: '/repo', start_time: '2026-09-05T10:00:00.000Z',
    harness: 'claude', input_tokens: 100, output_tokens: 50,
    cache_read_input_tokens: 800, cache_creation_input_tokens: 50,
    user_message_count: 3,
    ...over,
  } as SessionMeta)

  it('counts one CONVERSATION once, however many rows point at it', async () => {
    // Every reopen mints a new managedId for the same conversation. Measured on a live board: six
    // rows of one conversation made a delivery report five times its real cost.
    const { rollupSessionsFor } = await import('./task-report')
    const rows = ['r1', 'r2', 'r3'].map(id => row({ id, conversationId: 'c1' }))
    const out = rollupSessionsFor(rows, metasOf(meta2()), () => 7)
    expect(out).toHaveLength(1)
    expect(out[0]!.costUSD).toBe(7)
  })

  it('keeps every row that has no conversation to be a duplicate OF', async () => {
    const { rollupSessionsFor } = await import('./task-report')
    const rows = [
      row({ id: 'r1', conversationId: undefined }),
      row({ id: 'r2', conversationId: undefined }),
      row({ id: 'r3', conversationId: 'c1' }),
    ]
    const out = rollupSessionsFor(rows, metasOf(meta2()), () => 1)
    expect(out).toHaveLength(3)
    // The two unlinked ones contribute nothing, which is what `sessionsLinked` is for.
    expect(out.filter(s => s.meta !== null)).toHaveLength(1)
  })

  it('keeps distinct conversations apart', async () => {
    const { rollupSessionsFor } = await import('./task-report')
    const rows = [row({ id: 'r1', conversationId: 'c1' }), row({ id: 'r2', conversationId: 'c2' })]
    const out = rollupSessionsFor(rows, metasOf(meta2(), meta2({ session_id: 'c2' })), () => 3)
    expect(out).toHaveLength(2)
  })
})

describe('distinctConversations', () => {
  it('is the rule every surface that walks a task\'s rows must share', async () => {
    // `task-overview.ts` accumulates its own totals rather than going through the rollup, so the
    // headline counted a reopened conversation once per reopening while the delivery under it was
    // right. Measured on a live board: 13.110.140.051 tokens over deliveries summing 2.493.697.631.
    const { distinctConversations } = await import('./task-report')
    const rows = [
      row({ id: 'r1', conversationId: 'c1' }),
      row({ id: 'r2', conversationId: 'c1' }),
      row({ id: 'r3', conversationId: 'c2' }),
      row({ id: 'r4', conversationId: undefined }),
      row({ id: 'r5', conversationId: undefined }),
    ]
    expect(distinctConversations(rows).map(r => r.id)).toEqual(['r1', 'r3', 'r4', 'r5'])
  })
})

/**
 * THE LIST MUST COUNT A CONVERSATION ONCE, exactly as the ROLLUP beside it already does.
 *
 * `rollupSessionsFor` was taught this on 2026-09-08, after the "ALM board" delivery reported
 * 13.072.988.605 tokens and $7.477,50 against a true 2.456.546.185 and $1.402,92 — five times over
 * on the headline figure of the whole feature. The fix went into the numbers and NOT into the list
 * beside them, which kept mapping over every registry row.
 *
 * Reported with a screenshot on 2026-09-09: a delivery whose rollup correctly said `2 sessions`
 * drew FIVE rows under its "Sessions" tab — one conversation repeated four times, each row carrying
 * that conversation's full R$384,89, three marked `finished` and one `working`. That is the exact
 * signature of the retired predecessors every attach/reopen/restart mints, and the same cost read
 * four times is the most expensive thing this screen can say wrongly, because reading cost is what
 * the screen is for.
 */
describe('buildTaskDetail — one row per conversation', () => {
  const detailOf = (rows: ManagedSession[]) =>
    buildTaskDetail({
      task: task(), attempts: [], rows, metas: metasOf(meta()), costOf: () => 1,
      comments: [], subtasks: [], files: [],
    })

  it('collapses the reopenings of ONE conversation into one row', () => {
    const detail = detailOf([
      row({ id: 'r1', conversationId: 'c1', endedAt: '2026-09-05T11:00:00.000Z' }),
      row({ id: 'r2', conversationId: 'c1', endedAt: '2026-09-05T12:00:00.000Z' }),
      row({ id: 'r3', conversationId: 'c1' }),
    ])
    expect(detail.sessions.length).toBe(1)
    // FIRST-SEEN order, the same rule `distinctConversations` states for every other surface.
    expect(detail.sessions[0]!.id).toBe('r1')
  })

  it('agrees with the rollup drawn beside it', () => {
    const rows = [
      row({ id: 'r1', conversationId: 'c1' }),
      row({ id: 'r2', conversationId: 'c1' }),
    ]
    const detail = detailOf(rows)
    // The tab's own count is `sessions.length`, so a list that disagrees with the rollup makes the
    // TAB LABEL lie too — "Sessions 5" over a delivery that used two.
    expect(detail.sessions.length).toBe(detail.rollup.sessionsUsed)
  })

  it('keeps DISTINCT conversations apart', () => {
    const detail = detailOf([
      row({ id: 'r1', conversationId: 'c1' }),
      row({ id: 'r2', conversationId: 'c2' }),
    ])
    expect(detail.sessions.map(s => s.id)).toEqual(['r1', 'r2'])
  })

  it('keeps every row that carries NO conversation link', () => {
    // It cannot be shown to be a duplicate of anything, and it contributes no numbers anyway —
    // the same rule `usage-dedupe.ts` applies to a usage record with no message id.
    const detail = detailOf([
      row({ id: 'r1', conversationId: undefined }),
      row({ id: 'r2', conversationId: undefined }),
    ])
    expect(detail.sessions.map(s => s.id)).toEqual(['r1', 'r2'])
  })
})
