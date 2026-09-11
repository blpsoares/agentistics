# Task/subtask/session hierarchy — three shapes, chosen per task, never invented

## 0. Correction of course

A previous session on this same task (`t-918cc82233`) read the user's four diagrams, recommended
building only "possibility #2" (subtask with N sessions, rolling up into its own total), and filed
six subtasks for exactly that. The user corrected this: **the three shapes in the diagrams are
options to pick per task, not three drafts of one design where the last one wins.** Sometimes a
task is simple enough for sessions directly on it (#1); sometimes it is broken into subtasks (#2);
sometimes both at once (#3, "n1 + n2"). The previous recommendation reached for #2 alone because
that is the one the current code already allows — `planAttach` (`task-attach.ts`) hard-refuses a
session filed straight on a task (`needs_subtask`) — and treated an existing rule as if it settled
the question, rather than asking whether the rule itself should still hold.

This document is the full specification the user asked for: it re-reads all three diagrams, decides
whether/how to reopen direct filing, and specifies how the rollup sums both branches when a task
uses both. **The six subtasks already filed (`s-db765e0d03`, `s-843b0dd3cb`, `s-b7392c752d`,
`s-af6c8722f3`, `s-2ed5531c53`, `s-3750c3f14f`) stay exactly as they are** — they are the "possibility
#2" slice of this spec, and everything below is additive on top of them, never a replacement.

## 1. What the diagrams actually say (read again, image by image)

Legend (`f-e1ade0e26d.png`): **TM** = Task Main (green), **ST** = Subtask (blue), **S\<n\>** = a
session on the Task Main directly (orange), **STSS\<n\>** = a Subtask sub-session (purple).

**#1 — simplest** (`f-1025fcb764.png`): `Criar ALM` (TM) has two sessions, S1 and S2, wired straight
to it — no subtasks at all. The rollup box: *"TASK MAIN → custo total, total de sessões &
subsessões, total de subtarefas (todas as métricas possíveis)"*, and under it S1 and S2 each show
their own total cost. User's own words: *"Prós: não tem tanta granularidade por tarefa, são sessões
diferentes tocando a task main. Contras: não consigo saber quanto custou a execução das etapas
separadamente caso seja uma task que deveria ter quebras."*

**#2 — medium, covers most cases** (`f-afa5ed12e4.png`): `Criar ALM` → `Escrever spec` (ST1) →
(dotted arrows) ST2, ST3, ST4 → each has 1+ sessions (STSS1..6, ST3's two sequential). **This dotted
fan-out is a workflow narration, not a data hierarchy**: the user's own annotation says ST1's
*output* (the written spec) is what an LLM later uses, via the agentistics MCP, to *create* ST2/3/4
as new subtasks of the *same* Task Main ("a spec escrita pra agrupar as tarefas da spec e criar
tarefas que podem ser tocadas em cada sessão... spec gerou 30 tasks... conseguimos agrupar por
grupos de 10... serão 3 subtasks"). The rollup box at the bottom confirms this reading exactly: it
shows only **ST1** with **STSS1, STSS2** nested under it — never ST2/3/4 nested under ST1 — because
ST1 is a ordinary subtask like any other, sitting beside ST2/3/4 as a **sibling**, not their parent.
*"Essa estrutura se repete pra todas subtasks e subtask-sessions que tiverem"* — one flat level of
subtasks under the task, each with any number of sessions. **This is the existing `Task → Subtask →
Session(s)` model, unmodified — no nested subtask-of-subtask is being asked for.** That resolves a
real ambiguity the picture alone leaves open, and it means #2 needs no schema change at all (see
§3).

**#3 — advanced, n1+n2** (`f-08310b9a08.png`): literally #1 and #2 layered on the same Task Main —
S1/S2 wired directly to `Criar ALM`, *and* the same ST1→ST2/3/4→STSS1..6 fan-out beside them. The
rollup box shows the Task Main's total covering **both** the direct S1/S2 rows and the ST1 subtree,
side by side, in one box.

## 2. What already exists, and what the reopened code has to answer for

### 2.1 The subtask side (#2) is ~90% built — unchanged by this spec

Confirmed by re-reading `task-attach.ts`, `SubtaskSessions.tsx`: a subtask already takes **any
number** of sessions (`ManagedSession.subtaskId`, no cap), `SubtaskSessions.tsx` already lists every
one of them with a "file another" control, and `Subtask.sessionId` (singular) is legacy-only, read
by nobody, written by nobody. The only real gap is the one the six existing subtasks already cover:
**a subtask has no rollup of its own** (`task-model.ts`'s `Subtask` docblock, `SubtaskTable.tsx`'s
header comment). §4 below extends that work; it does not redo it.

### 2.2 Why direct filing was refused, in the refusing code's own words

`task-attach.ts`, current text:

> **A session is filed under a SUBTASK. Never a delivery directly, never two, never both.**
> A delivery is the unit of DELIVERY; a subtask is the unit of WORK, and work is what a session
> does. Allowing both meant the same delivery could hold sessions at two levels with no rule for
> reading them together — "did this cost include the subtasks or not" had no answer.

`planAttach`'s `{kind: 'task'}` branch turns that into code: any target naming a task, direct, comes
back `{ok: false, reason: 'needs_subtask'}` — refused, full stop, regardless of whether the task has
subtasks or not. The MCP tool (`agentistics_task_session`) duplicates the refusal client-side, in a
sentence naming the same reason.

**Is that reasoning still true?** No — and the reason it was true is exactly the reason it stops
being true. When that rule was written, `rowsOfTask` already summed *every* row carrying the task's
id into `TaskDetail.rollup` regardless of `subtaskId` (`task-report.ts` — filters only on `taskId`,
never conditions on `subtaskId`), so **the task-level total was never actually ambiguous**; it
always included direct-filed rows correctly. What had no answer was the question one level down:
*"how much did **this piece** — this subtask — cost", because a subtask carried no rollup at all*.
If a task mixed direct sessions with subtask-filed ones back then, the subtask-level view showed
nothing for either kind, and there was no way to tell whether a subtask's silence meant "nothing
happened here" or "some of this task's cost is sitting outside every subtask, unaccounted". Forcing
every session through a subtask was the only way, at the time, to make the finer-grained view ever
add up to anything.

**That gap closes as a *side effect* of the six subtasks already filed.** Once a subtask carries its
own rollup (`s-db765e0d03`), "how much did this piece cost" has an answer whether or not the task
also carries direct sessions — and a task's sessions that carry no `subtaskId` become their own,
equally answerable bucket (§4.2), exactly the way `attemptViews` already gives the sessions filed
under no *attempt* their own bucket rather than dropping them. The one thing that was genuinely
missing — a place to put "how much did the un-broken-out part of this task cost" — is the thing this
spec adds. Once it exists, the original worry has a name and a number instead of a silence.

One more thing worth noticing: `task-model.ts`'s own `Subtask.sessionId` field docblock never
stopped saying *"the task's own sessions stay on the task"* — the data model's own comment assumed
direct-task sessions were a normal thing throughout, even while `task-attach.ts` refused to create
any. Reopening #1 is a restoration of that assumption, not a new one.

## 3. The decision: no `mode` field, ever

The three "possibilities" are **not** stored as a chosen mode on `Task`. A `Task.hierarchyMode:
'direct' | 'subtasks' | 'both'` field was considered and rejected:

- It would be **exactly the kind of invented state this codebase refuses elsewhere** — see
  `HARNESS_CAPABILITIES`'s "declare only what is true", or the context gauge's "a window that is
  never guessed". A stored mode can drift from what actually happened the moment someone files a
  session the "other" way — and nothing would stop them, since the underlying attach rule allows
  both. A field that can silently lie is worse than no field.
- It would answer a question nobody is actually asking. The reader does not need the *board* to
  remember which mode a task is in; they need to see, for **this** task, what is filed where and
  what each part cost. That is a read over the existing rows, not a setting.
- The shape a task ends up in is **entirely emergent** from what gets attached: all sessions direct
  → #1; all sessions under subtasks → #2; a mix → #3. Nothing forces a task into one shape, same as
  today nothing forces every task to use subtasks, or attempts, or a due date.

So the fix is exactly one rule change (§4.1) plus one read-side addition (§4.2). No migration, no
new field on `Task` or `Subtask`, no new enum.

## 4. The design

### 4.1 Reopen `planAttach`'s task-level target

`task-attach.ts`, `planAttach`:

```ts
if (o.target.kind === 'task') {
  if (!o.taskIds.includes(o.target.id)) return { ok: false, reason: 'no_such_task' }
  // A session may be filed straight on the delivery — see §2.2/§4.2 of
  // docs/superpowers/specs/2026-09-10-task-session-hierarchy-design.md for why this is safe: the
  // task's own rollup already sums every row by taskId regardless of subtaskId, and the
  // subtask-rollup work (task-report.ts's per-subtask views) gives the "not broken out" part of a
  // task its own answerable bucket instead of an unaccounted-for gap.
  return { ok: true, taskId: o.target.id, subtaskId: null }
}
```

Consequences, all mechanical:

- `AttachPlan['reason']` drops `needs_subtask` — nothing produces it any more.
- `task-web.ts`'s `attachSession()` needs **no change**: it already calls `planAttach` with
  `{kind: o.subtaskId ? 'subtask' : 'task', id: task.id}` and already accepts `subtaskId` as
  optional. It was only ever `planAttach` refusing the task branch.
- `task-attach.test.ts`'s first test (*"REFUSES a delivery as a target"*) flips to asserting success
  (`{ok: true, taskId: 't1', subtaskId: null}`); a new test confirms a task **with existing
  subtasks** still accepts a direct session (#3 — the two branches are not mutually exclusive).
- `task-attach.ts`'s own module docblock is rewritten: the "never a delivery directly" absolute
  becomes "a session may be filed on the delivery directly, or on one of its subtasks, or both — see
  the 2026-09-10 spec for why holding both is safe." The "rows filed directly... before this rule
  existed are NOT migrated... visible... one click from a subtask" paragraph is deleted outright:
  those rows are not stragglers from before a rule any more, they are ordinary, first-class,
  directly-filed sessions, exactly like a brand new one filed the same way today.
- `SubtaskSessions.tsx`'s docblock line *"a delivery holds none directly"* is corrected to say the
  opposite, alongside the "no rollup" correction the six existing subtasks already schedule for
  `task-model.ts`/`SubtaskTable.tsx`.
- The MCP tool `agentistics_task_session` (`agentistics-mcp.ts`) drops its client-side pre-check
  (currently: no `subtaskId` → hard `isError` refusal) and its description stops saying "a session is
  NEVER filed under a task directly". `subtaskId` becomes documented as **optional**: named → files
  under that subtask; omitted → files directly on the task.
- `agentistics_task_subtask`'s description keeps its "no cost of its own" framing until §4.2 ships,
  at which point it is corrected together with the `task-model.ts`/`SubtaskTable.tsx` comments
  (already `s-843b0dd3cb`'s job — see §5).

Nothing here touches `Task.blockedBy` (cross-task blocking) or `Subtask.blockedBy` (cross-subtask
gating within one task) — those are a different axis and are untouched by where a session is filed.

### 4.2 The rollup: both branches, summed once, never invented

**The task-level total needs no change.** `rowsOfTask(task, rows)` (`task-report.ts`) already
matches every `ManagedSession` whose `taskId` equals the task's id — it has never conditioned on
`subtaskId`. So `TaskDetail.rollup` and `TaskListRow.rollup` (`rollupAttempt(rollupSessionsFor(mine,
...))`) already, today, sum a task's direct sessions and its subtasks' sessions together, exactly
once each (`distinctConversations` still dedupes by conversation id first). Reopening §4.1 does not
put this figure at risk — it was already the union of both branches, because the split by
`subtaskId` never entered into it.

What is missing is the **breakdown** — being able to see, separately, what the direct branch cost
and what each subtask cost, so a #3 task's Task Main reads as more than one number. This is the
piece the six existing subtasks build for the *subtask* half (`s-db765e0d03`); this spec adds the
*direct* half beside it, in the exact same shape, because a breakdown that only ever shows subtasks
would silently hide a #3 task's other branch.

New export in `task-report.ts`, following `attemptViews`'s own pattern (a rollup per named group,
plus one bucket, `id: null`, for the rows that fall outside every group):

```ts
/** One rollup for a subtask, or for the direct branch (`id: null`) — sessions filed on the task
 *  itself, under no subtask. Every row of a task falls into EXACTLY one of these buckets, because
 *  `subtaskId` and "no subtaskId" partition `rowsOfTask(task, rows)` completely — the same
 *  guarantee `filedUnder` already gives every session a single owner. */
export interface SubtaskView {
  id: string | null
  rollup: AttemptRollup
}

export function subtaskViews(
  task: Task,
  subtasks: readonly Subtask[],
  rows: readonly ManagedSession[],  // already `rowsOfTask(task, allRows)` — the task's own rows
  metas: ReadonlyMap<string, SessionMeta>,
  costOf: (m: SessionMeta) => number,
): SubtaskView[] {
  const mine = subtasks.filter(s => s.taskId === task.id)
  const views: SubtaskView[] = mine.map(s => ({
    id: s.id,
    rollup: rollupAttempt({
      sessions: rollupSessionsFor(rows.filter(r => r.subtaskId === s.id), metas, costOf),
    }),
  }))
  const direct = rows.filter(r => !r.subtaskId)
  if (direct.length > 0) {
    views.push({
      id: null,
      rollup: rollupAttempt({ sessions: rollupSessionsFor(direct, metas, costOf) }),
    })
  }
  return views
}
```

Wired into `buildTaskDetail` exactly like `attemptViews` is today: `subtaskRollups:
subtaskViews(o.task, o.subtasks ?? [], mine, o.metas, o.costOf)` added to `TaskDetail`. No second
implementation of the sum — every `AttemptRollup` in the list is `rollupAttempt` over a
*partition* of the same row set `TaskDetail.rollup` sums whole; nothing here re-derives the total by
adding the partitions back up. The two-way split is a **read**, never a source of truth.

- `id: null` is a bucket the same way `AttemptView`'s `id: null, label: 'no attempt named'` already
  is — but named for what it actually is here: sessions filed directly on the task. It is **omitted**
  when there are none (a task fully in shape #2 draws no empty "direct" row), the same way
  `attemptViews`'s loose bucket is only pushed `if (loose.length > 0)`.
- A task in shape **#1** (no subtasks at all) gets exactly one `SubtaskView` with `id: null` — its
  whole rollup, which already equals `TaskDetail.rollup`.
- A task in shape **#2** (every session under a subtask) gets one `SubtaskView` per subtask and no
  `id: null` row.
- A task in shape **#3** gets both — one `id: null` row for the direct sessions plus one row per
  subtask — which is the diagram's own rollup box, read literally: the Task Main total, the direct
  sessions' own totals, and each subtask's own total, all present at once.
- **Nothing here invents granularity the data does not support.** A subtask with no sessions filed
  under it yet still gets a `SubtaskView` (via the `mine.map` above) whose `rollup` is
  `rollupAttempt({sessions: []})` — `sessionsUsed: 0`, every metric `null`. That is the honest
  "nothing filed here yet" answer, not a zero pretending to be a measurement.

### 4.3 Wire and MCP

`web/src/lib/tasks.ts` mirrors the new field on `TaskDetail`:

```ts
export interface SubtaskView { id: string | null; rollup: AttemptRollup }
export interface TaskDetail {
  // …unchanged fields…
  subtaskRollups: SubtaskView[]
}
```

`GET /api/tasks/:id` already returns the whole `TaskDetail` object built by `buildTaskDetail` — the
new field reaches the browser and the MCP (`agentistics_task`, which just relays that same JSON)
with no route change. `agentistics_task_subtask`'s description gets one added sentence once this
ships: *"A subtask's own cost/tokens/sessions are in `subtaskRollups` on `agentistics_task`'s reply,
keyed by subtask id; `id: null` there is the task's directly-filed sessions."*

This does **not** travel to a central this round, for the same reason the per-attempt breakdown
does not today: `CentralTaskRow` (`web/src/lib/tasks.ts`) carries only the whole-task `rollup`, never
`attempts` or (now) `subtaskRollups`. Extending central sync to carry either breakdown is a separate
piece of work if wanted later — nothing here blocks it, and nothing here requires it.

### 4.4 UI: a session can be filed directly, and both branches are visible

**`SessionFiling.tsx`** currently only ever offers subtask rows (`subtaskRow`) and its empty state
reads *"a sessão só se filia a uma subtarefa"* — no path exists to file directly. It gains one more
selectable row, drawn the same way as a subtask row (radio, `CornerDownRight`, same list), reading
*"— direto na entrega —"* / *"— directly on the delivery —"*, calling
`attachSession(target.task.id, p.session.id)` with **no** `subtaskId`. It sits **above** the subtask
list (the flat, no-decomposition option leads, matching diagram #1 being the simplest), and the
"this delivery has no subtasks yet" copy stops implying a subtask is mandatory — it now reads
roughly *"File it here directly, or break the delivery into subtasks below."*

**`SubtaskTable.tsx`** (once `s-2ed5531c53` lands per-subtask rows) gets one more row, styled
distinctly from a real subtask (no status chip, no due date — it is not a piece of planned work, it
is "everything not broken out"), showing the `id: null` `SubtaskView`'s rollup when it is present.
It is a footer-style row, not a fake subtask, and it disappears entirely on a task with no direct
sessions — the same rule the bucket itself already follows server-side.

## 5. Relationship to the six subtasks already filed — additive, not a rewrite

| Existing subtask | Still does | This spec adds |
|---|---|---|
| `s-db765e0d03` (rollup per subtask) | The per-subtask half of `subtaskViews` (§4.2) | The `id: null` direct bucket beside it |
| `s-843b0dd3cb` (fix "no cost" comments) | `task-model.ts`/`SubtaskTable.tsx` | Also fix `task-attach.ts`'s "never directly" docblock and `SubtaskSessions.tsx`'s "holds none directly" line (§4.1) |
| `s-b7392c752d` (expose via HTTP) | `task-web.ts` + `web/src/lib/tasks.ts` mirror | The same wiring carries `subtaskRollups`, id:null included (§4.3) |
| `s-af6c8722f3` (expose via MCP) | `agentistics_task` read + `agentistics_task_subtask` description | `agentistics_task_session`'s description/refusal also changes (§4.1) — a second, closely related MCP surface this subtask did not originally cover |
| `s-2ed5531c53` (UI: per-subtask row) | Cost/tokens/sessions per subtask row | The direct-sessions footer row beside it (§4.4) |
| `s-3750c3f14f` (e2e test + docs) | Total = subtasks' sum, no duplication | Extend the matrix to all three shapes (§7) and correct `CLAUDE.md`'s ALM section for the reopened rule |

None of the six need editing or renumbering. They were correct for shape #2 the day they were filed
and remain so.

## 6. Out of scope, deliberately

- **Nested subtasks (subtask-of-subtask).** §1 already found the diagrams do not ask for this — the
  dotted ST1→ST2/3/4 fan-out is a workflow narration, not a data relationship. If a real need for
  nesting shows up later it is its own spec; inventing it here would be exactly the kind of
  granularity the data does not currently support.
- **A stored "mode" on `Task`.** Rejected in §3, not merely unbuilt.
- **Sending the subtask/direct breakdown to a central.** Only the whole-task `rollup` travels, same
  as the attempt breakdown today (§4.3).
- **The preset/wake session idea** (`s-d85c7d9d9d`). Explicitly a different topic per the task's own
  history; untouched here.
- **Changing `Task.blockedBy` / `Subtask.blockedBy` semantics.** Orthogonal to where a session is
  filed.

## 7. Testing

- `task-attach.test.ts`: flip the "REFUSES a delivery as a target" test to assert success; add a
  case where a task with existing subtasks still accepts a direct-filed session (#3 coexistence);
  keep every existing `blocked`/`no_such_*` case as-is (unaffected).
- `task-report.test.ts` (new or extended): for a synthetic task exercising all three shapes —
  - **#1** (two direct sessions, no subtasks): `subtaskViews` returns exactly one `{id: null, ...}`
    row whose rollup equals `TaskDetail.rollup`.
  - **#2** (three subtasks, each with sessions, no direct ones): `subtaskViews` returns three rows,
    no `id: null` row, and the three rollups' `costUSD`/`tokens` sum (where all non-null) to
    `TaskDetail.rollup`'s.
  - **#3** (two direct + three subtasks with sessions): `subtaskViews` returns four rows total (one
    `id: null` + three subtasks), and their union — by session, not by re-summing figures — is
    exactly the set `TaskDetail.rollup` was computed over, with no session appearing in two buckets
    (assert via `sessionsUsed` counts and rowId sets, not only totals, so a duplication that happens
    to cancel out numerically cannot pass silently).
- One MCP-level check: `agentistics_task_session` with no `subtaskId` succeeds and the resulting
  session shows up in `agentistics_task`'s `subtaskRollups` under `id: null`.
- CLAUDE.md's ALM section gets the reopened rule recorded (folded into `s-3750c3f14f`'s existing
  "document the change" line) — this file itself is not meant to be re-read as living documentation
  once the code lands; CLAUDE.md is.
