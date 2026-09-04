import { describe, expect, it } from 'bun:test'
import { HARNESS_MODELS, modelLabel, modelsFor } from './harnessModels'
import { SPAWN_SPECS_MODEL_IDS } from './harnessModels'

describe('HARNESS_MODELS', () => {
  it('gives claude the four aliases its CLI accepts, with the names it prints', () => {
    expect(modelsFor('claude').map(m => m.id)).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
    expect(modelLabel('claude', 'opus')).toBe('Opus 5')
    expect(modelLabel('claude', 'haiku')).toBe('Haiku 4.5')
  })

  it('carries provenance on every entry — a pair with no source may not exist', () => {
    for (const [harness, options] of Object.entries(HARNESS_MODELS)) {
      for (const o of options) {
        expect(o.id, `${harness} id`).not.toBe('')
        expect(o.label, `${harness} label`).not.toBe('')
        expect(o.verifiedAt, `${harness}/${o.id} verifiedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(o.source, `${harness}/${o.id} source`).not.toBe('')
      }
    }
  })

  it('names every harness, so adding one breaks the build here', () => {
    for (const h of ['claude', 'codex', 'gemini', 'copilot', 'antigravity', 'kimi']) {
      expect(HARNESS_MODELS[h as keyof typeof HARNESS_MODELS]).toBeDefined()
    }
  })

  it('has no entry for a harness whose CLI publishes no list', () => {
    // Measured 2026-09-02 and recorded in spawn-spec.ts: codex and gemini name nothing.
    expect(modelsFor('codex')).toEqual([])
    expect(modelsFor('gemini')).toEqual([])
  })

  it('falls back to the id when a label is unknown, never to an invented name', () => {
    expect(modelLabel('claude', 'claude-opus-5-20260101')).toBe('claude-opus-5-20260101')
    expect(modelLabel('nope', 'x')).toBe('x')
  })

  it('exports exactly the ids the spawn specs accept, so one list feeds both surfaces', () => {
    expect(SPAWN_SPECS_MODEL_IDS.claude).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
  })
})
