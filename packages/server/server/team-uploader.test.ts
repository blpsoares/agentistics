/**
 * team-uploader.test.ts — unit tests for pure functions: sessionHash + selectDeltas.
 *
 * These functions have no side effects or external dependencies; they are safe
 * to test without any mocking.
 */

import { describe, it, expect } from 'bun:test'
import { sessionHash, selectDeltas } from './team-uploader'
import type { SessionMeta } from '@agentistics/core'

// Minimal SessionMeta factory — only the fields needed for hashing/keying
function makeSession(id: string, extra?: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: id,
    project_path: `/projects/${id}`,
    start_time: '2026-01-01T00:00:00.000Z',
    duration_minutes: 60,
    user_message_count: 10,
    assistant_message_count: 8,
    tool_counts: {},
    tool_output_tokens: {},
    agent_file_reads: {},
    languages: [],
    git_commits: 0,
    git_pushes: 0,
    input_tokens: 600,
    output_tokens: 400,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    first_prompt: 'hello',
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: 0,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: false,
    uses_web_search: false,
    uses_web_fetch: false,
    lines_added: 5,
    lines_removed: 2,
    files_modified: 1,
    message_hours: [],
    user_message_timestamps: [],
    model: 'claude-sonnet-4-6',
    harness: 'claude',
    ...extra,
  } as SessionMeta
}

describe('sessionHash', () => {
  it('returns the JSON.stringify of the session', () => {
    const s = makeSession('abc')
    expect(sessionHash(s)).toBe(JSON.stringify(s))
  })

  it('differs when content differs', () => {
    const s1 = makeSession('x', { input_tokens: 100 })
    const s2 = makeSession('x', { input_tokens: 200 })
    expect(sessionHash(s1)).not.toBe(sessionHash(s2))
  })

  it('is stable for the same content', () => {
    const s = makeSession('stable')
    expect(sessionHash(s)).toBe(sessionHash({ ...s }))
  })
})

describe('selectDeltas', () => {
  it('sends all sessions when sent state is empty', () => {
    const sessions = [makeSession('a'), makeSession('b')]
    const { toSend, nextSent } = selectDeltas(sessions, {})
    expect(toSend).toHaveLength(2)
    expect(nextSent).toHaveProperty('a', sessionHash(sessions[0]!))
    expect(nextSent).toHaveProperty('b', sessionHash(sessions[1]!))
  })

  it('does not resend a session whose hash is unchanged', () => {
    const s = makeSession('already')
    const sent = { already: sessionHash(s) }
    const { toSend, nextSent } = selectDeltas([s], sent)
    expect(toSend).toHaveLength(0)
    // The unchanged session's hash must still be preserved in nextSent
    expect(nextSent['already']).toBe(sessionHash(s))
  })

  it('resends a session whose hash changed and updates nextSent', () => {
    const old = makeSession('changed', { input_tokens: 100 })
    const updated = makeSession('changed', { input_tokens: 200 })
    const sent = { changed: sessionHash(old) }
    const { toSend, nextSent } = selectDeltas([updated], sent)
    expect(toSend).toHaveLength(1)
    expect(toSend[0]!.session_id).toBe('changed')
    expect(nextSent['changed']).toBe(sessionHash(updated))
  })

  it('sends new sessions while preserving unchanged sessions in nextSent', () => {
    const existing = makeSession('existing', { input_tokens: 42 })
    const brand_new = makeSession('new_session')
    const sent = { existing: sessionHash(existing) }

    const { toSend, nextSent } = selectDeltas([existing, brand_new], sent)
    // Only the new session should be sent
    expect(toSend).toHaveLength(1)
    expect(toSend[0]!.session_id).toBe('new_session')
    // Both sessions should be present in nextSent
    expect(nextSent).toHaveProperty('existing', sessionHash(existing))
    expect(nextSent).toHaveProperty('new_session', sessionHash(brand_new))
  })

  it('skips sessions with no session_id', () => {
    const noId = { ...makeSession('dummy'), session_id: '' } as unknown as SessionMeta
    const { toSend, nextSent } = selectDeltas([noId], {})
    expect(toSend).toHaveLength(0)
    expect(Object.keys(nextSent)).toHaveLength(0)
  })
})
