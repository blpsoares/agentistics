import { describe, expect, it } from 'bun:test'
import type { BackendSession, ManagedSession } from './types'
import { reconcileSessions, resolveSessionRef } from './session-ref'

const managed = (id: string, label?: string): ManagedSession => ({
  id,
  harness: 'claude',
  cwd: '/tmp',
  createdAt: '2026-08-12T10:00:00.000Z',
  ...(label ? { label } : {}),
})

const backend = (id: string, alive = true): BackendSession => ({
  id,
  createdMs: 1_786_562_971_000,
  attached: false,
  alive,
  lastActivityMs: 1_786_562_971_000,
})

describe('resolveSessionRef', () => {
  const list = [managed('a1b2c3d4', 'refactor auth'), managed('a1b2ffff', 'fix tests'), managed('zz99', 'fix tests')]

  it('matches an exact id', () => {
    expect(resolveSessionRef(list, 'a1b2c3d4')).toEqual({ ok: true, session: list[0]! })
  })

  it('matches a label, case-insensitively', () => {
    expect(resolveSessionRef(list, 'Refactor Auth')).toEqual({ ok: true, session: list[0]! })
  })

  it('matches a unique id prefix', () => {
    expect(resolveSessionRef(list, 'zz')).toEqual({ ok: true, session: list[2]! })
  })

  it('refuses an ambiguous id prefix instead of picking one', () => {
    expect(resolveSessionRef(list, 'a1b2')).toEqual({
      ok: false, reason: 'ambiguous', matches: ['a1b2c3d4', 'a1b2ffff'],
    })
  })

  it('refuses a duplicated label instead of picking one', () => {
    expect(resolveSessionRef(list, 'fix tests')).toEqual({
      ok: false, reason: 'ambiguous', matches: ['a1b2ffff', 'zz99'],
    })
  })

  it('reports nothing found', () => {
    expect(resolveSessionRef(list, 'nope')).toEqual({ ok: false, reason: 'not-found', matches: [] })
  })
})

describe('reconcileSessions', () => {
  it('reports a session both sides know about as running', () => {
    const r = reconcileSessions([managed('a')], [backend('a')])
    expect(r).toEqual([{ id: 'a', managed: managed('a'), backend: backend('a'), status: 'running' }])
  })

  it('reports a dead pane as exited, keeping it visible', () => {
    const r = reconcileSessions([managed('a')], [backend('a', false)])
    expect(r[0]!.status).toBe('exited')
  })

  it('reports a registry entry the backend does not have as lost', () => {
    const r = reconcileSessions([managed('a')], [])
    expect(r).toEqual([{ id: 'a', managed: managed('a'), status: 'lost' }])
  })

  it('never drops a backend session the registry does not know about', () => {
    const r = reconcileSessions([], [backend('a')])
    expect(r).toEqual([{ id: 'a', backend: backend('a'), status: 'unregistered' }])
  })

  it('lists every id exactly once when the two sides overlap partially', () => {
    const r = reconcileSessions([managed('a'), managed('b')], [backend('b'), backend('c')])
    expect(r.map(x => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
