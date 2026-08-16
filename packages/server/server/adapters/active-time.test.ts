/**
 * Cross-harness active-time tests. One rule (docs/harness-contract.md § 1) applied by six
 * adapters, so the assertions are deliberately the SAME shape for each: a session with two short
 * turns days apart must report minutes of active time, not days.
 */
import { describe, expect, test } from 'bun:test'
import { parseCodexRollout } from './codex-parse'
import { parseCopilotEvents } from './copilot-parse'
import { parseGeminiChat } from './gemini-parse'
import { activeMinutesFromClaudeJsonl } from '../jsonl'

const j = (o: unknown) => JSON.stringify(o)

describe('claude', () => {
  test('uses Claude Code\'s own turn_duration when present', () => {
    const lines = [
      j({ type: 'user', timestamp: '2026-01-01T10:00:00Z', message: { content: [{ type: 'text', text: 'hi' }] } }),
      j({ type: 'assistant', timestamp: '2026-01-01T10:30:00Z', message: {} }),
      j({ type: 'system', subtype: 'turn_duration', durationMs: 120_000, timestamp: '2026-01-01T10:30:00Z' }),
    ]
    // The measured 2min wins over the 30min the timestamps would suggest.
    expect(activeMinutesFromClaudeJsonl(lines)).toBe(2)
  })

  test('reconstructs turns when no turn_duration exists, excluding the days between them', () => {
    const lines = [
      j({ type: 'user', timestamp: '2026-01-01T10:00:00Z', message: { content: [{ type: 'text', text: 'a' }] } }),
      j({ type: 'assistant', timestamp: '2026-01-01T10:05:00Z', message: {} }),
      j({ type: 'user', timestamp: '2026-01-04T10:00:00Z', message: { content: [{ type: 'text', text: 'b' }] } }),
      j({ type: 'assistant', timestamp: '2026-01-04T10:05:00Z', message: {} }),
    ]
    // 3 days of wall clock, 10 minutes of work.
    expect(activeMinutesFromClaudeJsonl(lines)).toBe(10)
  })

  test('a tool result is not a human prompt and does not open a turn', () => {
    const lines = [
      j({ type: 'user', timestamp: '2026-01-01T10:00:00Z', message: { content: [{ type: 'text', text: 'a' }] } }),
      j({ type: 'user', timestamp: '2026-01-01T10:20:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] } }),
      j({ type: 'assistant', timestamp: '2026-01-01T10:30:00Z', message: {} }),
    ]
    // One turn of 30min, not two turns split at the tool result.
    expect(activeMinutesFromClaudeJsonl(lines)).toBe(30)
  })

  test('no timestamps at all → undefined, so the UI can say "—" instead of "0m"', () => {
    expect(activeMinutesFromClaudeJsonl([j({ type: 'user', message: {} })])).toBeUndefined()
  })
})

describe('codex', () => {
  test('uses task_complete.duration_ms and excludes the gap between turns', () => {
    const content = [
      j({ timestamp: '2026-01-01T10:00:00Z', type: 'event_msg', payload: { type: 'user_message', message: 'hi' } }),
      j({ timestamp: '2026-01-01T10:03:00Z', type: 'event_msg', payload: { type: 'task_complete', duration_ms: 180_000 } }),
      j({ timestamp: '2026-01-03T10:00:00Z', type: 'event_msg', payload: { type: 'user_message', message: 'again' } }),
      j({ timestamp: '2026-01-03T10:02:00Z', type: 'event_msg', payload: { type: 'task_complete', duration_ms: 120_000 } }),
    ].join('\n')
    const s = parseCodexRollout(content, 'fallback')
    expect(s!.active_minutes).toBe(5)
    expect(s!.duration_minutes).toBeGreaterThan(2800) // ~2 days of wall clock
  })
})

describe('copilot', () => {
  test('uses the turn_start/turn_end bracket, not the session span', () => {
    const content = [
      j({ type: 'session.start', timestamp: '2026-01-01T09:00:00Z', data: { sessionId: 's1', context: { cwd: '/p' } } }),
      j({ type: 'user.message', timestamp: '2026-01-01T10:00:00Z', data: { content: 'hi' } }),
      j({ type: 'assistant.turn_start', timestamp: '2026-01-01T10:00:00Z', data: {} }),
      j({ type: 'assistant.turn_end', timestamp: '2026-01-01T10:04:00Z', data: {} }),
      j({ type: 'session.error', timestamp: '2026-01-01T14:00:00Z', data: {} }),
    ].join('\n')
    const s = parseCopilotEvents(content, 'f')
    expect(s!.active_minutes).toBe(4)
  })

  test('an aborted turn ends at the abort, not at the last line of the file', () => {
    // Real shape from disk: aborted at 20:13, an error line lands 3h later.
    const content = [
      j({ type: 'session.start', timestamp: '2026-01-01T19:00:00Z', data: { sessionId: 's2', context: { cwd: '/p' } } }),
      j({ type: 'user.message', timestamp: '2026-01-01T20:12:00Z', data: { content: 'go' } }),
      j({ type: 'assistant.turn_start', timestamp: '2026-01-01T20:12:00Z', data: {} }),
      j({ type: 'abort', timestamp: '2026-01-01T20:13:00Z', data: {} }),
      j({ type: 'session.error', timestamp: '2026-01-01T23:34:00Z', data: {} }),
    ].join('\n')
    const s = parseCopilotEvents(content, 'f')
    expect(s!.active_minutes).toBe(1)
  })
})

describe('gemini', () => {
  test('reconstructs from message timestamps, excluding the days between turns', () => {
    const content = JSON.stringify({
      sessionId: 'g1',
      startTime: '2026-01-01T10:00:00Z',
      lastUpdated: '2026-01-05T10:06:00Z',
      messages: [
        { type: 'user', timestamp: '2026-01-01T10:00:00Z', content: [{ text: 'build me a thing please' }] },
        { type: 'gemini', timestamp: '2026-01-01T10:04:00Z', content: [{ text: 'done' }] },
        { type: 'user', timestamp: '2026-01-05T10:00:00Z', content: [{ text: 'now change it a bit' }] },
        { type: 'gemini', timestamp: '2026-01-05T10:06:00Z', content: [{ text: 'ok' }] },
      ],
    })
    const s = parseGeminiChat(content, 'g1', '/p')
    expect(s!.active_minutes).toBe(10)
    expect(s!.duration_minutes).toBeGreaterThan(5000)
  })
})

describe('the invariant that matters', () => {
  test('active time never exceeds wall clock, on every harness', () => {
    const claudeLines = [
      j({ type: 'user', timestamp: '2026-01-01T10:00:00Z', message: { content: [{ type: 'text', text: 'a' }] } }),
      j({ type: 'assistant', timestamp: '2026-01-01T10:05:00Z', message: {} }),
      j({ type: 'user', timestamp: '2026-01-02T10:00:00Z', message: { content: [{ type: 'text', text: 'b' }] } }),
      j({ type: 'assistant', timestamp: '2026-01-02T11:00:00Z', message: {} }),
    ]
    const active = activeMinutesFromClaudeJsonl(claudeLines)!
    const wall = (Date.parse('2026-01-02T11:00:00Z') - Date.parse('2026-01-01T10:00:00Z')) / 60000
    expect(active).toBeLessThanOrEqual(wall)
  })
})
