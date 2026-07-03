# agentistics CLI — `agentop`

`agentop` is the single binary for everything agentistics does: run the dashboard,
the terminal TUI, the OpenTelemetry daemon, host or join a **Team Mode** central,
and manage autostart + updates.

Get the binary from the [install instructions](../README.md#install) (`install.sh`,
the Windows installer, or `bun run build:binary` from source). From a checkout you
can also run it directly with `bun run packages/server/bin/cli.ts <command>`.

```bash
agentop --help       # full usage
agentop --version    # print version (and a notice if an update exists)
```

> **Ports:** a solo/member instance serves the **web dashboard on 47292** (the URL you open) and
> the **api + mcp on 47291** (in dev, Vite serves the web on 47292 and the api runs on 47291 — same split).
> A Team Mode **central** runs in Docker on **48080**
> by default. These are intentionally distinct so a member and a central can
> coexist on the same host.

---

## Command overview

| Command | Purpose |
|---------|---------|
| [`start`](#start) | Interactive launcher — pick mode + how to run (foreground / bg / Docker / boot) |
| [`setup`](#setup) | Interactive first-run wizard (solo / central / member) |
| [`server`](#server) | Start the web dashboard + api + Nay + background daemon (non-interactive) |
| [`restart`](#restart) | Restart a running mode so it picks up new code / config |
| [`tui`](#tui) | Live terminal dashboard (no browser) |
| [`watch`](#watch) | OpenTelemetry metrics daemon only (headless) |
| [`central`](#central) | Manage the Team Mode central (wraps `central.sh`) |
| [`member`](#member) | Join / leave / inspect a Team Mode central from this machine |
| [`autostart`](#autostart) | Start a mode with the system (systemd user service) |
| [`upgrade`](#upgrade) | Upgrade `agentop` to the latest release |
| [`check-update`](#check-update) | Print an "update available" banner, else stay silent |

Running **bare `agentop`** on an interactive terminal, on a machine that isn't
configured yet, launches the [`setup`](#setup) wizard. Otherwise it prints help.

---

## `start`

The interactive launcher — a **re-runnable control panel**. It prints a banner + live status
(current mode, and whether a server is already running), then lists what you can do. Run it as
often as you like; it always reflects the current state.

```bash
agentop start
```

```
  ▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀ █ █▀ ▀█▀ █ █▀▀ █▀
  █▀█ █▄█ ██▄ █░▀█ ░█░ █ ▄█ ░█░ █ █▄▄ ▄█
  AI coding-assistant analytics · agentop
  ────────────────────────────────────
  mode    member → http://host:48080
  server  ● running  web http://localhost:47292
  ────────────────────────────────────

  What would you like to do?
    1) Start — foreground (this terminal)
    2) Start — background (detached)
    3) Start — Docker (container)
    4) Autostart — install a boot service
    5) Reconfigure mode (solo / central / member)
    6) Stop the running server
    0) Quit
```

- **Already running?** Picking a Start action when a server is already up warns you and offers to
  **kill it and start fresh** — on yes, it stops the old one and starts the new one automatically.
- A **central** gets its own menu (Start / rebuild via Docker, autostart, reconfigure, stop).
- The **Docker** option runs this machine (solo/member) in a container that mounts the host's
  harness dirs read-only — run the machine in Docker **or** natively, not both.
  See [Machine in Docker](DEPLOY.md#machine-in-docker).
- **Reconfigure mode** reuses the [setup](#setup) wizard; the mode is just a preference you can
  also change from the web UI (**Settings → Team**) at any time.
- **Non-interactive stdin** (a pipe or a systemd unit) skips the panel and behaves exactly like
  [`server`](#server), so the same command works in scripts and services.

Ctrl-C is non-destructive — it aborts without starting anything.

---

## `restart`

Restart a running mode so it picks up new code (after an `upgrade` / `git pull`) or a changed
config. Defaults to `server`.

```bash
agentop restart            # = restart server
agentop restart server     # bounce the systemd user service (agentop-server)
agentop restart watch      # bounce the watch service
agentop restart central    # rebuild + restart the central's Docker container
```

`server`/`watch` bounce the installed [systemd user service](#autostart) — if none is installed it
tells you to run it in the foreground or enable autostart first. `central` delegates to
`central.sh restart`; to also pick up **code** changes on a central, use `agentop central up`
(rebuilds the image) instead.

---

## `setup`

Interactive first-run wizard. Walks you through picking a mode and wires up the
rest for you: **solo** (local only, nothing leaves the machine), **central** (host
the aggregator on this machine via `central.sh init`), or **member** (push this
machine's computed metrics to a central via `member connect`). It then offers to
enable [autostart](#autostart).

```bash
agentop setup
```

Needs a TTY. Ctrl-C is non-destructive — it aborts without touching your
preferences. For non-interactive/scripted member onboarding, use
[`agentop member connect`](#member) directly.

---

## `server`

Starts the web dashboard, api, Nay chat, MCP registration, and the OTel daemon —
everything in one process. Binds two ports: the **web dashboard on 47292** (open this) and the
**api + mcp on 47291**. They share one request handler, so the dashboard's `/api/*` calls just work.

```bash
agentop server              # web: http://localhost:47292 · api/mcp: http://localhost:47291
agentop server --port 4000  # api on 4000, web on 4001
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port <n>` | `47291` | The **api + mcp** port; the web dashboard is served on this + 1 (default 47292) |

---

## `tui`

Live stats right in the terminal — tokens, cost, sessions, streak — no browser
needed.

```bash
agentop tui
```

---

## `watch`

Runs only the OpenTelemetry file watcher + OTLP metrics exporter (the same daemon
`server` runs in the background). Use this on a headless box that only needs to
feed Grafana/Datadog. See [docs/opentelemetry.md](opentelemetry.md).

```bash
agentop watch
```

---

## `central`

Manage the **Team Mode central** — the Docker service that aggregates metrics from
many members. This is a thin wrapper over the repo's `central.sh`, so it needs to
run from an agentistics checkout (the compiled binary alone doesn't ship the
Compose stack). Full deployment details live in [docs/DEPLOY.md](DEPLOY.md).

```bash
agentop central <up|init|down|logs|status|restart|pull>
```

| Action | What it does |
|--------|--------------|
| `init` | (Re)generate `central.env` interactively — auto-generates the secrets with `openssl`, detects your Tailscale IP for the bind, writes the file `chmod 600` |
| `up` | Build the image and (re)create the containers (`--build --force-recreate`); offers `init` first if `central.env` is missing |
| `restart` | Restart the `app` container without rebuilding |
| `logs` | Follow the `app` container logs |
| `status` | Show container + health status |
| `down` | Stop and remove the containers — **keeps** the Mongo data volume |
| `pull` | Rebuild from a fresh base image (run `git pull` first) |

```bash
agentop central init        # generate central.env (interactive)
agentop central up          # build + (re)create — most common
agentop central logs        # tail the app logs
agentop central down        # stop, keep the data volume
```

From a checkout you can equivalently use the package scripts
`bun run init:central` and `bun run up:central`, or call `./central.sh` directly.

---

## `member`

Configure this machine as a **member** that pushes computed metrics to a central.
Only aggregated metrics are sent — **never** chat content or raw transcripts. The
machine's display name is assigned by the central (baked into the minted token)
and resolved via `/api/team/whoami`; there is no name field on the machine.

```bash
agentop member connect --endpoint <url> --token <token> [--org <org>]
agentop member leave
agentop member status
```

### `member connect`

Verifies the token against the central's `whoami` endpoint, then saves the member
config. On a bad token it prints an actionable error and writes **nothing** (no
half-configured state).

| Flag | Required | Description |
|------|----------|-------------|
| `--endpoint <url>` | yes | Central base url, e.g. `http://host:48080` |
| `--token <token>` | yes | Token minted for this machine in the central's Team Manager |
| `--org <org>` | no | Org override; defaults to the org on the token |

```bash
agentop member connect --endpoint http://100.64.0.2:48080 --token abc123
```

### `member leave`

Best-effort notifies the central (so it drops this member's data) and resets this
machine back to solo. Succeeds locally even if the central is unreachable.

### `member status`

Prints the current mode / endpoint / org / user plus the live uploader state
(`last sync` timestamp and whether the token/endpoint are healthy).

```
mode:      member
endpoint:  http://100.64.0.2:48080
org:       default
user:      alice-laptop
last sync: 2026-07-01T12:34:56.000Z
state:     ok
```

---

## `autostart`

Register a mode to start with the system. On **Linux/WSL** this installs a systemd
**user** service at `~/.config/systemd/user/agentop-<mode>.service`, enables it
with `systemctl --user enable --now`, and runs `loginctl enable-linger` so it also
starts at boot without an active login. `enable` additionally installs a
`~/.bashrc` hook that runs [`agentop check-update`](#check-update) on every
terminal open. macOS and Windows print the manual step instead.

```bash
agentop autostart <mode> <enable|disable|status>
```

- `mode` ∈ `server` · `central` · `watch`
- `enable` — register + start the service (and add the terminal update hook)
- `disable` — stop and remove the service
- `status` — show enabled/active state; **omit the mode** to list all services

```bash
agentop autostart server enable    # start the dashboard at boot
agentop autostart status           # list every autostart service
agentop autostart watch disable    # stop the otel daemon service
```

---

## `upgrade`

Download and install the latest `agentop` release in place. (`update` is an alias.)

```bash
agentop upgrade
```

On a **central** you upgrade the Docker stack instead — pull the repo and rebuild:

```bash
git pull && bun run up:central    # or: agentop central pull
```

On a **member** running as a systemd service, restart it after upgrading:

```bash
agentop upgrade && systemctl --user restart agentop-server
```

---

## `check-update`

Prints the "new version available" banner **only** when a newer release exists,
and stays completely silent otherwise — so it's safe to run on every shell start.
This is exactly what the `~/.bashrc` hook installed by `agentop autostart …
enable` runs.

```bash
agentop check-update
```

---

## Update detection

agentistics surfaces available updates in three places, all sourced from the same
version check:

- **On command run** — most `agentop` commands print the update banner in parallel
  with startup (non-blocking); `--version` appends the notice too.
- **On terminal / boot** — the `~/.bashrc` hook added by `autostart … enable` runs
  `agentop check-update` when you open a shell (silent when you're current).
- **On the dashboard** — a bell notification plus a **mode-aware** upgrade modal
  showing the exact command for your role (a central shows `bun run up:central`; a
  member shows `agentop upgrade` then `systemctl --user restart agentop-server`). A
  periodic (~6h) server re-check pushes the notification live over SSE.
