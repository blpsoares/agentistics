# Session manager

`agentop session` starts, lists, attaches to, names and stops assistant sessions. Background
sessions are hosted by tmux on its own socket (`-L agentop`), so they survive `agentop` exiting and
never mix with your own tmux sessions.

## Requirements

tmux (Linux, macOS). **On Windows, run agentop inside WSL** — the CLI says so in those words rather
than reporting a generic missing dependency.

There is no native Windows backend, and the reason is recorded in `sessions/index.ts`: Bun exposes
no PTY primitive (checked against 1.3.14), and the only alternative is a native module, which cannot
be embedded in the single portable binary this project compiles to. Hosting a full-screen assistant
TUI on plain pipes renders garbage, which is a worse failure than not starting — it looks like it
worked. When a PTY primitive lands in Bun, `backend-pty.ts` slots in behind `SessionBackend` and
nothing else changes.

## Commands

    agentop session <harness> [-p "prompt"] [--bg] [--model <id>] [--effort <level>]
                              [--cwd <path>] [--name "label"] [--task "<name>"]
    agentop session ls     [--all] [--group repo|project|task|harness|model|none]
                           [--json] [--width <n>] [--no-color]
    agentop session list   [--json]
    agentop session attach <id|name>
    agentop session kill   <id|name>
    agentop session rename <id|name> "label"
    agentop session note   <id|name> "text"

### `ls` — the cockpit's table, printed once

`ls` is the fleet for a PERSON to read: the same table the cockpit's fleet pane draws, printed to
stdout and gone. Only what is running, grouped by project — `--all` adds the finished, lost and
closed conversations, `--group` changes the sections.

    agentop session ls                    # what is running, by project
    agentop session ls --all --group repo # everything, by repository
    agentop session ls --json             # exactly what `list --json` prints

It draws by CONSUMING the cockpit's own arithmetic (`packages/tui/src/control/sessions.ts`) rather
than by re-implementing it: `sessionColumns` measures the page so the columns line up, `groupSessions`
and `sessionRows` decide the sections and the air between them, `sessionRunning` decides what
"running" means — an `external` row included, since it exists because a live assistant process was
found. A second copy of any of those would be a second set of rules that agree until the day they do
not, which this repository has already paid for once. What `agentop session ls` owns is the
DRAWING: ANSI written to a terminal instead of Ink components, the width taken from
`process.stdout.columns`, and a final clip so no row can wrap.

`ls` is a new command rather than a flag on `list`, because `list` is the tab-separated dump scripts
already read line by line. Its output does not change.

Piped output is plain: `process.stdout.isTTY` decides colour (`NO_COLOR` and `--no-color` override
it), and a pipe gets no invented terminal width — the table comes out as wide as its content, so
nothing is truncated to fit a terminal nobody is looking at.

## Orchestrating several at once

The form an ASSISTANT should drive. It exists because doing this through the single-session command
means N invocations, N ids to scrape out of N lines of prose, and no way to say the sessions belong
together — so the caller ends up holding state the tool could have held.

    agentop session batch --task "<name>" [--cwd <path>] [--model <id>] [--effort <level>] \
                          --session "<harness>[@<cwd>]: <prompt>" [--session "..."] [--json]
    agentop session open  "<task>" [--json]

Three assistants on one repository, in parallel:

    agentop session batch --task "auth-refactor" --cwd ~/app --json \
      --session "claude: refactor the token store" \
      --session "codex: port the tests" \
      --session "gemini: review the migration"

Every session starts detached — a batch has no single terminal to hand over — and all of them are
filed under the task, so `open` brings the whole task back later and the cockpit groups them
together. `--cwd`/`--model`/`--effort` given before the sessions are defaults for all of them; an
`@<cwd>` on a session overrides it.

`--json` prints the started ids as data, and `agentop session list --json` reads the fleet back the
same way — id, status, activity, task and the conversation id each row could reopen. A session that
fails to start does NOT abort the rest: four that started are four that are running, and every
outcome is reported.

## The cockpit

`agentop` → the **sessions** tab. It is three framed panes — a menu, the fleet, and a detail pane
under both — and the one holding the keyboard wears an accent border, so "where am I" is answered by
the screen rather than remembered.

### The menu

Everything the screen can do is on the left, visible and clickable: **actions**, **view**, **show**,
**tasks**, **projects**. Each block is its own box; the one you are in is open and the rest keep
their NAME on a single row, so nothing is ever hidden behind a fold that does not announce itself. A
terminal tall enough opens every block at once.

Sections are numbered. `1`–`9` jump straight to one, from the fleet list as well as from the menu,
and `←`/`→` step between them — a soft keyboard has no arrow keys, so the digits are the way in that
always exists. Clicking a collapsed name opens it.

### The fleet

The list holds everything — sessions agentop runs, assistants running beside it, and conversations
that are closed — in sections, with history always separated from what is live. Columns are measured
across the visible rows and carry a header, so the handle, state, name, worktree, task, usage,
harness and project line up and say what they are. The handle is the first characters of the session
id — `agentop session attach 3f5f` resolves a prefix, so it is the one thing on the row that names
the session to something other than this screen.

**What you named, you keep seeing.** A row you gave a name, a note or a task is never withheld by the
history switches. A machine restart makes every managed session `lost`, and without that rule the
list came back empty after a reboot — with the session you had renamed and filed under a task gone,
and the name with it.

The **state** block is the finer answer: one row per state — needs approval, waiting, working,
exited, lost, closed, external — each with how many sessions wear it, ticked or not. Ticking any of
them replaces the two switches entirely; unticking the last one falls back to them rather than
showing nothing, which is never what unticking a box means.

The **order** block sorts by urgency (the default — what is blocked on you, first), name, start
time, usage or project. Picking the order already in force flips its direction, which is the gesture
every table has and the only one that does not need a second control. Every key keeps state as its
tiebreak: a screen sorted by name that buries a session waiting on approval among nine idle ones has
lost the thing it is for.

`space` **marks a row** — a highlighter, not a selection. The mark is a bar in the gutter beside the
cursor caret, in a different colour from the accent (which means *focus* everywhere else in this
app, so a highlight wearing it would read as "this is selected" on four rows at once), plus the name
in that colour. It is kept by session id, because the list re-sorts under it every five seconds and
a mark meaning "the third row" would be on someone else's session by the next poll — and it survives
detaching, which is exactly when you needed it.

The detail pane has its own switch (`d`), written on the pane itself as well as offered in the
*show* block — a control for a thing you are looking straight at belongs on the thing. It is a pane, not a fact, and a screen is allowed to be a
list — but a QUESTION still takes the region whatever the switch says, because a prompt with nowhere
to draw cannot be answered.

**`only active` (`l`) counts EXTERNAL sessions as active**, because an external row exists precisely
because a live assistant process was found: what cannot be read there is its activity, never whether
it is running. It is the one switch that overrides the rule above, and it is why it leads the *show*
block. The rule above is right by default, but on a machine with months of named work it shows all
of it; this is how you ask for the four things you are actually doing and nothing else. Everything
else in that block can only ever widen.

`/` searches all of it, including a closed conversation's opening prompt, which is what a person
actually remembers about work they put down. `esc` drops the search, then the project scope, then the
task scope — the summary row states what is narrowing the list and which key clears it.

### The view, and the default

The list opens as **only active conversations, grouped by project**, and every change you make is
remembered across runs.

That default is strict on purpose, and has one consequence worth knowing: when nothing is running,
it shows an empty list. The screen says *why* and names the key that lifts it — the sessions a
reboot turned into `lost` rows are still there, still named and still reopenable, so "no sessions"
would be false, and a blank pane under a strict filter is indistinguishable from a broken one. `ctrl+r` puts it back to that default — every switch here is sticky, which
is also how an arrangement you fiddled with weeks ago follows you around.

Grouping by **repository** is the other useful one: a session is opened in a directory, but the thing
a person thinks in is the repository, and three worktrees of `agentistics` are three places to work
on ONE project. The repository is keyed by the git REMOTE wherever there is one — the only key a
worktree provably shares with its main checkout, since their directory names deliberately differ —
and falls back to the main checkout's folder name.

**By project** keys on the main checkout too, not on the directory: a session opened in
`agentistics/.claude/worktrees/session-monitor` files under `agentistics`, and the worktree column
says which checkout it is. Keying on the directory name filed three checkouts of one project as
three projects, which is the split the repository dimension exists to avoid — and since this is the
default grouping, it was the first thing anyone saw.

### Tasks

A task is whatever you say it is: a free string, chosen while starting a session or added later, and
several sessions carrying the same one are that task's sessions. The menu lists them with counts, a
task scopes the list, and **Open whole task** brings all of its sessions back at once.

Reopening a task is safe to press twice. A session still running is left alone rather than duplicated,
one you finished is not resurrected, one whose conversation cannot be resolved is skipped *and
counted*, and everything reopened retires the row it replaced — so a laptop closed and opened twice
does not leave a task holding dead twins under one name. Names, notes and task stay with the session
through a reopen.

A task can be marked **finished**, which puts its sessions away behind a switch beside "closed" and
"exited". It stops nothing and deletes nothing.

### Attaching

`enter` opens the menu for the selected row; `o` attaches. Attaching unmounts the app, hands the
terminal over, and comes back to this tab when you detach — the detach keystroke is read from your
own tmux prefix and stated on the row before you press anything, never assumed.

Pressing `o` on a row with nothing running asks whether to pick that conversation back up instead of
refusing — external sessions included, since agentop did not start those but the conversation is on
this disk either way. `x` stops a session; it is deliberately not `k`, which moves the cursor.

### Starting one

`a` opens the wizard: harness → folder → task → model → effort → prompt → background or attached.
The folder step is a searchable table of every directory under your home — folder, repository, path
and why it is being offered — grouped by repository, with the directory you are standing in first.
It reads the local store, so it works with the server stopped.

`--bg` detaches and returns immediately. Without it the session takes over your terminal; the detach
keystroke is printed before it does. `--cwd` defaults to the directory you are in.

## What a session is doing

`agentop session ls` / `list` report a state per session:

| State | Meaning |
|---|---|
| `working` | its screen moved since the last look, or a harness-specific "running" marker is on it |
| `waiting` | alive and still — it is waiting for you |
| `NEEDS APPROVAL` | a blocking question is on screen |
| `exited` | the command finished; the session is still listable and its last frame readable |
| `lost` | the registry knows it, the backend does not — a reboot puts every session here, and each one keeps its name and offers Reopen |
| `external` | an assistant running on this machine that agentop did not start — listed, but not attachable |

There is deliberately no `idle`. An interactive assistant that is alive and whose screen has stopped
moving is waiting for you; there is no third thing it could be doing. What cannot always be known is
*why* it is waiting.

Telling a blocking question apart from an ordinary pause needs screen markers captured from the real
CLI, so it exists only for the harnesses that were probed (claude, codex, kimi). For any other
harness a blocking question shows as `waiting` — still counted, still surfaced, but the reason
cannot be named. `ls` and `list` both say so rather than leaving you to assume otherwise.

The states are also honest about their own timing. When a turn ends, the poll that *observes* it
ending sees a frame that changed since the last one, which is movement — so the session reads
`working` for that one interval before settling on `waiting`. The signal is therefore at most one
interval late and never early, which is the right way round for something a person acts on.

## Harness support

| Harness | Prompt | `--model` | `--effort` |
|---|---|---|---|
| claude | positional argument | yes | `low, medium, high, xhigh, max` |
| codex | positional argument | yes | not supported |
| gemini | `--prompt-interactive` | yes | not supported |
| antigravity (`agy`) | `--prompt-interactive` | yes | `low, medium, high` |
| kimi | typed into the session | yes | not supported |
| copilot | typed into the session | yes | not supported |

`kimi` and `copilot` have no flag for an initial prompt in an interactive session — their `-p` runs
one prompt non-interactively and exits — so agentop types the prompt in once the session is up.

Codex's reasoning effort is a `-c key=value` configuration override rather than a flag; it is not
wired up because the key could not be verified from the CLI itself, and agentop does not guess flags.

## Where state lives

`~/.agentistics/managed-sessions.json` — the sessions agentop started, with their labels, notes and
tasks, and an `endedAt` on the ones that are over. tmux is authoritative about what is RUNNING; this
file is authoritative about what it MEANS, which is why a reboot takes the first and leaves the
second. A session is marked finished rather than deleted: it is still a thing that happened, and
reopening it is the ordinary next thing to want.

`~/.agentistics/preferences.json` — `sessionView` (how the list is arranged) and `finishedTasks`
(the tasks you marked done). Both are properties of this machine rather than of any session, which
is why they do not live in the registry.
