import { describe, expect, it } from 'bun:test'
import { HARNESS_ORDER } from '@agentistics/core'
import { SPAWN_SPECS, conversationLinkable, planSpawn } from './spawn-spec'

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
  it('puts a claude prompt in the positional slot, after the flags, and marks it for submit', () => {
    // Positional, so the text is in argv — but the backend must still SUBMIT it (an Enter) on a
    // version that pre-fills without auto-submitting, without double-submitting one that does.
    const r = planSpawn({ harness: 'claude', cwd: '/tmp', prompt: 'fix the tests', model: 'opus', effort: 'high' })
    expect(r).toEqual({
      ok: true,
      plan: { argv: ['claude', '--model', 'opus', '--effort', 'high', 'fix the tests'], initialPrompt: { mode: 'submit' } },
    })
  })

  it('puts a codex prompt in the positional slot and marks it for submit', () => {
    const r = planSpawn({ harness: 'codex', cwd: '/tmp', prompt: 'implement X', model: 'o3' })
    expect(r).toEqual({
      ok: true,
      plan: { argv: ['codex', '--model', 'o3', 'implement X'], initialPrompt: { mode: 'submit' } },
    })
  })

  it('types a kimi prompt in, because kimi has no interactive prompt flag', () => {
    const r = planSpawn({ harness: 'kimi', cwd: '/tmp', prompt: 'implement X' })
    expect(r).toEqual({ ok: true, plan: { argv: ['kimi'], initialPrompt: { mode: 'type', text: 'implement X' } } })
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
    expect(r).toEqual({ ok: true, plan: { argv: ['copilot'], initialPrompt: { mode: 'type', text: 'review this' } } })
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

describe('assigning the conversation id at spawn', () => {
  it('names the conversation for a harness whose CLI accepts one', () => {
    // claude: `--session-id <uuid>  Use a specific session ID for the conversation`. Verified on
    // 2026-08-14 to produce `~/.claude/projects/<enc>/<uuid>.jsonl` — the same id the adapter reads
    // back, which is what makes recording it worth anything.
    const r = planSpawn({ harness: 'claude', cwd: '/r', conversationId: 'u-1' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.argv).toEqual(['claude', '--session-id', 'u-1'])
    expect(r.plan.conversationId).toBe('u-1')
  })

  it('does the same for copilot, whose single flag both sets and resumes', () => {
    const r = planSpawn({ harness: 'copilot', cwd: '/r', conversationId: 'u-2' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.argv).toEqual(['copilot', '--session-id', 'u-2'])
    expect(r.plan.conversationId).toBe('u-2')
  })

  it('records NOTHING for a harness that invents its own id and never reports it', () => {
    // codex, kimi, gemini and antigravity. An id recorded here would be one nothing in the store
    // resolves to, which is worse than none: it LOOKS like an exact link. The UI says so instead —
    // see `conversationLinkable`.
    for (const harness of ['codex', 'kimi', 'gemini', 'antigravity'] as const) {
      const r = planSpawn({ harness, cwd: '/r', conversationId: 'u-3' })
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.plan.argv).not.toContain('u-3')
      expect(r.plan.conversationId).toBeUndefined()
    }
  })

  it('never assigns an id beside a resume — that conversation already has one', () => {
    const r = planSpawn({ harness: 'claude', cwd: '/r', resumeId: 'old', conversationId: 'new' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.argv).toEqual(['claude', '--resume', 'old'])
    // The conversation this spawn drives is the one it was told to reopen.
    expect(r.plan.conversationId).toBe('old')
  })

  it('leaves the argv untouched when no id is offered', () => {
    const r = planSpawn({ harness: 'claude', cwd: '/r' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.argv).toEqual(['claude'])
    expect(r.plan.conversationId).toBeUndefined()
  })
})

describe('conversationLinkable', () => {
  it('is true exactly where an EXACT link can exist', () => {
    // claude on both counts (`--session-id`, and `~/.claude/sessions/<pid>.json` carrying the tmux
    // session we started it under); copilot on the flag alone.
    expect(conversationLinkable('claude')).toBe(true)
    expect(conversationLinkable('copilot')).toBe(true)
  })

  it('is false where every answer would be a harness-and-directory guess', () => {
    // The guess gives every session of one repository the same conversation — the bug that reopened
    // three rows onto one conversation. It is fine to OFFER, and this flag is what stops it being
    // presented as the conversation the row is in.
    for (const harness of ['codex', 'kimi', 'gemini', 'antigravity'] as const) {
      expect(conversationLinkable(harness)).toBe(false)
    }
  })
})
