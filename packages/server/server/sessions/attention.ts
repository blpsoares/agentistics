/**
 * attention.ts — PURE. What a session is doing, from the only two things a backend can report:
 * whether the screen moved, and what is on it.
 *
 * The order below is an order of EVIDENCE, strongest first, and each step exists because the ones
 * after it are wrong in a case it covers:
 *
 *  - A blocked dialog outranks movement. The dialog IS the frame; nothing is running behind it.
 *  - A probed `working` marker outranks the movement test, so a harness that thinks without
 *    redrawing is never mistaken for quiet.
 *  - Movement is tested two ways because each alone has a blind spot: tmux's `session_activity` has
 *    one-second resolution and moves when a spinner redraws identical bytes, while a frame digest
 *    cannot see a process that is busy and silent.
 *
 * `waiting` is the floor rather than an "unknown", and that is a deliberate claim: an interactive
 * assistant that is alive and still is waiting for its user. The uncertainty this system genuinely
 * has is about the REASON, and it lives in `attention-rules.ts` having no approval rule for a
 * harness nobody probed — which the UI states in words.
 */

import type { AttentionRules, SessionActivity } from './types'

/**
 * One poll interval (5s) plus slack.
 *
 * A backend that reported output inside this window is working even if the frame it drew happens to
 * hash the same as the last one — which is exactly what a redrawn-but-unchanged status line does.
 */
export const QUIET_MS = 6_000

/**
 * FNV-1a over the frame, joined with newlines.
 *
 * Dependency-free, and deliberately not a crypto hash: the only question ever asked of this value is
 * "is this the same frame as last time". The `\n` separator is load-bearing — joining without one
 * would make a reflowed frame (`['ab']` versus `['a','b']`) hash identically, and a reflow is
 * movement.
 */
export function digestFrame(lines: readonly string[]): string {
  const s = lines.join('\n')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

export function attentionOf(o: {
  alive: boolean
  lastActivityMs: number
  nowMs: number
  frame: readonly string[]
  frameDigest: string
  /** Absent on the first sighting of a session — treated as "no movement observed", never as
   *  movement, or every session would read as working for one interval after the poller starts. */
  prevDigest?: string
  /** Absent for a harness with no probed markers. Movement alone still decides. */
  rules?: AttentionRules
}): SessionActivity {
  if (!o.alive) return 'exited'

  const text = o.frame.join('\n')
  if (o.rules && o.rules.approval.some(re => re.test(text))) return 'waiting-approval'
  if (o.rules?.working && o.rules.working.some(re => re.test(text))) return 'working'

  if (o.prevDigest !== undefined && o.frameDigest !== o.prevDigest) return 'working'
  if (o.nowMs - o.lastActivityMs < QUIET_MS) return 'working'

  return 'waiting'
}
