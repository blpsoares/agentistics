/**
 * attention.ts — PURE. Which sessions are waiting on the user.
 *
 * Two stages, and the order is the whole design:
 *
 *   1. QUIESCENCE IS THE GATE. A session whose pane wrote bytes within QUIET_MS is `working`, and
 *      no pattern is consulted. This half comes from tmux's own activity clock and cannot break
 *      when a harness changes its screen.
 *   2. PATTERNS CLASSIFY THE QUIET ONES, and only them — separating "waiting for you to approve
 *      something" from "waiting for you to type". This half is the fragile one: every upstream
 *      release can change a frame.
 *
 * When no pattern matches, the answer is `idle-unknown`, rendered in those words. Never a
 * reassuring guess: the user ACTS on this screen, and a wrong "nothing needs you" is worse than an
 * admitted gap. Same rule `HARNESS_CAPABILITIES` applies to metrics.
 *
 * Every pattern below was read off a frame captured from a real running session and committed
 * under `fixtures/`. A harness with no fixtures has `null` rules and always reports
 * `idle-unknown` — which is correctable; a guessed pattern that silently stops matching is not.
 */

import type { HarnessId } from '@agentistics/core'
import type { CaptureResult } from './types'

/** How long a pane must be silent before its frame is worth reading. */
export const QUIET_MS = Number(process.env.AGENTISTICS_SESSION_QUIET_MS) > 0
  ? Number(process.env.AGENTISTICS_SESSION_QUIET_MS)
  : 3_000

export type SessionState =
  | 'working'
  | 'waiting-approval'
  | 'waiting-input'
  | 'idle-unknown'
  | 'unreadable'
  | 'exited'
  | 'external'

export interface AttentionRules {
  /** Any match means the harness is asking for a decision. */
  approval: RegExp[]
  /** Any match means the harness is waiting for a new instruction. */
  input: RegExp[]
}

export interface AttentionInput {
  harness: HarnessId
  /** False once the hosted command has exited. */
  alive: boolean
  nowMs: number
  lastActivityMs: number
  capture: CaptureResult
}

export const ATTENTION_RULES: Record<HarnessId, AttentionRules | null> = {
  // fixtures/claude-idle.txt, claude-approval-tool.txt, claude-approval-trust.txt
  // (Claude Code v2.1.229).
  claude: {
    approval: [
      // The SELECTED option of a claude dialog: `❯ 1. Yes` (approval-tool line 27) and
      // `❯ 1. Yes, I trust this folder` (approval-trust line 13). What separates it from the idle
      // composer is the numbered option after the caret, never the caret itself — both frames
      // contain `❯`, so a rule leaning on the caret alone would call every dialog idle.
      /^[ \t\u00a0]*❯[ \t\u00a0]+\d+\.[ \t\u00a0]/,
      // The dialog footer, in both fixtures: `Esc to cancel · Tab to amend` (tool, line 31) and
      // `Enter to confirm · Esc to cancel` (trust, line 16). The two halves differ, `Esc to cancel`
      // does not — and it appears nowhere in the idle frame.
      /Esc to cancel/,
    ],
    input: [
      // The empty composer, idle line 37. The character after the caret is a NO-BREAK SPACE
      // (U+00A0) as claude writes it — spelled out rather than left to `\s`, so the rule states
      // the byte it was read from instead of depending on which class happens to cover it.
      /^[ \t\u00a0]*❯[ \t\u00a0]*$/,
      // The idle status bar, line 39. While claude is running the same bar reads
      // `esc to interrupt` instead, so this phrase is specific to a session awaiting a prompt.
      /\? for shortcuts/,
    ],
  },

  // fixtures/codex-idle.txt, codex-approval-tool.txt, codex-approval-trust.txt (codex v0.113.0).
  codex: {
    approval: [
      // The footer of every codex modal: `Press enter to continue` (trust, line 8) and
      // `Press enter to confirm or esc to cancel` (approval-tool, line 56).
      /Press enter to (?:continue|confirm)/,
      // The selected option: `› 1. Yes, continue` / `› 1. Yes, proceed (y)`.
      /^[ \t]*›[ \t]+\d+\.[ \t]/,
    ],
    input: [
      // The idle status line, `gpt-5.4-mini low · 100% left · ~/agentistics` (idle, line 31).
      // Absent from both approval frames, where the dialog takes the bottom of the screen.
      /\d+%[ \t]+left/,
    ],
  },

  // Idle frame captured (fixtures/kimi-idle.txt, Kimi Code 0.33.0) but NO approval frame: the only
  // provider this machine has kimi configured against is a local Ollama that is not running, so no
  // turn could be driven far enough to raise a permission prompt. Input-only rules would name an
  // approval prompt "waiting-input" — a specific, confident, wrong sentence — so kimi stays null
  // and reports `idle-unknown` until an approval frame exists to read a rule from.
  kimi: null,

  // Never captured: not started by the session manager in this phase.
  gemini: null,
  copilot: null,
  antigravity: null,
}

/** Index of the LAST line any rule matches, or -1. Bottom-up, so the first hit is the last line. */
function lastMatch(rules: RegExp[], lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line !== undefined && rules.some(r => r.test(line))) return i
  }
  return -1
}

export function classifyAttention(input: AttentionInput): SessionState {
  // A finished command is finished, whatever its last frame happens to still show.
  if (!input.alive) return 'exited'

  // Stage 1. tmux's activity clock, which is still good when the frame is not.
  if (input.nowMs - input.lastActivityMs < QUIET_MS) return 'working'

  // The session is quiet. Now the frame matters — and if we could not read it, say so.
  if (!input.capture.ok) return 'unreadable'

  const rules = ATTENTION_RULES[input.harness]
  if (!rules) return 'idle-unknown'

  // Stage 2, and it is POSITIONAL rather than a plain "approval first, then input" over the joined
  // frame. `capture-pane -S -40` returns scrollback as well as the live screen, and a dialog that
  // was answered minutes ago is still sitting in it: fixtures/codex-idle.txt is an ordinary idle
  // frame whose captured scrollback still holds the directory-trust dialog codex opened with. A
  // whole-frame match calls that session `waiting-approval` for as long as it lives.
  //
  // A terminal UI draws its current state at the BOTTOM, so the lower match is the more recent
  // one. Approval still wins every tie and wins outright unless the composer was redrawn strictly
  // BELOW the dialog — i.e. unless the harness itself has already moved on. That keeps the one
  // ordering guarantee that matters: a live approval prompt can never be reported as idle, which
  // is the error in the reassuring direction and the worst this module can make.
  const approvalAt = lastMatch(rules.approval, input.capture.lines)
  const inputAt = lastMatch(rules.input, input.capture.lines)
  if (approvalAt < 0 && inputAt < 0) return 'idle-unknown'
  return inputAt > approvalAt ? 'waiting-input' : 'waiting-approval'
}

/** Does this state mean the user is being waited on? Drives the counter, the BEL and the sort. */
export function needsAttention(state: SessionState): boolean {
  return state === 'waiting-approval' || state === 'waiting-input'
}
