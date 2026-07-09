import { test, expect } from 'bun:test'
import { resolveOpenSessionIds } from './live-sessions'
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
