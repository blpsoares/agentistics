import { test, expect } from 'bun:test'
import { parseCodexRollout } from './codex-parse'

const SAMPLE = [
  JSON.stringify({ timestamp: '2026-05-25T18:25:51.037Z', type: 'session_meta', payload: { id: 'abc-123', timestamp: '2026-05-25T18:25:50.087Z', cwd: '/home/u/proj', model_provider: 'openai', cli_version: '0.133.0', source: 'vscode' } }),
  JSON.stringify({ type: 'turn_context', model: 'gpt-5.5' }),
  JSON.stringify({ type: 'user_message', payload: { text: 'hi' } }),
  JSON.stringify({ type: 'token_count', payload: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 5 } } }),
  JSON.stringify({ type: 'agent_message', payload: { text: 'hello' } }),
  JSON.stringify({ type: 'web_search_call' }),
  JSON.stringify({ type: 'token_count', payload: { total_token_usage: { input_tokens: 300, cached_input_tokens: 80, output_tokens: 42 } } }),
].join('\n')

test('parses a codex rollout into a SessionMeta', () => {
  const s = parseCodexRollout(SAMPLE, 'fallback-id')
  expect(s).not.toBeNull()
  expect(s!.session_id).toBe('abc-123')
  expect(s!.harness).toBe('codex')
  expect(s!.project_path).toBe('/home/u/proj')
  expect(s!.model).toBe('gpt-5.5')
  // last token_count wins (cumulative)
  expect(s!.input_tokens).toBe(300)
  expect(s!.output_tokens).toBe(42)
  expect(s!.cache_read_input_tokens).toBe(80)
  expect(s!.user_message_count).toBe(1)
  expect(s!.assistant_message_count).toBe(1)
  expect(s!.uses_web_search).toBe(true)
  expect(s!.start_time).toBe('2026-05-25T18:25:50.087Z')
  expect(s!._source).toBe('jsonl')
})

test('falls back to fallbackId and returns null on empty', () => {
  expect(parseCodexRollout('', 'fb')).toBeNull()
  const noMeta = parseCodexRollout(JSON.stringify({ type: 'user_message' }), 'fb-2')
  expect(noMeta!.session_id).toBe('fb-2')
  expect(noMeta!.user_message_count).toBe(1)
})
