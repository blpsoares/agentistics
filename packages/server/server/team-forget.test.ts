import { describe, it, expect } from 'bun:test'
import { parseForgetBody, MAX_FORGET_IDS } from './team-forget'

describe('parseForgetBody', () => {
  it('accepts a list of string ids', () => {
    expect(parseForgetBody({ sessionIds: ['a', 'b'] })).toEqual({ ok: true, sessionIds: ['a', 'b'] })
  })

  it('rejects a non-object, a missing array and a non-array', () => {
    for (const raw of [null, 'x', 42, {}, { sessionIds: 'a' }]) {
      expect(parseForgetBody(raw).ok).toBe(false)
    }
  })

  // A malformed body is 400, NEVER a partial delete: dropping the junk and deleting the rest
  // would make the member's journal believe a batch was acked that was only half applied.
  it('rejects a list containing a non-string or an empty string', () => {
    expect(parseForgetBody({ sessionIds: ['a', 7] }).ok).toBe(false)
    expect(parseForgetBody({ sessionIds: ['a', ''] }).ok).toBe(false)
  })

  it('rejects more than MAX_FORGET_IDS ids', () => {
    const ids = Array.from({ length: MAX_FORGET_IDS + 1 }, (_, i) => `s${i}`)
    expect(parseForgetBody({ sessionIds: ids }).ok).toBe(false)
    expect(parseForgetBody({ sessionIds: ids.slice(0, MAX_FORGET_IDS) }).ok).toBe(true)
  })

  it('accepts an empty list as a no-op', () => {
    expect(parseForgetBody({ sessionIds: [] })).toEqual({ ok: true, sessionIds: [] })
  })

  it('de-duplicates ids', () => {
    expect(parseForgetBody({ sessionIds: ['a', 'a', 'b'] })).toEqual({ ok: true, sessionIds: ['a', 'b'] })
  })
})
