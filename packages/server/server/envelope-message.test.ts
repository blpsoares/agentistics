import { describe, it, expect } from 'bun:test'
import {
  encodeRestrictionMessage, decodeRestrictionMessage, decidePin, MAX_MESSAGE_SOURCES,
  type RestrictionMessage,
} from './envelope-message'

const MSG: RestrictionMessage = {
  kind: 'restriction',
  instanceId: 'inst-1',
  shareMode: 'denylist',
  sources: [{ type: 'repo', value: 'github.com/acme/api' }, { type: 'none', value: '' }],
  at: '2026-07-31T10:00:00.000Z',
}

describe('restriction message', () => {
  it('round-trips', () => {
    expect(decodeRestrictionMessage(encodeRestrictionMessage(MSG))).toEqual(MSG)
  })

  it('rejects a payload rather than partially accepting it', () => {
    for (const junk of [
      '', 'not json', '[]', 'null', '42',
      JSON.stringify({ ...MSG, kind: 'something-else' }),
      JSON.stringify({ ...MSG, instanceId: '' }),
      JSON.stringify({ ...MSG, shareMode: 'whatever' }),
      JSON.stringify({ ...MSG, at: '' }),
      JSON.stringify({ ...MSG, sources: 'nope' }),
      // ONE bad entry rejects the WHOLE list — a rules proposal half-applied is a fail-open.
      JSON.stringify({ ...MSG, sources: [{ type: 'repo', value: 'ok' }, { type: 'bogus', value: 'x' }] }),
      JSON.stringify({ ...MSG, sources: [{ type: 'repo', value: 7 }] }),
    ]) {
      expect(decodeRestrictionMessage(junk)).toBeNull()
    }
  })

  it('rejects an oversized source list', () => {
    const sources = Array.from({ length: MAX_MESSAGE_SOURCES + 1 }, (_, i) => ({ type: 'repo' as const, value: `r${i}` }))
    expect(decodeRestrictionMessage(JSON.stringify({ ...MSG, sources }))).toBeNull()
  })
})

describe('decidePin', () => {
  it('pins on first sight', () => {
    expect(decidePin(null, 'k1')).toBe('new')
    expect(decidePin(undefined, 'k1')).toBe('new')
    expect(decidePin('', 'k1')).toBe('new')
  })

  it('accepts an unchanged key', () => {
    expect(decidePin('k1', 'k1')).toBe('same')
  })

  it('refuses a changed key — a reinstall and an attack are indistinguishable from here', () => {
    expect(decidePin('k1', 'k2')).toBe('changed')
  })
})
