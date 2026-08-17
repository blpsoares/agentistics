# Exposing a central on the internet

How to publish an Agentistics central so named people sign in with their own e-mail and
password, without handing the internet a shell on the host.

Read this in order. The last section is a checklist you must be able to tick before opening the
tunnel; `agentop doctor --exposed` checks most of it for you.

This document is the *how*. For the *why* — threat model, trust boundaries, the request pipeline
and what each control does not do — see **[security.md](security.md)**.

---

## 1. Topology

```
        internet
           │  HTTPS
    ┌──────▼───────┐
    │  Cloudflare  │   WAF, DDoS, rate limiting, (optionally) Access
    └──────┬───────┘
           │  outbound-only tunnel, established BY the host
    ┌──────▼──────────────────────────────────┐
    │ host                                     │
    │   cloudflared ──► 127.0.0.1:48080        │
    │                     agentistics central  │
    │                     mongo (compose net)  │
    └──────────────────────────────────────────┘
```

Three properties matter and each one is load-bearing:

- **No inbound port is opened.** `cloudflared` dials out; the firewall stays closed.
- **The app binds `127.0.0.1`.** That is the compose default now. Binding wider adds a way in
  that bypasses every control at the edge.
- **The database is never routed through the tunnel.** Mongo is not published to the host at
  all; only the app container reaches it over the compose network.

## 2. The exposure profile

One setting decides what the instance is allowed to do:

| `AGENTISTICS_EXPOSURE` | Meaning | Local shell / chat / transcripts / MCP admin | Owner MFA |
|---|---|---|---|
| unset (non-central) → `local` | solo machine on 127.0.0.1 | available | not required |
| unset (central) → `lan` | trusted network | off unless `AGENTISTICS_ALLOW_LOCAL_SHELL=1` | not required |
| `public` | published on the internet | **permanently off** | **required** |

`public` ignores `AGENTISTICS_ALLOW_LOCAL_SHELL` — there is no opt-in for arbitrary shell on an
instance strangers can reach. An unrecognised value resolves to `public`, so a typo fails closed.

What `public` revokes, and why each one matters:

- `POST /api/exec` — ran `bash -c` with the caller's string, reachable by any authenticated
  account including a plain `member`.
- `POST /api/chat-tty` — spawned the local coding-assistant CLI and rewrote `~/.claude.json`.
- `GET /api/{claude,codex,gemini,copilot,nay}-sessions` — returned the **central host's own raw
  transcripts**; team scoping does not cover them.
- `POST /api/mcp-action`, `GET /api/mcp-list` — edit the host's MCP registration.

They answer `403 {"error":"capability_disabled"}` **before** the auth gate runs, so an exposed
instance does not even reveal whether the caller is authenticated.

## 3. Configuration

In `central.env`:

```sh
AGENTISTICS_TEAM_CENTRAL=1
AGENTISTICS_EXPOSURE=public
AGENTISTICS_TEAM_TLS=1              # Secure + __Host- cookie prefix, and HSTS
AGENTISTICS_TRUST_PROXY=1           # believe CF-Connecting-IP (ONLY behind the tunnel)
AGENTISTICS_TEAM_SESSION_SECRET=    # openssl rand -hex 32
BIND_IP=127.0.0.1
APP_PORT=48080
```

Do **not** set `AGENTISTICS_ALLOW_LOCAL_SHELL`. Do not set `AGENTISTICS_CENTRAL_USER` unless you
genuinely want this machine's own usage in the dashboard — with it, compose mounts the host's
`~/.claude`, `~/.codex`, `~/.gemini` and `~/.copilot` read-only into the container, which means
an exposed instance is holding every raw transcript on the machine. Without it there is no host
filesystem access at all.

Two notes on the secrets:

- **`AGENTISTICS_TEAM_SESSION_SECRET` no longer falls back to the dashboard password.** It used
  to, which meant a leaked or shared password was enough to forge a session cookie for any
  account. Setting it to the password now refuses to boot. Leave it empty and the central
  generates a random secret and persists it in Mongo.
- `AGENTISTICS_TRUST_PROXY=1` is only correct when the tunnel is the *only* way in. If the app
  is also reachable directly, a client can pick its own rate-limit bucket by sending the header.

Then `chmod 600 central.env` — it holds secrets.

## 4. Bringing it up

From a repo checkout:

```sh
./central.sh up          # builds, migrates the data volume, (re)creates the containers
./central.sh status      # containers + health
./central.sh logs        # follow the app log
```

From the standalone binary, with no checkout (materialises a compose + `central.env` under
`~/.agentistics/central/` and pulls the published image):

```sh
agentop central up
agentop central status
agentop central logs
```

The first boot with no owner account prints a **one-time setup token** to the log. Capture it —
it is shown once:

```sh
./central.sh logs | grep -A 6 "OWNER SETUP REQUIRED"
```

Then check the deployment before anything is reachable from outside:

```sh
./central.sh doctor --exposed
```

Run it through `central.sh` rather than as bare `agentop doctor`: inside the container
`central.env` is the live environment **and** MongoDB is reachable, so the owner-MFA and
machine-token checks actually run. On the host, `agentop doctor --exposed` still reads
`central.env` (it says which file it used) but cannot reach the database, so those two checks
report as unverified — which counts as a failure, deliberately.

Nothing above opens a port. The container binds `127.0.0.1`, so at this point the central is
reachable only from the host itself. The tunnel below is what publishes it.

## 5. The tunnel

```sh
cloudflared tunnel login
cloudflared tunnel create agentistics
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /home/<you>/.cloudflared/<TUNNEL-UUID>.json
ingress:
  - hostname: metrics.example.com
    service: http://127.0.0.1:48080
  - service: http_status:404
```

```sh
cloudflared tunnel route dns agentistics metrics.example.com
sudo cloudflared service install     # run it as a service, not in a shell
```

Rotate the tunnel token periodically. If it leaks, delete the tunnel and create a new one — that
invalidates the old credentials immediately.

## 6. At the edge (Cloudflare)

The in-app limiter is the backstop, not the front line. Configure:

- **Rate limiting** on `/api/iam/login`, `/api/iam/login/mfa` and `/api/team/login` — 10 requests
  per minute per IP is ample for humans.
- **Managed WAF rules** and **bot fight mode** on.
- Optionally **Cloudflare Access** in front of the dashboard, as a second and independent
  authentication layer (deny-by-default, before the login page is ever reached).

**If you enable Access, mind the machine traffic.** `POST /api/team/ingest` and the
`/api/team/agent` WebSocket are members and CI runners, not browsers — they cannot complete an
Access login. Either bypass those paths, give them a service token, or (cleanest) run a second
hostname pointed at a separate instance with `AGENTISTICS_INGEST_ONLY=1` sharing the same Mongo:
that instance serves only the token-gated ingest endpoint and 404s everything else.

## 7. Onboarding a person

1. On first boot with no owner, the central prints a one-time setup token. Use it once to create
   the owner account.
2. The owner enrols TOTP immediately — on a `public` profile an owner without a second factor can
   reach only the enrolment and identity routes, and nothing else.
3. The owner creates each account with `mustChangePassword`, and sends the temporary password out
   of band (not in the same channel as the URL).
4. The person signs in, is forced to set a password (minimum 12 characters, no common passwords,
   nothing containing their own name or e-mail), and enrols their own second factor from the
   account menu → **Two-factor**.

Roles: `owner` reaches everything; a team `manager` manages their own teams' machines, members
and `user` accounts; a plain `user` sees only the teams they belong to plus machines they own.
That scoping is enforced server-side in `team-scope.ts` and asserted in `authz-gate.test.ts`.

## 8. Incident response

| Situation | Action |
|---|---|
| A session may be compromised | Change that account's password, or have an owner delete/recreate it — both bump `sessionVersion`, which invalidates every existing cookie for that account instantly. |
| A machine token leaked | Revoke it in Settings → Team. Tokens are stored only as sha256 hashes and are individually revocable; the member auto-resets to solo on a persistent 401. |
| The session secret leaked | Set a new `AGENTISTICS_TEAM_SESSION_SECRET` and restart. Every session everywhere is invalidated. |
| Something looks wrong | `GET /api/iam/audit` (owner only) — logins, failures, lockouts, MFA events, password changes, account/team/token changes and every gate denial, kept 180 days. |
| The tunnel token leaked | Delete the tunnel, create a new one. |

## 9. Go-live checklist

Run `./central.sh doctor --exposed`. It must print no `✗`.

There is no `agentop central doctor` — `CENTRAL_ACTIONS` in `cli-central.ts` does not carry one, so
a central deployed from the released binary has no in-container preflight and no `central.sh` to
reach it with. Run `agentop doctor --exposed` on the host there: it finds the same `central.env`
(`~/.agentistics/central/`) and names the file it read, but cannot reach the database, so the
owner-MFA and machine-token checks report as unverified — which is a failure, deliberately.

Then verify from outside, against the real hostname:

```sh
H=https://metrics.example.com

curl -s -o /dev/null -w '%{http_code}\n' -X POST $H/api/exec \
  -H 'Content-Type: application/json' -d '{"command":"id"}'      # 403
curl -s -o /dev/null -w '%{http_code}\n' $H/api/claude-sessions   # 403
curl -s -o /dev/null -w '%{http_code}\n' $H/api/data              # 401

for i in $(seq 1 7); do                                           # 401×5, then 429
  curl -s -o /dev/null -w "$i: %{http_code}\n" -X POST $H/api/iam/login \
    -H 'Content-Type: application/json' -d '{"email":"a@b.c","password":"x"}'
done

curl -sI $H/ | grep -iE 'content-security-policy|strict-transport|x-frame|referrer|permissions'
curl -sI -H 'Origin: https://evil.tld' $H/api/health | grep -i access-control-allow-origin  # empty
```

And on the host:

```sh
ss -ltnp | grep 48080                      # 127.0.0.1, never 0.0.0.0
docker compose -p team-mode exec app id    # uid=10001, not root
docker compose -p team-mode exec app touch /x   # Read-only file system
```

In the browser, on the real hostname:

- The dashboard loads with **zero** CSP violations in the console. A violation means an inline
  script slipped in — fix the source, never widen the policy.
- The session cookie is named `__Host-agentistics_session` and shows `Secure`, `HttpOnly`,
  `SameSite=Strict`.
- Signing in as an owner asks for a TOTP code.
- Two accounts in different teams see different data on the dashboard.
