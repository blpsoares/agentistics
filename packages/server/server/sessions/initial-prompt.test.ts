import { describe, expect, it } from 'bun:test'
import { rulesFor } from './attention-rules'
import { promptSurfaceReady, turnRunning, planPromptDelivery } from './initial-prompt'

const claude = rulesFor('claude')

// Real frames captured from claude 2.1.251 under tmux on 2026-08-28 (see the PR's reproduction).
const BOOT_SPLASH = ['', ' ▐▛███▛█   Claude Code v2.1.251', '']
const TRUST_DIALOG = [
  ' Quick safety check: Is this a project you created or one you trust?',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
]
const PREFILLED_IDLE = [
  '❯ @/home/u/.aipe/journeys/x/prompts/brief.md',
  '────────────────────────────────',
  '❯ @/home/u/.aipe/journeys/x/prompts/brief.md',
  '────────────────────────────────',
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ? for shortcuts',
]
const RUNNING = [
  '❯ @/home/u/.aipe/journeys/x/prompts/brief.md',
  '  ⎿  Read brief.md (2 lines)',
  '',
  '✻ Working… (3s · esc to interrupt)',
]

describe('promptSurfaceReady', () => {
  it('is false on the boot splash (nothing drawn yet)', () => {
    expect(promptSurfaceReady(BOOT_SPLASH, claude)).toBe(false)
  })
  it('is false while a startup/trust dialog is up — never deliver into a dialog', () => {
    expect(promptSurfaceReady(TRUST_DIALOG, claude)).toBe(false)
  })
  it('is true once the harness is at its input prompt', () => {
    expect(promptSurfaceReady(PREFILLED_IDLE, claude)).toBe(true)
  })
  it('is true while a turn runs (a running surface is a drawn one)', () => {
    expect(promptSurfaceReady(RUNNING, claude)).toBe(true)
  })
})

describe('turnRunning', () => {
  it('is true when the working marker is in the footer — the prompt was submitted', () => {
    expect(turnRunning(RUNNING, claude)).toBe(true)
  })
  it('is false at an idle prompt', () => {
    expect(turnRunning(PREFILLED_IDLE, claude)).toBe(false)
  })
  it('is false for a harness with no probed working marker', () => {
    expect(turnRunning(RUNNING, rulesFor('codex'))).toBe(false)
  })
})

describe('planPromptDelivery — the backend loop reads this each poll', () => {
  const step = (frame: string[], readyStreak: number, mode: 'type' | 'submit', rules = claude) =>
    planPromptDelivery({ frame, rules, mode, readyStreak })

  it('waits while the boot splash is up', () => {
    expect(step(BOOT_SPLASH, 0, 'submit')).toEqual({ action: 'wait', readyStreak: 0 })
  })

  it('waits while a dialog is up, and does NOT submit into it (a blind Enter would pick "No, exit")', () => {
    expect(step(TRUST_DIALOG, 2, 'submit')).toEqual({ action: 'wait', readyStreak: 0 })
  })

  it('is DONE the moment a turn is running — the positional prompt auto-submitted', () => {
    expect(step(RUNNING, 0, 'submit')).toEqual({ action: 'done', readyStreak: 0 })
  })

  it('counts consecutive ready polls before acting, giving auto-submit its beat', () => {
    // A positional harness sitting idle with the prompt pre-filled: ready, but not yet for long
    // enough to be sure it will not auto-submit.
    expect(step(PREFILLED_IDLE, 0, 'submit')).toEqual({ action: 'wait', readyStreak: 1 })
    expect(step(PREFILLED_IDLE, 1, 'submit')).toEqual({ action: 'wait', readyStreak: 2 })
    // Stably idle across READY_CONFIRM polls and never ran — it will not auto-submit. Submit it.
    expect(step(PREFILLED_IDLE, 2, 'submit')).toEqual({ action: 'submit', readyStreak: 3 })
  })

  it('types once ready for a send-keys harness', () => {
    const idleKimi = ['│ Type a message │', '↑↓ navigate']
    // kimi has no working marker; readiness alone gates typing.
    const r1 = planPromptDelivery({ frame: idleKimi, rules: rulesFor('kimi'), mode: 'type', readyStreak: 2 })
    expect(r1).toEqual({ action: 'type', readyStreak: 3 })
  })

  it('a submit-mode harness with no working marker never forces an Enter (cannot verify safely)', () => {
    // codex is positional but has no working marker — we cannot tell "auto-submitted" from "idle",
    // so we never risk a double-submit. It reaches ready and stays `wait` (the CLI's positional
    // contract is left to run).
    const idleCodex = ['› Find and fix a bug', '  send q to quit']
    const r = planPromptDelivery({ frame: idleCodex, rules: rulesFor('codex'), mode: 'submit', readyStreak: 5 })
    expect(r.action).toBe('wait')
  })
})
