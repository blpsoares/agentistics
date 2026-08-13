import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HARNESS_ORDER } from '@agentistics/core'
import { ATTENTION_RULES, classifyAttention, needsAttention } from './attention'

/**
 * The fixtures ARE the test data: every one of them is a real frame captured with the same
 * `tmux capture-pane -p -t <session> -S -40` the backend runs. Inlining them here would let the
 * committed evidence and the assertions drift apart, which is the one thing this module cannot
 * afford — a pattern is only as good as the frame it was read from.
 */
const frame = (name: string): string[] =>
  readFileSync(join(import.meta.dir, 'fixtures', `${name}.txt`), 'utf-8').split('\n')

const QUIET_NOW = 100_000
const quiet = { nowMs: QUIET_NOW, lastActivityMs: QUIET_NOW - 30_000 }
const busy = { nowMs: QUIET_NOW, lastActivityMs: QUIET_NOW - 500 }

describe('ATTENTION_RULES', () => {
  it('has an entry for every harness', () => {
    for (const id of HARNESS_ORDER) expect(ATTENTION_RULES).toHaveProperty(id)
  })

  it('is null for every harness whose frames were never captured', () => {
    // Honest gaps, not guesses. `kimi` is here despite having an idle fixture: its only configured
    // provider is an Ollama that is not running on the capture machine, so no approval frame could
    // be produced, and a rule set that can only recognise "waiting for input" would name an
    // approval prompt as an idle one.
    expect(ATTENTION_RULES.kimi).toBeNull()
    expect(ATTENTION_RULES.gemini).toBeNull()
    expect(ATTENTION_RULES.copilot).toBeNull()
    expect(ATTENTION_RULES.antigravity).toBeNull()
  })
})

/**
 * A rule that quietly stops matching is invisible while a sibling rule in the same array still
 * fires — the pair would keep the classifier green and halve its evidence. So each rule is held to
 * the fixture it was read from, individually.
 */
describe('every rule still matches the fixture it was read from', () => {
  const hits = (rule: RegExp, names: string[]): number =>
    names.flatMap(frame).filter(l => rule.test(l)).length

  const cases: Array<[string, RegExp[], string[]]> = [
    ['claude approval', ATTENTION_RULES.claude!.approval, ['claude-approval-tool', 'claude-approval-trust']],
    ['claude input', ATTENTION_RULES.claude!.input, ['claude-idle']],
    ['codex approval', ATTENTION_RULES.codex!.approval, ['codex-approval-tool', 'codex-approval-trust']],
    ['codex input', ATTENTION_RULES.codex!.input, ['codex-idle']],
  ]

  for (const [label, rules, fixtures] of cases) {
    rules.forEach((rule, i) => {
      it(`${label} rule ${i} — ${rule.source}`, () => {
        expect(hits(rule, fixtures)).toBeGreaterThan(0)
      })
    })
  }
})

describe('classifyAttention', () => {
  it('calls a session that wrote bytes just now working, without consulting any pattern', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...busy,
      capture: { ok: true, lines: frame('claude-idle') },
    })).toBe('working')
  })

  it('recognises a claude tool-permission prompt', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...quiet,
      capture: { ok: true, lines: frame('claude-approval-tool') },
    })).toBe('waiting-approval')
  })

  it('recognises a claude workspace-trust prompt', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...quiet,
      capture: { ok: true, lines: frame('claude-approval-trust') },
    })).toBe('waiting-approval')
  })

  it('recognises a claude idle prompt', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...quiet,
      capture: { ok: true, lines: frame('claude-idle') },
    })).toBe('waiting-input')
  })

  it('recognises a codex approval prompt for a command outside the sandbox', () => {
    expect(classifyAttention({
      harness: 'codex', alive: true, ...quiet,
      capture: { ok: true, lines: frame('codex-approval-tool') },
    })).toBe('waiting-approval')
  })

  it('recognises a codex directory-trust prompt', () => {
    expect(classifyAttention({
      harness: 'codex', alive: true, ...quiet,
      capture: { ok: true, lines: frame('codex-approval-trust') },
    })).toBe('waiting-approval')
  })

  it('does not read an answered dialog left in the scrollback as a live one', () => {
    // codex-idle.txt is an ORDINARY idle frame: the trust dialog it opened with is still in the
    // captured scrollback, above the composer that was drawn after it was answered. Matching
    // anywhere in the frame calls this session `waiting-approval` forever.
    const lines = frame('codex-idle')
    expect(lines.some(l => l.includes('Do you trust the contents of this directory?'))).toBe(true)
    expect(classifyAttention({
      harness: 'codex', alive: true, ...quiet,
      capture: { ok: true, lines },
    })).toBe('waiting-input')
  })

  it('says idle-unknown for a quiet frame no rule matched, rather than guessing', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...quiet,
      capture: { ok: true, lines: ['some frame nobody has a rule for'] },
    })).toBe('idle-unknown')
  })

  it('says idle-unknown for a harness with no rules at all', () => {
    expect(classifyAttention({
      harness: 'gemini', alive: true, ...quiet,
      capture: { ok: true, lines: frame('claude-approval-tool') },
    })).toBe('idle-unknown')
  })

  it('says idle-unknown for a kimi frame it can read but has no evidence for', () => {
    expect(classifyAttention({
      harness: 'kimi', alive: true, ...quiet,
      capture: { ok: true, lines: frame('kimi-idle') },
    })).toBe('idle-unknown')
  })

  it('reports a dead pane as exited regardless of what the frame says', () => {
    expect(classifyAttention({
      harness: 'claude', alive: false, ...quiet,
      capture: { ok: true, lines: frame('claude-approval-tool') },
    })).toBe('exited')
  })

  it('never reports a failed capture as a state it did not observe', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...quiet,
      capture: { ok: false, reason: 'backend-error' },
    })).toBe('unreadable')
  })

  it('does not let a working session hide a failed capture either', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...busy,
      capture: { ok: false, reason: 'backend-error' },
    })).toBe('working')
  })
})

describe('needsAttention', () => {
  it('is true exactly for the two states that are waiting on a person', () => {
    expect(needsAttention('waiting-approval')).toBe(true)
    expect(needsAttention('waiting-input')).toBe(true)
    for (const s of ['working', 'idle-unknown', 'unreadable', 'exited', 'external'] as const) {
      expect(needsAttention(s)).toBe(false)
    }
  })
})
