# Security model

What protects an Agentistics instance, how the pieces fit together, and — as importantly —
what each control does **not** do.

This is the reference. Two neighbouring documents cover the other angles:
[exposure.md](exposure.md) is the operator runbook for publishing a central, and
[SECURITY.md](../SECURITY.md) is the vulnerability disclosure policy.

---

## 1. What is being protected

A central holds, for every developer and CI runner in an organisation: project paths, git
remotes, session titles and first prompts, token and cost aggregates, machine tokens (hashed),
account password hashes, and — only when `AGENTISTICS_CENTRAL_USER` is set — read-only mounts of
the host's `~/.claude`, `~/.codex`, `~/.gemini` and `~/.copilot`, which contain **raw
conversation transcripts**.

Members never push chat. Raw transcripts are fetched on demand over the reverse WebSocket and
are never stored centrally.

## 2. Threat model

Defended against:

| Attacker | Primary controls |
|---|---|
| **Unauthenticated internet** — scans the hostname, hits every route, brute-forces login, fuzzes tokens | capability guard, deny-by-default gate, rate limiting, security headers |
| **Authenticated low-privilege account** (legitimate or stolen) escalating to owner, to other teams' data, or to the host | role gate, per-team scoping, capability guard, step-up |
| **Malicious website in a logged-in user's browser** | `SameSite=Strict`, CSRF origin checks, CSP `frame-ancestors 'none'`, no wildcard CORS |
| **Compromised member machine** with a leaked machine token | per-machine tokens, individually revocable, sha256-hashed at rest |
| **Supply chain** — a malicious transitive dependency or tampered image | `bun audit` in CI, lockfile drift check, Dependabot |

Explicitly **out of scope** (see §7 for why this matters):

- A compromised **host**. Shell on the machine reads `central.env` and the Mongo volume.
- A malicious or compromised **owner account**. Owner is fully trusted by design.
- A compromised **Cloudflare account** or tunnel credential.
- Physical access.
- Vulnerabilities in the AI coding assistants whose data this project reads.

## 3. Trust boundaries

```
   internet ─┬─► Cloudflare edge  (WAF, rate limit, optional Access)
             │
             └─► tunnel (outbound-only; no inbound port on the host)
                   │
                   ▼
              ┌──────────────────────────────────────────┐
              │ container: uid 10001, read-only rootfs,   │
              │            cap_drop ALL, no-new-privs     │
              │  ┌────────────────────────────────────┐   │
              │  │ app: capability guard → rate limit │   │
              │  │      → CSRF → auth → role → MFA    │   │
              │  │      → step-up → handler → scoping │   │
              │  └────────────────────────────────────┘   │
              └───────────────┬──────────────────────────┘
                              │ compose network only
                              ▼
                        MongoDB (never published, never tunnelled)
```

Each boundary is independent. A failure of the application logic still meets a container with no
root, no capabilities and an immutable filesystem; a failure of the container still meets a host
with no inbound port open.

## 4. The request pipeline

Order matters, and every step is where it is for a reason
(`packages/server/server/index.ts`):

| # | Step | Why here |
|---|---|---|
| 1 | Path normalisation | `//api/x` must not slip past exact-match route tables |
| 2 | `INGEST_ONLY` short-circuit | a public ingest instance exposes nothing else, not even a 401 |
| 3 | Client IP resolution | everything below keys off it; forwarded headers only trusted under `AGENTISTICS_TRUST_PROXY` |
| 4 | **Rate limiting** | before any expensive work, so an unauthenticated caller cannot spend CPU |
| 5 | **CSRF** | before auth, so a cross-site request is refused without touching the session |
| 6 | **Capability guard** | before auth, so an exposed instance does not reveal whether the caller is authenticated |
| 7 | **Auth** — session cookie → principal | deny-by-default: everything under `/api` outside `AUTH_PUBLIC` |
| 8 | **Role** — owner-only admin paths | includes nested detail routes |
| 9 | **MFA enrolment** gate | a `public` owner without a second factor reaches only enrolment |
| 10 | **Step-up** | destructive operations need proof of presence, not just of identity |
| 11 | Handler | per-resource authority (tags by source, machines by ownership) |
| 12 | **Team scoping** of the response | a principal never receives another team's rows |
| 13 | Security headers stamped on the way out | in a wrapper, so a new route cannot forget them |

## 5. Identity and sessions

**Login** (`/api/iam/login`) verifies an argon2id hash and answers a generic 401 for both an
unknown e-mail and a wrong password, so it cannot be used to enumerate accounts. When a second
factor is enrolled it issues **no cookie**: it returns a five-minute HMAC challenge that grants
nothing on its own, exchanged at `/api/iam/login/mfa` for a session.

**The session cookie** is stateless: `expiryMs.accountId.sessionVersion.issuedAt.HMAC`. It is
`HttpOnly`, `SameSite=Strict`, `Path=/`, and — whenever it is `Secure` — carries the `__Host-`
prefix, which stops a sibling subdomain or a plain-HTTP network attacker from overwriting it.

Three clocks bound it:

| Clock | Value | Effect |
|---|---|---|
| Absolute | 7 days | hard ceiling regardless of activity |
| Idle | 12 hours | a cookie not reissued within the window is dead |
| Refresh | 15 minutes | active use reissues it, so a working session never hits the idle wall |

**Revocation is immediate.** Every account carries a `sessionVersion`; a password change, a
logout-all, enabling MFA or deleting the account bumps it, and every outstanding cookie —
and any outstanding step-up grant — dies with it. Role and team memberships are read **fresh
from the database on every request**, so a permission change takes effect on the next call, not
on the next login.

**Step-up** (`/api/iam/stepup`) covers what a session cannot: proof that the person is still
there. Deleting an account or team, editing an account (role and memberships live there), and
minting, rotating or revoking a machine token each require a five-minute grant obtained with the
password or a TOTP code, presented in `X-Stepup`. It travels in a header rather than a cookie
deliberately — a cookie would ride along automatically, which is the property being avoided.

Three tokens are signed with the same key over similar payloads — session, MFA challenge,
step-up grant — and only **domain separation** stops one being replayed as another. There is a
test asserting exactly that (`auth-principal.test.ts`, `stepup.test.ts`).

## 6. The controls, and what each one does not do

| Control | Does | Does **not** |
|---|---|---|
| **Exposure profile** (`exposure.ts`) | decides whether host-power routes exist at all; `public` revokes them permanently and ignores the opt-in flag; an unknown value fails closed | protect you from marking a public instance `local` — that env value is the trust anchor, which is why `doctor --exposed` re-checks against the strict bar |
| **Capability guard** (`capability-guard.ts`) | 403s `/api/exec`, `/api/chat-tty`, host transcript readers and MCP admin before auth | cover a route nobody registered — an unregistered route is assumed harmless |
| **Rate limiting** (`rate-limit.ts`) | 5 logins / 15 min per IP with doubling backoff; a soft per-account bucket checked before the argon2 verify | survive a process restart, or coordinate across replicas — the edge limiter is the front line |
| **Password policy** (`@agentistics/core`, re-exported by `password-policy.ts`) | 8-char floor, one uppercase, one symbol, 1024 ceiling | a length floor beats composition rules (NIST SP 800-63B) — this is a deliberate product choice, taken knowing that; there is no breach-corpus or common-password check, so `Agentistics@123!` is accepted |
| **TOTP** (`totp.ts`) | RFC 6238 second factor with single-use, hashed recovery codes | help if the authenticator device itself is compromised |
| **Session cookie** | HttpOnly, Strict, `__Host-`, three clocks, instant revocation | stop a stolen cookie being used inside its window — that is what step-up narrows |
| **Step-up** (`stepup.ts`) | requires fresh proof for destructive operations | protect non-destructive reads; a stolen cookie can still read everything in scope |
| **CSRF** (`csrf.ts`) | rejects unsafe methods that carry a cookie without same-origin provenance | apply to Bearer clients, which carry no cookie and are exempt by definition |
| **CORS** (`cors.ts`) | exact-match allowlist; no ACAO at all for an unknown origin | matter to non-browser clients, which ignore CORS entirely |
| **CSP / headers** (`security-headers.ts`) | no inline script, `frame-ancestors 'none'`, HSTS under TLS, `no-store` on `/api` | prevent an XSS — it reduces what one can do |
| **Team scoping** (`team-scope.ts`) | filters sessions, projects, caches and presence to the principal's teams plus machines they own | apply to routes that do not go through it; new data routes must opt in |
| **Audit log** (`audit.ts`) | append-only, 180-day TTL, secret-shaped fields redacted before write | prevent anything — it is how you find out |
| **Resource limits** (`limits.ts`) | byte-counted bodies abandoned mid-stream, SSE cap, outbound timeouts | bound memory used by a legitimate large aggregation |
| **Error hygiene** (`errors.ts`) | generic code + correlation ref to the client | apply to logs, which keep the full message on purpose |
| **Container** | uid 10001, read-only rootfs, `cap_drop: ALL`, no-new-privileges, loopback bind | protect the app from a compromised host |

## 7. Honest limits

- **The owner role is unbounded by design.** An owner reaches every team and every admin route.
  MFA and step-up raise the cost of using a stolen owner session; they do not cap its authority.
- **None of this has had an external audit or a penetration test.** The tests assert that the
  code does what its author intended. That is a check against anticipated mistakes, not against
  unanticipated ones.
- **A public repository does not weaken any of this** — every secret is operator-supplied at
  runtime and none is committed — but it does mean the defaults are read by attackers too, which
  is why they are the conservative ones. See [SECURITY.md](../SECURITY.md).
- **Configuration is the weakest link.** Most of these controls are switched on by an
  environment variable, and OWASP ranks security misconfiguration second among current risks.
  That is the entire reason `agentop doctor --exposed` exists and refuses to declare readiness
  on a check it could not verify.

## 8. Per-connection sharing rules — the guarantee, stated precisely

A member can restrict what each central connection receives, across **two dimensions** —
repository (`git_remote`) and project (`project_path`) — under one of **two modes**
(`share-rules.ts`, `team-rules.ts`, `team-forget-client.ts` — see
[architecture.md](architecture.md#per-connection-repository-sharing) for how it works):

- **`denylist`** ("share everything except…") — the default, and the same behaviour every
  existing `deniedRepos` config had before this shipped.
- **`allowlist`** ("share only…") — nothing reaches this central unless it matches a listed
  repo or project.

The typed rule list (`TeamConnection.sources: ShareSource[]`, plus `shareMode`) exists in exactly
three places — `~/.agentistics/preferences.json`, the in-memory `TeamConnection` on the member, and
the browser tab talking to that machine's own origin — and appears in **no** request body sent to
a central: `IngestBody` is unchanged, and `GET /api/team/status` exposes only `shareMode` and a
per-dimension **count** (`deniedRepos`/`deniedProjects`, or `allowedCount` in allowlist mode) —
never the values, same-origin only.

**What is guaranteed:** a central never learns *which* repositories or projects are hidden (or
allowed), nor how many, nor their names, sessions, prompts, titles, models or cost — **provided
that data was never pushed to it and had no activity before the attribution boundary.** This holds
identically in both modes: allowlist mode does not disclose the *complement* of what it shares
either — a central sees only what was let through, never a hint of what else exists.

**Allowlist mode is the safer default to choose for an untrusted central**, specifically because
of how it treats the unknown: a repository or project that appears on the machine *after* the rule
was set is **hidden** under allowlist (it matches nothing, so it is not shared) but **shared** under
denylist (it matches no *block*, so it goes through). Denylist requires the user to notice and add
every new thing they want hidden; allowlist requires them to notice and add every new thing they
want shared. For a central the user does not fully trust, the fail-closed direction is the one
where forgetting to update the rules leaks nothing new.

**One thing "share only…" must not be read as promising, and the UI must say so explicitly:
allowlist mode still ships the prehistory rollup.** Work done at or before Claude's own
`lastComputedDate` summarisation watermark cannot be decomposed by repository or project by
*anyone*, including this machine — the consolidate store is a strict subset of what Claude already
rolled up into `stats-cache.json`, and there is no per-session record left to filter. That block
travels to every connection, allowlist or denylist, as unattributed daily volume (tokens, cost,
session/message counts with no repo, no project, no session id, no prompt attached) — exactly as it
does today under a denylist. Choosing "share only project X" narrows everything *decomposable*, not
that rollup; the existing `prehistorySessions` marker (surfaced in the confirm modal and the read
view) reports its size so the user can judge how much of their history that covers. A stronger-
sounding mode name must never imply a stronger guarantee than the attribution boundary allows.

**What is NOT guaranteed, and must be said in the UI — do not present this feature as stronger
than this:**

1. **A repo that was already pushed is disclosed by its removal.** The central holds those
   documents with `git_remote`, `project_path`, `first_prompt`, `title`, `model`, tokens and cost,
   and the forget request names them by id. Deleting data you have already handed over is
   inherently observable — the strong promise above applies only to repos that were *never*
   shared with that central; the weak one applies to repos that were.
2. **Work done before the attribution boundary rides inside the prehistory block** as unattributed
   daily volume — no repo, no project, no session, no prompt attached to it — and **no later rule
   can withdraw it**, because there is no document left to name.
3. **The existence of a filter is observable.** A restricted machine's session documents stop
   covering its own filtered days, and a scoped delete is visible on the central's change stream.
   This is inherent to withholding data; there is no marker field creating it.
4. **Colluding centrals can reconstruct each other's denied set.** Two centrals (or one operator
   with accounts on both) seeing the same machine, with overlapping presence windows and
   overlapping shared-session sets, can take a set difference and recover the other's rules.
   Per-connection restrictions are confidential against a *single* central operator, not against
   collusion between them.
5. **CI ingest and the OpenTelemetry exporter are outside these rules entirely, in either mode.**
   A connection's sharing rules are a *member push* rule; they do not reach `agentop ci-push` (CI
   sessions are stamped server-side under a different `memberId`, keyed by repo) or
   `otel-watcher.ts`'s OTLP export. Blocking (or failing to allowlist) a repo on a member
   connection does not stop that repo's GitHub Actions runs or OTel metrics from reaching the same
   central by a different path.

### 8.1 Rules are per machine, and how a machine finds out

Sharing rules live on the machine that declares them. Restricting a repository on one laptop does
nothing on a second laptop signed in to the same account, which will keep pushing it.

A machine detects that situation **without disclosing anything**. It calls
`GET /api/team/account-repos`, which returns the distinct repositories the central holds *for the
caller's own account* and which of that account's machines pushed each one. The request names no
repository and carries no rule — it is byte-identical whether the caller just restricted something
or is idly refreshing — and the response is data the account already owns and can already read from
its dashboard. The comparison against the private rules happens **on the machine**
(`server/account-repos.ts`, `findStillShared`); the central never learns the outcome. The result is
the orange banner on the connection card naming the repository and the sibling machine.

Scope: the route is minted-token-only and scoped to the token's **owner accounts**
(`listSiblingMachines`), never by team and never globally — a token with no owner account sees only
itself. CI and repo tokens are excluded.

## 9. Verifying it yourself

Each control has tests next to it; these are the ones worth reading first:

| Question | Test |
|---|---|
| Can a route become public by accident? | `authz-gate.test.ts` — asserts the exact `AUTH_PUBLIC` set |
| Can a low-privilege account see another team? | `authz-gate.test.ts` → *data scoping (BOLA)* |
| Is the TOTP implementation real? | `totp.test.ts` — RFC 6238 published vectors |
| Can one signed token be replayed as another? | `auth-principal.test.ts`, `stepup.test.ts` |
| Does a bad exposure value fail open? | `exposure.test.ts` |
| Is the lockout a DoS against a colleague? | `rate-limit.test.ts` |

```bash
bun test                    # the whole suite
agentop doctor --exposed    # the deployment's own state
```

And end to end, against a running instance: the checklist at the end of
[exposure.md](exposure.md).
