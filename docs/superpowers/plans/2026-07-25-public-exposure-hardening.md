# Public Exposure Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an Agentistics central safe to publish on the public internet behind a Cloudflare Tunnel, where named people log in with their own e-mail + password.

**Architecture:** Introduce a single, explicit **exposure profile** (`server/exposure.ts`) that every dangerous capability consults, then layer the missing controls around the existing IAM: deny-by-default routing, local-shell kill-switch, per-IP/per-account rate limiting with lockout, strict security headers + CORS allowlist, CSRF origin checks, `__Host-` cookies, TOTP 2FA, audit logging, resource caps, and a hardened container. A `agentop doctor --exposed` preflight refuses to declare the instance ready until every control is on.

**Tech Stack:** Bun (`Bun.serve`, `Bun.password`, `node:crypto`), TypeScript strict, MongoDB driver, React 19 + Vite, Docker Compose, `bun:test`. **No new runtime dependencies** — the machine binary is produced with `bun build --compile` and every added module must survive it.

---

## Global Constraints

- **Language:** all code, comments, docs, and commit messages in **English** (project rule, `CLAUDE.md`).
- **No new runtime dependencies.** TOTP, rate limiting, and CSP are implemented with `node:crypto` and plain TypeScript. `jose` (already present, used by `team-oidc.ts`) is the only crypto dependency allowed.
- **Pure-first:** every decision function (`isExposed`, `checkRateLimit`, `buildCsp`, `originAllowed`, `verifyTotp`, `validatePasswordPolicy`) must be a **pure function in its own module with a `bun:test` unit test**. IO wrappers stay thin. Never mock the filesystem.
- **Server-only:** new modules live in `packages/server/server/` and must never be imported from `packages/web/src/`.
- **Backwards compatible by default:** a solo machine (`AGENTISTICS_TEAM_CENTRAL` unset) keeps today's behaviour exactly — local shell, local chat, no auth. All new restrictions activate from the exposure profile.
- **Every commit must pass** `bun tsc --noEmit && bun test` (the husky pre-commit hook) and use Conventional Commits.
- **Fail closed:** when a new control cannot determine an answer (unknown origin, unresolvable IP, missing secret), the answer is *deny*.

---

## Threat model

**Asset:** the central holds, for every developer and CI runner in the org: project paths, git remotes, session titles and first prompts, token/cost aggregates, machine tokens (hashed), account password hashes, and — when `AGENTISTICS_CENTRAL_USER` is set — read-only mounts of the host's `~/.claude`, `~/.codex`, `~/.gemini`, `~/.copilot`, which contain **raw conversation transcripts**.

**Attackers considered:**
1. **Unauthenticated internet** — scans the tunnel hostname, hits every route, brute-forces login, fuzzes ingest tokens.
2. **Authenticated low-privilege user** — a legitimate `role: 'member'` account (or a stolen one) escalating to owner, to other teams' data, or to the host.
3. **Malicious website in a logged-in user's browser** — CSRF, clickjacking, cross-origin reads.
4. **Compromised member machine** — a leaked machine token pushing forged data or opening the reverse WebSocket.
5. **Supply chain** — a malicious transitive dependency or a tampered base image.

**Out of scope:** a compromised Cloudflare account, a malicious owner, and physical access to the host.

---

## Findings this plan fixes

Line references are to the tree at commit `b83e4d4`.

| # | Severity | Finding | Evidence | Task |
|---|---|---|---|---|
| F1 | **Critical** | `POST /api/exec` runs arbitrary shell (`Bun.spawn(['bash','-c',command])`). On a central any authenticated principal — including `role: 'member'` — gets RCE inside the container, which can read the mounted host transcripts, the Mongo URI, and every env secret. On a non-central machine the auth gate does not run at all → unauthenticated RCE. | `index.ts:756`, `chat-tty.ts:404`, gate at `index.ts:247` (`if (TEAM_CENTRAL && …)`) | T2 |
| F2 | **Critical** | `POST /api/chat-tty` spawns the local `claude`/`codex`/`gemini` CLI with attacker-supplied prompts and attachments, and `ensureMcp()` rewrites `~/.claude.json`. Same blast radius as F1. | `index.ts:617`, `chat-tty.ts:234` | T2 |
| F3 | **High** | The `*-sessions` readers (`/api/claude-sessions`, `/api/codex-sessions`, `/api/gemini-sessions`, `/api/copilot-sessions`, `/api/nay-sessions`) read the **central host's own transcripts** and return full message bodies to any authenticated principal. Team scoping (`team-scope.ts`) does not cover them. | `index.ts:487-580`, `claude-sessions.ts:24` | T2 |
| F4 | **High** | No rate limiting anywhere in the server — no `429` is emitted by any route. `/api/iam/login`, `/api/team/login`, `/api/iam/bootstrap`, `/api/team/whoami` and `/api/team/ingest` accept unlimited guesses. argon2id verification also makes the login endpoint a CPU-exhaustion lever (OWASP API4). | `grep -rn 429` finds nothing outside test fixtures | T4, T5 |
| F5 | **High** | `AGENTISTICS_TEAM_SESSION_SECRET` silently falls back to the dashboard password, so a leaked/shared password lets anyone forge a session cookie for any account. | `config.ts:97` | T10 |
| F6 | **High** | No security headers at all: no CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP. The dashboard is clickjackable and any XSS is unmitigated. | `index.ts` responses only ever carry `CORS_HEADERS` + `Content-Type` | T6 |
| F7 | **High** | `Access-Control-Allow-Origin: *` on every route including `OPTIONS` preflight. Combined with token-authenticated endpoints (`/api/team/whoami`, `/api/team/ingest`) this lets any web page probe the instance from a victim's network. | `index.ts:155` | T7 |
| F8 | **Medium** | No CSRF defence beyond `SameSite=Lax`. Lax does block cross-site `POST` cookies in current browsers, but there is no second line: no `Origin`/`Sec-Fetch-Site` check, and `Lax` was chosen so a top-level `GET` still carries the cookie. | `auth.ts:160` | T8, T9 |
| F9 | **Medium** | Cookie is not `__Host-` prefixed, `SameSite=Lax`, `Secure` only when `AGENTISTICS_TEAM_TLS=1` (easy to forget), 7-day absolute lifetime with **no idle timeout** and no re-auth for sensitive actions. | `auth.ts:28-30,158-161` | T9 |
| F10 | **Medium** | Password policy is `length >= 8`, no blocklist, no MFA. | `bootstrap.ts:54`, `iam-handlers.ts:130,202` | T11, T12 |
| F11 | **Medium** | No audit trail. A successful takeover leaves no record of logins, lockouts, account changes, token mints, or config edits (OWASP A09). | no `audit` collection exists | T13 |
| F12 | **Medium** | No request-size or concurrency limits. `/api/team/ingest` accepts an unbounded JSON body; SSE clients are unbounded; `getRates()` fetches an external URL with no timeout. | `index.ts`, `rates.ts` | T14 |
| F13 | **Low** | Handlers return raw internal errors to the client (`String(err)`, `err.message`), leaking paths, Mongo errors, and stack context (OWASP A10). | `index.ts:604,~318`, many handlers | T15 |
| F14 | **Medium** | The compose file publishes the app on `0.0.0.0` by default, the container runs as **root**, has no `cap_drop`/`no-new-privileges`/read-only rootfs, and always bind-mounts the host's four harness directories even when `AGENTISTICS_CENTRAL_USER` is unset. Bundled Mongo runs with **no authentication** (only unpublished). | `docker-compose.yml`, `docker-compose.localdb.yml`, `Dockerfile` | T17 |
| F15 | **Low** | `index.html` loads Google Fonts from two external origins, which forces a looser CSP and leaks visitor IPs to a third party. | `packages/web/index.html:15-17` | T6 |
| F16 | **Low** | No dependency audit, no pinned base image digest, no SBOM (OWASP A03). | `Dockerfile`, `.github/workflows/` | T19 |

---

## File structure

**New server modules** (`packages/server/server/`):

| File | Responsibility |
|---|---|
| `exposure.ts` | Pure: resolve the exposure profile (`local` \| `lan` \| `public`) and the capability flags derived from it. Single source of truth consulted by every guard. |
| `exposure.test.ts` | Unit tests for the profile matrix. |
| `client-ip.ts` | Pure: resolve the real client IP from socket address + trusted proxy headers. |
| `client-ip.test.ts` | Unit tests, including spoofed-header cases. |
| `rate-limit.ts` | Pure fixed-window counters + progressive lockout state machine, plus a thin in-memory store. |
| `rate-limit.test.ts` | Unit tests for the window/lockout math. |
| `security-headers.ts` | Pure: build the security-header set and the CSP string for a given profile. |
| `security-headers.test.ts` | Unit tests. |
| `cors.ts` | Pure: origin allowlist evaluation + preflight header builder. |
| `cors.test.ts` | Unit tests. |
| `csrf.ts` | Pure: `Origin`/`Sec-Fetch-Site` verdict for unsafe methods. |
| `csrf.test.ts` | Unit tests. |
| `password-policy.ts` | Pure: password validation + embedded common-password blocklist. |
| `password-policy.test.ts` | Unit tests. |
| `totp.ts` | Pure: RFC 6238 TOTP + base32 + recovery-code hashing, via `node:crypto`. |
| `totp.test.ts` | Unit tests with RFC 6238 vectors. |
| `mfa-store.ts` | Mongo IO for per-account TOTP secrets and recovery codes. |
| `audit.ts` | Append-only audit log writer + owner-only reader. |
| `audit.test.ts` | Unit tests for the pure event builder. |
| `errors.ts` | Pure: map an internal error to a client-safe `{ error, ref }` payload. |
| `errors.test.ts` | Unit tests. |
| `limits.ts` | Pure: body-size and payload caps + the `readJsonLimited` helper. |
| `limits.test.ts` | Unit tests. |
| `preflight.ts` | Pure: the go-live checklist evaluator used by `agentop doctor`. |
| `preflight.test.ts` | Unit tests. |
| `cli-doctor.ts` | `agentop doctor [--exposed]` command handler. |

**Modified:**

| File | Change |
|---|---|
| `packages/server/server/config.ts` | New env constants; session-secret fallback removed. |
| `packages/server/server/index.ts` | Wire the gate: exposure guards, rate limit, CSRF, headers, CORS, error hygiene, `Bun.serve` limits. |
| `packages/server/server/auth.ts` | `__Host-` cookie, `SameSite=Strict`, idle timeout, MFA-aware login. |
| `packages/server/server/iam-handlers.ts` | Password policy, MFA challenge, audit calls. |
| `packages/server/server/bootstrap.ts` | Password policy reuse. |
| `packages/server/bin/cli.ts` | Register `doctor`. |
| `packages/web/src/components/TtyChat.tsx` | Hide local-shell UI when the server reports the capability off. |
| `packages/web/src/hooks/useData.ts` | Read `capabilities` from `/api/team/session`. |
| `packages/web/index.html` | Self-hosted font, no external origins. |
| `Dockerfile`, `docker-compose.yml`, `docker-compose.localdb.yml` | Non-root, read-only rootfs, dropped caps, loopback bind, Mongo auth. |
| `docs/exposure.md` (new) | The operator runbook for Cloudflare Tunnel + Access. |
| `.github/workflows/ci.yml` | `bun audit` + image digest pin. |

---

## Task ordering

T1 → T2 close the critical hole and must land first; they are independently deployable. T3–T9 are the network-facing controls. T10–T13 are identity. T14–T16 are robustness. T17–T19 are deployment. Nothing after T2 depends on a task more than two positions earlier, so T3+ can be parallelised across agents.

---

### Task 1: Exposure profile — the single source of truth

**Files:**
- Create: `packages/server/server/exposure.ts`
- Test: `packages/server/server/exposure.test.ts`
- Modify: `packages/server/server/config.ts` (append the new env reads)

**Interfaces:**
- Consumes: nothing.
- Produces: `type ExposureProfile = 'local' | 'lan' | 'public'`; `resolveProfile(env: ExposureEnv): ExposureProfile`; `capabilitiesFor(profile: ExposureProfile, env: ExposureEnv): Capabilities`; `interface Capabilities { localShell: boolean; localChat: boolean; localTranscripts: boolean; mcpAdmin: boolean; requireMfaForOwner: boolean; requireSecureCookies: boolean }`; runtime singletons `PROFILE` and `CAPS`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/exposure.test.ts
import { describe, expect, it } from 'bun:test'
import { resolveProfile, capabilitiesFor, type ExposureEnv } from './exposure'

const base: ExposureEnv = { central: false, exposure: undefined, allowLocalShell: false, tls: false }

describe('resolveProfile', () => {
  it('defaults to local for a solo machine', () => {
    expect(resolveProfile(base)).toBe('local')
  })

  it('defaults to lan for a central with no explicit setting', () => {
    expect(resolveProfile({ ...base, central: true })).toBe('lan')
  })

  it('honours an explicit AGENTISTICS_EXPOSURE=public', () => {
    expect(resolveProfile({ ...base, central: true, exposure: 'public' })).toBe('public')
  })

  it('rejects an unknown value by failing closed to public', () => {
    expect(resolveProfile({ ...base, central: true, exposure: 'banana' })).toBe('public')
  })
})

describe('capabilitiesFor', () => {
  it('grants every local capability on a local profile', () => {
    const caps = capabilitiesFor('local', base)
    expect(caps.localShell).toBe(true)
    expect(caps.localChat).toBe(true)
    expect(caps.localTranscripts).toBe(true)
    expect(caps.mcpAdmin).toBe(true)
  })

  it('revokes local shell, chat, transcripts and mcp admin on public', () => {
    const caps = capabilitiesFor('public', { ...base, central: true, exposure: 'public' })
    expect(caps.localShell).toBe(false)
    expect(caps.localChat).toBe(false)
    expect(caps.localTranscripts).toBe(false)
    expect(caps.mcpAdmin).toBe(false)
  })

  it('never re-enables local shell on public even with the opt-in flag', () => {
    const caps = capabilitiesFor('public', { ...base, central: true, exposure: 'public', allowLocalShell: true })
    expect(caps.localShell).toBe(false)
  })

  it('re-enables local shell on lan only with the explicit opt-in', () => {
    expect(capabilitiesFor('lan', { ...base, central: true }).localShell).toBe(false)
    expect(capabilitiesFor('lan', { ...base, central: true, allowLocalShell: true }).localShell).toBe(true)
  })

  it('requires owner MFA and secure cookies on public', () => {
    const caps = capabilitiesFor('public', { ...base, central: true, exposure: 'public' })
    expect(caps.requireMfaForOwner).toBe(true)
    expect(caps.requireSecureCookies).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/exposure.test.ts`
Expected: FAIL — `Cannot find module './exposure'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/exposure.ts
/**
 * exposure.ts — the single source of truth for "how reachable is this instance?".
 * Every dangerous capability (local shell, local chat, host transcript reads, MCP admin)
 * asks this module instead of re-deriving the answer from env vars. Pure + unit-tested;
 * the runtime singletons at the bottom are the only IO.
 *
 * Profiles:
 *   local  — solo machine on 127.0.0.1. Full local power, no auth (today's behaviour).
 *   lan    — a central reachable from a trusted network (LAN/Tailscale). Auth on, local
 *            power off unless explicitly opted in.
 *   public — a central published on the internet. Local power is unavailable, period.
 *
 * Fail-closed: an unrecognised AGENTISTICS_EXPOSURE value resolves to `public`.
 */

export type ExposureProfile = 'local' | 'lan' | 'public'

export interface ExposureEnv {
  central: boolean
  exposure: string | undefined
  allowLocalShell: boolean
  tls: boolean
}

export interface Capabilities {
  /** POST /api/exec — arbitrary shell on the host. */
  localShell: boolean
  /** POST /api/chat-tty — spawns a coding-assistant CLI on the host. */
  localChat: boolean
  /** GET /api/{claude,codex,gemini,copilot,nay}-sessions — reads host transcripts. */
  localTranscripts: boolean
  /** POST /api/mcp-action — mutates the host's ~/.claude.json. */
  mcpAdmin: boolean
  /** Owner accounts must have TOTP enrolled before they can log in. */
  requireMfaForOwner: boolean
  /** Session cookies must carry Secure + the __Host- prefix. */
  requireSecureCookies: boolean
}

export function resolveProfile(env: ExposureEnv): ExposureProfile {
  if (env.exposure === undefined || env.exposure === '') return env.central ? 'lan' : 'local'
  if (env.exposure === 'local' || env.exposure === 'lan' || env.exposure === 'public') return env.exposure
  return 'public' // unknown value → most restrictive
}

export function capabilitiesFor(profile: ExposureProfile, env: ExposureEnv): Capabilities {
  if (profile === 'local') {
    return {
      localShell: true,
      localChat: true,
      localTranscripts: true,
      mcpAdmin: true,
      requireMfaForOwner: false,
      requireSecureCookies: false,
    }
  }
  if (profile === 'lan') {
    return {
      localShell: env.allowLocalShell,
      localChat: env.allowLocalShell,
      localTranscripts: env.allowLocalShell,
      mcpAdmin: env.allowLocalShell,
      requireMfaForOwner: false,
      requireSecureCookies: env.tls,
    }
  }
  return {
    localShell: false,
    localChat: false,
    localTranscripts: false,
    mcpAdmin: false,
    requireMfaForOwner: true,
    requireSecureCookies: true,
  }
}

// --- runtime singletons -----------------------------------------------------

const ENV: ExposureEnv = {
  central: process.env.AGENTISTICS_TEAM_CENTRAL === '1',
  exposure: process.env.AGENTISTICS_EXPOSURE,
  allowLocalShell: process.env.AGENTISTICS_ALLOW_LOCAL_SHELL === '1',
  tls: process.env.AGENTISTICS_TEAM_TLS === '1',
}

export const PROFILE: ExposureProfile = resolveProfile(ENV)
export const CAPS: Capabilities = capabilitiesFor(PROFILE, ENV)
export const EXPOSURE_ENV: ExposureEnv = ENV
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/exposure.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Document the new env vars in `config.ts`**

Append to `packages/server/server/config.ts`:

```ts
// ---------------------------------------------------------------------------
// Exposure profile (see exposure.ts). AGENTISTICS_EXPOSURE=local|lan|public.
// Unset → 'lan' on a central, 'local' otherwise. An unknown value fails closed to 'public'.
// AGENTISTICS_ALLOW_LOCAL_SHELL=1 re-enables /api/exec, /api/chat-tty, the host transcript
// readers and /api/mcp-action on a 'lan' central. It is IGNORED on 'public'.
// ---------------------------------------------------------------------------
export const EXPOSURE = process.env.AGENTISTICS_EXPOSURE
export const ALLOW_LOCAL_SHELL = process.env.AGENTISTICS_ALLOW_LOCAL_SHELL === '1'
```

- [ ] **Step 6: Verify the whole suite still passes**

Run: `bun tsc --noEmit && bun test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/exposure.ts packages/server/server/exposure.test.ts packages/server/server/config.ts
git commit -m "feat(server): exposure profile as the single source of truth for local capabilities"
```

---

### Task 2: Kill local shell, local chat, host transcripts and MCP admin when exposed

Closes **F1, F2, F3**. This is the task that makes exposure survivable; nothing else in the plan matters if this one is skipped.

**Files:**
- Modify: `packages/server/server/index.ts` (routes `/api/exec`, `/api/chat-tty`, `/api/chat-harnesses`, `/api/mcp-list`, `/api/mcp-action`, `/api/nay-sessions*`, `/api/claude-sessions*`, `/api/codex-sessions*`, `/api/gemini-sessions*`, `/api/copilot-sessions*`, `/api/projects-list`)
- Modify: `packages/server/server/auth.ts` (`handleSession` publishes the capability flags)
- Create: `packages/server/server/capability-guard.ts`
- Test: `packages/server/server/capability-guard.test.ts`
- Modify: `packages/web/src/components/TtyChat.tsx`

**Interfaces:**
- Consumes: `CAPS`, `Capabilities` from `exposure.ts` (Task 1).
- Produces: `capabilityDenied(cap: keyof Capabilities, caps?: Capabilities): Response | null` — returns a ready `403` Response when the capability is off, or `null` when the call may proceed; `LOCAL_ONLY_ROUTES: ReadonlyMap<string, keyof Capabilities>`; `routeCapability(pathname: string): keyof Capabilities | null`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/capability-guard.test.ts
import { describe, expect, it } from 'bun:test'
import { routeCapability, capabilityDenied } from './capability-guard'
import { capabilitiesFor } from './exposure'

const publicCaps = capabilitiesFor('public', { central: true, exposure: 'public', allowLocalShell: true, tls: true })
const localCaps = capabilitiesFor('local', { central: false, exposure: undefined, allowLocalShell: false, tls: false })

describe('routeCapability', () => {
  it('maps the shell route', () => {
    expect(routeCapability('/api/exec')).toBe('localShell')
  })

  it('maps the local chat route', () => {
    expect(routeCapability('/api/chat-tty')).toBe('localChat')
  })

  it('maps every host transcript reader, including detail sub-paths', () => {
    expect(routeCapability('/api/claude-sessions')).toBe('localTranscripts')
    expect(routeCapability('/api/claude-sessions/abc-123')).toBe('localTranscripts')
    expect(routeCapability('/api/codex-sessions/x')).toBe('localTranscripts')
    expect(routeCapability('/api/gemini-sessions')).toBe('localTranscripts')
    expect(routeCapability('/api/copilot-sessions/y')).toBe('localTranscripts')
    expect(routeCapability('/api/nay-sessions')).toBe('localTranscripts')
  })

  it('maps the mcp admin routes', () => {
    expect(routeCapability('/api/mcp-action')).toBe('mcpAdmin')
    expect(routeCapability('/api/mcp-list')).toBe('mcpAdmin')
  })

  it('returns null for ordinary metric routes', () => {
    expect(routeCapability('/api/data')).toBeNull()
    expect(routeCapability('/api/tags/abc')).toBeNull()
  })

  it('does not match a route that merely starts with the same characters', () => {
    expect(routeCapability('/api/execute-order-66')).toBeNull()
  })
})

describe('capabilityDenied', () => {
  it('returns null when the capability is granted', () => {
    expect(capabilityDenied('localShell', localCaps)).toBeNull()
  })

  it('returns a 403 with a stable code when the capability is revoked', async () => {
    const res = capabilityDenied('localShell', publicCaps)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'capability_disabled', capability: 'localShell' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/capability-guard.test.ts`
Expected: FAIL — `Cannot find module './capability-guard'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/capability-guard.ts
/**
 * capability-guard.ts — maps a request path to the local capability it needs, and turns a
 * revoked capability into a 403. Kept separate from index.ts so the mapping is unit-testable
 * and so a newly added local-power route is a one-line registration instead of a scattered if.
 *
 * SECURITY: these routes execute shell commands, spawn coding-assistant CLIs, read the host's
 * raw conversation transcripts, or rewrite ~/.claude.json. They must be unreachable on an
 * internet-exposed instance regardless of who is authenticated.
 */
import { CAPS, type Capabilities } from './exposure'

/** Exact path → capability. Detail sub-paths are handled by the prefix table below. */
const EXACT: ReadonlyMap<string, keyof Capabilities> = new Map([
  ['/api/exec', 'localShell'],
  ['/api/chat-tty', 'localChat'],
  ['/api/chat-harnesses', 'localChat'],
  ['/api/mcp-list', 'mcpAdmin'],
  ['/api/mcp-action', 'mcpAdmin'],
  ['/api/projects-list', 'localTranscripts'],
])

/** Prefix (without trailing slash) → capability. Matches `<prefix>` and `<prefix>/…`. */
const PREFIXES: ReadonlyArray<readonly [string, keyof Capabilities]> = [
  ['/api/claude-sessions', 'localTranscripts'],
  ['/api/codex-sessions', 'localTranscripts'],
  ['/api/gemini-sessions', 'localTranscripts'],
  ['/api/copilot-sessions', 'localTranscripts'],
  ['/api/nay-sessions', 'localTranscripts'],
]

export function routeCapability(pathname: string): keyof Capabilities | null {
  const exact = EXACT.get(pathname)
  if (exact) return exact
  for (const [prefix, cap] of PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return cap
  }
  return null
}

export function capabilityDenied(
  cap: keyof Capabilities,
  caps: Capabilities = CAPS,
): Response | null {
  if (caps[cap]) return null
  return new Response(JSON.stringify({ error: 'capability_disabled', capability: cap }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/capability-guard.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Wire the guard into the request pipeline**

In `packages/server/server/index.ts`, add the import next to the other server imports:

```ts
import { CAPS } from './exposure'
import { routeCapability, capabilityDenied } from './capability-guard'
```

Then insert the guard **immediately after** the `INGEST_ONLY` block and **before** the auth gate (currently `index.ts:247`):

```ts
    // ---------------------------------------------------------------------------
    // Local-capability guard. Routes that execute shell commands, spawn CLIs, read
    // the host's raw transcripts, or edit ~/.claude.json are unreachable whenever the
    // exposure profile revokes the capability — checked BEFORE auth, so an exposed
    // instance never even reveals whether the caller is authenticated.
    // ---------------------------------------------------------------------------
    {
      const needed = routeCapability(url.pathname)
      if (needed) {
        const denied = capabilityDenied(needed)
        if (denied) {
          return new Response(denied.body, {
            status: denied.status,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
      }
    }
```

- [ ] **Step 6: Publish the capability flags to the frontend**

In `packages/server/server/auth.ts`, extend `handleSession` (it is already public and already the SPA's bootstrap call):

```ts
export function handleSession(req: Request): Response {
  const required = Boolean(TEAM_PASSWORD)
  const authed = isAuthed(req)
  const aggregatorOnly = TEAM_CENTRAL && !CENTRAL_USER
  return new Response(
    JSON.stringify({
      authed,
      required,
      central: TEAM_CENTRAL,
      aggregatorOnly,
      profile: PROFILE,
      capabilities: {
        localShell: CAPS.localShell,
        localChat: CAPS.localChat,
        localTranscripts: CAPS.localTranscripts,
        mcpAdmin: CAPS.mcpAdmin,
      },
    }),
    { status: 200, headers: JSON_CT },
  )
}
```

Add the import at the top of `auth.ts`:

```ts
import { CAPS, PROFILE } from './exposure'
```

- [ ] **Step 7: Hide the local-shell UI in the web app**

In `packages/web/src/components/TtyChat.tsx`, guard both call sites. Read the flags from the session payload the app already fetches (`/api/team/session`) and store them in `AppContext` as `capabilities`. At the top of the component:

```tsx
  // Local shell / local chat are host-power features. An exposed central revokes them
  // server-side (403 capability_disabled); hide the affordance so the UI never offers
  // an action that cannot work.
  const canRunShell = ctx.capabilities?.localShell !== false
  const canRunChat = ctx.capabilities?.localChat !== false
```

Wrap the send handlers so they early-return when the capability is off, and render an inline notice instead of the composer:

```tsx
  if (!canRunChat) {
    return (
      <div style={{ padding: 24, opacity: 0.75, fontSize: 14 }}>
        {t('chat.disabledOnCentral')}
      </div>
    )
  }
```

Add `chat.disabledOnCentral` to both locales in `packages/core/src/i18n.ts`:

```ts
  'chat.disabledOnCentral': {
    en: 'Local assistant chat is disabled on this instance because it is reachable outside this machine.',
    pt: 'O chat local está desativado nesta instância porque ela é acessível fora desta máquina.',
  },
```

- [ ] **Step 8: Verify end to end**

Run: `bun tsc --noEmit && bun test`
Expected: PASS.

Then, manually, in one terminal:

```bash
AGENTISTICS_TEAM_CENTRAL=1 AGENTISTICS_EXPOSURE=public bun run packages/server/server/index.ts
```

and in another:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:47291/api/exec \
  -H 'Content-Type: application/json' -d '{"command":"id"}'
curl -s -o /dev/null -w '%{http_code}\n' localhost:47291/api/claude-sessions
```

Expected: `403` for both. Repeat with `AGENTISTICS_EXPOSURE` unset and `AGENTISTICS_TEAM_CENTRAL` unset — expected `200` (local profile keeps today's behaviour).

- [ ] **Step 9: Commit**

```bash
git add packages/server/server/capability-guard.ts packages/server/server/capability-guard.test.ts \
        packages/server/server/index.ts packages/server/server/auth.ts \
        packages/web/src/components/TtyChat.tsx packages/core/src/i18n.ts
git commit -m "fix(server): revoke local shell, chat, transcript and mcp routes on exposed instances"
```

---

### Task 3: Trustworthy client IP resolution

Rate limiting and audit logging are worthless if the key is spoofable. Behind Cloudflare, the socket address is a Cloudflare IP and the real client is in `CF-Connecting-IP` — which must only be trusted when we know we are behind that proxy.

**Files:**
- Create: `packages/server/server/client-ip.ts`
- Test: `packages/server/server/client-ip.test.ts`
- Modify: `packages/server/server/config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveClientIp(input: { socketAddress: string | null; headers: Headers; trustProxy: boolean }): string`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/client-ip.test.ts
import { describe, expect, it } from 'bun:test'
import { resolveClientIp } from './client-ip'

const h = (o: Record<string, string>) => new Headers(o)

describe('resolveClientIp', () => {
  it('uses the socket address when the proxy is not trusted', () => {
    const ip = resolveClientIp({
      socketAddress: '10.0.0.5',
      headers: h({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }),
      trustProxy: false,
    })
    expect(ip).toBe('10.0.0.5')
  })

  it('prefers CF-Connecting-IP when the proxy is trusted', () => {
    const ip = resolveClientIp({
      socketAddress: '172.71.0.1',
      headers: h({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }),
      trustProxy: true,
    })
    expect(ip).toBe('1.2.3.4')
  })

  it('falls back to the left-most X-Forwarded-For entry when trusted', () => {
    const ip = resolveClientIp({
      socketAddress: '172.71.0.1',
      headers: h({ 'x-forwarded-for': '  9.9.9.9 , 8.8.8.8 ' }),
      trustProxy: true,
    })
    expect(ip).toBe('9.9.9.9')
  })

  it('ignores a malformed forwarded value and falls back to the socket', () => {
    const ip = resolveClientIp({
      socketAddress: '172.71.0.1',
      headers: h({ 'cf-connecting-ip': 'not-an-ip' }),
      trustProxy: true,
    })
    expect(ip).toBe('172.71.0.1')
  })

  it('returns the fail-closed sentinel when nothing is resolvable', () => {
    expect(resolveClientIp({ socketAddress: null, headers: h({}), trustProxy: false })).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/client-ip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/client-ip.ts
/**
 * client-ip.ts — resolve the caller's IP for rate limiting and audit logging.
 *
 * SECURITY: forwarded headers are attacker-controlled unless a proxy we trust rewrites them.
 * `trustProxy` is opt-in via AGENTISTICS_TRUST_PROXY=1 and must ONLY be enabled when the app
 * is unreachable except through that proxy (e.g. cloudflared on the same host, app bound to
 * 127.0.0.1). With it off we always use the socket address.
 */

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6 = /^[0-9a-fA-F:]{2,45}$/

function validIp(value: string | undefined | null): string | null {
  if (!value) return null
  const v = value.trim()
  if (IPV4.test(v)) return v
  if (v.includes(':') && IPV6.test(v)) return v
  return null
}

export function resolveClientIp(input: {
  socketAddress: string | null
  headers: Headers
  trustProxy: boolean
}): string {
  if (input.trustProxy) {
    const cf = validIp(input.headers.get('cf-connecting-ip'))
    if (cf) return cf
    const xff = input.headers.get('x-forwarded-for')
    if (xff) {
      const first = validIp(xff.split(',')[0])
      if (first) return first
    }
  }
  return validIp(input.socketAddress) ?? 'unknown'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/client-ip.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the env constant**

Append to `packages/server/server/config.ts`:

```ts
// Trust CF-Connecting-IP / X-Forwarded-For. Enable ONLY when the app is reachable exclusively
// through a proxy that rewrites them (cloudflared on the same host + BIND_IP=127.0.0.1).
export const TRUST_PROXY = process.env.AGENTISTICS_TRUST_PROXY === '1'
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/client-ip.ts packages/server/server/client-ip.test.ts packages/server/server/config.ts
git commit -m "feat(server): spoof-resistant client IP resolution behind a trusted proxy"
```

---

### Task 4: Rate-limit core (pure)

Closes half of **F4**. OWASP recommends locking an account after 5–10 failed attempts with a timed auto-unlock, while avoiding lockout-as-DoS — so the account key uses a *soft* backoff (delay grows, never permanent) and the IP key does the hard blocking.

**Files:**
- Create: `packages/server/server/rate-limit.ts`
- Test: `packages/server/server/rate-limit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Bucket { count: number; windowStart: number; strikes: number; blockedUntil: number }`
  - `interface RateRule { limit: number; windowMs: number; blockMs: number; backoff: boolean }`
  - `evaluate(bucket: Bucket | undefined, rule: RateRule, nowMs: number): { allowed: boolean; retryAfterSec: number; next: Bucket }`
  - `registerFailure(bucket: Bucket, rule: RateRule, nowMs: number): Bucket`
  - `RULES: Record<'login' | 'token' | 'api' | 'ingest', RateRule>`
  - `class MemoryLimiter { check(key: string, rule: RateRule, nowMs?: number): { allowed: boolean; retryAfterSec: number }; fail(key: string, rule: RateRule, nowMs?: number): void; reset(key: string): void; sweep(nowMs?: number): void }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/rate-limit.test.ts
import { describe, expect, it } from 'bun:test'
import { evaluate, registerFailure, MemoryLimiter, RULES, type Bucket, type RateRule } from './rate-limit'

const rule: RateRule = { limit: 3, windowMs: 60_000, blockMs: 300_000, backoff: true }
const t0 = 1_000_000

describe('evaluate', () => {
  it('allows the first request and starts a window', () => {
    const r = evaluate(undefined, rule, t0)
    expect(r.allowed).toBe(true)
    expect(r.next.count).toBe(1)
    expect(r.next.windowStart).toBe(t0)
  })

  it('allows up to the limit inside one window', () => {
    let b: Bucket | undefined
    for (let i = 0; i < rule.limit; i++) {
      const r = evaluate(b, rule, t0)
      expect(r.allowed).toBe(true)
      b = r.next
    }
    expect(b!.count).toBe(3)
  })

  it('blocks the request past the limit and reports Retry-After', () => {
    let b: Bucket | undefined
    for (let i = 0; i < rule.limit; i++) b = evaluate(b, rule, t0).next
    const r = evaluate(b, rule, t0)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThan(0)
  })

  it('starts a fresh window once the old one elapsed', () => {
    let b: Bucket | undefined
    for (let i = 0; i < rule.limit; i++) b = evaluate(b, rule, t0).next
    const r = evaluate(b, rule, t0 + rule.windowMs + 1)
    expect(r.allowed).toBe(true)
    expect(r.next.count).toBe(1)
  })

  it('keeps blocking while blockedUntil is in the future', () => {
    const blocked: Bucket = { count: 0, windowStart: t0, strikes: 1, blockedUntil: t0 + 10_000 }
    const r = evaluate(blocked, rule, t0 + 5_000)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBe(5)
  })

  it('releases the block once it expires', () => {
    const blocked: Bucket = { count: 99, windowStart: t0, strikes: 1, blockedUntil: t0 + 10_000 }
    const r = evaluate(blocked, rule, t0 + 10_001)
    expect(r.allowed).toBe(true)
  })
})

describe('registerFailure', () => {
  it('doubles the block on each strike when backoff is on', () => {
    let b: Bucket = { count: 0, windowStart: t0, strikes: 0, blockedUntil: 0 }
    b = registerFailure(b, rule, t0)
    const first = b.blockedUntil - t0
    b = registerFailure(b, rule, t0)
    const second = b.blockedUntil - t0
    expect(second).toBe(first * 2)
  })

  it('caps the block at 24h', () => {
    let b: Bucket = { count: 0, windowStart: t0, strikes: 0, blockedUntil: 0 }
    for (let i = 0; i < 40; i++) b = registerFailure(b, rule, t0)
    expect(b.blockedUntil - t0).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })
})

describe('MemoryLimiter', () => {
  it('isolates keys from each other', () => {
    const l = new MemoryLimiter()
    for (let i = 0; i < rule.limit; i++) l.check('a', rule, t0)
    expect(l.check('a', rule, t0).allowed).toBe(false)
    expect(l.check('b', rule, t0).allowed).toBe(true)
  })

  it('clears a key on reset (successful login)', () => {
    const l = new MemoryLimiter()
    l.fail('a', rule, t0)
    l.reset('a')
    expect(l.check('a', rule, t0).allowed).toBe(true)
  })

  it('sweeps expired buckets so memory cannot grow without bound', () => {
    const l = new MemoryLimiter()
    l.check('a', rule, t0)
    l.sweep(t0 + 25 * 60 * 60 * 1000)
    expect(l.size()).toBe(0)
  })
})

describe('RULES', () => {
  it('uses OWASP-aligned login limits (5 attempts, 15m window)', () => {
    expect(RULES.login.limit).toBe(5)
    expect(RULES.login.windowMs).toBe(15 * 60_000)
    expect(RULES.login.backoff).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/rate-limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/rate-limit.ts
/**
 * rate-limit.ts — fixed-window counters plus a progressive-backoff block, in memory.
 *
 * The math (evaluate / registerFailure) is pure and unit-tested; MemoryLimiter is the thin
 * process-local store. Process-local is deliberate: a central is a single container, and a
 * shared store would add a Mongo round-trip to every request on the hot path. If the central is
 * ever scaled horizontally, put the edge limiter (Cloudflare WAF) in front — see docs/exposure.md.
 *
 * Two key shapes are used by callers:
 *   ip:<addr>:<route>       — hard blocking; stops distributed guessing of one account.
 *   acct:<emailLower>       — soft backoff; slows credential stuffing without letting an attacker
 *                             lock a colleague out permanently (OWASP lockout-as-DoS caveat).
 */

export interface Bucket {
  count: number
  windowStart: number
  strikes: number
  blockedUntil: number
}

export interface RateRule {
  /** Allowed events per window. */
  limit: number
  /** Window length in ms. */
  windowMs: number
  /** Base block length in ms applied on the first strike. */
  blockMs: number
  /** Double the block on each subsequent strike (capped at 24h). */
  backoff: boolean
}

const MAX_BLOCK_MS = 24 * 60 * 60 * 1000

export const RULES: Record<'login' | 'token' | 'api' | 'ingest', RateRule> = {
  // 5 failed logins per 15 minutes, then a 15-minute block that doubles per strike.
  login: { limit: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000, backoff: true },
  // Bearer-token guessing (whoami / agent upgrade): tighter, no window forgiveness.
  token: { limit: 10, windowMs: 5 * 60_000, blockMs: 30 * 60_000, backoff: true },
  // Generic authenticated API ceiling — generous; exists only to blunt scraping.
  api: { limit: 600, windowMs: 60_000, blockMs: 60_000, backoff: false },
  // Ingest is machine traffic; the central owns the push interval (>=5s), so 60/min is ample.
  ingest: { limit: 60, windowMs: 60_000, blockMs: 5 * 60_000, backoff: false },
}

function emptyBucket(nowMs: number): Bucket {
  return { count: 0, windowStart: nowMs, strikes: 0, blockedUntil: 0 }
}

export function evaluate(
  bucket: Bucket | undefined,
  rule: RateRule,
  nowMs: number,
): { allowed: boolean; retryAfterSec: number; next: Bucket } {
  const b = bucket ? { ...bucket } : emptyBucket(nowMs)

  if (b.blockedUntil > nowMs) {
    return { allowed: false, retryAfterSec: Math.ceil((b.blockedUntil - nowMs) / 1000), next: b }
  }
  if (nowMs - b.windowStart >= rule.windowMs) {
    b.windowStart = nowMs
    b.count = 0
  }
  if (b.count >= rule.limit) {
    const retryMs = rule.windowMs - (nowMs - b.windowStart)
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)), next: b }
  }
  b.count += 1
  return { allowed: true, retryAfterSec: 0, next: b }
}

export function registerFailure(bucket: Bucket, rule: RateRule, nowMs: number): Bucket {
  const b = { ...bucket }
  b.strikes += 1
  const factor = rule.backoff ? 2 ** (b.strikes - 1) : 1
  const blockMs = Math.min(rule.blockMs * factor, MAX_BLOCK_MS)
  b.blockedUntil = nowMs + blockMs
  return b
}

export class MemoryLimiter {
  private buckets = new Map<string, Bucket>()

  check(key: string, rule: RateRule, nowMs: number = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const r = evaluate(this.buckets.get(key), rule, nowMs)
    this.buckets.set(key, r.next)
    return { allowed: r.allowed, retryAfterSec: r.retryAfterSec }
  }

  fail(key: string, rule: RateRule, nowMs: number = Date.now()): void {
    const current = this.buckets.get(key) ?? { count: 0, windowStart: nowMs, strikes: 0, blockedUntil: 0 }
    this.buckets.set(key, registerFailure(current, rule, nowMs))
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  size(): number {
    return this.buckets.size
  }

  /** Drop buckets that are neither blocked nor inside a live window. Called on an interval. */
  sweep(nowMs: number = Date.now()): void {
    for (const [key, b] of this.buckets) {
      const idle = nowMs - b.windowStart > MAX_BLOCK_MS
      if (b.blockedUntil <= nowMs && idle) this.buckets.delete(key)
    }
  }
}

/** Process-wide limiter shared by every route. */
export const limiter = new MemoryLimiter()
setInterval(() => limiter.sweep(), 10 * 60_000).unref?.()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/rate-limit.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/rate-limit.ts packages/server/server/rate-limit.test.ts
git commit -m "feat(server): fixed-window rate limiter with progressive backoff"
```

---

### Task 5: Apply rate limits to authentication and ingest

Closes the rest of **F4**.

**Files:**
- Modify: `packages/server/server/index.ts`
- Modify: `packages/server/server/iam-handlers.ts` (`handleIamLogin` takes a failure callback)
- Test: `packages/server/server/rate-limit-wiring.test.ts`

**Interfaces:**
- Consumes: `limiter`, `RULES` (Task 4), `resolveClientIp` (Task 3).
- Produces: `tooManyRequests(retryAfterSec: number): Response` exported from `rate-limit.ts`; `handleIamLogin(req, hooks?: { onFailure?: (emailLower: string) => void; onSuccess?: (accountId: string) => void })`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/rate-limit-wiring.test.ts
import { describe, expect, it } from 'bun:test'
import { tooManyRequests, RULES, MemoryLimiter } from './rate-limit'

describe('tooManyRequests', () => {
  it('is a 429 carrying Retry-After and a stable code', async () => {
    const res = tooManyRequests(42)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(await res.json()).toEqual({ error: 'rate_limited', retryAfterSec: 42 })
  })
})

describe('login limiting policy', () => {
  it('blocks the 6th attempt from one IP against one account', () => {
    const l = new MemoryLimiter()
    const t = 1_000
    const key = 'ip:1.2.3.4:login'
    for (let i = 0; i < 5; i++) expect(l.check(key, RULES.login, t).allowed).toBe(true)
    expect(l.check(key, RULES.login, t).allowed).toBe(false)
  })

  it('a successful login clears the counter for that IP', () => {
    const l = new MemoryLimiter()
    const t = 1_000
    const key = 'ip:1.2.3.4:login'
    for (let i = 0; i < 5; i++) l.check(key, RULES.login, t)
    l.reset(key)
    expect(l.check(key, RULES.login, t).allowed).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/rate-limit-wiring.test.ts`
Expected: FAIL — `tooManyRequests` is not exported.

- [ ] **Step 3: Add the response helper**

Append to `packages/server/server/rate-limit.ts`:

```ts
/** Canonical 429. Callers spread CORS_HEADERS over it. */
export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: 'rate_limited', retryAfterSec }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) },
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/rate-limit-wiring.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the limiter into `index.ts`**

Add the imports:

```ts
import { limiter, RULES, tooManyRequests } from './rate-limit'
import { resolveClientIp } from './client-ip'
import { TRUST_PROXY } from './config'
```

Immediately after the `url.pathname` normalisation, resolve the IP once per request:

```ts
    const clientIp = resolveClientIp({
      socketAddress: server.requestIP(req)?.address ?? null,
      headers: req.headers,
      trustProxy: TRUST_PROXY,
    })
```

Insert the limiter **after** the capability guard and **before** the auth gate:

```ts
    // ---------------------------------------------------------------------------
    // Rate limiting. Auth endpoints get the strict rule keyed by IP; token-bearing
    // endpoints get their own; everything else under /api gets a generous ceiling so a
    // single client cannot scrape the whole dataset in a loop. `unknown` IPs share one
    // bucket on purpose — fail closed.
    // ---------------------------------------------------------------------------
    if (url.pathname.startsWith('/api/')) {
      const rule =
        url.pathname === '/api/iam/login' || url.pathname === '/api/team/login' || url.pathname === '/api/iam/bootstrap'
          ? RULES.login
          : url.pathname === '/api/team/whoami' || url.pathname === '/api/team/agent'
            ? RULES.token
            : url.pathname === '/api/team/ingest'
              ? RULES.ingest
              : RULES.api
      const verdict = limiter.check(`ip:${clientIp}:${rule === RULES.api ? 'api' : url.pathname}`, rule)
      if (!verdict.allowed) {
        const res = tooManyRequests(verdict.retryAfterSec)
        return new Response(res.body, { status: 429, headers: { ...CORS_HEADERS, ...Object.fromEntries(res.headers) } })
      }
    }
```

- [ ] **Step 6: Add the per-account soft backoff**

In `packages/server/server/iam-handlers.ts`, change `handleIamLogin` to accept hooks and consult the account bucket:

```ts
export async function handleIamLogin(
  req: Request,
  hooks: { failKey?: string; onFailure?: () => void; onSuccess?: () => void } = {},
): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400)
  }
  const b = body as Record<string, unknown>
  const email = typeof b.email === 'string' ? b.email : ''
  const password = typeof b.password === 'string' ? b.password : ''

  // Per-account soft backoff: an attacker guessing one mailbox is slowed even when they
  // rotate source IPs. Checked BEFORE the argon2 verify so a locked account costs no CPU.
  const acctKey = `acct:${normalizeEmail(email)}`
  const acctVerdict = limiter.check(acctKey, RULES.login)
  if (!acctVerdict.allowed) return tooManyRequests(acctVerdict.retryAfterSec)

  const account = await findAccountByEmail(email)
  const ok = account ? await verifyPassword(password, account.passwordHash) : false
  if (!account || !ok) {
    limiter.fail(acctKey, RULES.login)
    hooks.onFailure?.()
    return json({ ok: false, error: 'invalid credentials' }, 401)
  }
  limiter.reset(acctKey)
  hooks.onSuccess?.()
  await updateAccount(account._id, { lastLoginAt: new Date().toISOString() })
  const cookie = makePrincipalSessionCookieHeader(account._id, account.sessionVersion)
  return new Response(
    JSON.stringify({ ok: true, mustChangePassword: account.mustChangePassword ?? false }),
    { status: 200, headers: { ...JSON_CT, 'Set-Cookie': cookie } },
  )
}
```

Add the imports at the top of `iam-handlers.ts`:

```ts
import { limiter, RULES, tooManyRequests } from './rate-limit'
import { normalizeEmail } from './iam-types'
```

At the `/api/iam/login` call site in `index.ts`, reset the IP bucket on success so a legitimate user who mistyped twice is not punished:

```ts
      return withCors(await handleIamLogin(req, {
        onSuccess: () => limiter.reset(`ip:${clientIp}:/api/iam/login`),
      }))
```

- [ ] **Step 7: Verify**

Run: `bun tsc --noEmit && bun test`
Expected: PASS.

Manual check against a running central:

```bash
for i in $(seq 1 8); do
  curl -s -o /dev/null -w "$i: %{http_code}\n" -X POST localhost:47291/api/iam/login \
    -H 'Content-Type: application/json' -d '{"email":"nobody@example.com","password":"wrong"}'
done
```

Expected: attempts 1–5 return `401`, attempts 6+ return `429` with a `Retry-After` header.

- [ ] **Step 8: Commit**

```bash
git add packages/server/server/rate-limit.ts packages/server/server/rate-limit-wiring.test.ts \
        packages/server/server/index.ts packages/server/server/iam-handlers.ts
git commit -m "feat(server): rate-limit login, token and ingest endpoints per IP and per account"
```

---

### Task 6: Security headers and CSP

Closes **F6** and **F15**. The OWASP Secure Headers baseline for a production HTTPS site is HSTS + CSP + `X-Content-Type-Options` + `Referrer-Policy` + `Permissions-Policy` + the cross-origin trio.

**Files:**
- Create: `packages/server/server/security-headers.ts`
- Test: `packages/server/server/security-headers.test.ts`
- Modify: `packages/server/server/index.ts`
- Modify: `packages/web/index.html`
- Create: `packages/web/public/fonts/` (self-hosted Inter woff2 files)

**Interfaces:**
- Consumes: `PROFILE` (Task 1).
- Produces: `buildCsp(opts: { dev: boolean }): string`; `securityHeaders(opts: { tls: boolean; dev: boolean; isApi: boolean }): Record<string, string>`; `withSecurity(res: Response): Response`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/security-headers.test.ts
import { describe, expect, it } from 'bun:test'
import { buildCsp, securityHeaders } from './security-headers'

describe('buildCsp', () => {
  const csp = buildCsp({ dev: false })

  it('locks the default source to self', () => {
    expect(csp).toContain("default-src 'self'")
  })

  it('forbids inline and remote scripts', () => {
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('forbids framing entirely', () => {
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('pins base-uri, form-action and object-src', () => {
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it('allows no external font or style origin (fonts are self-hosted)', () => {
    expect(csp).not.toContain('fonts.googleapis.com')
    expect(csp).not.toContain('fonts.gstatic.com')
  })

  it('relaxes connect-src for the Vite dev server only in dev', () => {
    expect(buildCsp({ dev: true })).toContain('ws:')
    expect(buildCsp({ dev: false })).not.toContain('ws:')
  })
})

describe('securityHeaders', () => {
  it('emits HSTS only when TLS is on', () => {
    expect(securityHeaders({ tls: true, dev: false, isApi: false })['Strict-Transport-Security'])
      .toBe('max-age=31536000; includeSubDomains')
    expect(securityHeaders({ tls: false, dev: false, isApi: false })['Strict-Transport-Security'])
      .toBeUndefined()
  })

  it('always emits the baseline set', () => {
    const h = securityHeaders({ tls: false, dev: false, isApi: false })
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('same-origin')
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin')
    expect(h['Permissions-Policy']).toContain('camera=()')
  })

  it('marks API responses no-store so credentials never land in a shared cache', () => {
    expect(securityHeaders({ tls: true, dev: false, isApi: true })['Cache-Control']).toBe('no-store')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/security-headers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/security-headers.ts
/**
 * security-headers.ts — the OWASP Secure Headers baseline, built per response.
 *
 * The SPA ships zero inline scripts (Vite emits module files, the PWA registration is an
 * external /registerSW.js), so script-src can stay 'self' with no nonce machinery. Inline
 * STYLE is still required: React style props render as style attributes.
 *
 * Fonts are self-hosted (packages/web/public/fonts) precisely so no external origin needs to
 * appear here — a third-party font host both loosens the policy and leaks visitor IPs.
 */

export function buildCsp(opts: { dev: boolean }): string {
  const connect = opts.dev ? "'self' ws: http://localhost:*" : "'self'"
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

export function securityHeaders(opts: { tls: boolean; dev: boolean; isApi: boolean }): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy': buildCsp({ dev: opts.dev }),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  }
  if (opts.tls) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  if (opts.isApi) h['Cache-Control'] = 'no-store'
  return h
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/security-headers.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Apply the headers to every response**

In `index.ts`, wrap the handler instead of touching 60 call sites. Rename the existing function to `handleRequestInner` and add:

```ts
async function handleRequest(req: Request, server: Server<WSData>): Promise<Response | undefined> {
  const res = await handleRequestInner(req, server)
  if (!res) return res // WebSocket upgrade handed off
  const url = new URL(req.url)
  const headers = securityHeaders({
    tls: TEAM_TLS,
    dev: !SERVE_STATIC,
    isApi: url.pathname.startsWith('/api/'),
  })
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
  return res
}
```

Add the imports:

```ts
import { securityHeaders } from './security-headers'
import { TEAM_TLS } from './config'
```

> Note: SSE responses (`/api/events`, `/api/data-stream`, `/api/chat-tty`) stream a body but the headers are set before the first flush, so mutating `res.headers` here is safe.

- [ ] **Step 6: Self-host the font**

Download the two Inter weights actually used and drop them in `packages/web/public/fonts/`:

```bash
mkdir -p packages/web/public/fonts
curl -sL -o packages/web/public/fonts/inter-400.woff2 \
  "https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter-Regular.woff2"
curl -sL -o packages/web/public/fonts/inter-600.woff2 \
  "https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter-SemiBold.woff2"
```

Replace the three external `<link>` tags in `packages/web/index.html` with nothing, and add to `packages/web/src/index.css`:

```css
/* Self-hosted so the CSP needs no external origin and no visitor IP leaves the instance. */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/inter-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/inter-600.woff2') format('woff2');
}
```

- [ ] **Step 7: Verify in a browser**

Run: `bun run build && bun run build:assets && bun tsc --noEmit && bun test`

Then start the server and check the headers plus a clean console:

```bash
curl -sI localhost:47291/ | grep -iE 'content-security-policy|x-frame|referrer|permissions'
```

Expected: all four present. Open the dashboard and confirm **zero** CSP violations in the browser console (a violation here means a missed inline script — fix the source, never widen the policy).

- [ ] **Step 8: Commit**

```bash
git add packages/server/server/security-headers.ts packages/server/server/security-headers.test.ts \
        packages/server/server/index.ts packages/web/index.html packages/web/src/index.css packages/web/public/fonts
git commit -m "feat(server): OWASP baseline security headers and a strict CSP with self-hosted fonts"
```

---

### Task 7: CORS allowlist

Closes **F7**.

**Files:**
- Create: `packages/server/server/cors.ts`
- Test: `packages/server/server/cors.test.ts`
- Modify: `packages/server/server/index.ts`, `packages/server/server/config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `originAllowed(origin: string | null, allowlist: string[], dev: boolean): boolean`; `corsHeadersFor(origin: string | null, allowlist: string[], dev: boolean): Record<string, string>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/cors.test.ts
import { describe, expect, it } from 'bun:test'
import { originAllowed, corsHeadersFor } from './cors'

describe('originAllowed', () => {
  it('allows an exact allowlist match', () => {
    expect(originAllowed('https://metrics.example.com', ['https://metrics.example.com'], false)).toBe(true)
  })

  it('rejects a different scheme or port', () => {
    expect(originAllowed('http://metrics.example.com', ['https://metrics.example.com'], false)).toBe(false)
    expect(originAllowed('https://metrics.example.com:8443', ['https://metrics.example.com'], false)).toBe(false)
  })

  it('rejects a suffix-confusion attempt', () => {
    expect(originAllowed('https://evil-metrics.example.com', ['https://metrics.example.com'], false)).toBe(false)
    expect(originAllowed('https://metrics.example.com.evil.tld', ['https://metrics.example.com'], false)).toBe(false)
  })

  it('rejects a null or missing origin', () => {
    expect(originAllowed(null, ['https://metrics.example.com'], false)).toBe(false)
    expect(originAllowed('null', ['https://metrics.example.com'], false)).toBe(false)
  })

  it('allows localhost origins in dev only', () => {
    expect(originAllowed('http://localhost:47292', [], true)).toBe(true)
    expect(originAllowed('http://localhost:47292', [], false)).toBe(false)
  })
})

describe('corsHeadersFor', () => {
  it('never emits a wildcard', () => {
    const h = corsHeadersFor('https://metrics.example.com', ['https://metrics.example.com'], false)
    expect(h['Access-Control-Allow-Origin']).toBe('https://metrics.example.com')
    expect(Object.values(h)).not.toContain('*')
  })

  it('emits Vary: Origin so caches do not cross-serve', () => {
    const h = corsHeadersFor('https://metrics.example.com', ['https://metrics.example.com'], false)
    expect(h['Vary']).toBe('Origin')
  })

  it('emits no ACAO at all for a disallowed origin', () => {
    const h = corsHeadersFor('https://evil.tld', ['https://metrics.example.com'], false)
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/cors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/cors.ts
/**
 * cors.ts — explicit origin allowlist.
 *
 * The dashboard is same-origin (the SPA is served by this very process), so in production
 * NO cross-origin browser access is needed at all: the correct answer for an unknown origin
 * is to emit no Access-Control-Allow-Origin header. Non-browser clients (agentop member push,
 * ci-push, the MCP server) never send an Origin and are unaffected by CORS.
 *
 * Configure extra origins with AGENTISTICS_ALLOWED_ORIGINS (comma-separated, scheme+host+port).
 */

const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function originAllowed(origin: string | null, allowlist: string[], dev: boolean): boolean {
  if (!origin || origin === 'null') return false
  if (allowlist.includes(origin)) return true
  if (dev && DEV_ORIGIN.test(origin)) return true
  return false
}

export function corsHeadersFor(
  origin: string | null,
  allowlist: string[],
  dev: boolean,
): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, PUT, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (!originAllowed(origin, allowlist, dev)) return base
  return { ...base, 'Access-Control-Allow-Origin': origin!, 'Access-Control-Allow-Credentials': 'true' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/cors.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Replace the static `CORS_HEADERS` in `index.ts`**

Add to `config.ts`:

```ts
// Comma-separated list of browser origins allowed to call this instance cross-origin.
// Normally EMPTY: the dashboard is same-origin. Only set it for a split deployment.
export const ALLOWED_ORIGINS = (process.env.AGENTISTICS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
```

In `index.ts`, replace the constant with a per-request value computed at the top of `handleRequestInner`:

```ts
    const CORS_HEADERS = corsHeadersFor(req.headers.get('origin'), ALLOWED_ORIGINS, !SERVE_STATIC)
```

Every existing `...CORS_HEADERS` spread keeps working unchanged. Delete the module-level `const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', … }` block.

- [ ] **Step 6: Verify**

Run: `bun tsc --noEmit && bun test`
Expected: PASS.

```bash
curl -sI -H 'Origin: https://evil.tld' localhost:47291/api/health | grep -i access-control-allow-origin
```

Expected: no output (no wildcard, no echo).

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/cors.ts packages/server/server/cors.test.ts \
        packages/server/server/index.ts packages/server/server/config.ts
git commit -m "fix(server): replace wildcard CORS with an explicit origin allowlist"
```

---

### Task 8: CSRF defence in depth — Origin and Sec-Fetch-Site checks

Closes **F8**. `SameSite` is the first line; this is the second, and it is what protects against a browser that mishandles Lax or a future `SameSite=None` regression.

**Files:**
- Create: `packages/server/server/csrf.ts`
- Test: `packages/server/server/csrf.test.ts`
- Modify: `packages/server/server/index.ts`

**Interfaces:**
- Consumes: `originAllowed` (Task 7).
- Produces: `csrfVerdict(input: { method: string; origin: string | null; secFetchSite: string | null; host: string; hasCookie: boolean; allowlist: string[]; dev: boolean }): { ok: true } | { ok: false; reason: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/csrf.test.ts
import { describe, expect, it } from 'bun:test'
import { csrfVerdict } from './csrf'

const base = {
  host: 'metrics.example.com',
  hasCookie: true,
  allowlist: [] as string[],
  dev: false,
}

describe('csrfVerdict', () => {
  it('always allows safe methods', () => {
    expect(csrfVerdict({ ...base, method: 'GET', origin: 'https://evil.tld', secFetchSite: 'cross-site' }).ok).toBe(true)
    expect(csrfVerdict({ ...base, method: 'HEAD', origin: null, secFetchSite: null }).ok).toBe(true)
  })

  it('allows a same-origin POST', () => {
    expect(csrfVerdict({ ...base, method: 'POST', origin: 'https://metrics.example.com', secFetchSite: 'same-origin' }).ok).toBe(true)
  })

  it('rejects a cross-site POST carrying a cookie', () => {
    const v = csrfVerdict({ ...base, method: 'POST', origin: 'https://evil.tld', secFetchSite: 'cross-site' })
    expect(v.ok).toBe(false)
  })

  it('rejects Sec-Fetch-Site: cross-site even when Origin looks right', () => {
    const v = csrfVerdict({ ...base, method: 'POST', origin: 'https://metrics.example.com', secFetchSite: 'cross-site' })
    expect(v.ok).toBe(false)
  })

  it('allows a cookie-less POST from a non-browser client (agentop, ci-push)', () => {
    const v = csrfVerdict({ ...base, hasCookie: false, method: 'POST', origin: null, secFetchSite: null })
    expect(v.ok).toBe(true)
  })

  it('rejects a cookie-bearing POST with no Origin and no Sec-Fetch-Site', () => {
    const v = csrfVerdict({ ...base, method: 'POST', origin: null, secFetchSite: null })
    expect(v.ok).toBe(false)
  })

  it('allows an explicitly allowlisted cross-origin POST', () => {
    const v = csrfVerdict({
      ...base,
      allowlist: ['https://ops.example.com'],
      method: 'POST',
      origin: 'https://ops.example.com',
      secFetchSite: 'cross-site',
    })
    expect(v.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/csrf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/csrf.ts
/**
 * csrf.ts — origin verification for state-changing requests.
 *
 * The session cookie is SameSite=Strict, which already prevents a cross-site POST from
 * carrying it. This module is the second line: it rejects any unsafe method that arrives
 * with a session cookie but does not prove same-origin provenance.
 *
 * Non-browser clients (agentop member push, ci-push, MCP) authenticate with a Bearer token
 * and send no cookie — they are exempt, because CSRF is by definition a cookie-riding attack.
 */
import { originAllowed } from './cors'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

export function csrfVerdict(input: {
  method: string
  origin: string | null
  secFetchSite: string | null
  host: string
  hasCookie: boolean
  allowlist: string[]
  dev: boolean
}): { ok: true } | { ok: false; reason: string } {
  if (SAFE.has(input.method.toUpperCase())) return { ok: true }
  if (!input.hasCookie) return { ok: true } // token-authenticated, non-browser

  const site = input.secFetchSite
  if (site === 'cross-site') {
    // A modern browser told us this is cross-site. Only an explicit allowlist entry may pass.
    return originAllowed(input.origin, input.allowlist, input.dev)
      ? { ok: true }
      : { ok: false, reason: 'cross_site' }
  }
  if (site === 'same-origin' || site === 'same-site' || site === 'none') return { ok: true }

  // No Sec-Fetch-Site (older browser / non-fetch client). Fall back to Origin.
  if (!input.origin) return { ok: false, reason: 'missing_origin' }
  if (input.origin === `https://${input.host}` || input.origin === `http://${input.host}`) return { ok: true }
  return originAllowed(input.origin, input.allowlist, input.dev)
    ? { ok: true }
    : { ok: false, reason: 'origin_mismatch' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/csrf.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it in**

In `index.ts`, right after the rate limiter block:

```ts
    // CSRF defence in depth — see csrf.ts. Applies to every /api route; token-authenticated
    // machine clients are exempt because they carry no cookie.
    if (url.pathname.startsWith('/api/')) {
      const verdict = csrfVerdict({
        method: req.method,
        origin: req.headers.get('origin'),
        secFetchSite: req.headers.get('sec-fetch-site'),
        host: url.host,
        hasCookie: req.headers.has('cookie'),
        allowlist: ALLOWED_ORIGINS,
        dev: !SERVE_STATIC,
      })
      if (!verdict.ok) {
        return new Response(JSON.stringify({ error: 'csrf_blocked' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }
```

- [ ] **Step 6: Verify**

Run: `bun tsc --noEmit && bun test`, then confirm the dashboard still works end to end (log in, change a preference, create a tag). A `403 csrf_blocked` in normal use means the SPA is issuing a request the check does not recognise — fix the check's `same-origin` branch, never disable it.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/csrf.ts packages/server/server/csrf.test.ts packages/server/server/index.ts
git commit -m "feat(server): reject cross-site state-changing requests with a cookie"
```

---

### Task 9: Cookie hardening — `__Host-` prefix, Strict, idle timeout

Closes **F9**. OWASP's most secure configuration is `__Host-SID=…; path=/; Secure; HttpOnly; SameSite=Strict`, and a session identifier must be reissued on every privilege change.

**Files:**
- Modify: `packages/server/server/auth.ts`
- Modify: `packages/server/server/auth.test.ts`

**Interfaces:**
- Consumes: `CAPS.requireSecureCookies` (Task 1).
- Produces: `signPrincipalSession(expiryMs, accountId, sessionVersion, secret, issuedAtMs)`; `verifyPrincipalSession(...)` returns `{ accountId, sessionVersion, issuedAtMs }`; `cookieName(secure: boolean): string`.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/server/auth.test.ts`:

```ts
import { cookieName, signPrincipalSession, verifyPrincipalSession, IDLE_TIMEOUT_MS } from './auth'

describe('cookie name', () => {
  it('uses the __Host- prefix when the cookie is Secure', () => {
    expect(cookieName(true)).toBe('__Host-agentistics_session')
  })

  it('falls back to the plain name on a non-TLS local instance', () => {
    expect(cookieName(false)).toBe('agentistics_session')
  })
})

describe('principal session with idle timeout', () => {
  const secret = 'a-separate-32-byte-secret-value!!'
  const now = 1_700_000_000_000

  it('round-trips and exposes issuedAt', () => {
    const v = signPrincipalSession(now + 3_600_000, 'acct1', 3, secret, now)
    const parsed = verifyPrincipalSession(v, secret, now + 1_000)
    expect(parsed).toEqual({ accountId: 'acct1', sessionVersion: 3, issuedAtMs: now })
  })

  it('rejects a session idle beyond the idle timeout', () => {
    const v = signPrincipalSession(now + 7 * 24 * 3_600_000, 'acct1', 3, secret, now)
    expect(verifyPrincipalSession(v, secret, now + IDLE_TIMEOUT_MS + 1)).toBeNull()
  })

  it('still rejects a tampered accountId', () => {
    const v = signPrincipalSession(now + 3_600_000, 'acct1', 3, secret, now)
    const tampered = v.replace('acct1', 'acct2')
    expect(verifyPrincipalSession(tampered, secret, now)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/auth.test.ts`
Expected: FAIL — `cookieName` / `IDLE_TIMEOUT_MS` are not exported and the signature has four parameters.

- [ ] **Step 3: Write the implementation**

In `packages/server/server/auth.ts`, replace the cookie constants and the principal-session helpers:

```ts
const COOKIE_BASE = 'agentistics_session'
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // absolute cap
/** Sliding window: a session unused for this long is dead even inside its absolute lifetime. */
export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000
const MAX_AGE_SECONDS = SESSION_DURATION_MS / 1000

/**
 * `__Host-` requires Secure + Path=/ + no Domain. It prevents a sibling subdomain (or a
 * network attacker over plain HTTP) from overwriting the session cookie — the strongest
 * integrity guarantee available for a cookie. Only usable when the cookie is Secure.
 */
export function cookieName(secure: boolean): string {
  return secure ? `__Host-${COOKIE_BASE}` : COOKIE_BASE
}

function secureCookies(): boolean {
  return TEAM_TLS || CAPS.requireSecureCookies
}

function makeCookieHeader(value: string, maxAge: number): string {
  const secure = secureCookies()
  const flags = [
    `${cookieName(secure)}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
  ]
  if (secure) flags.push('Secure')
  return flags.join('; ')
}

export function signPrincipalSession(
  expiryMs: number,
  accountId: string,
  sessionVersion: number,
  secret: string,
  issuedAtMs: number,
): string {
  const payload = `${expiryMs}.${accountId}.${sessionVersion}.${issuedAtMs}`
  const mac = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}

export function verifyPrincipalSession(
  cookieValue: string | undefined,
  secret: string,
  nowMs: number,
): PrincipalCookie | null {
  if (!cookieValue) return null
  const lastDot = cookieValue.lastIndexOf('.')
  if (lastDot === -1) return null
  const payload = cookieValue.slice(0, lastDot)
  const mac = cookieValue.slice(lastDot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  if (!constantTimeEqual(mac, expected)) return null
  const parts = payload.split('.')
  if (parts.length !== 4) return null
  const expiry = parseInt(parts[0]!, 10)
  const accountId = parts[1]!
  const sessionVersion = parseInt(parts[2]!, 10)
  const issuedAtMs = parseInt(parts[3]!, 10)
  if (isNaN(expiry) || expiry <= nowMs) return null
  if (!accountId || isNaN(sessionVersion) || isNaN(issuedAtMs)) return null
  if (nowMs - issuedAtMs > IDLE_TIMEOUT_MS) return null
  return { accountId, sessionVersion, issuedAtMs }
}
```

Update `PrincipalCookie` to `{ accountId: string; sessionVersion: number; issuedAtMs: number }`, and update `makePrincipalSessionCookieHeader` to pass `Date.now()` as `issuedAtMs`.

Update every cookie **read** to try both names (a deployment that flips TLS on must not log everyone out mid-flight):

```ts
function readSessionCookie(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.get('cookie'))
  return cookies[cookieName(true)] ?? cookies[cookieName(false)]
}
```

Use `readSessionCookie(req)` in `isAuthed`, `hasValidSession`, and `getPrincipal`.

- [ ] **Step 4: Slide the window on each authenticated request**

In `getPrincipal`, return the principal as today. In `index.ts`, after a successful gate check, refresh the cookie so an active user is never logged out at the 12-hour mark:

```ts
      // Sliding session: reissue the cookie (new issuedAt) at most once every 15 minutes.
      if (Date.now() - principal.issuedAtMs > 15 * 60_000) {
        refreshedCookie = makePrincipalSessionCookieHeader(principal.accountId, principal.sessionVersion)
      }
```

Add `issuedAtMs: number` to `Principal` in `iam-types.ts` and populate it in `getPrincipal`. Attach `refreshedCookie` as a `Set-Cookie` in the `handleRequest` wrapper from Task 6.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/server/server/auth.test.ts && bun tsc --noEmit && bun test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/auth.ts packages/server/server/auth.test.ts packages/server/server/iam-types.ts packages/server/server/index.ts
git commit -m "feat(server): __Host- prefixed SameSite=Strict session cookie with an idle timeout"
```

---

### Task 10: Session-secret hygiene

Closes **F5**.

**Files:**
- Modify: `packages/server/server/config.ts`
- Create: `packages/server/server/secret-store.ts`
- Test: `packages/server/server/secret-store.test.ts`
- Modify: `packages/server/server/index.ts` (boot block)

**Interfaces:**
- Consumes: `getMongoDb` from `mongo.ts`, `PROFILE` from `exposure.ts`.
- Produces: `validateSecret(secret: string | undefined, password: string | undefined): { ok: boolean; reason?: string }`; `ensureSessionSecret(): Promise<string>` (reads/creates a 32-byte random secret in the `config` collection, doc `_id: 'session-secret'`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/secret-store.test.ts
import { describe, expect, it } from 'bun:test'
import { validateSecret } from './secret-store'

describe('validateSecret', () => {
  it('rejects an unset secret', () => {
    expect(validateSecret(undefined, 'hunter2hunter2').ok).toBe(false)
  })

  it('rejects a secret equal to the dashboard password', () => {
    const v = validateSecret('hunter2hunter2hunter2hunter2hunt', 'hunter2hunter2hunter2hunter2hunt')
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('secret_equals_password')
  })

  it('rejects a secret shorter than 32 characters', () => {
    expect(validateSecret('short', undefined).ok).toBe(false)
  })

  it('accepts a long, distinct secret', () => {
    expect(validateSecret('f'.repeat(64), 'some-password').ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/secret-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/secret-store.ts
/**
 * secret-store.ts — the session-signing secret.
 *
 * SECURITY: the old behaviour (fall back to the dashboard password) meant a leaked or shared
 * password also let anyone forge a session cookie for ANY account, because the HMAC key was the
 * password. That fallback is gone. If AGENTISTICS_TEAM_SESSION_SECRET is unset we generate a
 * 32-byte random secret once and persist it in Mongo, so restarts do not log everyone out.
 */
import { randomBytes } from 'node:crypto'
import { getMongoDb } from './mongo'

const MIN_LENGTH = 32

export function validateSecret(
  secret: string | undefined,
  password: string | undefined,
): { ok: boolean; reason?: string } {
  if (!secret) return { ok: false, reason: 'secret_missing' }
  if (password && secret === password) return { ok: false, reason: 'secret_equals_password' }
  if (secret.length < MIN_LENGTH) return { ok: false, reason: 'secret_too_short' }
  return { ok: true }
}

interface SecretDoc { _id: string; secret: string; createdAt: string }

/** Read the persisted secret, generating one on first boot. Throws if Mongo is unreachable. */
export async function ensureSessionSecret(): Promise<string> {
  const db = await getMongoDb()
  const col = db.collection<SecretDoc>('config')
  const existing = await col.findOne({ _id: 'session-secret' })
  if (existing?.secret) return existing.secret
  const secret = randomBytes(32).toString('hex')
  await col.insertOne({ _id: 'session-secret', secret, createdAt: new Date().toISOString() })
  return secret
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/secret-store.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Remove the fallback and resolve the secret at boot**

In `config.ts`, replace the fallback:

```ts
// SECURITY: no fallback to TEAM_PASSWORD. When unset, index.ts resolves a persisted random
// secret from Mongo at boot (see secret-store.ts) so a password leak can never forge a session.
export const TEAM_SESSION_SECRET_ENV = process.env.AGENTISTICS_TEAM_SESSION_SECRET || undefined
export let TEAM_SESSION_SECRET = TEAM_SESSION_SECRET_ENV ?? ''
export function setResolvedSessionSecret(value: string): void { TEAM_SESSION_SECRET = value }
```

In the boot block of `index.ts`, before `Bun.serve`:

```ts
if (TEAM_CENTRAL) {
  const envSecret = TEAM_SESSION_SECRET_ENV
  if (envSecret) {
    const v = validateSecret(envSecret, TEAM_PASSWORD)
    if (!v.ok) {
      console.error(`[server] refusing to start: AGENTISTICS_TEAM_SESSION_SECRET is invalid (${v.reason}).`)
      console.error('[server] generate one with: openssl rand -hex 32')
      process.exit(1)
    }
    setResolvedSessionSecret(envSecret)
  } else {
    setResolvedSessionSecret(await ensureSessionSecret())
    console.log('[server] using the persisted random session secret (set AGENTISTICS_TEAM_SESSION_SECRET to pin your own).')
  }
}
```

- [ ] **Step 6: Verify**

Run: `bun tsc --noEmit && bun test`
Expected: PASS.

Boot a central with `AGENTISTICS_TEAM_SESSION_SECRET=$AGENTISTICS_TEAM_PASSWORD` and confirm it exits 1 with `secret_equals_password`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/secret-store.ts packages/server/server/secret-store.test.ts \
        packages/server/server/config.ts packages/server/server/index.ts
git commit -m "fix(server): never derive the session secret from the dashboard password"
```

---

### Task 11: Password policy

Closes half of **F10**.

**Files:**
- Create: `packages/server/server/password-policy.ts`
- Test: `packages/server/server/password-policy.test.ts`
- Modify: `packages/server/server/iam-handlers.ts:130,202`, `packages/server/server/bootstrap.ts:54`
- Modify: `packages/web/src/components/` (the password fields show the policy)

**Interfaces:**
- Consumes: nothing.
- Produces: `validatePasswordPolicy(password: string, ctx: { email?: string; name?: string }): { ok: true } | { ok: false; error: string }`; `PASSWORD_MIN_LENGTH = 12`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/password-policy.test.ts
import { describe, expect, it } from 'bun:test'
import { validatePasswordPolicy, PASSWORD_MIN_LENGTH } from './password-policy'

describe('validatePasswordPolicy', () => {
  it('requires at least 12 characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12)
    expect(validatePasswordPolicy('short1234', {}).ok).toBe(false)
    expect(validatePasswordPolicy('a-perfectly-fine-passphrase', {}).ok).toBe(true)
  })

  it('rejects a password on the common list regardless of length', () => {
    expect(validatePasswordPolicy('password123456', {}).ok).toBe(false)
    expect(validatePasswordPolicy('qwertyuiop1234', {}).ok).toBe(false)
  })

  it('rejects a password containing the local part of the email', () => {
    const v = validatePasswordPolicy('vinicius-super-secret', { email: 'vinicius@example.com' })
    expect(v.ok).toBe(false)
  })

  it('rejects a password containing the account name', () => {
    expect(validatePasswordPolicy('Agentistics-central-2026', { name: 'agentistics' }).ok).toBe(false)
  })

  it('rejects a single repeated character', () => {
    expect(validatePasswordPolicy('aaaaaaaaaaaaaaaa', {}).ok).toBe(false)
  })

  it('accepts a long random passphrase', () => {
    expect(validatePasswordPolicy('correct horse battery staple 42', { email: 'x@y.z', name: 'X' }).ok).toBe(true)
  })

  it('rejects an over-long password (argon2 DoS guard)', () => {
    expect(validatePasswordPolicy('x'.repeat(1025), {}).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/password-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/password-policy.ts
/**
 * password-policy.ts — NIST-aligned password rules: length over composition, plus a blocklist.
 * No character-class requirements (they push users to predictable substitutions); instead a
 * 12-character floor, a small embedded list of the passwords that actually get sprayed, and
 * context checks so nobody uses their own e-mail or the instance name.
 *
 * The upper bound exists because argon2id hashing cost grows with input: a 1 MB "password"
 * would be a free CPU-exhaustion lever on an unauthenticated endpoint.
 */

export const PASSWORD_MIN_LENGTH = 12
const PASSWORD_MAX_LENGTH = 1024

/** The passwords that dominate credential-spraying lists, normalised to lowercase. */
const COMMON = new Set([
  'password', 'password1', 'password123', 'password1234', 'password12345', 'password123456',
  '123456789012', '1234567890123', 'qwertyuiop', 'qwertyuiop1234', 'qwerty123456',
  'letmein12345', 'iloveyou1234', 'admin1234567', 'welcome12345', 'monkey123456',
  'abc123456789', 'changeme1234', 'passw0rd1234', 'dragon123456', 'football1234',
  'agentistics', 'agentistics1', 'claudecode12',
])

function containsToken(password: string, token: string | undefined): boolean {
  if (!token) return false
  const t = token.trim().toLowerCase()
  if (t.length < 4) return false
  return password.toLowerCase().includes(t)
}

export function validatePasswordPolicy(
  password: string,
  ctx: { email?: string; name?: string },
): { ok: true } | { ok: false; error: string } {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `password must be at least ${PASSWORD_MIN_LENGTH} characters` }
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: 'password is too long' }
  }
  const lower = password.toLowerCase()
  if (COMMON.has(lower)) return { ok: false, error: 'password is too common' }
  for (const c of COMMON) {
    if (lower.startsWith(c) && lower.length - c.length <= 3) {
      return { ok: false, error: 'password is too common' }
    }
  }
  if (new Set(password).size < 5) return { ok: false, error: 'password is not varied enough' }
  const localPart = ctx.email?.split('@')[0]
  if (containsToken(password, localPart)) return { ok: false, error: 'password must not contain your email' }
  if (containsToken(password, ctx.name)) return { ok: false, error: 'password must not contain your name' }
  return { ok: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/password-policy.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Replace the three length checks**

`packages/server/server/bootstrap.ts` — replace line 54:

```ts
  const policy = validatePasswordPolicy(password, { email, name })
  if (!policy.ok) return { ok: false, error: policy.error }
```

`packages/server/server/iam-handlers.ts` — replace both `next.length < 8` (line 130) and `password.length < 8` (line 202) with the same call, passing the target account's email and name.

Add the import to both files:

```ts
import { validatePasswordPolicy } from './password-policy'
```

- [ ] **Step 6: Surface the rule in the UI**

Wherever a password field is rendered (bootstrap wizard, change-password form, account create form), add helper text `t('auth.passwordRule')`, with the i18n entries:

```ts
  'auth.passwordRule': {
    en: 'At least 12 characters. Avoid common passwords and anything containing your name or e-mail.',
    pt: 'Ao menos 12 caracteres. Evite senhas comuns e qualquer coisa que contenha seu nome ou e-mail.',
  },
```

- [ ] **Step 7: Verify and commit**

Run: `bun tsc --noEmit && bun test`

```bash
git add packages/server/server/password-policy.ts packages/server/server/password-policy.test.ts \
        packages/server/server/bootstrap.ts packages/server/server/iam-handlers.ts packages/core/src/i18n.ts
git commit -m "feat(server): NIST-aligned password policy with a common-password blocklist"
```

---

### Task 12: TOTP two-factor authentication

Closes the rest of **F10**. Password-only auth on a public endpoint is a single point of failure; TOTP is implementable with `node:crypto` alone, so it costs no dependency.

**Files:**
- Create: `packages/server/server/totp.ts`
- Test: `packages/server/server/totp.test.ts`
- Create: `packages/server/server/mfa-store.ts`
- Modify: `packages/server/server/iam-handlers.ts`, `packages/server/server/iam-types.ts`
- Create: `packages/web/src/components/MfaSetup.tsx`, `packages/web/src/components/MfaChallenge.tsx`

**Interfaces:**
- Consumes: `validatePasswordPolicy` context patterns, `CAPS.requireMfaForOwner` (Task 1).
- Produces:
  - `generateSecret(): string` (base32, 20 bytes)
  - `base32Encode(buf: Uint8Array): string` / `base32Decode(s: string): Uint8Array`
  - `totpAt(secretBase32: string, timeStepCounter: number, digits?: number): string`
  - `verifyTotp(secretBase32: string, code: string, nowSec: number, window?: number): boolean`
  - `otpauthUri(secretBase32: string, account: string, issuer: string): string`
  - `hashRecoveryCode(code: string): string`, `generateRecoveryCodes(n?: number): string[]`
  - `MfaDoc { accountId: string; secret: string; enabledAt: string; recoveryHashes: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/totp.test.ts
import { describe, expect, it } from 'bun:test'
import { base32Encode, base32Decode, totpAt, verifyTotp, otpauthUri, generateRecoveryCodes, hashRecoveryCode } from './totp'

// RFC 4648 base32 vectors
describe('base32', () => {
  it('encodes and decodes round-trip', () => {
    const bytes = new TextEncoder().encode('12345678901234567890')
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes)
  })

  it('matches the RFC 4648 vector for "foobar"', () => {
    expect(base32Encode(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI======')
  })
})

// RFC 6238 test vectors, SHA-1, 8 digits, seed "12345678901234567890"
describe('totpAt', () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'))

  it('matches the RFC 6238 vector at T=59 (counter 1)', () => {
    expect(totpAt(secret, 1, 8)).toBe('94287082')
  })

  it('matches the RFC 6238 vector at T=1111111109 (counter 37037036)', () => {
    expect(totpAt(secret, 37037036, 8)).toBe('07081804')
  })
})

describe('verifyTotp', () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'))

  it('accepts the current code', () => {
    const now = 59
    const code = totpAt(secret, Math.floor(now / 30), 6)
    expect(verifyTotp(secret, code, now)).toBe(true)
  })

  it('accepts a code from the previous step (clock skew)', () => {
    const now = 120
    const previous = totpAt(secret, Math.floor(now / 30) - 1, 6)
    expect(verifyTotp(secret, previous, now)).toBe(true)
  })

  it('rejects a code two steps old', () => {
    const now = 300
    const stale = totpAt(secret, Math.floor(now / 30) - 3, 6)
    expect(verifyTotp(secret, stale, now)).toBe(false)
  })

  it('rejects a malformed code without throwing', () => {
    expect(verifyTotp(secret, 'abcdef', 59)).toBe(false)
    expect(verifyTotp(secret, '', 59)).toBe(false)
  })
})

describe('otpauthUri', () => {
  it('builds a scannable URI with the issuer', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'vini@example.com', 'Agentistics')
    expect(uri).toContain('otpauth://totp/Agentistics:vini%40example.com')
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain('issuer=Agentistics')
  })
})

describe('recovery codes', () => {
  it('generates 10 distinct codes', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
  })

  it('hashes deterministically and never stores plaintext', () => {
    const [c] = generateRecoveryCodes(1)
    expect(hashRecoveryCode(c!)).toBe(hashRecoveryCode(c!))
    expect(hashRecoveryCode(c!)).not.toBe(c)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/totp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/totp.ts
/**
 * totp.ts — RFC 6238 TOTP (SHA-1, 30s step, 6 digits) and RFC 4648 base32, on node:crypto only.
 * Pure and unit-tested against the RFC vectors; no dependency, so `bun build --compile` is safe.
 *
 * Recovery codes are stored ONLY as sha256 hashes, exactly like machine tokens.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30

export function base32Encode(buf: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  while (out.length % 8 !== 0) out += '='
  return out
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('invalid base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20))
}

/** The HOTP value for an explicit counter — the unit-testable core of TOTP. */
export function totpAt(secretBase32: string, counter: number, digits = 6): string {
  const key = Buffer.from(base32Decode(secretBase32))
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const mac = createHmac('sha1', key).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff)
  return String(bin % 10 ** digits).padStart(digits, '0')
}

/** Accepts the current step plus `window` steps either side (default 1 = ±30s of skew). */
export function verifyTotp(secretBase32: string, code: string, nowSec: number, window = 1): boolean {
  const trimmed = code.replace(/\s/g, '')
  if (!/^\d{6,8}$/.test(trimmed)) return false
  const counter = Math.floor(nowSec / STEP_SECONDS)
  for (let d = -window; d <= window; d++) {
    let expected: string
    try {
      expected = totpAt(secretBase32, counter + d, trimmed.length)
    } catch {
      return false
    }
    const a = Buffer.from(expected)
    const b = Buffer.from(trimmed)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return false
}

export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${label}?${params.toString()}`
}

export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'))
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/totp.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Add the store and the routes**

```ts
// packages/server/server/mfa-store.ts
/** mfa-store.ts — per-account TOTP enrolment. Secrets and recovery hashes live in `mfa`. */
import { getMongoDb } from './mongo'

export interface MfaDoc {
  _id: string          // accountId
  secret: string       // base32 TOTP secret
  enabledAt: string
  recoveryHashes: string[]
}

async function col() {
  const db = await getMongoDb()
  return db.collection<MfaDoc>('mfa')
}

export async function getMfa(accountId: string): Promise<MfaDoc | null> {
  return (await col()).findOne({ _id: accountId })
}

export async function enableMfa(accountId: string, secret: string, recoveryHashes: string[]): Promise<void> {
  await (await col()).updateOne(
    { _id: accountId },
    { $set: { secret, recoveryHashes, enabledAt: new Date().toISOString() } },
    { upsert: true },
  )
}

export async function consumeRecoveryCode(accountId: string, hash: string): Promise<boolean> {
  const res = await (await col()).updateOne({ _id: accountId }, { $pull: { recoveryHashes: hash } })
  return res.modifiedCount === 1
}

export async function disableMfa(accountId: string): Promise<void> {
  await (await col()).deleteOne({ _id: accountId })
}
```

Routes to add in `iam-handlers.ts` and register in `index.ts` (all behind the authenticated gate, none in `AUTH_PUBLIC`):

- `POST /api/iam/mfa/start` → `{ secret, otpauthUri }` (generates but does not enable).
- `POST /api/iam/mfa/enable` `{ secret, code }` → verifies the code, enables, returns the 10 recovery codes **once**, bumps `sessionVersion`.
- `POST /api/iam/mfa/disable` `{ code }` → owner may disable another account's MFA; a user may disable their own only with a valid code.
- `GET /api/iam/mfa/status` → `{ enabled: boolean }`.

Extend the login flow in `handleIamLogin`: after the password verifies, if the account has an `mfa` doc, do **not** issue the session cookie — return `{ ok: false, mfaRequired: true, challenge: <signed, 5-minute HMAC token binding accountId + sessionVersion> }`. Add `POST /api/iam/login/mfa` `{ challenge, code }` which verifies the challenge HMAC, then `verifyTotp` (or `consumeRecoveryCode`), then issues the cookie. Rate-limit that route with `RULES.login` keyed by `acct:<accountId>:mfa`.

Enforce the profile requirement in the gate: when `CAPS.requireMfaForOwner` and the principal's role is `owner` and no `mfa` doc exists, allow only `/api/iam/me`, `/api/iam/mfa/*`, and `/api/iam/logout` — everything else returns `403 { error: 'mfa_enrollment_required' }`. The SPA renders the enrolment screen on that code.

- [ ] **Step 6: Build the two web components**

`MfaSetup.tsx` renders the `otpauth://` URI as a QR code. **Do not add a QR dependency** — render the secret in grouped uppercase text plus a copy button and a link to the URI; authenticator apps accept manual entry. `MfaChallenge.tsx` is a 6-digit input shown when login returns `mfaRequired`, with a "use a recovery code" toggle.

- [ ] **Step 7: Verify**

Run: `bun tsc --noEmit && bun test`

Manual: enrol an account with a real authenticator app, log out, log back in, confirm the challenge, then confirm one recovery code works exactly once.

- [ ] **Step 8: Commit**

```bash
git add packages/server/server/totp.ts packages/server/server/totp.test.ts packages/server/server/mfa-store.ts \
        packages/server/server/iam-handlers.ts packages/server/server/index.ts \
        packages/web/src/components/MfaSetup.tsx packages/web/src/components/MfaChallenge.tsx
git commit -m "feat(server): TOTP two-factor authentication with recovery codes"
```

---

### Task 13: Audit log

Closes **F11** (OWASP A09: without a log, a breach is invisible and unforensicable).

**Files:**
- Create: `packages/server/server/audit.ts`
- Test: `packages/server/server/audit.test.ts`
- Modify: `packages/server/server/iam-handlers.ts`, `packages/server/server/index.ts`, `packages/server/server/team-tokens.ts`

**Interfaces:**
- Consumes: `getMongoDb`, `resolveClientIp` (Task 3).
- Produces: `type AuditAction`; `buildAuditEvent(input, nowIso): AuditEvent` (pure); `writeAudit(input): Promise<void>`; `listAudit(opts): Promise<AuditEvent[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/audit.test.ts
import { describe, expect, it } from 'bun:test'
import { buildAuditEvent } from './audit'

const now = '2026-07-25T12:00:00.000Z'

describe('buildAuditEvent', () => {
  it('records the who/what/where/when', () => {
    const e = buildAuditEvent(
      { action: 'login.success', actorId: 'acct1', ip: '1.2.3.4', targetId: 'acct1' },
      now,
    )
    expect(e.action).toBe('login.success')
    expect(e.actorId).toBe('acct1')
    expect(e.ip).toBe('1.2.3.4')
    expect(e.at).toBe(now)
  })

  it('never stores a password, token, or code even if handed one', () => {
    const e = buildAuditEvent(
      { action: 'login.failure', ip: '1.2.3.4', meta: { password: 'hunter2', token: 'abc', code: '123456', email: 'a@b.c' } },
      now,
    )
    expect(JSON.stringify(e)).not.toContain('hunter2')
    expect(JSON.stringify(e)).not.toContain('123456')
    expect(e.meta).toEqual({ email: 'a@b.c' })
  })

  it('truncates oversized meta values', () => {
    const e = buildAuditEvent({ action: 'account.update', ip: '1.2.3.4', meta: { note: 'x'.repeat(5000) } }, now)
    expect((e.meta!.note as string).length).toBeLessThanOrEqual(512)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/audit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/audit.ts
/**
 * audit.ts — append-only security event log in the `audit` collection.
 *
 * OWASP A09: authentication, authorization, and administrative events must be recorded with
 * enough context to reconstruct an incident. The pure builder redacts secret-shaped fields
 * before anything reaches the database — an audit log that stores credentials is a liability.
 */
import { getMongoDb } from './mongo'

export type AuditAction =
  | 'login.success' | 'login.failure' | 'login.locked' | 'login.mfa_challenge' | 'login.mfa_failure'
  | 'logout' | 'password.change' | 'mfa.enable' | 'mfa.disable' | 'mfa.recovery_used'
  | 'account.create' | 'account.update' | 'account.delete'
  | 'team.create' | 'team.update' | 'team.delete'
  | 'token.mint' | 'token.rotate' | 'token.revoke'
  | 'repo.register' | 'repo.unregister'
  | 'config.update' | 'bootstrap.consume'
  | 'capability.denied' | 'authz.denied'

export interface AuditEvent {
  action: AuditAction
  actorId?: string
  targetId?: string
  ip: string
  at: string
  meta?: Record<string, unknown>
}

/** Field names whose values must never be persisted. */
const REDACT = new Set(['password', 'newPassword', 'currentPassword', 'token', 'secret', 'code', 'hash', 'passwordHash'])
const MAX_VALUE_LENGTH = 512

export function buildAuditEvent(
  input: { action: AuditAction; actorId?: string; targetId?: string; ip: string; meta?: Record<string, unknown> },
  nowIso: string,
): AuditEvent {
  let meta: Record<string, unknown> | undefined
  if (input.meta) {
    meta = {}
    for (const [k, v] of Object.entries(input.meta)) {
      if (REDACT.has(k)) continue
      meta[k] = typeof v === 'string' && v.length > MAX_VALUE_LENGTH ? v.slice(0, MAX_VALUE_LENGTH) : v
    }
  }
  return { action: input.action, actorId: input.actorId, targetId: input.targetId, ip: input.ip, at: nowIso, meta }
}

export async function writeAudit(input: Parameters<typeof buildAuditEvent>[0]): Promise<void> {
  try {
    const db = await getMongoDb()
    await db.collection<AuditEvent>('audit').insertOne(buildAuditEvent(input, new Date().toISOString()))
  } catch {
    // Never let an audit write failure break a request. Surfaced via the health check instead.
  }
}

/** Owner-only reader, newest first. */
export async function listAudit(opts: { limit?: number; action?: AuditAction } = {}): Promise<AuditEvent[]> {
  const db = await getMongoDb()
  const filter = opts.action ? { action: opts.action } : {}
  return db.collection<AuditEvent>('audit')
    .find(filter)
    .sort({ at: -1 })
    .limit(Math.min(opts.limit ?? 200, 1000))
    .toArray()
}

/** TTL index — keep 180 days. Idempotent; call at boot next to ensureAccountIndexes. */
export async function ensureAuditIndexes(): Promise<void> {
  const db = await getMongoDb()
  const col = db.collection<AuditEvent>('audit')
  await col.createIndex({ at: -1 })
  await col.createIndex({ at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/audit.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Emit events at every security-relevant call site**

- `iam-handlers.ts`: `login.success`, `login.failure`, `password.change`, `account.*`, `team.*`, `mfa.*`.
- `index.ts`: `login.locked` (on a 429 at a login route), `authz.denied` (on the 403 in the admin gate), `capability.denied` (on the Task 2 guard).
- `team-tokens.ts`: `token.mint`, `token.rotate`, `token.revoke`.
- `team-repos.ts`: `repo.register`, `repo.unregister`.
- `bootstrap` handler: `bootstrap.consume`.
- `central-config.ts` writer: `config.update`.

Add `GET /api/iam/audit` (owner-only, add `/api/iam/audit` to `ADMIN_PATHS`) returning `listAudit`, and call `ensureAuditIndexes()` in the boot block next to `ensureAccountIndexes()`.

- [ ] **Step 6: Verify and commit**

Run: `bun tsc --noEmit && bun test`

```bash
git add packages/server/server/audit.ts packages/server/server/audit.test.ts \
        packages/server/server/iam-handlers.ts packages/server/server/index.ts \
        packages/server/server/team-tokens.ts packages/server/server/team-repos.ts
git commit -m "feat(server): append-only audit log for authentication and admin events"
```

---

### Task 14: Resource limits

Closes **F12** (OWASP API4).

**Files:**
- Create: `packages/server/server/limits.ts`
- Test: `packages/server/server/limits.test.ts`
- Modify: `packages/server/server/index.ts`, `packages/server/server/sse.ts`, `packages/server/server/rates.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LIMITS = { bodyBytes: 1_048_576, ingestBodyBytes: 25_165_824, sseClients: 200, outboundTimeoutMs: 8000 }`; `readJsonLimited<T>(req: Request, maxBytes: number): Promise<{ ok: true; value: T } | { ok: false; error: 'too_large' | 'invalid_json' }>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/limits.test.ts
import { describe, expect, it } from 'bun:test'
import { readJsonLimited, LIMITS } from './limits'

const jsonReq = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://x/api/test', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers } })

describe('readJsonLimited', () => {
  it('parses a small valid body', async () => {
    const r = await readJsonLimited<{ a: number }>(jsonReq('{"a":1}'), 1000)
    expect(r).toEqual({ ok: true, value: { a: 1 } })
  })

  it('rejects a body over the limit by Content-Length without reading it', async () => {
    const r = await readJsonLimited(jsonReq('{"a":1}', { 'Content-Length': '999999' }), 100)
    expect(r).toEqual({ ok: false, error: 'too_large' })
  })

  it('rejects a body that exceeds the limit while streaming (no Content-Length)', async () => {
    const r = await readJsonLimited(jsonReq('x'.repeat(500)), 100)
    expect(r).toEqual({ ok: false, error: 'too_large' })
  })

  it('rejects malformed JSON', async () => {
    const r = await readJsonLimited(jsonReq('{not json'), 1000)
    expect(r).toEqual({ ok: false, error: 'invalid_json' })
  })
})

describe('LIMITS', () => {
  it('keeps the default body limit at 1 MiB and the ingest limit larger', () => {
    expect(LIMITS.bodyBytes).toBe(1_048_576)
    expect(LIMITS.ingestBodyBytes).toBeGreaterThan(LIMITS.bodyBytes)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/limits.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/limits.ts
/**
 * limits.ts — request-size and concurrency caps (OWASP API4, Unrestricted Resource Consumption).
 *
 * A JSON body is read through a byte counter rather than `req.json()` so an oversized payload is
 * abandoned mid-stream instead of being fully buffered first. The ingest cap is deliberately
 * larger: a member's first push carries their whole history.
 */

export const LIMITS = {
  /** Default JSON body cap for API routes. */
  bodyBytes: 1_048_576, // 1 MiB
  /** POST /api/team/ingest — a full-history first push. */
  ingestBodyBytes: 24 * 1_048_576, // 24 MiB
  /** Maximum concurrently attached SSE clients. */
  sseClients: 200,
  /** Timeout for any outbound fetch this server makes (pricing table, FX rate, JWKS). */
  outboundTimeoutMs: 8_000,
} as const

export async function readJsonLimited<T>(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; value: T } | { ok: false; error: 'too_large' | 'invalid_json' }> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, error: 'too_large' }

  const body = req.body
  if (!body) return { ok: false, error: 'invalid_json' }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false, error: 'too_large' }
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(merged)) as T }
  } catch {
    return { ok: false, error: 'invalid_json' }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/limits.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Apply the caps**

1. Replace every `await req.json()` in `index.ts`, `iam-handlers.ts`, `tags-handlers.ts`, `team-admin.ts` and `team-ingest.ts` with `readJsonLimited`, returning `413 { error: 'payload_too_large' }` or `400 { error: 'invalid_json' }`. Use `LIMITS.ingestBodyBytes` only in `team-ingest.ts`.
2. Set a hard server-level ceiling in both `Bun.serve` calls:

```ts
Bun.serve<WSData>({
  port: PORT,
  idleTimeout: 60,
  maxRequestBodySize: LIMITS.ingestBodyBytes,
  websocket: _wsHandlers,
  fetch: handleRequest,
})
```

3. In `sse.ts`, refuse a new SSE client past the cap:

```ts
  if (sseClients.size >= LIMITS.sseClients) {
    return new Response(JSON.stringify({ error: 'too_many_streams' }), { status: 503 })
  }
```

4. In `rates.ts` (and any other outbound `fetch`), attach a timeout:

```ts
  const res = await fetch(url, { signal: AbortSignal.timeout(LIMITS.outboundTimeoutMs) })
```

- [ ] **Step 6: Verify and commit**

Run: `bun tsc --noEmit && bun test`

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:47291/api/iam/login \
  -H 'Content-Type: application/json' --data-binary @<(head -c 2000000 /dev/zero | tr '\0' 'x')
```

Expected: `413`.

```bash
git add packages/server/server/limits.ts packages/server/server/limits.test.ts \
        packages/server/server/index.ts packages/server/server/sse.ts packages/server/server/rates.ts \
        packages/server/server/iam-handlers.ts packages/server/server/team-ingest.ts
git commit -m "feat(server): request-size, stream and outbound-timeout limits"
```

---

### Task 15: Error hygiene

Closes **F13** (OWASP A10).

**Files:**
- Create: `packages/server/server/errors.ts`
- Test: `packages/server/server/errors.test.ts`
- Modify: every handler that currently returns `String(err)` or `err.message`

**Interfaces:**
- Consumes: nothing.
- Produces: `safeError(err: unknown, opts: { verbose: boolean }): { body: { error: string; ref: string }; logLine: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/errors.test.ts
import { describe, expect, it } from 'bun:test'
import { safeError } from './errors'

describe('safeError', () => {
  it('returns a generic message and a correlation ref in production', () => {
    const r = safeError(new Error('ENOENT: /home/vini/.claude/secret.json'), { verbose: false })
    expect(r.body.error).toBe('internal_error')
    expect(r.body).not.toHaveProperty('message')
    expect(r.body.ref).toMatch(/^[0-9a-f]{12}$/)
  })

  it('keeps the real message in the server-side log line', () => {
    const r = safeError(new Error('ENOENT: /home/vini/.claude/secret.json'), { verbose: false })
    expect(r.logLine).toContain('ENOENT')
    expect(r.logLine).toContain(r.body.ref)
  })

  it('echoes the message in verbose (local dev) mode', () => {
    const r = safeError(new Error('boom'), { verbose: true })
    expect(r.body.error).toBe('boom')
  })

  it('handles non-Error throws', () => {
    expect(safeError('a string', { verbose: false }).body.error).toBe('internal_error')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/errors.ts
/**
 * errors.ts — client-safe error rendering.
 *
 * OWASP A10 (Mishandling of Exceptional Conditions): an internal message tells an attacker the
 * filesystem layout, the database topology, and which code path they reached. The client gets a
 * generic code plus a random correlation ref; the operator greps the log for that ref.
 * Verbose mode is only for the local profile.
 */
import { randomBytes } from 'node:crypto'

export function safeError(
  err: unknown,
  opts: { verbose: boolean },
): { body: { error: string; ref: string }; logLine: string } {
  const message = err instanceof Error ? err.message : String(err)
  const ref = randomBytes(6).toString('hex')
  return {
    body: { error: opts.verbose ? message : 'internal_error', ref },
    logLine: `[error ${ref}] ${message}`,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/errors.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Replace every leaky catch**

Find them:

```bash
grep -rn "String(err)\|err.message" packages/server/server/*.ts | grep -v embedded-dist | grep -v '\.test\.ts'
```

Replace each response body with:

```ts
      const e = safeError(err, { verbose: PROFILE === 'local' })
      console.error(e.logLine)
      return new Response(JSON.stringify(e.body), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
```

- [ ] **Step 6: Verify and commit**

Run: `bun tsc --noEmit && bun test`

```bash
git add packages/server/server/errors.ts packages/server/server/errors.test.ts packages/server/server/*.ts
git commit -m "fix(server): never return internal error details to clients"
```

---

### Task 16: Authorization regression suite

Locks in the gate so a future route cannot silently become public (OWASP A01 is the #1 risk for a reason).

**Files:**
- Create: `packages/server/server/authz-gate.test.ts`
- Modify: `packages/server/server/index.ts` (export the route tables)

**Interfaces:**
- Consumes: `AUTH_PUBLIC`, `ADMIN_PATHS`, `isAdminPath` from `index.ts` (export them), `can` from `iam-caps.ts`, `scopeAppDataToTeams` from `team-scope.ts`.
- Produces: nothing (tests only).

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/authz-gate.test.ts
import { describe, expect, it } from 'bun:test'
import { AUTH_PUBLIC, ADMIN_PATHS, isAdminPath } from './index-routes'
import { can } from './iam-caps'
import { scopeAppDataToTeams } from './team-scope'
import type { Principal } from './iam-types'

const user: Principal = { accountId: 'u1', role: 'member', memberships: [{ teamId: 't1', role: 'user' }], issuedAtMs: 0 }
const manager: Principal = { accountId: 'm1', role: 'member', memberships: [{ teamId: 't1', role: 'manager' }], issuedAtMs: 0 }
const owner: Principal = { accountId: 'o1', role: 'owner', memberships: [], issuedAtMs: 0 }

describe('public route allowlist', () => {
  it('is exactly the routes that must work before authentication', () => {
    expect([...AUTH_PUBLIC].sort()).toEqual([
      '/api/health',
      '/api/iam/bootstrap',
      '/api/iam/login',
      '/api/iam/login/mfa',
      '/api/iam/logout',
      '/api/iam/me',
      '/api/iam/status',
      '/api/team/agent',
      '/api/team/ingest',
      '/api/team/leave',
      '/api/team/login',
      '/api/team/logout',
      '/api/team/policy',
      '/api/team/session',
      '/api/team/whoami',
    ].sort())
  })

  it('does not expose any data-bearing route', () => {
    for (const p of AUTH_PUBLIC) {
      expect(p).not.toBe('/api/data')
      expect(p.startsWith('/api/tags')).toBe(false)
      expect(p.startsWith('/api/iam/accounts')).toBe(false)
      expect(p.startsWith('/api/iam/teams')).toBe(false)
      expect(p.startsWith('/api/iam/machines')).toBe(false)
    }
  })
})

describe('admin path matching', () => {
  it('covers nested detail routes', () => {
    for (const p of ADMIN_PATHS) {
      expect(isAdminPath(p)).toBe(true)
      expect(isAdminPath(`${p}/some-id`)).toBe(true)
    }
  })

  it('does not swallow a sibling route with a shared prefix', () => {
    expect(isAdminPath('/api/team/membersearch')).toBe(false)
  })

  it('includes the audit reader', () => {
    expect(isAdminPath('/api/iam/audit')).toBe(true)
  })
})

describe('capability matrix', () => {
  it('denies a plain user every write action', () => {
    expect(can(user, 'teams:write')).toBe(false)
    expect(can(user, 'central:config')).toBe(false)
    expect(can(user, 'tokens:write', { teamId: 't1' })).toBe(false)
    expect(can(user, 'members:write', { teamId: 't1' })).toBe(false)
    expect(can(user, 'tags:write')).toBe(false)
  })

  it('scopes a manager to their own team', () => {
    expect(can(manager, 'tokens:write', { teamId: 't1' })).toBe(true)
    expect(can(manager, 'tokens:write', { teamId: 't2' })).toBe(false)
  })

  it('never lets a manager create an owner', () => {
    expect(can(manager, 'accounts:manage', { teamId: 't1', targetRole: 'owner' })).toBe(false)
    expect(can(manager, 'accounts:manage', { teamId: 't1', targetRole: 'manager' })).toBe(false)
    expect(can(manager, 'accounts:manage', { teamId: 't1', targetRole: 'user' })).toBe(true)
  })

  it('grants the owner everything', () => {
    expect(can(owner, 'teams:write')).toBe(true)
    expect(can(owner, 'central:config')).toBe(true)
  })
})

describe('data scoping (BOLA)', () => {
  it('drops sessions from teams the principal does not belong to', () => {
    const data = {
      sessions: [
        { session_id: 's1', teamIds: ['t1'], user: 'a', memberId: 'm-a' },
        { session_id: 's2', teamIds: ['t2'], user: 'b', memberId: 'm-b' },
      ],
      projects: [], workflows: [], userStatsCaches: {},
    } as never
    const scoped = scopeAppDataToTeams(data, new Set(['t1']), new Set())
    expect(scoped.sessions!.map(s => s.session_id)).toEqual(['s1'])
    expect(Object.keys(scoped.userStatsCaches ?? {})).not.toContain('b')
  })

  it('returns an empty statsCache when nothing is visible, never the central total', () => {
    const data = {
      sessions: [{ session_id: 's2', teamIds: ['t2'], user: 'b', memberId: 'm-b' }],
      projects: [], workflows: [],
      statsCache: { totalCostUSD: 9999 },
      userStatsCaches: { b: { totalCostUSD: 9999 } },
    } as never
    const scoped = scopeAppDataToTeams(data, new Set(['t1']), new Set())
    expect(scoped.sessions).toHaveLength(0)
    expect(JSON.stringify(scoped.statsCache)).not.toContain('9999')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/authz-gate.test.ts`
Expected: FAIL — `./index-routes` does not exist.

- [ ] **Step 3: Extract the route tables**

Create `packages/server/server/index-routes.ts` holding `AUTH_PUBLIC`, `ADMIN_PATHS`, and `isAdminPath` verbatim from `index.ts` (importing `index.ts` in a test would boot the server). Import them back into `index.ts`. Remove `/api/iam/accounts`, `/api/iam/teams`, `/api/iam/machines`, and `/api/iam/change-password` from `AUTH_PUBLIC` — those handlers already resolve a principal internally, so the gate is pure upside — and add `/api/iam/audit` to `ADMIN_PATHS`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/authz-gate.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Verify the dashboard still works**

Log in as a non-owner and confirm the accounts/teams/machines panels still load (they now go through the gate first, then the handler's own visibility filter).

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/index-routes.ts packages/server/server/authz-gate.test.ts packages/server/server/index.ts
git commit -m "test(server): lock the public/admin route tables and the team scoping rules"
```

---

### Task 17: Container and compose hardening

Closes **F14**.

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `docker-compose.localdb.yml`
- Modify: `central.sh` (generate Mongo credentials, default `BIND_IP`)

- [ ] **Step 1: Run the container as a non-root user**

Append to the runtime stage of `Dockerfile`, before `CMD`:

```dockerfile
# Run unprivileged. The app only needs to read its own code and write /data.
RUN addgroup --system --gid 10001 agentistics \
 && adduser  --system --uid 10001 --ingroup agentistics --home /data agentistics \
 && mkdir -p /data/.agentistics \
 && chown -R agentistics:agentistics /data /app
USER agentistics
ENV HOME=/data
```

- [ ] **Step 2: Update the data volume path**

In `docker-compose.yml`, change the named volume mount from `/root/.agentistics` to `/data/.agentistics` and add the container hardening:

```yaml
    user: "10001:10001"
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          memory: 2g
          cpus: "2.0"
    healthcheck:
      test: ["CMD", "bun", "-e", "await fetch('http://127.0.0.1:47291/api/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
```

- [ ] **Step 3: Bind to loopback by default**

Change the port mapping default so a fresh install is not reachable from the LAN by accident:

```yaml
    ports:
      # Default 127.0.0.1: reachable only from this host. A tunnel (cloudflared) or a reverse
      # proxy on the same host connects here. Set BIND_IP=0.0.0.0 deliberately for LAN access.
      - "${BIND_IP:-127.0.0.1}:${APP_PORT:-48080}:47291"
```

Update `central.sh`'s `print_access_url` default from `0.0.0.0` to `127.0.0.1` and add a line telling the operator how to expose it.

- [ ] **Step 4: Make the host harness mounts conditional**

Move the four `${HOME}/.claude` … mounts into a new `docker-compose.selfcontrib.yml`, and include it from `central.sh` only when `AGENTISTICS_CENTRAL_USER` is set in `central.env`. A dedicated central then has **no** host filesystem access at all:

```sh
compose_files() {
  local files="-f docker-compose.yml"
  uses_local_db && files="$files -f docker-compose.localdb.yml"
  grep -qE '^AGENTISTICS_CENTRAL_USER=.+' "$ENV_FILE" 2>/dev/null && files="$files -f docker-compose.selfcontrib.yml"
  printf '%s' "$files"
}
```

- [ ] **Step 5: Enable Mongo authentication**

In `docker-compose.localdb.yml`:

```yaml
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--auth", "--bind_ip_all"]
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER:-agentistics}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD:?MONGO_PASSWORD is required}
```

In `central.sh`'s init flow, generate the password once and write it into `central.env`:

```sh
if ! grep -q '^MONGO_PASSWORD=' "$ENV_FILE" 2>/dev/null; then
  printf 'MONGO_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> "$ENV_FILE"
  printf 'MONGO_URL=mongodb://${MONGO_USER:-agentistics}:${MONGO_PASSWORD}@mongo:27017/?replicaSet=rs0&authSource=admin\n' >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"
```

- [ ] **Step 6: Verify**

```bash
./central.sh down && ./central.sh up
docker compose -p team-mode exec app id           # expect uid=10001, not root
docker compose -p team-mode exec app touch /x     # expect "Read-only file system"
curl -s localhost:48080/api/health                # expect {"ok":true}
ss -ltnp | grep 48080                             # expect 127.0.0.1:48080, not 0.0.0.0
```

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml docker-compose.localdb.yml docker-compose.selfcontrib.yml central.sh
git commit -m "chore(docker): non-root read-only container, loopback bind and authenticated mongo"
```

---

### Task 18: `agentop doctor` go-live preflight

Nothing above is worth much if a single env var is wrong on the day of exposure. This is the gate the operator runs before opening the tunnel.

**Files:**
- Create: `packages/server/server/preflight.ts`
- Test: `packages/server/server/preflight.test.ts`
- Create: `packages/server/server/cli-doctor.ts`
- Modify: `packages/server/bin/cli.ts`

**Interfaces:**
- Consumes: `PROFILE`, `CAPS`, `validateSecret`, `TRUST_PROXY`, `ALLOWED_ORIGINS`.
- Produces: `interface Check { id: string; label: string; status: 'pass' | 'fail' | 'warn'; detail: string }`; `runPreflight(input: PreflightInput): Check[]`; `allPassed(checks: Check[]): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/server/preflight.test.ts
import { describe, expect, it } from 'bun:test'
import { runPreflight, allPassed, type PreflightInput } from './preflight'

const good: PreflightInput = {
  profile: 'public',
  caps: { localShell: false, localChat: false, localTranscripts: false, mcpAdmin: false, requireMfaForOwner: true, requireSecureCookies: true },
  sessionSecret: 'f'.repeat(64),
  password: undefined,
  tls: true,
  trustProxy: true,
  bindIp: '127.0.0.1',
  allowedOrigins: [],
  ownersWithoutMfa: [],
  mongoAuthenticated: true,
  ingestTokensCount: 3,
}

describe('runPreflight', () => {
  it('passes a fully hardened public instance', () => {
    expect(allPassed(runPreflight(good))).toBe(true)
  })

  it('fails when local shell is still reachable', () => {
    const checks = runPreflight({ ...good, caps: { ...good.caps, localShell: true } })
    expect(checks.find(c => c.id === 'local-shell')!.status).toBe('fail')
    expect(allPassed(checks)).toBe(false)
  })

  it('fails when the session secret is missing or equals the password', () => {
    expect(allPassed(runPreflight({ ...good, sessionSecret: undefined }))).toBe(false)
    expect(allPassed(runPreflight({ ...good, sessionSecret: 'p'.repeat(40), password: 'p'.repeat(40) }))).toBe(false)
  })

  it('fails when TLS is off on a public profile', () => {
    expect(allPassed(runPreflight({ ...good, tls: false }))).toBe(false)
  })

  it('fails when an owner has no MFA on a public profile', () => {
    const checks = runPreflight({ ...good, ownersWithoutMfa: ['vini@example.com'] })
    expect(checks.find(c => c.id === 'owner-mfa')!.status).toBe('fail')
  })

  it('fails when the app is bound to 0.0.0.0 while behind a tunnel', () => {
    expect(allPassed(runPreflight({ ...good, bindIp: '0.0.0.0' }))).toBe(false)
  })

  it('warns (not fails) when Mongo has no auth but is unpublished', () => {
    const checks = runPreflight({ ...good, mongoAuthenticated: false })
    expect(checks.find(c => c.id === 'mongo-auth')!.status).toBe('warn')
    expect(allPassed(checks)).toBe(true)
  })

  it('does not demand TLS or MFA on a local profile', () => {
    const local = runPreflight({ ...good, profile: 'local', tls: false, caps: { ...good.caps, localShell: true, requireMfaForOwner: false }, ownersWithoutMfa: ['x@y.z'] })
    expect(allPassed(local)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/preflight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/server/server/preflight.ts
/**
 * preflight.ts — the go-live checklist, as a pure function.
 *
 * `agentop doctor --exposed` prints these and exits non-zero on any failure. Every check maps to
 * a finding in docs/superpowers/plans/2026-07-25-public-exposure-hardening.md, so a red line
 * tells the operator exactly what to fix before opening a tunnel.
 */
import type { Capabilities, ExposureProfile } from './exposure'
import { validateSecret } from './secret-store'

export interface Check {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
}

export interface PreflightInput {
  profile: ExposureProfile
  caps: Capabilities
  sessionSecret: string | undefined
  password: string | undefined
  tls: boolean
  trustProxy: boolean
  bindIp: string
  allowedOrigins: string[]
  ownersWithoutMfa: string[]
  mongoAuthenticated: boolean
  ingestTokensCount: number
}

export function runPreflight(input: PreflightInput): Check[] {
  const strict = input.profile === 'public'
  const checks: Check[] = []

  const anyLocalPower = input.caps.localShell || input.caps.localChat || input.caps.localTranscripts || input.caps.mcpAdmin
  checks.push({
    id: 'local-shell',
    label: 'Local shell / chat / transcript routes are disabled',
    status: !strict || !anyLocalPower ? 'pass' : 'fail',
    detail: anyLocalPower
      ? 'POST /api/exec, /api/chat-tty, the transcript readers or /api/mcp-action are reachable. Set AGENTISTICS_EXPOSURE=public and unset AGENTISTICS_ALLOW_LOCAL_SHELL.'
      : 'All host-power routes return 403.',
  })

  const secret = validateSecret(input.sessionSecret, input.password)
  checks.push({
    id: 'session-secret',
    label: 'Session secret is strong and separate from the password',
    status: secret.ok ? 'pass' : 'fail',
    detail: secret.ok ? 'OK.' : `Invalid (${secret.reason}). Generate one with: openssl rand -hex 32`,
  })

  checks.push({
    id: 'tls',
    label: 'TLS is terminated in front of the app',
    status: !strict || input.tls ? 'pass' : 'fail',
    detail: input.tls ? 'AGENTISTICS_TEAM_TLS=1 — cookies are Secure + __Host- prefixed.' : 'Set AGENTISTICS_TEAM_TLS=1 once the tunnel terminates HTTPS.',
  })

  checks.push({
    id: 'bind-ip',
    label: 'App is not published on a public interface',
    status: !strict || input.bindIp === '127.0.0.1' || input.bindIp === 'localhost' ? 'pass' : 'fail',
    detail: `BIND_IP=${input.bindIp}. Behind a tunnel this must be 127.0.0.1 — the tunnel connects locally.`,
  })

  checks.push({
    id: 'trust-proxy',
    label: 'Forwarded-IP trust matches the deployment',
    status: !strict || input.trustProxy ? 'pass' : 'warn',
    detail: input.trustProxy
      ? 'AGENTISTICS_TRUST_PROXY=1 — rate limiting and audit see the real client IP.'
      : 'Without it every request looks like it came from the tunnel, so per-IP limits apply to all users at once.',
  })

  checks.push({
    id: 'owner-mfa',
    label: 'Every owner account has TOTP enrolled',
    status: !strict || input.ownersWithoutMfa.length === 0 ? 'pass' : 'fail',
    detail: input.ownersWithoutMfa.length ? `Missing for: ${input.ownersWithoutMfa.join(', ')}` : 'All owners enrolled.',
  })

  checks.push({
    id: 'cors',
    label: 'CORS is same-origin or an explicit allowlist',
    status: input.allowedOrigins.every(o => o.startsWith('https://')) ? 'pass' : 'fail',
    detail: input.allowedOrigins.length ? `Allowed: ${input.allowedOrigins.join(', ')}` : 'Same-origin only.',
  })

  checks.push({
    id: 'mongo-auth',
    label: 'MongoDB requires authentication',
    status: input.mongoAuthenticated ? 'pass' : 'warn',
    detail: input.mongoAuthenticated
      ? 'Credentials in MONGO_URL.'
      : 'Unauthenticated. Acceptable only while the port stays unpublished; enable --auth (see central.sh).',
  })

  checks.push({
    id: 'ingest-tokens',
    label: 'Machine tokens exist and are individually revocable',
    status: input.ingestTokensCount > 0 ? 'pass' : 'warn',
    detail: `${input.ingestTokensCount} token(s) minted.`,
  })

  return checks
}

export function allPassed(checks: Check[]): boolean {
  return checks.every(c => c.status !== 'fail')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/preflight.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the CLI command**

```ts
// packages/server/server/cli-doctor.ts
/** `agentop doctor [--exposed]` — print the go-live checklist and exit non-zero on failure. */
import { PROFILE, CAPS } from './exposure'
import { runPreflight, allPassed } from './preflight'
import { TEAM_SESSION_SECRET, TEAM_PASSWORD, TEAM_TLS, TRUST_PROXY, ALLOWED_ORIGINS, MONGO_URL } from './config'
import { listAccounts } from './accounts'
import { getMfa } from './mfa-store'
import { listMachines } from './team-tokens'

export async function runDoctor(argv: string[]): Promise<never> {
  const exposed = argv.includes('--exposed')
  const accounts = await listAccounts().catch(() => [])
  const owners = accounts.filter(a => a.role === 'owner')
  const ownersWithoutMfa: string[] = []
  for (const o of owners) if (!(await getMfa(o._id).catch(() => null))) ownersWithoutMfa.push(o.email)

  const checks = runPreflight({
    profile: exposed ? 'public' : PROFILE,
    caps: CAPS,
    sessionSecret: TEAM_SESSION_SECRET || undefined,
    password: TEAM_PASSWORD,
    tls: TEAM_TLS,
    trustProxy: TRUST_PROXY,
    bindIp: process.env.BIND_IP ?? '127.0.0.1',
    allowedOrigins: ALLOWED_ORIGINS,
    ownersWithoutMfa,
    mongoAuthenticated: /\/\/[^/@]+@/.test(MONGO_URL),
    ingestTokensCount: (await listMachines().catch(() => [])).length,
  })

  for (const c of checks) {
    const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'
    console.log(`${icon} ${c.label}\n    ${c.detail}`)
  }
  const ok = allPassed(checks)
  console.log(ok ? '\nReady to expose.' : '\nNOT ready — fix every ✗ above before opening the tunnel.')
  process.exit(ok ? 0 : 1)
}
```

Register it in `packages/server/bin/cli.ts` alongside the other subcommands.

- [ ] **Step 6: Verify and commit**

Run: `bun tsc --noEmit && bun test && bun run packages/server/bin/cli.ts doctor --exposed`
Expected: the checklist prints; exit code 1 until every control is configured.

```bash
git add packages/server/server/preflight.ts packages/server/server/preflight.test.ts \
        packages/server/server/cli-doctor.ts packages/server/bin/cli.ts
git commit -m "feat(cli): agentop doctor go-live preflight for exposed instances"
```

---

### Task 19: Operator runbook and supply-chain CI

Closes **F16** and documents the deployment the whole plan assumes.

**Files:**
- Create: `docs/exposure.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `Dockerfile` (pin the base image by digest)
- Modify: `CLAUDE.md` (register the new modules)

- [ ] **Step 1: Write the runbook**

Create `docs/exposure.md` covering, in order:

1. **Topology.** `cloudflared` runs on the same host, connects outbound to Cloudflare, and proxies to `http://127.0.0.1:48080`. No inbound port is opened; the app never binds a public interface. Never route Mongo through the tunnel.
2. **Required env** on the central (`central.env`):
   ```
   AGENTISTICS_TEAM_CENTRAL=1
   AGENTISTICS_EXPOSURE=public
   AGENTISTICS_TEAM_TLS=1
   AGENTISTICS_TRUST_PROXY=1
   AGENTISTICS_TEAM_SESSION_SECRET=<openssl rand -hex 32>
   BIND_IP=127.0.0.1
   MONGO_PASSWORD=<generated by central.sh>
   ```
   and explicitly **not** `AGENTISTICS_ALLOW_LOCAL_SHELL`.
3. **Tunnel setup**: `cloudflared tunnel create agentistics`, the ingress rule, running it as a service, and rotating the tunnel token.
4. **Cloudflare Access** in front of the login page as a second, independent authentication layer (deny-by-default). Document the one exception: `POST /api/team/ingest` and `/api/team/agent` must **bypass** Access or use a service token, because members and CI runners are not browsers. The cleanest split is a second hostname pointed at an `AGENTISTICS_INGEST_ONLY=1` instance sharing the same Mongo.
5. **WAF and rate limiting at the edge**: a rate-limiting rule on `/api/iam/login` and `/api/team/login` (10 req/min per IP), managed WAF rules on, bot fight mode on. The in-app limiter (Task 5) is the backstop, not the front line.
6. **Onboarding a person**: owner creates the account with `mustChangePassword`, sends the e-mail out of band, the user sets a policy-compliant password and enrols TOTP on first login.
7. **Incident response**: revoke a session (`bumpSessionVersion`), revoke a machine token, read the audit log, rotate the session secret (logs everyone out), rotate the tunnel token.
8. **Go-live checklist**: run `agentop doctor --exposed` and require a fully green output.

- [ ] **Step 2: Pin the base image and add dependency auditing**

In `Dockerfile`, pin by digest:

```dockerfile
FROM oven/bun:1@sha256:<digest> AS builder
```

Add to `.github/workflows/ci.yml`:

```yaml
      - name: Audit dependencies
        run: bun audit --audit-level=high

      - name: Verify the lockfile is unchanged
        run: git diff --exit-code bun.lock
```

Enable Dependabot for `bun`/`npm` and `docker` in `.github/dependabot.yml` with weekly checks.

- [ ] **Step 3: Update `CLAUDE.md`**

Add the new modules to the architecture tree (`exposure.ts`, `capability-guard.ts`, `rate-limit.ts`, `security-headers.ts`, `cors.ts`, `csrf.ts`, `client-ip.ts`, `password-policy.ts`, `totp.ts`, `mfa-store.ts`, `audit.ts`, `limits.ts`, `errors.ts`, `preflight.ts`, `secret-store.ts`, `index-routes.ts`) and add a new **Security rules** section:

```markdown
## Security rules

- **`exposure.ts` is the only place that decides what a profile may do.** Never re-derive a
  capability from env vars at a call site.
- **Any new route that touches the host** (spawn, read `~/.claude`, write a dotfile) must be
  registered in `capability-guard.ts`. A route that is not registered is assumed safe — so a
  missed registration is a vulnerability, not an oversight.
- **Any new `/api` route is authenticated by default.** Adding it to `AUTH_PUBLIC` requires a
  matching entry in `authz-gate.test.ts`, which is the review gate.
- **Never return internal error text to a client** — use `safeError`.
- **Never `await req.json()` directly** — use `readJsonLimited`.
- **Every auth/admin action writes an audit event.**
```

- [ ] **Step 4: Verify and commit**

Run: `bun tsc --noEmit && bun test`

```bash
git add docs/exposure.md .github/workflows/ci.yml .github/dependabot.yml Dockerfile CLAUDE.md
git commit -m "docs: exposure runbook, supply-chain auditing and security rules"
```

---

## Go-live checklist

Do not open the tunnel until every line is true:

- [ ] `agentop doctor --exposed` exits `0` with no `✗`.
- [ ] `curl -X POST https://<host>/api/exec -d '{"command":"id"}'` returns `403 capability_disabled`.
- [ ] `curl https://<host>/api/claude-sessions` returns `403 capability_disabled`.
- [ ] `curl https://<host>/api/data` without a cookie returns `401`.
- [ ] Six wrong logins in a row return `429` with `Retry-After`.
- [ ] `curl -sI https://<host>/` shows CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- [ ] `curl -sI -H 'Origin: https://evil.tld' https://<host>/api/health` emits **no** `Access-Control-Allow-Origin`.
- [ ] The session cookie in DevTools is named `__Host-agentistics_session` and shows `Secure`, `HttpOnly`, `SameSite=Strict`.
- [ ] Every owner account prompts for a TOTP code at login.
- [ ] A non-owner account sees only their own teams' data on `/api/data` (verify with two accounts).
- [ ] `ss -ltnp` on the host shows the app on `127.0.0.1`, not `0.0.0.0`; Mongo is not published.
- [ ] `docker compose exec app id` shows uid `10001`.
- [ ] The audit log records your own login (`GET /api/iam/audit` as owner).
- [ ] Cloudflare has a rate-limit rule on the login paths and the managed WAF ruleset enabled.

## References

- [OWASP Top 10:2025 — Introduction](https://owasp.org/Top10/2025/0x00_2025-Introduction/) — A01 Broken Access Control (now absorbing SSRF), A02 Security Misconfiguration, A03 Software Supply Chain Failures, A07 Authentication Failures, A09 Security Logging & Alerting Failures, A10 Mishandling of Exceptional Conditions.
- [OWASP API Security Top 10:2023 — API1 Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) — the per-team scoping tests in Task 16.
- [OWASP API Security Top 10:2023 — API4 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/) — Tasks 4, 5, 14.
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — `__Host-` prefix, `SameSite=Strict`, identifier renewal on privilege change (Task 9).
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — the Origin/`Sec-Fetch-Site` verification pattern (Task 8).
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) and [Blocking Brute Force Attacks](https://owasp.org/www-community/controls/Blocking_Brute_Force_Attacks) — 5–10 attempt threshold, timed auto-unlock, lockout-as-DoS caveat (Tasks 4, 5).
- [OWASP WSTG — Testing for Cookie Attributes](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/06-Session_Management_Testing/02-Testing_for_Cookies_Attributes) — the verification steps in the go-live checklist.
- [OWASP ASVS V3 — Session Management](https://github.com/OWASP/ASVS/blob/master/4.0/en/0x12-V3-Session-management.md) — idle and absolute timeouts (Task 9).
- [Cloudflare Zero Trust / Tunnel hardening guidance](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — outbound-only tunnel, Access in front of the login page, service tokens for machine-to-machine, never tunnel database ports (Task 19).
