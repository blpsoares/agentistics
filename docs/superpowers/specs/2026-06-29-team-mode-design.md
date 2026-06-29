# Team Mode — Design

**Status:** Draft for review
**Date:** 2026-06-29
**Topic:** Multi-user aggregation for agentistics (team consumption/usage dashboard)

## Problem

agentistics runs fully local and isolated on each developer's machine, reading
`~/.claude/`. A director or team lead cannot open a single place to see the
consumption/usage of devs A, B, and C — they must ask each one individually.

We want a mode that consolidates the **team total** while preserving **per-user
drill-down**, in the same application — exactly mirroring how the app already
separates data by harness/project today, but adding a `user` dimension.

## Goals

- A central instance that behaves as if every dev's `~/.claude/` were present on
  it, enabling: view dev A alone, view aggregate of A+B, aggregate of A+B+C, and
  total of all devs — plus cost/usage breakdowns per any of those slices.
- Purely additive: a dev who never configures team mode keeps today's exact Solo
  behavior. Nothing is forced.
- Configurable via the UI as much as honestly possible (see Feasibility tiers).
- The central never loses metrics: an opt-in autostart keeps a dev's pusher
  running across reboots.

## Non-goals (YAGNI / deferred)

- **Roles / RBAC** (director sees all, dev sees only self) — deferred to v2. v1
  uses a single team login that gates the whole central.
- **Redis / queueing** — not needed at team scale; Mongo change streams cover the
  realtime fan-out. Add only if the app tier scales horizontally or ingestion
  becomes bursty.
- **Local Docker/Mongo on the dev machine** — the dev side stays filesystem-based;
  Docker is only for the central.
- **Raw transcript shipping** — only computed metrics leave the dev machine (the
  existing `consolidate` format, no chat text).
- **SaaS multi-tenant rewrite** — out of scope; this stays local-first / on-prem.

## The three modes

The mode is an explicit, visible choice (a badge at the top shows the current
mode). Persisted in preferences / `.env.config`.

| Mode | Behavior | How it runs |
|---|---|---|
| **Solo** (default, today's behavior) | Reads only the local `~/.claude`. Nothing leaves the machine. | `agentop server` — zero new config. |
| **Team member** | Solo behavior **+** pushes consolidated deltas to a central. | `agentop server` + team config + optional autostart. |
| **Central / aggregator** | Source = Mongo instead of filesystem. Serves the multi-user dashboard with a `user` dimension. | `docker compose up -d` on the server. |

## Architecture

```
LOCAL (each dev, near-unchanged)            CENTRAL (Docker: app + mongo)
~/.claude ─▶ consolidate.ts ─┐
                             │   POST /api/team/ingest (Bearer token → user)
 uploader (deltas) ──────────┼─────────────▶ upsert Mongo
                             │               (_id = org:user:sessionId)
 config via PreferencesModal │               change stream ─▶ SSE ─▶ director browser
 (URL + name/email + token + │               UI = `user` dimension (multi-select filter)
  push on/off + autostart)   │               team login gate + token admin page
 secret in .env.config (0600)┘
```

### Data model — per-session grain, metrics-only

The unit stored centrally is **one document per session** — the existing
`SessionMeta` consolidated format (already produced by `consolidate.ts`,
metrics-only, no chat text), tagged with `org` + `user`.

Critically, totals are **not** pre-summed into irreversible rollups. The team
total *emerges* from summing sessions at render time using the existing
`@agentistics/core` functions (`calcCost`, `useDerivedStats`, etc.). This keeps a
single source of truth for all math and preserves every slice:

- dev A alone → filter `user ∈ {A}`
- aggregate A+B → filter `user ∈ {A, B}`
- aggregate A+B+C → filter `user ∈ {A, B, C}`
- total of all → no filter

This is the same shape as the existing project/harness filter — the new entity is
the dev.

**Mongo `sessions` collection** (illustrative):

```
{ _id: "acme:devA:<sessionId>",
  org: "acme", user: "devA",
  session_id, created, model, project,
  tokens/cost fields, agentMetrics, ... }   // = SessionMeta, metrics only
```

`_id = org:user:sessionId` makes ingestion an idempotent **upsert** (dedup by key,
"live wins" handled by Mongo instead of by hand in `data.ts`).

### Central read path

The central's `data.ts` gains a Mongo-backed source in place of the filesystem
roots. It loads `SessionMeta` docs from Mongo, exposes them through the same
`buildApiResponse` orchestration, and the existing derived-stats pipeline runs
unchanged — only now there is a `user` field to group/filter by.

Realtime: a **Mongo change stream** on the `sessions` collection drives the
existing SSE channel to the director's browser, replacing the chokidar file
watcher used in Solo mode.

### Local push path

The dev side stays filesystem-first. It gains a small **uploader** that reuses the
delta detection already in `consolidate.ts` (`skip-if-identical`) — it POSTs only
new/changed consolidated docs to `POST /api/team/ingest`, on the same cadence the
consolidate write already happens. Payloads are KB-sized. Failures retry on the
client; no server-side queue.

## Security

- **Ingestion: always Bearer token.** Non-negotiable — guarantees that even a
  publicly-reachable central only accepts writes from holders of a valid token.
  Tokens are **minted by the central** (so identity is trustworthy, not
  self-asserted) and mapped to a `user`.
- **Viewing: a single team login (one shared password/token) gates the entire
  central** — both the dashboard and the token-admin page. This is barely more
  work than fully-open and closes the "someone found the internal URL" hole. The
  token-admin page *requires* this gate (otherwise anyone could mint tokens).
- **Roles (director vs dev):** deferred to v2.
- **Network-agnostic ("bring your own network"):** the central is a plain
  HTTPS + token server. Operators expose it however they like — Tailscale, VPN, or
  public TLS. The app never couples to Tailscale or any specific network layer.
- **Local secret storage:** the dev's Bearer token lives in `.env.config` with
  `0600` perms — the standard for dev tooling (`~/.npmrc`, `~/.aws/credentials`).
  At-rest encryption / OS keychain is a possible v2 nicety, not v1.

## Identity

- The central mints an **enrollment token per dev** (or a single team token for an
  MVP). The dev pastes `central URL` + `name/email` (their identity) + `token`
  into the local UI. The central maps `token → user`.
- Spoofing *within the team* (dev A claiming to be dev B) is not a real threat
  model for a productivity dashboard among colleagues — we do not over-engineer
  against it in v1.

## UI surfaces

**Local (dev) — new "Team" tab in `PreferencesModal`:**
- Mode selector (Solo / Team member)
- Server URL + your name/email + paste token
- **Test connection** button (validates token against the central, shows ✓/✗)
- Push on/off toggle
- **Autostart on boot** toggle (opt-in, default OFF)
- Status line ("last push: 3s ago ✓")

**Central — new "Team / Members" admin tab (only visible in Central mode, behind
the team login):**
- **Generate access token** → pick the dev's label (e.g. `devA` / email) → token
  shown once to copy
- Member list with **last-seen** ("last push") and a **Revoke** button

**Dashboard — new `user` dimension:**
- A multi-select user filter, sibling to the existing project/harness filter.
- No selection = team total; selecting a subset = aggregate of that subset.

## Autostart (opt-in)

Default OFF. When enabled via the toggle, the UI writes the OS-appropriate
mechanism; disabling removes it. Reversible from the same screen.

- Linux: a systemd **user** service
- macOS: a launchd agent
- Windows: the existing Tauri desktop app's autostart plugin (natural path), or a
  Task Scheduler entry

The central auto-restarts via Docker `restart: always` (no per-dev autostart
needed there).

## Feasibility of "configure everything via UI" — honest tiers

- **🟢 100% via UI** (infra already exists — `PreferencesModal` *Environment* tab +
  `env-config.ts` runtime persistence): mode selection, endpoint/identity/token,
  push on/off, connection status, central token generation/revocation.
- **🟡 Via UI button that shells out to the OS** (~80%, OS-specific): "autostart on
  boot" — writes systemd/launchd/Tauri autostart; a manual command is documented
  as fallback.
- **🔴 Cannot be pure-UI (chicken-and-egg)**: bootstrapping the central Docker
  stack the first time — the UI is served *by* the app, so it cannot bring itself
  up on a bare host. The central is born from **one command**
  (`docker compose up -d` with a provided `compose.yml`). The UI *can* provide a
  **wizard that generates** the `compose.yml` + `.env` to copy/download. After it
  is up, the rest of the central is UI-managed.

## Components / boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `team-config` (local) | read/write team mode, endpoint, identity, token, autostart flag | `env-config`, `preferences` |
| `team-uploader` (local) | detect deltas, POST to central with retry | `consolidate`, `team-config` |
| `autostart` (local) | install/remove OS service per the toggle | OS, Tauri autostart |
| `team-ingest` (central) | `POST /api/team/ingest`, validate token → user, upsert | Mongo, `tokens` |
| `team-source` (central) | load `SessionMeta` from Mongo for `buildApiResponse` | Mongo, `@agentistics/core` |
| `team-stream` (central) | Mongo change stream → SSE | Mongo, `sse` |
| `team-admin` (central) | generate/revoke tokens, member last-seen | Mongo, team login |
| `team-login` (central) | single team-password gate for dashboard + admin | — |
| `user` filter (web) | multi-select user dimension in the dashboard | `useData`, app-context |
| `compose` (deploy) | `compose.yml` + `.env` template + wizard generator | Docker |

## Testing

Following the project rule (test pure functions, no filesystem mocking):
- Token mint/validate logic (pure)
- Delta-selection for the uploader (pure, given a set of consolidated docs)
- The `user`-dimension aggregation in derived stats (pure — feed sessions with
  `user`, assert per-subset and total sums)
- `_id` keying / upsert-shape helpers (pure)
- Ingestion route and Mongo wiring covered by an integration-style test against a
  local/ephemeral Mongo (out of the pure-unit suite).

## Suggested phased rollout

This is large; the implementation plan should phase it so each phase is shippable:

1. **`user` dimension end-to-end, filesystem-fed.** Add `user` to `SessionMeta`
   and the dashboard multi-select filter; feed the central from a folder union
   (the cheap "option B" transport) to validate the whole UX before any Mongo or
   ingestion API exists.
2. **Central Mongo source + ingestion API + local uploader.** Replace the folder
   source with Mongo; add `POST /api/team/ingest`, the local team-config UI, and
   the uploader. Change-stream SSE. **Also resolves the Phase 1 limitation** where
   the unfiltered team-total Cost/Tokens read 0 on a dedicated empty central:
   deriving all totals from per-session Mongo docs removes the reliance on a local
   `statsCache` for the no-selection view.
3. **Security + admin.** Team login gate, token mint/revoke admin page, last-seen.
4. **Autostart + Docker packaging.** Autostart toggle per OS; `compose.yml` +
   wizard.

## Open questions / risks

- **Cross-machine session-id collisions:** the `org:user:sessionId` key assumes
  session ids are unique per dev; confirm Claude Code session ids are UUIDs (they
  are in current data) so the compound key is safe.
- **Identity rename:** if a dev changes their `name/email`, prior docs keep the old
  `user`. v1 accepts this; a remap tool is a possible v2.
- **Token storage on central:** tokens table in Mongo (hashed) vs. a config file —
  lean to hashed-in-Mongo so revoke is live.
- **Time zones / date bucketing across devs:** confirm dates are normalized
  consistently when aggregating across machines in different TZs.
- **[Phase 1 limitation, Phase 2 fixes] Empty-central team-total Cost/Tokens = 0:**
  in Phase 1's folder transport, the no-user-selection Cost/Tokens KPIs derive from
  the central's local `statsCache`, which is empty on a dedicated central. Drill-down
  (any user selected) is correct; only the unfiltered aggregate of Cost/Tokens is
  affected. Phase 2's Mongo source (per-session derivation) resolves it.
