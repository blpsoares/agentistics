import { describe, expect, it } from 'bun:test'
import { planRestore } from './session-restore'
import type { ManagedSession } from './types'

const entry = (id: string, over: Partial<ManagedSession> = {}): ManagedSession => ({
  id, harness: 'claude', cwd: '/repo/a', createdAt: '2026-08-13T10:00:00.000Z', ...over,
})
const conv = (sessionId: string, title = 'a conversation') => () => ({ sessionId, title })

describe('planRestore', () => {
  it('offers a row the machine lost, with the name the user gave it', () => {
    const got = planRestore({
      entries: [entry('a', { label: 'the auth work' })],
      liveIds: new Set(),
      conversationFor: conv('c1', 'Refactor the token store'),
    })
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ id: 'a', label: 'the auth work', resumeId: 'c1' })
  })

  it('falls back to the conversation title when nobody named it', () => {
    const got = planRestore({
      entries: [entry('a')], liveIds: new Set(), conversationFor: conv('c1', 'Refactor'),
    })
    expect(got[0]!.label).toBe('Refactor')
  })

  it('offers NOTHING while something is still running', () => {
    // A machine with live sessions did not lose everything — it is an ordinary restart of the app,
    // and greeting that with a modal is a modal people learn to dismiss without reading.
    const got = planRestore({
      entries: [entry('a'), entry('b')],
      liveIds: new Set(['b']),
      conversationFor: conv('c1'),
    })
    expect(got).toEqual([])
  })

  it('never offers a session the user ENDED', () => {
    // `endedAt` is a decision. Offering it back is offering to undo their last action.
    const got = planRestore({
      entries: [entry('a', { endedAt: '2026-08-13T11:00:00.000Z' })],
      liveIds: new Set(),
      conversationFor: conv('c1'),
    })
    expect(got).toEqual([])
  })

  it('never offers a row with nothing to reopen', () => {
    const got = planRestore({
      entries: [entry('a'), entry('b')],
      liveIds: new Set(),
      conversationFor: e => (e.id === 'a' ? { sessionId: 'c1', title: 't' } : null),
    })
    expect(got.map(r => r.id)).toEqual(['a'])
  })

  it('puts the newest first, because that is what someone was in the middle of', () => {
    const got = planRestore({
      entries: [
        entry('old', { createdAt: '2026-08-01T10:00:00.000Z' }),
        entry('new', { createdAt: '2026-08-13T10:00:00.000Z' }),
      ],
      liveIds: new Set(),
      conversationFor: conv('c1'),
    })
    expect(got.map(r => r.id)).toEqual(['new', 'old'])
  })

  it('bounds the list, because a modal of forty rows is a wall and not an offer', () => {
    const many = Array.from({ length: 30 }, (_, i) => entry(`s${i}`))
    expect(planRestore({ entries: many, liveIds: new Set(), conversationFor: conv('c1') }))
      .toHaveLength(8)
    expect(planRestore({
      entries: many, liveIds: new Set(), conversationFor: conv('c1'), limit: 3,
    })).toHaveLength(3)
  })

  it('survives a registry timestamp nobody can read', () => {
    const got = planRestore({
      entries: [entry('a', { createdAt: '' })], liveIds: new Set(), conversationFor: conv('c1'),
    })
    expect(got).toHaveLength(1)
    expect(got[0]!.startedMs).toBeUndefined()
  })
})
