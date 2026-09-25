import { describe, expect, test } from 'bun:test'
import { CAPABILITY_STATES, HARNESS_ORDER, type HarnessId } from '@agentistics/core'
import { INTEGRATIONS, hasReplay, integrationsInOrder } from './types'

const ABSENT: HarnessId[] = ['codex', 'gemini', 'copilot', 'antigravity', 'kimi']

describe('INTEGRATIONS', () => {
  test('has exactly one entry per harness — the registry cannot drift from HARNESS_ORDER', () => {
    expect(Object.keys(INTEGRATIONS).sort()).toEqual([...HARNESS_ORDER].sort())
  })

  test('every entry names itself by its key, carries a non-empty version and its A1.4 capabilities', () => {
    for (const id of HARNESS_ORDER) {
      const entry = INTEGRATIONS[id]
      expect(entry.id).toBe(id)
      expect(entry.version.trim().length).toBeGreaterThan(0)
      expect(entry.capabilities).toBe(CAPABILITY_STATES[id])
    }
  })

  test('the five not-yet-implemented harnesses are declared absences: no replay, no live, one sentence why', () => {
    for (const id of ABSENT) {
      const entry = INTEGRATIONS[id]
      expect(entry.replay).toBeUndefined()
      expect(entry.live).toBeUndefined()
      expect(hasReplay(entry)).toBe(false)
      expect(entry.replayAbsent?.trim().length ?? 0).toBeGreaterThan(0)
      expect(entry.replayAbsent!.trim().endsWith('.')).toBe(true)
      expect(entry.replayAbsent).not.toContain('\n')
    }
  })

  test('claude is declared, with its replay slot still to be filled by A2.2 and saying so', () => {
    const claude = INTEGRATIONS.claude
    expect(claude.id).toBe('claude')
    expect(hasReplay(claude)).toBe(false)
    expect(claude.replayAbsent).toContain('A2.2')
  })

  test('an entry states EITHER a replay OR the reason it has none — never both, never neither', () => {
    for (const id of HARNESS_ORDER) {
      const e = INTEGRATIONS[id]
      expect(e.replay === undefined).toBe(e.replayAbsent !== undefined)
    }
  })

  test('no absence claims a live source in P1', () => {
    for (const id of HARNESS_ORDER) expect(INTEGRATIONS[id].live).toBeUndefined()
  })
})

describe('integrationsInOrder', () => {
  test('walks HARNESS_ORDER, so a harness added there appears here without a second list', () => {
    expect(integrationsInOrder().map(i => i.id)).toEqual(HARNESS_ORDER)
  })

  test('returns the registry entries themselves, not copies', () => {
    for (const i of integrationsInOrder()) expect(i).toBe(INTEGRATIONS[i.id])
  })
})

describe('hasReplay', () => {
  test('narrows an entry whose replay is present', () => {
    const entry = {
      ...INTEGRATIONS.claude,
      replayAbsent: undefined,
      replay: { discover: async () => [], replay: async () => ({ events: [], cursor: null }) },
    }
    expect(hasReplay(entry)).toBe(true)
  })

  test('a missing replay is a declared absence, never a crash', () => {
    expect(() => hasReplay(INTEGRATIONS.kimi)).not.toThrow()
  })
})
