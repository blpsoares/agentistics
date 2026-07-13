import { test, expect } from 'bun:test'
import type { SessionMeta } from '@agentistics/core'
import { teamDocId, toTeamDoc, fromTeamDoc, parseIngestBody, stampCiSessions } from './team-store'

function session(id: string, harness: SessionMeta['harness'] = 'claude'): SessionMeta {
  return {
    session_id: id, project_path: '/p', start_time: '2026-06-01T00:00:00Z',
    duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    first_prompt: '', user_interruptions: 0, user_response_times: [],
    tool_errors: 0, tool_error_categories: {}, uses_task_agent: false,
    uses_mcp: false, uses_web_search: false, uses_web_fetch: false,
    lines_added: 0, lines_removed: 0, files_modified: 0, message_hours: [],
    user_message_timestamps: [], harness,
  }
}

test('teamDocId composes org:memberId:harness:sessionId', () => {
  // id is keyed by memberId (token hash), not by display name — rename-safe
  expect(teamDocId('acme', 'memberHash123', 'claude', 's1')).toBe('acme:memberHash123:claude:s1')
})

test('toTeamDoc tags user, sets org/memberId/_id, does not mutate input', () => {
  const s = session('s1')
  const doc = toTeamDoc(s, 'acme', 'memberHash123', 'devA')
  // _id is based on memberId, not on the display name
  expect(doc._id).toBe('acme:memberHash123:claude:s1')
  expect(doc.org).toBe('acme')
  expect(doc.memberId).toBe('memberHash123')
  expect(doc.user).toBe('devA')
  expect(doc.session_id).toBe('s1')
  expect(s.user).toBeUndefined() // original untouched
})

test('fromTeamDoc strips _id/org/memberId but keeps user → a plain SessionMeta', () => {
  const doc = toTeamDoc(session('s1'), 'acme', 'memberHash123', 'devA')
  const meta = fromTeamDoc(doc)
  expect((meta as unknown as Record<string, unknown>)._id).toBeUndefined()
  expect((meta as unknown as Record<string, unknown>).org).toBeUndefined()
  expect((meta as unknown as Record<string, unknown>).memberId).toBeUndefined()
  expect(meta.user).toBe('devA')
  expect(meta.session_id).toBe('s1')
})

test('round-trip toTeamDoc→fromTeamDoc preserves the session fields', () => {
  const s = session('s1')
  const meta = fromTeamDoc(toTeamDoc(s, 'acme', 'memberHash123', 'devA'))
  expect(meta.session_id).toBe(s.session_id)
  expect(meta.harness).toBe(s.harness)
  expect(meta.project_path).toBe(s.project_path)
})

test('parseIngestBody accepts a valid body', () => {
  const raw = { org: 'acme', user: 'devA', sessions: [session('s1')] }
  const r = parseIngestBody(raw)
  expect(r.ok).toBe(true)
  if (r.ok) {
    expect(r.body.user).toBe('devA')
    expect(r.body.sessions).toHaveLength(1)
  }
})

test('parseIngestBody rejects a real push missing user', () => {
  const r = parseIngestBody({ org: 'acme', sessions: [session('s1')] })
  expect(r.ok).toBe(false)
})

test('parseIngestBody rejects a real push missing org', () => {
  const r = parseIngestBody({ user: 'devA', sessions: [session('s1')] })
  expect(r.ok).toBe(false)
})

test('parseIngestBody accepts an empty connectivity ping without identity', () => {
  // A body with no sessions stores nothing, so org/user are not required — this is the
  // connectivity check the member uses before saving.
  const r = parseIngestBody({ org: '', user: '', sessions: [] })
  expect(r.ok).toBe(true)
})

test('parseIngestBody rejects a non-array sessions field', () => {
  const r = parseIngestBody({ org: 'acme', user: 'devA', sessions: 'nope' })
  expect(r.ok).toBe(false)
})

test('parseIngestBody rejects a session without a session_id', () => {
  const r = parseIngestBody({ org: 'acme', user: 'devA', sessions: [{ harness: 'claude' }] })
  expect(r.ok).toBe(false)
})

test('stampCiSessions sets git_remote + ci without mutating input', () => {
  const s = session('s1')
  const [out] = stampCiSessions([s], 'github.com/org/repo', true)
  expect(out!.git_remote).toBe('github.com/org/repo')
  expect(out!.ci).toBe(true)
  // original untouched
  expect(s.git_remote).toBeUndefined()
  expect(s.ci).toBeUndefined()
})

test('stampCiSessions overrides whatever the runner reported', () => {
  const s = { ...session('s1'), git_remote: 'github.com/attacker/evil', ci: false }
  const [out] = stampCiSessions([s], 'github.com/org/repo', true)
  expect(out!.git_remote).toBe('github.com/org/repo')
  expect(out!.ci).toBe(true)
})

test('stampCiSessions with no repo and no ci is a passthrough (same ref)', () => {
  const arr = [session('s1')]
  expect(stampCiSessions(arr, undefined, false)).toBe(arr)
})
