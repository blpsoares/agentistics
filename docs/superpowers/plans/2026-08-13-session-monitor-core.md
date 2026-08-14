# Session Monitor Core (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Know, for every assistant session on this machine, whether it is working or waiting for you — and say so honestly when it cannot be known.

**Architecture:** Four new modules under `packages/server/server/sessions/`. Three are PURE (`attention.ts`, `attention-rules.ts`, `session-view.ts`) and hold every decision; one (`sessions-host.ts`) does the I/O and is bound to its dependencies at construction so tests never need tmux or `/proc`. `agentop session list` becomes the first consumer, so the phase ships working software before any TUI exists.

**Tech Stack:** TypeScript (strict), Bun, `bun:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-session-cockpit-design.md` §4.1–4.3.

## Global Constraints

- **Everything in this project is in English** — code, comments, commit messages, docs.
- **Conventional Commits.** Pre-commit runs `bun tsc --noEmit` + `bun test`; commit-msg runs commitlint.
- **Pure modules are pure**: no `Date.now()`, no filesystem, no process reads inside them. The caller passes `nowMs`.
- **Never guess a CLI's output.** Every pattern in `attention-rules.ts` comes from a frame captured from the real CLI, with the version and date recorded. A harness with no probed marker ships none.
- **`Record<HarnessId, X | null>`, never a `Partial` and never an array literal.** A new harness must fail the build until someone decides, exactly as `SPAWN_SPECS` and `HARNESS_CAPABILITIES` do.
- **No fs mocks.** Modules that touch disk take their path/deps as constructor arguments (`createSessionRegistry(file)` is the established pattern).
- **Work in a worktree on your own branch, based on `origin/dev`.** Stage explicit paths; never `git add -A`.
- **A `RegExp` used with `.test()` must not carry the `g` flag** — it is stateful and alternate calls return `false`.

---

### Task 1: `attention.ts` — what a session is doing

**Files:**
- Modify: `packages/server/server/sessions/types.ts` (append `SessionActivity` and `AttentionRules`)
- Create: `packages/server/server/sessions/attention.ts`
- Test: `packages/server/server/sessions/attention.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type SessionActivity = 'working' | 'waiting-approval' | 'waiting' | 'exited'`
  - `interface AttentionRules { approval: RegExp[]; working?: RegExp[]; probed: string }`
  - `const QUIET_MS = 6_000`
  - `digestFrame(lines: readonly string[]): string`
  - `attentionOf(o: { alive: boolean; lastActivityMs: number; nowMs: number; frame: readonly string[]; frameDigest: string; prevDigest?: string; rules?: AttentionRules }): SessionActivity`

- [ ] **Step 1: Add the two types to `types.ts`**

Append to `packages/server/server/sessions/types.ts`:

```ts
/**
 * What a session is doing right now.
 *
 * There is deliberately no `idle`. An interactive assistant whose process is alive and whose screen
 * has stopped moving is, by construction, waiting for the person in front of it — there is no third
 * thing it could be doing. What genuinely cannot always be known is WHY it is waiting, and that
 * uncertainty lives in `AttentionRules.approval` being absent for a harness nobody has probed, which
 * the UI states in words. A state word is the wrong place to put it: `idle` read as "nothing to do
 * here" on exactly the session that was blocked on a permission prompt.
 */
export type SessionActivity =
  | 'working'
  | 'waiting-approval'
  | 'waiting'
  | 'exited'

/** The screen markers of ONE harness, read from real frames. See `attention-rules.ts`. */
export interface AttentionRules {
  /** A frame matching one of these is a question the session is blocked on. */
  approval: RegExp[]
  /**
   * Proof the session is working, even if it did not redraw between two polls.
   *
   * Optional because it does not always exist: codex draws the same footer and the same ghost
   * placeholder while streaming output as it does while sitting idle. For such a harness movement
   * is the only working signal there is, and claiming otherwise would be a guess.
   */
  working?: RegExp[]
  /** Provenance — the exact CLI version the frames came from, and the date. */
  probed: string
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/server/server/sessions/attention.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { QUIET_MS, attentionOf, digestFrame } from './attention'
import type { AttentionRules } from './types'

const NOW = 1_786_600_000_000

const rules: AttentionRules = {
  probed: 'test',
  approval: [/Enter to confirm/],
  working: [/esc to interrupt/],
}

/** Everything the function needs, with the session plainly quiet and unremarkable. */
const base = {
  alive: true,
  lastActivityMs: NOW - 60_000,
  nowMs: NOW,
  frame: ['idle'] as readonly string[],
  frameDigest: 'same',
  prevDigest: 'same',
}

describe('digestFrame', () => {
  it('is stable for the same frame', () => {
    expect(digestFrame(['a', 'b'])).toBe(digestFrame(['a', 'b']))
  })

  it('changes when the frame changes', () => {
    expect(digestFrame(['a', 'b'])).not.toBe(digestFrame(['a', 'c']))
  })

  it('does not collide across a line boundary shift', () => {
    // ['ab'] and ['a','b'] must differ: a digest that joined without a separator would call a
    // reflowed frame unchanged and report a working session as waiting.
    expect(digestFrame(['ab'])).not.toBe(digestFrame(['a', 'b']))
  })
})

describe('attentionOf', () => {
  it('reports a finished command as exited, whatever is on screen', () => {
    expect(attentionOf({ ...base, alive: false, frame: ['esc to interrupt'], rules })).toBe('exited')
  })

  it('reports an approval question even while the frame is moving', () => {
    // A blocked dialog outranks movement: nothing is running behind it, and a spinner elsewhere on
    // the screen must never hide the question.
    expect(attentionOf({
      ...base, frame: ['Enter to confirm · Esc to cancel'], frameDigest: 'new', rules,
    })).toBe('waiting-approval')
  })

  it('reports working from a proof marker even when the frame did not move', () => {
    expect(attentionOf({ ...base, frame: ['esc to interrupt'], rules })).toBe('working')
  })

  it('reports working when the frame changed since the last poll', () => {
    expect(attentionOf({ ...base, frameDigest: 'new', prevDigest: 'old', rules })).toBe('working')
  })

  it('reports working when the backend saw output inside the quiet window', () => {
    expect(attentionOf({ ...base, lastActivityMs: NOW - (QUIET_MS - 1), rules })).toBe('working')
  })

  it('reports waiting once the window has passed and nothing moved', () => {
    expect(attentionOf({ ...base, lastActivityMs: NOW - QUIET_MS, rules })).toBe('waiting')
  })

  it('still decides without any rules — movement alone is enough', () => {
    expect(attentionOf({ ...base, frameDigest: 'new', prevDigest: 'old' })).toBe('working')
    expect(attentionOf({ ...base })).toBe('waiting')
  })

  it('does not call a first sighting working just because there is no previous digest', () => {
    // The first poll of a long-quiet session has no prevDigest. Treating "unknown" as "changed"
    // would show every session as working for one interval after the cockpit opens.
    expect(attentionOf({ ...base, prevDigest: undefined })).toBe('waiting')
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `bun test packages/server/server/sessions/attention.test.ts`
Expected: FAIL — `Cannot find module './attention'`.

- [ ] **Step 4: Write the implementation**

Create `packages/server/server/sessions/attention.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `bun test packages/server/server/sessions/attention.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 6: Typecheck**

Run: `bun tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/sessions/types.ts \
        packages/server/server/sessions/attention.ts \
        packages/server/server/sessions/attention.test.ts
git commit -m "feat(sessions): decide what a session is doing from its frame"
```

---

### Task 2: `attention-rules.ts` — the probed markers

**Files:**
- Create: `packages/server/server/sessions/attention-rules.ts`
- Test: `packages/server/server/sessions/attention-rules.test.ts`

**Interfaces:**
- Consumes: `AttentionRules` from Task 1 (`./types`), `attentionOf` from `./attention`.
- Produces: `const ATTENTION_RULES: Record<HarnessId, AttentionRules | null>` and `rulesFor(h: HarnessId): AttentionRules | undefined`.

**Provenance — do not change these strings without re-probing.** They were captured on 2026-08-13 by starting each CLI under `tmux -L probe` and reading `capture-pane -p`. The captured lines appear verbatim in the test.

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/sessions/attention-rules.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { HARNESS_ORDER } from '@agentistics/core'
import { ATTENTION_RULES, rulesFor } from './attention-rules'
import { attentionOf } from './attention'

const NOW = 1_786_600_000_000

/** Quiet and unmoving, so only the frame decides. */
const quiet = (frame: string[], harness: 'claude' | 'codex' | 'kimi') => attentionOf({
  alive: true,
  lastActivityMs: NOW - 600_000,
  nowMs: NOW,
  frame,
  frameDigest: 'same',
  prevDigest: 'same',
  ...(rulesFor(harness) ? { rules: rulesFor(harness)! } : {}),
})

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
  '     Don\'t trust',
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test packages/server/server/sessions/attention-rules.test.ts`
Expected: FAIL — `Cannot find module './attention-rules'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/server/sessions/attention-rules.ts`:

```ts
/**
 * attention-rules.ts — PURE. The per-harness screen markers, READ FROM REAL FRAMES.
 *
 * Every pattern here was captured on 2026-08-13 by starting the CLI under tmux and reading
 * `capture-pane -p`. Nothing is written from memory of what a CLI prints, for the same reason
 * `spawn-spec.ts` reads every flag from the tool's own `--help`: a plausible-looking pattern that
 * never matches fails SILENTLY. It does not throw and it does not look wrong — it just reports a
 * working session as waiting, forever, and the counter that was supposed to earn this feature its
 * place becomes noise.
 *
 * Two findings from that probe are load-bearing, and both contradict what the patterns would have
 * been if guessed:
 *
 *  - **Claude's input box is not a discriminator.** The `❯` prompt line and its two rules are drawn
 *    identically while a turn is running and after it finishes. Only the FOOTER changes —
 *    `esc to interrupt` while working, `? for shortcuts` when done. A rule keyed on the box would
 *    have called every working session waiting.
 *  - **Codex has no working marker at all.** Its status footer and its ghost placeholder
 *    (`› Find and fix a bug in @filename`) are byte-identical while it streams output and while it
 *    sits idle. For codex, movement is the only working signal that exists, so `working` is absent
 *    rather than approximated.
 *
 * `Record<HarnessId, … | null>` and not a `Partial`: a harness added to `HarnessId` must fail the
 * build until someone decides, exactly as `SPAWN_SPECS` and `HARNESS_CAPABILITIES` do. `null` is
 * that decision — "not probed", which the UI reports as approval detection being unavailable.
 *
 * No pattern may carry the `g` flag: `RegExp.test` is stateful with it and alternate calls return
 * false. The test asserts this.
 */

import type { HarnessId } from '@agentistics/core'
import type { AttentionRules } from './types'

export const ATTENTION_RULES: Record<HarnessId, AttentionRules | null> = {
  claude: {
    probed: 'claude 2.1.231, 2026-08-13',
    // The select component every blocking question uses — captured from the folder-trust dialog it
    // opens with. The permission prompts and `/model` draw the same footer.
    approval: [/Enter to confirm · Esc to cancel/],
    // The footer while a turn runs. `? for shortcuts` takes its place when the turn ends.
    working: [/esc to interrupt/],
  },
  codex: {
    probed: 'codex 0.113.0, 2026-08-13',
    approval: [/Press enter to continue/],
    // `working` deliberately absent — see the header.
  },
  kimi: {
    probed: 'kimi 0.35.0, 2026-08-13',
    approval: [/↑↓ navigate · Enter select · Esc exit/],
  },
  // Not probed. These are startable only from Phase 6 onward; giving them invented patterns now
  // would be the exact failure this file's header describes.
  gemini: null,
  copilot: null,
  antigravity: null,
}

/** The rules for a harness, or `undefined` when it was never probed. */
export function rulesFor(harness: HarnessId): AttentionRules | undefined {
  return ATTENTION_RULES[harness] ?? undefined
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test packages/server/server/sessions/attention-rules.test.ts`
Expected: PASS — 9 tests.

If `HARNESS_ORDER` contains a harness id not listed above, the typecheck fails. Add it as `null` — do not invent patterns for it.

- [ ] **Step 5: Typecheck**

Run: `bun tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/sessions/attention-rules.ts \
        packages/server/server/sessions/attention-rules.test.ts
git commit -m "feat(sessions): probed screen markers for claude, codex and kimi"
```

---

### Task 3: `session-view.ts` — the fleet, managed and external

**Files:**
- Modify: `packages/server/server/live-sessions.ts` (widen `sessionAtCwd`'s parameter — step 1)
- Create: `packages/server/server/sessions/session-view.ts`
- Test: `packages/server/server/sessions/session-view.test.ts`

**Interfaces:**
- Consumes: `ReconciledSession` from `./session-ref`, `SessionActivity` from `./types`, `HarnessProcess` + `sessionAtCwd` from `../live-sessions`.
- Produces:
  - `interface SessionView { id; harness?; cwd; status; activity?; label?; note?; model?; effort?; createdMs?; attached; approvalDetection: boolean }`
  - **`harness` is OPTIONAL**: an `unregistered` row is one the backend hosts and the registry has forgotten, so which harness it runs is genuinely unknown. Defaulting it to `claude` would put an invented fact into a list whose whole job is to be trusted.
  - `needsAttention(a?: SessionActivity): boolean`
  - `buildSessionViews(o: { reconciled; activity; processes }): SessionView[]`
  - `attentionCount(views: readonly SessionView[]): number`
  - `type SessionGrouping = 'harness' | 'model' | 'project' | 'none'`
  - `groupSessions(views, by): SessionGroup[]` where `interface SessionGroup { key: string; label: string; sessions: SessionView[] }`
  - `bellTransitions(prev: ReadonlyMap<string, SessionActivity>, next: readonly SessionView[]): string[]`

- [ ] **Step 1: Widen `sessionAtCwd` so one predicate serves both surfaces**

`sessionAtCwd` currently takes a whole `SessionMeta`, but it only ever reads two fields. A
`SessionView` is not a `SessionMeta`, and casting one into the other to reuse the predicate would be
a lie the compiler stops checking. Widen the parameter instead — every existing caller still
satisfies it.

In `packages/server/server/live-sessions.ts`, change the signature of `sessionAtCwd` (and only the
signature — the body and the docstring stay exactly as they are):

```ts
export function sessionAtCwd(
  s: { current_cwd?: string; project_path?: string },
  cwd: string,
): boolean {
  return s.current_cwd === cwd || s.project_path === cwd
}
```

Run: `bun tsc --noEmit && bun test packages/server/server/live-sessions.test.ts`
Expected: no typecheck output; the existing live-session tests still pass unchanged.

- [ ] **Step 2: Write the failing test**

Create `packages/server/server/sessions/session-view.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import type { HarnessProcess } from '../live-sessions'
import type { ManagedSession, SessionActivity } from './types'
import type { ReconciledSession } from './session-ref'
import {
  attentionCount, bellTransitions, buildSessionViews, groupSessions, needsAttention,
} from './session-view'

const managed = (id: string, over: Partial<ManagedSession> = {}): ManagedSession => ({
  id, harness: 'claude', cwd: '/repo/a', createdAt: '2026-08-13T10:00:00.000Z', ...over,
})

const row = (id: string, over: Partial<ReconciledSession> = {}): ReconciledSession => ({
  id,
  managed: managed(id),
  backend: { id, createdMs: 1000, attached: false, alive: true, lastActivityMs: 1000 },
  status: 'running',
  ...over,
})

const proc = (over: Partial<HarnessProcess> = {}): HarnessProcess =>
  ({ harness: 'claude', cwd: '/repo/other', startedMs: 5000, ...over })

describe('needsAttention', () => {
  it('counts both waiting states and nothing else', () => {
    expect(needsAttention('waiting')).toBe(true)
    expect(needsAttention('waiting-approval')).toBe(true)
    expect(needsAttention('working')).toBe(false)
    expect(needsAttention('exited')).toBe(false)
    expect(needsAttention(undefined)).toBe(false)
  })
})

describe('buildSessionViews', () => {
  it('carries the registry metadata onto the view', () => {
    const reconciled = [row('a', { managed: managed('a', { label: 'auth', note: 'wip', model: 'opus' }) })]
    const [v] = buildSessionViews({ reconciled, activity: new Map([['a', 'waiting']]), processes: [] })
    expect(v).toMatchObject({
      id: 'a', harness: 'claude', cwd: '/repo/a', label: 'auth', note: 'wip', model: 'opus',
      status: 'running', activity: 'waiting', approvalDetection: true,
    })
  })

  it('says approval detection is unavailable for an unprobed harness', () => {
    const reconciled = [row('a', { managed: managed('a', { harness: 'gemini' }) })]
    const [v] = buildSessionViews({ reconciled, activity: new Map(), processes: [] })
    expect(v!.approvalDetection).toBe(false)
  })

  it('leaves the harness absent for a session the registry has forgotten', () => {
    // `unregistered` means the backend hosts it and the registry does not know it. Which harness it
    // runs is genuinely unknown, and defaulting it to claude would file it under a harness it may
    // not be — in a list whose entire value is being trustworthy.
    const reconciled: ReconciledSession[] = [{
      id: 'u',
      backend: { id: 'u', createdMs: 1000, attached: false, alive: true, lastActivityMs: 1000 },
      status: 'unregistered',
    }]
    const [v] = buildSessionViews({ reconciled, activity: new Map(), processes: [] })
    expect(v!.harness).toBeUndefined()
    expect(v!.approvalDetection).toBe(false)
  })

  it('lists an external process, with no activity claimed for it', () => {
    const views = buildSessionViews({ reconciled: [], activity: new Map(), processes: [proc()] })
    expect(views).toHaveLength(1)
    expect(views[0]!.status).toBe('external')
    expect(views[0]!.activity).toBeUndefined()
    expect(views[0]!.cwd).toBe('/repo/other')
  })

  it('gives an external process a stable id across polls', () => {
    const once = buildSessionViews({ reconciled: [], activity: new Map(), processes: [proc()] })
    const again = buildSessionViews({ reconciled: [], activity: new Map(), processes: [proc()] })
    expect(once[0]!.id).toBe(again[0]!.id)
  })

  it('separates two external processes of the same harness in the same directory', () => {
    // Keyed on the start time as well as harness+cwd: two assistants open in one repo are two rows,
    // and the start time is the only thing that both distinguishes them and survives a poll.
    const views = buildSessionViews({
      reconciled: [],
      activity: new Map(),
      processes: [proc({ startedMs: 1 }), proc({ startedMs: 2 })],
    })
    expect(views).toHaveLength(2)
    expect(views[0]!.id).not.toBe(views[1]!.id)
  })

  it('drops an external process already covered by a managed session', () => {
    // The same running assistant must not appear as a managed row AND an external one — the bug
    // resolveLiveSnapshot already had to fix once.
    const views = buildSessionViews({
      reconciled: [row('a')],
      activity: new Map([['a', 'working']]),
      processes: [proc({ cwd: '/repo/a' })],
    })
    expect(views).toHaveLength(1)
    expect(views[0]!.id).toBe('a')
  })

  it('keeps an external process of a DIFFERENT harness in the same directory', () => {
    const views = buildSessionViews({
      reconciled: [row('a')],
      activity: new Map([['a', 'working']]),
      processes: [proc({ cwd: '/repo/a', harness: 'codex' })],
    })
    expect(views).toHaveLength(2)
  })

  it('sorts what needs answering to the top', () => {
    const reconciled = [row('w'), row('k'), row('ap'), row('x', { status: 'exited' })]
    const activity = new Map<string, SessionActivity>([
      ['w', 'working'], ['k', 'waiting'], ['ap', 'waiting-approval'], ['x', 'exited'],
    ])
    const views = buildSessionViews({ reconciled, activity, processes: [proc()] })
    expect(views.map(v => v.id).slice(0, 4)).toEqual(['ap', 'k', 'w', 'x'])
    expect(views[4]!.status).toBe('external')
  })
})

describe('attentionCount', () => {
  it('counts only the sessions waiting on someone', () => {
    const reconciled = [row('a'), row('b'), row('c')]
    const activity = new Map<string, SessionActivity>([
      ['a', 'waiting-approval'], ['b', 'working'], ['c', 'waiting'],
    ])
    expect(attentionCount(buildSessionViews({ reconciled, activity, processes: [] }))).toBe(2)
  })
})

describe('groupSessions', () => {
  const views = buildSessionViews({
    reconciled: [
      row('a', { managed: managed('a', { harness: 'claude', model: 'opus', cwd: '/repo/x' }) }),
      row('b', { managed: managed('b', { harness: 'codex', model: 'gpt', cwd: '/repo/x' }) }),
      row('c', { managed: managed('c', { harness: 'claude', cwd: '/repo/y' }) }),
    ],
    activity: new Map(),
    processes: [],
  })

  it('groups by harness', () => {
    const g = groupSessions(views, 'harness')
    expect(g.map(x => x.key).sort()).toEqual(['claude', 'codex'])
    expect(g.find(x => x.key === 'claude')!.sessions).toHaveLength(2)
  })

  it('groups by model, with an honest bucket for the ones that never named one', () => {
    const g = groupSessions(views, 'model')
    expect(g.find(x => x.key === '')!.label).toBe('no model recorded')
  })

  it('gives an unknown harness its own stated bucket rather than folding it into one', () => {
    const unknown = buildSessionViews({
      reconciled: [{
        id: 'u',
        backend: { id: 'u', createdMs: 1, attached: false, alive: true, lastActivityMs: 1 },
        status: 'unregistered',
      }],
      activity: new Map(),
      processes: [],
    })
    const g = groupSessions(unknown, 'harness')
    expect(g[0]!.label).toBe('harness unknown')
  })

  it('groups by project on the directory name', () => {
    const g = groupSessions(views, 'project')
    expect(g.map(x => x.label).sort()).toEqual(['x', 'y'])
  })

  it('returns one unnamed group when grouping is off', () => {
    const g = groupSessions(views, 'none')
    expect(g).toHaveLength(1)
    expect(g[0]!.sessions).toHaveLength(3)
  })
})

describe('bellTransitions', () => {
  const views = (activity: SessionActivity) =>
    buildSessionViews({ reconciled: [row('a')], activity: new Map([['a', activity]]), processes: [] })

  it('rings when a session enters attention', () => {
    expect(bellTransitions(new Map([['a', 'working']]), views('waiting'))).toEqual(['a'])
  })

  it('does not ring again while it stays there', () => {
    expect(bellTransitions(new Map([['a', 'waiting']]), views('waiting'))).toEqual([])
  })

  it('rings when it escalates from waiting to a blocking question', () => {
    // Different urgency, and the user chose the terminal bell as the only signal there is.
    expect(bellTransitions(new Map([['a', 'waiting']]), views('waiting-approval'))).toEqual(['a'])
  })

  it('rings for a session seen for the first time already waiting', () => {
    expect(bellTransitions(new Map(), views('waiting'))).toEqual(['a'])
  })

  it('never rings for an external session, whose state is not knowable', () => {
    const external = buildSessionViews({ reconciled: [], activity: new Map(), processes: [proc()] })
    expect(bellTransitions(new Map(), external)).toEqual([])
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `bun test packages/server/server/sessions/session-view.test.ts`
Expected: FAIL — `Cannot find module './session-view'`.

- [ ] **Step 4: Write the implementation**

Create `packages/server/server/sessions/session-view.ts`:

```ts
/**
 * session-view.ts — PURE. One list holding the whole fleet: the sessions agentop hosts, and the
 * assistants running beside it that it did not start.
 *
 * External processes are here because "one place to see everything" is the point of the monitor —
 * an assistant opened by hand in another terminal is exactly the one a user loses track of. They
 * are marked `external` and carry NO activity, because nothing about them is capturable: there is
 * no frame to read and no backend to ask. Rendering a state for them would be inventing one.
 */

import type { HarnessId } from '@agentistics/core'
import { type HarnessProcess, sessionAtCwd } from '../live-sessions'
import { rulesFor } from './attention-rules'
import type { ReconciledSession } from './session-ref'
import type { SessionActivity } from './types'

export interface SessionView {
  id: string
  /**
   * ABSENT when it cannot be known.
   *
   * An `unregistered` row is one the backend hosts and the registry has forgotten — the harness it
   * runs is not recorded anywhere we can read. Defaulting it to `claude` would file a session under
   * a harness it may not be, in a list whose entire value is that it can be trusted.
   */
  harness?: HarnessId
  cwd: string
  /** `external` is the whole of "this row cannot be acted on". There is deliberately no second
   *  `managed` boolean saying the same thing, which could then disagree with it. */
  status: ReconciledSession['status'] | 'external'
  /** ABSENT for an external session — not capturable, so not knowable. */
  activity?: SessionActivity
  label?: string
  note?: string
  model?: string
  effort?: string
  createdMs?: number
  attached: boolean
  /**
   * Whether this harness has probed approval rules at all.
   *
   * False means a session blocked on a permission prompt reads as plain `waiting` — still counted,
   * still surfaced, but the reason cannot be shown. The UI says so; this flag is where it learns it.
   */
  approvalDetection: boolean
}

export function needsAttention(a?: SessionActivity): boolean {
  return a === 'waiting' || a === 'waiting-approval'
}

/** Sort key: what is waiting on a person first, then what is running, then what is finished, then
 *  the rows nothing can be done about. */
const RANK: Record<string, number> = {
  'waiting-approval': 0,
  waiting: 1,
  working: 2,
  exited: 3,
}

function rankOf(v: SessionView): number {
  if (v.status === 'external') return 5
  return RANK[v.activity ?? ''] ?? 4
}

/**
 * An id for an external process that is STABLE across polls and unique per process.
 *
 * The start time is what does both jobs: it distinguishes two assistants of the same harness open
 * in one directory (harness + cwd alone would collapse them into a single row), and unlike a list
 * index it does not change when an unrelated process appears or exits.
 */
function externalId(p: HarnessProcess): string {
  return `external:${p.harness}:${p.cwd}:${p.startedMs ?? 0}`
}

export function buildSessionViews(o: {
  reconciled: readonly ReconciledSession[]
  activity: ReadonlyMap<string, SessionActivity>
  processes: readonly HarnessProcess[]
}): SessionView[] {
  const managed: SessionView[] = o.reconciled.map(r => {
    const harness = r.managed?.harness
    const activity = o.activity.get(r.id)
    return {
      id: r.id,
      ...(harness ? { harness } : {}),
      cwd: r.managed?.cwd ?? '',
      status: r.status,
      ...(activity ? { activity } : {}),
      ...(r.managed?.label ? { label: r.managed.label } : {}),
      ...(r.managed?.note ? { note: r.managed.note } : {}),
      ...(r.managed?.model ? { model: r.managed.model } : {}),
      ...(r.managed?.effort ? { effort: r.managed.effort } : {}),
      ...(r.backend ? { createdMs: r.backend.createdMs } : {}),
      attached: r.backend?.attached ?? false,
      approvalDetection: harness !== undefined && rulesFor(harness) !== undefined,
    }
  })

  // An assistant already accounted for by a managed row must not appear twice. Matched through the
  // same `sessionAtCwd` predicate the live panel uses, so the two surfaces cannot disagree about
  // whether one running assistant is one row or two.
  //
  // A row whose harness is unknown covers NOTHING: it might be that process or might not, and
  // silently swallowing an external session on a maybe is the worse of the two errors — a duplicate
  // row is visible and self-correcting, a missing one is not.
  const covered = (p: HarnessProcess): boolean => managed.some(m =>
    m.harness === p.harness &&
    m.status !== 'lost' &&
    sessionAtCwd({ current_cwd: m.cwd, project_path: m.cwd }, p.cwd))

  const external: SessionView[] = o.processes.filter(p => !covered(p)).map(p => ({
    id: externalId(p),
    harness: p.harness,
    cwd: p.cwd,
    status: 'external' as const,
    ...(p.startedMs !== undefined ? { createdMs: p.startedMs } : {}),
    attached: false,
    approvalDetection: false,
  }))

  return [...managed, ...external].sort((a, b) => {
    const byRank = rankOf(a) - rankOf(b)
    if (byRank !== 0) return byRank
    return (b.createdMs ?? 0) - (a.createdMs ?? 0)
  })
}

export function attentionCount(views: readonly SessionView[]): number {
  return views.filter(v => needsAttention(v.activity)).length
}

export type SessionGrouping = 'harness' | 'model' | 'project' | 'none'

export interface SessionGroup {
  key: string
  /** Already display-ready. An empty key gets a sentence rather than a blank heading. */
  label: string
  sessions: SessionView[]
}

/** The last path segment, separators normalised — the same reading `projectNameKey` uses, minus the
 *  case folding, because this is a heading rather than a cross-machine correlation key. */
function projectName(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] ?? cwd
}

export function groupSessions(views: readonly SessionView[], by: SessionGrouping): SessionGroup[] {
  if (by === 'none') return [{ key: '', label: '', sessions: [...views] }]

  const groups = new Map<string, SessionGroup>()
  for (const v of views) {
    const key = by === 'harness' ? (v.harness ?? '')
      : by === 'model' ? (v.model ?? '')
      : projectName(v.cwd)
    // An empty key means the fact was never recorded. Each dimension says so in its own words
    // rather than sharing one blank heading that reads as a category.
    const label = key !== '' ? key
      : by === 'harness' ? 'harness unknown'
      : by === 'model' ? 'no model recorded'
      : 'no directory recorded'
    const found = groups.get(key)
    if (found) found.sessions.push(v)
    else groups.set(key, { key, label, sessions: [v] })
  }
  return [...groups.values()]
}

/**
 * The ids that JUST entered a state needing an answer — what the caller rings the bell for.
 *
 * A transition rather than a level, so a session sitting on a question for ten minutes does not
 * beep every five seconds. Escalating from `waiting` to `waiting-approval` counts as a transition:
 * it is a different urgency, and the bell is the only signal this design ships.
 */
export function bellTransitions(
  prev: ReadonlyMap<string, SessionActivity>,
  next: readonly SessionView[],
): string[] {
  const out: string[] = []
  for (const v of next) {
    if (!needsAttention(v.activity)) continue
    const before = prev.get(v.id)
    if (before === v.activity) continue
    out.push(v.id)
  }
  return out
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `bun test packages/server/server/sessions/session-view.test.ts`
Expected: PASS — 18 tests.

- [ ] **Step 6: Typecheck**

Run: `bun tsc --noEmit`
Expected: no output.

If the `sessionAtCwd({ ... } as never, p.cwd)` cast offends the typechecker, replace that call with the inline equivalent `m.cwd === p.cwd` **only after** adding a test proving the worktree case still collapses to one row — the cast exists precisely to keep the two surfaces using one predicate.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/sessions/session-view.ts \
        packages/server/server/sessions/session-view.test.ts
git commit -m "feat(sessions): one view of the fleet, managed and external"
```

---

### Task 4: `sessions-host.ts` — the poller

**Files:**
- Create: `packages/server/server/sessions/sessions-host.ts`
- Test: `packages/server/server/sessions/sessions-host.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3, `SessionBackend` from `./types`, `createLimiter` from `../utils`.
- Produces:
  - `const SESSION_POLL_MS: number`
  - `interface SessionSnapshot { sessions: SessionView[]; attention: number; rang: string[]; polledAtMs: number; unavailable?: string }`
  - `createSessionsPoller(o: { backend; readRegistry; scanProcesses; now?; captureLines? }): { poll(): Promise<SessionSnapshot> }`

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/sessions/sessions-host.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import type { HarnessProcess } from '../live-sessions'
import type { BackendSession, ManagedSession, SessionBackend } from './types'
import { createSessionsPoller } from './sessions-host'

const NOW = 1_786_600_000_000

const managed = (id: string, over: Partial<ManagedSession> = {}): ManagedSession => ({
  id, harness: 'claude', cwd: '/repo/a', createdAt: '2026-08-13T10:00:00.000Z', ...over,
})

const backendSession = (id: string, over: Partial<BackendSession> = {}): BackendSession => ({
  id, createdMs: NOW - 600_000, attached: false, alive: true, lastActivityMs: NOW - 600_000, ...over,
})

function fakeBackend(o: {
  sessions: BackendSession[]
  frames?: Record<string, string[]>
  unavailable?: string
  onCapture?: (id: string) => void
}): SessionBackend {
  return {
    id: 'tmux',
    async unavailable() { return o.unavailable },
    async spawn() {},
    async list() { return o.sessions },
    async capture(id) { o.onCapture?.(id); return o.frames?.[id] ?? [] },
    async kill() { return true },
    attachCommand(id) { return ['tmux', 'attach', id] },
    async detachHint() { return 'Ctrl-b then d' },
  }
}

const poller = (o: {
  backend: SessionBackend
  registry?: ManagedSession[]
  processes?: HarnessProcess[]
  now?: () => number
}) => createSessionsPoller({
  backend: o.backend,
  readRegistry: async () => o.registry ?? [],
  scanProcesses: async () => ({ procs: o.processes ?? [] }),
  now: o.now ?? (() => NOW),
})

describe('createSessionsPoller', () => {
  it('reports a quiet session as waiting and counts it', async () => {
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames: { a: ['❯ '] } }),
      registry: [managed('a')],
    })
    const snap = await p.poll()
    expect(snap.sessions[0]!.activity).toBe('waiting')
    expect(snap.attention).toBe(1)
  })

  it('reports a session working from its probed footer', async () => {
    const p = poller({
      backend: fakeBackend({
        sessions: [backendSession('a')],
        frames: { a: ['  ⏸ manual mode on · esc to interrupt · ← 6 agents'] },
      }),
      registry: [managed('a')],
    })
    expect((await p.poll()).sessions[0]!.activity).toBe('working')
    expect((await p.poll()).attention).toBe(0)
  })

  it('sees a frame that changed between two polls as working', async () => {
    const frames: Record<string, string[]> = { a: ['one'] }
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames }),
      registry: [managed('a')],
    })
    expect((await p.poll()).sessions[0]!.activity).toBe('waiting')
    frames.a = ['two']
    expect((await p.poll()).sessions[0]!.activity).toBe('working')
    // Third poll: unchanged again, so it settles back to waiting with no extra interval of lag.
    expect((await p.poll()).sessions[0]!.activity).toBe('waiting')
  })

  it('never captures a dead pane', async () => {
    const captured: string[] = []
    const p = poller({
      backend: fakeBackend({
        sessions: [backendSession('a', { alive: false })],
        onCapture: id => captured.push(id),
      }),
      registry: [managed('a')],
    })
    expect((await p.poll()).sessions[0]!.activity).toBe('exited')
    expect(captured).toEqual([])
  })

  it('rings once on the transition into waiting, not on every poll', async () => {
    const frames: Record<string, string[]> = { a: ['esc to interrupt'] }
    const p = poller({
      backend: fakeBackend({ sessions: [backendSession('a')], frames }),
      registry: [managed('a')],
    })
    expect((await p.poll()).rang).toEqual([])
    frames.a = ['done']
    expect((await p.poll()).rang).toEqual(['a'])
    expect((await p.poll()).rang).toEqual([])
  })

  it('reports the backend own reason instead of an empty list', async () => {
    const p = poller({ backend: fakeBackend({ sessions: [], unavailable: 'tmux is not installed' }) })
    const snap = await p.poll()
    expect(snap.unavailable).toBe('tmux is not installed')
    expect(snap.sessions).toEqual([])
  })

  it('keeps the previous snapshot when a poll throws, rather than reporting zero', async () => {
    let fail = false
    const backend = fakeBackend({ sessions: [backendSession('a')], frames: { a: ['x'] } })
    const broken: SessionBackend = { ...backend, async list() { if (fail) throw new Error('boom'); return [backendSession('a')] } }
    const p = poller({ backend: broken, registry: [managed('a')] })
    await p.poll()
    fail = true
    const snap = await p.poll()
    expect(snap.sessions).toHaveLength(1)
    expect(snap.unavailable).toContain('boom')
  })

  it('includes external processes the backend does not host', async () => {
    const p = poller({
      backend: fakeBackend({ sessions: [] }),
      processes: [{ harness: 'codex', cwd: '/repo/z', startedMs: NOW - 1000 }],
    })
    const snap = await p.poll()
    expect(snap.sessions).toHaveLength(1)
    expect(snap.sessions[0]!.status).toBe('external')
    expect(snap.attention).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test packages/server/server/sessions/sessions-host.test.ts`
Expected: FAIL — `Cannot find module './sessions-host'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/server/sessions/sessions-host.ts`:

```ts
/**
 * sessions-host.ts — the poller. The only impure module of the monitor: it reads the registry, asks
 * the backend what exists, captures a frame per live session, reads the host's processes, and hands
 * the pure functions everything they need.
 *
 * Bound to its dependencies at construction (the `createSessionRegistry(file)` pattern), so a test
 * exercises the real logic with no tmux server and no `/proc`.
 *
 * Two states it must never confuse, and the reason this file has a `unavailable` field at all:
 * "nothing is running" and "this machine cannot tell". An empty list rendered as a confident zero is
 * the same defect `liveEmptyNotice` exists to prevent on the dashboard.
 */

import { createLimiter } from '../utils'
import type { HarnessProcess } from '../live-sessions'
import { rulesFor } from './attention-rules'
import { attentionOf, digestFrame } from './attention'
import { reconcileSessions } from './session-ref'
import {
  attentionCount, bellTransitions, buildSessionViews, type SessionView,
} from './session-view'
import type { ManagedSession, SessionActivity, SessionBackend } from './types'

/** How often the cockpit refreshes. Five seconds is the interval the feature was specified at. */
export const SESSION_POLL_MS = Number(process.env.AGENTISTICS_SESSION_POLL_MS) > 0
  ? Number(process.env.AGENTISTICS_SESSION_POLL_MS)
  : 5_000

/** How much of the pane to read. Enough to hold a dialog and a footer, not the whole scrollback. */
const CAPTURE_LINES = 60

/** Frames are captured one per live session; four at a time keeps a large fleet from forking a
 *  process per session all at once. */
const CAPTURE_CONCURRENCY = 4

export interface SessionSnapshot {
  sessions: SessionView[]
  /** How many are waiting on a person. Drives the header counter. */
  attention: number
  /** Ids that JUST started waiting — the caller rings the bell for these. */
  rang: string[]
  polledAtMs: number
  /**
   * Why this list may not be the whole truth, already a sentence.
   *
   * Set when the backend cannot run here at all, or when a poll failed and the sessions above are
   * the PREVIOUS snapshot rather than a fresh one.
   */
  unavailable?: string
}

export interface SessionsPoller {
  poll(): Promise<SessionSnapshot>
}

export function createSessionsPoller(o: {
  backend: SessionBackend
  readRegistry: () => Promise<ManagedSession[]>
  scanProcesses: () => Promise<{ procs: HarnessProcess[] }>
  now?: () => number
  captureLines?: number
}): SessionsPoller {
  const now = o.now ?? (() => Date.now())
  const lines = o.captureLines ?? CAPTURE_LINES
  const limit = createLimiter(CAPTURE_CONCURRENCY)

  // Carried between polls: what each session's screen looked like, and what state it was in. The
  // first is how movement is detected; the second is what makes the bell a transition.
  let prevDigest = new Map<string, string>()
  let prevActivity = new Map<string, SessionActivity>()
  let last: SessionSnapshot | null = null

  async function poll(): Promise<SessionSnapshot> {
    const nowMs = now()

    const blocked = await o.backend.unavailable().catch(() => undefined)
    if (blocked) {
      // The backend cannot run here. That is a sentence, not an empty fleet.
      const snap: SessionSnapshot = { sessions: [], attention: 0, rang: [], polledAtMs: nowMs, unavailable: blocked }
      last = snap
      return snap
    }

    try {
      const [registry, backendSessions, processes] = await Promise.all([
        o.readRegistry(),
        o.backend.list(),
        o.scanProcesses().then(r => r.procs).catch(() => [] as HarnessProcess[]),
      ])

      const reconciled = reconcileSessions(registry, backendSessions)
      const harnessOf = new Map(registry.map(r => [r.id, r.harness]))

      const nextDigest = new Map<string, string>()
      const activity = new Map<string, SessionActivity>()

      await Promise.all(reconciled.map(r => limit(async () => {
        const b = r.backend
        if (!b) return // `lost`: the backend has nothing to capture and nothing to report.
        if (!b.alive) { activity.set(r.id, 'exited'); return }

        const frame = await o.backend.capture(r.id, lines).catch(() => [] as string[])
        const frameDigest = digestFrame(frame)
        nextDigest.set(r.id, frameDigest)

        const harness = harnessOf.get(r.id)
        activity.set(r.id, attentionOf({
          alive: true,
          lastActivityMs: b.lastActivityMs,
          nowMs,
          frame,
          frameDigest,
          ...(prevDigest.has(r.id) ? { prevDigest: prevDigest.get(r.id)! } : {}),
          ...(harness && rulesFor(harness) ? { rules: rulesFor(harness)! } : {}),
        }))
      })))

      const sessions = buildSessionViews({ reconciled, activity, processes })
      const rang = bellTransitions(prevActivity, sessions)

      prevDigest = nextDigest
      prevActivity = new Map(
        sessions.filter(s => s.activity).map(s => [s.id, s.activity!]),
      )

      const snap: SessionSnapshot = {
        sessions, attention: attentionCount(sessions), rang, polledAtMs: nowMs,
      }
      last = snap
      return snap
    } catch (e) {
      // A failed poll keeps the previous answer and SAYS the refresh failed. Returning an empty
      // list would report every running session as gone the moment tmux hiccups.
      const message = e instanceof Error ? e.message : String(e)
      return {
        sessions: last?.sessions ?? [],
        attention: last?.attention ?? 0,
        rang: [],
        polledAtMs: nowMs,
        unavailable: `could not refresh sessions: ${message}`,
      }
    }
  }

  return { poll }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test packages/server/server/sessions/sessions-host.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `bun test && bun tsc --noEmit`
Expected: all pass, no typecheck output.

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/sessions/sessions-host.ts \
        packages/server/server/sessions/sessions-host.test.ts
git commit -m "feat(sessions): poll the fleet for what each session is doing"
```

---

### Task 5: `agentop session list` shows what needs answering

This is what makes the phase shippable on its own: the monitor's answer is usable from the CLI before any TUI exists, which is also how the attention rules get exercised against real sessions.

**Files:**
- Modify: `packages/server/server/sessions/cli-session.ts` (the `list` function and its imports)
- Modify: `packages/server/server/sessions/index.ts` (re-export the poller)
- Modify: `docs/session-manager.md`

**Interfaces:**
- Consumes: `createSessionsPoller`, `SESSION_POLL_MS` from Task 4; `SessionView`, `needsAttention` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Replace the `list` function**

In `packages/server/server/sessions/cli-session.ts`, add to the imports at the top:

```ts
import { scanProcesses } from '../live-sessions'
import { createSessionsPoller } from './sessions-host'
import { needsAttention, type SessionView } from './session-view'
```

Then replace the whole `list` function (currently lines 125–135) with:

```ts
/** The word each state wears. `external` says outright that this row is not ours to drive. */
function stateWord(v: SessionView): string {
  if (v.status === 'external') return 'external'
  if (v.status === 'lost') return 'lost'
  switch (v.activity) {
    case 'waiting-approval': return 'NEEDS APPROVAL'
    case 'waiting': return 'waiting'
    case 'working': return 'working'
    case 'exited': return 'exited'
    default: return v.status
  }
}

async function list(backend: SessionBackend): Promise<number> {
  const poller = createSessionsPoller({
    backend,
    readRegistry,
    scanProcesses,
  })
  const snap = await poller.poll()

  if (snap.unavailable) console.error(snap.unavailable)
  if (snap.sessions.length === 0) {
    // Only claim "nothing is running" when the poll actually succeeded — an unavailable backend has
    // not established that, and saying so would be a confident zero.
    if (!snap.unavailable) console.log('No sessions.')
    return snap.unavailable ? 1 : 0
  }

  for (const v of snap.sessions) {
    const id = v.status === 'external' ? '-' : v.id
    // `?` rather than a guessed harness: an unregistered session's harness is genuinely unrecorded.
    console.log(`${id}\t${stateWord(v)}\t${v.harness ?? '?'}\t${v.label ?? ''}\t${v.cwd}`)
  }

  const waiting = snap.sessions.filter(v => needsAttention(v.activity))
  if (waiting.length > 0) {
    console.log(`\n${waiting.length} session(s) waiting on you: ${waiting.map(v => v.label ?? v.id).join(', ')}`)
  }

  // A harness with no probed rules cannot distinguish a permission prompt from an ordinary pause.
  // Saying so is the difference between a gap and a wrong answer.
  const blind = [...new Set(
    snap.sessions
      .filter(v => v.status !== 'external' && !v.approvalDetection)
      .map(v => v.harness)
      .filter((h): h is NonNullable<typeof h> => h !== undefined),
  )]
  if (blind.length > 0) {
    console.log(`Approval detection is not available for: ${blind.join(', ')} — those sessions show as "waiting" either way.`)
  }
  return 0
}
```

- [ ] **Step 2: Re-export from the module barrel**

Append to `packages/server/server/sessions/index.ts`:

```ts
export { SESSION_POLL_MS, createSessionsPoller, type SessionSnapshot } from './sessions-host'
export { needsAttention, type SessionGrouping, type SessionView } from './session-view'
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `bun tsc --noEmit && bun test`
Expected: no typecheck output; all tests pass.

- [ ] **Step 4: Verify against real sessions**

```bash
bun run packages/server/bin/cli.ts session claude --bg --name probe-a
bun run packages/server/bin/cli.ts session list
```

Expected: `probe-a` appears. Within a few seconds of starting it, it reads `NEEDS APPROVAL` (claude opens on its folder-trust dialog) — that single line is the end-to-end proof that the probed patterns match a real frame.

Then attach, answer the dialog, detach, and run `list` again:

```bash
bun run packages/server/bin/cli.ts session attach probe-a   # answer, then Ctrl-b d
bun run packages/server/bin/cli.ts session list
```

Expected: it now reads `waiting`. Send it a prompt and run `list` during the turn: it reads `working`.

Clean up: `bun run packages/server/bin/cli.ts session kill probe-a`

**If a state is wrong, the pattern is wrong — fix `attention-rules.ts` against the frame you actually captured (`tmux -L agentop capture-pane -p -t agentop-<id>`), and update its `probed` string. Do not adjust the pure logic to compensate.**

- [ ] **Step 5: Update the docs**

In `docs/session-manager.md`, add after the "Commands" section:

```markdown
## What a session is doing

`agentop session list` reports a state per session:

| State | Meaning |
|---|---|
| `working` | its screen moved since the last look, or a harness-specific "running" marker is on it |
| `waiting` | alive and still — it is waiting for you |
| `NEEDS APPROVAL` | a blocking question is on screen |
| `exited` | the command finished; the session is still listable and its last frame readable |
| `lost` | the registry knows it, the backend does not |
| `external` | an assistant running on this machine that agentop did not start — listed, but not attachable |

Approval detection needs screen markers captured from the real CLI, so it exists only for the
harnesses that were probed (claude, codex, kimi). For any other harness a blocking question shows as
`waiting` — still counted and still surfaced, but the reason cannot be named. `list` says so.
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/sessions/cli-session.ts \
        packages/server/server/sessions/index.ts \
        docs/session-manager.md
git commit -m "feat(sessions): session list reports what each session is doing"
```

---

## Done when

- `bun test` passes with roughly 45 new assertions across four new test files.
- `bun tsc --noEmit` is clean.
- `agentop session list` reports `NEEDS APPROVAL` for a freshly started `claude` session, `waiting`
  once its dialog is answered, and `working` during a turn — verified by hand, not inferred.
- `docs/session-manager.md` describes the states and names the harnesses approval detection covers.

## Next plans (not this one)

- **Phase 3** — the cockpit `sessions` tab (read-only), the header counter and the bell.
- **Phase 4** — cockpit actions: attach via the new `ControlExit`, kill, rename, note.
- **Phase 5** — the spawn wizard and `project-search.ts`.
- **Phase 6** — `backend-pty.ts` for Windows.
- **Phase 7** — `SpawnSpec`s for the remaining harnesses; labels reaching the dashboard.
