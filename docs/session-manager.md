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

    agentop session <harness> [-p "prompt"] [--bg] [--model <id>] [--effort <level>] [--cwd <path>] [--name "label"]
    agentop session list
    agentop session attach <id|name>
    agentop session kill   <id|name>
    agentop session rename <id|name> "label"
    agentop session note   <id|name> "text"

`--bg` detaches and returns immediately. Without it the session takes over your terminal; the
detach keystroke is printed before it does, read from your own tmux prefix rather than assumed.

`--cwd` defaults to the directory you are in.

## What a session is doing

`agentop session list` reports a state per session:

| State | Meaning |
|---|---|
| `working` | its screen moved since the last look, or a harness-specific "running" marker is on it |
| `waiting` | alive and still — it is waiting for you |
| `NEEDS APPROVAL` | a blocking question is on screen |
| `exited` | the command finished; the session is still listable and its last frame readable |
| `lost` | the registry knows it, the backend does not |
| `external` | an assistant running on this machine that agentop did not start — listed, but not attachable |

There is deliberately no `idle`. An interactive assistant that is alive and whose screen has stopped
moving is waiting for you; there is no third thing it could be doing. What cannot always be known is
*why* it is waiting.

Telling a blocking question apart from an ordinary pause needs screen markers captured from the real
CLI, so it exists only for the harnesses that were probed (claude, codex, kimi). For any other
harness a blocking question shows as `waiting` — still counted, still surfaced, but the reason
cannot be named. `list` says so rather than leaving you to assume otherwise.

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

`~/.agentistics/managed-sessions.json` — the sessions agentop started, with their labels and notes.
tmux is authoritative about what is running; this file is authoritative about what it means.
