import { describe, it, expect } from 'bun:test'
import { CENTRAL_CAPABILITIES, parseCapabilities, centralCanForget } from './team-capabilities'

describe('capabilities', () => {
  it('advertises forget.sessions', () => {
    expect(CENTRAL_CAPABILITIES).toContain('forget.sessions')
  })

  // An older central has no `capabilities` field at all. That is not "no capabilities available"
  // as a guess — it is exactly the state that must produce canForget=false and a DISABLED editor,
  // never a fallback to the destructive full purge (§7).
  it('reads a missing, wrong-typed or junk field as no capabilities', () => {
    for (const raw of [undefined, null, 'forget.sessions', 42, { a: 1 }, [1, 2]]) {
      expect(parseCapabilities(raw)).toEqual([])
    }
  })

  it('keeps only string entries', () => {
    expect(parseCapabilities(['leave', 7, 'forget.sessions'])).toEqual(['leave', 'forget.sessions'])
  })

  it('centralCanForget is true only when forget.sessions is present', () => {
    expect(centralCanForget(['leave', 'forget.sessions'])).toBe(true)
    expect(centralCanForget(['leave', 'leave.workflows'])).toBe(false)
    expect(centralCanForget([])).toBe(false)
  })
})
