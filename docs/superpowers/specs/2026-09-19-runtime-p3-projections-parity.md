# P3 — Projections serve the product, and the parity matrix becomes the gate

**Phase 3 of `2026-09-19-agentistics-runtime-master.md` (§46).** Depends on P2's differential being
green or explained for every harness.

**Flags:** `AGENTISTICS_PROJECTIONS` (absent = off) and `AGENTISTICS_PROJECTIONS_SURFACES` (which
surfaces read the projected answer). Both default to the legacy path.

---

## 1. What P3 delivers

1. **Projection storage and resume** — materialised projections with a `projectionVersion`, rebuilt
   from the journal when the version changes, resumed from a cursor when it does not.
2. **The parity matrix as a CI artefact** (master spec §40): one row per metric × harness,
   generated from the differential, with `equal` / `explained` / `regression` and a one-sentence
   reason for every explained row.
3. **The query API** — `GET /api/runtime/metrics` — a real filtered/aggregated read that replaces
   mining `/api/data`, with the **provider** and **run** dimensions available for the first time.
4. **A per-surface cutover**, smallest blast radius first: MCP tools → VS Code status bar → TUI →
   the web dashboard, each behind the flag, each reversible on its own.

## 2. The projections P3 must produce

| Projection | Key | Replaces / feeds |
|---|---|---|
| `sessionMeta` | `(harness, conversationId)` | the consolidate store's record and every surface's session row |
| `runMetrics` | `runId` | new: per-execution figures, and what a shared session displays |
| `agentMetrics` | `runId` | `SessionAgentMetrics`, now for every harness that emits agents |
| `toolMetrics` | `runId` + canonical tool | the tools page, plus **tool duration**, which does not exist today |
| `costByDimension` | harness × provider × model × repo × project × day | the costs page and the query API |
| `taskRollup` | `taskId` | `task-rollup.ts`, with `costMeasured` finally populated (§41) |

Each is a pure `empty`/`fold`/`finish` with its own version, and each carries provenance forward:
a figure's `confidence` is the **weakest** of the events that produced it, never the strongest.

## 3. The query API

```
GET /api/runtime/metrics
  ?from&to                 (UTC days; the billing/tag day rule, stated in the response)
  &harness&provider&model&repo&project&task&tag&machine&member&run
  &groupBy=<dimension[,dimension]>
  &metrics=cost,tokens,sessions,runs,messages,activeMinutes,tools,…
  &cursor&limit
```

Rules:
- **Every response states its basis**: which day rule, which cost basis, which confidence mix, and
  how many rows were `unmeasured`. A total with no account of what it contains is the thing this
  product refuses everywhere else.
- **Paged, always.** No parameter returns the whole store.
- **Capability-aware**: a metric a harness cannot produce is absent from that group with a reason,
  never zero.
- Registered in `capability-guard.ts`; authenticated by default; `safeError` on failure.

## 4. The cutover, and what "serving" means per surface

| Step | Surface | Why this order |
|---|---|---|
| 1 | MCP analytics tools | machine consumers; a wrong number is caught by the differential, not by a person's memory |
| 2 | VS Code status bar (today's totals) | one small figure, its own poll, trivially comparable |
| 3 | TUI dashboard | one reader, `selectors.ts`, already pure |
| 4 | Web dashboard | last, and behind its own flag, because it is where the product's credibility lives |

`/api/data` keeps working throughout and is **not** removed in P3. Removing it is its own later
decision, once every consumer has moved and the query API has carried them for a while.

## 5. Tests

- The P1/P2 property tests, now over the materialised projections (rebuild == resume).
- **Version bump test**: changing a `projectionVersion` forces a rebuild and yields the new answer —
  the lever this product does not have today.
- **The parity matrix runs in CI** over the checked-in fixtures, and on demand
  (`agentop journal parity`) over a real machine's store.
- **Surface-level equality**: for each cut-over surface, the projected response and the legacy
  response are compared on a real store before the flag flips by default.

## 6. Performance

| Budget | Target |
|---|---|
| `/api/runtime/metrics` p95 | < 300 ms over a store of 100k sessions, measured on generated data |
| projection resume after a build | incremental; time proportional to new events, not to history |
| full rebuild of every projection | bounded, reported, and interruptible (it is the version-bump path) |
| memory | streaming fold; no projection holds the journal in RAM |

## 7. Rollback

Per surface, then wholesale: the flags are read per request, so flipping one back is immediate and
needs no restart. Projections are derived — deleting them costs a rebuild, never data.

## 8. Acceptance criteria

1. The parity matrix is green or explained for every metric × harness, generated, and checked in as
   the phase's evidence.
2. Every cut-over surface answers identically (or explainably) from the projection and from the
   legacy path, on a real store, before its flag defaults on.
3. `provider` and `run` are filterable, and the four questions in master spec §37 are answerable.
4. A `projectionVersion` bump rebuilds and changes the answer — demonstrated in a test.
5. The budgets in §6 are met and measured.
6. `/api/data` still works, unchanged, for every consumer that has not moved.
