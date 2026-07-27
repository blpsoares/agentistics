import { test, expect } from 'bun:test'
import { resolveOpenSessionIds, sessionIdFromArgv } from './live-sessions'
import type { SessionMeta } from '@agentistics/core'

function s(id: string, project: string, lastTs: string): SessionMeta {
  return {
    session_id: id, project_path: project, start_time: lastTs, end_time: lastTs,
    duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    first_prompt: '', user_interruptions: 0, user_response_times: [], tool_errors: 0,
    tool_error_categories: {}, uses_task_agent: false, uses_mcp: false,
    uses_web_search: false, uses_web_fetch: false, lines_added: 0, lines_removed: 0,
    files_modified: 0, message_hours: [], user_message_timestamps: [], harness: 'claude',
  } as SessionMeta
}

test('one process → the most-recently-active session in that project is open', () => {
  const sessions = [
    s('old', '/proj/a', '2026-07-01T10:00:00Z'),
    s('new', '/proj/a', '2026-07-08T10:00:00Z'),
    s('other', '/proj/b', '2026-07-08T11:00:00Z'),
  ]
  const open = resolveOpenSessionIds(['/proj/a'], sessions)
  expect([...open]).toEqual(['new'])
})

test('two processes in the same project → the two most-recent sessions are open', () => {
  const sessions = [
    s('s1', '/proj/a', '2026-07-01T00:00:00Z'),
    s('s2', '/proj/a', '2026-07-05T00:00:00Z'),
    s('s3', '/proj/a', '2026-07-08T00:00:00Z'),
  ]
  const open = resolveOpenSessionIds(['/proj/a', '/proj/a'], sessions)
  expect(open.has('s3')).toBe(true)
  expect(open.has('s2')).toBe(true)
  expect(open.has('s1')).toBe(false)
})

test('processes across different projects each open their own project session', () => {
  const sessions = [s('a', '/proj/a', '2026-07-08T00:00:00Z'), s('b', '/proj/b', '2026-07-08T00:00:00Z')]
  const open = resolveOpenSessionIds(['/proj/a', '/proj/b'], sessions)
  expect(open).toEqual(new Set(['a', 'b']))
})

test('no processes → nothing open; process with no matching project → nothing', () => {
  const sessions = [s('a', '/proj/a', '2026-07-08T00:00:00Z')]
  expect(resolveOpenSessionIds([], sessions).size).toBe(0)
  expect(resolveOpenSessionIds(['/proj/zzz'], sessions).size).toBe(0)
})

// --- identity from argv ------------------------------------------------------------------------

const UUID_A = '1f9f48c3-6e75-4009-addd-fba4c3a53877'
const UUID_B = 'c3deac99-b178-4004-910d-81725ee42b20'

test('sessionIdFromArgv reads the id the IDE extension passes', () => {
  // Real argv shape, trimmed: the extension always uses the --flag=value form.
  expect(sessionIdFromArgv([
    '/home/u/.vscode-server/extensions/anthropic.claude-code/resources/native-binary/claude',
    '--output-format', 'stream-json', `--resume=${UUID_A}`, '--permission-mode', 'auto',
  ])).toBe(UUID_A)
  expect(sessionIdFromArgv(['claude', '--resume', UUID_B])).toBe(UUID_B)
  expect(sessionIdFromArgv(['claude', '--session-id', UUID_B])).toBe(UUID_B)
  expect(sessionIdFromArgv(['claude', '-r', UUID_B])).toBe(UUID_B)
})

test('sessionIdFromArgv returns nothing when there is no id to read', () => {
  expect(sessionIdFromArgv(['claude'])).toBeUndefined()
  // `--resume` with no value opens the interactive picker; the next arg is a flag, not an id.
  expect(sessionIdFromArgv(['claude', '--resume', '--verbose'])).toBeUndefined()
  expect(sessionIdFromArgv(['claude', '--resume=not-a-uuid'])).toBeUndefined()
  expect(sessionIdFromArgv([])).toBeUndefined()
})

test('a resumed id wins over recency — the regression this file exists for', () => {
  // Measured on a real machine: three extension processes in one project, resuming an OLD session
  // and a recent one. Ranking by recency reported `stale` (last touched the day before) as open.
  const now = Date.parse('2026-07-27T19:30:00Z')
  const sessions = [
    s('recent', '/proj/a', '2026-07-27T19:22:00Z'),
    s('stale', '/proj/a', '2026-07-26T18:18:00Z'),
    s('old-but-open', '/proj/a', '2026-07-25T21:01:00Z'),
  ]
  const open = resolveOpenSessionIds([
    { cwd: '/proj/a', sessionId: 'recent', startedMs: now },
    { cwd: '/proj/a', sessionId: 'old-but-open', startedMs: now },
  ], sessions)
  expect(open).toEqual(new Set(['recent', 'old-but-open']))
  expect(open.has('stale')).toBe(false)
})

test('an anonymous process cannot claim a session that went quiet before it started', () => {
  const sessions = [s('yesterday', '/proj/a', '2026-07-26T18:00:00Z')]
  const started = Date.parse('2026-07-27T09:33:00Z')
  expect(resolveOpenSessionIds([{ cwd: '/proj/a', startedMs: started }], sessions).size).toBe(0)
  // ...but it does claim one that has been active since it launched.
  const live = [s('today', '/proj/a', '2026-07-27T10:00:00Z')]
  expect(resolveOpenSessionIds([{ cwd: '/proj/a', startedMs: started }], live))
    .toEqual(new Set(['today']))
})

test('an anonymous process never steals a session already claimed by an exact id', () => {
  const started = Date.parse('2026-07-27T09:00:00Z')
  const sessions = [
    s('resumed', '/proj/a', '2026-07-27T19:00:00Z'),
    s('fresh', '/proj/a', '2026-07-27T18:00:00Z'),
  ]
  const open = resolveOpenSessionIds([
    { cwd: '/proj/a', sessionId: 'resumed', startedMs: started },
    { cwd: '/proj/a', startedMs: started },
  ], sessions)
  expect(open).toEqual(new Set(['resumed', 'fresh']))
})

test('a resumed id we have no session for is dropped, not guessed at', () => {
  const sessions = [s('a', '/proj/a', '2026-07-27T19:00:00Z')]
  const open = resolveOpenSessionIds(
    [{ cwd: '/proj/a', sessionId: 'deleted-transcript', startedMs: 0 }], sessions)
  expect(open.size).toBe(0)
})
