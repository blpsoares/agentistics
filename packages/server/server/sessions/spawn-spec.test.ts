import { describe, expect, it } from 'bun:test'
import { HARNESS_ORDER } from '@agentistics/core'
import { SPAWN_SPECS, planSpawn } from './spawn-spec'

describe('SPAWN_SPECS', () => {
  it('has an entry for every harness', () => {
    for (const id of HARNESS_ORDER) {
      expect(SPAWN_SPECS).toHaveProperty(id)
    }
  })

  it('gives every spawnable harness a way to receive an initial prompt', () => {
    for (const id of HARNESS_ORDER) {
      const spec = SPAWN_SPECS[id]
      if (!spec) continue
      expect(spec.prompt.kind).toBeDefined()
      expect(spec.bin.length).toBeGreaterThan(0)
    }
  })

  it('never declares an effort flag without the enum that validates it', () => {
    // The two go together or neither is trustworthy: a flag with no accepted list would pass any
    // string through to a CLI that rejects it, which fails after the session has already started.
    for (const id of HARNESS_ORDER) {
      const spec = SPAWN_SPECS[id]
      if (!spec) continue
      expect(Boolean(spec.effortFlag)).toBe(Boolean(spec.efforts?.length))
    }
  })
})

describe('planSpawn', () => {
  it('puts a claude prompt in the positional slot, after the flags', () => {
    const r = planSpawn({ harness: 'claude', cwd: '/tmp', prompt: 'fix the tests', model: 'opus', effort: 'high' })
    expect(r).toEqual({ ok: true, plan: { argv: ['claude', '--model', 'opus', '--effort', 'high', 'fix the tests'] } })
  })

  it('puts a codex prompt in the positional slot', () => {
    const r = planSpawn({ harness: 'codex', cwd: '/tmp', prompt: 'implement X', model: 'o3' })
    expect(r).toEqual({ ok: true, plan: { argv: ['codex', '--model', 'o3', 'implement X'] } })
  })

  it('types a kimi prompt in, because kimi has no interactive prompt flag', () => {
    const r = planSpawn({ harness: 'kimi', cwd: '/tmp', prompt: 'implement X' })
    expect(r).toEqual({ ok: true, plan: { argv: ['kimi'], sendKeys: 'implement X' } })
  })

  it('omits the prompt entirely when there is none', () => {
    const r = planSpawn({ harness: 'claude', cwd: '/tmp' })
    expect(r).toEqual({ ok: true, plan: { argv: ['claude'] } })
  })

  it('refuses an effort value the harness does not accept, naming the ones it does', () => {
    const r = planSpawn({ harness: 'claude', cwd: '/tmp', effort: 'ultra' })
    expect(r).toEqual({
      ok: false,
      error: { code: 'unknown-effort', harness: 'claude', value: 'ultra', accepted: ['low', 'medium', 'high', 'xhigh', 'max'] },
    })
  })

  it('refuses effort for a harness that has none rather than inventing a flag', () => {
    const r = planSpawn({ harness: 'kimi', cwd: '/tmp', effort: 'high' })
    expect(r).toEqual({ ok: false, error: { code: 'effort-unsupported', harness: 'kimi' } })
  })

  it('passes a gemini prompt through the flag that stays interactive', () => {
    // `--prompt-interactive` rather than the positional `query`: both stay interactive today, but
    // only one says so in its own name, and a positional that silently goes headless is a trap.
    const r = planSpawn({ harness: 'gemini', cwd: '/tmp', prompt: 'find the leak' })
    expect(r).toEqual({ ok: true, plan: { argv: ['gemini', '--prompt-interactive', 'find the leak'] } })
  })

  it('types a copilot prompt in, because its -p exits after answering', () => {
    const r = planSpawn({ harness: 'copilot', cwd: '/tmp', prompt: 'review this' })
    expect(r).toEqual({ ok: true, plan: { argv: ['copilot'], sendKeys: 'review this' } })
  })

  it('accepts agy effort, which its own --help prints as a closed set', () => {
    const r = planSpawn({ harness: 'antigravity', cwd: '/tmp', effort: 'high' })
    expect(r).toEqual({ ok: true, plan: { argv: ['agy', '--effort', 'high'] } })
  })

  it('refuses an agy effort outside that set', () => {
    const r = planSpawn({ harness: 'antigravity', cwd: '/tmp', effort: 'xhigh' })
    expect(r).toEqual({
      ok: false,
      error: { code: 'unknown-effort', harness: 'antigravity', value: 'xhigh', accepted: ['low', 'medium', 'high'] },
    })
  })

  it('refuses effort for gemini, which has no such flag', () => {
    const r = planSpawn({ harness: 'gemini', cwd: '/tmp', effort: 'high' })
    expect(r).toEqual({ ok: false, error: { code: 'effort-unsupported', harness: 'gemini' } })
  })

  it('does NOT validate the model against a closed list', () => {
    const r = planSpawn({ harness: 'claude', cwd: '/tmp', model: 'claude-opus-5-some-future-name' })
    expect(r).toEqual({ ok: true, plan: { argv: ['claude', '--model', 'claude-opus-5-some-future-name'] } })
  })
})
