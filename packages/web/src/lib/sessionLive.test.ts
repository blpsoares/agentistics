import { test, expect } from 'bun:test'
import { lastActivityMs, isLive, LIVE_THRESHOLD_MIN } from './sessionLive'
import type { SessionMeta } from '@agentistics/core'

function base(over: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: 's', project_path: '/p', start_time: '2026-07-07T10:00:00Z',
    duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    first_prompt: '', user_interruptions: 0, user_response_times: [], tool_errors: 0,
    tool_error_categories: {}, uses_task_agent: false, uses_mcp: false,
    uses_web_search: false, uses_web_fetch: false, lines_added: 0, lines_removed: 0,
    files_modified: 0, message_hours: [], user_message_timestamps: [],
    harness: 'claude', ...over,
  }
}

test('lastActivityMs prefers end_time', () => {
  const s = base({ end_time: '2026-07-07T12:00:00Z', start_time: '2026-07-07T10:00:00Z' })
  expect(lastActivityMs(s)).toBe(Date.parse('2026-07-07T12:00:00Z'))
})

test('lastActivityMs falls back to last user timestamp then start', () => {
  const s = base({ end_time: undefined, user_message_timestamps: ['2026-07-07T10:30:00Z', '2026-07-07T11:00:00Z'] })
  expect(lastActivityMs(s)).toBe(Date.parse('2026-07-07T11:00:00Z'))
  const s2 = base({ end_time: undefined, user_message_timestamps: [] })
  expect(lastActivityMs(s2)).toBe(Date.parse('2026-07-07T10:00:00Z'))
})

test('isLive true within threshold, false outside', () => {
  const now = Date.parse('2026-07-07T12:00:00Z')
  const liveS = base({ end_time: '2026-07-07T11:55:00Z' })
  const deadS = base({ end_time: '2026-07-07T11:30:00Z' })
  expect(isLive(liveS, now, LIVE_THRESHOLD_MIN)).toBe(true)
  expect(isLive(deadS, now, LIVE_THRESHOLD_MIN)).toBe(false)
})
