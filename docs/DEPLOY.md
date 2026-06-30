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

### 2. Create your `.env`

Copy the example and fill in your secrets:

```bash
cp .env.example .env
```

Generate strong values for the two required secrets:

```bash
# Password (shared with your team — used to log in to the dashboard)
openssl rand -hex 24

# Session secret (never share — used to sign HMAC cookies)
openssl rand -hex 32
```

Edit `.env` and paste the values into:
- `AGENTISTICS_TEAM_PASSWORD`
- `AGENTISTICS_TEAM_SESSION_SECRET`

> **Security note**: keep `AGENTISTICS_TEAM_SESSION_SECRET` strictly separate from the
> password. If the password is ever leaked, an attacker still cannot forge session cookies
> as long as the session secret is unknown.

### 3. Start the stack

```bash
docker compose up -d
```

The first run builds the image and initialises the MongoDB replica set. This takes about 30–60 seconds.

### 4. Open the dashboard

Navigate to `http://<your-host>:<APP_PORT>` (default: `http://localhost:47291`).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_PORT` | `47291` | Host port published by the app container |
| `MONGO_URL` | `mongodb://mongo:27017/?replicaSet=rs0` | MongoDB connection string |
| `MONGO_DB` | `agentistics` | MongoDB database name |
| `AGENTISTICS_TEAM_CENTRAL` | `1` | Enable central aggregator mode (always `1` in Docker) |
| `AGENTISTICS_TEAM_ORG` | `default` | Organisation namespace for team sessions |
| `AGENTISTICS_TEAM_PASSWORD` | _(required)_ | Dashboard login password |
| `AGENTISTICS_TEAM_SESSION_SECRET` | _(required)_ | HMAC key for session cookies |
| `AGENTISTICS_TEAM_INGEST_TOKEN` | _(empty)_ | Bearer token for `/api/team/ingest`; leave empty to allow unauthenticated ingestion |

---

## Generating a `.env` via the API

When the server is running in central mode you can generate a pre-filled `.env` via:

```bash
curl -s http://localhost:47291/api/team/deploy | jq .
```

The response includes:
- `env` — ready-to-write `.env` file content
- `command` — `docker compose up -d`
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
ExecStart=docker compose up -d
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
docker compose build --pull
docker compose up -d
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `MongoServerError: not primary` | Replica set not yet initialised | Wait for the `mongo` healthcheck to turn green (`docker compose ps`) |
| Dashboard shows 401 on every request | Password set but no session cookie | Navigate to the login page at `/login` |
| Port already in use | Another process on the host port | Change `APP_PORT` in `.env` |
| Container exits immediately | Missing required env var | Check `docker compose logs app` |
