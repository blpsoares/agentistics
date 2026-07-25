import { test, expect } from 'bun:test'
import { aggregateSessions } from './tags-aggregate'
import type { SessionMeta } from '@agentistics/core'

function s(over: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: 'x', project_path: '/p', harness: 'claude',
    input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    ...over,
  } as SessionMeta
}

test('empty input yields zeroes and null tops', () => {
  expect(aggregateSessions([])).toEqual({
    sessions: 0, costUSD: 0, inputTokens: 0, outputTokens: 0,
    topProject: null, topModel: null, topHarness: null,
  })
})

test('sums tokens and counts sessions', () => {
  const out = aggregateSessions([
    s({ input_tokens: 100, output_tokens: 10 }),
    s({ input_tokens: 50, output_tokens: 5 }),
  ])
  expect(out.sessions).toBe(2)
  expect(out.inputTokens).toBe(150)
  expect(out.outputTokens).toBe(15)
  expect(out.costUSD).toBeGreaterThan(0)
})

test('top project/model/harness are the most frequent values', () => {
  const out = aggregateSessions([
    s({ project_path: '/a', model: 'claude-opus-4-6', harness: 'claude' }),
    s({ project_path: '/a', model: 'claude-sonnet-4-6', harness: 'claude' }),
    s({ project_path: '/b', model: 'claude-opus-4-6', harness: 'codex' }),
    s({ project_path: '/a', model: 'claude-opus-4-6', harness: 'claude' }),
  ])
  expect(out.topProject).toBe('/a')
  expect(out.topModel).toBe('claude-opus-4-6')
  expect(out.topHarness).toBe('claude')
})

test('sessions with no model do not produce a phantom top model', () => {
  const out = aggregateSessions([s({}), s({})])
  expect(out.topModel).toBeNull()
})
