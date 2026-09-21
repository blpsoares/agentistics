import { describe, expect, test } from 'bun:test'
import {
  TERMINAL_TARGETS, followBottomOccupant, readTarget, resolveDockedTarget, shellTargetUnavailable,
  targetLabel, targetScope, targetStreamId, usableTarget,
} from './terminalTarget'

describe('the two things a terminal band can show', () => {
  test('there are exactly two, and shell is not one of the assistants', () => {
    expect(TERMINAL_TARGETS).toEqual(['cli', 'shell'])
  })

  // The two channels are resolved against DIFFERENT stores — the fleet's registry and
  // `shells.json` — so handing one the other's id is the mistake the whole scope split exists to
  // make impossible. The target decides both halves together, in one place.
  test('each target names its own channel AND its own id', () => {
    expect(targetScope('cli')).toBe('fleet')
    expect(targetScope('shell')).toBe('shell')
    expect(targetStreamId('cli', { sessionId: 's1', shellId: 'sh1' })).toBe('s1')
    expect(targetStreamId('shell', { sessionId: 's1', shellId: 'sh1' })).toBe('sh1')
  })

  test('a shell that has not been opened yet has no id to stream', () => {
    expect(targetStreamId('shell', { sessionId: 's1', shellId: null })).toBeNull()
  })

  test('the CLI pane is always streamable — it IS the session', () => {
    expect(targetStreamId('cli', { sessionId: 's1', shellId: null })).toBe('s1')
  })
})

describe('what each target is CALLED', () => {
  // "Assistente" named a concept; the harness names the thing that is actually on the screen, and
  // needs no explanation. Reported as "invés de assistant coloca algo que dê a entender mais fácil".
  test('the CLI pane is named after the harness running in it', () => {
    expect(targetLabel('cli', 'claude', 'pt')).toBe('Claude Code')
    expect(targetLabel('cli', 'codex', 'en')).toBe('Codex CLI')
  })

  test('a harness nobody can name falls back to words, never to a blank segment', () => {
    expect(targetLabel('cli', undefined, 'pt')).toBe('Sessão CLI')
    expect(targetLabel('cli', undefined, 'en')).toBe('CLI session')
    expect(targetLabel('cli', 'nope' as never, 'pt')).toBe('Sessão CLI')
  })

  test('the shell is called Shell in both languages — it is the word the product already uses', () => {
    expect(targetLabel('shell', 'claude', 'pt')).toBe('Shell')
    expect(targetLabel('shell', 'claude', 'en')).toBe('Shell')
  })
})

describe('the stored target', () => {
  test('absent or unreadable reads as the SHELL, which is what the band has always been', () => {
    for (const raw of [undefined, null, '', 'nope', 7]) {
      expect(readTarget(raw), String(raw)).toBe('shell')
    }
  })

  test('a stored target is honoured', () => {
    expect(readTarget('cli')).toBe('cli')
    expect(readTarget('shell')).toBe('shell')
  })
})

// `ShellBand`'s own security narrowing: the shell switch decides CONTENT (which pane a docked band
// may ever show or open), never PRESENCE — see `lib/panelBar.ts`'s own `bottomBandFor`. This is
// the ONE place that narrowing is computed, so `ShellBand`'s fresh-mount seed and its
// `bottomOccupant`-follow effect can never disagree about what a `'shell'` reading becomes.
describe('usableTarget — a "shell" reading is unusable once the switch is off', () => {
  test('shellEnabled: every target passes through unchanged', () => {
    expect(usableTarget('cli', true)).toBe('cli')
    expect(usableTarget('shell', true)).toBe('shell')
  })

  test('shellEnabled off: "shell" reads as "cli" — the session\'s own pane, always there', () => {
    expect(usableTarget('shell', false)).toBe('cli')
  })

  test('shellEnabled off: "cli" passes through unchanged — it was never gated by the switch', () => {
    expect(usableTarget('cli', false)).toBe('cli')
  })

  // `readTarget`'s own default is `'shell'` (see above) — this is exactly the composition
  // `ShellBand`'s fresh-mount `useState` initializer runs, and the case the whole fix exists for:
  // a session with no stored preference at all, on a machine where the shell switch is off.
  test('composed with readTarget\'s own default: a fresh, unreadable preference resolves to "cli" once the switch is off', () => {
    for (const raw of [undefined, null, '', 'nope', 7]) {
      expect(usableTarget(readTarget(raw), false), String(raw)).toBe('cli')
      expect(usableTarget(readTarget(raw), true), String(raw)).toBe('shell')
    }
  })
})

// `shellTargetUnavailable` — the RENDER-time predicate the disabled-shell empty state is drawn on.
// It is deliberately the same shape as `usableTarget`'s own clamp condition: not a coincidence, it
// is that very condition, named so a caller can ask "would this have been clamped" instead of only
// ever being handed the clamped answer.
describe('shellTargetUnavailable — when the CURRENT target is shell but cannot be shown', () => {
  test('shell, disabled: unavailable', () => {
    expect(shellTargetUnavailable('shell', false)).toBe(true)
  })
  test('shell, enabled: available', () => {
    expect(shellTargetUnavailable('shell', true)).toBe(false)
  })
  test('cli is never "unavailable" — it is never gated by the switch', () => {
    expect(shellTargetUnavailable('cli', false)).toBe(false)
    expect(shellTargetUnavailable('cli', true)).toBe(false)
  })
})

// `resolveDockedTarget` — the docked band's fresh-mount seed, and the one place the old silent
// `usableTarget` clamp is REPLACED rather than dropped: a GENUINE record of "shell" survives being
// unusable (so the empty state can explain it), while `readTarget`'s own default never does (so a
// brand-new session never opens on that empty state).
describe('resolveDockedTarget — only a GENUINE record of shell survives being unusable', () => {
  test('enabled: behaves exactly like the old usableTarget(bottomOccupant ?? readTarget(stored))', () => {
    expect(resolveDockedTarget(null, undefined, true)).toBe('shell') // readTarget's own default
    expect(resolveDockedTarget(null, 'cli', true)).toBe('cli')
    expect(resolveDockedTarget('shell', 'cli', true)).toBe('shell') // bottomOccupant wins
    expect(resolveDockedTarget('cli', 'shell', true)).toBe('cli')
  })

  test('disabled + an explicit bottomOccupant of "shell": kept, so the empty state can explain it', () => {
    expect(resolveDockedTarget('shell', undefined, false)).toBe('shell')
    expect(resolveDockedTarget('shell', 'cli', false)).toBe('shell')
  })

  test('disabled + a LITERALLY stored "shell" preference (no bottomOccupant): kept', () => {
    expect(resolveDockedTarget(null, 'shell', false)).toBe('shell')
  })

  test('disabled + NO bottomOccupant + an absent/unreadable stored preference: clamped to cli — ' +
    'this is the case item 2 forbids showing the empty state for', () => {
    for (const raw of [undefined, null, '', 'nope', 7]) {
      expect(resolveDockedTarget(null, raw, false), String(raw)).toBe('cli')
    }
  })

  test('disabled + a stored "cli" preference: cli, same as always', () => {
    expect(resolveDockedTarget(null, 'cli', false)).toBe('cli')
  })

  // Plant: reverting to the OLD clamp (`usableTarget(bottomOccupant ?? readTarget(stored),
  // shellEnabled)`, with no "was it genuine" check) must fail the "kept" cases above — proving they
  // actually exercise the new behaviour rather than a coincidence of the two functions agreeing.
  test('plant: the OLD clamp disagrees on the genuine-record cases', () => {
    const oldClamp = (bottomOccupant: 'cli' | 'shell' | null, stored: unknown, enabled: boolean) =>
      usableTarget(bottomOccupant ?? readTarget(stored), enabled)
    expect(resolveDockedTarget('shell', undefined, false)).not.toBe(oldClamp('shell', undefined, false))
    expect(resolveDockedTarget(null, 'shell', false)).not.toBe(oldClamp(null, 'shell', false))
  })
})

// `followBottomOccupant` — `ShellBand`'s own `bottomOccupant`-follow effect, extracted so the rule
// can be pinned without mounting a component (this repo's test runner has no DOM). The bug it
// replaces: the mobile "Which terminal" segment's own `chooseTarget` is entirely LOCAL (it never
// writes `panelSlots`), so tapping "Shell" while `bottomOccupant` still read "cli" left the two
// disagreeing on the very next render — and the OLD effect, which judged `bottomOccupant` against
// `target`, read that disagreement as a fact to correct and reverted the tap immediately.
describe('followBottomOccupant — a pick is authoritative until the occupant itself moves', () => {
  // THE REGRESSION ITSELF: `bottomOccupant` has NOT changed since the effect last ran (same as
  // `prevBottomOccupant`) even though it disagrees with `target` — a local pick, nothing else.
  // Must NOT follow, or every tap of the mobile segment reverts on its own next render.
  test('picking shell while the occupant (unchanged) still says cli: does not revert the pick', () => {
    expect(followBottomOccupant('cli', 'cli', 'shell')).toBeNull()
  })

  test('picking cli while the occupant (unchanged) still says shell: does not revert the pick', () => {
    expect(followBottomOccupant('shell', 'shell', 'cli')).toBeNull()
  })

  // A GENUINE TRANSITION: `bottomOccupant` itself moved since the effect last ran (SessionPanel's
  // "bring it to the bottom" gesture placing a different panel here) — this is the one case that
  // must still follow, or an external move stops reaching this band at all.
  test('the occupant genuinely transitions to a different pane: follows it', () => {
    expect(followBottomOccupant('shell', 'cli', 'cli')).toBe('shell')
    expect(followBottomOccupant('cli', 'shell', 'shell')).toBe('cli')
  })

  // The occupant transitioned, but `target` already agrees with the new value (the person had
  // already picked what the slot now names) — nothing to do.
  test('a genuine transition that already matches target: no-op', () => {
    expect(followBottomOccupant('shell', 'cli', 'shell')).toBeNull()
  })

  // `null` — the panel moved AWAY from the bottom, or nothing has ever named an occupant — never
  // overwrites a choice made by clicking inside this band itself, transition or not.
  test('bottomOccupant absent: never follows', () => {
    expect(followBottomOccupant(null, 'cli', 'shell')).toBeNull()
    expect(followBottomOccupant(null, null, 'shell')).toBeNull()
  })

  // First mount: the caller's own `useRef(bottomOccupant)` seeds `prevBottomOccupant` to the SAME
  // value on the very first render, so this is a no-op there too — consistent with `target` already
  // being seeded from `bottomOccupant` via `resolveDockedTarget` at mount.
  test('first render (prev seeded from the current value): no-op regardless of target', () => {
    expect(followBottomOccupant('shell', 'shell', 'cli')).toBeNull()
  })

  // Plant: reverting to the OLD comparison (`bottomOccupant` judged against `target`, never against
  // its own previous value) must disagree on the regression case above — proving this test actually
  // exercises the fix rather than a coincidence of the two shapes agreeing.
  test('plant: the OLD comparison (against target, not against its own previous value) reverts the pick', () => {
    const oldFollow = (bottomOccupant: 'cli' | 'shell' | null, target: 'cli' | 'shell') =>
      bottomOccupant && bottomOccupant !== target ? bottomOccupant : null
    expect(followBottomOccupant('cli', 'cli', 'shell')).not.toBe(oldFollow('cli', 'shell'))
    expect(oldFollow('cli', 'shell')).toBe('cli') // the very revert the fix removes
  })
})
