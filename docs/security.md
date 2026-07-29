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
| **Password policy** (`password-policy.ts`) | 12-char floor, 1024 ceiling, common-stem blocklist, rejects own name/e-mail | check against a breach corpus — the embedded list is small by design |
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

## 8. Verifying it yourself

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
