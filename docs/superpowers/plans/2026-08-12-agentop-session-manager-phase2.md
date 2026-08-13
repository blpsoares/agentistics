# agentop Session Manager — Phase 2+3 Implementation Plan (the Sessions tab)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every session operation reachable from the `agentop` control center — a Sessions tab
that lists the fleet, says which sessions are waiting on you, and lets you attach, create, rename,
annotate and kill without leaving the TUI.

**Architecture:** Two new PURE modules (`attention.ts` classifies a quiet session from its last
frame; `monitor.ts` merges managed sessions, external processes and attention into one
`SessionView[]`), a `ControlHost` extension so the TUI still owns no logic, and one new Ink screen
built from the same primitives as `Services.tsx` (`Pane`, `cockpitLayout`, `nav.ts` reducers).

**Tech Stack:** Bun, TypeScript (strict), Ink (React for CLIs), `bun test`, tmux.

Source spec: `docs/superpowers/specs/2026-08-12-agentop-session-manager-design.md`.
Phase 1 (backend, registry, CLI) is on `dev` — see
`docs/superpowers/plans/2026-08-12-agentop-session-manager-phase1.md`.
This plan covers **Phase 2 and Phase 3 together**, because "the Sessions tab exists but cannot
create a session" is not a shippable state.

## Global Constraints

- **Everything in English** — code, comments, commit messages, docs (project CLAUDE.md).
- **Conventional Commits.**
- **Strict TypeScript.** The pre-commit hook runs `bun tsc --noEmit` **and** `bun test`.
- **The control center owns NO logic.** `cli-start.ts` decides and performs behind `ControlHost`,
  returning already-localized `ActionResult`s; the Ink layer renders and reports intents. Every new
  behaviour goes on the host, not in the component.
- **The TUI does not read preferences.** Language and settings arrive from the host.
- **Nothing may print while the alternate buffer is live.** Host actions run under `captureOutput`,
  `streamOutput` or `suspend` — attach is a `suspend` case, and Ink must be unmounted before the
  terminal is handed over.
- **A screen that overflows its `height` is composited, not clipped.** Budget against the `height`
  prop, keep `flexShrink={0}` on the screen root, `overflowY="hidden"` as the backstop. Never
  `Math.max(1, height - chrome)` — give up a piece instead.
- **A list that can outgrow its pane must scroll with `windowOffset`.** Slicing from zero leaves the
  cursor below the fold, still the thing `enter` acts on.
- **The footer must describe the keys that work in the CURRENT focus.** A hint for a key that does
  nothing is a bug, not a cosmetic issue.
- **Screens change with `←`/`→` and nothing else.** Digits belong to whatever list draws them.
- **Capability honesty (the N/A-versus-a-confident-0 rule).** An external session has no PTY, so it
  gets NO attention state. A frame that matched no rule is `idle-unknown`, said in those words. A
  capture that FAILED is not the same as a blank pane and must not be reported as one.
- **Verify TUI work against the COMPILED BINARY**, not just `bun run` — `stubs/react-devtools-core`
  problems are invisible under `bun run` and only appear at compile time.
- **Never hardcode a harness list as an array.** `Record<HarnessId, …>` so the compiler catches a
  missing entry.
- **Never guess a screen pattern.** Every `AttentionRules` entry must come from a frame captured
  from a real running session and committed as a fixture.

## What already exists (Phase 1, on `dev`)

```
packages/server/server/sessions/
  types.ts        SessionBackend, BackendSession, ManagedSession, SpawnSpec, SpawnRequest…
  spawn-spec.ts   PURE  SPAWN_SPECS: Record<HarnessId, SpawnSpec|null>, planSpawn()
  session-ref.ts  PURE  resolveSessionRef(), reconcileSessions() -> ReconciledSession[]
  registry.ts     createSessionRegistry(file) + readRegistry/addSession/removeSession/patchSession
  tmux-cli.ts     PURE  every tmux argv and parse
  backend-tmux.ts IO    the tmux SessionBackend
  index.ts        resolveBackend()
  cli-parse.ts    PURE  argv -> SessionCommand
  cli-session.ts  IO    the `agentop session …` handlers
```

`live-sessions.ts` already provides `harnessProcesses(): Promise<HarnessProcess[]>` and
`scanProcesses()` with a `LiveUnavailableReason` — that is where EXTERNAL sessions come from, and it
already knows when detection is structurally impossible (not Linux, no `/proc`, a container that
cannot see the host). Do not write a second process scanner.

## Verified facts this plan relies on

Captured from real sessions on 2026-08-12. **A task that contradicts one of these is wrong**, and
the two gaps are called out as gaps rather than filled with a guess.

| Fact | Evidence |
|---|---|
| A `claude` **approval** frame ends with `Enter to confirm · Esc to cancel` and shows numbered options marked `❯` | captured from the workspace-trust dialog: `❯ 1. Yes, I trust this folder` / `  2. No, exit` / `Enter to confirm · Esc to cancel` |
| A `claude` **idle** frame shows an empty input box — a line whose only content is `❯` — between two horizontal rules, above a status bar containing `? for shortcuts` | captured: `❯` alone on its line, then `⏸ manual mode on · ? for shortcuts · ← 5 agents` |
| Both states contain `❯`, so `❯` alone CANNOT discriminate them | same two captures |
| tmux `session_activity` (epoch seconds) is the quiescence signal and is already parsed into `BackendSession.lastActivityMs` | `tmux-cli.ts` `LIST_FORMAT` / `parseTmuxList`, Phase 1 |
| The control center already polls on a timer, gated on `isActive` with an `alive` guard | `Logs.tsx` `POLL_MS = 1000`, its `useEffect` |
| `cockpitLayout(width, height, content, opts)` returns `{ kind, leftWidth, rightWidth, heights: { services, config, detail } }` | `chrome.ts` |
| Tab labels are `Record<TabId, string>` in both `tabs` and `tabsShort`, so adding to `TabId` makes the compiler demand EN and PT | `i18n.ts` |
| `ScreenChrome` is `{ capture: boolean; claimArrows?: boolean; hints: string[] }` and `←`/`→` only change tabs when arrows are NOT claimed | `ControlCenter.tsx` |
| Components under `control/tabs/` have no unit tests; every behaviour that matters is a pure function in `chrome.ts`/`nav.ts`/`surface.ts`, and THOSE are tested | `packages/tui/src/control/` has no `Services.test.tsx` |

### The two gaps — do not fill them with a guess

1. **The `claude` tool-permission prompt was NOT captured.** The recon session ran its tool without
   asking. The trust dialog above is an approval prompt but may not share wording with a permission
   prompt. **Task 2 must capture a real one** before writing the claude rule.
2. **No `codex` or `kimi` frames were captured at all.** Task 2 must capture idle and approval
   frames from each before writing their rules. A harness whose frames could not be captured gets
   **no rules** and therefore reports `idle-unknown` — which is honest — rather than a guessed
   pattern that fails silently on the next release.

---

### Task 1: Give `capture()` an error channel (the Phase 2 blocker)

The spec requires a failed capture to be stated in words and never to become `idle-unknown` in
silence. `SessionBackend.capture` currently returns `string[]`, so a failed capture and a blank pane
are the same value. Every later task depends on this distinction.

**Files:**
- Modify: `packages/server/server/sessions/types.ts` (the `SessionBackend.capture` signature)
- Modify: `packages/server/server/sessions/backend-tmux.ts` (`capture`)
- Test: `packages/server/server/sessions/tmux-cli.test.ts` (extend)

**Interfaces:**
- Produces: `CaptureResult = { ok: true; lines: string[] } | { ok: false; reason: CaptureFailure }`
  where `CaptureFailure = 'no-session' | 'backend-error'`, and
  `SessionBackend.capture(id, lines): Promise<CaptureResult>`.

- [ ] **Step 1: Write the failing test**

Add to `packages/server/server/sessions/tmux-cli.test.ts`:

```ts
import { captureFailureFor } from './tmux-cli'

describe('captureFailureFor', () => {
  it("reads tmux's own words for a session that is not there", () => {
    expect(captureFailureFor("can't find session: agentop-a1")).toBe('no-session')
    expect(captureFailureFor('no server running on /tmp/tmux-1000/agentop')).toBe('no-session')
  })

  it('calls anything else a backend error rather than guessing it away', () => {
    expect(captureFailureFor('some tmux failure nobody has seen')).toBe('backend-error')
    expect(captureFailureFor('')).toBe('backend-error')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/sessions/tmux-cli.test.ts`
Expected: FAIL — `captureFailureFor` is not exported.

- [ ] **Step 3: Add the pure classifier to `tmux-cli.ts`**

`tmux-cli.ts` already has `isSessionGoneError` (added by Phase 1's final fix) which matches tmux's
"gone" wordings. Read it and reuse it — do not write a second matcher.

```ts
/**
 * Why a capture produced nothing.
 *
 * A capture that FAILED and a pane that is genuinely blank are different facts, and the attention
 * monitor must not conflate them: a blank pane can be classified, an unreadable one can only be
 * reported. This is the same N/A-versus-a-confident-0 rule the dashboard applies to harness
 * capabilities.
 */
export function captureFailureFor(stderr: string): 'no-session' | 'backend-error' {
  return isSessionGoneError(stderr) ? 'no-session' : 'backend-error'
}
```

- [ ] **Step 4: Widen the type in `types.ts`**

```ts
export type CaptureFailure = 'no-session' | 'backend-error'

export type CaptureResult =
  | { ok: true; lines: string[] }
  | { ok: false; reason: CaptureFailure }
```

and change the interface member, keeping the doc comment's intent:

```ts
  /**
   * Newest-last lines of the last rendered frame, trailing blanks removed.
   *
   * A RESULT rather than a bare array: a failed capture and a blank pane are different facts, and
   * the attention monitor may not treat "could not read" as "nothing is happening".
   */
  capture(id: string, lines: number): Promise<CaptureResult>
```

- [ ] **Step 5: Implement it in `backend-tmux.ts`**

The existing `tmux()` helper already captures stderr (Phase 1's fix widened it). Use it:

```ts
  async capture(id: string, lines: number): Promise<CaptureResult> {
    const { code, out, err } = await tmux(capturePaneArgs(id, lines))
    if (code !== 0) return { ok: false, reason: captureFailureFor(err) }
    return { ok: true, lines: trimCapture(out.split('\n')) }
  },
```

If `tmux()` does not currently return `err`, add it — read the helper first and follow its shape.

- [ ] **Step 6: Fix every caller**

Run `bun tsc --noEmit` and fix what it names. `capture` has no callers outside the backend in
Phase 1, so this should be zero or near-zero work — but check rather than assume.

- [ ] **Step 7: Run the tests**

Run: `bun test packages/server/server/sessions/ && bun tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/server/sessions/types.ts packages/server/server/sessions/backend-tmux.ts packages/server/server/sessions/tmux-cli.ts packages/server/server/sessions/tmux-cli.test.ts
git commit -m "fix(sessions): give capture() an error channel so a failed read is not a blank pane"
```

---

### Task 2: Capture real frames and write the attention classifier

**This task's hardest requirement is evidence, not code.** Every rule must come from a frame
captured from a real running session and committed as a fixture. A harness whose frames you cannot
capture gets NO rules and therefore always reports `idle-unknown` — honest, and correctable later.

**Files:**
- Create: `packages/server/server/sessions/attention.ts` (PURE)
- Create: `packages/server/server/sessions/fixtures/` — one `.txt` per captured frame
- Test: `packages/server/server/sessions/attention.test.ts`

**Interfaces:**
- Consumes: `HarnessId`, `CaptureResult` (Task 1).
- Produces: `SessionState`, `ATTENTION_RULES: Record<HarnessId, AttentionRules | null>`,
  `classifyAttention(input): SessionState`.

- [ ] **Step 1: Capture the frames**

For **claude**, **codex** and **kimi**, in turn:

```bash
tmux -L agentop-fixtures new-session -d -s probe -c /home/mithrandir/agentistics -- <harness>
sleep 15
tmux -L agentop-fixtures capture-pane -p -t probe -S -40 > packages/server/server/sessions/fixtures/<harness>-idle.txt
```

Then drive each one into an approval prompt — the cheapest reliable way is a prompt that makes it
run a shell command while the harness is in its ask-first mode (`claude` shows `⏸ manual mode on` in
its status bar; use `/permissions` or start it without `--dangerously-skip-permissions`). Capture
that frame as `<harness>-approval.txt`.

Kill the fixtures server when done: `tmux -L agentop-fixtures kill-server`.

**Record honestly in your report, per harness:** which frames you captured, and for any you could
not, exactly what you tried. A harness with no approval fixture MUST get `null` rules rather than a
pattern inferred from another harness.

Known good, already captured (re-capture to confirm, do not trust this table alone):
- claude idle: a line whose only content is `❯`, and a status bar containing `? for shortcuts`
- claude approval (workspace trust): `Enter to confirm · Esc to cancel`, options marked `❯ 1.` / `2.`
- **both contain `❯`** — so `❯` alone cannot discriminate, and any rule that relies on it is wrong

- [ ] **Step 2: Write the failing test**

Create `packages/server/server/sessions/attention.test.ts`. Load the fixtures from disk with
`readFileSync` — the fixtures ARE the test data, and inlining them would let the file and the test
drift apart:

```ts
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ATTENTION_RULES, classifyAttention } from './attention'
import { HARNESS_ORDER } from '@agentistics/core'

const frame = (name: string): string[] =>
  readFileSync(join(import.meta.dir, 'fixtures', `${name}.txt`), 'utf-8').split('\n')

const QUIET_NOW = 100_000
const quiet = { nowMs: QUIET_NOW, lastActivityMs: QUIET_NOW - 30_000 }
const busy = { nowMs: QUIET_NOW, lastActivityMs: QUIET_NOW - 500 }

describe('ATTENTION_RULES', () => {
  it('has an entry for every harness', () => {
    for (const id of HARNESS_ORDER) expect(ATTENTION_RULES).toHaveProperty(id)
  })
})

describe('classifyAttention', () => {
  it('calls a session that wrote bytes just now working, without consulting any pattern', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...busy,
      capture: { ok: true, lines: frame('claude-idle') },
    })).toBe('working')
  })

  it('recognises a claude approval prompt', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...quiet,
      capture: { ok: true, lines: frame('claude-approval') },
    })).toBe('waiting-approval')
  })

  it('recognises a claude idle prompt', () => {
    expect(classifyAttention({
      harness: 'claude', alive: true, ...quiet,
      capture: { ok: true, lines: frame('claude-idle') },
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
      capture: { ok: true, lines: frame('claude-approval') },
    })).toBe('idle-unknown')
  })

  it('reports a dead pane as exited regardless of what the frame says', () => {
    expect(classifyAttention({
      harness: 'claude', alive: false, ...quiet,
      capture: { ok: true, lines: frame('claude-approval') },
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
```

The last two encode the design point: quiescence is decided from tmux's own activity clock, which is
still trustworthy when the frame is not — so a busy session stays `working`, and only a QUIET one
with an unreadable frame becomes `unreadable`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/server/server/sessions/attention.test.ts`
Expected: FAIL — `Cannot find module './attention'`.

- [ ] **Step 4: Write `attention.ts`**

```ts
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
  /** Any match means the harness is asking for a decision. Checked FIRST. */
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
  // FILL FROM THE FIXTURES YOU CAPTURED IN STEP 1. Each entry needs a comment naming the fixture
  // it came from. A harness whose frames you could not capture stays null.
  claude: null,
  codex: null,
  kimi: null,
  gemini: null,
  copilot: null,
  antigravity: null,
}

/** Does any rule match anywhere in the frame? Joined, so a rule may span the whole screen. */
function matches(rules: RegExp[], frame: string): boolean {
  return rules.some(r => r.test(frame))
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

  const frame = input.capture.lines.join('\n')
  if (matches(rules.approval, frame)) return 'waiting-approval'
  if (matches(rules.input, frame)) return 'waiting-input'
  return 'idle-unknown'
}

/** Does this state mean the user is being waited on? Drives the counter, the BEL and the sort. */
export function needsAttention(state: SessionState): boolean {
  return state === 'waiting-approval' || state === 'waiting-input'
}
```

**Approval is checked before input on purpose:** a `claude` approval frame contains `❯` and so does
its idle frame, so a rule set that tested "input" first would call every approval prompt an idle
one — the single most damaging error this module can make, because it is the reassuring direction.

- [ ] **Step 5: Fill the rules from your fixtures and make the tests pass**

Run: `bun test packages/server/server/sessions/attention.test.ts`
Expected: PASS. If a fixture you captured does not match the rule you wrote, the rule is wrong —
fix the rule, never the fixture.

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/sessions/attention.ts packages/server/server/sessions/attention.test.ts packages/server/server/sessions/fixtures/
git commit -m "feat(sessions): attention classifier with real captured frames as fixtures"
```

---

### Task 3: The monitor — one list of the whole fleet

**Files:**
- Create: `packages/server/server/sessions/monitor.ts` (PURE)
- Test: `packages/server/server/sessions/monitor.test.ts`

**Interfaces:**
- Consumes: `ReconciledSession` (`session-ref.ts`), `HarnessProcess` (`live-sessions.ts`),
  `SessionState` / `classifyAttention` (Task 2), `CaptureResult` (Task 1).
- Produces: `SessionView`, `buildSessionViews(input): SessionView[]`,
  `attentionCount(views): number`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/sessions/monitor.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { attentionCount, buildSessionViews } from './monitor'
import type { ManagedSession, BackendSession } from './types'
import type { HarnessProcess } from '../live-sessions'

const NOW = 1_000_000

const managed = (id: string, label?: string): ManagedSession => ({
  id, harness: 'claude', cwd: '/repo', createdAt: '2026-08-12T10:00:00.000Z',
  ...(label ? { label } : {}),
})
const backend = (id: string, alive = true, quietMs = 30_000): BackendSession => ({
  id, createdMs: NOW - 600_000, attached: false, alive, lastActivityMs: NOW - quietMs,
})

describe('buildSessionViews', () => {
  it('pairs a managed session with its frame and classifies it', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1', 'refactor'), backend: backend('a1'), status: 'running' }],
      captures: { a1: { ok: true, lines: ['❯', '? for shortcuts'] } },
      processes: [],
    })
    expect(views).toHaveLength(1)
    expect(views[0]!.id).toBe('a1')
    expect(views[0]!.label).toBe('refactor')
    expect(views[0]!.managed).toBe(true)
    expect(views[0]!.state).toBe('waiting-input')
  })

  it('lists an external process with NO attention state', () => {
    const procs: HarnessProcess[] = [{ harness: 'codex', cwd: '/other', startedMs: NOW - 60_000 }]
    const views = buildSessionViews({ nowMs: NOW, reconciled: [], captures: {}, processes: procs })
    expect(views).toHaveLength(1)
    expect(views[0]!.managed).toBe(false)
    expect(views[0]!.state).toBe('external')
    expect(views[0]!.attachable).toBe(false)
  })

  it('does not list a process that is one of our own managed sessions twice', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1'), backend: backend('a1'), status: 'running' }],
      captures: {},
      // the tmux-hosted claude appears in /proc too, in the SAME directory
      processes: [{ harness: 'claude', cwd: '/repo', startedMs: NOW - 600_000 }],
    })
    expect(views).toHaveLength(1)
    expect(views[0]!.managed).toBe(true)
  })

  it('sorts the ones waiting on the user to the top', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [
        { id: 'busy', managed: managed('busy'), backend: backend('busy', true, 100), status: 'running' },
        { id: 'ask', managed: managed('ask'), backend: backend('ask'), status: 'running' },
      ],
      captures: { ask: { ok: true, lines: ['Enter to confirm · Esc to cancel'] } },
      processes: [],
    })
    expect(views.map(v => v.id)).toEqual(['ask', 'busy'])
  })

  it('marks a session whose frame could not be read as unreadable, never as idle', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1'), backend: backend('a1'), status: 'running' }],
      captures: { a1: { ok: false, reason: 'backend-error' } },
      processes: [],
    })
    expect(views[0]!.state).toBe('unreadable')
  })

  it('keeps an exited session visible and not attachable', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1'), backend: backend('a1', false), status: 'exited' }],
      captures: {},
      processes: [],
    })
    expect(views[0]!.state).toBe('exited')
    expect(views[0]!.attachable).toBe(false)
    expect(views[0]!.killable).toBe(true)
  })

  it('keeps a lost session visible, killable and not attachable', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1'), status: 'lost' }],
      captures: {},
      processes: [],
    })
    expect(views[0]!.state).toBe('exited')
    expect(views[0]!.attachable).toBe(false)
  })
})

describe('attentionCount', () => {
  it('counts only the ones waiting on the user', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [
        { id: 'ask', managed: managed('ask'), backend: backend('ask'), status: 'running' },
        { id: 'busy', managed: managed('busy'), backend: backend('busy', true, 100), status: 'running' },
      ],
      captures: { ask: { ok: true, lines: ['Enter to confirm · Esc to cancel'] } },
      processes: [],
    })
    expect(attentionCount(views)).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/sessions/monitor.test.ts`
Expected: FAIL — `Cannot find module './monitor'`.

- [ ] **Step 3: Write `monitor.ts`**

```ts
/**
 * monitor.ts — PURE. The whole fleet as one list.
 *
 * Two populations, deliberately in one place: the sessions agentop hosts, and the assistants the
 * user started by hand in some other terminal. Showing only the first restates the problem this
 * feature exists to solve — open a `claude` yourself and it vanishes from the cockpit.
 *
 * They are NOT equal, and the row says so. An external process has no PTY we can read, so it has
 * no attention state (`external`, never `idle-unknown` — we did not look and could not have) and
 * is not attachable. Claiming otherwise would be the confident-zero the dashboard forbids.
 *
 * The double-count trap is the same one `resolveLiveSnapshot` documents: a tmux-hosted `claude` IS
 * a process in `/proc`, so it appears in BOTH inputs. Matching is by harness AND directory, and a
 * process accounted for by a managed session is dropped rather than listed again.
 */

import type { HarnessId } from '@agentistics/core'
import type { HarnessProcess } from '../live-sessions'
import type { ReconciledSession } from './session-ref'
import type { CaptureResult } from './types'
import { classifyAttention, needsAttention, type SessionState } from './attention'

export interface SessionView {
  id: string
  harness: HarnessId
  cwd: string
  /** The user's label, or '' when they never gave one. */
  label: string
  note: string
  state: SessionState
  /** True for a session agentop hosts; false for one found in /proc. */
  managed: boolean
  attached: boolean
  createdMs?: number
  lastActivityMs?: number
  attachable: boolean
  killable: boolean
  /** Set for an external row so the UI can say WHY it offers nothing. */
  externalReason?: 'not-hosted-by-agentop'
}

export interface MonitorInput {
  nowMs: number
  reconciled: ReconciledSession[]
  /** Last frame per session id. A session with no entry simply was not captured this tick. */
  captures: Record<string, CaptureResult>
  processes: HarnessProcess[]
}

/** Rank for the sort: what is waiting on the user first, then what is running, then the rest. */
function rank(v: SessionView): number {
  if (v.state === 'waiting-approval') return 0
  if (v.state === 'waiting-input') return 1
  if (v.state === 'working') return 2
  if (v.state === 'idle-unknown' || v.state === 'unreadable') return 3
  if (v.state === 'external') return 4
  return 5 // exited
}

export function buildSessionViews(input: MonitorInput): SessionView[] {
  const views: SessionView[] = []

  for (const r of input.reconciled) {
    const harness = r.managed?.harness ?? 'claude'
    const alive = r.status === 'running'
    const capture = input.captures[r.id] ?? { ok: true as const, lines: [] }
    // `lost` and `exited` are both "the command is not running"; neither is attachable, and both
    // stay visible so the user can clear them.
    const state: SessionState = r.status === 'running'
      ? classifyAttention({
          harness,
          alive,
          nowMs: input.nowMs,
          lastActivityMs: r.backend?.lastActivityMs ?? 0,
          capture,
        })
      : 'exited'
    views.push({
      id: r.id,
      harness,
      cwd: r.managed?.cwd ?? '',
      label: r.managed?.label ?? '',
      note: r.managed?.note ?? '',
      state,
      managed: true,
      attached: r.backend?.attached ?? false,
      ...(r.backend?.createdMs !== undefined ? { createdMs: r.backend.createdMs } : {}),
      ...(r.backend?.lastActivityMs !== undefined ? { lastActivityMs: r.backend.lastActivityMs } : {}),
      attachable: r.status === 'running',
      killable: true,
    })
  }

  // A managed session's own process is in /proc as well. Account for it by harness AND directory,
  // and only once per managed row, so three panels in one project cannot be covered by one session.
  const claimed = new Set<string>()
  for (const p of input.processes) {
    const covered = views.find(v =>
      v.managed && !claimed.has(v.id) && v.harness === p.harness && v.cwd === p.cwd)
    if (covered) { claimed.add(covered.id); continue }
    views.push({
      id: `ext:${p.harness}:${p.cwd}:${p.startedMs ?? 0}`,
      harness: p.harness,
      cwd: p.cwd,
      label: '',
      note: '',
      state: 'external',
      managed: false,
      attached: false,
      ...(p.startedMs !== undefined ? { createdMs: p.startedMs } : {}),
      attachable: false,
      killable: false,
      externalReason: 'not-hosted-by-agentop',
    })
  }

  return views.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
}

export function attentionCount(views: SessionView[]): number {
  return views.filter(v => needsAttention(v.state)).length
}
```

- [ ] **Step 4: Make the tests pass**

Run: `bun test packages/server/server/sessions/monitor.test.ts`
Expected: PASS, 8 tests.

Note the `waiting-input` test uses the literal frame `['❯', '? for shortcuts']` and the approval
test uses `['Enter to confirm · Esc to cancel']` — these must match the rules you wrote in Task 2.
If they do not, reconcile with the FIXTURES, not by loosening the rule.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/sessions/monitor.ts packages/server/server/sessions/monitor.test.ts
git commit -m "feat(sessions): fleet monitor merging managed and external sessions"
```

---

### Task 4: Project and repository search

**Files:**
- Create: `packages/server/server/sessions/project-search.ts` (PURE)
- Test: `packages/server/server/sessions/project-search.test.ts`

**Interfaces:**
- Consumes: `normalizeGitRemote`, `repoShortName` from `@agentistics/core`.
- Produces: `ProjectChoice`, `searchProjects(choices, query, limit): ProjectChoice[]`,
  `buildProjectChoices(sessions): ProjectChoice[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/sessions/project-search.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { buildProjectChoices, searchProjects } from './project-search'
import type { SessionMeta } from '@agentistics/core'

const meta = (path: string, remote: string, when: string): SessionMeta => ({
  session_id: `${path}-${when}`,
  project_path: path,
  git_remote: remote,
  start_time: when,
} as SessionMeta)

describe('buildProjectChoices', () => {
  it('makes one choice per directory, newest activity first', () => {
    const choices = buildProjectChoices([
      meta('/home/u/old', '', '2026-01-01T00:00:00.000Z'),
      meta('/home/u/new', '', '2026-08-01T00:00:00.000Z'),
    ])
    expect(choices.map(c => c.path)).toEqual(['/home/u/new', '/home/u/old'])
  })

  it('collapses repeat visits to one choice', () => {
    const choices = buildProjectChoices([
      meta('/home/u/p', '', '2026-01-01T00:00:00.000Z'),
      meta('/home/u/p', '', '2026-08-01T00:00:00.000Z'),
    ])
    expect(choices).toHaveLength(1)
    expect(choices[0]!.lastActiveMs).toBe(Date.parse('2026-08-01T00:00:00.000Z'))
  })

  it('carries the repository short name when the session had a remote', () => {
    const choices = buildProjectChoices([
      meta('/home/u/p', 'git@github.com:org/repo.git', '2026-08-01T00:00:00.000Z'),
    ])
    expect(choices[0]!.repo).toBe('org/repo')
  })

  it('leaves repo empty rather than inventing one', () => {
    expect(buildProjectChoices([meta('/home/u/p', '', '2026-08-01T00:00:00.000Z')])[0]!.repo).toBe('')
  })
})

describe('searchProjects', () => {
  const choices = buildProjectChoices([
    meta('/home/u/agentistics', 'git@github.com:blpsoares/agentistics.git', '2026-08-01T00:00:00.000Z'),
    meta('/home/u/prontuario', '', '2026-07-01T00:00:00.000Z'),
    meta('/srv/embark', 'https://github.com/opvibes/embark', '2026-06-01T00:00:00.000Z'),
  ])

  it('returns everything, newest first, for an empty query', () => {
    expect(searchProjects(choices, '', 10).map(c => c.path))
      .toEqual(['/home/u/agentistics', '/home/u/prontuario', '/srv/embark'])
  })

  it('matches on the directory name', () => {
    expect(searchProjects(choices, 'pront', 10).map(c => c.path)).toEqual(['/home/u/prontuario'])
  })

  it('matches on the repository name too', () => {
    expect(searchProjects(choices, 'opvibes', 10).map(c => c.path)).toEqual(['/srv/embark'])
  })

  it('is case-insensitive', () => {
    expect(searchProjects(choices, 'AGENTIS', 10)).toHaveLength(1)
  })

  it('ranks a basename hit above a mid-path hit', () => {
    const both = buildProjectChoices([
      meta('/home/embark/other', '', '2026-01-01T00:00:00.000Z'),
      meta('/srv/embark', '', '2026-01-01T00:00:00.000Z'),
    ])
    expect(searchProjects(both, 'embark', 10)[0]!.path).toBe('/srv/embark')
  })

  it('honours the limit', () => {
    expect(searchProjects(choices, '', 2)).toHaveLength(2)
  })

  it('returns nothing rather than everything when nothing matches', () => {
    expect(searchProjects(choices, 'zzzzz', 10)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/sessions/project-search.test.ts`
Expected: FAIL — `Cannot find module './project-search'`.

- [ ] **Step 3: Write `project-search.ts`**

```ts
/**
 * project-search.ts — PURE. Where a new session should start.
 *
 * Built from the sessions this machine has already recorded, because that list is both instant and
 * already ranked by what the user actually works on. A directory the machine has never seen is
 * handled by the caller accepting a typed path — this module answers "what have I used", not
 * "what exists on disk", and a filesystem crawl would be slower and noisier for the same answer.
 *
 * Repositories are keyed by `normalizeGitRemote`, the only legal repo key in this codebase.
 */

import { normalizeGitRemote, repoShortName, type SessionMeta } from '@agentistics/core'

export interface ProjectChoice {
  path: string
  /** `org/repo`, or '' when the directory has no recorded remote. Never invented. */
  repo: string
  lastActiveMs: number
  sessions: number
}

export function buildProjectChoices(sessions: SessionMeta[]): ProjectChoice[] {
  const byPath = new Map<string, ProjectChoice>()
  for (const s of sessions) {
    const path = s.project_path
    if (!path) continue
    const when = Date.parse(s.start_time ?? '')
    const at = Number.isNaN(when) ? 0 : when
    const remote = normalizeGitRemote(s.git_remote ?? '')
    const found = byPath.get(path)
    if (!found) {
      byPath.set(path, { path, repo: remote ? repoShortName(remote) : '', lastActiveMs: at, sessions: 1 })
      continue
    }
    found.sessions++
    if (at > found.lastActiveMs) found.lastActiveMs = at
    // A remote learned on any visit describes the directory, so keep the first one we see rather
    // than letting a later remote-less session erase it.
    if (!found.repo && remote) found.repo = repoShortName(remote)
  }
  return [...byPath.values()].sort((a, b) => b.lastActiveMs - a.lastActiveMs)
}

/** Where the query hit, lower is better. `null` when it did not hit at all. */
function score(choice: ProjectChoice, needle: string): number | null {
  const base = choice.path.slice(choice.path.lastIndexOf('/') + 1).toLowerCase()
  if (base.startsWith(needle)) return 0
  if (base.includes(needle)) return 1
  if (choice.repo.toLowerCase().includes(needle)) return 2
  if (choice.path.toLowerCase().includes(needle)) return 3
  return null
}

export function searchProjects(choices: ProjectChoice[], query: string, limit: number): ProjectChoice[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return choices.slice(0, limit)
  const hits: Array<{ choice: ProjectChoice; score: number }> = []
  for (const choice of choices) {
    const s = score(choice, needle)
    if (s !== null) hits.push({ choice, score: s })
  }
  // Recency breaks a scoring tie: the already-sorted input makes that stable without a second key.
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map(h => h.choice)
}
```

- [ ] **Step 4: Make the tests pass**

Run: `bun test packages/server/server/sessions/project-search.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/sessions/project-search.ts packages/server/server/sessions/project-search.test.ts
git commit -m "feat(sessions): project and repository search for the session wizard"
```

---

### Task 5: Extend `ControlHost` with the session verbs

The TUI owns no logic. Everything the Sessions tab does goes through the host.

**Files:**
- Modify: `packages/tui/src/control/types.ts` (the `ControlHost` interface + new types)
- Modify: `packages/server/server/cli-start.ts` (implement them)
- Modify: `packages/server/server/cli-i18n.ts` (host-produced strings)
- Test: `packages/server/server/cli-start.test.ts` (extend)

**Interfaces:**
- Produces, on `ControlHost`:
  - `sessions(): Promise<SessionSnapshot>` — `{ views: SessionView[]; unavailable?: string }`
  - `startSession(req: NewSessionRequest): Promise<ActionResult & { id?: string }>`
  - `killSession(id: string): Promise<ActionResult>`
  - `renameSession(id: string, label: string): Promise<ActionResult>`
  - `noteSession(id: string, note: string): Promise<ActionResult>`
  - `attachCommand(id: string): Promise<string[] | null>` — the argv, or `null` when not attachable
  - `detachHint(): Promise<string>`
  - `projectChoices(query: string, limit: number): Promise<ProjectChoice[]>`
  - `sessionHarnesses(): Promise<HarnessChoice[]>` — `{ id, label, models, efforts }`, DERIVED from
    `SPAWN_SPECS` so a harness that cannot start is simply absent

- [ ] **Step 1: Declare the contract in `packages/tui/src/control/types.ts`**

Add the types and the interface members. `SessionView` and `ProjectChoice` are **structurally
re-declared here** rather than imported: `packages/tui` must not import from
`packages/server/server/*`, which is the dependency direction CLAUDE.md fixes (`server -> tui`).
Add a comment saying exactly that, and add a compile-time cross-check in `cli-start.ts` (a
`const _check: ControlHost['sessions'] = …` style assignment) so the two cannot drift.

Every string a row displays must arrive **already localized**, per the existing `ControlHost`
convention — except the state, which is a `SessionState` enum the TUI turns into a word, exactly as
`ServiceState` and `BootState` already work.

- [ ] **Step 2: Add the host strings to `cli-i18n.ts`**

EN and PT for: the tmux-unavailable reason, the outcome sentences for start/kill/rename/note, and
the "not attachable" refusal. Follow the file's existing grouping and add a comment marking the
session block.

- [ ] **Step 3: Implement the methods in `cli-start.ts`**

Follow the conventions the file already uses: `const s = S()` at the top of each method, return
`{ ok, message }`, never throw, and put the real work in the `sessions/` modules rather than here.

`sessions()` composes what Tasks 1-3 built:

```
resolveBackend() -> unavailable()?  -> { views: [], unavailable: reason }
readRegistry() + backend.list()     -> reconcileSessions()
backend.capture(id, N) per RUNNING session, concurrency-limited with createLimiter (utils.ts)
harnessProcesses() from live-sessions.ts
buildSessionViews({ nowMs: Date.now(), reconciled, captures, processes })
```

Capture only the sessions that are RUNNING and only as many lines as the classifier needs
(40 is what the fixtures were captured at) — a capture per session per tick is the one place this
feature can get expensive.

`projectChoices()` reads the consolidate store (`CONSOLIDATED_DIR`, see `consolidate.ts`
`loadConsolidated`) and runs `buildProjectChoices` + `searchProjects`. Cache the built choice list
in module scope with a short TTL — it is rebuilt on every keystroke otherwise.

- [ ] **Step 4: Test what is testable**

`cli-start.ts` is IO, but the composition above has one thing worth pinning in
`cli-start.test.ts`: that `sessions()` returns `{ views: [], unavailable }` — never a bare empty
list — when the backend is unavailable. Follow the file's existing testing style.

- [ ] **Step 5: Verify and commit**

Run: `bun tsc --noEmit && bun test`

```bash
git add packages/tui/src/control/types.ts packages/server/server/cli-start.ts packages/server/server/cli-i18n.ts packages/server/server/cli-start.test.ts
git commit -m "feat(sessions): ControlHost verbs for the sessions tab"
```

---

### Task 6: The tab's pure layout, keys and strings

Everything about the Sessions screen that can be decided without mounting Ink goes here, because
`control/tabs/` components have no tests and these pure modules do.

**Files:**
- Modify: `packages/tui/src/control/types.ts` (`TabId`, `TAB_ORDER`)
- Modify: `packages/tui/src/control/i18n.ts` (EN + PT)
- Modify: `packages/tui/src/control/chrome.ts` (`sessionCells`, `sessionDetailLines`, `sessionsHints`)
- Modify: `packages/tui/src/control/nav.ts` (if a new reducer is genuinely needed — reuse first)
- Test: `packages/tui/src/control/chrome.test.ts`, `nav.test.ts`

- [ ] **Step 1: Add the tab id**

In `types.ts`, add `'sessions'` to `TabId` and to `TAB_ORDER`, positioned **second** — right after
`services`. Rationale to put in the comment: it is the tab a user opens most, and `TAB_ORDER` is
literally the on-screen order.

`bun tsc --noEmit` will now fail on `i18n.ts` (`tabs` and `tabsShort` are `Record<TabId, string>`)
— that failure IS the checklist.

- [ ] **Step 2: Add the strings (EN + PT)**

In `i18n.ts`: `tabs.sessions` / `tabsShort.sessions`, plus a new commented `/** Sessions tab. */`
group on the `ControlStrings` interface with entries for: the column headers, each `SessionState` as
a word, the empty state, the external-row caveat, the attention counter, the action verbs
(attach / new / rename / note / kill), the wizard's step titles and its search placeholder, and the
key hints. Follow the Logs group's shape exactly.

**Every state needs a WORD, not just a colour** — a state announced in colour alone is the bug the
service conflict row exists to prevent.

- [ ] **Step 3: Write the failing tests for the pure helpers**

Add to `chrome.test.ts`, in that file's behavioural-sentence style:

```ts
describe('sessionCells', () => {
  it('gives up the cwd first, then the label, and the state word last', () => {
    // the state word is the cell nothing else repeats; the detail pane says the rest again
  })

  it('never reduces a row to a coloured glyph alone', () => {})
})

describe('sessionsHints', () => {
  it('offers attach only for a row that is attachable', () => {})
  it('names the three keys that work while the wizard is up, and no others', () => {})
})
```

Fill these in with real assertions against the helpers you are about to write — the sentences above
are the required coverage, not the finished tests.

- [ ] **Step 4: Implement the helpers in `chrome.ts`**

- `sessionCells(view, width, s)` — the row, dropping cells in this order under pressure: **cwd,
  then label, then the harness, keeping the STATE WORD last**. Same rule and same reason as
  `serviceCells`.
- `sessionDetailLines(view, s, now)` — the detail pane: harness, model/effort if recorded, cwd,
  uptime, last activity, the state **with its reason in words** (an `unreadable` row must say the
  frame could not be read; an `external` row must say it is not hosted by agentop and therefore
  cannot be attached), the note, and the tail of the last frame.
- `sessionsHints(focus, s, ctx)` — mirrors `cockpitHints`. A hint for a key that does nothing here
  is a bug.

Reuse `fitDetailLines`, `fitValue` and `cockpitLayout` — do not write new geometry.

- [ ] **Step 5: Run the tests and commit**

Run: `bun test packages/tui/src/control/ && bun tsc --noEmit`

```bash
git add packages/tui/src/control/types.ts packages/tui/src/control/i18n.ts packages/tui/src/control/chrome.ts packages/tui/src/control/chrome.test.ts packages/tui/src/control/nav.ts packages/tui/src/control/nav.test.ts
git commit -m "feat(tui): sessions tab id, strings and pure layout helpers"
```

---

### Task 7: The Sessions screen

**Files:**
- Create: `packages/tui/src/control/tabs/Sessions.tsx`
- Modify: `packages/tui/src/control/ControlCenter.tsx` (route the tab; include it in `reports`)

**Read `packages/tui/src/control/tabs/Services.tsx` first and follow it.** It is the worked example
of every rule this screen must obey, and copying its shape is the requirement, not a shortcut.

- [ ] **Step 1: Build the cockpit**

A band of `list | detail` over a full-width detail region, via `cockpitLayout`. Panes:

- **list** — one row per `SessionView` through `sessionCells`. Rows needing attention are already
  sorted to the top by `buildSessionViews`. **Scroll with `windowOffset`**, never slice from zero.
- **detail** — `sessionDetailLines` for the selected row, through `fitDetailLines`.
- **actions** — focus-scoped, acting on the SELECTED session. Composed by the screen from the row's
  own `attachable` / `killable` / `managed` flags, so a verb that cannot work is ABSENT rather than
  present and failing.

`PANE_ORDER` for this screen is `['list', 'detail', 'actions']`; reuse `resolveFocusKey` and
`clampFocus` from `nav.ts`.

- [ ] **Step 2: Poll every 5 seconds**

Follow the `Logs.tsx` pattern exactly: an `isActive`-gated `useEffect`, an `alive` guard against a
stale `setState`, `setInterval` cleared on unmount. **5000 ms**, per the spec. Also refresh
immediately after any action.

- [ ] **Step 3: The counter and the BEL**

Compute `attentionCount(views)`. Report it upward so the header can show it from any tab — add a
field to `ScreenChrome` (or a dedicated callback; pick one and say why in a comment) and render it
in the header tag beside the mode and version, following `headerLayout`'s existing measurement so a
narrow terminal drops it rather than overflowing.

Fire a terminal `BEL` (`\x07`) on the TRANSITION into a waiting state — a session that becomes
`waiting-approval` or `waiting-input` when it was not before. **Never on every tick**, or the
terminal beeps every 5 seconds forever. Track the previous set of waiting ids in a ref.

The BEL must go through `altScreen.writeFrame`, not `process.stdout.write` — nothing may print to
the alternate buffer outside that gate.

- [ ] **Step 4: Keys**

`enter` attach · `n` new · `r` rename · `d` note · `k` kill · `v` cycle view · `tab` cycle panes ·
`esc` back. Screens still change with `←`/`→` only, so claim the arrows exactly as `Services.tsx`
does — only while the action row has focus.

`k` (kill) must confirm first. Use the existing question overlay pattern from `Services.tsx`
(`view.kind !== 'cockpit'` reports `capture: true`, which stands the global keys down).

- [ ] **Step 5: Route it in `ControlCenter.tsx`**

Add `<Screen visible={tab === 'sessions'}>` alongside the others. `Sessions` draws its own panes
like `Services` does, so it receives the FULL `width`/`height` and is **not** wrapped in a `Pane`.
Add `tab === 'sessions'` to `reports` — and do NOT add it to `isStatic`.

- [ ] **Step 6: Preview it at several sizes**

The repo has a tool for exactly this:

```bash
bun run packages/tui/scripts/preview.tsx --cols 96 --rows 30 --screen sessions --lang pt
bun run packages/tui/scripts/preview.tsx --cols 70 --rows 20 --screen sessions --lang en
bun run packages/tui/scripts/preview.tsx --cols 200 --rows 50 --screen sessions --lang en
```

You will need to extend the preview script's fake host with session data — stock it with the
AWKWARD cases as the existing fake does for services: a session waiting for approval, one working,
one `unreadable`, one `exited`, an external row, a very long cwd, and an empty fleet.

**Every preview must end with `✓ every row fits N columns`.** A row that overflows is a corrupted
frame, not a cosmetic issue.

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/control/tabs/Sessions.tsx packages/tui/src/control/ControlCenter.tsx packages/tui/scripts/preview.tsx
git commit -m "feat(tui): the sessions cockpit"
```

---

### Task 8: Attach from the TUI

**Files:**
- Modify: `packages/tui/src/control/tabs/Sessions.tsx`
- Modify: `packages/tui/src/control/index.ts` and/or `packages/server/server/cli-start.ts`

Attaching is a **full-terminal takeover**: Ink must be unmounted, the terminal handed to
`tmux attach`, and the cockpit remounted where it was on detach.

- [ ] **Step 1: Route it through `suspend`**

`altScreen.ts` already has `suspend` — the wrapper for an action that needs the real tty, used today
by `central.sh init`. Read it and use it. Do NOT use `captureOutput` or `streamOutput`: the first
makes the screen freeze, the second feeds the pane its own borders.

- [ ] **Step 2: Print the detach hint before handing over**

`host.detachHint()` returns the real keystroke read from tmux — never hardcode `Ctrl-b`. Print it
while the terminal belongs to us, before the child starts.

- [ ] **Step 3: Restore correctly**

On return: remount, refresh the session list immediately (the session may have exited while
attached), and put the cursor back on the same session id — not the same index, which will have
moved if the sort changed.

- [ ] **Step 4: Verify by hand**

This one cannot be verified by a preview — it needs a real tty. Run the compiled binary in a real
terminal, attach to a session, detach with the printed key, and confirm the cockpit comes back
intact with the same row selected. Paste what you observed into your report; if you cannot get a
tty, say so plainly rather than claiming it works.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/control/tabs/Sessions.tsx packages/tui/src/control/index.ts packages/server/server/cli-start.ts
git commit -m "feat(tui): attach to a session from the cockpit"
```

---

### Task 9: The new-session wizard

**Files:**
- Modify: `packages/tui/src/control/tabs/Sessions.tsx`
- Modify: `packages/tui/src/control/surface.ts` + `surface.test.ts` (any pure step arithmetic)
- Reuse: `packages/tui/src/control/Prompt.tsx`, `Menu.tsx`

`n` opens it. Steps: **harness → project → model → effort → prompt → background or attached.**

- [ ] **Step 1: The steps**

- **harness** — from `host.sessionHarnesses()`, which is derived from `SPAWN_SPECS`. A harness that
  cannot start is ABSENT, never listed-and-failing.
- **project** — a search field over `host.projectChoices(query, limit)`, in the shape of the prompt
  box the assistant CLIs use: type to filter, `↑`/`↓` to pick, `enter` to take. A typed path that
  exists on disk is accepted even when it is not in the list.
- **model** — the harness's `modelSuggestions`, plus free text. **Not a closed list** — `--model`
  accepts any value, and refusing an unlisted one would reject valid input the day a model ships.
- **effort** — only for a harness that HAS efforts, and then only its own closed enum. Skipped
  entirely otherwise; never shown as a disabled step.
- **prompt** — free text, optional.
- **background or attached** — attached goes straight into Task 8's takeover.

Each step must be skippable where the underlying flag is optional, and `esc` must go back a step
rather than discarding the whole wizard.

- [ ] **Step 2: Keep the arithmetic pure**

Any "which steps does this harness have / where am I in them" logic goes into `surface.ts` with
tests in `surface.test.ts`, following that file's existing style. The component holds state and
renders; it decides nothing it could delegate.

- [ ] **Step 3: The row budget**

The wizard lives in the detail region, which `cockpitLayout` already reserves `QUESTION_ROWS` for
when `opts.question` is true. Pass it. Budget against the height you are given; never hand out a row
that does not exist.

- [ ] **Step 4: Preview every step**

`preview.tsx` supports `--keys` to drive the screen into a question first. Use it to capture every
step at 96x30 and at 70x20, and confirm the `✓ every row fits` line each time.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/control/tabs/Sessions.tsx packages/tui/src/control/surface.ts packages/tui/src/control/surface.test.ts packages/tui/scripts/preview.tsx
git commit -m "feat(tui): new-session wizard in the sessions cockpit"
```

---

### Task 10: Labels reach the dashboard

The spec's D6: a label the user gives a session must show in the web dashboard too, so the same work
does not appear under two different names on two screens of one product.

**Files:**
- Create: `packages/server/server/sessions/labels.ts`
- Modify: `packages/server/server/data.ts` (stamp on read)
- Modify: `packages/core/src/types.ts` (`SessionMeta.user_label` / `user_note`)
- Modify: `packages/web/src/...` wherever `sessionLabel()` is resolved
- Test: `packages/server/server/sessions/labels.test.ts`

- [ ] **Step 1: The precedence rule**

`sessionLabel()` in `@agentistics/core` currently falls back `title` → `first_prompt`. The user's
label goes IN FRONT of both, and neither may be overwritten — they are the harness's own facts.

Write the test first: a session with a user label shows it; without one it falls back exactly as
before; a label never replaces the stored `title`.

- [ ] **Step 2: Stamp it in `data.ts`**

Read `~/.agentistics/managed-sessions.json` once per build and stamp `user_label` / `user_note` onto
matching `SessionMeta` by `session_id`.

**A managed session's id is agentop's own id, not the harness's `session_id`** — check whether the
two can be correlated at all before writing this. If they cannot, say so in your report and stop:
correlating them needs the harness to report the session id it chose, which is Phase 4 work, and
inventing a correlation is worse than not having one. **This is a real risk; do not paper over it.**

- [ ] **Step 3: Privacy**

The label travels to a central exactly as `first_prompt` does — subject to the per-connection
sharing rules and scrubbed by `redactSecrets` at BOTH boundaries (`selectDeltas` on the member,
`toTeamDoc` on the central). Add it to the redaction path and to the test that pins it.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(sessions): user labels reach the dashboard"
```

---

### Task 11: Documentation and the compiled binary

- [ ] **Step 1: Update the docs**

- `docs/session-manager.md` — a Sessions-tab section: how to open it, the keys, what each state
  word means (including that `idle-unknown` means no rule matched and `external` means not hosted
  by agentop), and the wizard.
- `docs/cli.md` — nothing new unless a flag changed.
- The control center Cheat sheet (`content.ts`) — the tab, EN and PT.
- `CLAUDE.md` — extend the `sessions/` entry with `attention.ts`, `monitor.ts`, `project-search.ts`,
  and add the Sessions tab to the `packages/tui` tree. State the load-bearing rule: **quiescence
  gates, patterns classify only the quiet ones, and an unmatched frame is `idle-unknown` — never a
  reassuring guess.**

- [ ] **Step 2: Verify against the COMPILED BINARY**

```bash
bun run build:binary
```

Then in a real terminal: open `agentop`, go to the Sessions tab, confirm the list, the detail pane,
the counter, the wizard and attach/detach all work. The devtools-stub class of failure is invisible
under `bun run` — this step is not optional.

- [ ] **Step 3: Full suite**

Run: `bun tsc --noEmit && bun test`

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: the sessions tab"
```

---

## Done when

- `agentop` → Sessions tab lists managed AND external sessions, refreshing every 5 s.
- Sessions waiting on the user sort to the top, are named with a WORD, counted in the header, and
  ring the terminal bell once on the transition.
- A frame that matched no rule reads `idle-unknown`; a frame that could not be READ reads
  `unreadable`; an external row states it is not hosted by agentop and offers no attach.
- `enter` attaches (printing the real detach key) and the cockpit comes back with the same row
  selected.
- `n` creates a session — harness, project search, model, effort, prompt, background or attached.
- `r`, `d`, `k` rename, annotate and kill, with kill confirming first.
- Every screen fits at 70x20 and 200x50, verified with `preview.tsx`.
- `bun tsc --noEmit` and `bun test` pass, and the whole thing works from the compiled binary.

## Open risks

- **Attention patterns age.** Structurally mitigated: quiescence keeps `working` correct regardless,
  and an unmatched frame degrades to `idle-unknown` rather than to a wrong answer. Fixtures come
  from real runs so a break is a failing test, not a quietly wrong cockpit.
- **Two harnesses may have no fixtures.** Then they get `null` rules and always read `idle-unknown`.
  That is the honest outcome, and Task 2 must report it rather than inventing rules.
- **Task 10 may be impossible as written.** If an agentop session id cannot be correlated to a
  harness `session_id`, the label cannot reach the dashboard in this phase. Report and stop rather
  than inventing a correlation.
