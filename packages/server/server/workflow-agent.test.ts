import { test, expect } from 'bun:test'
import { aggregateWorkflowAgent } from './workflow-agent'

const LINES = [
  JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } }),
  JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 200, output_tokens: 80 } } }),
  JSON.stringify({ type: 'user', message: { content: 'hi' } }),
]

test('sums usage across assistant messages and keeps first model', () => {
  const r = aggregateWorkflowAgent(LINES)
  expect(r.model).toBe('claude-sonnet-5')
  expect(r.tokensIn).toBe(300)
  expect(r.tokensOut).toBe(130)
  expect(r.cacheRead).toBe(10)
  expect(r.cacheWrite).toBe(5)
  expect(r.costUSD).toBeGreaterThan(0)
})

test('empty input yields zeros', () => {
  const r = aggregateWorkflowAgent([])
  expect(r).toEqual({ model: '', tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0 })
})
