# Session manager

`agentop session` starts, lists, attaches to, names and stops assistant sessions. Background
sessions are hosted by tmux on its own socket (`-L agentop`), so they survive `agentop` exiting and
never mix with your own tmux sessions.

## Requirements

tmux (Linux, macOS). Windows support arrives with the PTY backend; until then `agentop session`
reports that tmux is required rather than failing at spawn time.

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

## Harness support

| Harness | Prompt | `--model` | `--effort` |
|---|---|---|---|
| claude | positional argument | yes | `low, medium, high, xhigh, max` |
| codex | positional argument | yes | not supported |
| kimi | typed into the session | yes | not supported |
| gemini, copilot, antigravity | not startable yet | — | — |

`kimi` has no flag for an initial prompt in an interactive session — its `-p` runs one prompt
non-interactively and exits — so agentop types the prompt in for you once the session is up.

Codex's reasoning effort is a `-c key=value` configuration override rather than a flag; it is not
wired up because the key could not be verified from the CLI itself, and agentop does not guess flags.

## Where state lives

`~/.agentistics/managed-sessions.json` — the sessions agentop started, with their labels and notes.
tmux is authoritative about what is running; this file is authoritative about what it means.
