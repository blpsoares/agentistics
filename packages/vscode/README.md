# Agentistics for VS Code

Your coding-assistant fleet and your usage metrics, inside the editor.

- **Sessions** — every session this machine hosts, grouped by project, with what each one is doing
  and which of them is blocked on you. Approve the dialog it is showing (by picking the option, not
  by pressing a key that takes whichever row is highlighted), send it a line, rename it, file it
  under a task, stop it, reopen it.
- **Attach** — a real integrated terminal running the very `tmux` command the terminal cockpit
  runs, with the real detach key printed beside it.
- **New session** — pick an assistant, a directory, a task and a first message.
- **Status bar** — today's cost and tokens (in USD or BRL), and how many sessions are waiting on you.

It is a client of the local `agentop server` (port 47291) — the same server the web dashboard and
the terminal cockpit read. Start it with `agentop server`; the panel offers to do that for you when
nothing is answering.

Full documentation: [`docs/vscode-extension.md`](../../docs/vscode-extension.md).

## Versioning

The extension is versioned on **its own line**, not the product's. It ships to a marketplace on its
own cadence and its users upgrade it independently of the `agentop` binary, so a version that jumped
every time the server released would say nothing about what changed in the editor. Bump it by hand
here; `release.yml` deliberately leaves `packages/vscode/package.json` out of the files a product
release stamps.

## Build

```bash
bun run build:vscode     # from the repo root
bun run package:vscode   # a .vsix
```

## The two icons, and why they are different files

- **`media/icon.png`** is the gallery image — the one on the extension's page. It is the full
  colour agentistics mark, square, so the marketplace card does not letterbox it. Regenerate it
  from the vector source with:

  ```bash
  convert media/logo.svg -background none -gravity center -extent 441x441 -resize 256x256 media/icon.png
  ```

- **`media/icon.svg`** is the activity-bar icon and is deliberately MONOCHROME (`currentColor`).
  VS Code tints that one itself — dim when the view is inactive, the theme's foreground when it is
  — so the coloured mark would sit at one shade while every neighbour responds, which reads as a
  broken icon rather than a branded one.
