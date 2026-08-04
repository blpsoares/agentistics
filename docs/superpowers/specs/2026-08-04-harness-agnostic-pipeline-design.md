# Harness-agnostic pipeline — design

**Date:** 2026-08-04
**Status:** approved, not yet implemented
**Scope:** the two halves of "nothing may be Claude-specific": repository/project discovery, and
per-session activity metrics.

---

## 1. The problem, as observed

Installing agentistics on a teammate's machine surfaced two symptoms that share one cause.

**Symptom A — a repository only exists once Claude has been there.** The machine had sessions from
other harnesses in several repositories. None of them was attributed to a repository or surfaced as
a project until a *Claude Code* session was started in that same directory.

**Symptom B — bash calls, commits and line counts are only ever Claude's.** Every other harness
reports zero, in a product whose whole premise is that it compares harnesses.

### The cause

`getGitRemote()` and `getProjectGitStats()` are called from **`scanProjectDir`**, which exists inside
the walk of `~/.claude/projects/` (`data.ts:335,340`). No non-Claude adapter touches git at all —
`codex.ts`, `gemini.ts`, `kimi.ts` and `antigravity.ts` contain zero references to `git_remote`.

So a repository is discovered as a side effect of Claude having a project directory. Everything else
inherits the remote only through `backfillGitRemote`, which links a remote-less session to one that
*another* session at the same path already resolved — and until a Claude session exists there, no
session at that path ever resolved one.

The same shape produces Symptom B. `SessionMeta.git_commits` / `git_pushes` come from `jsonl.ts:300`,
a regex over the Bash commands in a **Claude transcript**; every adapter hardcodes `git_commits: 0`.

**`~/.claude` is the centre of the pipeline and every other harness is an appendix.** That is the
defect. It is one defect with two faces.

---

## 2. Decisions taken

| Question | Decision |
|---|---|
| Source of truth for commits/lines/files | **Both, separately labelled.** The transcript says what the *session* did; git says what happened in the *repository*. They are different facts and neither is a correction of the other. |
| How the two appear | **One KPI meaning "by assistants"**, with the repository figure as a secondary line beneath it. |
| Round scope | **Agnostic core + adapters where the data is proven.** A capability is declared `true` only against a real transcript; anything else stays `N/A` with the reason written down. |

### Why "both", and why the KPI means assistants

A repository's `git log` includes commits made by hand, by CI, and by a teammate on the same
checkout. Rating an assistant with that number credits it for work it did not do. Conversely, the
transcript cannot see a commit made in another terminal. Neither number is wrong; they answer
different questions, and today's code silently switches between them — `useData` prefers project
`git_stats` when a project filter is active and per-session counts otherwise, so **the same card
means different things depending on an unrelated filter**. That is the part that has to end.

The KPI becomes the **assistant** number because it is the one that is summable, filterable by
harness, and consistent with tokens and cost, which are all per-session. The repository number is
context, and it is rendered as context.

### Why not "paridade total"

Measured on the reporting machine: Gemini has 27 chat files of **202 bytes each** — all bootstrap
stubs, the case `gemini-parse.ts` already filters; Antigravity has no `brain/` directory; Kimi is not
installed. For Gemini and Kimi there is no transcript to prove anything against. (Antigravity is
still in scope: its shape is already pinned by fixtures committed to the repo, which is evidence of
the same kind.) Declaring a capability `true`
without one renders a **confident `0`**, which the project already treats as worse than `N/A`
(`HARNESS_CAPABILITIES`). A promise of parity would be a promise to fabricate.

---

## 3. Design

### 3.1 Discovery becomes a post-merge step

Extract the git resolution out of the Claude walk and into a step that runs after **all** sessions —
Claude, adapters, team — are in one list.

```
resolveProjectFacts(projects, sessions)
  ├─ distinct project_path values from ANY harness
  ├─ getGitRemote(path)                     memoized per path, under createLimiter
  ├─ getProjectGitStats(path, earliest)     earliest session of ANY harness at that path
  └─ stamp:
       session.git_remote   (only where absent — an ingested/CI value is authoritative)
       project.gitRemote
       project.git_stats
```

**Properties**

- A repository exists because a *directory* is a git repository, never because a particular harness
  visited it.
- `getProjectGitStats`'s window is still "since the earliest session here", but "here" now means any
  harness, so a repository used only through Codex gets the window it actually deserves.
- Memoized per path: two harnesses in one directory cost one `git config` call, not two. This is why
  the change is close to cost-neutral — the extra calls are exactly the paths that have no Claude
  session, which today are the paths reporting nothing.
- `backfillGitRemote` stays. It serves the central, which has no filesystem access to a member's
  repositories and can only link by path.
- **Never overwrite a `git_remote` that is already set.** CI ingest stamps it authoritatively from a
  repo-bound token (`stampCiSessions`); a local `git config` read must not be able to override that.

### 3.2 Session metrics become an adapter contract

The fields are already generic on `SessionMeta` (`tool_counts`, `git_commits`, `git_pushes`,
`lines_added`, `lines_removed`, `files_modified`). Only the Claude path fills them.

A new **pure** module, shared by every adapter:

```
packages/server/server/harness-activity.ts
  countGitCommands(cmd: string): { commits: number; pushes: number }
  canonicalTool(harness: HarnessId, name: string): string
```

- `countGitCommands` is the rule currently buried at `jsonl.ts:300`, lifted out, tested once, and
  used by everyone. Today it lives inside a 400-line Claude parser, which is why no adapter could
  reuse it without copying it — and a copied regex is a rule that drifts.
- `canonicalTool` maps each harness's own name onto one taxonomy — `Bash` (claude), `exec_command`
  (codex), the shell tool (copilot) all land in the same bucket. Without it the tools breakdown
  cannot be compared across harnesses, which is the page's entire purpose. It is a mapping, not an
  interpretation: an unmapped name passes through unchanged rather than being dropped.

`jsonl.ts` is refactored to call `countGitCommands` instead of holding the regex. Claude's numbers
must not move; a characterization test pins them before the change.

**Per adapter, only with evidence:**

| harness | source in the transcript | delivers | status |
|---|---|---|---|
| codex | `function_call` / `exec_command` → `arguments.cmd`, `workdir` | tool_counts, commits, pushes | **proven** on real data |
| copilot | `tool.execution_start.data.{toolName,arguments}`; `tool.execution_complete` carries a unified diff in `detailedContent` | tool_counts, lines added/removed | **proven** on real data — and `tools: false` in today's capability table is simply wrong |
| gemini | — | — | no transcript available to verify; stays `N/A`, reason recorded |
| antigravity | `RUN_COMMAND` steps carry the command in `content` (already read for `exit_code`, `antigravity-parse.ts:434`) | commits, pushes | **implementable against the fixture already in `antigravity-parse.test.ts`**, without new field work |
| kimi | — | — | not installed; stays `N/A`, reason recorded |

**The honesty rule, restated for this work:** a capability flips to `true` in the same commit that
adds the extraction and a test over a real fixture. Never before, and never "it should work".

### 3.3 "By assistants" vs "in the repository" in the UI

- `SessionMeta.git_commits` / `lines_*` / `files_modified` → **by assistants**. Summable, filterable
  by harness, per session.
- `ServerProject.git_stats` → **in the repository**. Whole-repo, whole-window, harness-blind.

The KPI shows the first, with the second as a secondary line:

```
┌─ COMMITS ───────────┐
│  42                 │
│  por assistentes    │
│  · 71 no repositório│
└─────────────────────┘
```

The filter-dependent source switch in `useData` is removed. A card's meaning must not depend on an
unrelated filter.

Where the repository figure has no meaning for the current scope (a harness filter is active, or the
scope spans many repositories) the secondary line is **omitted**, not zeroed — the same N/A rule.

**Mobile is part of this, not a follow-up.** The secondary line is one extra row inside an existing
card; it must be verified at 390px with `document.documentElement.scrollWidth <= window.innerWidth`
holding, per CLAUDE.md.

---

## 4. Non-goals

- Rewriting how tokens or cost are computed. Untouched.
- A new metric that does not exist today. This makes existing metrics honest across harnesses; it
  adds none.
- Attributing a repository commit to a harness by time-correlation. Explicitly rejected: it would
  make an estimate indistinguishable from a measurement, which is the failure this whole design is
  organized against.
- Retro-filling metrics into already-consolidated sessions. New reads recompute; old stored sessions
  keep what they have. (Worth a follow-up, not this spec.)

---

## 5. Testing

| Unit | Test |
|---|---|
| `countGitCommands` | pure table: `git commit`, `cd x && git commit`, `git push`, `git commit` inside a quoted string (must not count), `git-commit` (must not count) |
| `canonicalTool` | every harness's known names map into the shared taxonomy; an unknown name passes through unchanged |
| `resolveProjectFacts` | a project whose only sessions are Codex gets a remote; an already-stamped `git_remote` is never overwritten; two harnesses in one path resolve once |
| `jsonl.ts` characterization | Claude's `git_commits` for a fixture transcript is identical before and after the refactor |
| codex / copilot adapters | fixtures from real transcripts → expected tool counts, commits, lines |
| `useData` | the commits KPI reports the same source with and without a project filter |

No filesystem mocking: the pure functions take strings, and the IO-level tests use a temp directory,
following `workflow-metrics.test.ts`.

---

## 6. Risks

- **Cost of the git calls.** Mitigated by memoization per path plus the existing `createLimiter`.
  Worth measuring on a machine with many project directories before merge.
- **Stale paths.** A `project_path` that no longer exists must yield "no remote", never an error
  that aborts the build. `getGitRemote` already guards this; the new call site must not undo it.
- **A KPI changing meaning.** Users have been reading a number that silently switched sources. After
  this change some numbers will move. The secondary line is what explains the move, so it ships in
  the same release, not after it.
