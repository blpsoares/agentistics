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
  expect(r).toEqual({ model: '', tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, prompt: '', startedAt: '' })
})

test('captures the first user message as the prompt — it is what identifies the agent', () => {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-08-04T14:55:52.619Z', message: { content: 'TAREFA: mapeie a camada de mouse' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 2 } } }),
    JSON.stringify({ type: 'user', message: { content: 'segunda mensagem, nao e o prompt' } }),
  ]
  const r = aggregateWorkflowAgent(lines)
  expect(r.prompt).toBe('TAREFA: mapeie a camada de mouse')
  expect(r.startedAt).toBe('2026-08-04T14:55:52.619Z')
})

test('a block-array user message is flattened into the prompt text', () => {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: 't0', message: { content: [{ type: 'text', text: 'parte A' }, { type: 'text', text: 'parte B' }] } }),
  ]
  expect(aggregateWorkflowAgent(lines).prompt).toBe('parte A\nparte B')
})

test('a tool_result echoed back as a user message never becomes the prompt', () => {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: 't0', message: { content: [{ type: 'tool_result', content: 'saida do bash' }] } }),
    JSON.stringify({ type: 'user', timestamp: 't1', message: { content: 'o prompt de verdade' } }),
  ]
  expect(aggregateWorkflowAgent(lines).prompt).toBe('o prompt de verdade')
})
