# Issue triage vs the runtime/native-harness architecture

**Date:** 2026-09-20. **Read-only.** No issue, PR or project item was modified while producing this
report. Source spec: `docs/superpowers/specs/2026-09-19-agentistics-runtime-master.md` (§1, §5-§11,
§13-§19, §24, §26, §37, §40, §46, §49, §50) plus the P1/P2/P3 phase specs. Process rules from
`AGENTS.md` were read and respected (this report recommends actions for a maintainer to take; it
takes none itself).

**Total open issues:** 38 (`gh issue list --state open`, 2026-09-20).

**Critical framing fact, stated up front:** the master spec is "discovery + architecture
specification. No code is changed by this document" (its own line 3), and P1/P2/P3 are the only
*executable* phases, none of which has shipped. So **no issue can be closed today because the new
core already fixed it** — nothing has been built yet. What follows classifies issues by what the
*specification* implies, not by what exists on disk today. One issue (#248) turned out to be already
fixed for an unrelated reason, verified directly in the checked-in code; that is flagged separately.

---

## 1. Summary table

| # | Title | Bucket | Phase | One-line reason |
|---|---|---|---|---|
| 531 | docs: GitHub Sponsors section in README | UNAFFECTED | — | Pure docs/README, no architecture link |
| 446 | Chat note badge opens tab, doesn't say which item | UNAFFECTED | — | Web chat-envelope/notes UI; not part of the canonical journal or native runtime |
| 444 | Prompt sent from dashboard sits unsent, UI says delivered | RE-SCOPE | §18.2/§32 (unphased) | Root cause is tmux screen-scraping; the spec's ACP spawn-mode transport removes exactly this class of bug, but only where a Claude ACP bridge exists (**UNVERIFIED**) |
| 440 | Chat draws "no messages yet" over a live transcript | UNAFFECTED | — | Stale-path-memo bug in the legacy chat reader; untouched by the journal/native runtime |
| 419 | 44px touch target painted; values overflow cards | UNAFFECTED | — | Pure CSS/layout bug |
| 417 | Session suggestions from what a session already measures | RE-SCOPE | A5 (§18, §14.1) | Needs exactly the `context.compacted`/`context.window.observed` live events the journal defines; today's design reads `session-profile.ts`/legacy fields per-poll and is Claude-only |
| 384 | Conversation forks leave 11.4 MB unreported spend | SUBSUMED | A1/A2 (§13, `Agent.kind`) | The canonical `Agent` entity has `kind: 'fork'` as a first-class peer of `subagent`, with no `toolUseId` requirement — answers the issue's blocking product question |
| 355 | Audit every session feature for multi-harness compatibility | RE-SCOPE | P2 (§16), §13.1 | `CapabilityState` + `conversationLink` formalize exactly what a manual audit would document; some audited areas (spawn wizard, terminal write channel) are untouched by the spec |
| 351 | Reopened session loses its name/harness link | RE-SCOPE | B4 (§13.1, §24.3) partial | The persistent `Session` surviving `Run` reopens is the structural fix for the label-loss half; the harness-record-missing-field half is an independent investigation |
| 350 | Version bump doesn't stage `bun.lock` | UNAFFECTED | — | CI/release tooling |
| 346 | "One function decides the frame" invariant untested | UNAFFECTED | — | Team-mode wire-framing test gap; §23/D7 leave the wire format as-is for now |
| 345 | Release bump guard catches 1 of 6 spellings | UNAFFECTED | — | CI/release tooling |
| 344 | project-add.yml misses `reopened` PRs | UNAFFECTED | — | GitHub Actions workflow |
| 343 | Session composer loses draft on navigation | UNAFFECTED | — | Ships independently; only loosely related to the future "chat/session convergence" (§10, §24.3) |
| 342 | agentop never reaps dev servers | UNAFFECTED | — | Process lifecycle for tool-spawned side processes; **spec gap**, see §3 |
| 300 | First `/api/fleet` after boot still 29s | UNAFFECTED | — | `/api/fleet` stays a separate, cheap surface throughout every phase |
| 255 | Breaking-change marker read as substring | UNAFFECTED | — | CI/release tooling |
| 248 | Release computes wrong semver bump | UNAFFECTED (already fixed) | — | Verified fixed in code (`versionBump.ts`, `releaseWorkflow.lint.test.ts`, `tformat` in `release.yml`), unrelated to this spec |
| 225 | skill: money and tokens | UNAFFECTED | — | Documents the *current* pricing rules; still correct today |
| 224 | skill: adding a harness checklist | RE-SCOPE | P2 (§31) | The checklist changes materially once `HarnessIntegration`/`CapabilityState`/golden fixtures exist |
| 223 | skill: opening a PR | UNAFFECTED | — | Pure process |
| 222 | skill: mobile branch in the same change | UNAFFECTED | — | Pure process |
| 221 | repo: skill-loading mechanism | UNAFFECTED | — | Pure tooling/process |
| 220 | "Budget & forecast" is Claude-only and often zero | SUBSUMED | A4/P3 (§41, §41.1) | The spec names this exact feature ("burn rate... impossible without the journal") as a `costByDimension`/query-API projection |
| 219 | Panel filter-reactivity audit | RE-SCOPE | A4/P3 | The governance rule ("state whether a panel reacts") stays valid documentation; the one flagged violation is subsumed with #220 |
| 218 | "Who leads" redesign, inert chart | UNAFFECTED | — | Pure UI/UX |
| 217 | Sessions page card unreadable, action bar duplicated | UNAFFECTED | — | Pure UI/UX |
| 216 | Central's Details popover fetches an impossible transcript | UNAFFECTED | — | Consistent with D7 ("central does not receive raw chat/events"); pure UI fix |
| 215 | Central's live sessions are a stale `/proc` sample | UNAFFECTED | — | About the *existing* notification channel (§8), which the spec explicitly declines to widen (§12); **spec gap**, see §3 |
| 213 | External (VS Code) session can be seen but not acted on | UNAFFECTED | — | pty-ownership limitation; **spec gap**, see §3 |
| 212 | Wizard offers harnesses not installed | UNAFFECTED | — | Session-manager UX bug |
| 211 | User-defined session tags, one keypress | UNAFFECTED | — | TUI session-manager feature |
| 140 | Four loose ends from dimensions/highlight work | UNAFFECTED | — | TUI polish |
| 135 | `cachedEnrich` shipped unverified | UNAFFECTED | — | Verification debt in the legacy enrichment path; not rewritten by any phase in scope |
| 60 | "Plugin mode instead of daemon" | SUBSUMED | A5 (§18, D4) | Literally describes live ingestion via hooks — the spec's own recommended (D4) design |
| 56 | Secret scanner/obfuscator in transcripts | RE-SCOPE | D5 (weak) | D5 decides what text the *new* journal may store; doesn't address existing local `~/.claude` files, but the policy should be made once, not twice |
| 55 | macOS launchd autostart | UNAFFECTED | — | Platform/service-manager feature, orthogonal to the runtime |
| 52 | 21 pre-existing dependency advisories | UNAFFECTED | — | Dependency security maintenance |

**Bucket totals:** SUBSUMED 3 · RE-SCOPE 7 · UNAFFECTED 28 (one of which, #248, is already fixed for
an unrelated reason) · OBSOLETE 0 · BLOCKED-BY-CORE 0 · CONFLICTS 0.

---

## 2. Per-bucket detail

### SUBSUMED (3)

**#384 — Conversation forks leave 11.4 MB unreported agent spend.**
The issue's own blocker is a schema question: `AgentInvocation.toolUseId` is required today, and a
fork has none, so filing it needs either an optional field (a stored-shape change requiring an
AGENTS.md Discussion) or treating the fork as a separate conversation. The master spec's canonical
`Agent` entity (§13) already answers this: `kind: 'main' | 'subagent' | 'fork'`, with no
`toolUseId`/`providerRequestId` requirement (correlation is optional and inferred where absent).
Once A1/A2 ship, a fork is representable as a first-class `Agent` under its parent `Run` without
inventing a key or debating whether it is "its own conversation." The product question the issue
raises is exactly the one §13's design already took a position on.

**#220 — "Budget & forecast" budgets against Claude-only data.**
`BudgetPanel` reads raw `statsCache.dailyModelTokens` (Claude-only, per CLAUDE.md's stated rule) and
ignores every filter, so it is zero for non-Claude-heavy machines and never reflects the active
filter set. §41.1 of the master spec names the underlying capability by name: "Burn rate... is a
rate over `model.completed` events, so it is a one-line projection once the journal exists and is
impossible without it" — i.e., the *architecturally correct* fix requires the journal's
`costByDimension` projection (P3/A4), not another per-harness patch to `useDerivedStats`.

**#60 — "Plugin mode instead of daemon."**
The issue asks for exactly what the master spec's D4 recommends and A5 delivers: measuring
tokens/cache/model/usage at each turn via hooks (a "plugin mode") rather than post-hoc file
watching, persisted directly rather than reconstructed by a poll. This is the clearest 1:1 match in
the batch.

### RE-SCOPE (7)

**#444 — A prompt sent from the dashboard sits unsent while the UI says delivered.**
Root cause (`submit-check.ts`'s `frameChanged` heuristic firing true on a busy pane's own spinner
churn) is a real, present-tense bug. But the master spec names the actual fix: §18.4/§32 specify ACP
as a **spawn-mode transport** — "removes screen-scraped approvals and dialog parsing for those runs"
— for harnesses that speak it natively (gemini, copilot, kimi; Claude only through a bridge marked
**UNVERIFIED**). Recommendation: keep the `needsSecondReturn` heuristic as the interim fix (it
already ships, per CLAUDE.md), but track the real resolution as "drive spawned Claude sessions over
ACP once a bridge is confirmed" rather than continuing to harden the screen-scrape check. Note this
work has no letter in the A/B roadmap tables (§46/§49) — it sits in §32, which is in-scope for the
document but not phased. That absence is itself worth a maintainer decision.

**#417 — Session suggestions: act on what a running session already measures.**
The proposed design (`session-profile.ts` baselines + `session-suggestions.ts` cards) is sound and
largely already-fielded (CLAUDE.md documents `compact_count`/`skill_uses` as fields that already
exist and travel). But it is built on post-hoc reads of a session's SessionMeta on each poll, and is
Claude-only because `HARNESS_CAPABILITIES.compaction` is Claude-only. The master spec's live event
types `context.compacted` and `context.window.observed` (§14.1) are precisely the missing signal —
once A5 (live ingestion) exists, "this session is about to lose its context" becomes a real-time
event rather than something inferred from a poll, and cross-harness naturally, once other harnesses'
capability entries are declared (P2). Recommend building the UI on top of live ingestion events
instead of directly on `session-profile.ts`.

**#355 — Audit every Sessions feature for multi-harness compatibility.**
The audit's three questions per feature ("which harnesses work today", "what blocks the others",
"is it worth closing the gap") map almost exactly onto §16's `CapabilityState` (`supported` /
`partial` / `not_supported` / `unknown`, each with a reason) and §13.1's `conversationLink`
(`assigned` / `observed` / `none`). Once P2 ships honest per-harness capability declarations, much of
what this audit would produce becomes a structural, queryable fact instead of a hand-written table.
But the audit's scope is wider than metrics capability — it also covers spawn flags, the terminal
write channel, and dialog/approval parsing, none of which the canonical model changes. Recommend
narrowing the audit to what P2 doesn't already answer once P2 ships, rather than writing the whole
table by hand now.

**#351 — A reopened session loses its name, and the harness's exact link is gone.**
Two independent causes. (a) `~/.claude/sessions/<pid>.json` no longer carries `tmuxSession` on this
machine (0/160 files) — an upstream Claude Code question, unaffected by anything in this
specification, needs its own investigation. (b) A reopened session mints a fresh `managedId` and the
old record (holding the user's label) is retired, so the label doesn't travel. The master spec's
`Session`/`Run` split (§13.1: "a conversation reopened N times is N Runs and ONE conversationId") is
the structural answer to (b) — a `Session` persists identity (and could persist a label) across
`Run` reopens the way today's `ManagedSession` registry does not. This is B4 territory (session
persistence, resume, shared access), which is track B's fourth of seven steps — not imminent. A
stopgap that keys the label off `conversationId` rather than the per-spawn `managedId` is reasonable
to ship now and does not conflict with the eventual model.

**#224 — skill: adding a harness — the complete checklist.**
Accurately documents *today's* checklist (`HarnessId` → `HARNESS_CAPABILITIES` → `HARNESS_SORT`,
boolean capabilities, one adapter module). Once P1/P2 ship, adding a harness additionally means
implementing `HarnessIntegration` (`replay`/`live`), declaring `CapabilityState` (not a boolean), and
supplying golden fixtures (§42) for the parity matrix. The skill is correct today and will need a
second pass once P2 lands — recommend leaving it open and flagging it as tied to P2's completion.

**#219 — A panel either reacts to filters or says it does not — audit and state the rule.**
The governance rule itself ("declare filter-reactivity explicitly") is timeless documentation work
independent of any architecture change and should ship regardless. The one violation the audit
found (`BudgetPanel`) is the same root cause as #220 and is subsumed by A4/P3 alongside it. Keep the
rule/documentation half; the fix half merges into #220's resolution.

**#56 — secret scanner / obfuscator in session transcripts.**
No issue body beyond the title, so this is the weakest RE-SCOPE in the batch. D5 of the master spec
("What may the journal store of conversation text?") decides an adjacent but distinct question — what
the *new* canonical journal is allowed to retain — recommending "metadata + tool summaries by default;
full text only for native runs under existing archive consent." That is a different question from
scrubbing secrets already resting in `~/.claude`'s raw local files, which this spec does not touch at
all. Recommend deciding D5 and this issue's redaction policy together so the product doesn't end up
with two independent secret-handling rules.

### UNAFFECTED (28)

The large majority: CI/release tooling (#350, #346, #345, #344, #255, #248), documentation/skill
process issues (#531, #225, #223, #222, #221), pure web/UI layout and interaction bugs (#446, #440,
#419, #418→218, #217, #216, #343), session-manager/TUI operational features orthogonal to the
metrics/native-harness architecture (#342, #300, #212, #211, #140, #135, #215, #213, #55, #52). None
of these touch the canonical event model, the adapter contract, capability declarations, the native
runtime, or ALM — the areas this specification actually redraws. Three of them (#342, #215, #213)
are flagged separately in §3 below because, while unaffected by anything the spec *proposes*, they
reveal something the spec has no answer for at all.

**#248 is a special case**, verified directly rather than inferred: `packages/core/src/versionBump.ts`
and `packages/core/src/releaseWorkflow.lint.test.ts` exist, and `.github/workflows/release.yml` uses
`--pretty=tformat:` throughout — exactly the fix the issue requested. This is unrelated to the
runtime architecture; it was already fixed by prior, unrelated work. See §4.

### OBSOLETE, BLOCKED-BY-CORE, CONFLICTS — none found

- **OBSOLETE (0):** no open issue asks for a workaround to a mechanism the spec deletes. The spec is
  explicit that "no harness is removed or deprecated" and every legacy path keeps serving every
  surface through every phase (§3, §13.2, §46) — there is nothing in flight for the new core to make
  meaningless outright.
- **BLOCKED-BY-CORE (0):** nothing in the open backlog sits squarely inside code a phase is about to
  rewrite. The closest candidates (#135, cachedEnrich; #351, ManagedSession) were examined and
  rejected: P1's shadow writer taps the existing Claude parse path without rewriting it, and the
  tmux-based `ManagedSession` registry is not superseded by any phase in the given roadmap (B4 is
  about the *native* runtime's own session model, not the external-harness fleet manager). If a
  maintainer starts implementing P1/P2, this could change for anything touching `data.ts`'s
  13-step build or `jsonl.ts`'s fold — worth re-checking the open backlog against those files once
  that work starts.
- **CONFLICTS (0):** no open issue asks for something a §50 decision argues against. #60 comes
  closest in spirit to a "the product should work differently" request, but it is endorsed by D4,
  not opposed.

---

## 3. Issues the spec does not cover

These reveal a real requirement the architecture has no answer for — the most valuable rows in this
report, since they were found by users, not invented for this exercise.

1. **#215 — the central's live-sessions view is a stale poll, not the machines' real fleet.**
   The fix this issue wants (push-on-transition from member to central, using the existing
   `attention.ts`/`events/` transition detector) is about the **notification/attention channel**
   (master spec §8), not the new metrics journal. The spec is explicit that it does **not** widen
   that channel (§12) and separately defers extending the metrics journal to team mode (D7:
   "not in the first phases... phase 4+, undecided"). So a real, present-tense product gap — "I
   cannot see what my fleet is doing from the central without a ~12s lag" — has **no phase, and no
   open decision, that actually proposes to close it.** D7 talks about *metrics* reaching the
   central; nobody has proposed extending the *notification* channel there, which is what this issue
   actually needs.

2. **#342 — agentop never reaps dev servers its sessions start.**
   The native runtime's `SchedulerRuntime` (§24.4) governs admission and concurrency for **runs**
   the runtime itself owns — but a `ToolExecution` (§13) that starts a long-lived side process (a
   dev server, a watcher) has no lifecycle entity at all in the canonical model. Nothing in §13's
   `ToolExecution` fields (`startedAt`/`endedAt`/`status`) distinguishes "the tool call returned" from
   "the process it started is still running." This is a gap even for the **native** harness the spec
   is designing: if the native agent runs `bun run dev` as a shell tool, the model as specified has
   no way to track, attribute, or reap that child process either. Worth raising before B3 (the tool
   loop) is implemented, not after.

3. **#213 — an external session (VS Code) can be identified and then not acted on at all.**
   §32's four execution modes (Spawn / Attach / Observe / Instrument) cover every session agentop
   either started or is watching, but none of them covers "take over a process that is not ours and
   was never spawned by agentop" — which is exactly the VS Code case. `Attach` is explicitly "an
   existing tmux session it **owns**." The issue's own investigation concludes the process-level
   migration is very likely impossible (no portable `reptyr`), and proposes a conversation-level
   claim instead — the spec's `conversationLink` model would express that outcome cleanly if someone
   decided to build it, but nothing in §32 anticipates "adopt a foreign process's conversation" as a
   named mode. Worth adding as a fifth row to that table (even if its answer is "refused, in words,
   here is why") so the taxonomy is complete rather than silently missing a case.

---

## 4. Candidates for immediate closure

**One, with an important caveat about why the rest are not here.**

Because the master spec is "discovery + architecture specification. No code is changed by this
document," and P1–P3/B1–B7 have not shipped, **no issue can be closed today on the grounds that "the
new core already fixed it"** — nothing has been built yet. SUBSUMED and RE-SCOPE issues above should
stay open, ideally annotated with the phase they are tied to, so they resurface for re-triage once
that phase actually ships.

- **#248 — Release computes the wrong semver bump.** Closeable now, but for a reason unrelated to
  this exercise: verified directly in the current checkout that `packages/core/src/versionBump.ts`
  and `packages/core/src/releaseWorkflow.lint.test.ts` exist, and `.github/workflows/release.yml`
  reads commits with `--pretty=tformat:'%s'` (not `format:`) at both the bump and changelog steps —
  exactly the fix the issue requested, including extracting the calculation to a tested pure
  function. Suggested closing note for a maintainer: *"Fixed by the `versionBump.ts` extraction and
  the `tformat:` correction, both now in `dev`/`main`; `releaseWorkflow.lint.test.ts` guards the
  regression. Verified 2026-09-20."*

**Confidence:** 1 of 38 issues is a confident, ready-to-paste closure. The other **37 are not
confident closures** — 34 because they are genuinely unaffected by this specification and need their
own resolution regardless of it, and 3 (#384, #220, #60, classified SUBSUMED) because "subsumed"
here means *the design already answers the question*, not that any code implementing that answer
exists yet. Closing a SUBSUMED issue before P1/A4/A5 actually ship and are verified against the
parity matrix (§40) would be premature — the master spec itself treats a `regression` row in that
matrix as a phase-blocking defect, which is the discipline this triage should mirror rather than
pre-empt.
