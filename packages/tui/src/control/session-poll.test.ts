import { describe, expect, test } from 'bun:test'
import { nextSessionPollMs, SESSION_POLL_PRESETS_MS } from './session-poll'

describe('nextSessionPollMs', () => {
  test('steps forward through the presets', () => {
    expect(nextSessionPollMs(1_000)).toBe(2_000)
    expect(nextSessionPollMs(2_000)).toBe(5_000)
    expect(nextSessionPollMs(5_000)).toBe(10_000)
  })

  test('wraps from the last preset back to the first', () => {
    expect(nextSessionPollMs(10_000)).toBe(SESSION_POLL_PRESETS_MS[0])
  })

  test('a value between two presets moves to the next preset above it', () => {
    expect(nextSessionPollMs(3_000)).toBe(5_000)
  })

  test('a value above every preset wraps to the first', () => {
    expect(nextSessionPollMs(30_000)).toBe(SESSION_POLL_PRESETS_MS[0])
  })
})
