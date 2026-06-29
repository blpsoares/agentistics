import { test, expect } from 'bun:test'
import { parseCodexRollout } from './codex-parse'

const SAMPLE = [
  JSON.stringify({ timestamp: '2026-05-25T18:25:51.037Z', type: 'session_meta', payload: { id: 'abc-123', timestamp: '2026-05-25T18:25:50.087Z', cwd: '/home/u/proj', model_provider: 'openai' } }),
  JSON.stringify({ timestamp: '2026-05-25T18:25:52.000Z', type: 'turn_context', payload: { model: 'gpt-5.5', cwd: '/home/u/proj' } }),
  JSON.stringify({ timestamp: '2026-05-25T18:25:53.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'hi' } }),
  JSON.stringify({ timestamp: '2026-05-25T18:25:54.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 5 } } } }),
  JSON.stringify({ timestamp: '2026-05-25T18:25:55.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'hello' } }),
  JSON.stringify({ timestamp: '2026-05-25T18:25:56.000Z', type: 'response_item', payload: { type: 'web_search_call' } }),
  JSON.stringify({ timestamp: '2026-05-25T18:25:57.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 300, cached_input_tokens: 80, output_tokens: 42 } } } }),
].join('\n')

test('parses a codex rollout (real envelope format) into a SessionMeta', () => {
  const s = parseCodexRollout(SAMPLE, 'fallback-id')
  expect(s).not.toBeNull()
  expect(s!.session_id).toBe('abc-123')
  expect(s!.harness).toBe('codex')
  expect(s!.project_path).toBe('/home/u/proj')
  expect(s!.model).toBe('gpt-5.5')
  // last token_count wins (cumulative); input is non-cached portion (300-80), cache stored separately
  expect(s!.input_tokens).toBe(220)
  expect(s!.cache_read_input_tokens).toBe(80)
  expect(s!.output_tokens).toBe(42)
  expect(s!.user_message_count).toBe(1)
  expect(s!.assistant_message_count).toBe(1)
  expect(s!.uses_web_search).toBe(true)
  expect(s!.tool_counts['web_search_call']).toBe(1)
  expect(s!.start_time).toBe('2026-05-25T18:25:50.087Z')
  expect(s!._source).toBe('jsonl')
  // first_prompt = text of the first user_message
  expect(s!.first_prompt).toBe('hi')
  // message_hours: user_message at 18:25:53Z (hour=18) + agent_message at 18:25:55Z (hour=18)
  expect(s!.message_hours).toEqual([18, 18])
  // user_message_timestamps: only the user_message line
  expect(s!.user_message_timestamps).toEqual(['2026-05-25T18:25:53.000Z'])
})

test('falls back to fallbackId and returns null on empty', () => {
  expect(parseCodexRollout('', 'fb')).toBeNull()
  const noMeta = parseCodexRollout(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }), 'fb-2')
  expect(noMeta!.session_id).toBe('fb-2')
  expect(noMeta!.user_message_count).toBe(1)
})
