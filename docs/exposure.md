# Publishing a central

How to put an Agentistics central where people outside the host can reach it — from a LAN, a
tailnet, or the open internet — without handing anyone a shell on the machine.

**Getting a central running at all is [`docs/central-deploy.md`](central-deploy.md).** This page
assumes you have one and starts at the question that page deliberately leaves alone: *who can reach
it, and what is it allowed to do?*

This document is the **how**. The **why** — threat model, trust boundaries, the request pipeline,
and the limits of each control — is [`docs/security.md`](security.md).

Read it in order. §7 is a checklist you must be able to tick before the first outside request; most
of it is checked for you by `agentop doctor --exposed`.

---

## 1. The three reach levels

Publishing is not one decision. It is two, and they are independent:

- **Reach** — which network can open a TCP connection to the app. Decided by `BIND_IP` and by
  whatever you put in front.
- **Profile** — what the app is *allowed to do* for whoever reaches it. Decided by
  `AGENTISTICS_EXPOSURE`.

Getting the first right and the second wrong is the failure this page exists to prevent: an
instance on a public hostname still running with local-shell routes enabled.

| You want | Reach | Profile |
|---|---|---|
| Just this host | `BIND_IP=127.0.0.1` | `local` / `lan` |
| A LAN or a tailnet you trust | `BIND_IP=0.0.0.0` or your tailnet IP | `lan` |
| The internet | `BIND_IP=127.0.0.1` **+ something in front** | `public` |

**To publish on the internet you do not widen `BIND_IP`.** You keep it on loopback and put a tunnel
or a TLS terminator in front. Widening it as well adds a way in that bypasses every control at the
edge.

---

## 2. The topology

Whatever you put in front, the shape is the same and only three properties matter:

```
                     the internet
                          │
                          │  HTTPS
              ┌───────────▼────────────┐
              │   your entry point     │   TLS termination, and ideally
              │   (see §5 for options) │   WAF / rate limiting / an auth layer
              └───────────┬────────────┘
                          │  plain HTTP, host-local
    ┌─────────────────────▼──────────────────────┐
    │ host                                        │
    │    agentistics central  ← 127.0.0.1:48080   │
    │    mongo                ← compose net only  │
    └─────────────────────────────────────────────┘
```

1. **The app binds `127.0.0.1`.** That is the compose default. It is the property that makes the
   entry point the *only* way in, which is what every other control assumes.
2. **The database is never routed through it.** Mongo is not published to the host at all; only the
   app container reaches it over the compose network.
3. **Ideally, no inbound port is opened either.** A tunnel that dials out (§5.1, §5.2) keeps the
   firewall closed entirely. A reverse proxy (§5.3) does open 443 — that is a real difference, not
   a formality, and it is why the tunnel options are listed first.

**None of this requires a specific vendor.** Cloudflare appears below because it is one concrete,
well-documented way to satisfy the shape — not because the product depends on it. Tailscale,
nginx, Caddy, Traefik, or a cloud load balancer satisfy it equally well; §5 works through each.

---

## 3. The exposure profile

One setting decides what the instance may do. It is read once at boot by
`packages/server/server/exposure.ts`, which every dangerous capability asks instead of re-deriving
the answer at the call site.

| `AGENTISTICS_EXPOSURE` | Meaning | Local shell / chat / host transcripts / MCP admin |
|---|---|---|
| unset on a non-central → `local` | solo machine on 127.0.0.1 | available |
| unset on a central → `lan` | trusted network | off unless `AGENTISTICS_ALLOW_LOCAL_SHELL=1` |
| `public` | published on the internet | **permanently off** |

`public` ignores `AGENTISTICS_ALLOW_LOCAL_SHELL` — there is no opt-in for arbitrary shell on an
instance strangers can reach. **An unrecognised value resolves to `public`**, so a typo fails
closed.

What `public` revokes, and why each mattered:

- `POST /api/exec` — ran `bash -c` with the caller's string, reachable by any authenticated
  account including a plain `member`.
- `POST /api/chat-tty` — spawned the local coding-assistant CLI and rewrote `~/.claude.json`.
- `GET /api/{claude,codex,gemini,copilot,nay}-sessions` — returned the **central host's own raw
  transcripts**; team scoping does not cover them.
- `POST /api/mcp-action`, `GET /api/mcp-list` — edit the host's MCP registration.

They answer `403 {"error":"capability_disabled"}` **before** the auth gate runs, so an exposed
instance does not even reveal whether the caller is authenticated.

> **Owner MFA is required on every profile, not only `public`.** It is not a network property: an
> owner account reaches every team's data and every admin route, and since account recovery is
> self-service through the second factor, an owner without one has no way back in except the host.
> On `public` an owner with no second factor can reach only the enrolment and identity routes.

---

## 4. The variables — all of them

Everything below goes in `central.env`. `chmod 600` it: it holds secrets.

```sh
# --- what this instance is allowed to do ---------------------------------
AGENTISTICS_EXPOSURE=public         # local | lan | public; unknown → public
AGENTISTICS_TEAM_TLS=1              # TLS terminates in front: Secure + __Host- cookies, HSTS
AGENTISTICS_TRUST_PROXY=1           # believe CF-Connecting-IP / X-Forwarded-For — see the caveat
AGENTISTICS_TEAM_SESSION_SECRET=    # openssl rand -hex 32, or leave empty to have one generated

# --- where it listens ----------------------------------------------------
BIND_IP=127.0.0.1                   # NOT 0.0.0.0 — the entry point is the only way in
APP_PORT=48080
```

Deliberately **not** set:

- `AGENTISTICS_ALLOW_LOCAL_SHELL` — ignored on `public` anyway; setting it signals the wrong intent
  and is live if the profile is ever downgraded.
- `AGENTISTICS_CENTRAL_USER` — with it, compose mounts the host's `~/.claude`, `~/.codex`,
  `~/.gemini` and `~/.copilot` read-only into the container, which means an exposed instance is
  holding every raw transcript on the machine. Without it there is no host filesystem access at all.
- `AGENTISTICS_ALLOWED_ORIGINS` — normally empty. The dashboard is served by the same process, so
  it is same-origin. Only set it for a split deployment where the SPA is hosted elsewhere.

Three notes that have each been a real incident:

- **`AGENTISTICS_TRUST_PROXY=1` is only correct when the entry point is the *only* way in.** If the
  app is also reachable directly, a client picks its own rate-limit bucket by sending the header.
  Loopback binding is what makes this safe.
- **`AGENTISTICS_TEAM_SESSION_SECRET` never falls back to a password.** It used to, which meant a
  leaked or shared password was enough to forge a session cookie for any account. Setting it equal
  to `AGENTISTICS_TEAM_PASSWORD` now refuses to boot. Leave it empty and the central generates a
  random secret and persists it in Mongo.
- **Every one of these must actually reach the container.** Both compose paths pass all of them
  through, and a test (`standalone-compose.test.ts`) holds the generated no-repo compose to the
  same list. This is checked because it was once wrong: the generated compose passed none of them,
  so `AGENTISTICS_EXPOSURE=public` sat in `central.env` doing nothing while the instance ran with
  the `lan` profile and its host-power routes live. If you deployed a central from the published
  image before this, re-run `agentop central up` and then §7.

---

## 5. The entry point

Pick **one**. Each satisfies §2; they differ in whether a port is opened, what TLS costs you, and
what you get at the edge.

### 5.1 Cloudflare Tunnel

No inbound port: `cloudflared` dials out, so the firewall stays closed. Gives you WAF, DDoS
protection, edge rate limiting, and optionally Cloudflare Access as an independent auth layer.

```bash
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

```bash
cloudflared tunnel route dns agentistics metrics.example.com
sudo cloudflared service install     # run it as a service, not in a shell
```

Rotate the tunnel token periodically. If it leaks, delete the tunnel and create a new one — that
invalidates the old credentials immediately.

**If you enable Cloudflare Access, mind the machine traffic.** `POST /api/team/ingest` and the
`/api/team/agent` WebSocket are members and CI runners, not browsers — they cannot complete an
Access login. Bypass those paths, give them a service token, or (cleanest) run the ingest-only
split in §6.

### 5.2 Tailscale

For a team that is already on a tailnet, this is the least machinery of any option: no public
hostname, no certificates to manage, no port opened.

```bash
sudo tailscale set --operator=$USER    # once
tailscale serve --bg 48080             # HTTPS on https://<host>.<tailnet>.ts.net
tailscale serve status
```

Everyone then uses the **MagicDNS URL with no port**, in the browser and as the member endpoint
(`agentop member connect --endpoint https://your-host.your-tailnet.ts.net …`). `serve` proxies the
reverse-channel WebSocket too, so presence and on-demand chat keep working. Undo with
`tailscale serve reset`.

With `tailscale serve` the reach is your tailnet, so `AGENTISTICS_EXPOSURE=lan` is defensible — the
network is authenticated and encrypted. Set `AGENTISTICS_TEAM_TLS=1` either way, because TLS really
does terminate in front. `tailscale funnel` puts it on the **public** internet instead; that is the
`public` profile plus everything in §7.

> **Why `serve` rather than a published port.** Running the central in Docker inside **WSL2** and
> hitting the machine's tailnet IP directly (`http://100.x.y.z:48080`) often hangs or "works, then
> stops": packets arriving on `tailscale0` must traverse Docker's DNAT/FORWARD inside WSL2, which
> is unreliable there. `tailscale serve` accepts the connection in-process and forwards to
> `127.0.0.1`, which always works. It is not an agentistics problem — `localhost` proves the app is
> fine.

### 5.3 A reverse proxy you run — nginx, Caddy, Traefik

This does open 443 on the host. In exchange you own the certificate and the configuration outright,
with no third party in the request path.

Caddy, which handles Let's Encrypt by itself:

```
metrics.example.com {
    reverse_proxy 127.0.0.1:48080
}
```

nginx, with certbot-managed certificates:

```nginx
server {
    listen 443 ssl http2;
    server_name metrics.example.com;

    ssl_certificate     /etc/letsencrypt/live/metrics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/metrics.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:48080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # The reverse channel (/api/team/agent) is a WebSocket. Without these two headers
        # presence and on-demand chat fail while the dashboard looks perfectly healthy.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

Then set `AGENTISTICS_TEAM_TLS=1` and `AGENTISTICS_TRUST_PROXY=1`, and make sure the host firewall
allows **only** 443 — the app's own 48080 must not be reachable from outside, or the header trust
above becomes a way to choose your own rate-limit bucket.

### 5.4 A cloud load balancer

ALB/GCLB/Azure AppGW in front of the host works the same way: terminate TLS at the balancer, target
the host on `48080`, and restrict the instance's security group so the balancer is the only source
that can reach that port. Set `AGENTISTICS_TEAM_TLS=1` and `AGENTISTICS_TRUST_PROXY=1`. Enable
WebSocket support on the target group, or the reverse channel silently fails.

### Whatever you choose

- Rate-limit `/api/iam/login`, `/api/iam/login/mfa` and `/api/team/login` at the edge — 10 requests
  per minute per IP is ample for humans. The in-app limiter is the backstop, not the front line.
- Enable whatever managed WAF / bot protection the entry point offers.
- Do not route the database port. Ever.

---

## 6. Splitting off CI ingest

Cloud CI runners have to reach the central to push metrics, and nothing else about the central
should be exposed to make that possible. Run a **second stack** that serves only the token-gated
ingest endpoint and 404s everything else, sharing one database with your private dashboard
instance:

```bash
docker compose -p team-ingest \
  -f docker/central.image.yml -f docker/central.ingest-only.yml \
  --env-file central.ingest.env up -d
```

Its `central.ingest.env` points `MONGO_URL` at the same database, uses a different `APP_PORT`, sets
`AGENTISTICS_EXPOSURE=public` + `_TEAM_TLS=1` + `_TRUST_PROXY=1`, and carries the ingest credential
— preferably `AGENTISTICS_OIDC_AUDIENCE` for keyless GitHub OIDC, so no secret is stored at all.
`-p team-ingest` is required: the base files pin `name: team-mode`, and reusing it would recreate
your dashboard's containers instead of starting a second stack.

Exposing an ingest-only instance is low-risk — there is nothing to read, only a token-gated write.
The runner side is [`docs/github-actions.md`](github-actions.md).

---

## 7. Before the first outside request

Run the preflight **inside the container**, where `central.env` is the live environment *and* the
database is reachable:

```bash
./central.sh doctor --exposed        # from a checkout
```

It must print no `✗`. A check that could not be verified reports a **failure**, never a reassuring
pass.

> **From a released binary there is no in-container preflight.** `CENTRAL_ACTIONS` carries no
> `doctor`, so there is no `agentop central doctor`. Run `agentop doctor --exposed` on the host: it
> finds the same `central.env` (`~/.agentistics/central/`) and names the file it read, but cannot
> reach the database, so the owner-MFA and machine-token checks report as unverified — which counts
> as a failure, deliberately.

Then verify from **outside**, against the real hostname:

```bash
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

```bash
ss -ltnp | grep 48080                             # 127.0.0.1, never 0.0.0.0
docker compose -p team-mode exec app id           # uid=10001, not root
docker compose -p team-mode exec app touch /x     # Read-only file system
docker compose -p team-mode exec app env | grep AGENTISTICS_EXPOSURE   # public
```

That last one is worth its line: it is the difference between the variable being *set* and the
variable *arriving*.

In the browser, on the real hostname:

- The dashboard loads with **zero** CSP violations in the console. A violation means an inline
  script slipped in — fix the source, never widen the policy.
- The session cookie is named `__Host-agentistics_session` and shows `Secure`, `HttpOnly`,
  `SameSite=Strict`.
- Signing in as an owner asks for a TOTP code.
- Two accounts in different teams see different data.

---

## 8. Onboarding people

1. On first boot with no owner, the central prints a one-time setup token to its log. Use it once
   to create the owner account.
2. **The owner enrols TOTP immediately.** On `public`, an owner without a second factor can reach
   only the enrolment and identity routes.
3. The owner creates each account with `mustChangePassword`, and sends the temporary password out
   of band — not in the same channel as the URL.
4. The person signs in, is forced to set a password (minimum 12 characters, no common passwords,
   nothing containing their own name or e-mail), and enrols their own second factor from the
   account menu → **Two-factor**.

Roles: `owner` reaches everything; a team `manager` manages their own teams' machines, members and
`user` accounts; a plain `user` sees only the teams they belong to plus machines they own. That
scoping is enforced server-side in `team-scope.ts` and asserted in `authz-gate.test.ts`.

---

## 9. Incident response

| Situation | Action |
|---|---|
| A session may be compromised | Change that account's password, or have an owner delete/recreate it — both bump `sessionVersion`, invalidating every existing cookie for that account instantly |
| A machine token leaked | Revoke it in Settings → Team. Tokens are stored only as sha256 hashes and are individually revocable; the member auto-resets to solo on a persistent 401 |
| The session secret leaked | Set a new `AGENTISTICS_TEAM_SESSION_SECRET` and restart. Every session everywhere is invalidated |
| Something looks wrong | `GET /api/iam/audit` (owner only) — logins, failures, lockouts, MFA events, password changes, account/team/token changes and every gate denial, kept 180 days |
| The tunnel or proxy credential leaked | Delete and recreate it. For a tunnel that invalidates the old credentials immediately; for a proxy, reissue the certificate and rotate any service token |
| You are not sure the profile took effect | `docker compose -p team-mode exec app env \| grep AGENTISTICS_`, then `./central.sh doctor --exposed` |
