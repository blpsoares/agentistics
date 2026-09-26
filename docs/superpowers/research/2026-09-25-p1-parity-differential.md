# P1 parity differential (A2.5) — legacy vs projected `SessionMeta`, and budgets 2 and 4

**Date:** 2026-09-25 · **Spec:** `specs/2026-09-19-runtime-p1-canonical-journal.md` §1.6, §8, §9, §12
**Base:** `feat/journal-shadow` @ c8fd16ff + `feat/projection-session-meta` (84fd431a) + replay 9eabfe0f
(Claude adapter 1.1.0, emits `context.compacted`). **Harness:** `packages/server/server/projections/differential.ts`.

This report names session ids and field names only. The real store (`~/.claude/projects`) was read only;
every measurement ran with an isolated `AGENTISTICS_DIR` in a scratch directory.

## 1. The rule

Counters are compared with `===`. There is no tolerance anywhere. A row is one of:

- `equal`
- `explained`: the two sides differ, an independent recount of that session's raw bytes reproduces
  **both** sides exactly, and the reason is one sentence in `EXPLANATIONS`
- `bug`: they differ and nothing proves why
- `not-projectable` / `partial`: declared by the projection (`NOT_PROJECTABLE` / `PARTIAL_FIELDS`)

The legacy side is `parseSessionJsonl` (the `jsonl.ts` walk plus subagent enrichment) over the same
transcript. It is not the consolidate store and not `cachedEnrich`. See §6.

## 2. Result

| run | sessions | with a `bug` row |
|---|---:|---:|
| fixture `claude-replay` | 1 | 0 |
| fixture `claude-replay-compact` | 1 | 0 |
| this machine's real store | 488 (0 live, 0 unreadable) | **10** |

### Real store, per field (rows that are not all `equal`)

| family | field | equal | explained | bug | not-proj. | partial |
|---|---|---:|---:|---:|---:|---:|
| tokens | input / output / cacheRead / cacheWrite / cost / model | 488 each | 0 | 0 | | |
| tokens | `cache_creation_1h/5m_input_tokens` | 484 | 4 | 0 | | |
| time | start / end, `daily.<day>.tokens` | all | 0 | 0 | | |
| time | `duration_minutes` | 487 | 1 | 0 | | |
| time | `active_minutes`, `rounds`, `user_message_count`, `message_hours`, `daily` (msgs/hours) | | | | 488 | |
| tools | `tool_counts`, `tool_errors`, categories, `uses_*`, `context_tokens`, `context_window`, `compact_dropped_tokens` | 488 each | 0 | 0 | | |
| tools | `compact_count`, `compact_ms` | 487 | 1 | 0 | | |
| tools | `agentMetrics.invocations[].totalTokens` | 33 | 460 | **18** | | |
| tools | `agentMetrics.invocations[].toolStats` / `.totalToolUseCount` | 509 | 2 | 0 | | |
| tools | `agentMetrics.totalTokens` | 5 | 41 | **10** | | |
| tools | `agentMetrics.totalCostUSD` | 5 | 41 | **10** | | |
| tools | `agentMetrics.totalInvocations` / `.unmeasuredInvocations` | 56 | 0 | 0 | | |
| tools | `lines_added`, `lines_removed`, `files_modified` | | | | | 488 |

The main-transcript counters are equal on all 488 sessions. This includes the four token counters,
cost, the TTL split (apart from the four explained rows), the context gauge, compactions and tool counts.
A2.2 measured the main transcripts as byte-identical repeats, and that holds on the whole store.

## 3. Explained differences (each one is proven per session)

1. **`firstWins`.** 460 invocation rows and 41 session totals. **LEGACY DEFECT**, already confirmed
   by the coordinator. `countUsage` keeps the first usage line of a streamed `message.id`, and in
   subagent transcripts that line is partial. The replay keeps the last line, as `usage-dedupe.ts`
   documents. On this store the defect appears in subagent transcripts only.
2. **`apiErrorOnly`.** 4 sessions (2b6a45f5, 32d4f58b, 626e097d, b6ad99a8). **LEGACY DEFECT.** The
   only usage line in each transcript is a synthetic `isApiErrorMessage` record whose `cache_creation`
   object is all zero. `jsonl.ts` never checks `isApiErrorMessage`, so it reports an observed 0/0 TTL
   split. The replay emits nothing for that line because no real model precedes it.
3. **`emptyTranscript`.** 1 session (f455dc9a). **LEGACY DEFECT.** The transcript is 0 bytes.
   `finishClaudeSession` writes `duration_minutes: 0` and `compact_count/compact_ms: 0` without
   checking whether any line was walked. The projection reports those fields as absent.
4. **`nestedRollup` / `nestedRollupCost`.** This covers the rows where the two sides disagree about
   which subagent transcripts belong to an invocation:
   - Legacy finds descendants by scanning each transcript for `childAgentIds`.
   - The replay follows each file's own `meta.parentAgentId`.
   - The replay's `model.completed` is keyed on `message.id` alone, so a response that appears in two
     files counts once.

   Two real shapes produce the difference:
   - A background fork that no parent's content names. Legacy misses it.
   - A conversation fork (`meta.isFork`) that replays its parent's `message.id`s. Legacy counts them
     twice. In one root this was 156,120,428 tokens for legacy against 106,446,703 for the replay,
     from 166 shared ids.

   The recount reproduces both sides exactly. **Owner decision needed:** a response billed once and
   counted twice is, in my reading, a legacy over-count. The sentence in `EXPLANATIONS` stays neutral
   until the owner rules on it.

A related pairing fix: an invocation with no subagent transcript is named by
`fallbackSubagentAgentId(conversationId, toolUseId)` in the replay. The harness now tries that id too.
This removed 6 rows that showed up on one side only (f32ddf59, 05554774).

## 4. Unexplained (bugs), for the coordinator

In `agentMetrics`, 10 sessions have 18 invocation `totalTokens` rows, plus that session's `totalTokens`
and `totalCostUSD`. The independent recount reproduces **neither** side on these rows, so they stay
`bug`:

| session | invocation(s) (harness agent id) |
|---|---|
| 4a57e60c-f38c-4775-89fb-0b8bf9b47303 | a7ed8864dfd162600, aff78ea94a0c83b2e |
| e40a8cd0-dfa4-478a-92f8-3baf85aa9a12 | af19e4294d581e64d |
| 62ec3fd0-d4c6-4f3f-add5-512b4b5c9160 | ae66fe6d39062f2fb |
| 813e0cce-3e92-4cee-b154-a47bb8d256ef | a719fc42d5edb2e62, aa07b578c0171d31b, aa3fa14971f30dbb9, abf76e168a8038050, a6f9a1d172c695060, ab4b71232d0896c2b, a008d2f672d57bdb5 |
| 3c724061-66b7-40b3-82cc-59e38e0abba0 | a6970d8ecc92fcaad |
| 50feb1c7-f2e1-4519-951c-eaa519ea8e44 | a6d7ec16c2f904dff |
| 922179a6-b685-4740-b133-fa97d99fcbf9 | a05b015b0bde016dc |
| ec2208b6-53f3-4ac3-a467-36202e5a6755 | a1a220db5b4948cb2, abb677b1d245d0837 |
| bc2f6dbb-88ba-45f1-adcd-2e3c4b7e5a77 | a5f4fba490a6268a8 |
| 7c821040-9570-4130-acc5-15e2e8f45924 | ac83206bae2493f03 |

**Unverified hypothesis (A2.5c):** the recount approximates `replay-model.ts`'s HOLD state machine as
"last occurrence per id within a file". A `message.id` that repeats NON-contiguously inside one file
would then be counted differently. Nobody has checked this.

**Latent order-independence risk (P1 §8), not observed:** `model.completed` is keyed on `message.id`
alone. If two files ever carry the same id with DIFFERENT usage, the projection keeps whichever event
arrived first. The harness checks for this, and it found 0 such conflicts on this store.

## 5. Budgets (P1 §9), re-measured on replay 9eabfe0f

Method: the same machine, a fresh process for each build, an isolated `AGENTISTICS_DIR`, and an
isolated `AGENTISTICS_JOURNAL_DIR`. The flag was off or on, and 613 sessions were built. Other sessions
were running during the measurement, so builds were noisy.

| run | build ms | shadow ms |
|---|---:|---:|
| off 1 / 2 / 3 | 75,606 / 45,345 / 66,559 | none |
| on, first ingest (empty journal) | 64,400 | **49,194** (488 sources, 408,855 events, 407,143 written, 1,712 duplicates, 0 rejected) |
| on, steady 1 / 2 | 65,192 / 67,550 | 101 / 88 (488 skipped) |

- **Budget 2, steady state: MET.** 0.1–0.2 % of a build.
- **Budget 2, first ingest: NOT MET.** 49.2 s is 76 % of the flag-on build it rode along with, and
  65–108 % of the flag-off builds. It happens once per journal and is not awaited, but it is a second
  full read of the store inside the server process. A2.3 measured 71 % on replay 191f0eda.

**Budget 4, journal size: NOT MET, by about 218×.** The journal holds 264.5 MB plus a 6.9 MB WAL. That
is 407,143 events over 622 session-days in 487 sessions: **436 KB/session/day** against a budget of
2 KB, or 667 B/event on disk. A2.3 measured about 409 KB.

| event type | count | avg `data` B | avg other columns B |
|---|---:|---:|---:|
| tool.requested | 101,429 | 157 | 273 |
| model.completed | 99,971 | 270 | 274 |
| model.invoked | 99,971 | 100 | 272 |
| tool.completed | 97,672 | 66 | 273 |
| tool.failed | 3,729 | 68 | 271 |
| agent.started / agent.ended | 1,034 / 1,033 | 90 / 22 | ~263 |
| run/session started/ended | 487 each | 2–203 | ~228 |
| model.failed | 310 | 93 | 269 |
| context.compacted | 46 | 61 | 275 |

Where the bytes go: column payload is 171 MB, which is 63 % of the file.
- `data` is 60 MB (22 %).
- The envelope columns are 111 MB (41 %). The largest are `source_ref` (23 MB), `event_id` (13 MB),
  and `session_id`, `run_id` and `agent_id` (11 MB each). `occurred_at` and `recorded_at` are 9.8 MB each.
- About 93 MB (35 %) is the row and b-tree overhead of the table plus its three indexes: UNIQUE
  `event_id`, `events_run` and `events_type`. `dbstat` is not compiled into bun's SQLite, so that
  figure is the file minus the payload, not a per-index measure.

**What this means for the decision.** The four per-call types make up 98.6 % of the rows. `data` alone
is about 96 KB/session/day, so no change to envelope encoding or indexes reaches 2 KB/session/day. The
drivers are granularity (one event per tool call and per model response, ~655 per session-day) and
retention (D6). Nothing was tuned.

## 6. Scope and assumptions

- "Legacy" is `parseSessionJsonl` over the transcript, which is the same bytes the replay reads. What a
  surface shows for a meta-sourced session goes through `cachedEnrich` and the consolidate store. That
  path is not compared here.
- `rounds` is not a stored `SessionMeta` field, so its row shows no legacy value.
- A transcript written in the last 60 s is skipped as live. That was 0 on the final run and 1 on the
  first run.
- `journal.db.stamps.json` and `journal.db.status.json`: `backup-plan.ts` carries `.agentistics/journal.db`
  as an exact file source. `carried()` matches only equal paths or `rel + '/'` prefixes, so neither
  file is carried. Neither is excluded either. Both are **undecided** backup paths. The lint cannot see
  them because they are template strings. No row was added.
