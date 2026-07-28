# Harness contract

Every harness Agentistics tracks must satisfy this contract. It is the **project-wide definition of
each metric** — not a per-adapter choice. Two adapters computing "duration" differently is not a
difference in the harnesses, it is a bug in one of them.

`CLAUDE.md` ("Adding a harness — the complete checklist") lists the *mechanical* steps: the
`HarnessId`, the capability record, the sort record, the adapter pair, live sessions, the frontend
labels, the docs. **This file defines what the numbers must MEAN.** Do both.

The governing principle, stated once:

> **Report what the harness recorded. When it recorded nothing, report nothing.**
>
> A confident wrong number is worse than a visible gap. `N/A` and `—` are correct answers. A
> plausible-looking default, an inferred threshold, or a fallback rate applied silently is not.

---

## 1. Time — `duration_minutes` vs `active_minutes`

Two fields, and they answer different questions. Both are required.

| Field | Meaning | Rule |
|---|---|---|
| `duration_minutes` | **Wall clock.** Last event − first event. | Always populated. |
| `active_minutes` | **Time actually worked.** Σ per-turn duration. | Populated whenever the transcript carries usable timing; `undefined` otherwise. |

### Why both

A session reopened across three weeks has a wall clock of ~500h. That is a true statement about
when the session was open and a useless statement about how long it was worked on. Ranking
"longest session" by it crowns whichever session merely stayed open the longest.

Active time alone would be equally misleading in the other direction — it hides that the work was
spread across weeks. **Every surface shows both**, active as the headline and elapsed as its
qualifier: `3h 12m ativo · 958h decorrido`.

### The rule — one implementation, `computeActiveTime()`

`packages/core/src/activeTime.ts`. **Adapters must not compute time themselves**; they emit
`TurnEvent[]` and call `activeMinutesOf()`. A turn runs from a human prompt until the harness stops
working on it.

1. **If the harness measured the turn itself, that number wins.** Set `measuredMs`.
2. **Otherwise reconstruct from event timestamps.** This is the same quantity, not an approximation
   of a different one — validated against Claude Code's own `turn_duration` over 1326 real turns:
   median difference **0.0s**, within 5s on 63%.
3. **If the harness writes an explicit end-of-turn** (abort, shutdown), set `turnEnd`. Without it an
   aborted turn stays open to the last line of the file — a real Copilot session aborted at 20:13
   whose file ends at 23:34 reported 3.4h of "active" work.
4. **If there is no usable timing at all, the result is `undefined`.** The UI shows `—`.

### What this deliberately does NOT do

It does not subtract "the user walked away mid-turn." A turn blocked on a permission prompt
overnight is measured as ~8h **by the harness itself**. Cutting it would need an arbitrary idle
cutoff — a made-up number inside the metric that exists to stop reporting made-up numbers.

The gap that IS excluded — harness finishes → human's next prompt — is excluded because it is a
real, observable boundary, not a threshold.

**Do not add an idle-gap heuristic.** If a future harness genuinely records user presence (an
explicit AFK / idle event), that is a measurement and may close a turn via `turnEnd`. An inferred
one may not.

### Where each harness's turn time comes from

| Harness | Source | Measured? |
|---|---|---|
| claude | `{"type":"system","subtype":"turn_duration","durationMs":N}` | yes, when present; timestamps otherwise |
| codex | `task_complete.duration_ms` | yes |
| copilot | `assistant.turn_start` → `assistant.turn_end`; `abort` / `session.shutdown` close an open turn | yes (bracket) |
| gemini | message timestamps | reconstructed |
| antigravity | step `created_at` timestamps | reconstructed |
| kimi | wire `time` field; subagent wires merged and **sorted** before use | reconstructed |

**Sub-agents never add time.** A subagent runs *inside* the parent turn that dispatched it — its
span is already inside the parent's. Antigravity's `mergeAntigravityChild` keeps the parent's
`active_minutes`; Kimi sorts every agent's events into one chronological stream. Summing them
double-counts the same wall clock.

---

## 2. Cost and pricing

Covered in depth in `CLAUDE.md` (§ "Pricing — three layered sources"). The contract:

- **Report the bare model id.** Strip any `provider/` prefix (`kimi-parse.ts` does this). The
  shared table prices it; you almost never add pricing code.
- **Cost is `calcCost()`, never an inline calculation.** One implementation, `@agentistics/core`.
- **Never guess a rate.** A wrong price is invisible; a missing one is visible — Settings → Pricing
  lists any model this machine used that no source can price. Add a rate only with a **verified,
  dated source comment**.
- A harness that routes to other vendors (Kimi, Antigravity) reports **that vendor's** model.
  A provider is a billing entity; a harness is not.

## 3. Tokens

- Find the **one** place the harness records usage and count only that. Both Kimi and Codex
  publish the same usage twice in different envelopes — summing both doubles every figure.
- Know whether records are **cumulative** (Codex: last one wins) or **per-turn increments**
  (Kimi: sum). Getting this backwards is silent.
- Split cached from fresh input. Codex's `input_tokens` **includes** the cached portion; store
  `total − cached` in `input_tokens` and the cached part in `cache_read_input_tokens`.
- No cache-write counter → leave `cache_creation_input_tokens` at 0, and say so in the capability
  comment.

## 4. Capabilities — `N/A` vs a real `0`

`HARNESS_CAPABILITIES` (`packages/core/src/types.ts`) is a `Record<HarnessId, …>`, so the build
fails until a new harness declares every flag. **Be honest.** A flag set `true` for something the
harness cannot produce renders a confident `0`, which is exactly the failure this mechanism exists
to prevent. `activeTime: false` means the UI shows only wall-clock elapsed.

## 5. Filters and aggregation

- **`stats-cache.json` is Claude-only.** Never aggregate another harness from it. Non-Claude
  totals come from per-session sums, everywhere — dashboard, Compare page, team central.
- **Never hardcode a harness list.** `HARNESS_ORDER` derives from a `Record`, because TypeScript
  accepts an array literal with a member missing — that silently dropped a harness from the Compare
  page, the filter bar, the data-source list and the consolidate store while the build stayed green.
- **A filter must not silently fall back to a fraction of its own scope.** A member's deep history
  exists only in the stats caches; `resolveMachineCacheScope()` returns `null` — "fall back to the
  per-session sum" — only when the caches cannot serve the scope *exactly*.
- Every session-level field you add must survive the whole pipeline: parser → consolidate store →
  team uploader → Mongo → `loadSessionMetas`. `loadSessionMetas` builds `SessionMeta` **field by
  field**; a field not listed there is dropped on the way back in, silently.

## 6. Timestamps

Bucket activity hours on the **local** clock (`getHours()`), like every existing adapter. Reading a
UTC timestamp as local put the peak-usage chart off by hours for four harnesses at once.

## 7. Purity and failure

- Split each adapter in two: `<id>.ts` does I/O, `<id>-parse.ts` is **pure** and takes strings.
  Only the pure half is unit-testable, and only it is easy to reason about.
- **A malformed, locked or missing input yields empty data, never a throw.** One corrupt file must
  not take down the whole scan. Antigravity's protobuf reader returns `null` on junk; a locked
  SQLite DB degrades to zero tokens.
- Drop bootstrap/stub sessions with no genuine content (Gemini writes many). A harness appears in
  the selector only when it contributes a real session.

## 8. Verification before claiming it works

Run the parser over **real files on disk** and eyeball the output — every rule above was written
after real data disproved something that looked right in code:

```bash
bun test                    # pure-function unit tests
bun tsc --noEmit
```

Then compare against the harness's own numbers where it publishes any. For active time, the check
that matters is: *does the reconstruction agree with the harness's own measurement where both
exist?* If a future harness publishes durations, run that comparison before trusting the
reconstruction for the turns where it doesn't.
