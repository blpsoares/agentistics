import { test, expect } from 'bun:test'
import {
  normalizeCommunityEntry, normalizeCommunityDataset, mergePricingLayers,
} from './pricing-community'
import { MODEL_PRICING } from '@agentistics/core'

const usd = (perMillion: number): number => perMillion / 1e6

test('a valid row converts from per-token to per-1M', () => {
  const p = normalizeCommunityEntry('gpt-5.6-terra', {
    input_cost_per_token: usd(2.5),
    output_cost_per_token: usd(15),
    cache_read_input_token_cost: usd(0.25),
  })!
  expect(p.input).toBe(2.5)
  expect(p.output).toBe(15)
  expect(p.cacheRead).toBe(0.25)
})

test('a zero price is refused — the real defect this guards against', () => {
  // `kimi-k2-thinking-251104` really is published at zero. Importing it would make those sessions
  // free, silently and with no N/A to hint at it.
  expect(normalizeCommunityEntry('kimi-k2-thinking-251104', {
    input_cost_per_token: 0, output_cost_per_token: 0,
  })).toBeNull()
})

test('missing, negative and non-numeric costs are refused', () => {
  expect(normalizeCommunityEntry('x', {})).toBeNull()
  expect(normalizeCommunityEntry('x', { input_cost_per_token: usd(1) })).toBeNull()
  expect(normalizeCommunityEntry('x', { input_cost_per_token: usd(-1), output_cost_per_token: usd(2) })).toBeNull()
  expect(normalizeCommunityEntry('x', { input_cost_per_token: 'free' as unknown, output_cost_per_token: usd(2) })).toBeNull()
  expect(normalizeCommunityEntry('x', { input_cost_per_token: NaN, output_cost_per_token: usd(2) })).toBeNull()
})

test('a value implying the units changed is refused', () => {
  // Per-1M costs rather than per-token: every figure comes out a million times too large.
  expect(normalizeCommunityEntry('x', { input_cost_per_token: 5, output_cost_per_token: 25 })).toBeNull()
})

test('a price that drifted implausibly from the built-in one is refused', () => {
  // Opus is 5/25 in the built-in table. A hundredfold jump is a bad row, not a price change.
  expect(normalizeCommunityEntry('claude-opus-5', {
    input_cost_per_token: usd(500), output_cost_per_token: usd(2500),
  })).toBeNull()
  // ...and a plausible change IS accepted, so a real price move still lands.
  const moved = normalizeCommunityEntry('claude-opus-5', {
    input_cost_per_token: usd(6), output_cost_per_token: usd(30),
  })!
  expect(moved.input).toBe(6)
  expect(MODEL_PRICING['claude-opus-5']!.input).toBe(5) // the built-in table is untouched
})

test('cache costs fall back to the vendor conventions when absent', () => {
  const p = normalizeCommunityEntry('x', {
    input_cost_per_token: usd(10), output_cost_per_token: usd(50),
  })!
  expect(p.cacheRead).toBe(1)  // a tenth of input, the standard cache-hit rate
  expect(p.cacheWrite).toBe(10) // no separate write charge → the input rate
})

test('non-chat models are skipped', () => {
  expect(normalizeCommunityEntry('text-embedding-3', {
    input_cost_per_token: usd(0.02), output_cost_per_token: usd(0.02), mode: 'embedding',
  })).toBeNull()
})

test('a provider prefix is also registered bare, and a direct id wins', () => {
  const out = normalizeCommunityDataset({
    'moonshot/kimi-k2.6': { input_cost_per_token: usd(0.95), output_cost_per_token: usd(4) },
    'azure/gpt-5.5': { input_cost_per_token: usd(99), output_cost_per_token: usd(99) },
    'gpt-5.5': { input_cost_per_token: usd(5), output_cost_per_token: usd(30) },
  })
  // The harnesses report `kimi-k2.6`, not the prefixed form.
  expect(out['kimi-k2.6']!.input).toBe(0.95)
  expect(out['moonshot/kimi-k2.6']).toBeUndefined()
  // The unprefixed statement beats the reseller's.
  expect(out['gpt-5.5']!.input).toBe(5)
})

test('a dataset of junk yields nothing rather than garbage', () => {
  expect(Object.keys(normalizeCommunityDataset({
    a: null as unknown as Record<string, never>,
    b: { input_cost_per_token: 0, output_cost_per_token: 0 },
  })).length).toBe(0)
})

test('layers stack by trust: builtin floor, community fills, official wins', () => {
  const merged = mergePricingLayers({
    builtin: {
      'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      'only-builtin': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
    },
    community: {
      'claude-opus-5': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      'kimi-k2.6': { input: 0.95, output: 4, cacheRead: 0.095, cacheWrite: 0.95 },
    },
    official: {
      'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    },
  })
  expect(merged['claude-opus-5']).toEqual({
    price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, origin: 'official',
  })
  expect(merged['kimi-k2.6']!.origin).toBe('community')
  // A model no live source mentions keeps its built-in price rather than disappearing.
  expect(merged['only-builtin']!.origin).toBe('builtin')
})

test('a failed live source cannot erase what we already had', () => {
  const builtin = { 'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } }
  const merged = mergePricingLayers({ builtin, community: null, official: null })
  expect(merged['claude-opus-5']!.price.input).toBe(5)
  expect(merged['claude-opus-5']!.origin).toBe('builtin')
})
