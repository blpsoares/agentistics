# Agentistics for VS Code

Your coding-assistant fleet and your usage metrics, inside the editor.

- **Sessions** — every session this machine hosts, grouped by project, with what each one is doing
  and which of them is blocked on you. Approve the dialog it is showing (by picking the option, not
  by pressing a key that takes whichever row is highlighted), send it a line, rename it, file it
  under a task, stop it, reopen it.
- **Attach** — a real integrated terminal running the very `tmux` command the terminal cockpit
  runs, with the real detach key printed beside it.
- **New session** — pick an assistant, a directory, a task and a first message.
- **Dashboard** — the full web dashboard in an editor tab.
- **Status bar** — today's cost and tokens, and how many sessions are waiting on you.

It is a client of the local `agentop server` (port 47291) — the same server the web dashboard and
the terminal cockpit read. Start it with `agentop server`; the panel offers to do that for you when
nothing is answering.

Full documentation: [`docs/vscode-extension.md`](../../docs/vscode-extension.md).

## Build

```bash
bun run build:vscode     # from the repo root
bun run package:vscode   # a .vsix
```
