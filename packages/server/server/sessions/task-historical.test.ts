/**
 * Historical conversations — filed on the board with no registry row behind them.
 *
 * Pure functions over plain rows, no filesystem: what is tested is the RULE (a link becomes a row the
 * existing ownership and rollup code already understands), not the store. The store round-trip lives
 * in `task-store.test.ts` and the write path in `task-historical-e2e.test.ts`.
 */

import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '@agentistics/core'
import { conversationOwners } from './task-conversations'
import { historicalRows, isHistoricalRow, planConversationFiling } from './task-historical'
import { buildTaskDetail, buildTaskList, rowsOfTask } from './task-report'
import { buildBoardOverview } from './task-overview'
import { historicalLinkId, type HistoricalSession, type Subtask, type Task } from './task-model'
import type { ManagedSession } from './types'

const at = (hh: number) => `2026-09-05T${String(hh).padStart(2, '0')}:00:00.000Z`

const task = (id: string): Task => ({
  id, title: `Task ${id}`, status: 'in_progress', createdAt: at(1), updatedAt: at(1),
} as Task)

const sub = (id: string, taskId: string, over: Partial<Subtask> = {}): Subtask => ({
  id, taskId, title: id, status: 'todo', done: false, createdAt: at(1), updatedAt: at(1), ...over,
} as Subtask)

const row = (over: Partial<ManagedSession>): ManagedSession => ({
  id: 'r', harness: 'claude', cwd: '/repo', createdAt: at(10), ...over,
} as ManagedSession)

const meta = (id: string, over: Partial<SessionMeta> = {}): SessionMeta => ({
  session_id: id, project_path: '/repo', start_time: at(9), end_time: at(9), harness: 'claude',
  model: 'claude-sonnet-5', input_tokens: 100, output_tokens: 50,
  cache_read_input_tokens: 0, cache_creation_input_tokens: 0, user_message_count: 4,
  first_prompt: 'do the thing', ...over,
} as SessionMeta)

const metasOf = (...ids: string[]) => new Map(ids.map(i => [i, meta(i)] as [string, SessionMeta]))
// Cost is what identifies a conversation in a sum: 5 per conversation, whatever else varies.
const costOf = () => 5

const link = (conv: string, taskId: string, over: Partial<HistoricalSession> = {}): HistoricalSession => ({
  id: historicalLinkId(conv), conversationId: conv, harness: 'claude', taskId, linkedAt: at(12), ...over,
})

const A = task('tA')
const B = task('tB')

describe('historicalRows', () => {
  it('builds a flagged, read-only row carrying the filing, the conversation and the meta\'s facts', () => {
    const [r] = historicalRows([link('c1', 'tA', { subtaskId: 's1' })], metasOf('c1'))
    expect(isHistoricalRow(r!)).toBe(true)
    expect(r).toMatchObject({
      id: 'hist:c1', conversationId: 'c1', harness: 'claude', taskId: 'tA', subtaskId: 's1',
      createdAt: at(12), endedAt: at(9), cwd: '/repo', label: 'do the thing', conversationLink: 'assigned',
      historical: true,
    })
  })

  it('takes createdAt from the FILING, not from the conversation', () => {
    const [r] = historicalRows([link('c1', 'tA', { linkedAt: at(20) })], metasOf('c1'))
    expect(r!.createdAt).toBe(at(20))
  })

  it('needs no store: without metas it still carries the filing, with no label, cwd or end', () => {
    const [r] = historicalRows([link('c1', 'tA')])
    expect(r).toMatchObject({ conversationId: 'c1', taskId: 'tA', cwd: '' })
    expect(r!.label).toBeUndefined()
    expect(r!.endedAt).toBeUndefined()
  })

  it('a registry row is never mistaken for one', () => {
    expect(isHistoricalRow(row({ id: 'x' }))).toBe(false)
  })
})

describe('ownership — a historical link is a filing statement made at linkedAt', () => {
  it('OVERRIDES an older registry filing on another task (a MOVE)', () => {
    const rows = [
      row({ id: 'old', conversationId: 'c1', taskId: 'tA', createdAt: at(9) }),
      ...historicalRows([link('c1', 'tB', { linkedAt: at(12) })]),
    ]
    expect(conversationOwners(rows).get('c1')).toBe('tB')
    expect(rowsOfTask(A, rows)).toEqual([])
    expect(rowsOfTask(B, rows).map(r => r.id)).toEqual(['hist:c1'])
  })

  it('is overridden by a NEWER registry filing', () => {
    const rows = [
      ...historicalRows([link('c1', 'tB', { linkedAt: at(12) })]),
      row({ id: 'new', conversationId: 'c1', taskId: 'tA', createdAt: at(15) }),
    ]
    expect(conversationOwners(rows).get('c1')).toBe('tA')
    expect(rowsOfTask(B, rows)).toEqual([])
    expect(rowsOfTask(A, rows).map(r => r.id)).toEqual(['new'])
  })

  it('a reopen that carries no taskId says nothing, so the link keeps the conversation', () => {
    const rows = [
      ...historicalRows([link('c1', 'tB', { linkedAt: at(12) })]),
      row({ id: 'reopen', conversationId: 'c1', createdAt: at(15) }),
    ]
    expect(conversationOwners(rows).get('c1')).toBe('tB')
  })

  it('on an exact tie the LINK wins, because it is appended after the registry', () => {
    const rows = [
      row({ id: 'r', conversationId: 'c1', taskId: 'tA', createdAt: at(12) }),
      ...historicalRows([link('c1', 'tB', { linkedAt: at(12) })]),
    ]
    expect(conversationOwners(rows).get('c1')).toBe('tB')
  })

  it('a MOVE between subtasks is one link, so the conversation is on exactly one of them', () => {
    // The store keeps one link per conversation; a move rewrites it. Modelled here as the link the
    // store would hold after the second filing.
    const rows = historicalRows([link('c1', 'tA', { subtaskId: 's2', linkedAt: at(14) })])
    const detail = buildTaskDetail({
      task: A, attempts: [], rows, metas: metasOf('c1'), costOf,
      subtasks: [sub('s1', 'tA'), sub('s2', 'tA')],
    })
    const by = new Map(detail.subtaskRollups.map(v => [v.id, v.rollup.sessionsUsed]))
    expect(by.get('s1')).toBe(0)
    expect(by.get('s2')).toBe(1)
  })

  it('once detached (no link), the conversation belongs to no task', () => {
    expect(conversationOwners([...historicalRows([])]).has('c1')).toBe(false)
  })
})

describe('rollups — one conversation counts once, and the total rises by exactly its cost', () => {
  const base = [row({ id: 'live', conversationId: 'cLive', taskId: 'tA', createdAt: at(9) })]
  const metas = metasOf('cLive', 'cHist')

  it('the task rollup gains exactly the conversation, once', () => {
    const before = buildTaskList({ tasks: [A], attempts: [], rows: base, metas, costOf })[0]!.rollup
    const after = buildTaskList({
      tasks: [A], attempts: [], rows: [...base, ...historicalRows([link('cHist', 'tA')])], metas, costOf,
    })[0]!.rollup
    expect(after.sessionsUsed).toBe(before.sessionsUsed + 1)
    expect(after.costUSD).toBe((before.costUSD ?? 0) + 5)
    expect(after.tokens).toBe((before.tokens ?? 0) + 150)
  })

  it('filing the same conversation twice (two links cannot exist, but two rows can) still counts once', () => {
    const twice = [
      ...historicalRows([link('cHist', 'tA', { linkedAt: at(12) })]),
      row({ id: 'echo', conversationId: 'cHist', taskId: 'tA', createdAt: at(11) }),
    ]
    const r = buildTaskList({ tasks: [A], attempts: [], rows: twice, metas, costOf })[0]!.rollup
    expect(r.sessionsUsed).toBe(1)
    expect(r.costUSD).toBe(5)
  })

  it('the BOARD headline rises by exactly the recovered conversation and nothing else', () => {
    const args = { tasks: [A, B], metas, costOf }
    const before = buildBoardOverview({ ...args, rows: base })
    const after = buildBoardOverview({ ...args, rows: [...base, ...historicalRows([link('cHist', 'tA')])] })
    expect(after.totalSessions).toBe(before.totalSessions + 1)
    expect(after.totalTokens).toBe((before.totalTokens ?? 0) + 150)
    expect(after.totalCostUSD).toBe((before.totalCostUSD ?? 0) + 5)
  })

  it('a conversation moved from A to B is on the headline once, not twice', () => {
    const rows = [
      row({ id: 'old', conversationId: 'cHist', taskId: 'tA', createdAt: at(9) }),
      ...historicalRows([link('cHist', 'tB', { linkedAt: at(12) })]),
    ]
    const o = buildBoardOverview({ tasks: [A, B], rows, metas, costOf })
    expect(o.totalSessions).toBe(1)
    expect(o.totalCostUSD).toBe(5)
  })

  it('the detail lists it with the historical marker and real numbers; a live row carries no marker', () => {
    const detail = buildTaskDetail({
      task: A, attempts: [], rows: [...base, ...historicalRows([link('cHist', 'tA')], metas)], metas, costOf,
    })
    const h = detail.sessions.find(s => s.conversationId === 'cHist')!
    expect(h).toMatchObject({ id: 'hist:cHist', historical: true, costUSD: 5, tokens: 150, rounds: 4 })
    expect(detail.sessions.find(s => s.conversationId === 'cLive')!.historical).toBeUndefined()
  })

  it('a link whose conversation left the store still counts as a session used, with no numbers', () => {
    const r = buildTaskList({
      tasks: [A], attempts: [], rows: historicalRows([link('gone', 'tA')]), metas: new Map(), costOf,
    })[0]!.rollup
    expect(r.sessionsUsed).toBe(1)
    expect(r.costUSD).toBeNull()
  })
})

describe('planConversationFiling', () => {
  const metas = metasOf('c1')

  it('accepts a conversation the store holds and the registry does not', () => {
    const p = planConversationFiling({ conversationId: 'c1', metas, registryRows: [] })
    expect(p).toMatchObject({ ok: true, harness: 'claude' })
  })

  it('refuses no_such_conversation for an id with no meta — never a link that prices nothing', () => {
    expect(planConversationFiling({ conversationId: 'nope', metas, registryRows: [] }))
      .toEqual({ ok: false, reason: 'no_such_conversation' })
  })

  it('refuses no_such_conversation when the harness disagrees with the meta', () => {
    expect(planConversationFiling({ conversationId: 'c1', harness: 'codex', metas, registryRows: [] }))
      .toEqual({ ok: false, reason: 'no_such_conversation' })
  })

  it('refuses conversation_in_fleet and names the NEWEST row of that conversation', () => {
    const p = planConversationFiling({
      conversationId: 'c1', metas,
      registryRows: [
        row({ id: 'older', conversationId: 'c1', createdAt: at(8) }),
        row({ id: 'newer', conversationId: 'c1', createdAt: at(11) }),
        row({ id: 'other', conversationId: 'c2', createdAt: at(13) }),
      ],
    })
    expect(p).toEqual({ ok: false, reason: 'conversation_in_fleet', sessionId: 'newer' })
  })
})
