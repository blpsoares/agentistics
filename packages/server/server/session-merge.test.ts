import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '@agentistics/core'
import { mergeLocalAndIngestedSessions, mergeSessionPair, sessionKey } from './session-merge'

function session(id: string, over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    session_id: id,
    project_path: '/home/dev/app',
    start_time: '2026-07-20T10:00:00.000Z',
    harness: 'claude',
    input_tokens: 100,
    output_tokens: 10,
    ...over,
  } as SessionMeta
}

describe('sessionKey', () => {
  it('keys by harness + session_id so ids never collide across harnesses', () => {
    expect(sessionKey(session('a'))).toBe('claude:a')
    expect(sessionKey(session('a', { harness: 'codex' }))).toBe('codex:a')
  })

  it('treats a missing harness as claude', () => {
    expect(sessionKey({ ...session('a'), harness: undefined } as unknown as SessionMeta)).toBe('claude:a')
  })
})

describe('mergeSessionPair', () => {
  it('keeps the local session data and takes the ingested identity', () => {
    const local = session('a', { input_tokens: 900, output_tokens: 90 })
    const ingested = session('a', {
      input_tokens: 100,
      output_tokens: 10,
      memberId: 'hash-1',
      teamId: 't1',
      teamIds: ['t1', 't2'],
      user: 'Bryan Soares',
    })

    const merged = mergeSessionPair(local, ingested)

    // Local read happened this request; the ingested copy is the last push and can be stale.
    expect(merged.input_tokens).toBe(900)
    expect(merged.output_tokens).toBe(90)
    // Identity is central-owned and load-bearing for scoping.
    expect(merged.memberId).toBe('hash-1')
    expect(merged.teamId).toBe('t1')
    expect(merged.teamIds).toEqual(['t1', 't2'])
    expect(merged.user).toBe('Bryan Soares')
  })

  it('fills fields the local copy lacks without overwriting the ones it has', () => {
    const local = session('a', { git_remote: 'github.com/org/local' })
    const ingested = session('a', { git_remote: 'github.com/org/ingested', model: 'claude-sonnet-4-6' })

    const merged = mergeSessionPair(local, ingested)

    expect(merged.git_remote).toBe('github.com/org/local')
    expect(merged.model).toBe('claude-sonnet-4-6')
  })

  it('does not mutate either input', () => {
    const local = session('a')
    const ingested = session('a', { memberId: 'hash-1' })
    mergeSessionPair(local, ingested)
    expect(local.memberId).toBeUndefined()
    expect(ingested.input_tokens).toBe(100)
  })
})

describe('mergeLocalAndIngestedSessions', () => {
  it('collapses a self-pushing machine to exactly one row per session', () => {
    // The real bug: the central reads its own ~/.claude AND receives the same machine's push.
    const local = [session('a'), session('b')]
    const ingested = [
      session('a', { memberId: 'hash-1', user: 'Bryan Soares' }),
      session('b', { memberId: 'hash-1', user: 'Bryan Soares' }),
    ]

    const { sessions } = mergeLocalAndIngestedSessions(local, ingested)

    expect(sessions).toHaveLength(2)
    expect(sessions.map(s => s.session_id)).toEqual(['a', 'b'])
  })

  it('keeps the fields scoping depends on on every surviving row', () => {
    const local = [session('a')]
    const ingested = [session('a', { memberId: 'hash-1', teamIds: ['t1'], teamId: 't1', user: 'Bryan', ci: true })]

    const { sessions } = mergeLocalAndIngestedSessions(local, ingested)

    expect(sessions).toHaveLength(1)
    const [only] = sessions
    expect(only?.memberId).toBe('hash-1')
    expect(only?.teamIds).toEqual(['t1'])
    expect(only?.teamId).toBe('t1')
    expect(only?.user).toBe('Bryan')
    expect(only?.ci).toBe(true)
  })

  it('keeps sessions that exist in only one of the lists', () => {
    const local = [session('local-only')]
    const ingested = [session('ingest-only', { memberId: 'hash-2', user: 'Vinicius' })]

    const { sessions, ingestOnly } = mergeLocalAndIngestedSessions(local, ingested)

    expect(sessions.map(s => s.session_id).sort()).toEqual(['ingest-only', 'local-only'])
    // Only the ingest-only row still needs to be surfaced as a project by the caller.
    expect(ingestOnly.map(s => s.session_id)).toEqual(['ingest-only'])
  })

  it('reports no ingestOnly rows when every ingested session merged into a local one', () => {
    const { ingestOnly } = mergeLocalAndIngestedSessions([session('a')], [session('a', { memberId: 'h' })])
    expect(ingestOnly).toHaveLength(0)
  })

  it('does not merge across harnesses', () => {
    const local = [session('a')]
    const ingested = [session('a', { harness: 'codex', memberId: 'hash-1' })]

    const { sessions } = mergeLocalAndIngestedSessions(local, ingested)

    expect(sessions).toHaveLength(2)
    expect(sessions.map(s => s.harness).sort()).toEqual(['claude', 'codex'])
  })

  it('collapses duplicates within a single list', () => {
    const local = [session('a', { input_tokens: 1 }), session('a', { input_tokens: 2 })]
    const ingested = [session('b', { memberId: 'x' }), session('b', { memberId: 'y' })]

    const { sessions } = mergeLocalAndIngestedSessions(local, ingested)

    expect(sessions).toHaveLength(2)
    expect(sessions.find(s => s.session_id === 'a')?.input_tokens).toBe(1) // first local wins
    expect(sessions.find(s => s.session_id === 'b')?.memberId).toBe('y') // last ingest doc wins
  })

  it('handles empty lists', () => {
    expect(mergeLocalAndIngestedSessions([], []).sessions).toEqual([])
    expect(mergeLocalAndIngestedSessions([], []).ingestOnly).toEqual([])

    const onlyLocal = mergeLocalAndIngestedSessions([session('a')], [])
    expect(onlyLocal.sessions).toHaveLength(1)
    expect(onlyLocal.ingestOnly).toHaveLength(0)

    const onlyIngest = mergeLocalAndIngestedSessions([], [session('a', { memberId: 'h' })])
    expect(onlyIngest.sessions).toHaveLength(1)
    expect(onlyIngest.ingestOnly).toHaveLength(1)
  })

  it('preserves local order, then appends ingest-only rows', () => {
    const local = [session('a'), session('b')]
    const ingested = [session('z', { memberId: 'h' }), session('a', { memberId: 'h' })]

    const { sessions } = mergeLocalAndIngestedSessions(local, ingested)

    expect(sessions.map(s => s.session_id)).toEqual(['a', 'b', 'z'])
  })
})
