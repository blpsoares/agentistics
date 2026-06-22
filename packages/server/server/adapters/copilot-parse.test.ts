import { test, expect } from 'bun:test'
import { parseCopilotEvents } from './copilot-parse'

// Minimal real-world-shaped sample — no session.shutdown (crashed/no clean exit)
const SAMPLE_NO_SHUTDOWN = [
  JSON.stringify({ type: 'session.start', data: { sessionId: 'uuid-abc-123', startTime: '2026-02-23T00:04:51.096Z', context: { cwd: '/home/u/proj', gitRoot: '/home/u/proj', branch: 'main', repository: 'user/repo' } }, timestamp: '2026-02-23T00:04:51.119Z' }),
  JSON.stringify({ type: 'session.info', data: { infoType: 'mcp', message: 'GitHub MCP Server: Connected' }, timestamp: '2026-02-23T00:05:00.000Z' }),
  JSON.stringify({ type: 'session.info', data: { infoType: 'authentication', message: 'Signed in successfully' }, timestamp: '2026-02-23T00:05:01.000Z' }),
  JSON.stringify({ type: 'user.message', data: { content: 'hello copilot' }, timestamp: '2026-02-23T00:06:00.000Z' }),
  JSON.stringify({ type: 'assistant.turn_start', data: { turnId: '0' }, timestamp: '2026-02-23T00:06:01.000Z' }),
  JSON.stringify({ type: 'assistant.turn_end', data: { turnId: '0' }, timestamp: '2026-02-23T00:07:00.000Z' }),
  JSON.stringify({ type: 'session.error', data: { errorType: 'query', message: 'Something failed' }, timestamp: '2026-02-23T00:07:01.000Z' }),
].join('\n')

// Session with a clean shutdown — carries full token metrics, model, and code changes
const SHUTDOWN_EVENT = {
  type: 'session.shutdown',
  data: {
    shutdownType: 'routine',
    totalPremiumRequests: 0.66,
    totalApiDurationMs: 5073,
    sessionStartTime: 1782082362688,
    codeChanges: {
      linesAdded: 12,
      linesRemoved: 3,
      filesModified: ['/home/u/proj/src/foo.ts', '/home/u/proj/src/bar.ts'],
    },
    modelMetrics: {
      'gpt-5.4-mini': {
        requests: { count: 2, cost: 0.66 },
        usage: {
          inputTokens: 37453,
          outputTokens: 65,
          cacheReadTokens: 18432,
          cacheWriteTokens: 0,
          reasoningTokens: 43,
        },
      },
    },
    currentModel: 'gpt-5.4-mini',
    currentTokens: 20294,
  },
  id: 'shutdown-event-id',
  timestamp: '2026-02-23T00:10:00.000Z',
}

const SAMPLE_WITH_SHUTDOWN = [
  JSON.stringify({ type: 'session.start', data: { sessionId: 'uuid-def-456', startTime: '2026-02-23T00:04:51.096Z', context: { cwd: '/home/u/proj' } }, timestamp: '2026-02-23T00:04:51.119Z' }),
  JSON.stringify({ type: 'user.message', data: { content: 'hello copilot' }, timestamp: '2026-02-23T00:06:00.000Z' }),
  JSON.stringify({ type: 'user.message', data: { content: 'second message' }, timestamp: '2026-02-23T01:00:00.000Z' }),
  JSON.stringify({ type: 'assistant.turn_start', data: { turnId: '0' }, timestamp: '2026-02-23T00:06:01.000Z' }),
  JSON.stringify(SHUTDOWN_EVENT),
].join('\n')

test('parses a copilot events.jsonl without shutdown into a SessionMeta', () => {
  const s = parseCopilotEvents(SAMPLE_NO_SHUTDOWN, 'fallback-id')
  expect(s).not.toBeNull()
  expect(s!.harness).toBe('copilot')
  expect(s!._source).toBe('jsonl')
  expect(s!.session_id).toBe('uuid-abc-123')
  expect(s!.project_path).toBe('/home/u/proj')
  expect(s!.start_time).toBe('2026-02-23T00:04:51.096Z')
  expect(s!.user_message_count).toBe(1)
  expect(s!.assistant_message_count).toBe(1)
  expect(s!.uses_mcp).toBe(true)
  expect(s!.tool_errors).toBe(1)
  // no tokens/model without clean shutdown
  expect(s!.input_tokens).toBe(0)
  expect(s!.output_tokens).toBe(0)
  expect(s!.cache_read_input_tokens).toBe(0)
  expect(s!.model).toBeUndefined()
  expect(s!.lines_added).toBe(0)
  expect(s!.lines_removed).toBe(0)
  expect(s!.files_modified).toBe(0)
  // first prompt captured from user.message
  expect(s!.first_prompt).toBe('hello copilot')
  // duration: from startTime to last event timestamp
  expect(s!.duration_minutes).toBeGreaterThan(0)
  // user.message at 00:06:00Z → hour=0, timestamp captured
  expect(s!.user_message_timestamps).toEqual(['2026-02-23T00:06:00.000Z'])
  expect(s!.message_hours).toEqual([0])
})

test('extracts tokens, model, and code changes from session.shutdown', () => {
  const s = parseCopilotEvents(SAMPLE_WITH_SHUTDOWN, 'fallback-id')
  expect(s).not.toBeNull()
  expect(s!.session_id).toBe('uuid-def-456')
  // Token metrics from modelMetrics
  expect(s!.input_tokens).toBe(37453)
  expect(s!.output_tokens).toBe(65)
  expect(s!.cache_read_input_tokens).toBe(18432)
  expect(s!.cache_creation_input_tokens).toBe(0)
  // Model from currentModel
  expect(s!.model).toBe('gpt-5.4-mini')
  // Code changes
  expect(s!.lines_added).toBe(12)
  expect(s!.lines_removed).toBe(3)
  expect(s!.files_modified).toBe(2) // length of filesModified array
  // first_prompt from first user.message
  expect(s!.first_prompt).toBe('hello copilot')
  // Turn counts and timestamps still work
  expect(s!.user_message_count).toBe(2)
  expect(s!.assistant_message_count).toBe(1)
  expect(s!.user_message_timestamps).toEqual([
    '2026-02-23T00:06:00.000Z',
    '2026-02-23T01:00:00.000Z',
  ])
  expect(s!.message_hours).toEqual([0, 1])
})

test('returns null on empty content', () => {
  expect(parseCopilotEvents('', 'fb')).toBeNull()
  expect(parseCopilotEvents('   \n  ', 'fb')).toBeNull()
})

test('falls back to fallbackId when no session.start present', () => {
  const noStart = JSON.stringify({ type: 'user.message', data: { content: 'hi' }, timestamp: '2026-02-23T01:00:00.000Z' })
  const s = parseCopilotEvents(noStart, 'dir-uuid')
  expect(s).not.toBeNull()
  expect(s!.session_id).toBe('dir-uuid')
  expect(s!.user_message_count).toBe(1)
  expect(s!.uses_mcp).toBe(false)
})

test('mcp flag only set by session.info with infoType=mcp', () => {
  const noMcp = [
    JSON.stringify({ type: 'session.start', data: { sessionId: 'x', startTime: '2026-01-01T00:00:00.000Z', context: { cwd: '/a' } }, timestamp: '2026-01-01T00:00:00.000Z' }),
    JSON.stringify({ type: 'session.info', data: { infoType: 'authentication', message: 'ok' }, timestamp: '2026-01-01T00:00:01.000Z' }),
  ].join('\n')
  const s = parseCopilotEvents(noMcp, 'fb')
  expect(s!.uses_mcp).toBe(false)
})

test('skips malformed JSON lines gracefully', () => {
  const mixed = [
    'not valid json',
    JSON.stringify({ type: 'session.start', data: { sessionId: 'ok-id', startTime: '2026-03-01T10:00:00.000Z', context: { cwd: '/home/x' } }, timestamp: '2026-03-01T10:00:00.000Z' }),
    '{broken',
    JSON.stringify({ type: 'user.message', data: { content: 'test' }, timestamp: '2026-03-01T10:01:00.000Z' }),
  ].join('\n')
  const s = parseCopilotEvents(mixed, 'fb')
  expect(s).not.toBeNull()
  expect(s!.session_id).toBe('ok-id')
  expect(s!.user_message_count).toBe(1)
})
