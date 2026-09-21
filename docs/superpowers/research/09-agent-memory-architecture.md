# Agent memory architecture — design-input document

Scope note: this is a research/design-input document for a native agent harness inside
Agentistics, produced 2026-09-19. All internal file references are against the worktree
`/home/mithrandir/agentistics/.claude/worktrees/runtime-spec` (branch `spec/runtime-architecture`).
External claims carry a URL and an "accessed 2026-09-19" date; anything not directly verified from
a primary source is marked **UNVERIFIED**.

---

## PART 1 — State of the art (external)

### 1.1 Anthropic's own memory tooling

Three distinct, composable mechanisms, and the distinction between them matters for our design
because Agentistics will need an equivalent split (transient context management vs. durable
cross-session facts vs. procedural instructions).

**Memory tool (`memory_20250818`)** — [Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool), accessed 2026-09-19.
- **Storage model**: entirely client-side. The tool is a *protocol*, not a store — Claude emits
  `tool_use` requests (`view`, `create`, `str_replace`, `insert`, `delete`, `rename`) against a
  virtual `/memories` path prefix; the calling application maps that prefix onto real storage
  (files, DB rows, encrypted blobs — Anthropic ships a reference `BetaLocalFilesystemMemoryTool`
  for Python/TypeScript, but the wire contract is storage-agnostic).
- **Retrieval model**: *just-in-time*, not upfront injection. The API auto-injects one system
  instruction ("ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE... ASSUME
  INTERRUPTION") when the tool is present in `tools`; Claude decides what to read and when. This
  is the load-bearing design choice: memory is *pulled* by the model reasoning about what it needs,
  not pushed into every prompt.
- **Failure modes documented by Anthropic itself**: path traversal (`/memories/../../secrets.env`)
  is the caller's responsibility to block; unbounded file growth is the caller's responsibility to
  cap; sensitive-data leakage into memory files is only mitigated by "Claude usually refuses" plus
  caller-side scrubbing — i.e. Anthropic explicitly does NOT claim the model is a reliable secrets
  filter; memory files never expire on their own ("periodically delete memory files that haven't
  been accessed" is stated as the caller's job, not a platform guarantee).
- **Composability**: it's designed to pair with **context editing** (`clear_tool_uses_20250919`,
  server-side, [docs](https://platform.claude.com/docs/en/build-with-claude/context-editing), accessed 2026-09-19) — which clears old
  tool-result blocks from the *live context window* once it crosses a token threshold (default
  100k), replacing them with placeholders, while the memory tool is the mechanism for anything that
  must survive that clearing. Context editing invalidates the prompt-cache prefix at the point of
  clearing (a real cost — one more "layered source, cost stated" pattern we already use for
  pricing). It is explicitly NOT a memory system — it is garbage collection for the context window.
  It also composes with **compaction** (server-side full-conversation summarization near the
  context limit); Anthropic's own guidance is "compaction keeps active context small without
  client bookkeeping, memory preserves what must survive summarization" — i.e. compaction is lossy
  and memory is the durable side-channel for what must not be lost.
- **The documented multisession pattern** (a progress log + a feature checklist + init-script
  reference, each session reads on start, writes before ending) is structurally identical to what
  a native Agentistics harness would need for **medium-term (project) memory** — see Part 2.

**CLAUDE.md + auto memory** — [How Claude remembers your project](https://code.claude.com/docs/en/memory), accessed 2026-09-19.
- **CLAUDE.md** is explicit, human-authored, hierarchical (global `~/.claude/CLAUDE.md` → repo
  root → subdirectory → `CLAUDE.local.md` gitignored-personal), loaded in full at every session
  start, treated as *context, not enforced configuration* — Anthropic's own docs say to use a
  `PreToolUse` hook if you need actual enforcement, not memory. This repo's own CLAUDE.md (55KB+)
  is itself the largest live example of this pattern in the codebase — a fact worth noting: it has
  already outgrown "the more specific and concise, the more consistently Claude follows it"
  (Anthropic's own stated guidance), which is direct first-party evidence of the "prompt bloat"
  failure mode named in §1.6 below.
- **Auto memory** is the closest existing analogue to what Part 2's "long-term" tier below needs.
  Mechanics, per the same docs and cross-checked against this user's own live
  `~/.claude/projects/-home-mithrandir-agentistics/memory/MEMORY.md`:
  - Claude decides *itself*, at the end of a session, whether a correction/preference/decision is
    "worth remembering" for a **future** conversation — it explicitly does not save everything, and
    explicitly skips anything derivable from the codebase (architecture, file paths, debugging
    fixes already visible in git history).
  - Four fixed categories: **user** (role/expertise/working preferences), **feedback**
    (corrections given / approaches confirmed), **project** (ongoing work/decisions not derivable
    from code), **reference** (where to find things outside the repo).
  - Two-tier storage: an **index file** (loaded in full every session, capped at 200 lines / 25KB —
    an explicit, stated size bound) that lists topics, each linking to a **topic file** read only
    on demand. This is a real, shipped instance of the "structured facts + explicit recall, no
    embeddings" architecture option in Part 4.
  - Lives under the user's home directory, not the project's `.claude/`, i.e. it is **account/
    machine-scoped**, not repo-scoped — a design choice with a real leakage question this document
    returns to in Part 5 (a fact learned in one repo currently CAN surface in another, by design,
    which is correct for "how do I like commits written" and wrong for "this repo's schema is X").

### 1.2 OpenAI / ChatGPT memory model

[OpenAI: Memory and new controls](https://openai.com/index/memory-and-new-controls-for-chatgpt/), [Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq), accessed 2026-09-19.
- Two mechanisms, not one: **saved memories** (discrete facts, either user-requested — "remember
  X" — or model-inferred from a conversation without being asked) and **chat history reference**
  (an opaque retrieval layer over *all* past conversations, not a discrete fact store).
- **User control** is the strongest of the surveyed systems on paper: per-memory delete, clear-all,
  a hard off switch for either mechanism independently, in-conversation "forget/change what you
  know about me" as a first-class UX, and a "Temporary Chat" mode that neither reads nor writes
  memory. This is the standard our "forgetting must be a real operation" rule (Part 5) is checked
  against.
- **Failure mode, UNVERIFIED but widely reported in the general press** (not confirmed against an
  OpenAI primary source in this pass): model-inferred saves without explicit confirmation are the
  single most-cited complaint — a user is surprised by a persisted fact they never asked to be
  stored. This is directly the "consent gate" problem Part 5 states as a non-negotiable.
- Structurally, this is Option C-leaning (chat-history reference implies some retrieval index over
  raw history) layered under Option A (saved memories are discrete structured facts) — i.e. OpenAI
  already ships the hybrid this document recommends in Part 4, but with looser write-consent than
  we should accept for a developer tool that touches source code and credentials.

### 1.3 Letta / MemGPT

[Letta: Memory Blocks](https://www.letta.com/blog/memory-blocks/), [MemGPT paper](https://arxiv.org/pdf/2310.08560), [Sleep-time compute](https://arxiv.org/pdf/2504.13171), accessed 2026-09-19.
- **Storage model**: named, persistent, size-bounded strings ("memory blocks") the agent edits with
  its own tools (`core_memory_append`, `core_memory_replace`) — originally two blocks (`Human`,
  `Persona`), generalized in Letta to arbitrary labeled blocks. This is *in-context* memory (the
  blocks sit in the live prompt, always) plus an *external* archival store the agent can page
  into context on demand (the "OS" framing of the original MemGPT paper: main context = RAM,
  archival storage = disk, with the model issuing its own paging calls).
- **Retrieval model**: self-directed. The model decides what to page in/out — no separate retrieval
  pipeline, no embeddings required for the core-block layer (archival storage typically does use
  embeddings for search-by-similarity, but the *decision* to search is the model's own tool call).
- **Sleep-time compute** — a documented design point directly relevant to a coding-agent product:
  memory maintenance (reflection, consolidation, contradiction resolution) happens **asynchronously,
  during idle periods**, not synchronously inside the user-facing turn. This is the architectural
  answer to "when do we write medium/long-term memory without taxing every session with the cost of
  deciding what's worth keeping" — directly applicable to Agentistics because the product already
  has an idle daemon (`otel-watcher.ts`, the events poller) that could host this.
- **Failure mode**: size-bounded blocks force compression decisions the agent makes itself, with no
  external check — a block can silently drop a fact under space pressure with no audit trail unless
  the host application logs the edit. This is exactly why Part 5 requires every remembered fact to
  carry provenance and a mutation log, not just a current-value string.

### 1.4 mem0

[mem0.ai](https://mem0.ai/), [arXiv 2504.19413](https://arxiv.org/abs/2504.19413), accessed 2026-09-19.
- **Storage model**: a managed extraction pipeline — ingests raw conversation, an LLM call extracts
  candidate "salient" facts, a second stage reconciles them against existing stored facts (add /
  update / delete / no-op), stored as structured records (optionally with a graph-based variant for
  relational facts between entities). Explicitly *not* a full orchestration framework — designed to
  bolt onto any existing agent stack as a service call.
- **Retrieval model**: query by `user_id`/`agent_id` + free-text query, semantic search under the
  hood. Distinguishes **working** (session), **factual** (structured), **episodic** (specific past
  conversations), and **semantic** (general accumulated knowledge) memory types explicitly in its
  own documentation — the clearest external four-way split we found, and one input into Part 2's
  taxonomy.
- **Failure mode**: extraction is itself an LLM call, so the reconciliation step (does this new fact
  contradict / supersede / duplicate an old one) is itself imprecise and, per mem0's own published
  benchmark comparisons, the dominant source of error is **wrong reconciliation** (keeping a stale
  fact instead of updating it, or vice versa) rather than retrieval failure — i.e. the write path is
  riskier than the read path, which argues for the more conservative write-time discipline in
  Part 5 rather than trusting an LLM extraction step blindly.

### 1.5 Zep / Graphiti (temporal knowledge graph)

[Zep TKG paper, arXiv 2501.13956](https://arxiv.org/abs/2501.13956), [Graphiti / Neo4j writeup](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/), accessed 2026-09-19.
- **Storage model**: a property graph with **bi-temporal edges** — every edge records both *when
  the fact was true in the world* and *when it was ingested*. This is the single most important
  idea from this whole survey for our design: **contradictions are never overwritten, they are
  time-bounded**. When a new fact conflicts with an old one, the old edge's validity interval is
  closed (`valid_to = now`) rather than the row being deleted or replaced — so "what did we believe
  on date X" remains answerable, and "what is true now" is a simple validity-interval query.
- **Retrieval model**: graph traversal + semantic search hybrid; can surface derived "Observations"
  (recurring patterns across many episodes) as first-class synthesized nodes, not just raw facts.
- **Reported benchmark numbers** (Zep's own, [getzep.com](https://www.getzep.com/ai-agents/temporal-knowledge-graph/), accessed
  2026-09-19): 94.8% on Deep Memory Retrieval, up to 18.5% accuracy improvement and 90% latency
  reduction vs. a full-context baseline on LongMemEval — **UNVERIFIED as independent numbers**
  (vendor-published, not cross-checked against a third-party reproduction in this pass).
  Sub-200ms p95 retrieval is claimed at scale via a dedicated runtime ("Konig") — i.e. this
  architecture is NOT "just SQLite," it assumes a purpose-built graph-serving layer, which is the
  main reason it's a poor fit for a single-binary local-first product (see Part 4).
- **Failure mode this design directly solves**: the "stale-fact serving" problem named in §1.6 —
  ordinary RAG has no native mechanism to prefer a newer fact over an older contradicting one; a
  bi-temporal graph makes "which fact is current" a query parameter instead of an unsolved ranking
  problem.

### 1.6 LangGraph + LangMem

[LangChain memory overview](https://docs.langchain.com/oss/python/concepts/memory), [LangMem SDK launch](https://www.langchain.com/blog/langmem-sdk-launch), accessed 2026-09-19.
- Formalizes the **short-term / long-term** split at the framework level: short-term = thread-scoped
  checkpointer state (conversation history, intermediate reasoning, tool outputs — dies with the
  thread); long-term = a `BaseStore` keyed across threads/users, independent of any one
  conversation.
- LangMem layers three memory **types** on top of that store, and this is the taxonomy Part 2
  below is built against: **semantic** (facts/preferences), **episodic** (specific past
  interactions/examples), **procedural** (the agent rewriting its own system prompt / operating
  rules based on experience).
- **Documented failure mode, stated by the search digest and consistent with the general
  literature (treat as UNVERIFIED pending a primary LangChain benchmark citation)**: LangMem's
  procedural-memory path (self-rewriting system prompts) is reported at ~59.8s p95 latency — i.e.
  procedural self-modification is explicitly *not* suitable for the synchronous request path; it
  belongs in an offline/batch step, the same architectural lesson as Letta's sleep-time compute.

### 1.7 Cursor rules / AGENTS.md as procedural memory

[AGENTS.md guide](https://www.morphllm.com/agents-md-guide), [benjamincrozat.com/agents-md](https://benjamincrozat.com/agents-md), accessed 2026-09-19.
- AGENTS.md is now the cross-tool convention (reported adoption across 30+ agents including Codex,
  Claude Code via import, Copilot, Cursor, Gemini CLI, Devin) for exactly the same content CLAUDE.md
  already carries in this repo: build/test commands, style rules, architectural constraints,
  no-touch boundaries. It is hierarchical (nearest-file-wins per directory, same rule as
  `.gitignore`), and it is loaded **in full, on every call**, which is precisely the "procedural
  memory" tier of Part 2 — and precisely why it must stay small and human-curated rather than
  something an agent silently appends to forever (this repo's own CLAUDE.md is the counter-example
  to imitate carefully: it works because every line was hand-written under scrutiny, not
  auto-appended).
- The self-teaching loop described in these sources ("instruct the agent to update AGENTS.md with
  what it learns") is exactly the anti-pattern Part 5 warns against unless gated: an agent that can
  silently widen its own always-loaded instructions is an agent that can silently increase its own
  blast radius, with no consent step and no per-fact provenance.

### 1.8 RAG over a codebase vs. structured memory — when each wins

Synthesized from [Redis: Knowledge graph RAG](https://redis.io/blog/knowledge-graph-rag-structured-retrieval-ai-agents/), a stale-fact-rate arXiv survey (2606.26511), and general agentic-RAG literature (arXiv 2603.07379), accessed 2026-09-19; treat the specific percentages as **UNVERIFIED single-source figures**, cited because they are the only quantified figures found, not because they were independently reproduced:
- **RAG wins** when the question is open-ended similarity ("has anything like this come up
  before?") over large unstructured text (transcripts, docs) where no one wrote down the answer as
  a discrete fact.
- **Structured memory wins** when the fact is a discrete, nameable claim with a lifecycle
  (a decision, a preference, a "we tried X and reverted it") — because RAG has no native update
  semantics: a new chunk doesn't invalidate an old one, so a fact that changed is now represented by
  **two** retrievable chunks with no way to prefer the newer one.
- **Named failure modes, general literature**: (a) **stale-fact serving** — reported at 15-40% of
  answers when a fact has changed and both versions are still retrievable (single-source figure,
  UNVERIFIED); (b) **chunk-boundary splitting** — a rule and its exception land in different chunks,
  so retrieval surfaces the rule without the caveat; (c) **retrieval miss** — the right chunk exists
  but scores below the cutoff, which is silent (no "I don't know," just an absent context, which the
  model then may hallucinate over); (d) **prompt bloat** — injecting N retrieved chunks "just in
  case" measurably degrades instruction-following on the *actual* task, the same mechanism this
  repo's own CLAUDE.md-length problem demonstrates for procedural memory.
- **Design implication for us**: our failure surface is dominated by (a) and (b) far more than by
  the median RAG use case, because our "facts" are almost all lifecycle-bearing (a convention that
  changed, a decision that got reversed, a bug that got fixed and must not be "fixed" again) — this
  favors the structured/graph side of the spectrum over pure vector RAG, matching the direction
  Part 4 recommends.

### 1.9 Evaluation — how agent memory is actually measured, and what that doesn't capture

- **LongMemEval** ([GitHub](https://github.com/xiaowu0162/LongMemEval), ICLR 2025, arXiv 2410.10813), accessed 2026-09-19: 500
  curated questions over synthetic, timestamped, extensible multi-session chat histories; measures
  retain/retrieve/update/reason. SOTA commercial systems scored 30-70% (their own reported range);
  long-context LLMs given the raw transcript directly lose 30-60% vs. a curated-memory system —
  i.e. "just keep everything in context" measurably loses to structured memory, an empirical
  argument in our favor for building real memory rather than relying on ever-larger context windows.
  A "V2" (arXiv 2605.12493) extends this toward agentic settings, UNVERIFIED beyond the digest.
- **LoCoMo** ([arXiv 2402.17753](https://arxiv.org/abs/2402.17753)), accessed 2026-09-19: 50 persona-driven
  human/LLM dialogues, 300-600 turns each spanning up to 35 sessions, ~200 QA pairs per
  conversation across single-hop/multi-hop/temporal/open-domain categories, plus event
  summarization and (in some variants) multimodal tasks.
- **What these benchmarks do NOT measure, and why that matters for us**:
  1. They are conversational/personal-assistant benchmarks — no benchmark surveyed tests memory for
     a **coding agent** specifically (no "does the agent avoid re-introducing a bug it already
     fixed," no "does it respect a convention established three sessions ago in code review").
  2. None test **cross-repository leakage** — whether a fact learned in context A incorrectly
     surfaces in context B. This is a first-order requirement for us (Part 5) and is untested by
     the field's own benchmarks.
  3. None test the **cost of maintaining** memory (write-path LLM calls, storage growth, staleness
     decay) as a first-class metric — only read-path accuracy. A system that is 95% accurate but
     re-summarizes the whole history on every turn is not distinguished from one that is 95%
     accurate for a fraction of the cost.
  4. None test **consent / forgetting** as a correctness dimension — a system that "remembers" a
     fact the user asked it to forget, but still answers questions correctly using it, would score
     *well* on these benchmarks while failing the property that matters most to a developer tool
     that touches credentials and proprietary code.
  5. None test **what should never be written** — false-negative recall (a system that
     over-remembers noise) is invisible to an accuracy-only metric; a hallucinated "fact" that
     happens not to get *asked about* in the test set scores as if it doesn't exist.

---

## PART 2 — Taxonomy for this product

Three tiers, deliberately mirroring what LangMem/mem0 converge on externally (semantic/episodic/
procedural, short/long-term) but relabeled around what Agentistics actually observes: **sessions,
repositories, and a user across machines**.

### 2.1 Short-term (within a session)

- **What belongs**: the live conversation/tool-call state of one Run. Not Agentistics' data to own
  at all — this is the harness's own context window, already governed by Anthropic's context
  editing / compaction (§1.1) or the equivalent in Codex/Gemini/etc. Agentistics' only touchpoint is
  **observing** it (the canonical event journal, §19 of the runtime master spec) and, for sessions
  it hosts, the live fleet state already exposed by `sessions/sessions-host.ts` and the `attention.ts`
  probe (CLAUDE.md, "sessions/" section).
- **What must never go there**: nothing — this tier isn't a memory store Agentistics writes to.
- **Write / read path**: N/A (owned by the harness). Agentistics reads it via the event journal as
  it happens, and that read is what *feeds* the medium/long-term tiers below.
- **Lifetime**: one Run. Gone the moment the harness's own context is cleared/compacted, unless
  captured into a durable artifact by the journal first.
- **Who can edit**: nobody outside the harness process itself.

### 2.2 Medium-term (project/repository knowledge)

- **What belongs**: decisions made and why, conventions adopted, things already tried and reverted,
  known-bad approaches, open questions blocking a task, the "lessons learned" a human or agent
  explicitly records at the close of a Task/Attempt. This is the tier Anthropic's own "multisession
  software development pattern" (§1.1) targets, and it is the tier CLAUDE.md/AGENTS.md already
  partially serve today for this very repo — by hand, at enormous and growing size (the file this
  document quotes in its own header is itself the evidence).
- **What must never go there**: secrets/credentials (existing `redact.ts` rule must extend here
  verbatim, not be reinvented); anything scoped to one person's working style (that's tier 3); a
  fact with no repository/task anchor (an anchorless fact cannot be scoped, and an unscoped fact is
  exactly the cross-repo leakage failure mode named in §1.9.2 and Part 5).
  - **A fact learned in repo A must not silently answer a question about repo B.** This is the one
    property none of the surveyed benchmarks test (§1.9.2) and the one this product's own house
    rules (per-connection sharing, `share-rules.ts`) already treat as sacred for team data — memory
    must inherit the same discipline.
- **Write path**: primarily **derived**, not free-text-extracted-by-an-LLM (learning from mem0's
  §1.4 failure mode: reconciliation-by-LLM is the dominant source of error). Candidate write
  triggers, each already observable in this product's existing data:
  - ALM `Task`/`Attempt` closure with a `blocked_needs_reason` history or a recorded outcome
    (`task-model.ts:161-289`, `task-rollup.ts`) — "this delivery tried X, here's what happened" is
    already structured data sitting in the task store; it is not yet *surfaced back* as memory for
    the next session that touches the same repo.
  - An explicit human/agent "remember this" action — the one write path every surveyed system
    treats as first-class and the one this product must never skip in favor of only-inferred
    writes.
  - A **repeated correction** pattern across sessions in the same repo (mirroring Claude Code's own
    auto-memory "feedback" category, §1.1) — promoted to a fact only after being observed more than
    once, never on a single occurrence, to avoid over-fitting one person's one-off request into a
    repo-wide "rule."
- **Read path**: injected at session/agent-dispatch time (the natural hook point is the existing
  `SessionStart` mechanism `cli-hooks.ts`/`session-context.ts` already use for fleet facts, and the
  `agentop-parallel-sessions` skill's prompt-writing step when fanning work out to several agents).
  Retrieval is **structured, keyed by repo (`normalizeGitRemote` — the one existing repo key,
  CLAUDE.md's own "Repository dimension" section) and optionally by task**, not semantic search by
  default (Part 4, Option A/B). Injected as a small, capped block — never the whole history — the
  same discipline `session-profile.ts` already applies to *statistics* (median beside mean, `n` per
  metric) should apply to *facts* (a fact surfaces with its confidence and last-confirmed date, not
  as bare assertion).
- **Lifetime**: as long as the repository is tracked, with an explicit expiry/re-confirmation
  mechanism (a fact not re-observed in N months is a *candidate* for demotion, never silently kept
  as current truth forever — the bi-temporal lesson from Zep/Graphiti, §1.5).
- **Who can edit**: anyone with write access to that repo's Tasks today (the existing ALM
  permission surface); central-sharing of a repo's memory follows the *exact* `Task.shared` /
  `sessionShared` per-connection rule already in place — a memory fact about a withheld repository
  must never reach a central that repository is withheld from, full stop, no separate rule.

### 2.3 Long-term (how THIS user works)

- **What belongs**: this is the direct analogue of Claude Code's own auto-memory (§1.1) but scoped
  to *this product's* decisions rather than the harness's: which harness the user prefers to
  delegate to (per this session's own memory: "implementer sessions and reviewer subagents run on
  Sonnet, never silently fall back to Opus" — a real fact already recorded in this user's own
  `MEMORY.md`), commit-language preference, worktree-vs-shared-checkout discipline, how the user
  answers an interactive-question prompt, PR-approval discipline ("never open a PR without
  approval"). All of these are *already* present as literal entries in this user's Claude Code
  MEMORY.md, none of them are repo-specific, and none of them currently reach Agentistics' own
  orchestration decisions (e.g. `agentop session batch`, the parallel-dispatch skill) even though
  they obviously should inform them.
- **What must never go there**: anything that is actually a repo fact misfiled as a personal one
  (the boundary is real and must be enforced by the write path asking "does this generalize past
  one repository" rather than defaulting to "yes"); anything inferred from a single session (same
  repeated-observation discipline as 2.2); credentials, PII beyond what the user explicitly names.
- **Write path**: explicit ("remember that I...") is primary; inferred-and-confirmed
  (surface the candidate fact to the user once, let them accept/reject, mirroring the consent step
  that ChatGPT's memory notably under-delivers on per §1.2) is secondary; never silently auto-saved
  the way ChatGPT's model-inferred saves currently work, precisely because Agentistics sits closer
  to source code and credentials than a general chat assistant does.
- **Read path**: loaded once, in full, at the *account* level (not per-machine — the existing
  `AppData.userStatsCaches` precedent for "a person's data spans several machines" applies here
  too) — an index/topic-file split identical to Claude Code's own two-tier auto-memory (§1.1) is
  the right shape: a small always-loaded index, larger detail on demand.
- **Lifetime**: until explicitly revised or deleted by the user; no automatic expiry (unlike repo
  facts, a personal working preference doesn't go stale just because it wasn't recently re-observed
  — the "last active" signal that matters for a *repo* fact doesn't apply to "I always write commits
  in Portuguese").
- **Who can edit**: only that account. Never a manager, never a team, never inferred on their
  behalf by someone else's session — this is the one tier with a single unambiguous owner.

---

## PART 3 — Fit to this product (internal, read-only)

All paths relative to the worktree root.

### 3.1 `packages/core/src/session-profile.ts` (158 lines) — already measures "what usual looks like"

- `profileOf(sessions, now, windowDays=30)` (`packages/core/src/session-profile.ts:135-158`)
  computes median/mean/`n`/`nonZero` per metric over a 30-day window — this is *statistical*
  medium-term memory, not factual, but the disciplines it enforces are exactly the disciplines a
  factual memory store must inherit:
  - **`n` is per-metric, never a shared sample size** (`session-profile.ts:60-115`, the `READERS`
    table) — a metric the harness cannot produce, or that no transcript was read for, contributes
    `undefined`, not `0`. A memory-fact store must apply the identical rule: a fact this repo's
    harness *could never have produced evidence for* is not "false," it's absent, and a memory read
    path that can't tell the difference will confidently assert non-facts.
  - **The day rule is UTC, `start_time.slice(0,10)`** (`session-profile.ts:44-58`), the same rule
    `tagSessionDay` and the billing basis already use — any memory feature that timestamps a fact's
    "last observed" date must reuse this exact rule rather than inventing a third day convention (a
    documented anti-pattern already called out for the hour chart and the billing basis
    elsewhere in this repo's CLAUDE.md).
  - **Pure and total, receives `now` as a parameter** (`session-profile.ts:8-9`) — a memory
    projection (Part 4) should be written the same way: a pure fold that can be tested against a
    fixed clock, exactly like `ClaudeParseState`/`ActiveTimeState`/`AgentMetricsState` already are.

### 3.2 The consolidate store and archive modes — the durable substrate already exists

- `packages/server/server/consolidate.ts` (84 lines): `writeConsolidated`/`loadConsolidated` persist
  one JSON file per session forever at `~/.agentistics/sessions/<harness>/<id>.json`
  (`consolidate.ts:11-43`), entries are **never deleted** (`consolidate.ts:26-28` comment), which is
  precisely the durability property "surviving the harness's own 30-day cleanup" that Anthropic's
  memory tool exists to provide at the API level (§1.1) — Agentistics already built the equivalent
  substrate for *metrics*; a memory store is the same substrate applied to *facts*.
- `packages/server/server/archive.ts` (119 lines) + `preferences.ts:150,264-272` (`archiveMode:
  'off'|'consolidate'|'full'`, `resolveArchiveMode`): the **consent gate** this product already
  ships (`ArchiveConsentModal.tsx`, blocking first load, per this repo's CLAUDE.md "Archive mirror"
  section) is the exact mechanism a memory system must reuse rather than invent a second consent
  flow for. A session run under `archiveMode: 'off'` today keeps zero raw chat; a native memory
  system must honor that boundary identically — **no fact may be derived from a session whose
  archive mode did not consent to retaining chat content**, because a derived "memory" of what was
  said is exactly the raw-chat retention the `off` mode exists to refuse.
- **What this means concretely**: `archiveMode` should gate *write* access to repo/personal memory
  the same way it already gates raw transcript mirroring — `consolidate` mode (persisted
  `SessionMeta`, no raw chat) is enough to derive *statistical* memory (session-profile-style
  baselines) but not enough to derive a fact whose evidence is a specific thing someone said; that
  needs `full` mode, exactly mirroring the existing tokens/cost-vs-raw-chat distinction this repo
  already draws for the team-push redaction rules (`redactSecrets`, CLAUDE.md "Team-mode rules").

### 3.3 The ALM task board — a record of decisions and their cost

- `packages/server/server/sessions/task-model.ts` (467 lines): `Task` (line 161), `Attempt` (line
  244), `Subtask` (line 289), `TaskClaim` (line 130), `TaskEvent` (line 147) are already a
  structured record of *what was tried, by whom, at what cost, with what outcome* — this is
  medium-term memory's primary raw material, sitting unused as memory today. A `blocked` task
  (CLAUDE.md: "refused without a reason... the reason is cleared when the task leaves blocked and
  kept in the activity log") already carries exactly the "why did we not do X" fact a future session
  needs and currently has no way to see unless a person manually re-reads the board.
- `packages/server/server/sessions/task-rollup.ts` (109 lines): `rollupAttempt` (`task-rollup.ts:
  72-109`) already enforces the provenance discipline Part 5 demands of any memory fact —
  `costMeasured` vs. estimated (`task-rollup.ts:37-38,104-105`), `sumOrNull` returning `null` rather
  than `0` for "nothing usable was reported" (`task-rollup.ts:67-70`). A memory-fact record should
  carry the identical shape: `{value, confidence: 'measured'|'estimated'|'inferred', sourceEventId,
  lastConfirmedAt}` rather than a bare string, precisely because this repo already learned (task
  cost, agent metrics, pricing provenance) that a number with no provenance is a number nobody can
  trust six months later.
- **Gap**: nothing today turns a closed `Task`/`Attempt` into a *readable* fact for the *next*
  session opened against the same repository — the board is a ledger a human reads, not a memory an
  agent consults automatically. This is the single most direct, lowest-risk win available (Part 4,
  Option B) because the data already exists, is already structured, already has provenance, and
  already has the exact repo key (`normalizeGitRemote`) memory needs to scope by.

### 3.4 The canonical event journal (`docs/superpowers/specs/2026-09-19-agentistics-runtime-master.md`)

- **§13 Canonical domain model** (`...master.md:285-434`): `Session 1─* Run 1─* Agent`, with
  `conversationLink: 'assigned'|'observed'|'none'` (line 309) — memory's provenance model (Part 5)
  should reuse this exact three-way distinction rather than inventing a parallel one: a memory fact
  derived from an `assigned`/exact-linked run is a stronger claim than one derived from an
  `observed`/inferred one, exactly as the runtime spec already treats conversation identity.
- **§14 Event model** (lines 435-556): `AgentisticsEvent` already specifies the exact shape a
  memory-write event needs — `eventId` deterministic (`sha256(source.kind, source.id, sourceRef,
  type, ordinal)`, line 441), `occurredAt` vs. `recordedAt` never conflated (lines 446-448,
  476-478), and critically **`provenance: {mode, confidence, adapterVersion, sourceRef}`** (lines
  461-466) — this is *precisely* the provenance envelope Part 5 requires for every remembered fact,
  already designed, already in the spec this document should build on rather than duplicate. The
  event-type taxonomy (§14.1, lines 486-509) has room for a `memory.noted` / `memory.superseded`
  pair of event types without widening the vocabulary informally (the spec's own rule, line
  511-513: "harness-specific facts do not get their own event types... the vocabulary stays
  closed").
- **§19 The event journal** (lines 746-820): the recommended SQLite-WAL-at-`~/.agentistics/
  journal.db` design (lines 753-787) is the correct foundation for memory storage too, not a
  parallel store — `UNIQUE(event_id)` makes idempotency structural (line 777), and the
  `Projection<S>` interface (`empty`/`fold`/`finish`, lines 802-810) is the exact shape a
  `repoMemory` or `userMemory` projection should take, versioned (`projectionVersion`, line 817) so
  a rule change re-derives memory from the journal rather than requiring a migration script — this
  is the "one implementation per rule" and "never load everything into RAM" principles (§4, lines
  104-106, 116-118) applied to memory specifically. **Memory should be a projection over this
  journal, not a fourth store beside it** — this is the single most important architectural
  conclusion of this document and is elaborated in Part 4, Option B/D.
- **§20 Replay** (lines 821-841): the journal's replay-as-import path ("a machine that installs
  Agentistics today has months of history... phase 3 replays it into the journal exactly as a live
  session would have written it") is also memory's backfill path for free — a memory projection
  folded over replayed history gets medium-term facts for repositories that predate the memory
  feature's existence, with no separate migration needed.

### 3.5 House rules the memory design must obey (already stated in CLAUDE.md, not repeated here)

- **N/A is never 0** — a fact this product cannot produce evidence for is absent, never a confident
  empty answer (`HARNESS_CAPABILITIES` is the existing pattern; memory needs the same discipline
  per source-adapter: an adapter with no memory-relevant signal contributes nothing, silently, never
  a false "nothing happened here").
- **Provenance travels with the number** (§4 principle 3, `...master.md:107-109`) — extended
  verbatim to facts: every fact carries source, date, and confidence, always, no exceptions, the
  same way pricing carries `official|community|builtin`.
- **Consent gates are absent-reads-as-decided-per-switch, never a blanket default** (§4 principle
  7, lines 119-122) — a memory-write consent switch must state explicitly which way "absent" reads,
  as a deliberate product decision (most likely OFF, matching `chat-gate.ts`'s reasoning: memory
  write is at least as consequential as opening a local shell, arguably more so since it persists).

---

## PART 4 — Candidate architectures

### Option A — Structured facts, explicit recall, no embeddings (the simple baseline)

- **Storage**: a single SQLite table (could live in the same `journal.db` or a sibling
  `memory.db`): `memory_facts(id, scope_kind ENUM('repo','account','global'), scope_key TEXT,
  category TEXT, statement TEXT, confidence TEXT, source_event_id TEXT, created_at, last_confirmed_at,
  superseded_by TEXT NULL, expires_at NULL)`. `scope_key` is `normalizeGitRemote()`'s output for
  repo scope, the account id for account scope.
- **Retrieval**: exact query by `(scope_kind, scope_key)`, optionally `category`. No ranking
  problem, no embedding cost, no index to keep warm. Injected at `SessionStart`/dispatch time as a
  small capped list (mirroring Claude Code's own 200-line/25KB index cap, §1.1).
- **Write triggers**: explicit user/agent "remember" action; ALM task/attempt closure (a structured
  summary field already exists to source from, §3.3); repeated-correction promotion (observed ≥2×
  in the same repo).
- **Size bounds**: hard cap per scope (e.g. 50 active facts per repo, oldest-unconfirmed evicted
  first) — a bound stated up front rather than discovered via an incident, learning from this
  product's own CLAUDE.md-length lesson (§1.1, §1.7).
- **Cost**: near-zero — no embedding compute, no vector index, one SQLite write per fact.
- **Trade-off**: cannot answer "has anything *like* this come up before" over free text — only
  exact/structured queries. Misses the RAG use case entirely by design.

### Option B — Journal-derived projection (no separate write path)

- **Storage**: memory is not written directly at all — it is a `Projection<S>` (per §19.4 of the
  runtime master spec) folded over the canonical event journal: a `repoMemory` projection that
  accumulates from `alm.task.completed`, `tool.failed` (repeated on the same signature),
  `context.compacted`, and a new `memory.noted` event type (an explicit human/agent annotation,
  itself just another event in the same journal). Materialized as a snapshot per repo, rebuildable
  from zero by re-folding, versioned by `projectionVersion`.
- **Retrieval**: same as Option A once materialized (a table/JSON blob keyed by repo) — the
  difference is entirely in the write side: there is no second write path to keep consistent with
  the journal, because memory *is* a read of the journal.
- **Write triggers**: none directly — everything is inferred from events that already exist for
  other reasons (ALM, tool telemetry) plus the one new explicit event type for direct annotation.
- **Cost**: the marginal cost of one more projection over infrastructure §19 already recommends
  building; no new store, no new consent surface beyond the journal's own.
- **Trade-off**: quality is bounded by what's already instrumented as an event — a nuance a human
  would phrase as a paragraph ("we tried X, it broke Y because of Z, don't do X again without also
  doing W") may not survive being derived purely from structured event folds unless captured
  verbatim via the `memory.noted` escape hatch. In practice this pushes toward a hybrid (Option D).

### Option C — Semantic retrieval layer (the RAG option)

- **Storage**: embeddings over consolidated session summaries and, only under `archiveMode: 'full'`
  consent (§3.2), raw transcript chunks — stored via `sqlite-vec` or an equivalent lightweight local
  vector extension (keeping with the single-binary, no-external-service constraint that already
  rules out a hosted vector DB for this product, the same reasoning that already rules out Mongo on
  a solo machine in §19.2's "Alternative B — Mongo everywhere" rejection).
- **Retrieval**: similarity search, "find sessions like this one," "has this error come up before
  in this repo." Genuinely does something structured memory cannot: answer open-ended similarity
  questions over unstructured history.
- **Write triggers**: batch embedding of consolidated summaries on a schedule (mirroring the
  sleep-time-compute pattern, §1.3, rather than embedding synchronously in the request path).
- **Cost**: real — embedding compute (even local/small models cost CPU time and disk), a vector
  index to maintain, and the stale-fact/chunk-boundary failure modes named in §1.8 apply in full
  here, unmitigated by anything structured memory doesn't already need.
- **Trade-off**: this is the *lowest-priority* tier per this document's own Part 1 findings — the
  benchmark literature (§1.9) shows curated/structured memory beating raw-context retrieval, and
  our fact shape (lifecycle-bearing decisions, not open trivia) is exactly the shape RAG handles
  worst (§1.8). Build only after A/B, and gate strictly behind `archiveMode: 'full'` consent.

### Option D — Hybrid (recommended)

- **Structured facts (Option A/B) are the always-on, authoritative layer** — cheap, auditable,
  consent-simple, and covers the majority of what this product's own data (ALM, session-profile
  baselines, repeated corrections) already makes derivable at near-zero marginal cost.
- **Semantic retrieval (Option C) is strictly additive and opt-in** — available only where
  `archiveMode: 'full'` has already been chosen for other reasons, never a prerequisite for the
  base memory feature to function, and never allowed to *override* a structured fact (mirroring the
  existing "layered pricing sources" pattern — official beats community beats builtin, never the
  reverse; here structured beats semantic, semantic only fills gaps structured facts don't cover).
- **This is the option this document recommends**, because it is the only one of the four that
  degrades gracefully on a machine that never opts into `full` archiving (the majority case per this
  repo's own stated default, `consolidate`), and because it reuses more already-built
  infrastructure (the journal, the ALM store, the archive-consent gate) than any of the other three
  taken alone.

---

## PART 5 — Rules this product should adopt

1. **Memory must be inspectable and editable by the user, in full, at any time.** Every surveyed
   system that ships in production (ChatGPT, Claude Code auto-memory) treats this as non-negotiable
   UX, not a nice-to-have — and this product already has the harder version of this problem solved
   for statsCache/preferences (a user can always see and edit `preferences.json`); memory must not
   be the one store in this product that is write-only from the user's perspective.

2. **Every remembered fact carries provenance and a date — no exceptions.** This is not a new rule;
   it is the existing `HARNESS_CAPABILITIES`/pricing-provenance/`task-rollup.ts` discipline (§3.3,
   §4 principle 3) applied to a new kind of data. A fact with no source and no date is
   indistinguishable from a hallucination six months later, and this product has already paid,
   repeatedly, for shipping a number with no way to check it (the agent-metrics async-launch
   incident, the antigravity protobuf mis-mapping — both in this very CLAUDE.md).

3. **A fact learned from one repository must not silently leak into another.** This is the one
   property the external benchmark literature does not test (§1.9.2) and the one property this
   product's own `share-rules.ts`/`siblingRules.ts` discipline already treats as sacred for team
   data. Memory scoping (repo-key vs. account-key, Part 2) must be enforced at the *read* path, not
   just the write path — the same lesson `machine-fleet.ts`'s "rules enforced when you look and not
   when you act is not a rule" (CLAUDE.md, "Managing a machine's sessions FROM a central") teaches
   about a completely different feature and applies verbatim here.

4. **Nothing is remembered from a session whose archive mode did not consent to retaining that
   content.** `archiveMode: 'off'` already means "chat content does not survive this session" —
   deriving a memory fact from such a session's chat is retaining that content by another name.
   Statistical/structural memory (session-profile-style baselines, ALM outcomes) can still be
   derived under `consolidate` mode because that data is already retained under that mode today;
   anything requiring the *words someone said* needs `full` mode's consent, no exceptions.

5. **Write access to memory is at least as gated as the most sensitive verb this product has.**
   This product already treats "spawn a shell," "start a chat with a live assistant," and "read
   `~/.claude`" as high-consequence actions gated by explicit, absent-reads-as-OFF switches
   (`chat-gate.ts`, `shell-gate.ts`). Writing a durable fact that will silently shape every future
   session's behavior is not less consequential than any of those — arguably more, because its
   effect is invisible at the moment it fires. Absent should read as OFF for automatic/inferred
   writes; explicit user-issued "remember this" is the one write path that may default to available.

6. **Forgetting must be a real operation, not a soft filter.** A "hide this fact" toggle that
   leaves the row in the store and merely stops rendering it is the same category of defect this
   product's own `proposalAddsNothing`/`selectLiveProposals` distinction (filtered-vs.-pruned) was
   built to prevent for sibling proposals. Delete means delete: the row is gone, and any projection
   derived from the journal must be capable of re-deriving a *different* answer once the source
   event (or an explicit tombstone event) says the fact was retracted — which is exactly what the
   bi-temporal edge-closing pattern (§1.5) gives us essentially for free if memory is a journal
   projection (Option B/D).

7. **A superseded fact is closed, never silently overwritten.** Directly adopting Zep/Graphiti's
   bi-temporal lesson (§1.5): when a new observation contradicts a stored fact, the old fact's
   validity ends at that timestamp rather than being deleted or replaced in place — "what did we
   believe on date X" stays answerable, which matters specifically for a product whose whole reason
   for existing is auditable historical metrics.

8. **A single occurrence never becomes a repo-wide or user-wide rule.** Mirroring Claude Code's own
   auto-memory discipline (§1.1: "feedback" is only saved when it's judged to generalize) and this
   document's own Part 2 write-trigger design — promotion to a stored fact requires either an
   explicit "remember this" or a repeated (≥2) observation, never a one-off inference, to avoid the
   over-fitting failure mode named nowhere in the benchmark literature but everywhere in the
   practitioner complaints about ChatGPT's under-confirmed auto-saves (§1.2).

9. **Memory is a projection over the canonical event journal wherever the fact is derivable from
   events that already exist for another reason** (§3.4, §4 Option B/D) — never a second,
   independently-written store that can drift from the journal's own account of what happened. The
   one exception is the explicit-annotation write path (`memory.noted`), which is itself just
   another event, not a side-channel.

---

## Open questions for the product owner

1. **Where does the memory-write consent switch live, and what does it default to?** A new
   `preferences.memoryEnabled` alongside `archiveMode`, or folded into `archiveMode` itself as a
   fourth value? The former keeps concerns separate (raw-chat retention vs. fact-derivation are
   different questions); the latter reuses one already-understood mental model.

2. **Should repo-scoped memory be shareable to a central at all**, and if so under what rule —
   identical to `Task.shared` (opt-in per task) or a new opt-in per repository? Given memory
   facts are more free-text than task metadata, the `first_prompt`-style redaction question (what
   travels, what's scrubbed) needs its own decision, not an assumed inheritance from the task-share
   rule.

3. **Who arbitrates a disagreement between two memory facts from different sessions/agents about
   the same repository** — last-write-wins (simple, matches the bi-temporal "close the old edge"
   pattern) or does it need a human confirmation step before a contradicting fact is accepted?
   The former is simpler and matches Rule 7; the latter is safer but reintroduces a friction point
   every surveyed system tries to minimize.

4. **Does the "repeated correction" write trigger (Rule 8) need a cross-session identity for "the
   same correction,"** and if so, is that similarity judged by an LLM call (mem0's own failure
   mode, §1.4) or by a cheaper structural signature (same tool, same file pattern, same error
   class)? A wrong choice here reproduces mem0's dominant error source inside our own write path.

5. **Should long-term (account-level, Part 2.3) memory be visible to *other* accounts on a shared
   central at all**, even read-only, e.g. for a manager reviewing why an agent behaved a certain
   way? The existing IAM model (`canCreateAccountWith`, `accountVisibleTo`) has no obvious slot for
   "another account's personal working preferences," and Part 5 Rule 5 argues this should stay
   single-owner — but that has UX cost for team debugging ("why did the agent commit in Portuguese
   on this PR").

6. **What is the actual size/count budget per scope** (Option A/D's `memory_facts` cap)? This
   document proposes "50 active facts per repo" as a placeholder matching Claude Code's own
   200-line index cap in spirit, but has not measured this product's own likely fact-generation
   rate the way `session-profile.ts` measures everything else it touches — that measurement should
   happen against real ALM/task data before the number is fixed.

7. **Does Option C (semantic retrieval) belong in the roadmap at all for v1**, or should it be
   explicitly deferred until structured memory (Option A/B) has shipped and been measured against
   real usage — matching this product's own stated practice of never adding a capability "as a side
   effect" (CLAUDE.md, Gemini token/cost flags: "do it deliberately... do not flip it as a side
   effect")?
