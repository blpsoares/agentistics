# Session filters that complement instead of overriding

**Date:** 2026-08-14
**Status:** approved design, not implemented
**Surface:** the cockpit's `sessions` tab (`packages/tui/src/control`) and the fleet view
(`packages/server/server/sessions`)

Two defects, reported together because they present together: the list does not show what the
controls say it shows.

---

## 1. The state dimension is controlled from two places, and one silently wins

### What happens

`packages/tui/src/control/tabs/Sessions.tsx` filters with a chain of precedence:

```ts
(states ? states.has(v.state)
  : onlyActive ? sessionRunning(v)
  : sessionNamed(v)
    || ((showClosed || v.state !== 'closed')
      && (showExited || (v.state !== 'exited' && v.state !== 'lost'))))
```

`states` — the aside's **state** section — is the whole answer whenever it is present. The three
switches in the **show** block (`apenas ativas`, `conversas fechadas`, `sessões encerradas`) then
change nothing at all, while continuing to draw their own on/off state.

Measured on the reporting machine (`~/.agentistics/preferences.json`):

```
onlyActive: true, showClosed: false, showExited: false
states: [unknown, waiting, waiting-approval, exited, lost, closed]
```

The screen drew `apenas ativas ●` and listed 62 of 65 sessions, nearly all of them `fechada` and
`encerrada`.

`asideRows` already documents the collision and treats it as a layout problem:

> `active` leads because it OVERRIDES the three under it: with it on they change nothing, and a
> switch that appears to do nothing is one people conclude is broken.

Ordering does not fix a control that lies. The real fault is that **two sections own one
dimension**: which lifecycle states the list contains. The show switches are a coarse vocabulary
for it, the state section a fine one, and they are stored and evaluated as if they were
independent.

### The design — one source, shortcuts that write into it

There is exactly one piece of state for the dimension: **`kept: Set<SessionState>`, the states the
list contains.** It is never null, and it is the only thing the predicate reads.

The show switches become **shortcuts that write into `kept`**, and their on/off is **derived from
it** rather than stored beside it:

| switch | states it names | reads ON when | pressing it |
|---|---|---|---|
| `apenas ativas` | `ACTIVE_STATES` (`working`, `waiting`, `waiting-approval`, `unknown`) | `kept` equals `ACTIVE_STATES` exactly | ON → `kept = ACTIVE_STATES`; OFF → `kept = SESSION_STATES` (everything) |
| `conversas fechadas` | `closed` | `closed ∈ kept` | toggles `closed` membership |
| `sessões encerradas` | `exited`, `lost` | both `∈ kept` | toggles both together |

The state section edits the same set, one state per row, and the switches repaint from it on the
same frame. The two can no longer disagree, because there is nothing to disagree about.

The visible consequence is the point: with `apenas ativas` on, ticking `conversas fechadas` widens
`kept` and `apenas ativas` **turns itself off**, because it no longer describes the list. A switch
never stays lit over a list it does not describe.

**Unticking the last remaining state is refused.** The rule and its reasoning already exist in
`Sessions.tsx` ("Emptying it would show nothing at all, which is never what unticking the last box
means"); it moves into the pure module and lives there once.

### The named-row exception becomes a switch

Today a session the user renamed, noted or filed under a task (`sessionNamed`) passes the
closed/exited switches unconditionally. That exception exists for a real reason — a reboot turns
every managed session `lost`, and without it the default list came back empty, taking the names
with it — but it is invisible, so it is the same class of defect as the one above.

It becomes a fourth row in the show block, **`sessões nomeadas sempre`, off by default**:

```
keep(v) = kept.has(v.state) || (showNamed && sessionNamed(v))
```

Off — how it ships — the state filter applies to everyone, which is what was asked for. On, named
rows survive a filter that would otherwise drop them. It is still a widening, but a widening
someone chose and can see.

### Defaults

`DEFAULT_SESSION_VIEW` already says grouped by project, only active. Nothing changes there; it
starts being true, because `states` stops being a second, silent answer.

### Persistence and the one-time migration

`SessionViewPrefs` keeps a single stored source for the dimension:

- `states: string[]` — `kept`, written on every change.
- `statesVersion: 2` — marks a `states` written under this model.
- `showNamed?: boolean` — the new switch.

`showClosed` / `showExited` / `onlyActive` become **derived-on-write only**: still written, so an
older binary reading this file behaves sanely, never read back by current code except by the
migration below. Same pattern as `deniedRepos` in the sharing rules.

`migrateStateFilter(prefs)` — pure, idempotent:

1. `statesVersion === 2` and `states` present → `new Set(states)`.
2. Otherwise **the switches win** and any stored `states` is discarded:
   `kept = onlyActive ? ACTIVE_STATES : ACTIVE_STATES ∪ (showClosed ? {closed} : ∅) ∪ (showExited ? {exited, lost} : ∅)`,
   with `DEFAULT_SESSION_VIEW` filling absent fields.

Step 2 discards a stored `states` on purpose, and this is the one place the design deliberately
drops user input. A stored `states` could only ever have been written while it silently overrode
the switches beside it — the user never saw the two evaluated together, so it is not a statement
they could have judged. The switches are what they last set and last saw. On the reporting machine
the migration yields `kept = ACTIVE_STATES`, which is the list they were asking for.

### Where the code goes

A new pure module, `packages/tui/src/control/session-filter.ts`:

- `DEFAULT_KEPT`
- `toggleState(kept, state)` — with the never-empty rule
- `SHORTCUT_STATES: Record<'active' | 'closed' | 'exited', readonly SessionState[]>`
- `shortcutOn(kept, shortcut)` / `applyShortcut(kept, shortcut)`
- `sessionKept(session, kept, showNamed)` — the whole predicate
- `migrateStateFilter(prefs)`

`Sessions.tsx` drops `showClosed`, `showExited`, `onlyActive` and `states` as four independent
`useState`s and holds `kept` plus `showNamed`. `asideRows` reads the switch states through
`shortcutOn`. The keyboard accelerators (`c`, `e`, `l`, `ctrl+a`) call `applyShortcut` and are
otherwise unchanged.

### Tests — `session-filter.test.ts`

- The toggle table above, exhaustively.
- Unticking the last state is a no-op.
- `applyShortcut('active')` off → every state; on → exactly `ACTIVE_STATES`.
- `conversas fechadas` on top of `apenas ativas` turns `apenas ativas` off, as read by `shortcutOn`.
- **Cross-check against the old predicate**: for every combination of
  `onlyActive × showClosed × showExited` and every `SessionState`, the migrated `kept` keeps
  exactly the rows the old chain kept, once the named exception is excluded. This is what proves
  no behaviour is changed by accident — only the collision is removed.

---

## 2. One managed session hides every other assistant in its directory

### What happens

`packages/server/server/sessions/session-view.ts`:

```ts
const covered = (p: HarnessProcess): boolean => managed.some(m =>
  m.harness === p.harness &&
  m.status !== 'lost' &&
  sessionAtCwd({ current_cwd: m.cwd, project_path: m.cwd }, p.cwd))
```

That is a **bucket membership test, not a pairing**. One managed row running in a directory covers
*every* process of that harness in that directory, however many there are. Run two agentop
sessions in a repo and every assistant you start there by hand disappears from the fleet — silently,
which is exactly what the merged view exists to prevent.

Measured on the reporting machine:

| pid | ppid | what it is | cwd |
|---|---|---|---|
| pane of `agentop-578408308a` | 2759 (tmux) | managed claude | `~/agentistics` |
| pane of `agentop-3236ec1e26` | 2759 (tmux) | managed claude | `~/agentistics` |
| 152979 | 152397 (`Relay`, a terminal outside tmux) | **claude started by hand** | `~/agentistics` |

`tmux -L agentop list-panes` reports 14 panes; `agentop session list --json` reports 14 `running`
and **zero** `external`. The hand-started session is real, running, and unlisted.

### The design — greedy one-to-one pairing

Coverage becomes a matching. Each managed row that is running consumes **at most one** process it
matches; whatever is left over is external.

New pure function, `packages/server/server/sessions/process-coverage.ts`:

```ts
export function uncoveredProcesses(
  managed: readonly { harness?: HarnessId; cwd: string; status: string; createdMs?: number }[],
  processes: readonly HarnessProcess[],
): HarnessProcess[]
```

- Consider only managed rows with a known harness and `status !== 'lost'` — unchanged, and for the
  reasons already documented there (a row whose harness is unknown covers nothing; a `lost` row
  explains no live process).
- Sort both sides ascending by start time before matching, so the pairing is deterministic and the
  process left over tends to be the most recently started one.
- For each managed row in order, claim the first unclaimed process with the same harness that
  satisfies `sessionAtCwd`.
- Return the unclaimed processes.

`session-view.ts` calls it once and maps the result, replacing `o.processes.filter(p => !covered(p))`.

The invariant it buys: **the view can never hide more assistants than it has managed sessions to
explain them with.**

### The false positive this uncovers, and its fix

Coverage-by-bucket is currently also hiding processes that are not sessions at all. Measured:
`claude daemon run --origin transient --spawned-by …` (pid 224989) is a child of a managed pane and
is swallowed today by the directory bucket. Once coverage is a pairing, it surfaces as a phantom
external row.

So the scanner in `packages/server/server/live-sessions.ts` gains an argv gate: a process whose
argv marks it non-interactive is not a session and is never reported as one. **The list of
non-interactive forms is read from each CLI's own `--help`, never guessed** — the rule the session
manager already applies to spawn flags and resume flags. `claude daemon` is the confirmed case; any
other entry must be justified from help output in the implementing commit.

### Tests

`process-coverage.test.ts`:

- 2 managed + 3 matching processes → 1 external.
- 0 managed + 1 process → 1 external.
- A `lost` managed row covers nothing.
- A managed row of a different harness in the same directory covers nothing.
- A managed row with no harness covers nothing.
- Same inputs in a different order → the same number of externals (determinism).

`session-view.test.ts` gains the end-to-end case: two managed claude rows and three claude
processes in one directory yield exactly one `external` row carrying that harness and cwd.

`live-sessions.test.ts` gains: a `claude daemon run …` argv is not reported as a harness process,
while a bare `claude` in the same directory is.

---

## Scope

In: the two defects above, their pure modules, their tests, and the strings for the one new switch
(EN + PT).

Out: pane-pid-exact coverage (`#{pane_pid}` from tmux plus a pid on `HarnessProcess`) — the
provably correct key, and a change to the backend contract, the scanner and `tmux-cli.ts`. The
greedy pairing is sound without it and does not block it. Also out: any change to grouping, sort,
search, task scope or project scope, which are orthogonal dimensions and compose correctly today.
