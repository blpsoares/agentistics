import { describe, expect, it } from 'bun:test'
import { HARNESS_ORDER } from '@agentistics/core'
import { ATTENTION_RULES, rulesFor } from './attention-rules'
import { attentionOf } from './attention'

const NOW = 1_786_600_000_000

/** Quiet and unmoving, so only the frame decides. */
const quiet = (frame: string[], harness: 'claude' | 'codex' | 'kimi') => {
  const rules = rulesFor(harness)
  return attentionOf({
    alive: true,
    lastActivityMs: NOW - 600_000,
    nowMs: NOW,
    frame,
    frameDigest: 'same',
    prevDigest: 'same',
    ...(rules ? { rules } : {}),
  })
}

// ── Frames below are VERBATIM from real sessions, 2026-08-13. ────────────────────────────────────

/** claude 2.1.231 — the folder-trust dialog it opens with, which is the select component every
 *  blocking question uses. */
const CLAUDE_APPROVAL = [
  ' ❯ 1. Yes, I trust this folder',
  '   2. No, exit',
  '',
  ' Enter to confirm · Esc to cancel',
]

/** claude 2.1.231 — mid-turn. Note the input box is drawn EXACTLY as it is when idle. */
const CLAUDE_WORKING = [
  '✢ Orbiting… (5s · ↓ 76 tokens)',
  '────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────',
  '  ⏸ manual mode on · esc to interrupt · ← 6 agents                                              /rc',
]

/** claude 2.1.231 — turn finished. Only the footer differs from CLAUDE_WORKING. */
const CLAUDE_IDLE = [
  '✻ Cooked for 7s',
  '────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────',
  '  ⏸ manual mode on · ? for shortcuts · ← 6 agents                                               /rc',
]

/** codex 0.113.0 — the update dialog, its one blocking question. */
const CODEX_APPROVAL = [
  '› 1. Update now (runs `bun install -g @openai/codex`)',
  '  2. Skip',
  '  3. Skip until next version',
  '',
  '  Press enter to continue',
]

/** codex 0.113.0 — idle. Byte-identical to its mid-stream frame apart from the transcript above. */
const CODEX_IDLE = [
  '› Find and fix a bug in @filename',
  '',
  '  gpt-5.4-mini low · 100% left · /tmp/scratchpad',
]

/** kimi 0.35.0 — the folder-trust dialog. */
const KIMI_APPROVAL = [
  '  Trust this folder?',
  '  ↑↓ navigate · Enter select · Esc exit',
  '',
  '   ❯ Trust this folder',
  "     Don't trust",
]

describe('ATTENTION_RULES', () => {
  it('declares an entry for every harness, so a new one cannot be forgotten', () => {
    for (const h of HARNESS_ORDER) {
      expect(ATTENTION_RULES).toHaveProperty(h)
    }
  })

  it('never uses the g flag, which would make .test() alternate', () => {
    for (const h of HARNESS_ORDER) {
      const r = ATTENTION_RULES[h]
      if (!r) continue
      for (const re of [...r.approval, ...(r.working ?? [])]) {
        expect(re.global).toBe(false)
      }
    }
  })

  it('records provenance for every harness that has rules', () => {
    for (const h of HARNESS_ORDER) {
      const r = ATTENTION_RULES[h]
      if (!r) continue
      expect(r.probed).toMatch(/\d{4}-\d{2}-\d{2}/)
    }
  })
})

describe('claude', () => {
  it('sees the blocking dialog', () => {
    expect(quiet(CLAUDE_APPROVAL, 'claude')).toBe('waiting-approval')
  })

  it('sees a running turn from the footer, not from the input box', () => {
    expect(quiet(CLAUDE_WORKING, 'claude')).toBe('working')
  })

  it('reports a finished turn as waiting', () => {
    expect(quiet(CLAUDE_IDLE, 'claude')).toBe('waiting')
  })
})

describe('codex', () => {
  it('sees the blocking dialog', () => {
    expect(quiet(CODEX_APPROVAL, 'codex')).toBe('waiting-approval')
  })

  it('has no working marker — its idle and streaming frames are the same', () => {
    expect(rulesFor('codex')?.working).toBeUndefined()
    expect(quiet(CODEX_IDLE, 'codex')).toBe('waiting')
  })
})

describe('kimi', () => {
  it('sees the blocking dialog', () => {
    expect(quiet(KIMI_APPROVAL, 'kimi')).toBe('waiting-approval')
  })
})
