/**
 * `conversationOwners` — a conversation belongs to exactly ONE task, and every surface that walks a
 * task's rows (`rowsOfTask`) inherits that. The bug it closes: filing is a MOVE written on ONE row,
 * so a conversation moved from A to B keeps an older row still saying A, and both tasks listed and
 * priced it — `buildBoardOverview`'s headline then counted it twice.
 *
 * Pure functions over plain rows, no filesystem: what is tested is the rule, not the store.
 */

import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '@agentistics/core'
import { conversationOwners } from './task-conversations'
import { buildTaskDetail, buildTaskList, rowsOfTask } from './task-report'
import { buildBoardOverview } from './task-overview'
import { legacyTaskId, type Task } from './task-model'
import type { ManagedSession } from './types'

const at = (hh: number) => `2026-09-05T${String(hh).padStart(2, '0')}:00:00.000Z`

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: `Task ${id}`, status: 'in_progress',
  createdAt: at(1), updatedAt: at(1),
  ...over,
} as Task)

const row = (over: Partial<ManagedSession>): ManagedSession => ({
  id: 'r', harness: 'claude', cwd: '/repo', createdAt: at(10),
  ...over,
} as ManagedSession)

const meta = (id: string): SessionMeta => ({
  session_id: id, project_path: '/repo', start_time: at(9), harness: 'claude',
  model: 'claude-sonnet-5', input_tokens: 100, output_tokens: 50,
  cache_read_input_tokens: 0, cache_creation_input_tokens: 0, user_message_count: 4,
} as SessionMeta)

const metasOf = (...ids: string[]) => new Map(ids.map(i => [i, meta(i)] as [string, SessionMeta]))
const costOf = () => 5

const A = task('tA')
const B = task('tB')

describe('conversationOwners — the newest filing statement wins', () => {
  it('moves a conversation from A to B: A stops owning it, B owns it', () => {
    const rows = [
      row({ id: 'old', conversationId: 'c1', taskId: 'tA', createdAt: at(9) }),
      row({ id: 'new', conversationId: 'c1', taskId: 'tB', createdAt: at(11) }),
    ]
    expect(conversationOwners(rows).get('c1')).toBe('tB')
    expect(rowsOfTask(A, rows)).toEqual([])
    expect(rowsOfTask(B, rows).map(r => r.id)).toEqual(['new'])
  })

  it('counts the board headline over DISTINCT conversations, not once per task that ever held one', () => {
    const rows = [
      row({ id: 'old', conversationId: 'c1', taskId: 'tA', createdAt: at(9) }),
      row({ id: 'new', conversationId: 'c1', taskId: 'tB', createdAt: at(11) }),
      row({ id: 'solo', conversationId: 'c2', taskId: 'tA', createdAt: at(9) }),
    ]
    const metas = metasOf('c1', 'c2')
    const o = buildBoardOverview({ tasks: [A, B], rows, metas, costOf })
    // c1 (owned by B) + c2 (owned by A): two conversations, $5 each. The old rule priced c1 under
    // BOTH tasks and reported $15 over 3 sessions.
    expect(o.totalCostUSD).toBe(10)
    expect(o.totalSessions).toBe(2)
    expect(o.totalTokens).toBe(300)

    const list = buildTaskList({ tasks: [A, B], attempts: [], rows, metas, costOf })
    expect(list.map(l => [l.task.id, l.rollup.sessionsUsed, l.rollup.costUSD])).toEqual([
      ['tA', 1, 5], // only c2
      ['tB', 1, 5], // only c1
    ])
    // The per-task figures add up to the headline — the property that was false.
    expect(list.reduce((n, l) => n + (l.rollup.costUSD ?? 0), 0)).toBe(o.totalCostUSD as number)
  })

  it('the detail of the task that LOST the conversation does not list it either', () => {
    const rows = [
      row({ id: 'old', conversationId: 'c1', taskId: 'tA', createdAt: at(9) }),
      row({ id: 'new', conversationId: 'c1', taskId: 'tB', createdAt: at(11) }),
    ]
    const metas = metasOf('c1')
    const lost = buildTaskDetail({ task: A, attempts: [], rows, metas, costOf })
    const won = buildTaskDetail({ task: B, attempts: [], rows, metas, costOf })
    expect(lost.sessions).toEqual([])
    expect(lost.rollup.sessionsUsed).toBe(0)
    expect(won.sessions.map(s => s.id)).toEqual(['new'])
    expect(won.rollup.costUSD).toBe(5)
  })

  it('does NOT let unfiled rows decide — the Pelvie shape: reopens mint rows with no taskId', () => {
    // Real data: the coordinator conversation has 13 rows and only three carry the task. The nine
    // between them and the one after are reopens that never inherited `taskId` (they carry only
    // the free-text name). If "newest row" decided ownership every reopen would orphan it.
    const rows = [
      row({ id: 'f1', conversationId: 'c1', taskId: 'tA', createdAt: at(9) }),
      row({ id: 'f2', conversationId: 'c1', taskId: 'tA', subtaskId: 's1', createdAt: at(10) }),
      row({ id: 'u1', conversationId: 'c1', createdAt: at(11) }),
      row({ id: 'u2', conversationId: 'c1', task: 'Task tA', createdAt: at(12) }),
      row({ id: 'u3', conversationId: 'c1', createdAt: at(13) }),
    ]
    expect(conversationOwners(rows).get('c1')).toBe('tA')
    // ...and the rows a task lists are still ITS OWN filed rows, so the subtask filing on the
    // newest filed row is not overwritten by an unfiled reopen.
    expect(rowsOfTask(A, rows).map(r => r.id)).toEqual(['f1', 'f2'])
  })

  it('decides by createdAt, not by where the registry happens to list the row', () => {
    // The row of the task that ought to LOSE is registered LATER in the array but is older.
    const rows = [
      row({ id: 'newer-first', conversationId: 'c1', taskId: 'tB', createdAt: at(12) }),
      row({ id: 'older-later', conversationId: 'c1', taskId: 'tA', createdAt: at(9) }),
    ]
    expect(conversationOwners(rows).get('c1')).toBe('tB')
    expect(rowsOfTask(A, rows)).toEqual([])
    expect(rowsOfTask(B, rows).map(r => r.id)).toEqual(['newer-first'])
  })

  it('breaks a tie, and an unreadable stamp, by registry order: the later row wins', () => {
    const tie = [
      row({ id: 'x1', conversationId: 'c1', taskId: 'tA', createdAt: at(10) }),
      row({ id: 'x2', conversationId: 'c1', taskId: 'tB', createdAt: at(10) }),
    ]
    expect(conversationOwners(tie).get('c1')).toBe('tB')
    const garbage = [
      row({ id: 'y1', conversationId: 'c1', taskId: 'tA', createdAt: at(10) }),
      row({ id: 'y2', conversationId: 'c1', taskId: 'tB', createdAt: 'not a date' }),
    ]
    expect(conversationOwners(garbage).get('c1')).toBe('tB')
  })
})

describe('conversationOwners — legacy name filings', () => {
  const L1 = task(legacyTaskId('one'), { title: 'one' })
  const L2 = task(legacyTaskId('two'), { title: 'two' })

  it('a conversation with only NAME-filed rows belongs to the newest name', () => {
    const rows = [
      row({ id: 'n1', conversationId: 'c1', task: 'one', createdAt: at(9) }),
      row({ id: 'n2', conversationId: 'c1', task: 'two', createdAt: at(11) }),
    ]
    expect(conversationOwners(rows).get('c1')).toBe(L2.id)
    expect(rowsOfTask(L1, rows)).toEqual([])
    expect(rowsOfTask(L2, rows).map(r => r.id)).toEqual(['n2'])
  })

  it('an id filing outranks a NEWER name-only row: a rename leaves the old title on reopens', () => {
    // Real data: "Terminal utilitario na sessao" was renamed to "O terminal na sessao". The rows
    // filed by id keep the OLD title in `task`, and reopens copy that title without the id. The
    // old title resolves to a second, phantom task; the conversation must stay with the real one.
    const real = task('tReal', { title: 'Renamed' })
    const phantom = task(legacyTaskId('Old title'), { title: 'Old title' })
    const rows = [
      row({ id: 'filed', conversationId: 'c1', taskId: 'tReal', task: 'Old title', createdAt: at(9) }),
      row({ id: 'reopen', conversationId: 'c1', task: 'Old title', createdAt: at(12) }),
    ]
    expect(conversationOwners(rows).get('c1')).toBe('tReal')
    expect(rowsOfTask(real, rows).map(r => r.id)).toEqual(['filed'])
    // ...and the phantom no longer claims the SAME row through its title (the old double count).
    expect(rowsOfTask(phantom, rows)).toEqual([])
    const o = buildBoardOverview({ tasks: [real, phantom], rows, metas: metasOf('c1'), costOf })
    expect(o.totalCostUSD).toBe(5)
    expect(o.totalSessions).toBe(1)
  })
})

describe('conversationOwners — rows with no conversation link', () => {
  it('are never grouped and keep belonging to whatever task they name', () => {
    const rows = [
      row({ id: 'k1', taskId: 'tA', createdAt: at(9) }),
      row({ id: 'k2', taskId: 'tB', createdAt: at(11) }),
      row({ id: 'k3', taskId: 'tA', createdAt: at(12) }),
    ]
    expect(conversationOwners(rows).size).toBe(0)
    expect(rowsOfTask(A, rows).map(r => r.id)).toEqual(['k1', 'k3'])
    expect(rowsOfTask(B, rows).map(r => r.id)).toEqual(['k2'])
  })
})

describe('conversationOwners — an explicit unfile', () => {
  // `detachSession` writes `taskId: ''` (and `task: ''`) on the row it is called on, and it is the
  // only writer of an empty string. A reopen that merely did not carry the filing leaves `taskId`
  // ABSENT, which is what tells the two apart.
  const detached = (id: string, conv: string, hh: number) =>
    row({ id, conversationId: conv, taskId: '', task: '', createdAt: at(hh) })

  it('un-owns the conversation: the older row still saying A no longer counts it', () => {
    const rows = [
      row({ id: 'old', conversationId: 'c1', taskId: 'tA', createdAt: at(9) }),
      detached('gone', 'c1', 11),
    ]
    expect(conversationOwners(rows).has('c1')).toBe(false)
    expect(rowsOfTask(A, rows)).toEqual([])
    expect(buildBoardOverview({ tasks: [A], rows, metas: metasOf('c1'), costOf }).totalSessions).toBe(0)
  })

  it('stays un-owned across a later reopen that carries no filing', () => {
    const rows = [
      row({ id: 'old', conversationId: 'c1', taskId: 'tA', createdAt: at(9) }),
      detached('gone', 'c1', 11),
      row({ id: 'reopen', conversationId: 'c1', createdAt: at(12) }),
    ]
    expect(conversationOwners(rows).has('c1')).toBe(false)
  })

  it('is superseded by a LATER filing, and does not outrank an even newer one on another task', () => {
    const refiled = [
      row({ id: 'old', conversationId: 'c1', taskId: 'tA', createdAt: at(9) }),
      detached('gone', 'c1', 11),
      row({ id: 'again', conversationId: 'c1', taskId: 'tB', createdAt: at(13) }),
    ]
    expect(conversationOwners(refiled).get('c1')).toBe('tB')
  })

  it('an unfile older than the newest filing changes nothing', () => {
    const rows = [
      detached('gone', 'c1', 9),
      row({ id: 'filed', conversationId: 'c1', taskId: 'tA', createdAt: at(11) }),
    ]
    expect(conversationOwners(rows).get('c1')).toBe('tA')
  })

  it('an unfile outranks older NAME-only rows too — the person took the conversation off its task', () => {
    const rows = [
      row({ id: 'n', conversationId: 'c1', task: 'one', createdAt: at(9) }),
      detached('gone', 'c1', 11),
    ]
    expect(conversationOwners(rows).has('c1')).toBe(false)
  })
})

describe('rowsOfTask — a caller-supplied owner map', () => {
  it('is used as given, so a hot loop pays for ownership once', () => {
    const rows = [row({ id: 'r1', conversationId: 'c1', taskId: 'tA', createdAt: at(9) })]
    expect(rowsOfTask(A, rows, new Map([['c1', 'tB']]))).toEqual([])
    expect(rowsOfTask(A, rows, new Map([['c1', 'tA']])).map(r => r.id)).toEqual(['r1'])
  })
})
