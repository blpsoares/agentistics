import { test, expect } from 'bun:test'
import { resolveProvider, providerOrder, PROVIDERS } from './providers'

test('real model ids from every harness resolve to the company that bills them', () => {
  expect(resolveProvider('claude-opus-5').id).toBe('anthropic')
  expect(resolveProvider('claude-opus-4-6-thinking').id).toBe('anthropic')
  expect(resolveProvider('gpt-5.6-terra').id).toBe('openai')
  expect(resolveProvider('gpt-5-mini').id).toBe('openai')
  expect(resolveProvider('gemini-3.6-flash-tiered').id).toBe('google')
  expect(resolveProvider('gemini-3.5-flash-lite').id).toBe('google')
  expect(resolveProvider('kimi-k2.6').id).toBe('moonshot')
  expect(resolveProvider('moonshot/kimi-k2-turbo-preview').id).toBe('moonshot')
})

test('a provider is a billing entity, not a harness', () => {
  // Codex and Copilot both report OpenAI ids; Antigravity reports Google AND Anthropic ones.
  // Grouping by harness would file the same model under several headings.
  expect(resolveProvider('gpt-5-mini').id).toBe(resolveProvider('gpt-5.6-terra').id)
  expect(resolveProvider('claude-opus-4-6-thinking').id).not.toBe(resolveProvider('gemini-3.6-flash').id)
})

test('an unknown id groups under Other instead of throwing', () => {
  expect(resolveProvider('llama-4-70b').id).toBe('other')
  expect(resolveProvider('').id).toBe('other')
})

test('the longest matching prefix wins', () => {
  // `moonshot` and `kimi-` both exist; a prefixed id must not be decided by list order.
  expect(resolveProvider('moonshot/kimi-k2.5').id).toBe('moonshot')
})

test('matching is case-insensitive', () => {
  expect(resolveProvider('Claude-Opus-5').id).toBe('anthropic')
  expect(resolveProvider('GPT-5.5').id).toBe('openai')
})

test('Other is always last so unknowns never lead the table', () => {
  const order = providerOrder()
  expect(order[order.length - 1]!.id).toBe('other')
  expect(order.length).toBe(PROVIDERS.length + 1)
})

test('every provider that bills money cites its own pricing page', () => {
  for (const p of PROVIDERS) expect(p.pricingUrl).toMatch(/^https:\/\//)
})
