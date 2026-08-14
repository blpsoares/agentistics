import { describe, expect, it } from 'bun:test'
import { contextOfUsage, contextTokensFromClaudeJsonl } from './jsonl'

/** One assistant line carrying a usage record. */
const turn = (u: Record<string, number>) =>
  JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: u } })

describe('contextOfUsage', () => {
  it('sums the INPUT side only', () => {
    // The prompt that was sent. `output_tokens` came back and is not in the window when the turn
    // is issued — including it would inflate every reading by the length of the reply.
    expect(contextOfUsage({
      input_tokens: 2,
      cache_creation_input_tokens: 693,
      cache_read_input_tokens: 454_714,
      output_tokens: 327,
    })).toBe(455_409)
  })

  it('is 0 for a missing or empty record', () => {
    expect(contextOfUsage(undefined)).toBe(0)
    expect(contextOfUsage({})).toBe(0)
    expect(contextOfUsage({ output_tokens: 500 })).toBe(0)
  })
})

describe('contextTokensFromClaudeJsonl', () => {
  it('takes the LAST reading, never the sum', () => {
    // The distinction the whole field exists for. Measured on a real session: cumulative input
    // 44.3M against a context of 455k — a gauge built from the totals reads ~4400% of the window.
    const lines = [
      turn({ input_tokens: 5, cache_read_input_tokens: 100_000 }),
      turn({ input_tokens: 5, cache_read_input_tokens: 200_000 }),
      turn({ input_tokens: 2, cache_creation_input_tokens: 693, cache_read_input_tokens: 454_714 }),
    ]
    expect(contextTokensFromClaudeJsonl(lines)).toBe(455_409)
  })

  it('keeps the last REAL reading past a trailing all-zero record', () => {
    // A synthetic final record would otherwise reset a full window to "empty" on the last turn —
    // the reassuring direction, and the one nobody would question.
    const lines = [
      turn({ input_tokens: 2, cache_read_input_tokens: 300_000 }),
      turn({ output_tokens: 12 }),
    ]
    expect(contextTokensFromClaudeJsonl(lines)).toBe(300_002)
  })

  it('ignores non-assistant lines and unparseable ones', () => {
    const lines = [
      '',
      'not json at all',
      JSON.stringify({ type: 'user', message: { usage: { input_tokens: 999_999 } } }),
      turn({ input_tokens: 7, cache_read_input_tokens: 1_000 }),
    ]
    expect(contextTokensFromClaudeJsonl(lines)).toBe(1_007)
  })

  it('is undefined when nothing was measured — never 0', () => {
    // Absent and empty are different claims. `0` would render as a confident "this window is
    // empty" on a session that simply never reported one.
    expect(contextTokensFromClaudeJsonl([])).toBeUndefined()
    expect(contextTokensFromClaudeJsonl(['{"type":"user"}'])).toBeUndefined()
    expect(contextTokensFromClaudeJsonl([turn({ output_tokens: 5 })])).toBeUndefined()
  })
})
