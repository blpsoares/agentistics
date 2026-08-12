# agentop Session Manager — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `agentop session` — start a harness session detached or attached in a tmux-backed
workspace, list it, attach to it, name it, and kill it — with no TUI yet.

**Architecture:** A `SessionBackend` interface owns hosting. Phase 1 implements only `TmuxBackend`,
running on its own tmux socket (`-L agentop`) so agentop sessions never mix with the user's. Which
argv a harness needs is decided by a pure `planSpawn()` over a total `Record<HarnessId, SpawnSpec |
null>`; what exists is decided by reconciling a local JSON registry against the backend's own list.
Everything decidable without I/O is a pure, tested module; the I/O modules are thin.

**Tech Stack:** Bun, TypeScript (strict), `bun test`, tmux ≥ 3.x.

Source spec: `docs/superpowers/specs/2026-08-12-agentop-session-manager-design.md`.
This plan covers **Phase 1 only**. Phases 2–5 (monitor + Sessions tab, wizard + labels, Windows PTY
backend, remaining harnesses) get their own plans.

## Global Constraints

- **Everything in English** — code, comments, commit messages, docs (project CLAUDE.md).
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- **Strict TypeScript.** The pre-commit hook runs `bun tsc --noEmit` **and** `bun test`; both must
  pass before any commit in this plan succeeds.
- **Never hardcode a harness list as an array.** `SPAWN_SPECS` is a
  `Record<HarnessId, SpawnSpec | null>` so the compiler refuses a build that forgot a harness — the
  rule CLAUDE.md states for `HARNESS_SORT`, and the reason five surfaces once silently lost a harness.
- **Never guess a CLI flag.** Every flag in this plan was read from that tool's own `--help` on
  2026-08-12 and is cited at its use site. A flag that could not be verified is left **absent**, not
  guessed — the discipline `resumeCommand.ts` already applies to Gemini.
- **`packages/server/server/*` is server-only.** Never import it from `packages/web/src/`.
- **Pure modules take no I/O.** Tests do not mock the filesystem.
- **Local JSON stores keep ISO date strings** (CLAUDE.md: the BSON-`Date` rule is for Mongo only).

## File Structure

```
packages/server/server/sessions/
  types.ts          Task 1  the whole contract: SpawnSpec, SpawnRequest, SessionBackend, ManagedSession
  spawn-spec.ts     Task 1  PURE  Record<HarnessId, SpawnSpec|null> + planSpawn()
  session-ref.ts    Task 2  PURE  resolveSessionRef() + reconcileSessions()
  registry.ts       Task 3  IO    read/write/add/remove/update the managed-session registry
  tmux-cli.ts       Task 4  PURE  every tmux argv this feature builds + every tmux output it parses
  backend-tmux.ts   Task 5  IO    SessionBackend over `tmux -L agentop`
  index.ts          Task 5  IO    resolveBackend() — the only platform branch
  cli-parse.ts      Task 6  PURE  argv of `agentop session …` -> a typed command
  cli-session.ts    Task 7  IO    the command handlers (runSession*)

packages/server/server/config.ts        Task 3  + MANAGED_SESSIONS_FILE
packages/server/bin/cli.ts              Task 7  + the `session` command and its HELP block
docs/session-manager.md                 Task 7  user-facing documentation
```

## Deviations from the spec, and why

Three refinements were forced by reading the real CLIs and probing real tmux. They are recorded here
because a reviewer holding the spec must be able to see them deliberately.

1. **`--model` is not validated against a closed list; `--effort` is.** `claude --help` documents
   `--model` as "an alias for the latest model … **or a model's full name**", so any closed list
   would refuse valid input the day a model ships — the same failure mode as a hardcoded harness
   array. `SpawnSpec.modelSuggestions` therefore feeds the Phase 3 picker and validates nothing,
   while `SpawnSpec.efforts` is a genuine closed enum printed by the CLI itself and IS validated.
2. **The registry file is `~/.agentistics/managed-sessions.json`, not `~/.agentistics/sessions/managed.json`.**
   `loadConsolidated` reads every flat `*.json` at the root of `<data>/sessions/` as a legacy Claude
   session, so the spec's path would have made the registry be parsed as session metrics.
3. **Codex gets no effort flag in Phase 1.** `codex --help` exposes no `--effort`; the reasoning
   effort is a `-c key=value` config override whose exact key could not be verified from the
   installed CLI (`-c` accepts unknown keys silently, so trying it proves nothing). Per the global
   constraint it is absent. Adding it is a one-line spec change once the key is confirmed against
   Codex's published configuration reference.

## Verified facts this plan relies on

Probed on 2026-08-12; a task that contradicts one of these is wrong.

| Fact | Evidence |
|---|---|
| `claude` takes the prompt as a **positional argument** | `claude --help`: `Usage: claude [options] [command] [prompt]`, `Arguments: prompt  Your prompt` |
| `claude --model <model>`, aliases `fable`/`opus`/`sonnet` | `claude --help` |
| `claude --effort <level>` — `low, medium, high, xhigh, max` | `claude --help` |
| `codex` takes the prompt as a **positional argument** | `codex --help`: `Usage: codex [OPTIONS] [PROMPT]`, `[PROMPT] Optional user prompt to start the session` |
| `codex -m, --model <MODEL>` | `codex --help` |
| `kimi` has **no** interactive prompt flag — `-p/--prompt` runs one prompt **non-interactively** | `kimi --help`: `-p, --prompt <prompt>  Run one prompt non-interactively and print the response.` |
| `kimi -m, --model <model>` | `kimi --help` |
| `tmux new-session -d -s <n> -c <dir> -- <argv…>` accepts a multi-argument command | probed: `tmux -L agentop-probe new-session -d -s probe1 -c /tmp -- sh -c '…'` started and listed |
| `list-sessions -F` yields `session_name`, `session_created` (epoch **seconds**), `session_attached` (0/1), `pane_dead` (0/1), `session_activity` (epoch seconds) | probed |
| `set-option -g remain-on-exit on` keeps a finished session listable with `pane_dead=1` and its output still capturable | probed: `probe2  1` then `capture-pane` returned `done-and-gone` plus `Pane is dead (status 0, …)` |
| `capture-pane -p -t <n> -S -<N>` returns the frame, **padded with trailing blank lines** | probed |
| `send-keys -t <n> -l <text>` then `send-keys -t <n> Enter` types literal text | probed: the child's `read` received `hello prompt` |
| `show-options -g prefix` prints `prefix C-b` | probed — this is why the detach hint is read, never assumed to be `Ctrl-b` |

---

### Task 1: The contract and the spawn planner

**Files:**
- Create: `packages/server/server/sessions/types.ts`
- Create: `packages/server/server/sessions/spawn-spec.ts`
- Test: `packages/server/server/sessions/spawn-spec.test.ts`

**Interfaces:**
- Consumes: `HarnessId` from `@agentistics/core`.
- Produces: everything in `types.ts` (used by every later task) and
  `SPAWN_SPECS`, `planSpawn(req: SpawnRequest): SpawnPlanResult`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/sessions/spawn-spec.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { HARNESS_ORDER } from '@agentistics/core'
import { SPAWN_SPECS, planSpawn } from './spawn-spec'

describe('SPAWN_SPECS', () => {
  it('has an entry for every harness', () => {
    for (const id of HARNESS_ORDER) {
      expect(SPAWN_SPECS).toHaveProperty(id)
    }
  })

  it('marks the harnesses that are not spawnable yet as null', () => {
    expect(SPAWN_SPECS.gemini).toBeNull()
    expect(SPAWN_SPECS.copilot).toBeNull()
    expect(SPAWN_SPECS.antigravity).toBeNull()
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

  it('refuses a harness with no spawn spec', () => {
    const r = planSpawn({ harness: 'gemini', cwd: '/tmp' })
    expect(r).toEqual({ ok: false, error: { code: 'unsupported-harness', harness: 'gemini' } })
  })

  it('does NOT validate the model against a closed list', () => {
    const r = planSpawn({ harness: 'claude', cwd: '/tmp', model: 'claude-opus-5-some-future-name' })
    expect(r).toEqual({ ok: true, plan: { argv: ['claude', '--model', 'claude-opus-5-some-future-name'] } })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/sessions/spawn-spec.test.ts`
Expected: FAIL — `Cannot find module './spawn-spec'`.

- [ ] **Step 3: Write `types.ts`**

Create `packages/server/server/sessions/types.ts`:

```ts
/**
 * types.ts — the whole contract of the session manager.
 *
 * Two boundaries live here. `SpawnSpec` / `planSpawn` decide WHAT to run and are per harness;
 * `SessionBackend` decides WHERE it runs and is per platform. Neither knows about the other: the
 * planner emits an argv, the backend hosts an argv, and that is the only thing they share.
 */

import type { HarnessId } from '@agentistics/core'

/**
 * How a harness accepts an initial prompt while starting an INTERACTIVE session.
 *
 * `send-keys` is not a fallback for laziness — it is the honest answer for a CLI whose only prompt
 * flag is non-interactive. `kimi -p` prints one response and exits, so passing the prompt that way
 * would leave nothing to attach to; typing it into the session is what a person does.
 */
export type PromptMode =
  | { kind: 'positional' }
  | { kind: 'flag'; flag: string }
  | { kind: 'send-keys' }

export interface SpawnSpec {
  /** The binary, as it is found on PATH. */
  bin: string
  prompt: PromptMode
  /** Absent when the CLI has no model flag. */
  modelFlag?: string
  /**
   * Models offered by the picker. Deliberately NOT a validation list: `claude --help` documents
   * `--model` as an alias "or a model's full name", so refusing anything outside a fixed list
   * would reject valid input the day a model ships.
   */
  modelSuggestions: string[]
  /** Absent when the CLI has no effort flag. Paired with `efforts`; never one without the other. */
  effortFlag?: string
  /** A genuine closed enum, printed by the CLI itself — so this one IS validated. */
  efforts?: string[]
}

export interface SpawnRequest {
  harness: HarnessId
  cwd: string
  prompt?: string
  model?: string
  effort?: string
  label?: string
}

export interface SpawnPlan {
  argv: string[]
  /** Typed into the session once it is up, for a `send-keys` harness. */
  sendKeys?: string
}

export type SpawnPlanError =
  | { code: 'unsupported-harness'; harness: HarnessId }
  | { code: 'model-unsupported'; harness: HarnessId }
  | { code: 'effort-unsupported'; harness: HarnessId }
  | { code: 'unknown-effort'; harness: HarnessId; value: string; accepted: string[] }

export type SpawnPlanResult =
  | { ok: true; plan: SpawnPlan }
  | { ok: false; error: SpawnPlanError }

/** What the backend is asked to host. Harness-agnostic by construction. */
export interface BackendSpawn {
  /** Our session id. The backend derives its own name from it; callers never see that name. */
  id: string
  cwd: string
  argv: string[]
  sendKeys?: string
}

/** One session as the BACKEND sees it — existence and liveness, no product metadata. */
export interface BackendSession {
  id: string
  createdMs: number
  attached: boolean
  /** False once the hosted command has exited. The session is still listable and capturable. */
  alive: boolean
  /** Last time the backend saw activity, epoch ms. Phase 2's quiescence gate reads this. */
  lastActivityMs: number
}

/** One session as the PRODUCT sees it. Persisted; the backend knows none of this. */
export interface ManagedSession {
  id: string
  harness: HarnessId
  cwd: string
  /** ISO string: this is a local JSON store, where ISO is the correct representation. */
  createdAt: string
  model?: string
  effort?: string
  label?: string
  note?: string
}

export interface SessionBackend {
  readonly id: 'tmux' | 'pty'
  /** Why this backend cannot run here, already localized. Absent when it can. */
  unavailable(): Promise<string | undefined>
  spawn(req: BackendSpawn): Promise<void>
  list(): Promise<BackendSession[]>
  /** Newest-last lines of the last rendered frame, trailing blanks removed. */
  capture(id: string, lines: number): Promise<string[]>
  kill(id: string): Promise<void>
  /**
   * The argv a caller execs to attach. Returned rather than executed: the attach needs the real
   * tty, which it can only have after the caller has released it.
   */
  attachCommand(id: string): string[]
  /** The real detach keystroke, read from the backend — never assumed to be `Ctrl-b`. */
  detachHint(): Promise<string>
}
```

- [ ] **Step 4: Write `spawn-spec.ts`**

Create `packages/server/server/sessions/spawn-spec.ts`:

```ts
/**
 * spawn-spec.ts — PURE. What argv each harness needs to start an interactive session.
 *
 * A `Record<HarnessId, …>`, never an array: TypeScript accepts an array literal with a member
 * missing, and CLAUDE.md records five surfaces that silently lost a harness exactly that way. A
 * harness whose entry is `null` is not spawnable by us yet, and every caller must therefore refuse
 * it by name rather than offering a verb that fails.
 *
 * EVERY flag below was read from that tool's own `--help` on 2026-08-12. A flag that could not be
 * verified is absent, not guessed.
 */

import type { HarnessId } from '@agentistics/core'
import type { SpawnRequest, SpawnPlanResult, SpawnSpec } from './types'

export const SPAWN_SPECS: Record<HarnessId, SpawnSpec | null> = {
  // `Usage: claude [options] [command] [prompt]` / `Arguments: prompt  Your prompt`
  claude: {
    bin: 'claude',
    prompt: { kind: 'positional' },
    modelFlag: '--model',
    // "an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name"
    modelSuggestions: ['fable', 'opus', 'sonnet'],
    effortFlag: '--effort',
    // "Effort level for the current session (low, medium, high, xhigh, max)"
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },

  // `Usage: codex [OPTIONS] [PROMPT]` / `[PROMPT]  Optional user prompt to start the session`
  // No `--effort`: the reasoning effort is a `-c key=value` override whose key is not verifiable
  // from the CLI (`-c` accepts unknown keys silently), so it is absent rather than guessed.
  codex: {
    bin: 'codex',
    prompt: { kind: 'positional' },
    modelFlag: '--model', // `-m, --model <MODEL>`
    modelSuggestions: [],
  },

  // Kimi's only prompt flag is `-p, --prompt <prompt>  Run one prompt non-interactively and print
  // the response.` — that exits, leaving nothing to attach to. So the prompt is TYPED IN instead.
  kimi: {
    bin: 'kimi',
    prompt: { kind: 'send-keys' },
    modelFlag: '--model', // `-m, --model <model>`
    modelSuggestions: [],
  },

  // Phase 5. Absent from the wizard and refused by name, rather than offered and failing.
  gemini: null,
  copilot: null,
  antigravity: null,
}

/** Decide the exact argv (and any text to type in) for a requested session. */
export function planSpawn(req: SpawnRequest): SpawnPlanResult {
  const spec = SPAWN_SPECS[req.harness]
  if (!spec) return { ok: false, error: { code: 'unsupported-harness', harness: req.harness } }

  if (req.model && !spec.modelFlag) {
    return { ok: false, error: { code: 'model-unsupported', harness: req.harness } }
  }
  if (req.effort && (!spec.effortFlag || !spec.efforts)) {
    return { ok: false, error: { code: 'effort-unsupported', harness: req.harness } }
  }
  if (req.effort && spec.efforts && !spec.efforts.includes(req.effort)) {
    return {
      ok: false,
      error: { code: 'unknown-effort', harness: req.harness, value: req.effort, accepted: spec.efforts },
    }
  }

  const argv: string[] = [spec.bin]
  if (req.model && spec.modelFlag) argv.push(spec.modelFlag, req.model)
  if (req.effort && spec.effortFlag) argv.push(spec.effortFlag, req.effort)

  let sendKeys: string | undefined
  if (req.prompt) {
    if (spec.prompt.kind === 'positional') argv.push(req.prompt)
    else if (spec.prompt.kind === 'flag') argv.push(spec.prompt.flag, req.prompt)
    else sendKeys = req.prompt
  }

  return { ok: true, plan: sendKeys === undefined ? { argv } : { argv, sendKeys } }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/server/server/sessions/spawn-spec.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Type-check**

Run: `bun tsc --noEmit`
Expected: no errors in `packages/server/server/sessions/`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/sessions/types.ts packages/server/server/sessions/spawn-spec.ts packages/server/server/sessions/spawn-spec.test.ts
git commit -m "feat(sessions): spawn spec registry and pure spawn planner"
```

---

### Task 2: Reference resolution and registry/backend reconciliation

**Files:**
- Create: `packages/server/server/sessions/session-ref.ts`
- Test: `packages/server/server/sessions/session-ref.test.ts`

**Interfaces:**
- Consumes: `ManagedSession`, `BackendSession` from Task 1's `types.ts`.
- Produces: `resolveSessionRef(list, ref): RefResult`,
  `reconcileSessions(registry, backend): ReconciledSession[]`,
  and the `ReconciledSession` / `RefResult` types.

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/sessions/session-ref.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import type { BackendSession, ManagedSession } from './types'
import { reconcileSessions, resolveSessionRef } from './session-ref'

const managed = (id: string, label?: string): ManagedSession => ({
  id,
  harness: 'claude',
  cwd: '/tmp',
  createdAt: '2026-08-12T10:00:00.000Z',
  ...(label ? { label } : {}),
})

const backend = (id: string, alive = true): BackendSession => ({
  id,
  createdMs: 1_786_562_971_000,
  attached: false,
  alive,
  lastActivityMs: 1_786_562_971_000,
})

describe('resolveSessionRef', () => {
  const list = [managed('a1b2c3d4', 'refactor auth'), managed('a1b2ffff', 'fix tests'), managed('zz99', 'fix tests')]

  it('matches an exact id', () => {
    expect(resolveSessionRef(list, 'a1b2c3d4')).toEqual({ ok: true, session: list[0]! })
  })

  it('matches a label, case-insensitively', () => {
    expect(resolveSessionRef(list, 'Refactor Auth')).toEqual({ ok: true, session: list[0]! })
  })

  it('matches a unique id prefix', () => {
    expect(resolveSessionRef(list, 'zz')).toEqual({ ok: true, session: list[2]! })
  })

  it('refuses an ambiguous id prefix instead of picking one', () => {
    expect(resolveSessionRef(list, 'a1b2')).toEqual({
      ok: false, reason: 'ambiguous', matches: ['a1b2c3d4', 'a1b2ffff'],
    })
  })

  it('refuses a duplicated label instead of picking one', () => {
    expect(resolveSessionRef(list, 'fix tests')).toEqual({
      ok: false, reason: 'ambiguous', matches: ['a1b2ffff', 'zz99'],
    })
  })

  it('reports nothing found', () => {
    expect(resolveSessionRef(list, 'nope')).toEqual({ ok: false, reason: 'not-found', matches: [] })
  })
})

describe('reconcileSessions', () => {
  it('reports a session both sides know about as running', () => {
    const r = reconcileSessions([managed('a')], [backend('a')])
    expect(r).toEqual([{ id: 'a', managed: managed('a'), backend: backend('a'), status: 'running' }])
  })

  it('reports a dead pane as exited, keeping it visible', () => {
    const r = reconcileSessions([managed('a')], [backend('a', false)])
    expect(r[0]!.status).toBe('exited')
  })

  it('reports a registry entry the backend does not have as lost', () => {
    const r = reconcileSessions([managed('a')], [])
    expect(r).toEqual([{ id: 'a', managed: managed('a'), status: 'lost' }])
  })

  it('never drops a backend session the registry does not know about', () => {
    const r = reconcileSessions([], [backend('a')])
    expect(r).toEqual([{ id: 'a', backend: backend('a'), status: 'unregistered' }])
  })

  it('lists every id exactly once when the two sides overlap partially', () => {
    const r = reconcileSessions([managed('a'), managed('b')], [backend('b'), backend('c')])
    expect(r.map(x => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/sessions/session-ref.test.ts`
Expected: FAIL — `Cannot find module './session-ref'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/server/sessions/session-ref.ts`:

```ts
/**
 * session-ref.ts — PURE. Naming a session, and agreeing on which sessions exist.
 *
 * Both answers are ambiguity-averse on purpose. `resolveSessionRef` refuses rather than picking
 * when two sessions could be meant, because the verbs it feeds (`attach`, `kill`) are not the place
 * to be lucky. `reconcileSessions` never DROPS anything either side reported: a registry entry with
 * no backend is `lost` (the tmux server was restarted) and a backend session with no registry entry
 * is `unregistered` (this build's registry was cleared, or another one started it) — both are facts
 * the user needs, and silently omitting one is how a session becomes unkillable.
 */

import type { BackendSession, ManagedSession } from './types'

export type RefResult =
  | { ok: true; session: ManagedSession }
  | { ok: false; reason: 'not-found' | 'ambiguous'; matches: string[] }

export interface ReconciledSession {
  id: string
  managed?: ManagedSession
  backend?: BackendSession
  /**
   * `running`  — the backend hosts it and its command is alive.
   * `exited`   — the backend still holds it, but the command finished. Its output is readable.
   * `lost`     — the registry knows it, the backend does not.
   * `unregistered` — the backend hosts it, the registry does not know it.
   */
  status: 'running' | 'exited' | 'lost' | 'unregistered'
}

/** Resolve a user-typed reference: exact id, then exact label (case-insensitive), then id prefix. */
export function resolveSessionRef(list: ManagedSession[], ref: string): RefResult {
  const exact = list.find(s => s.id === ref)
  if (exact) return { ok: true, session: exact }

  const needle = ref.trim().toLowerCase()

  const byLabel = list.filter(s => (s.label ?? '').trim().toLowerCase() === needle && needle !== '')
  if (byLabel.length === 1) return { ok: true, session: byLabel[0]! }
  if (byLabel.length > 1) return { ok: false, reason: 'ambiguous', matches: byLabel.map(s => s.id) }

  const byPrefix = list.filter(s => s.id.startsWith(ref) && ref !== '')
  if (byPrefix.length === 1) return { ok: true, session: byPrefix[0]! }
  if (byPrefix.length > 1) return { ok: false, reason: 'ambiguous', matches: byPrefix.map(s => s.id) }

  return { ok: false, reason: 'not-found', matches: [] }
}

/** Merge what the registry believes with what the backend reports. Neither side is dropped. */
export function reconcileSessions(
  registry: ManagedSession[],
  backend: BackendSession[],
): ReconciledSession[] {
  const byId = new Map(backend.map(b => [b.id, b]))
  const out: ReconciledSession[] = []
  const seen = new Set<string>()

  for (const managed of registry) {
    seen.add(managed.id)
    const found = byId.get(managed.id)
    if (!found) { out.push({ id: managed.id, managed, status: 'lost' }); continue }
    out.push({ id: managed.id, managed, backend: found, status: found.alive ? 'running' : 'exited' })
  }

  for (const b of backend) {
    if (seen.has(b.id)) continue
    out.push({ id: b.id, backend: b, status: 'unregistered' })
  }

  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/sessions/session-ref.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/sessions/session-ref.ts packages/server/server/sessions/session-ref.test.ts
git commit -m "feat(sessions): session reference resolution and registry reconciliation"
```

---

### Task 3: The managed-session registry

**Files:**
- Modify: `packages/server/server/config.ts` (append one constant near `WORKFLOWS_STORE_DIR`, line ~50)
- Create: `packages/server/server/sessions/registry.ts`
- Test: `packages/server/server/sessions/registry.test.ts`

**Interfaces:**
- Consumes: `ManagedSession` (Task 1), `safeReadJson` from `../utils`, `AGENTISTICS_DATA_DIR` from `../config`.
- Produces: `createSessionRegistry(file): SessionRegistry` (the store bound to one path) and the
  default-bound `readRegistry()`, `addSession(s)`, `removeSession(id)`,
  `patchSession(id, patch: { label?: string; note?: string })`, plus `newSessionId()`.

The path is a **parameter**, following `createLocalTagStore(file)` in `tags-local-store.ts:117`:
the filesystem is the thing under test here, so it is exercised for real against a temp directory
rather than mocked, and no test has to defeat module caching to redirect it.

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/sessions/registry.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionRegistry, newSessionId } from './registry'

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentistics-registry-'))
  file = join(dir, 'managed-sessions.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const session = (id: string) => ({
  id, harness: 'claude' as const, cwd: '/tmp', createdAt: '2026-08-12T10:00:00.000Z',
})

describe('createSessionRegistry', () => {
  it('starts empty and never throws on a missing file', async () => {
    expect(await createSessionRegistry(file).read()).toEqual([])
  })

  it('starts empty and never throws on a corrupt file', async () => {
    await writeFile(file, '{ this is not json', 'utf-8')
    expect(await createSessionRegistry(file).read()).toEqual([])
  })

  it('round-trips an added session', async () => {
    const r = createSessionRegistry(file)
    await r.add(session('a1'))
    expect(await r.read()).toEqual([session('a1')])
  })

  it('replaces rather than duplicates when the same id is added twice', async () => {
    const r = createSessionRegistry(file)
    await r.add(session('a1'))
    await r.add({ ...session('a1'), cwd: '/srv' })
    const list = await r.read()
    expect(list).toHaveLength(1)
    expect(list[0]!.cwd).toBe('/srv')
  })

  it('patches a label and a note without touching the rest', async () => {
    const r = createSessionRegistry(file)
    await r.add(session('a1'))
    expect(await r.patch('a1', { label: 'refactor auth', note: 'split the god object' })).toBe(true)
    const [s] = await r.read()
    expect(s!.label).toBe('refactor auth')
    expect(s!.note).toBe('split the god object')
    expect(s!.harness).toBe('claude')
  })

  it('reports a patch of an unknown id rather than silently succeeding', async () => {
    expect(await createSessionRegistry(file).patch('nope', { label: 'x' })).toBe(false)
  })

  it('removes a session', async () => {
    const r = createSessionRegistry(file)
    await r.add(session('a1'))
    await r.remove('a1')
    expect(await r.read()).toEqual([])
  })
})

describe('newSessionId', () => {
  it('mints ids that are unique and safe as a tmux session name', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSessionId()))
    expect(ids.size).toBe(200)
    // tmux treats `.` and `:` as target separators, so the id must contain neither.
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{10}$/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/sessions/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Add the path constant**

In `packages/server/server/config.ts`, immediately after the `WORKFLOWS_STORE_DIR` line (~line 50), add:

```ts
// Session-manager registry: the sessions `agentop session` started, with their labels and notes.
// Deliberately NOT inside CONSOLIDATED_DIR — `loadConsolidated` reads every flat *.json at that
// root as a legacy Claude session, so a registry file there would be parsed as session metrics.
export const MANAGED_SESSIONS_FILE = join(AGENTISTICS_DATA_DIR, 'managed-sessions.json')
```

- [ ] **Step 4: Write the implementation**

Create `packages/server/server/sessions/registry.ts`:

```ts
/**
 * registry.ts — the product's own record of the sessions it started.
 *
 * The BACKEND is authoritative about what exists; this file is authoritative about what those
 * sessions MEAN (which harness, which model, the user's label and note). `reconcileSessions` puts
 * the two together, and neither is allowed to delete the other's facts.
 *
 * Reads never throw: a corrupt or absent file yields an empty registry, because a control center
 * that cannot start because of a bad JSON file is worse than one that has forgotten some labels.
 *
 * The store is bound to a path by `createSessionRegistry`, the same shape `createLocalTagStore`
 * uses — so a test points it at a temp directory and exercises the real filesystem.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MANAGED_SESSIONS_FILE } from '../config'
import { safeReadJson } from '../utils'
import type { ManagedSession } from './types'

/**
 * A short, lowercase id that is safe as a tmux session name.
 *
 * tmux parses `.` and `:` as target separators (`session:window.pane`), so an id containing either
 * would make `-t agentop-<id>` address something else — hex from a UUID contains neither.
 */
export function newSessionId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10)
}

export interface SessionRegistry {
  read(): Promise<ManagedSession[]>
  add(session: ManagedSession): Promise<void>
  remove(id: string): Promise<void>
  /** False when no session carries that id — never a silent success. */
  patch(id: string, patch: { label?: string; note?: string }): Promise<boolean>
}

export function createSessionRegistry(file: string): SessionRegistry {
  async function read(): Promise<ManagedSession[]> {
    const raw = await safeReadJson<ManagedSession[]>(file)
    return Array.isArray(raw) ? raw : []
  }

  async function write(list: ManagedSession[]): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(list, null, 2)}\n`, 'utf-8')
  }

  return {
    read,
    async add(session) {
      const list = await read()
      await write([...list.filter(s => s.id !== session.id), session])
    },
    async remove(id) {
      const list = await read()
      await write(list.filter(s => s.id !== id))
    },
    async patch(id, patch) {
      const list = await read()
      const idx = list.findIndex(s => s.id === id)
      if (idx === -1) return false
      list[idx] = { ...list[idx]!, ...patch }
      await write(list)
      return true
    },
  }
}

/** The registry this machine actually uses. */
const defaultRegistry = createSessionRegistry(MANAGED_SESSIONS_FILE)

export const readRegistry = (): Promise<ManagedSession[]> => defaultRegistry.read()
export const addSession = (s: ManagedSession): Promise<void> => defaultRegistry.add(s)
export const removeSession = (id: string): Promise<void> => defaultRegistry.remove(id)
export const patchSession = (
  id: string,
  patch: { label?: string; note?: string },
): Promise<boolean> => defaultRegistry.patch(id, patch)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/server/server/sessions/registry.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/config.ts packages/server/server/sessions/registry.ts packages/server/server/sessions/registry.test.ts
git commit -m "feat(sessions): managed-session registry store"
```

---

### Task 4: Every tmux argv and every tmux parse, as pure functions

**Files:**
- Create: `packages/server/server/sessions/tmux-cli.ts`
- Test: `packages/server/server/sessions/tmux-cli.test.ts`

**Interfaces:**
- Consumes: `BackendSession` (Task 1).
- Produces: `TMUX_SOCKET`, `SESSION_PREFIX`, `tmuxName(id)`, `idFromTmuxName(name)`, `LIST_FORMAT`,
  `parseTmuxList(stdout)`, `trimCapture(lines)`, `parsePrefix(stdout)`, and the argv builders
  `newSessionArgs`, `killSessionArgs`, `capturePaneArgs`, `sendKeysLiteralArgs`, `sendKeysEnterArgs`,
  `attachArgs`, `remainOnExitArgs`, `showPrefixArgs`, `hasServerArgs`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/sessions/tmux-cli.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import {
  LIST_FORMAT, attachArgs, capturePaneArgs, idFromTmuxName, killSessionArgs, newSessionArgs,
  parsePrefix, parseTmuxList, sendKeysEnterArgs, sendKeysLiteralArgs, trimCapture, tmuxName,
} from './tmux-cli'

describe('names', () => {
  it('namespaces our sessions', () => {
    expect(tmuxName('a1b2')).toBe('agentop-a1b2')
    expect(idFromTmuxName('agentop-a1b2')).toBe('a1b2')
  })

  it("ignores a session that is not ours", () => {
    expect(idFromTmuxName('my-own-work')).toBeNull()
  })
})

describe('newSessionArgs', () => {
  it('uses our socket, detaches, sets the cwd, and separates the command with --', () => {
    expect(newSessionArgs({ id: 'a1', cwd: '/home/u/p', argv: ['claude', '--model', 'opus', 'fix it'] }))
      .toEqual([
        '-L', 'agentop', 'new-session', '-d', '-s', 'agentop-a1', '-c', '/home/u/p',
        '--', 'claude', '--model', 'opus', 'fix it',
      ])
  })
})

describe('the other argv builders', () => {
  it('builds them all against our socket and our session name', () => {
    expect(killSessionArgs('a1')).toEqual(['-L', 'agentop', 'kill-session', '-t', 'agentop-a1'])
    expect(capturePaneArgs('a1', 40)).toEqual(['-L', 'agentop', 'capture-pane', '-p', '-t', 'agentop-a1', '-S', '-40'])
    expect(sendKeysLiteralArgs('a1', 'hello there')).toEqual(['-L', 'agentop', 'send-keys', '-t', 'agentop-a1', '-l', 'hello there'])
    expect(sendKeysEnterArgs('a1')).toEqual(['-L', 'agentop', 'send-keys', '-t', 'agentop-a1', 'Enter'])
    expect(attachArgs('a1')).toEqual(['tmux', '-L', 'agentop', 'attach-session', '-t', 'agentop-a1'])
  })
})

describe('parseTmuxList', () => {
  const line = (n: string, created: string, attached: string, dead: string, activity: string) =>
    [n, created, attached, dead, activity].join('\t')

  it('reads the fields our LIST_FORMAT asks for, converting seconds to ms', () => {
    expect(parseTmuxList(line('agentop-a1', '1786562971', '0', '0', '1786563000'))).toEqual([
      { id: 'a1', createdMs: 1_786_562_971_000, attached: false, alive: true, lastActivityMs: 1_786_563_000_000 },
    ])
  })

  it('reads a dead pane as not alive, without dropping the session', () => {
    const [s] = parseTmuxList(line('agentop-a1', '1786562971', '0', '1', '1786563000'))
    expect(s!.alive).toBe(false)
  })

  it('reads an attached session as attached', () => {
    const [s] = parseTmuxList(line('agentop-a1', '1786562971', '1', '0', '1786563000'))
    expect(s!.attached).toBe(true)
  })

  it("ignores the user's own tmux sessions", () => {
    expect(parseTmuxList(line('my-own-work', '1786562971', '0', '0', '1786563000'))).toEqual([])
  })

  it('ignores blank lines and malformed rows rather than throwing', () => {
    expect(parseTmuxList('\n\nagentop-a1\nagentop-b2\t1786562971\t0\t0\t1786563000\n')).toHaveLength(1)
  })

  it('is empty for the empty output of a server with no sessions', () => {
    expect(parseTmuxList('')).toEqual([])
  })

  it('asks for exactly the fields it parses', () => {
    expect(LIST_FORMAT).toBe('#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_dead}\t#{session_activity}')
  })
})

describe('trimCapture', () => {
  it('drops the blank padding capture-pane appends, keeping interior blanks', () => {
    expect(trimCapture(['a', '', 'b', '', '', ''])).toEqual(['a', '', 'b'])
  })

  it('survives an all-blank frame', () => {
    expect(trimCapture(['', '', ''])).toEqual([])
  })
})

describe('parsePrefix', () => {
  it('turns tmux notation into the keystroke a person reads', () => {
    expect(parsePrefix('prefix C-b')).toBe('Ctrl-b then d')
    expect(parsePrefix('prefix C-a')).toBe('Ctrl-a then d')
  })

  it('falls back to the raw value rather than claiming Ctrl-b', () => {
    expect(parsePrefix('prefix M-x')).toBe('M-x then d')
    expect(parsePrefix('')).toBe('the tmux prefix then d')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/sessions/tmux-cli.test.ts`
Expected: FAIL — `Cannot find module './tmux-cli'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/server/sessions/tmux-cli.ts`:

```ts
/**
 * tmux-cli.ts — PURE. Every tmux argv this feature builds, and every tmux output it reads.
 *
 * Split out from the backend so the parts that can be wrong in an invisible way — a format string
 * that does not match the fields being parsed, a `--` that stops a harness flag being eaten by
 * tmux, seconds read as milliseconds — are tested without a tmux server.
 *
 * We run on our OWN socket (`-L agentop`). The user's sessions are then never listed, never killed
 * and never affected by the server options we set, and `list-sessions` needs no trust in a prefix
 * filter to stay out of their way. The prefix on the name is belt and braces for the case where a
 * user points their own tmux at our socket deliberately.
 *
 * Every field and flag below was probed against tmux 3.2a on 2026-08-12.
 */

import type { BackendSession } from './types'

export const TMUX_SOCKET = 'agentop'
export const SESSION_PREFIX = 'agentop-'

export function tmuxName(id: string): string {
  return SESSION_PREFIX + id
}

export function idFromTmuxName(name: string): string | null {
  return name.startsWith(SESSION_PREFIX) ? name.slice(SESSION_PREFIX.length) : null
}

/** Must stay in lockstep with `parseTmuxList` — the test asserts the exact string for that reason. */
export const LIST_FORMAT =
  '#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_dead}\t#{session_activity}'

const sock = (rest: string[]): string[] => ['-L', TMUX_SOCKET, ...rest]

/** `--` matters: without it tmux parses the harness's own flags as its own. */
export function newSessionArgs(o: { id: string; cwd: string; argv: string[] }): string[] {
  return sock(['new-session', '-d', '-s', tmuxName(o.id), '-c', o.cwd, '--', ...o.argv])
}

export function killSessionArgs(id: string): string[] {
  return sock(['kill-session', '-t', tmuxName(id)])
}

export function capturePaneArgs(id: string, lines: number): string[] {
  return sock(['capture-pane', '-p', '-t', tmuxName(id), '-S', `-${lines}`])
}

/** `-l` sends the text literally, so a prompt containing `;` or `C-c` is typed, not interpreted. */
export function sendKeysLiteralArgs(id: string, text: string): string[] {
  return sock(['send-keys', '-t', tmuxName(id), '-l', text])
}

export function sendKeysEnterArgs(id: string): string[] {
  return sock(['send-keys', '-t', tmuxName(id), 'Enter'])
}

export function listSessionsArgs(): string[] {
  return sock(['list-sessions', '-F', LIST_FORMAT])
}

/** Keeps a finished session listable, with its last frame still capturable — the `exited` state. */
export function remainOnExitArgs(): string[] {
  return sock(['set-option', '-g', 'remain-on-exit', 'on'])
}

export function showPrefixArgs(): string[] {
  return sock(['show-options', '-g', 'prefix'])
}

/** Includes the binary: this argv is EXECED by the caller, not passed to our own tmux runner. */
export function attachArgs(id: string): string[] {
  return ['tmux', '-L', TMUX_SOCKET, 'attach-session', '-t', tmuxName(id)]
}

export function parseTmuxList(stdout: string): BackendSession[] {
  const out: BackendSession[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd()
    if (!line) continue
    const [name, created, attached, dead, activity] = line.split('\t')
    if (!name || created === undefined || activity === undefined) continue
    const id = idFromTmuxName(name)
    if (!id) continue
    const createdSec = Number(created)
    const activitySec = Number(activity)
    if (!Number.isFinite(createdSec)) continue
    out.push({
      id,
      createdMs: createdSec * 1000,
      attached: attached === '1',
      alive: dead !== '1',
      lastActivityMs: Number.isFinite(activitySec) ? activitySec * 1000 : createdSec * 1000,
    })
  }
  return out
}

/** capture-pane pads the frame to the pane height; those trailing blanks are not content. */
export function trimCapture(lines: string[]): string[] {
  let end = lines.length
  while (end > 0 && lines[end - 1]!.trim() === '') end--
  return lines.slice(0, end)
}

/**
 * The real detach keystroke, from `show-options -g prefix` (e.g. `prefix C-b`).
 *
 * Read rather than assumed: tmux loads the user's `~/.tmux.conf` on our socket too, so a user who
 * rebound the prefix to `C-a` would be told to press a key that does nothing. When the value is not
 * a recognisable `C-x`, the raw token is shown instead of a confident wrong answer.
 */
export function parsePrefix(stdout: string): string {
  const token = stdout.trim().split(/\s+/)[1] ?? ''
  if (!token) return 'the tmux prefix then d'
  const ctrl = /^C-(.)$/.exec(token)
  return ctrl ? `Ctrl-${ctrl[1]} then d` : `${token} then d`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/sessions/tmux-cli.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/sessions/tmux-cli.ts packages/server/server/sessions/tmux-cli.test.ts
git commit -m "feat(sessions): pure tmux argv builders and output parsers"
```

---

### Task 5: The tmux backend and backend resolution

**Files:**
- Create: `packages/server/server/sessions/backend-tmux.ts`
- Create: `packages/server/server/sessions/index.ts`

**Interfaces:**
- Consumes: `SessionBackend`, `BackendSpawn`, `BackendSession` (Task 1); everything from `tmux-cli.ts` (Task 4).
- Produces: `tmuxBackend: SessionBackend`, `resolveBackend(): Promise<SessionBackend>`.

No unit test: this file is I/O over a real tmux server, and its decidable parts already live in
`tmux-cli.ts`. It is verified by hand in Step 4 and end-to-end in Task 7.

- [ ] **Step 1: Write `backend-tmux.ts`**

Create `packages/server/server/sessions/backend-tmux.ts`:

```ts
/**
 * backend-tmux.ts — the Unix SessionBackend. Thin on purpose: every decision it could get wrong
 * lives in the pure `tmux-cli.ts` beside it.
 */

import {
  attachArgs, capturePaneArgs, killSessionArgs, listSessionsArgs, newSessionArgs, parsePrefix,
  parseTmuxList, remainOnExitArgs, sendKeysEnterArgs, sendKeysLiteralArgs, showPrefixArgs,
  trimCapture,
} from './tmux-cli'
import type { BackendSession, BackendSpawn, SessionBackend } from './types'

/** How long to wait for a harness to draw its prompt before typing into it. */
const SEND_KEYS_DELAY_MS = 1200

async function tmux(args: string[]): Promise<{ code: number; out: string }> {
  try {
    const p = Bun.spawn(['tmux', ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const out = await new Response(p.stdout).text()
    return { code: await p.exited, out }
  } catch {
    // tmux is not on PATH. 127 is what a shell reports for that, and `unavailable()` is what
    // callers are meant to consult — no throw, so a missing tmux never crashes a caller.
    return { code: 127, out: '' }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

let tmuxPresent: boolean | null = null

export const tmuxBackend: SessionBackend = {
  id: 'tmux',

  async unavailable() {
    if (tmuxPresent === null) {
      const { code } = await tmux(['-V'])
      tmuxPresent = code === 0
    }
    return tmuxPresent ? undefined : 'tmux is not installed — install it to manage background sessions'
  },

  async spawn(req: BackendSpawn) {
    // Set BEFORE the session exists, so a command that exits immediately is still held. Setting it
    // afterwards is a race the fast-failing case always wins.
    await tmux(remainOnExitArgs())
    const { code, out } = await tmux(newSessionArgs({ id: req.id, cwd: req.cwd, argv: req.argv }))
    if (code !== 0) throw new Error(out.trim() || `tmux new-session failed (code ${code})`)
    if (req.sendKeys) {
      await sleep(SEND_KEYS_DELAY_MS)
      await tmux(sendKeysLiteralArgs(req.id, req.sendKeys))
      await tmux(sendKeysEnterArgs(req.id))
    }
  },

  async list(): Promise<BackendSession[]> {
    // "no server running on …" is the ordinary empty state, not an error: exit code 1 with no
    // sessions is what tmux reports before anything has been started.
    const { out } = await tmux(listSessionsArgs())
    return parseTmuxList(out)
  },

  async capture(id: string, lines: number) {
    const { code, out } = await tmux(capturePaneArgs(id, lines))
    if (code !== 0) return []
    return trimCapture(out.split('\n'))
  },

  async kill(id: string) {
    await tmux(killSessionArgs(id))
  },

  attachCommand(id: string) {
    return attachArgs(id)
  },

  async detachHint() {
    const { out } = await tmux(showPrefixArgs())
    return parsePrefix(out)
  },
}
```

- [ ] **Step 2: Write `index.ts`**

Create `packages/server/server/sessions/index.ts`:

```ts
/**
 * index.ts — the only place that branches on platform.
 *
 * Phase 4 adds `backend-pty.ts` for Windows here. Until then Windows resolves to the tmux backend,
 * whose `unavailable()` says so plainly — a verb that cannot work is absent, and the reason is
 * stated, rather than a crash at spawn time.
 */

import { tmuxBackend } from './backend-tmux'
import type { SessionBackend } from './types'

export async function resolveBackend(): Promise<SessionBackend> {
  return tmuxBackend
}

export * from './types'
export { SPAWN_SPECS, planSpawn } from './spawn-spec'
export { reconcileSessions, resolveSessionRef } from './session-ref'
export { addSession, newSessionId, patchSession, readRegistry, removeSession } from './registry'
```

- [ ] **Step 3: Type-check**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify against a real tmux by hand**

```bash
bun -e "
const { tmuxBackend } = await import('./packages/server/server/sessions/backend-tmux.ts')
console.log('unavailable:', await tmuxBackend.unavailable())
await tmuxBackend.spawn({ id: 'probe1', cwd: '/tmp', argv: ['sh', '-c', 'echo hello-from-agentop; sleep 20'] })
await new Promise(r => setTimeout(r, 500))
console.log('list:', await tmuxBackend.list())
console.log('capture:', await tmuxBackend.capture('probe1', 20))
console.log('detachHint:', await tmuxBackend.detachHint())
console.log('attachCommand:', tmuxBackend.attachCommand('probe1'))
await tmuxBackend.kill('probe1')
console.log('after kill:', await tmuxBackend.list())
"
```

Expected: `unavailable: undefined`; `list` holds one entry with `id: 'probe1'`, `alive: true`;
`capture` contains `hello-from-agentop`; `detachHint` reads `Ctrl-b then d` (or your own prefix);
`attachCommand` is `['tmux','-L','agentop','attach-session','-t','agentop-probe1']`;
`after kill` is `[]`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/sessions/backend-tmux.ts packages/server/server/sessions/index.ts
git commit -m "feat(sessions): tmux session backend"
```

---

### Task 6: Parsing `agentop session …`

**Files:**
- Create: `packages/server/server/sessions/cli-parse.ts`
- Test: `packages/server/server/sessions/cli-parse.test.ts`

**Interfaces:**
- Consumes: `HarnessId` from `@agentistics/core`.
- Produces: `parseSessionArgs(argv: string[]): SessionCommand`, and the `SessionCommand` union.

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/sessions/cli-parse.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { parseSessionArgs } from './cli-parse'

describe('parseSessionArgs', () => {
  it('starts a background session on the given harness', () => {
    expect(parseSessionArgs(['claude', '--bg', '-p', 'fix the tests'])).toEqual({
      kind: 'start', harness: 'claude', background: true, prompt: 'fix the tests',
    })
  })

  it('attaches by default when --bg is absent', () => {
    expect(parseSessionArgs(['claude', '-p', 'hi'])).toEqual({
      kind: 'start', harness: 'claude', background: false, prompt: 'hi',
    })
  })

  it('reads model, effort, cwd and name', () => {
    expect(parseSessionArgs([
      'codex', '-p', 'do X', '--model', 'o3', '--effort', 'high', '--cwd', '/srv/app', '--name', 'refactor auth',
    ])).toEqual({
      kind: 'start', harness: 'codex', background: false, prompt: 'do X',
      model: 'o3', effort: 'high', cwd: '/srv/app', label: 'refactor auth',
    })
  })

  it('accepts a start with no prompt at all', () => {
    expect(parseSessionArgs(['kimi'])).toEqual({ kind: 'start', harness: 'kimi', background: false })
  })

  it('reads the subcommands', () => {
    expect(parseSessionArgs(['list'])).toEqual({ kind: 'list' })
    expect(parseSessionArgs(['attach', 'a1'])).toEqual({ kind: 'attach', ref: 'a1' })
    expect(parseSessionArgs(['kill', 'a1'])).toEqual({ kind: 'kill', ref: 'a1' })
    expect(parseSessionArgs(['rename', 'a1', 'refactor auth'])).toEqual({ kind: 'rename', ref: 'a1', label: 'refactor auth' })
    expect(parseSessionArgs(['note', 'a1', 'split the god object'])).toEqual({ kind: 'note', ref: 'a1', text: 'split the god object' })
  })

  it('rejects a harness that is not a harness', () => {
    expect(parseSessionArgs(['nonsense'])).toEqual({ kind: 'error', message: expect.stringContaining('nonsense') })
  })

  it('rejects a flag with no value instead of swallowing the next token', () => {
    expect(parseSessionArgs(['claude', '--model'])).toEqual({ kind: 'error', message: expect.stringContaining('--model') })
    expect(parseSessionArgs(['claude', '--model', '--bg'])).toEqual({ kind: 'error', message: expect.stringContaining('--model') })
  })

  it('rejects a subcommand missing its reference', () => {
    expect(parseSessionArgs(['attach'])).toEqual({ kind: 'error', message: expect.stringContaining('attach') })
    expect(parseSessionArgs(['rename', 'a1'])).toEqual({ kind: 'error', message: expect.stringContaining('rename') })
  })

  it('asks for help with no arguments', () => {
    expect(parseSessionArgs([])).toEqual({ kind: 'help' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/sessions/cli-parse.test.ts`
Expected: FAIL — `Cannot find module './cli-parse'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/server/sessions/cli-parse.ts`:

```ts
/**
 * cli-parse.ts — PURE. `agentop session …` argv -> a typed command.
 *
 * Pure so the argv shape is tested without spawning anything. Note `-p` here is OURS and means the
 * PROMPT: it is not forwarded to the harness as `-p`, which on `claude` and `kimi` means "print and
 * exit" and on `codex` means "profile". `planSpawn` decides how each harness actually receives it.
 *
 * A flag whose value is missing is an ERROR, never a swallowed neighbour — the exact bug
 * `cli.ts`'s `readFlag` comment already warns about for `agentop member`.
 */

import { HARNESS_ORDER, type HarnessId } from '@agentistics/core'

export type SessionCommand =
  | {
      kind: 'start'
      harness: HarnessId
      background: boolean
      prompt?: string
      model?: string
      effort?: string
      cwd?: string
      label?: string
    }
  | { kind: 'list' }
  | { kind: 'attach'; ref: string }
  | { kind: 'kill'; ref: string }
  | { kind: 'rename'; ref: string; label: string }
  | { kind: 'note'; ref: string; text: string }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

const VALUE_FLAGS = new Set(['-p', '--prompt', '--model', '--effort', '--cwd', '--name'])

function isHarness(v: string): v is HarnessId {
  return (HARNESS_ORDER as readonly string[]).includes(v)
}

export function parseSessionArgs(argv: string[]): SessionCommand {
  const head = argv[0]
  if (!head) return { kind: 'help' }

  if (head === 'list') return { kind: 'list' }

  if (head === 'attach' || head === 'kill') {
    const ref = argv[1]
    if (!ref) return { kind: 'error', message: `Usage: agentop session ${head} <id|name>` }
    return { kind: head, ref }
  }

  if (head === 'rename') {
    const ref = argv[1]
    const label = argv.slice(2).join(' ').trim()
    if (!ref || !label) return { kind: 'error', message: 'Usage: agentop session rename <id|name> "label"' }
    return { kind: 'rename', ref, label }
  }

  if (head === 'note') {
    const ref = argv[1]
    const text = argv.slice(2).join(' ').trim()
    if (!ref || !text) return { kind: 'error', message: 'Usage: agentop session note <id|name> "text"' }
    return { kind: 'note', ref, text }
  }

  if (!isHarness(head)) {
    return {
      kind: 'error',
      message: `Unknown harness or action: ${head}. Expected one of ${HARNESS_ORDER.join(', ')} — or list, attach, kill, rename, note.`,
    }
  }

  const cmd: Extract<SessionCommand, { kind: 'start' }> = {
    kind: 'start', harness: head, background: false,
  }

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--bg' || arg === '--background') { cmd.background = true; continue }
    if (!VALUE_FLAGS.has(arg)) {
      return { kind: 'error', message: `Unknown option: ${arg}` }
    }
    const value = argv[i + 1]
    if (value === undefined || VALUE_FLAGS.has(value) || value === '--bg' || value === '--background') {
      return { kind: 'error', message: `Missing value for ${arg}` }
    }
    i++
    if (arg === '-p' || arg === '--prompt') cmd.prompt = value
    else if (arg === '--model') cmd.model = value
    else if (arg === '--effort') cmd.effort = value
    else if (arg === '--cwd') cmd.cwd = value
    else if (arg === '--name') cmd.label = value
  }

  return cmd
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/sessions/cli-parse.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/sessions/cli-parse.ts packages/server/server/sessions/cli-parse.test.ts
git commit -m "feat(sessions): pure argv parser for the session command"
```

---

### Task 7: The `agentop session` command

**Files:**
- Create: `packages/server/server/sessions/cli-session.ts`
- Modify: `packages/server/bin/cli.ts` (add the `session` block beside `if (command === 'member')`, ~line 378; add the block to `HELP`)
- Create: `docs/session-manager.md`
- Modify: `CLAUDE.md` (add `sessions/` to the server module tree and `agentop session` to the CLI tree)

**Interfaces:**
- Consumes: everything exported by `sessions/index.ts` (Tasks 1–5) and `parseSessionArgs` (Task 6).
- Produces: `runSession(argv: string[]): Promise<number>` — the exit code for `cli.ts`.

- [ ] **Step 1: Write the handler**

Create `packages/server/server/sessions/cli-session.ts`:

```ts
/**
 * cli-session.ts — the `agentop session …` handlers.
 *
 * Every decision is already made by a pure module: `parseSessionArgs` says what was asked,
 * `planSpawn` says what to run, `resolveSessionRef` says which session was meant, and
 * `reconcileSessions` says what exists. This file does I/O and prints.
 */

import { HARNESS_ORDER, type HarnessId } from '@agentistics/core'
import { parseSessionArgs, type SessionCommand } from './cli-parse'
import { SPAWN_SPECS, planSpawn } from './spawn-spec'
import { reconcileSessions, resolveSessionRef } from './session-ref'
import { addSession, newSessionId, patchSession, readRegistry, removeSession } from './registry'
import { resolveBackend } from './index'
import type { SessionBackend, SpawnPlanError } from './types'

/** Derived from the specs, never a second hand-written list — the two could not then disagree. */
const STARTABLE: HarnessId[] = HARNESS_ORDER.filter(h => SPAWN_SPECS[h] !== null)

const USAGE = `Usage:
  agentop session <harness> [-p "prompt"] [--bg] [--model <id>] [--effort <level>] [--cwd <path>] [--name "label"]
  agentop session list
  agentop session attach <id|name>
  agentop session kill   <id|name>
  agentop session rename <id|name> "label"
  agentop session note   <id|name> "text"

Harnesses that can be started: ${STARTABLE.join(', ')}`

function explainPlanError(e: SpawnPlanError): string {
  switch (e.code) {
    case 'unsupported-harness':
      return `${e.harness} cannot be started by agentop yet. Supported: ${STARTABLE.join(', ')}.`
    case 'model-unsupported':
      return `${e.harness} has no model flag, so --model cannot be applied.`
    case 'effort-unsupported':
      return `${e.harness} has no effort flag, so --effort cannot be applied.`
    case 'unknown-effort':
      return `${e.harness} does not accept effort "${e.value}". Accepted: ${e.accepted.join(', ')}.`
  }
}

export async function runSession(argv: string[]): Promise<number> {
  const cmd = parseSessionArgs(argv)
  if (cmd.kind === 'help') { console.log(USAGE); return 0 }
  if (cmd.kind === 'error') { console.error(cmd.message); console.error(`\n${USAGE}`); return 1 }

  const backend = await resolveBackend()
  const blocked = await backend.unavailable()
  if (blocked) { console.error(blocked); return 1 }

  switch (cmd.kind) {
    case 'start': return start(cmd, backend)
    case 'list': return list(backend)
    case 'attach': return attach(cmd.ref, backend)
    case 'kill': return kill(cmd.ref, backend)
    case 'rename': return patch(cmd.ref, { label: cmd.label }, 'renamed')
    case 'note': return patch(cmd.ref, { note: cmd.text }, 'annotated')
  }
}

async function start(
  cmd: Extract<SessionCommand, { kind: 'start' }>,
  backend: SessionBackend,
): Promise<number> {
  const cwd = cmd.cwd ?? process.cwd()
  const planned = planSpawn({
    harness: cmd.harness, cwd, prompt: cmd.prompt, model: cmd.model, effort: cmd.effort,
  })
  if (!planned.ok) { console.error(explainPlanError(planned.error)); return 1 }

  const id = newSessionId()
  try {
    await backend.spawn({ id, cwd, argv: planned.plan.argv, ...(planned.plan.sendKeys ? { sendKeys: planned.plan.sendKeys } : {}) })
  } catch (e) {
    console.error(`Could not start the session: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }

  await addSession({
    id,
    harness: cmd.harness,
    cwd,
    createdAt: new Date().toISOString(),
    ...(cmd.model ? { model: cmd.model } : {}),
    ...(cmd.effort ? { effort: cmd.effort } : {}),
    ...(cmd.label ? { label: cmd.label } : {}),
  })

  if (cmd.background) {
    console.log(`Started ${cmd.harness} session ${id}${cmd.label ? ` (${cmd.label})` : ''} in ${cwd}`)
    console.log(`Attach with: agentop session attach ${id}`)
    return 0
  }
  return execAttach(id, backend)
}

/**
 * Hand the terminal over. The detach key is READ from the backend and printed first — a user who
 * cannot get out is stranded in a buffer that hides their shell, and the key is not always Ctrl-b.
 */
async function execAttach(
  id: string,
  backend: SessionBackend,
): Promise<number> {
  const hint = await backend.detachHint()
  console.log(`Attaching to ${id}. To leave the session running and come back here, press ${hint}.`)
  const [bin, ...rest] = backend.attachCommand(id)
  const p = Bun.spawn([bin!, ...rest], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  return await p.exited
}

async function list(backend: SessionBackend): Promise<number> {
  const rows = reconcileSessions(await readRegistry(), await backend.list())
  if (rows.length === 0) { console.log('No sessions.'); return 0 }
  for (const r of rows) {
    const harness = r.managed?.harness ?? 'unknown'
    const name = r.managed?.label ?? ''
    const cwd = r.managed?.cwd ?? ''
    console.log(`${r.id}\t${r.status}\t${harness}\t${name}\t${cwd}`)
  }
  return 0
}

async function attach(ref: string, backend: SessionBackend): Promise<number> {
  const found = resolveSessionRef(await readRegistry(), ref)
  if (!found.ok) { console.error(refError(ref, found.reason, found.matches)); return 1 }
  return execAttach(found.session.id, backend)
}

async function kill(ref: string, backend: SessionBackend): Promise<number> {
  const found = resolveSessionRef(await readRegistry(), ref)
  if (!found.ok) { console.error(refError(ref, found.reason, found.matches)); return 1 }
  await backend.kill(found.session.id)
  await removeSession(found.session.id)
  console.log(`Killed ${found.session.id}.`)
  return 0
}

async function patch(
  ref: string,
  fields: { label?: string; note?: string },
  verb: string,
): Promise<number> {
  const registry = await readRegistry()
  const found = resolveSessionRef(registry, ref)
  if (!found.ok) { console.error(refError(ref, found.reason, found.matches)); return 1 }
  await patchSession(found.session.id, fields)
  console.log(`${found.session.id} ${verb}.`)
  return 0
}

function refError(ref: string, reason: 'not-found' | 'ambiguous', matches: string[]): string {
  return reason === 'not-found'
    ? `No session matches "${ref}". Run \`agentop session list\` to see them.`
    : `"${ref}" matches more than one session: ${matches.join(', ')}. Use a full id.`
}
```

- [ ] **Step 2: Wire the command into `cli.ts`**

In `packages/server/bin/cli.ts`, immediately before `if (command === 'member') {` (~line 378), add:

```ts
if (command === 'session') {
  const { runSession } = await import('../server/sessions/cli-session.ts')
  const code = await runSession(args)
  process.exit(code)
}
```

- [ ] **Step 3: Add the command to `HELP`**

In the `HELP` template literal in `packages/server/bin/cli.ts` (starts at line 45), the `Commands:`
block lists one command per line, indented two spaces, with the description starting at column 17.
Insert one line directly **after** the `member` entry (`  member        Configure this machine as a
team member`, line 61) and before the `ci-push` entry:

```
  session       Start / list / attach assistant sessions (tmux-backed; --bg detaches)
```

- [ ] **Step 3b: Verify the alignment did not drift**

Run: `bun run packages/server/bin/cli.ts --help`
Expected: the `session` description starts in the same column as `member`'s and `ci-push`'s.

- [ ] **Step 4: Verify the whole command end to end**

```bash
bun run packages/server/bin/cli.ts session
```
Expected: the usage block, exit 0.

```bash
bun run packages/server/bin/cli.ts session nonsense
```
Expected: `Unknown harness or action: nonsense…`, exit 1.

```bash
bun run packages/server/bin/cli.ts session claude --effort ultra -p hi
```
Expected: `claude does not accept effort "ultra". Accepted: low, medium, high, xhigh, max.`, exit 1,
and **no** session created.

```bash
bun run packages/server/bin/cli.ts session claude --bg -p "say hello and stop" --name "smoke test"
bun run packages/server/bin/cli.ts session list
```
Expected: the start prints an id and the attach hint; `list` shows one `running` row whose harness is
`claude` and whose name is `smoke test`.

```bash
bun run packages/server/bin/cli.ts session rename <id> "renamed smoke"
bun run packages/server/bin/cli.ts session list
```
Expected: the row's name is now `renamed smoke`.

```bash
bun run packages/server/bin/cli.ts session kill <id>
bun run packages/server/bin/cli.ts session list
```
Expected: `Killed <id>.` then `No sessions.`

- [ ] **Step 5: Write the user documentation**

Create `docs/session-manager.md`:

```markdown
# Session manager

`agentop session` starts, lists, attaches to, names and stops assistant sessions. Background
sessions are hosted by tmux on its own socket (`-L agentop`), so they survive `agentop` exiting and
never mix with your own tmux sessions.

## Requirements

tmux (Linux, macOS). Windows support arrives with the PTY backend; until then `agentop session`
reports that tmux is required rather than failing at spawn time.

## Commands

    agentop session <harness> [-p "prompt"] [--bg] [--model <id>] [--effort <level>] [--cwd <path>] [--name "label"]
    agentop session list
    agentop session attach <id|name>
    agentop session kill   <id|name>
    agentop session rename <id|name> "label"
    agentop session note   <id|name> "text"

`--bg` detaches and returns immediately. Without it the session takes over your terminal; the
detach keystroke is printed before it does, read from your own tmux prefix rather than assumed.

`--cwd` defaults to the directory you are in.

## Harness support

| Harness | Prompt | `--model` | `--effort` |
|---|---|---|---|
| claude | positional argument | yes | `low, medium, high, xhigh, max` |
| codex | positional argument | yes | not supported |
| kimi | typed into the session | yes | not supported |
| gemini, copilot, antigravity | not startable yet | — | — |

`kimi` has no flag for an initial prompt in an interactive session — its `-p` runs one prompt
non-interactively and exits — so agentop types the prompt in for you once the session is up.

Codex's reasoning effort is a `-c key=value` configuration override rather than a flag; it is not
wired up because the key could not be verified from the CLI itself, and agentop does not guess flags.

## Where state lives

`~/.agentistics/managed-sessions.json` — the sessions agentop started, with their labels and notes.
tmux is authoritative about what is running; this file is authoritative about what it means.
```

- [ ] **Step 6: Update `CLAUDE.md`**

In the server module list, after the `cli-setup.ts / cli-central.ts / cli-member.ts` entry, add:

```
  ├── sessions/            → the session manager: `SessionBackend` (tmux today, a per-session
  │                          ConPTY host on Windows in Phase 4), the PURE `spawn-spec.ts`
  │                          (`Record<HarnessId, SpawnSpec|null>` — a harness with no spec is
  │                          ABSENT from the wizard, never offered and failing), the PURE
  │                          `tmux-cli.ts` (every tmux argv and parse), `session-ref.ts` and the
  │                          `managed-sessions.json` registry. **Every flag is read from the
  │                          tool's own `--help`, never guessed** — codex's reasoning effort is
  │                          deliberately absent for that reason. See docs/session-manager.md
```

In the CLI tree, after the `agentop member …` line, add:

```
  ├── agentop session …    → server/sessions/cli-session.ts (start/list/attach/kill/rename/note;
  │                          `--bg` detaches via tmux, attach prints the REAL detach key)
```

- [ ] **Step 7: Run the full suite**

Run: `bun tsc --noEmit && bun test`
Expected: no type errors; all tests pass, including the ~51 added by this plan.

- [ ] **Step 8: Commit**

```bash
git add packages/server/server/sessions/cli-session.ts packages/server/bin/cli.ts docs/session-manager.md CLAUDE.md
git commit -m "feat(sessions): agentop session command"
```

---

## Done when

- `agentop session claude --bg -p "…"` starts a detached session and returns immediately.
- `agentop session claude -p "…"` attaches, having first printed the real detach keystroke.
- `agentop session list` shows managed sessions with their status, harness, label and directory.
- `agentop session attach|kill|rename|note` resolve a session by id, id prefix or label, and refuse
  an ambiguous reference instead of picking one.
- A harness with no spawn spec, an unknown effort value, and a missing flag value are each refused
  by name, before anything is started.
- On a machine without tmux, every one of these says so and exits non-zero — none of them crashes.
- `bun tsc --noEmit` and `bun test` pass.

## Not in this plan

Phase 2 (attention monitor + the Sessions tab), Phase 3 (project/repo search wizard + labels on the
dashboard), Phase 4 (Windows PTY backend), Phase 5 (gemini, copilot, antigravity). Each gets its own
plan against the same spec.
