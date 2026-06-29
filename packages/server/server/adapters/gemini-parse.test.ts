import { test, expect } from 'bun:test'
import { parseGeminiChat } from './gemini-parse'

// ---------------------------------------------------------------------------
// Rich JSON format — the real format used by Gemini CLI for actual conversations.
// Top-level object with messages[] array; each 'gemini' message carries tokens/model.
// ---------------------------------------------------------------------------

const RICH_JSON_SAMPLE = JSON.stringify({
  sessionId: '6fa861f9-c282-4aef-a436-25f97419462b',
  projectHash: '77a9ebd06022bf0a99faf27b9827fa74aca9cad82e5c90a97d10e623ea36d2bd',
  startTime: '2026-02-22T23:59:21.807Z',
  lastUpdated: '2026-02-23T00:04:37.280Z',
  messages: [
    {
      id: 'msg-u1',
      timestamp: '2026-02-22T23:59:21.807Z',
      type: 'user',
      content: [
        { text: 'fix the typing error in security.middleware.test.ts' },
        { text: '\n--- Content from referenced files ---' },
      ],
      displayContent: [
        { text: 'fix the typing error in security.middleware.test.ts' },
      ],
    },
    {
      id: 'msg-g1',
      timestamp: '2026-02-22T23:59:34.417Z',
      type: 'gemini',
      content: 'I will start by investigating the reported typing error.',
      thoughts: [{ subject: 'Inspecting', description: 'Looking at the error.', timestamp: '2026-02-22T23:59:24.468Z' }],
      tokens: { input: 9651, output: 84, cached: 3190, thoughts: 478, tool: 0, total: 10213 },
      model: 'gemini-3-flash-preview',
      toolCalls: [
        { id: 'tc-1', name: 'run_shell_command', args: { command: 'bun test ...' }, status: 'success', timestamp: '2026-02-22T23:59:37.713Z' },
      ],
    },
    {
      id: 'msg-g2',
      timestamp: '2026-02-22T23:59:42.282Z',
      type: 'gemini',
      content: "I'll examine the security middleware.",
      thoughts: [],
      tokens: { input: 11058, output: 53, cached: 9495, thoughts: 119, tool: 0, total: 11230 },
      model: 'gemini-3-flash-preview',
      toolCalls: [
        { id: 'tc-2', name: 'read_file', args: {}, status: 'success', timestamp: '2026-02-22T23:59:50.000Z' },
        { id: 'tc-3', name: 'run_shell_command', args: {}, status: 'success', timestamp: '2026-02-22T23:59:55.000Z' },
      ],
    },
    {
      id: 'msg-info1',
      timestamp: '2026-02-23T00:00:00.000Z',
      type: 'info',
      content: 'Tool result',
    },
    {
      id: 'msg-u2',
      timestamp: '2026-02-23T00:04:37.280Z',
      type: 'user',
      content: [{ text: 'thanks, that fixed it!' }],
      displayContent: [{ text: 'thanks, that fixed it!' }],
    },
  ],
})

test('parses rich Gemini JSON format with tokens and model', () => {
  const s = parseGeminiChat(RICH_JSON_SAMPLE, 'fallback-rich', '/home/user/prontuario')
  expect(s).not.toBeNull()
  expect(s!.harness).toBe('gemini')
  expect(s!._source).toBe('jsonl')
  expect(s!.session_id).toBe('fallback-rich')
  expect(s!.project_path).toBe('/home/user/prontuario')
  expect(s!.start_time).toBe('2026-02-22T23:59:21.807Z')
  expect(s!.end_time).toBe('2026-02-23T00:04:37.280Z')
  // 2 genuine user messages, 2 gemini responses, 1 info (skipped)
  expect(s!.user_message_count).toBe(2)
  expect(s!.assistant_message_count).toBe(2)
  // Token sums across all gemini messages: input=9651+11058=20709, output=84+53=137, cached=3190+9495=12685
  expect(s!.input_tokens).toBe(20709)
  expect(s!.output_tokens).toBe(137)
  expect(s!.cache_read_input_tokens).toBe(12685)
  // Model from gemini messages
  expect(s!.model).toBe('gemini-3-flash-preview')
  // first_prompt from displayContent of first user message
  expect(s!.first_prompt).toBe('fix the typing error in security.middleware.test.ts')
  // message_hours: user1 + gemini1 + gemini2 + user2 = 4 entries (info excluded)
  expect(s!.message_hours.length).toBe(4)
  // user_message_timestamps: 2 user messages
  expect(s!.user_message_timestamps.length).toBe(2)
  // tool_counts: run_shell_command x2, read_file x1
  expect(s!.tool_counts['run_shell_command']).toBe(2)
  expect(s!.tool_counts['read_file']).toBe(1)
})

test('rich JSON format: bootstrap-only info messages return null', () => {
  const bootstrapOnly = JSON.stringify({
    sessionId: 'auth-session',
    startTime: '2026-02-22T23:55:53.342Z',
    lastUpdated: '2026-02-22T23:56:34.853Z',
    messages: [
      { id: 'i1', timestamp: '2026-02-22T23:55:53.342Z', type: 'info', content: 'Code Assist login required.' },
      { id: 'i2', timestamp: '2026-02-22T23:55:53.367Z', type: 'info', content: 'Waiting for authentication...' },
      { id: 'i3', timestamp: '2026-02-22T23:56:22.684Z', type: 'info', content: 'Code Assist login required.' },
    ],
  })
  expect(parseGeminiChat(bootstrapOnly, 'bootstrap-only', '/proj')).toBeNull()
})

test('rich JSON format: injected session_context user message returns null (no gemini responses)', () => {
  const injectedOnly = JSON.stringify({
    sessionId: 'injected-session',
    startTime: '2026-06-18T10:00:00.000Z',
    lastUpdated: '2026-06-18T10:00:01.000Z',
    messages: [
      {
        id: 'u1',
        timestamp: '2026-06-18T10:00:00.500Z',
        type: 'user',
        content: [{ text: '<session_context>\nsome context\n</session_context>' }],
        displayContent: [{ text: '<session_context>\nsome context\n</session_context>' }],
      },
    ],
  })
  expect(parseGeminiChat(injectedOnly, 'injected-only', '/proj')).toBeNull()
})

test('rich JSON format: zero-token gemini message still counted as assistant message', () => {
  const zeroToken = JSON.stringify({
    sessionId: 'zero-token',
    startTime: '2026-06-18T10:00:00.000Z',
    lastUpdated: '2026-06-18T10:00:05.000Z',
    messages: [
      { id: 'g1', timestamp: '2026-06-18T10:00:05.000Z', type: 'gemini', content: 'Hello!', tokens: { input: 0, output: 0, cached: 0, thoughts: 0, tool: 0, total: 0 }, model: 'gemini-3-flash-preview' },
    ],
  })
  const s = parseGeminiChat(zeroToken, 'zero-token', '/proj')
  expect(s).not.toBeNull()
  expect(s!.assistant_message_count).toBe(1)
  expect(s!.input_tokens).toBe(0)
  expect(s!.model).toBe('gemini-3-flash-preview')
})

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
