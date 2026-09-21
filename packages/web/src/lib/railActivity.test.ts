import { describe, expect, test } from 'bun:test'
import { railActivityFromHint } from './railActivity'
import type { EdgeHint } from './artifactLayout'

function hint(kind: EdgeHint['kind']): EdgeHint {
  return { kind, text: 'x' }
}

describe('railActivityFromHint', () => {
  test('no hint — nothing lights', () => {
    expect(railActivityFromHint(null)).toEqual(new Set())
    expect(railActivityFromHint(undefined)).toEqual(new Set())
  })

  test('any hint lights Live', () => {
    for (const kind of ['wrote', 'read', 'ran', 'thought', 'used'] as const) {
      expect(railActivityFromHint(hint(kind)).has('live')).toBe(true)
    }
  })

  test('only "delegated" ALSO lights Agents — every other kind leaves it dark', () => {
    for (const kind of ['wrote', 'read', 'ran', 'thought', 'used'] as const) {
      expect(railActivityFromHint(hint(kind)).has('agents')).toBe(false)
    }
    expect(railActivityFromHint(hint('delegated')).has('agents')).toBe(true)
  })

  test('"delegated" lights BOTH — it is a live hint too, not agents-only', () => {
    const active = railActivityFromHint(hint('delegated'))
    expect(active.has('live')).toBe(true)
    expect(active.has('agents')).toBe(true)
    expect(active.size).toBe(2)
  })

  test('a plain hint lights exactly one panel, never a stray extra', () => {
    expect(railActivityFromHint(hint('wrote')).size).toBe(1)
  })

  // PLANTED-REVERT: a version that lights `agents` for EVERY hint (not just "delegated") would
  // claim subagent activity that never happened — the exact overclaim this function exists to
  // refuse (spec's own "never a timer" rule extends to "never a guess" here too).
  test('[planted-revert coverage] lighting agents unconditionally overclaims subagent activity', () => {
    function brokenActivity(h: EdgeHint | null | undefined): ReadonlySet<PanelId2> {
      if (!h) return new Set()
      return new Set(['live', 'agents']) // wrong: agents lights for EVERY hint
    }
    type PanelId2 = 'live' | 'agents' | string
    const broken = brokenActivity(hint('wrote'))
    const correct = railActivityFromHint(hint('wrote'))
    expect(broken.has('agents')).toBe(true)
    expect(correct.has('agents')).toBe(false)
  })
})
