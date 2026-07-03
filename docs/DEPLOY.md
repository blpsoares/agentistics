# agentistics — Docker Deployment Guide

This guide covers running **agentistics Team Mode** as a central aggregator using Docker Compose.

---

## Prerequisites

- Docker Engine ≥ 24 and Docker Compose ≥ 2.20
- A Linux/macOS host with at least 512 MB of free RAM
- Outbound internet access for the initial image pull

---

## Quick Start

### 1. Clone the repository and enter the project root

```bash
git clone https://github.com/blpsoares/agentistics.git
cd agentistics
```

### 2. Create your `central.env`

**Easiest — interactive setup** (recommended). `central.sh` asks for each value and
auto-generates the secrets with `openssl` (press Enter on a secret field to generate it),
detects your Tailscale IP for the bind, and writes `central.env` with `chmod 600`:

```bash
bun run init:central     # or: ./central.sh init
```

You'll be prompted for the port, org name, admin password, session secret, an optional
ingest token, and the bind interface. `bun run up:central` runs this automatically the
first time (when `central.env` is missing).

> Name it `central.env`, **not** `.env`. A plain `.env` is auto-loaded by `bun run dev`
> (a developer's local/member instance) and would make that instance wrongly think it is
> the central. Using `central.env` keeps the two roles cleanly separated.

> **Security note**: the setup keeps `AGENTISTICS_TEAM_SESSION_SECRET` separate from the
> password. If the password is ever leaked, an attacker still cannot forge session cookies
> as long as the session secret is unknown.

**Manual alternative** — copy the example and edit it yourself:

```bash
cp .env.example central.env
openssl rand -hex 24   # → AGENTISTICS_TEAM_PASSWORD
openssl rand -hex 32   # → AGENTISTICS_TEAM_SESSION_SECRET
```

### 3. Start the stack

The repo ships a helper script, **`central.sh`**, that wraps `docker compose` with
the project name (`-p team-mode`) and `--env-file central.env` pre-set so you don't
have to remember the flags:

```bash
bun run up:central     # = ./central.sh up — build + (re)create the containers  [most common]
```

The first time (no `central.env` yet) this runs the interactive setup from step 2
automatically before deploying.

The first run builds the image and initialises the MongoDB replica set. This takes about 30–60 seconds.

> **Why the script?** Two easy-to-forget details are baked in:
> - `up` uses `--build --force-recreate`. A plain `docker compose up -d` does **not**
>   recreate the container after a rebuild, so your new code silently would not run.
> - `-p team-mode` names the stack, keeping it isolated from any other compose project
>   on the same host.

Prefer raw compose? The equivalent is:

```bash
docker compose -p team-mode --env-file central.env up -d --build --force-recreate
```

### 4. Open the dashboard

Navigate to `http://<your-host>:<APP_PORT>` (default: `http://localhost:48080`).

---

## Managing the central — `central.sh`

| Command | What it does |
|---|---|
| `./central.sh init` | (Re)generate `central.env` interactively (auto-generates secrets with openssl) |
| `./central.sh up` | Build the image and (re)create the containers (`--build --force-recreate`); offers `init` if `central.env` is missing |
| `./central.sh restart` | Restart the `app` container **without** rebuilding |
| `./central.sh logs` | Follow the `app` container logs (Ctrl-C to stop) |
| `./central.sh status` | Show container + health status |
| `./central.sh down` | Stop and remove the containers — **keeps** the Mongo data volume |
| `./central.sh pull` | Rebuild from a fresh base image (run `git pull` first) |
| `./central.sh help` | Print the usage summary |

Override the defaults with env vars: `PROJECT=... ENV_FILE=... ./central.sh up`.

> `down` never passes `-v`, so your stored team data survives. Only add `-v` manually
> when you deliberately want to wipe everything.

### The same thing from the cli — `agentop central`

If you have the `agentop` binary installed, `agentop central <action>` is a thin wrapper
that shells out to the repo's `central.sh` (it locates the script in the checkout it was
run from, inheriting stdio so `init`'s prompts and `logs` streaming work). The actions map
one-to-one:

| central.sh | agentop equivalent | What it does |
|---|---|---|
| `./central.sh init` | `agentop central init` | (Re)generate `central.env` interactively |
| `./central.sh up` | `agentop central up` | Build + `--force-recreate` the containers |
| `./central.sh restart` | `agentop central restart` | Restart the `app` container without rebuilding |
| `./central.sh logs` | `agentop central logs` | Follow the `app` logs |
| `./central.sh status` | `agentop central status` | Show container + health status |
| `./central.sh down` | `agentop central down` | Stop + remove containers (keeps the data volume) |
| `./central.sh pull` | `agentop central pull` | Rebuild from a fresh base image |

```bash
agentop central up        # first time offers the interactive init, then deploys
agentop central status
agentop central logs
```

> `agentop central` needs the agentistics repo (it runs `central.sh`), so run it from
> inside a checkout. On a machine that only has the binary, clone the repo first.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_PORT` | `48080` | Host port the central is served on (distinct from a member/dev's `47291`) |
| `BIND_IP` | `0.0.0.0` | Interface the app binds to. Default `0.0.0.0` = all interfaces. Set to a specific IP (e.g. your Tailscale address) to restrict exposure |
| `MONGO_URL` | `mongodb://mongo:27017/?replicaSet=rs0` | MongoDB connection string |
| `MONGO_DB` | `agentistics` | MongoDB database name |
| `AGENTISTICS_TEAM_CENTRAL` | `1` | Enable central aggregator mode (always `1` in Docker) |
| `AGENTISTICS_TEAM_ORG` | `default` | Organisation namespace for team sessions |
| `AGENTISTICS_TEAM_PASSWORD` | _(required)_ | Dashboard login password |
| `AGENTISTICS_TEAM_SESSION_SECRET` | _(required)_ | HMAC key for session cookies |
| `AGENTISTICS_TEAM_INGEST_TOKEN` | _(empty)_ | Bearer token for `/api/team/ingest`; leave empty to allow unauthenticated ingestion |

---

## Network exposure (which interface the dashboard listens on)

`BIND_IP` controls the interface the app binds to:

| Goal | `BIND_IP` | Reachable from |
|---|---|---|
| Works everywhere (default) | _unset_ → `0.0.0.0` | Every interface that can route to the host |
| Serve a private tailnet only | your Tailscale IP (e.g. `100.x.y.z`) | This host + Tailscale peers |
| Local machine only | `127.0.0.1` | Just this host's browser |

The default `0.0.0.0` just works. If you want to **restrict** exposure, set `BIND_IP` to a
specific address — binding your Tailscale IP serves remote teammates over Tailscale's
encrypted network, so plain HTTP inside the tailnet is fine (Tailscale encrypts the
transport). Only reach for a TLS reverse proxy + `AGENTISTICS_TEAM_TLS=1` if you must
expose the dashboard **outside** Tailscale.

> **WSL2 note:** binding to a specific non-loopback IP (e.g. Tailscale) means Windows'
> `localhost` forwarding no longer reaches the app — browse via that IP instead. The default
> `0.0.0.0` keeps `http://localhost:<APP_PORT>` working.

---

## Generating a `.env` via the API

When the server is running in central mode you can generate a pre-filled `central.env` via:

```bash
curl -s http://localhost:48080/api/team/deploy | jq .
```

The response includes:
- `env` — ready-to-write `central.env` file content
- `command` — `docker compose --env-file central.env up -d`
- `password` / `sessionSecret` — the generated secrets (shown **once**; not stored by the server)

> Store these values immediately. The server never logs or re-exposes them.

---

## Connect a member

A **member** is a developer's machine that pushes its *computed* metrics (never chat content)
to the central. Membership is configured with the `agentop` binary — the central never needs
to reach back out to the member to onboard it.

### 1. Mint a token on the central

Log in to the central dashboard, open **Settings → Team**, and mint a token for the new
machine. The **machine's name is set here, on the token** — there is no name field on the
member side; the member resolves its own name from the central via `/api/team/whoami`.

From the members panel you can also **rotate** a token (issues a new credential while
migrating that member's sessions + stats to the new identity, so history is preserved),
**revoke** it (confirmation modal, then cascade-deletes that member's data), and **rename**
the machine.

### 2. Connect the member machine

Interactive wizard (recommended for first-time setup — pick "join a central" and paste the
endpoint + token):

```bash
agentop setup
```

Non-interactive equivalent:

```bash
agentop member connect --endpoint http://<central-host>:48080 --token <minted-token> [--org <org>]
```

`member connect` verifies the token against `GET <endpoint>/api/team/whoami` before writing
anything — a bad token never leaves a half-written config. On success it prints
`connected as <name>` (the name comes from the central).

> Use the central's reachable address for `--endpoint`. Inside a tailnet this is the central's
> Tailscale IP (e.g. `http://100.x.y.z:48080`). The bearer token is stored locally and never
> logged.

### 3. Check / leave

```bash
agentop member status    # mode, endpoint, org, user + last sync state
agentop member leave     # notify the central and reset this machine back to solo
```

Presence is **WebSocket-authoritative**: a member shows online in real time while its
reverse channel is live and flips to offline within ~8s of the app being killed (a heartbeat
covers http-only members). Members follow the **central's** push cadence (default 30s, 15s floor, down to
5s in express mode) and can only go slower, plus they push on local change (debounced). If the
central DB is wiped, the token is rotated, or the endpoint changes, the member detects the
signature change and re-pushes its full history automatically — no manual `team-sent.json`
reset. A revoked machine auto-resets itself back to solo.

### Machine in Docker

A machine (solo or member) can also run in a container instead of natively. Configure it on the
host first (`agentop member connect …`, which writes `~/.agentistics`), then bring the container
up from the repo — `agentop start` offers this as the **docker** option, or run it directly:

```bash
docker compose -f docker-compose.machine.yml up -d --build   # web: http://localhost:47292
docker compose -f docker-compose.machine.yml logs -f
docker compose -f docker-compose.machine.yml down
```

It reuses the same image as the central (minus Mongo and central mode), mounts the host's harness
dirs (`~/.claude`, `~/.codex`, `~/.gemini`, `~/.copilot`) **read-only**, mounts `~/.agentistics`
read-write (so it inherits the endpoint/token and persists the archive/sync state), and uses host
networking so it reaches the central and opens the reverse channel.

> Run the machine in Docker **or** natively — not both at once. Two members sharing the same token
> would push the same data and flap presence. The container writes `~/.agentistics` as root; `chown`
> it back to your user if you later switch to running natively.

---

## Autostart with `agentop`

Beyond the Docker snippets below, the `agentop` binary can register itself as a **systemd
*user* service** (no root) so a mode starts with the system:

```bash
agentop autostart server enable      # a member/solo dashboard + daemon
agentop autostart central enable     # the Docker central (runs central.sh up)
agentop autostart watch enable       # the OpenTelemetry daemon only

agentop autostart server disable     # stop + remove the service
agentop autostart status             # state of every service (omit the mode to list all)
```

On Linux/WSL, `enable` writes `~/.config/systemd/user/agentop-<mode>.service`, runs
`systemctl --user enable --now agentop-<mode>`, and sets `loginctl enable-linger <you>` so the
service also starts at boot without an active login. It additionally installs a guarded hook in
`~/.bashrc` that runs `agentop check-update` on every terminal open (prints a banner only when
an update exists). macOS (launchd) and Windows (Task Scheduler) are not yet wired up — those
platforms print the exact manual step instead.

> `autostart central` runs `central.sh up`, so it needs the agentistics repo present. For a
> production central you can use either this or the raw systemd unit in **Autostart Snippets**
> below.

---

## MongoDB Replica Set

The bundled `mongo` service starts with `--replSet rs0`. The healthcheck runs an
**idempotent** `rs.initiate()` that configures the replica set on first boot and is
a no-op thereafter:

```javascript
try {
  rs.status();
} catch (e) {
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
}
```

The member host **must** be `mongo:27017` — the same hostname the `app` service uses in
`MONGO_URL` — so the driver's replica set topology check passes.

MongoDB does **not** publish port `27017` to the host; only the `app` container can reach it.

---

## Autostart Snippets (raw — for the Docker central)

These run the Docker central directly via the host's init system. Prefer them over
`agentop autostart central` when the machine has no `agentop` binary or you want to manage the
compose stack yourself.

### systemd (Linux — recommended for production servers)

Save as `/etc/systemd/system/agentistics.service`:

```ini
[Unit]
Description=agentistics Team Dashboard
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/agentistics
ExecStart=docker compose --env-file central.env up -d
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agentistics
```

---

### launchd (macOS)

Save as `~/Library/LaunchAgents/com.agentistics.team.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agentistics.team</string>
  <key>ProgramArguments</key>
  <array>
    <string>docker</string>
    <string>compose</string>
    <string>-f</string>
    <string>/opt/agentistics/docker-compose.yml</string>
    <string>up</string>
    <string>-d</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/agentistics.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/agentistics.err</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.agentistics.team.plist
```

---

### PM2 (Node process manager — useful on VPS without systemd)

Create `ecosystem.config.cjs` next to `docker-compose.yml`:

```javascript
module.exports = {
  apps: [{
    name: 'agentistics',
    script: 'docker',
    args: 'compose up -d',
    restart_delay: 5000,
    env: { NODE_ENV: 'production' },
  }],
}
```

Start and persist:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command
```

---

## Staying up to date

agentistics surfaces "update available" everywhere: as a banner when you run a command, via
the `~/.bashrc` hook on terminal open/boot, and on the dashboard (a bell notification plus a
**mode-aware** update modal with the exact command for your role). A periodic server re-check
(every 6h) pushes the notification live over SSE.

```bash
agentop check-update   # prints the banner if outdated, nothing if current
agentop upgrade        # download + replace the binary with the latest release
agentop --version      # current version (also flags an update if one exists)
```

### Upgrade a central (Docker)

The dashboard update modal on a **central** shows a single command:

```bash
bun run up:central     # = ./central.sh up — rebuild + --force-recreate with the new code
```

Raw-compose equivalent (from the repo, after `git pull`):

```bash
git pull
docker compose -p team-mode --env-file central.env build --pull
docker compose -p team-mode --env-file central.env up -d --force-recreate
```

### Upgrade a member

The update modal on a **member/solo** machine shows:

```bash
agentop upgrade                            # replace the binary
systemctl --user restart agentop-server    # restart the autostart service to run the new binary
```

If you don't run `agentop server` as a systemd user service, just restart it however you
launched it (e.g. re-run `agentop server`).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `MongoServerError: not primary` | Replica set not yet initialised | Wait for the `mongo` healthcheck to turn green (`docker compose ps`) |
| Dashboard shows 401 on every request | Password set but no session cookie | Navigate to the login page at `/login` |
| Port already in use | Another process on the host port | Change `APP_PORT` in `.env` |
| Container exits immediately | Missing required env var | Check `docker compose logs app` |
