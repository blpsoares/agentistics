# Delivery breakdown — how this project is filed on the board

**Companion to `2026-09-19-agentistics-runtime-master.md` and the phase specs.** This document says
how the work is cut into Tasks, Subtasks and groups, which model each piece gets and why, and what a
session must carry before it is dispatched. It encodes the owner's rules, stated 2026-09-20:

> **No subtask without a session. Every step traceable. A group is usually ONE session that runs
> subagents inside it. The Task is the delivery.**

## 1. The three levels, and what each one means here

| Level | Means | Rule |
|---|---|---|
| **Task** | a DELIVERY — something that is shippable and verifiable on its own | has acceptance criteria; closes only when they are met |
| **Subtask** | one unit of work | **always has a session**; a model chosen by difficulty and recorded |
| **Group** | a bundle of subtasks executed together | **one session**, which uses subagents internally; the members carry no session of their own |

That last row matches what the board already enforces: only a group or a loose subtask may hold a
session, a member of a group may not, and `done_needs_session` is skipped for a member precisely
because it could never satisfy it.

## 2. Model selection — the rule, applied

| Model | For | Examples in this project |
|---|---|---|
| **Haiku** | mechanical, localised, low-risk | moving a constant into a Record; adding a capability entry with its reason; writing a fixture; a doc page that follows an existing one |
| **Sonnet** | implementation from a written spec; multi-file reasoning; tests | every pure module (`event-id.ts`, `journal-plan.ts`, a projection); an adapter's replay path; a provider client; a route with its guard |
| **Opus** | only with explicit approval, and a recorded reason | a decision that changes the canonical model; a migration that touches existing data; a defect nobody can reproduce |

Every dispatched session records `model`, `modelSelectionReason`, and — for Opus —
`approvalRequired`, `approvedBy`, `approvalAt`. **Opus is never the default**, and "it is better" is
not a reason.

**The table is read at the ITEM level, not only at the session level** (§3.1). A session whose items
differ in difficulty hands each item the model that item earns — the same table, applied one level
down, which is where the work actually is.

## 3. What a session carries BEFORE dispatch

Non-negotiable, because a session that has to rediscover its own brief is a session that will drift:

```
harness · model (+ reason) · the objective in one sentence
the prompt, complete
the spec section it implements (file + §)
the files it may touch, and the ones it must not
acceptance criteria, copied from the Task
constraints (no commit without approval · worktree · tests must pass)
expected result (what "done" looks like, concretely)
the ITEMS it is to fan out, and the model each one gets (§3.1)
```

## 3.1 A dispatched session is an ORCHESTRATOR, not a worker

**Owner's rule, stated 2026-09-21:** every dedicated session opened to do this work **runs its
items with subagents**, and the model is **weighed per item** — by the item's own complexity, and
by the group it sits in.

So a session's prompt does not say "implement A1.3". It says: here are the three items of A1.3,
here is the model each one gets and why, fan them out, then integrate, run the tests and hand back.
The session's own context is spent on the BRIEF, the INTEGRATION and the HANDBACK — never on being
the third pair of hands.

Why this is a rule and not a preference, in this project specifically:

- **The group level already assumes it.** A group is ONE session by definition (§1), so a group
  with three items and no fan-out is three items done serially in one context window — which is
  the shape that runs out of context in the middle of the third and hands back the first two
  undescribed.
- **The items of one group are usually independent by construction.** A1.3 is (a) DDL + open,
  (b) append/read, (c) the tests; A2.5 is one field family per subagent. Fanning them out is not a
  performance trick, it is what makes the failure of one item legible as the failure of that item.
- **A model chosen per SESSION over-pays for most of what the session does.** A Sonnet session whose
  fixtures and capability-table transcription are Haiku items pays Sonnet for the Haiku work; the
  weighing has to happen where the work is, which is the item.

### The contract each dispatched session is held to

1. **Fan the items out.** One subagent per item, in parallel where the items do not depend on each
   other, and never one subagent for the whole subtask (that is just a second session with a worse
   handback).
2. **State the model per item, with its reason**, using §2's table. The reason is recorded on the
   item, not implied by the session's own model.
3. **The session's own model is the INTEGRATION's model** — it reads the returns, resolves the
   disagreements between them and writes the handback. It is Sonnet by default; it is never chosen
   to be "as strong as the hardest item", because the hardest item has its own subagent.
4. **Opus is per ITEM and still needs explicit approval** (§2). A session may not promote an item to
   Opus on its own authority, and "the group is hard" is not a reason for the group — it is an
   argument about one item.
5. **A subagent's return is evidence or it is nothing.** Each item comes back with what it changed,
   what it ran, and what it could not verify. The session may not launder an item's uncertainty
   into its own confident summary — §5's rule, applied one level down.
6. **The session integrates; the subagents do not commit.** One diff per subtask, staged by explicit
   path, reviewed by the session before it is offered for approval.

### What this changes in the filing

Every `stagedSession` draft in this project therefore carries an ITEM LIST — the pieces to fan out,
with a model and a one-line reason each — and not only the subtask's prompt. A draft that names no
items is a draft that has not been thought through: either the work really is one item (say so, and
the session runs it as one subagent plus its own integration) or the items exist and are missing.

## 4. The breakdown — Track A first phases

### Task A1 · The canonical model and the journal
*Delivery: a machine can write and read canonical events; nothing else changes.*

| # | Subtask / group | Model | Why that model |
|---|---|---|---|
| A1.1 | `packages/core/src/canonical/` — entities, event envelope, event union | Sonnet | it is the contract everything else is written against |
| A1.2 | `event-id.ts` + its property tests (stability, distinctness, three-sources-one-id) | Sonnet | small but subtle; the whole idempotency story rests here |
| A1.3 | **Group** — the journal: schema, open/migrate, append, cursor read, stats, rejection codes | Sonnet | one session, subagents for (a) DDL+open, (b) append/read, (c) tests |
| A1.4 | `capabilities.ts` — `CapabilityState` + the mechanical migration from the booleans | Haiku | a table transcribed with its existing reasons |
| A1.5 | `agentop journal status` + the health issue when the journal is unwritable | Haiku | follows an existing verb and an existing health shape |
| A1.6 | Benchmarks for the §9 budgets, reported in the PR | Sonnet | measurement design, not typing |

### Task A2 · The Claude adapter writes events in shadow
*Delivery: with the flag on, a build writes events for every Claude session it read; appending twice changes no number.*

| # | Subtask / group | Model | Why |
|---|---|---|---|
| A2.1 | The integration registry (`Record<HarnessId, …>`, five declared absences) | Haiku | mechanical, compiler-checked |
| A2.2 | **Group** — Claude replay: fold transcript entries → events, reusing the resumable cursor | Sonnet | the hard one; subagents for run/agent, invocations, tools |
| A2.3 | The shadow writer in `data.ts`, failure-isolated, flag-gated | Sonnet | it touches the build path; the failure test matters more than the code |
| A2.4 | `projections/session-meta.ts` — events → the legacy shape | Sonnet | this is what parity is measured against |
| A2.5 | **Group** — the differential: fixtures + a real-store comparison + the report | Sonnet | subagents per field family (tokens, time, tools, agents) |

### Task B1 · The provider client and the first real call
*Delivery: the product can call Anthropic with the user's API key and record the exact usage of that call.*

| # | Subtask / group | Model | Why |
|---|---|---|---|
| B1.1 | `ProviderClient` interface + the usage mapping type | Sonnet | the contract five providers will implement |
| B1.2 | **Group** — the Anthropic client: request, response, usage, request id, errors | Sonnet | subagents for the call, the usage mapping, the error taxonomy |
| B1.3 | Credential handling: entry, storage (0600), never logged/audited/returned | Sonnet | security-shaped; the existing `envelope-keys.ts` discipline is the model |
| B1.4 | `model.invoked` / `model.completed` emission into the journal | Sonnet | the join between the two tracks |
| B1.5 | Fixtures from recorded responses + the usage-mapping tests | Haiku | transcription once the shapes are known |

## 5. Rules that apply to every session in this project

1. **A worktree per session**, branched from `origin/dev`. The repo's own rule; several agents will
   be running at once.
2. **Stage explicit paths.** Never `git add -A` — the diff is not only yours.
3. **A red test may not be yours.** Check before assuming, and say so in the handback.
4. **No commit and no PR without approval** — the standing rule in this repo.
5. **The handback states what was NOT done**, what was assumed, and what it could not verify. A
   report that only lists successes is a report that hides the next defect.
6. **Evidence closes a criterion**: tests, a benchmark, a screenshot, a parity row — attached to the
   task, not pasted into a chat.
7. **Fan the items out and weigh the model per item** (§3.1). The session integrates; it does not
   do the items itself.
8. **A subagent's uncertainty survives the integration.** What an item could not verify is named in
   the handback as unverified, attributed to that item.
9. **A session never changes its own cwd.** It creates its worktree with `git worktree add` and
   works against that path (`git -C`, absolute paths). Moving the cwd re-files the conversation's
   transcript under a different project directory, `chat-web.ts` then reads nothing, and the chat
   the owner is coordinating through goes blank while the terminal keeps working — measured on a
   live 2,4 MB conversation (see CLAUDE.md, "A TRANSCRIPT THAT IS NOT THERE YET…").
10. **The handback is a board COMMENT, not a chat message.** Principle #20 of `execucao.md`:
   nothing relevant exists only in a conversation. A replacement session must be able to resume
   from the board alone.

## 6. How the board is filled — waves, and a coordinator

**Owner's decisions, 2026-09-21:**

- **Filing is BY WAVE, not all at once.** A subtask's prompt is written after the decisions that
  shape it are answered, so filing B1 today would mean writing a prompt against an unanswered D3.
  The cost is that the board never shows the whole project at once; the benefit is that no draft is
  a guess. **The rule that comes with it**: a wave is filed complete — every subtask of it born
  with its `stagedSession` — so "no subtask without a session" holds at every moment, not only at
  the end.
- **A COORDINATOR session, attached to the mother Task.** It holds the waves, writes the drafts,
  dispatches and reads the handbacks. Its rules: it writes no product code; everything it knows
  lives on the board, so a replacement session resumes from the board and not from its context; it
  never fires a draft whose blocking decision is unanswered; it never approves an Opus item and
  never opens a PR; its model is Sonnet; and it is attached to the mother Task so the coordination
  cost is separable from the execution cost.

**The bootstrap question has dissolved.** `Subtask.stagedSession` shipped on 2026-09-18 (`38e62538`),
so a subtask is born holding a dormant prepared draft rather than empty — which is exactly the
"no subtask without a session" rule, enforced by the board instead of by discipline. What is still
missing from a draft is content, not structure (§3 and §3.1 say what).

## 7. What is still undecided and blocks a wave

- The §50 decisions that gate A1 (D1 vocabulary, D2 storage) and B1 (D3 base, D4 ingestion).
- The B3 catalogue's own three (sandbox timing, git as a tool, browser placement) — B3 is not filed
  until those are answered.
