import { test, expect } from 'bun:test'
import type { SessionMeta } from './types'
import { tagUser, distinctUsers, filterByUsers } from './team'

function session(id: string, user?: string): SessionMeta {
  return {
    session_id: id, project_path: '/p', start_time: '2026-06-01T00:00:00Z',
    duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    first_prompt: '', user_interruptions: 0, user_response_times: [],
    tool_errors: 0, tool_error_categories: {}, uses_task_agent: false,
    uses_mcp: false, uses_web_search: false, uses_web_fetch: false,
    lines_added: 0, lines_removed: 0, files_modified: 0, message_hours: [],
    user_message_timestamps: [], harness: 'claude', user,
  }
}

test('tagUser sets the user without mutating the input', () => {
  const s = session('a')
  const tagged = tagUser(s, 'devA')
  expect(tagged.user).toBe('devA')
  expect(s.user).toBeUndefined() // original untouched
})

test('distinctUsers returns sorted unique users and skips undefined', () => {
  const sessions = [session('1', 'devB'), session('2', 'devA'), session('3', 'devB'), session('4')]
  expect(distinctUsers(sessions)).toEqual(['devA', 'devB'])
})

test('filterByUsers with empty selection passes everything through', () => {
  const sessions = [session('1', 'devA'), session('2', 'devB')]
  expect(filterByUsers(sessions, [])).toHaveLength(2)
})

test('filterByUsers keeps only selected users and drops untagged sessions', () => {
  const sessions = [session('1', 'devA'), session('2', 'devB'), session('3')]
  const result = filterByUsers(sessions, ['devA'])
  expect(result.map(s => s.session_id)).toEqual(['1'])
})

test('filterByUsers supports multi-select (aggregate of a subset)', () => {
  const sessions = [session('1', 'devA'), session('2', 'devB'), session('3', 'devC')]
  const result = filterByUsers(sessions, ['devA', 'devB'])
  expect(result.map(s => s.session_id).sort()).toEqual(['1', '2'])
})
