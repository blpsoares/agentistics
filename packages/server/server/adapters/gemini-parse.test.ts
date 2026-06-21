import { test, expect } from 'bun:test'
import { parseGeminiChat } from './gemini-parse'

// ---------------------------------------------------------------------------
// JSONL streaming format sample — mirrors the real Gemini CLI file structure.
// Headers repeat before each $set (MongoDB-style state update).
// Messages array is a snapshot; unique messages are accumulated across all $set lines.
// ---------------------------------------------------------------------------
const JSONL_SAMPLE = [
  // Header
  JSON.stringify({ sessionId: 'a2a-server', projectHash: 'abc123', startTime: '2026-06-18T16:31:11.084Z', lastUpdated: '2026-06-18T16:31:11.084Z', kind: 'main' }),
  // First snapshot: 1 user message
  JSON.stringify({ $set: { messages: [{ id: 'msg-1', timestamp: '2026-06-18T16:31:11.085Z', type: 'user', content: [{ text: 'hello' }] }] } }),
  // Updated header (lastUpdated advanced)
  JSON.stringify({ sessionId: 'a2a-server', projectHash: 'abc123', startTime: '2026-06-18T16:31:11.084Z', lastUpdated: '2026-06-18T16:32:00.000Z', kind: 'main' }),
  // Second snapshot: same user message + model response (snapshot grows)
  JSON.stringify({ $set: { messages: [
    { id: 'msg-1', timestamp: '2026-06-18T16:31:11.085Z', type: 'user', content: [{ text: 'hello' }] },
    { id: 'msg-2', timestamp: '2026-06-18T16:31:55.000Z', type: 'model', content: [{ text: 'Hi there!' }] },
  ] } }),
  // Third update header
  JSON.stringify({ sessionId: 'a2a-server', projectHash: 'abc123', startTime: '2026-06-18T16:31:11.084Z', lastUpdated: '2026-06-18T16:33:00.000Z', kind: 'main' }),
  // Third snapshot: adds another user message
  JSON.stringify({ $set: { messages: [
    { id: 'msg-1', timestamp: '2026-06-18T16:31:11.085Z', type: 'user', content: [{ text: 'hello' }] },
    { id: 'msg-2', timestamp: '2026-06-18T16:31:55.000Z', type: 'model', content: [{ text: 'Hi there!' }] },
    { id: 'msg-3', timestamp: '2026-06-18T16:32:45.000Z', type: 'user', content: [{ text: 'thanks' }] },
  ] } }),
].join('\n')

test('parses Gemini JSONL streaming format into a SessionMeta', () => {
  const s = parseGeminiChat(JSONL_SAMPLE, 'fallback-id', '/home/user/myproject')
  expect(s).not.toBeNull()
  expect(s!.harness).toBe('gemini')
  expect(s!._source).toBe('jsonl')
  expect(s!.session_id).toBe('fallback-id')
  expect(s!.project_path).toBe('/home/user/myproject')
  expect(s!.start_time).toBe('2026-06-18T16:31:11.084Z')
  expect(s!.end_time).toBe('2026-06-18T16:33:00.000Z')
  // 2 user messages (msg-1, msg-3), 1 model (msg-2) — de-duped across snapshots
  expect(s!.user_message_count).toBe(2)
  expect(s!.assistant_message_count).toBe(1)
  // Tokens and cost stay 0 / undefined (Gemini doesn't expose them)
  expect(s!.input_tokens).toBe(0)
  expect(s!.output_tokens).toBe(0)
  expect(s!.model).toBeUndefined()
  // message_hours collected from all unique messages
  expect(s!.message_hours.length).toBe(3)
  // user_message_timestamps for user messages only
  expect(s!.user_message_timestamps.length).toBe(2)
  // duration: from startTime to last lastUpdated
  expect(s!.duration_minutes).toBeCloseTo((new Date('2026-06-18T16:33:00.000Z').getTime() - new Date('2026-06-18T16:31:11.084Z').getTime()) / 60000, 1)
})

test('deduplicates messages that appear in multiple $set snapshots', () => {
  // Each snapshot is a full state — msg-1 appears in all 3 snapshots but should be counted once
  const s = parseGeminiChat(JSONL_SAMPLE, 'fb', '/proj')
  expect(s!.user_message_count).toBe(2)
  expect(s!.assistant_message_count).toBe(1)
})

// ---------------------------------------------------------------------------
// Legacy JSON format (older Gemini CLI versions)
// ---------------------------------------------------------------------------
const LEGACY_JSON_SAMPLE = JSON.stringify({
  sessionId: '6fa861f9-c282-4aef-a436-25f97419462b',
  projectHash: 'deadbeef',
  startTime: '2026-02-22T23:59:21.807Z',
  lastUpdated: '2026-02-23T00:04:37.280Z',
  messages: [
    { id: 'm1', timestamp: '2026-02-22T23:59:21.807Z', type: 'user', content: [{ text: 'fix the bug' }] },
    { id: 'm2', timestamp: '2026-02-22T23:59:34.417Z', type: 'gemini', content: 'I will look into it.' },
    { id: 'm3', timestamp: '2026-02-22T23:59:42.282Z', type: 'gemini', content: 'Found the issue.' },
    { id: 'm4', timestamp: '2026-02-23T00:00:02.672Z', type: 'info', content: 'Tool result' },
    { id: 'm5', timestamp: '2026-02-23T00:04:37.280Z', type: 'user', content: [{ text: 'thanks' }] },
  ],
})

test('parses legacy Gemini JSON format', () => {
  const s = parseGeminiChat(LEGACY_JSON_SAMPLE, 'fallback', '/home/user/prontuario')
  expect(s).not.toBeNull()
  expect(s!.harness).toBe('gemini')
  expect(s!._source).toBe('jsonl')
  expect(s!.session_id).toBe('fallback')
  expect(s!.project_path).toBe('/home/user/prontuario')
  expect(s!.start_time).toBe('2026-02-22T23:59:21.807Z')
  expect(s!.end_time).toBe('2026-02-23T00:04:37.280Z')
  // 2 user messages, 2 gemini (model) messages; 'info' is neither
  expect(s!.user_message_count).toBe(2)
  expect(s!.assistant_message_count).toBe(2)
  expect(s!.input_tokens).toBe(0)
  expect(s!.model).toBeUndefined()
})

// ---------------------------------------------------------------------------
// Bootstrap injection filtering
// ---------------------------------------------------------------------------

const BOOTSTRAP_ONLY_JSONL = [
  JSON.stringify({ sessionId: 'sess1', startTime: '2026-06-18T10:00:00.000Z', lastUpdated: '2026-06-18T10:00:01.000Z', kind: 'main' }),
  JSON.stringify({ $set: { messages: [
    { id: 'b1', timestamp: '2026-06-18T10:00:00.500Z', type: 'user', content: [{ text: '<session_context>\nsome context\n</session_context>' }] },
  ] } }),
].join('\n')

test('returns null when the only user message is an injected <session_context> bootstrap', () => {
  const result = parseGeminiChat(BOOTSTRAP_ONLY_JSONL, 'bootstrap-only', '/proj')
  expect(result).toBeNull()
})

test('returns null when the only user message is an injected <environment_context> bootstrap', () => {
  const envBootstrap = [
    JSON.stringify({ sessionId: 'sess2', startTime: '2026-06-18T10:00:00.000Z', lastUpdated: '2026-06-18T10:00:01.000Z', kind: 'main' }),
    JSON.stringify({ $set: { messages: [
      { id: 'e1', timestamp: '2026-06-18T10:00:00.500Z', type: 'user', content: [{ text: '<environment_context>\nenv info\n</environment_context>' }] },
    ] } }),
  ].join('\n')
  expect(parseGeminiChat(envBootstrap, 'env-bootstrap', '/proj')).toBeNull()
})

test('returns a SessionMeta with correct counts when a genuine user message and model response are present (bootstrap ignored)', () => {
  const mixed = [
    JSON.stringify({ sessionId: 'sess3', startTime: '2026-06-18T10:00:00.000Z', lastUpdated: '2026-06-18T10:02:00.000Z', kind: 'main' }),
    JSON.stringify({ $set: { messages: [
      { id: 'b1', timestamp: '2026-06-18T10:00:00.100Z', type: 'user', content: [{ text: '<session_context>\nctx\n</session_context>' }] },
      { id: 'u1', timestamp: '2026-06-18T10:00:10.000Z', type: 'user', content: [{ text: 'what is 2+2?' }] },
      { id: 'm1', timestamp: '2026-06-18T10:00:15.000Z', type: 'model', content: [{ text: '4' }] },
    ] } }),
  ].join('\n')
  const s = parseGeminiChat(mixed, 'mixed-id', '/proj')
  expect(s).not.toBeNull()
  // Only genuine user message is counted (bootstrap excluded)
  expect(s!.user_message_count).toBe(1)
  expect(s!.assistant_message_count).toBe(1)
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('returns null on empty content', () => {
  expect(parseGeminiChat('', 'fb', '/proj')).toBeNull()
  expect(parseGeminiChat('   \n  ', 'fb', '/proj')).toBeNull()
})

test('falls back to fallbackId when sessionId is missing', () => {
  const line0 = JSON.stringify({ projectHash: 'x', startTime: '2026-01-01T00:00:00.000Z', lastUpdated: '2026-01-01T00:01:00.000Z', kind: 'main' })
  const line1 = JSON.stringify({ $set: { messages: [{ id: 'x1', timestamp: '2026-01-01T00:00:05.000Z', type: 'user', content: [{ text: 'hi' }] }] } })
  const s = parseGeminiChat([line0, line1].join('\n'), 'my-fallback-id', '/proj')
  expect(s!.session_id).toBe('my-fallback-id')
})

test('two files with identical header sessionId produce DIFFERENT session_ids when fallbackId differs', () => {
  // Both files have header sessionId: 'a2a-server' (the shared generic label)
  // but are different files → different fallbackIds → different session_ids
  const makeContent = (extra: string) => [
    JSON.stringify({ sessionId: 'a2a-server', startTime: '2026-06-18T10:00:00.000Z', lastUpdated: '2026-06-18T10:01:00.000Z', kind: 'main' }),
    JSON.stringify({ $set: { messages: [{ id: `msg-${extra}`, timestamp: '2026-06-18T10:00:05.000Z', type: 'user', content: [{ text: extra }] }] } }),
  ].join('\n')

  const s1 = parseGeminiChat(makeContent('hello'), 'project-A/chat-001', '/home/user/project-a')
  const s2 = parseGeminiChat(makeContent('world'), 'project-B/chat-001', '/home/user/project-b')

  expect(s1).not.toBeNull()
  expect(s2).not.toBeNull()
  expect(s1!.session_id).toBe('project-A/chat-001')
  expect(s2!.session_id).toBe('project-B/chat-001')
  expect(s1!.session_id).not.toBe(s2!.session_id)
})

test('handles $set messages without id field (no dedup crash)', () => {
  const line0 = JSON.stringify({ sessionId: 'sess', startTime: '2026-01-01T10:00:00.000Z', lastUpdated: '2026-01-01T10:05:00.000Z', kind: 'main' })
  const line1 = JSON.stringify({ $set: { messages: [{ timestamp: '2026-01-01T10:00:01.000Z', type: 'user', content: [{ text: 'no id' }] }] } })
  const s = parseGeminiChat([line0, line1].join('\n'), 'fb', '/proj')
  expect(s!.user_message_count).toBe(1)
})
