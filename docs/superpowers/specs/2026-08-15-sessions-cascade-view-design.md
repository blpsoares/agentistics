# Cascade view for sessions — design

Date: 2026-08-15
Status: approved, ready for an implementation plan

## The problem

The sessions cockpit arranges the fleet along one dimension at a time — status, repo, project,
task, harness, model, marked. Every arrangement is FLAT: one band per bucket, sessions inside it.

That is the wrong shape for the way this repository is actually worked in. A single project holds
sessions at several depths below its root — `packages/tui`, `packages/server`, and a linked
worktree per piece of work under `.claude/worktrees/`. Grouping by project puts all of them in one
undifferentiated run under `agentistics`, so the band says WHICH project and nothing about WHERE.
Grouping by directory instead files one project as N unrelated names, which is the very defect
`projectGroup` was introduced to fix.

What is missing is the middle: the project as the root, and the directories under it as branches.

```
agentistics
 ├ packages/tui
 │  └ 3f5f  working   refactor the table
 └ .claude/worktrees
    ├ session-monitor
    │  └ a215  working   MAIN
    └ billing-basis
       └ 1155  exited    api vs plan costs
aipe
 └ a7a6  waiting   agentop CLI + aipe
```

## What is being built

A new ARRANGEMENT called `tree`, offered wherever the existing arrangements are offered, in both
the list layout and the card grid.

Four decisions, settled with the user:

1. **The root is the project**, not the filesystem. Branches are the segments of `cwd` BELOW the
   project's root directory.
2. **Single-child chains are compressed.** `.claude/worktrees/session-monitor` is one row while
   nothing branches off it; the moment a second worktree exists, `.claude/worktrees` becomes a node
   and both descend from it.
3. **The tree is static in v1.** No collapse/expand. The cursor keeps landing only on sessions.
4. **Cards render one band per branch, titled with a breadcrumb** — `agentistics ›
   .claude/worktrees › session-monitor`. The grid's geometry does not change.

## Architecture

### 1. `tree` is an ARRANGEMENT, not a dimension

`SessionGroupingId` becomes `'none' | 'tree' | SessionDimensionId`. `GROUPINGS` gains the entry;
`DIMENSION_ORDER` does NOT.

This is the existing status of `none`: something the list can be arranged by that is not something
the list can be filtered on. It matters that it stays out of `DIMENSION_ORDER` — every id in there
is required by `session-dimensions.ts` to have a `keyOf` that grouping and filtering BOTH read, and
`session-dimensions.test.ts` cross-checks that filtering to one bucket returns exactly the rows
that bucket's band contains. A tree node is not a bucket on a dimension: a session belongs to every
node on its path, so "filter to `packages`" and "the band `packages`" could never be made to agree.
Declaring `tree` a dimension would either break that test or force a false answer into it.

Because `GROUPINGS` is the one list, everything that enumerates arrangements picks it up with no
second edit:

- the cockpit's AGRUPAR menu (`tabs/Sessions.tsx`, which maps over `GROUPINGS`),
- `agentop session ls --group tree` (`cli-parse.ts` validates against `GROUPINGS` and prints it in
  its own error message),
- the persisted `SessionViewPrefs.grouping`.

`'none'` is special-cased in exactly one place today (`sessions.ts`, first line of
`groupSessions`). `'tree'` joins it there, delegating to the new module.

### 2. The path from root to session must be a FACT

The cascade needs the project's root DIRECTORY. Today nothing carries it:
`ControlSession.projectGroup` is a NAME, and `repo-facts.ts` computes the root path only to throw
it away —

```ts
const root = basename(dirname(o.commonDir.replace(/[/\\]+$/, '')))
```

Deriving the relative path by string-matching that name against `cwd` would be a guess, and a wrong
one wherever a directory name repeats along a path.

So:

- `decideRepoFacts` also returns `rootPath` — the `dirname(commonDir)` it already computes. It is
  the COMMON git dir's parent, which is what makes a linked worktree resolve to the MAIN
  checkout rather than to itself, exactly as `root` already does.
- `RepoFacts.rootPath` is recorded at spawn alongside `repo`/`root`, so a session whose directory
  later disappears keeps it.
- `ControlSession.projectRoot?: string` carries it to the control center, stamped by
  `control-session.ts` from the resolved facts.

Two honesty rules, both of which produce a REAL row rather than an invented path:

- **No `projectRoot`** — the directory is not in a repository, or is gone — the session hangs
  directly off the root with no branch. A gone directory keeps its `GONE_PROJECT_KEY` bucket
  unchanged; nothing about the cascade may resurrect a name for a path that resolves to nothing.
- **`cwd` is not a descendant of `projectRoot`** — a linked worktree created outside the main
  checkout — the session gets ONE branch named after its own folder. A relative path that does not
  exist is never synthesised.

The root KEY is `bucketKey(s, 'project')`, the same call the project dimension makes. The cascade
and "group by project" therefore cannot disagree about which project a worktree belongs to.

### 3. New pure module: `packages/tui/src/control/session-tree.ts`

```ts
buildSessionTree(
  list: readonly ControlSession[],
  words: DimensionWordBook,
  doneTasks?: readonly string[],
  order?: SessionOrder,
  ctx?: DimensionContext,
): SessionGroup[]
```

It returns the SAME `SessionGroup[]` the flat arrangements return, already in reading order
(depth-first, roots ordered by their most urgent member exactly as `groupSessions` orders bands),
with two added fields on the group:

- `depth: number` — how far to indent the heading,
- `path: readonly string[]` — the segments from the root down to this node, which is what the card
  band's breadcrumb is built from.

Returning the existing shape is the whole point of the design. `sessionRows`, `cardPages`,
`selectableIndexes`, the cursor, the row budget, the marked band, the live/fell/closed split and
the search all keep working without knowing a tree exists. The only consumer that learns anything
new is the heading renderer, which indents by `depth`.

Node rules:

- A node with sessions of its own contributes a group holding them.
- A node with no sessions of its own but with descendants contributes a HEADING-ONLY group whose
  count is the subtree total. (`sessionRows` skips a group with no sessions today; it gains an
  explicit branch for this case rather than having empty groups quietly disappear.)
- Single-child chains are compressed into one node whose label is the joined segments.

### 4. Cards

`cardPages` walks `SessionRow[]`, so it inherits the arrangement for free. The one change is the
band title: the breadcrumb `path.join(' › ')`, truncated from the LEFT when it does not fit —
the last segment is the one that identifies the node, so it is the last thing given up.

### 5. Targeted cleanup, inside the scope

`session-view.ts` holds a SECOND `groupSessions` with its own narrower union
(`'harness' | 'model' | 'project' | 'task' | 'none'`) and its own English labels. It is exported
from `sessions/index.ts` and called by nothing but its own test. It is the two-lists-of-one-fact
defect `session-dimensions.ts` exists to remove, and the cascade makes it concretely wrong: it
would be an arrangement list silently missing the new arrangement. It is deleted along with its
type, its `SessionGroup`, its `projectName` helper and the tests that only cover it.

## Testing

`session-tree.test.ts`, pure, no filesystem:

- **Root resolution** — a plain repo; a worktree INSIDE the main checkout; a worktree OUTSIDE it;
  a directory in no repository; a directory that is gone (`GONE_PROJECT_KEY` preserved).
- **Compression** — one worktree yields a single joined node; adding a second splits the shared
  prefix into a node with two children.
- **Reading order** — depth-first, and roots ordered by most urgent member.
- **Heading-only nodes** — counts are subtree totals.
- **Cross-check with the flat arrangement** — the multiset of sessions in the tree is identical to
  the multiset in `groupSessions(list, 'project', …)`. An arrangement that loses or duplicates a
  session is the one failure mode that must be impossible.

`session-dimensions.test.ts` gains an assertion that `tree` is in `GROUPINGS` and NOT in
`DIMENSION_ORDER`, so nobody later promotes it to a dimension without meeting the cross-check it
cannot satisfy.

## Out of scope

Two defects were diagnosed while reading this code. Both are real, both are separate work, and
neither is fixed here:

1. **A live session is listed as `desligada`.** `session-view.ts`'s `covered` predicate matches a
   running process to a managed row on harness + directory ALONE, so one managed session running in
   `/home/mithrandir/agentistics` swallows every other live claude in that same directory. With no
   external row, the conversation is never added to `shown` and falls through to the closed block —
   measured on this machine with three live claude processes in that directory, two of them
   reported as closed conversations. The fix is exact and the data already exists: the harness's own
   record gives the process's conversation id and the managed row carries `conversationId`; when
   both are known and DIFFER, `covered` must be false, with the directory guess kept only for the
   case where one side does not know.

2. **The cockpit never offers a takeover.** `planTakeover` is called from exactly one place,
   `agentop session attach` in the CLI. The cockpit's `resumeSession` consults `conversationHeldBy`
   and refuses outright, naming a holder that for a background agent is not a place anyone can go.

A third, cosmetic: the state filter menu renders three separate rows all reading "desligada"
because `sessionsStates` deliberately collapses `exited`/`lost`/`closed` into one word. That
reading is right on a table row and unusable as three distinct filter entries.
