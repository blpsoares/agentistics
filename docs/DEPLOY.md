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

Navigate to `http://<your-host>:<APP_PORT>` (default: `http://localhost:47291`;
the bundled `central.env` uses `48080`).

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

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_PORT` | `47291` | Host port published by the app container |
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
curl -s http://localhost:47291/api/team/deploy | jq .
```

The response includes:
- `env` — ready-to-write `central.env` file content
- `command` — `docker compose --env-file central.env up -d`
- `password` / `sessionSecret` — the generated secrets (shown **once**; not stored by the server)

> Store these values immediately. The server never logs or re-exposes them.

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

## Autostart Snippets

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

## Upgrading

```bash
git pull
docker compose --env-file central.env build --pull
docker compose --env-file central.env up -d
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `MongoServerError: not primary` | Replica set not yet initialised | Wait for the `mongo` healthcheck to turn green (`docker compose ps`) |
| Dashboard shows 401 on every request | Password set but no session cookie | Navigate to the login page at `/login` |
| Port already in use | Another process on the host port | Change `APP_PORT` in `.env` |
| Container exits immediately | Missing required env var | Check `docker compose logs app` |
