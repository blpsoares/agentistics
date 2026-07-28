# Multi-central connections and per-connection repository sharing

**Spec date:** 2026-07-28
**Path:** `docs/superpowers/specs/2026-07-28-multi-central-and-repo-sharing-design.md`
**Status:** design agreed — implementation not started
**Areas touched:** `packages/core` (team types), `packages/server` (uploader, agent client, preferences, routes, CLI, new `share-rules.ts`), `packages/web` (Settings → Connection, repo surfaces, sidebar pill)
**Central-side code:** one additive optional field on `GET /api/team/policy` (see §7)

---

## 1. Summary

A machine can today push its metrics to exactly one central, and it pushes *everything* it has. This design turns the single flat `preferences.team.{endpoint,org,user,token}` into a list of first-class `TeamConnection` objects, each with its own identity, its own push cadence, its own sent-state file, its own WebSocket and its own **denylist of repositories** that must never reach that central. A new pure module `packages/server/server/share-rules.ts` decides, without I/O, which sessions and workflow runs a given connection may receive, and — when a connection declares any restriction — builds a **synthetic Claude `StatsCache`** from only the shared sessions, so the aggregate totals cannot carry the volume or cost of a blocked repo. Rule changes are applied retroactively by calling the existing `POST /api/team/leave` on that central and immediately re-pushing the already-filtered history, journalled on disk so a crash mid-purge self-heals on the next boot.

The denylist itself is never transmitted, and the honesty markers that describe it stay strictly local. What this design does **not** claim is that a central cannot tell that a filter exists: a purge followed by a re-ingest, and a statsCache whose totals match the member's own session docs exactly, are both observable. §6.4 states the guarantee precisely — *which* repos are hidden is protected; *that* something was hidden is not — and the UI says so at the moment the user commits.

---

## 2. Decisions (the contract)

These seven decisions are fixed. The rest of the document designs *around* them; it does not revisit them.

**D1 — Multi-central.** A machine may connect to N centrals. `preferences.team` gains `connections: TeamConnection[]` (`id`, `endpoint`, `org`, `user`, `token`, `deniedRepos[]`). The legacy flat `team.{endpoint,org,user,token}` migrates to `connections[0]`.

**D2 — Per-connection repo restriction, denylist semantics.** Each connection shares everything *except* the repositories marked on **that** connection. The list is editable at any time on an already-active connection. A repository that appears later is **shared by default**. Sessions with no resolvable git remote form one blockable entry ("No repository") in the same list — pre-blocked the moment the connection acquires its first restriction (§4.2), because "unattributable" is not the same fact as "new".

**D3 — Synthetic statsCache when restricted.** When a connection **declares** any restriction, the machine must **not** push the real `~/.claude` statsCache — it is Claude-only, aggregated, has no repo granularity, and would carry the blocked repo's volume and cost. It pushes a synthetic `StatsCache` built only from the sessions shared with that connection. A connection with an empty denylist keeps pushing the real supplemented cache, byte-for-byte as today.

**D4 — Retroactive removal via the existing leave route.** The central never receives the denylist. When the shared set shrinks, the machine calls the existing `POST /api/team/leave` (purges all of this member's data on that central) and immediately re-pushes the already-filtered history. Idempotent and self-healing.

**D5 — Connection as a first-class unit.** Every module-level singleton in `team-uploader.ts` (`_lastSuccessAt`, `_authErrStreak`, `_pushErrKind`, `_centralIntervalSec`, `_netErrStreak`, `running`, sent-state file, sync signature) and in `team-agent-client.ts` (`activeWs`, `backoffIdx`) becomes a `Map` keyed by connection id. One timer chain, one sent-state file (`team-sent-<connId>.json`) and one WebSocket per connection. Functional module style is preserved — no classes.

**D6 — New pure module `share-rules.ts`.** `sessionShared`, `filterShared`, `buildSharedStatsCache` — unit-tested, zero I/O. The accumulation logic currently inlined in `supplementStatsCache` (`data.ts` ~510) is extracted and shared.

**D7 — UI and CLI split.** Settings → Connection becomes a list of central cards (status pill, hidden-repo count) plus "Add central", each card expanding in place (accordion) to identity/endpoint/cadence, the repo toggle list, and Disconnect. CLAUDE.md's mobile rules are mandatory (44px targets, 16px inputs, no horizontal page scroll at 390px). The CLI (`agentop member connect/leave/status`, `cli-start.ts`, `cli-setup.ts`) understands multiple centrals; **repo rules are web-only** — no CLI surface.

---

## 3. Data model

### 3.1 `TeamConnection` and `TeamConfig` — `packages/core/src/team.ts`

Both types stay in **core**: `packages/web/src/components/TeamSettings.tsx` imports and re-exports `TeamConfig` from `@agentistics/core`, and the new web components need `TeamConnection`, `NO_REPO_KEY` and the migration helper.

```ts
export interface TeamConnection {
  /** Local, opaque, filesystem-safe handle. Never sent to a central. */
  id: string                    // "c_" + 12 lowercase hex
  endpoint: string              // no trailing slash — the UNIQUENESS KEY (§3.2)
  org: string                   // 'default' unless the central says otherwise
  user: string                  // resolved from GET /api/team/whoami — never user-typed
  token: string                 // raw secret (already unpacked from act1_); may be '' on an open central
  /** DENYLIST. canonical repo keys (§4.2), plus NO_REPO_KEY. [] = share everything. */
  deniedRepos: string[]
  /** Member-side mirror of the central's cadence; the central still owns the floor. */
  pushIntervalSec?: number
  /** Optional nickname for the card; falls back to the endpoint host. */
  label?: string
  addedAt?: string              // ISO — deterministic card ordering
}

export interface TeamConfig {
  /** Written by this version and above. Absent ⇒ the config was written by an older client. */
  schema?: 2
  mode: 'solo' | 'member'
  connections: TeamConnection[]
  /** Legacy MIRROR of connections[0]. Still WRITTEN for one release (§10), read by migrate. */
  endpoint?: string; org?: string; user?: string; token?: string; pushIntervalSec?: number
}

export const DEFAULT_TEAM: TeamConfig = { schema: 2, mode: 'solo', connections: [] }
export const NO_REPO_KEY = '__no_repo__'
```

`mode` is **kept** rather than derived at ~12 call sites, but it is an invariant enforced on write: `normalizeTeamConfig()` sets `mode = connections.length ? 'member' : 'solo'`. A config with `mode: 'member'` and `connections: []` is unrepresentable after normalization, so the uploader can never spin on nothing.

`user` **moves into the connection**. Each central mints its own token and resolves its own display name; a machine genuinely has N names. The flat `team.user` survives only as part of the compatibility mirror, so TypeScript flags every site that assumed one canonical name.

The legacy flat fields are **not deleted on write.** §10 requires a downgrade and an older sidecar (the Docker machine image mounting the same `~/.agentistics`) to keep working: `normalizeTeamConfig` mirrors `connections[0]`'s `endpoint/org/user/token/pushIntervalSec` into the flat fields on every write, and writes `mode: 'solo'` with **empty** flat fields when `connections` is empty. `schema: 2` is what lets a v2 reader distinguish "written by an old client" (no `schema`, no `connections`) from "genuinely solo".

`'central'` is not, and never was, a `TeamConfig.mode` — central-ness comes from `AGENTISTICS_TEAM_CENTRAL=1`. The dead local `type Mode = 'solo'|'central'|'member'` in `cli-start.ts` / `cli-status.ts` stays dead; do not "fix" it here.

### 3.2 Connection id and the uniqueness key

```ts
export function connectionId(): string          // "c_" + crypto.randomUUID().replace(/-/g,'').slice(0,12)
export function legacyConnectionId(endpoint: string, token: string): string
                                                // "c_" + sha256(`${endpoint}\0${token}`).slice(0,12)
```

**A new connection's id is random and minted once at add-time.** Deriving it from `endpoint` breaks the moment a LAN IP becomes a DNS name; deriving from `token` breaks on rotation, a supported admin action; deriving from `instanceId` is unavailable offline at connect time. `c_` + 12 hex wins over a full UUID: short enough to read in a filename and a log line, charset `[a-z0-9_]` trivially validated, 48 bits ample for a hand-curated list. Uniqueness within `connections[]` is checked at mint time.

**The one exception is the legacy migration**, and it is load-bearing. `migrateTeamConfig` runs in a read path (§3.3); a random id there would mint a *different* handle on every read until something happens to persist it — a new sent-state file, a full re-push, a new WebSocket and a GC deletion, every cycle, forever. The migration path therefore uses `legacyConnectionId(endpoint, token)`, so two concurrent readers converge on the same handle, and the persisting boot migration (§3.3) then makes the stored id authoritative and never re-derives it.

The id must be **sanitized on use** (`/^c_[a-f0-9]{12}$/`) before interpolation into a path, because it arrives from an HTTP body on the connection routes and `../` would escape `~/.agentistics`.

**The uniqueness key of a connection is its normalized `endpoint`, and a token may appear at most once across `connections[]`.** Both rules are enforced by `POST /api/team/connections` and by `member connect`:

- A connect to an endpoint already present **updates that connection in place** — token, org and re-resolved `user` are refreshed; `id`, `deniedRepos` and `label` are preserved. Token rotation is the documented admin action and is exactly when the user re-runs connect; appending a second, unrestricted connection there would silently re-share a blocked repo *and* double-count the machine on the central (a different token means a different `memberId = sha256(token)`, so the same machine exists twice and `userStatsCaches` sums it twice by display name).
- A connect carrying a token that already belongs to a **different** connection is refused. Two endpoints sharing one token collapse onto one `memberId`: the two connections would alternately `replaceOne` the same `memberStats` document (flipping the machine's reported totals between the real and the synthetic cache on every push), and a purge on one would delete the other's sessions while leaving its sent-state intact, so they would never come back.

The id is a purely local handle. The central keys members by `memberId = sha256(token)`; the id is never in any request body sent off-machine.

### 3.3 Migration from the legacy flat config

Migration is **split in two**: a pure, deterministic, idempotent shape migration that runs on every read, and a one-shot, persisting, side-effecting state migration that runs once at boot.

```ts
// core/team.ts — pure, no I/O, safe in a read path and in tests
export function migrateTeamConfig(raw: unknown): TeamConfig
export function normalizeTeamConfig(cfg: TeamConfig): TeamConfig
```

Rules, in order:

1. `raw` falsy or not an object → `DEFAULT_TEAM`.
2. `Array.isArray(raw.connections)` → already migrated. Sanitize each entry: drop entries missing `endpoint`, strip trailing slashes, `deniedRepos ??= []`, mint `id` if absent, dedupe by `id` and by normalized `endpoint`. Then normalize `mode` and rebuild the legacy mirror.
3. No `connections`, but `raw.endpoint` → legacy flat config →
   `connections = [{ id: legacyConnectionId(endpoint, token ?? ''), endpoint: trimSlashes(raw.endpoint), org: raw.org || 'default', user: raw.user ?? '', token: raw.token ?? '', deniedRepos: [], pushIntervalSec: raw.pushIntervalSec }]`, `mode: 'member'`.
4. Anything else → `{ schema: 2, mode: 'solo', connections: [] }`.

Guard step 3 on **`endpoint` alone**, not on `endpoint && token` and not on `mode === 'member'`. Not on mode, because `cli-setup.ts` and the web solo path both write a solo object that still carries empty-string `endpoint`/`token`, and a fabricated connection from empty strings would make a solo machine start an uploader — hence the empty-string check on `endpoint`. Not on `token`, because token-less members are still a live shape: `pushOnceDetailed` today requires `endpoint && user` and treats `token` as optional, and the central's open/legacy ingest fallback accepts them. Requiring a token would silently drop those members to solo, stop their pushes, print `solo` in `member status`, and let the GC delete their sent-state so a later rejoin re-pushes everything. §7's "refuse to purge without a minted token" then correctly refuses the *retroactive-removal* path for such a connection instead of disconnecting it.

**Where the pure migration runs:** inside `readPreferencesFrom()` in `packages/server/server/preferences.ts`, applied to the merged object *after* `{...DEFAULT_PREFS, ...p}`. One choke point covers every reader (CLI, uploader, WS client, GET/PUT `/api/preferences`). Migrating only in the uploader would leave `cli-status.ts`, `cli-start.ts` and `bin/cli.ts` reading the un-migrated shape.

`migrateTeamConfig` must return a **fresh object with a fresh array on every call**. `DEFAULT_PREFS.team` is a shared mutable object spread into every read, and `team-uploader.ts` already mutates `team.endpoint` in place; with an array field that aliasing becomes a live cross-caller bug.

```ts
// server/team-migrate.ts — impure, runs ONCE
export async function migrateTeamStateOnce(): Promise<void>
```

Called from `index.ts` boot and from `startUploader()`, guarded by a module-level single-flight promise **and** a marker file `~/.agentistics/connections/.migrated-v2`. It:

1. takes the preferences write lock (§5.8) and persists the migrated `connections[]` (+ the legacy mirror + `schema: 2`), so every subsequent read sees a stored id rather than a derived one;
2. when `connections.length === 1` and the files exist, moves `~/.agentistics/team-sent.json` → `connections/team-sent-<id>.json` and `team-sync.json` → `connections/team-sync-<id>.json`;
3. **converts** the sent-state losslessly rather than discarding it. The v1 stored value *is* `JSON.stringify(session)`, so `v2hash = sha256(v1value)` (§5.4) — an offline, exact conversion. The rename exists to avoid a fleet-wide thundering herd; discarding the hashes would make the rename buy nothing;
4. seeds `connections/team-sync-<id>.json` with the existing `{sig}` **plus `rulesHash: denialSignature([])`**, so the first post-upgrade cycle does not read a missing `rulesHash` as a rules change;
5. writes the marker file.

Nothing in this function may run from `readPreferencesFrom`. That function is exported for tests with tmp paths while the sent/sync paths are module constants from `config.ts`; a rename there would touch the developer's real `~/.agentistics`, and — since a pure read persists nothing — it would re-run on every read forever.

### 3.4 Per-connection files

```
TEAM_CONN_DIR        = AGENTISTICS_TEAM_CONN_DIR ?? join(HOME_DIR, '.agentistics', 'connections')
teamSentFile(connId) = join(TEAM_CONN_DIR, `team-sent-${connId}.json`)
teamSyncFile(connId) = join(TEAM_CONN_DIR, `team-sync-${connId}.json`)   // { sig }
teamRulesFile(connId)= join(TEAM_CONN_DIR, `team-rules-${connId}.json`)  // { rulesHash, sharedIds[] }
teamPurgeFile(connId)= join(TEAM_CONN_DIR, `team-purge-${connId}.json`)
```

`team-rules-*.json` is **deliberately separate from the sent-state and from the sync signature**. The sig path clears the sent-state on a token rotation or a wiped central; if `rulesHash` and the last-pushed shared-id set lived in either of those files, a rotation coinciding with a rules change would erase the evidence of the change, the shrink detector would evaluate against an empty set, the purge would never run, and previously-pushed denied sessions would remain on a central that was never wiped.

The old single-path env overrides `AGENTISTICS_TEAM_SENT_FILE` / `AGENTISTICS_TEAM_SYNC_FILE` are honoured **only while `connections.length === 1` and only until `migrateTeamStateOnce()` has run**; afterwards they are ignored with a single boot warning naming the new paths, and `POST /api/team/connections` **hard-errors** when a second connection is added while either is set. "`connections[0]`" is an array position and `removeConnection` splices: a revoked first connection would silently hand its pinned sent-state to a different central, which would then treat every session in it as already sent and never deliver them. A boot-time warning cannot cover a runtime reorder.

**Garbage collection.** GC of `team-sent-*` / `team-sync-*` / `team-rules-*` / `team-purge-*` whose id is not in `connections[]` runs **only inside the serialized preferences write that mutated `connections[]`**, against the post-write array — never on a timer. A timer GC races the add route (a tick whose prefs snapshot predates the append deletes the brand-new connection's sent-state, forcing a full re-push, and loops if the add path retries) and races the preferences write itself (`Bun.write` truncates in place; a torn read falls through to `DEFAULT_PREFS`, whose `connections` is `[]`, and the tick would delete *every* connection's state).

Re-adding a removed central mints a **new** id, gets empty state, and re-pushes in full — that is the correct self-healing behaviour and the only thing that prevents stale-state resurrection.

### 3.5 Type ownership summary

| Type / constant | Package | Why |
|---|---|---|
| `TeamConnection`, `TeamConfig`, `DEFAULT_TEAM`, `NO_REPO_KEY`, `connectionId`, `legacyConnectionId`, `migrateTeamConfig`, `normalizeTeamConfig`, `readTeamConnections(prefs)` | `@agentistics/core` (`team.ts`) | consumed by server *and* web; `NO_REPO_KEY` must be one constant on both sides |
| `share-rules.ts` (all of it) | `packages/server/server` | server-only, but pure; sibling of `tags-resolve.ts` in style |
| `ShareTarget`, `buildShareTargets`, `hostOf`, `plural` | `packages/web/src/lib/shareRepos.ts` | presentation-only projection of `AppData.sessions` |

`readTeamConnections(prefs)` exists so the three web-local duplicates of `DEFAULT_TEAM_CONFIG` (`ConnectionSettings.tsx`, `MachinesSettings.tsx`, `TeamSettings.tsx`) can be deleted — leaving them would spread `connections: undefined` over a loaded prefs object and `.map` would throw in the new list UI.

---

## 4. `share-rules.ts` — the pure module

**Contract:** no I/O, no Mongo, no `preferences`, no `config` import. Only `@agentistics/core` types, `normalizeGitRemote` and `emptyStatsCache`.

### 4.1 Signatures

```ts
export type RepoKey = string

/** Case-folded, alias-folded comparison key. Display keys keep their original case. */
export function canonicalRepoKey(key: string): RepoKey

/** Denylist as stored on TeamConnection.deniedRepos → a canonical lookup set. */
export function normalizeDenied(denied: readonly string[] | null | undefined): Set<RepoKey>

export interface PathRepoIndex {
  /** project_path → the remote it resolves to (canonical). */
  resolved: Map<string, RepoKey>
  /** project_path → every distinct remote ever seen under it (canonical), when > 1. */
  conflicts: Map<string, Set<RepoKey>>
}
/** Learned from sessions that carry a remote AND from ServerProject.gitRemote. */
export function buildPathRepoIndex(
  sessions: readonly SessionMeta[],
  projects?: readonly { path: string; gitRemote?: string }[],
): PathRepoIndex

/** The repo bucket a session belongs to (canonical). Never returns ''. */
export function repoKeyOf(
  s: Pick<SessionMeta, 'git_remote' | 'project_path'>,
  index?: PathRepoIndex,
): RepoKey

export function sessionShared(
  s: Pick<SessionMeta, 'git_remote' | 'project_path'>,
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): boolean

/** Preserves input order, returns a new array, never mutates. */
export function filterShared<T extends Pick<SessionMeta, 'git_remote' | 'project_path'>>(
  sessions: readonly T[], denied: ReadonlySet<RepoKey>, index?: PathRepoIndex,
): T[]

/** Sessions the denylist actively excludes — the ONLY legitimate purge trigger (§5.5). */
export function deniedSessionIds(
  sessions: readonly SessionMeta[], denied: ReadonlySet<RepoKey>, index?: PathRepoIndex,
): Set<string>

export function sharedSessionIds(sessions: readonly Pick<SessionMeta, 'session_id'>[]): Set<string>

/** A run has no repo — it is shared iff its owning session is. Fails CLOSED. */
export function filterSharedWorkflows(
  runs: readonly WorkflowRun[], sharedIds: ReadonlySet<string>,
): WorkflowRun[]

/** Synthetic Claude StatsCache derived ONLY from the sessions passed in. */
export function buildSharedStatsCache(
  sessions: readonly SessionMeta[], opts?: { version?: number },
): StatsCache

/** Earliest local day covered by a set of sessions — LOCAL disclosure only (§4.4). */
export function coverageFrom(sessions: readonly SessionMeta[]): string

/** Stable fingerprint of a denylist — drives the purge-and-repush trigger. */
export function denialSignature(denied: readonly string[] | null | undefined): string
export function hasRestrictions(denied: readonly string[] | null | undefined): boolean

/** Route-side helper: the fail-closed default applied when restrictions first appear. */
export function withUnresolvedDenied(denied: readonly string[]): string[]

/** Extracted from data.ts supplementStatsCache — the shared accumulation core. */
export interface ClaudeAccumulator {
  dailyActivity: Map<string, { messageCount: number; sessionCount: number; toolCallCount: number }>
  dailyModel: Map<string, Map<string, number>>
  modelTotals: Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
  hourCounts: Map<number, number>          // session START hour
  totalSessions: number
  totalMessages: number
  firstStart: string                       // earliest ISO start_time, '' if none
}
export function accumulateClaudeSessions(
  sessions: readonly SessionMeta[],
  opts?: { after?: string; claudeOnly?: boolean },
): ClaudeAccumulator
```

### 4.2 Semantics

- **`canonicalRepoKey`** lowercases the whole key and folds a leading `ssh.` / `altssh.` host label. `normalizeGitRemote` lowercases the host but **preserves path case** and does not alias SSH front-doors, so the same repo cloned as `git@github.com:Acme/API.git` and as `https://github.com/acme/api` produces two distinct keys — two picker rows, two independent rules, and blocking the one the user recognizes leaves the other shared. Canonicalization lives here, not in core: `normalizeGitRemote` also keys the Repositories page and tags, and changing it there has a blast radius this feature does not need.
- **`repoKeyOf`** — `canonicalRepoKey(normalizeGitRemote(s.git_remote))` if non-empty; else `index.resolved.get(s.project_path)` if present; else `NO_REPO_KEY`. Re-normalizing is idempotent and cheap insurance against a legacy consolidate-store entry written before normalization.
- **`sessionShared`** = `!denied.has(repoKeyOf(...))` **and** — when `index.conflicts` holds an entry for `s.project_path` — no member of that conflict set is denied. A project directory that resolves to more than one remote is shared only if **every** remote under it is shared. `scanProjectDir` stamps one remote on every session of a directory and `getProjectGitStats` even scans one level of subdirectories for workspace folders, so a workspace holding a shared and a blocked repo would otherwise ship the blocked repo's `first_prompt` and `title` under the shared key. A privacy control that annotates the ambiguity and shares anyway is a fail-open.
- **Denylist semantics for resolved repos:** a key not in the set is shared, so genuinely new repos share by default (D2).
- **Unresolved sessions fail closed.** `NO_REPO_KEY` covers remote-less folders, non-Claude sessions whose adapter never sets `git_remote`, and store entries written before remote stamping — none of which is "a new repository", and all of which carry `project_path`, `first_prompt`, `title` and cost. The routes therefore apply `withUnresolvedDenied()` when a connection transitions from zero restrictions to any restriction: `NO_REPO_KEY` is **written into the persisted list**, rendered pre-blocked in the picker, and can be un-blocked only by an explicit user toggle. The persisted list stays the single authority on behaviour — no hidden runtime rule can contradict what the card shows.
- **`normalizeDenied`** — an entry equal to `NO_REPO_KEY` or `''` folds to `NO_REPO_KEY`; anything else goes through `normalizeGitRemote` then `canonicalRepoKey`; values that normalize to `''` are dropped as junk.
- **The sentinel is `NO_REPO_KEY = '__no_repo__'`, not `''`.** `''` in a persisted JSON array is silently eaten by any `.filter(Boolean)` in the UI or CLI path, turning "block unattributed work" into "block nothing" — a fail-open privacy bug. `normalizeDenied` **accepts** `''` for compatibility, but only `'__no_repo__'` is ever persisted. Collision is impossible: `normalizeGitRemote` returns `''` unless the result contains a `/`, and the sentinel has none.
- **`filterSharedWorkflows` fails closed.** A run whose `sessionId` matches no shared session is dropped — including a run whose session is simply unknown to the local store. `WorkflowRun` carries `name`, `phases`, `agents[].label` and `totals`, which leak task descriptions and cost from the blocked repo.
- **`buildSharedStatsCache` ignores every session with `(s.harness ?? 'claude') !== 'claude'`.** `stats-cache.json` is Claude-only by project rule; non-Claude sessions reach the central as sessions and are summed there. This is a **deliberate difference** from today's `supplementStatsCache`, which counts all harnesses in `dailyActivity` (safe there only because it runs before the non-Claude merge). Getting this wrong double-counts every non-Claude session on the central.
- **`buildPathRepoIndex` is seeded from `ServerProject.gitRemote` as well as from sessions.** Only `copilot.ts` among the non-Claude adapters sets `git_remote`, and `data.ts` runs its persisted `backfillGitRemote` pass against the **Claude-only** session array before the harness merge — so the consolidate store carries every Codex / Gemini / Kimi / agy session with no remote, permanently. A directory used *exclusively* by a non-Claude harness has no session to learn from; the project record does. Everything the index still cannot resolve lands in `NO_REPO_KEY`, which is fail-closed by the rule above.

### 4.3 Synthetic `StatsCache`, field by field

Verified against a real `~/.claude/stats-cache.json` (version 4, 255 sessions), not assumed.

| Field | Synthetic value | Rationale |
|---|---|---|
| `version` | `opts.version ?? 1` | copy from the real cache when available so `mergeStatsCaches` (max) sees no regression. Cosmetic. |
| `lastComputedDate` | `''` | The field asserts "Claude has already rolled up every day to here". A synthetic cache has not covered the days Claude's 30-day sweep deleted. Claiming a watermark it cannot back makes any consumer running the `day <= lastComputed → skip` guard drop legitimate gap-fill. `''` disables the guard; under-count in that direction becomes impossible. |
| `dailyActivity[]` | per local day of `start_time.slice(0,10)`: `messageCount = user + assistant`, `sessionCount += 1`, `toolCallCount = Σ tool_counts`. Sorted. **Claude sessions only.** | identical to `data.ts` 523-527 plus the harness gate |
| `dailyModelTokens[]` | per day per `s.model` **only when `model.startsWith('claude-')`**: `+= input + output + cacheRead + cacheCreation`. Sorted. | identical to `data.ts` 538-540; skips `<synthetic>` and foreign ids |
| `modelUsage{}` | per claude-model: the four token sums | identical to `data.ts` 576-592 |
| `modelUsage[].webSearchRequests` | `0` | unknowable per-session (`SessionMeta` has `uses_web_search: boolean`); the real cache also reports 0 |
| `modelUsage[].costUSD` | `0` | **correct, not a shortcut** — the real cache stores 0 too; every consumer prices via `calcCost(u, modelId)`. A real number here would make the synthetic cache behave *differently* from a real one |
| `totalSessions` | count of shared Claude sessions | invariant on the real file: `totalSessions === Σ dailyActivity.sessionCount`. Assert in a test |
| `totalMessages` | `Σ (user + assistant)` | same invariant holds on the real file |
| `longestSession` | `{ sessionId:'', duration:0, messageCount:0, timestamp:'' }` | honestly unknowable. The real field is wall-clock ms **including idle**; `duration_minutes` is active time. Synthesizing `minutes*60000` puts incompatible units into `mergeStatsCaches`'s max. Nothing in `web/` reads it (the dashboard derives it from sessions), so zeroing costs nothing |
| `firstSessionDate` | earliest `start_time` as a **full ISO string**, `''` if none | the real value is `2026-02-06T00:53:42.012Z`, not a `YYYY-MM-DD`; a date-only string compares wrong in `mergeStatsCaches` |
| `hourCounts{}` | **session START hour**, key `'0'..'23'`, `getHours()` on `start_time` (local clock) | the trap. On the real file `Σ hourCounts === totalSessions` — it counts *sessions by start hour*. The dashboard's session-derived `hourCounts` counts *messages* via `message_hours`. A synthetic cache substitutes for a real one on the central, so it must use the real cache's semantics; using `message_hours` inflates the Compare hour histogram by ~400× |
| `totalSpeculationTimeSavedMs` | `0` | no per-session counterpart exists |

`buildSharedStatsCache` starts from `emptyStatsCache()` and fills; it never mutates its input. **No field marks the cache as synthetic**, and no new field is added to `StatsCache` — see §4.4.

### 4.4 Coverage disclosure is LOCAL, and indistinguishability is not a goal

The real `statsCache` covers sessions Claude deleted after 30 days. A synthetic cache can only cover what the consolidate store holds. A user with two years of `stats-cache.json` and a three-month store who blocks one repo sees their reported total on that central collapse to three months.

An earlier draft threaded `partial: true` and `coverageFrom` into `IngestBody` so the central could render a badge. **That is rejected.** `partial` is a self-declared "I am withholding data" flag and `coverageFrom` quantifies how much — precisely the facts D4 keeps off the wire, handed over voluntarily as a "mitigation". Nothing is added to `IngestBody`; `StatsCache` gains no fields.

The disclosure instead happens **locally, before the user commits**, where it can still change the decision:

- `coverageFrom(sharedSessions)` and the real cache's `firstSessionDate` (both already in the browser via `AppData`) are rendered **in the confirm modal** as `applyConfirmStats` — "this central's totals for this machine will start {date} instead of {realFirstDate}" — not as a footnote discovered after the fact.
- `GET /api/team/status` returns `coverageFrom` per connection (local-only route, §5.9), and the card's persistent `statsNote` restates it.
- The confirm modal also states plainly that on the central this appears as *smaller numbers with no explanation*, because the central has no marker to render.

**Indistinguishability is explicitly not a guarantee.** A synthetic cache satisfies `totalSessions === COUNT(sessions where memberId = X)` exactly, while an unrestricted member's cache dwarfs its session docs — that gap is the entire reason `userStatsCaches` exists. One `$count` reveals which members filter, with or without a marker field. §6.4 states what *is* guaranteed.

**The synthetic cache is selected by the DECLARED rule — `hasRestrictions(conn.deniedRepos)` — not by a count comparison.** A `filtered.length < all.length` switch is wrong in both directions. It fails **open**: an empty or short consolidate store makes `0 < 0` false and pushes the real, full-history cache *with the denied repo in it* — which happens on a cold boot before the first `buildApiResponse`, whenever `loadConsolidated()` swallows an error, and permanently if `archiveMode` is switched to `'off'` after rules exist. And it flips **without user action**: blocking a repo you are about to start pushes the real deep cache for weeks, then silently `replaceOne`s the central's history with a three-month synthetic one the moment the first session in that repo lands. `hasRestrictions` makes the transition deterministic, explainable and simultaneous with the confirm dialog that describes it.

On the restricted path there is **no fallback to the real cache, ever**. `readMemberStatsCache` today falls back to reading `STATS_CACHE_FILE` raw when `buildApiResponse` throws; that branch is unreachable from the restricted path. If the synthetic build fails, or if restrictions exist and the store yields zero sessions while `~/.claude/stats-cache.json` plainly has data, the push omits `statsCache` entirely (the central keeps the last one it stored) and a local error notification fires. A missing cache is recoverable; a leaked one is not.

### 4.5 Extracting from `data.ts`

`supplementStatsCache` (`data.ts` 510-594) splits cleanly:

- lines 514-548 (the three Maps) → `accumulateClaudeSessions(sessions, { after: statsCache.lastComputedDate })`, plus the fields the supplement path ignores and the synthetic build needs (`hourCounts`, `firstStart`, `totalSessions`, `totalMessages`);
- lines 550-593 (upsert into an existing cache) stay in `data.ts` and consume the accumulator.

`claudeOnly` defaults to `false` for `data.ts` (which is called before the non-Claude merge and so only ever sees Claude sessions — a provable no-op, asserted by a regression test) and is passed `true` by `buildSharedStatsCache`, which is handed the whole filtered store.

---

## 5. Push path

### 5.1 Per-connection state in `team-uploader.ts`

| Today | Becomes | Note |
|---|---|---|
| `let _netErrStreak = 0` | `Map<connId, number>` | the log line must name the endpoint, else two centrals' streaks are indistinguishable |
| `let _lastSuccessAt` | `Map<connId, number>` | |
| `let _pushErrKind` | `Map<connId, 'auth'\|'net'>` | the transition guard is what prevents toast spam; global, one central's flap silences another's |
| `let _authErrStreak = 0` | `Map<connId, number>` | `AUTH_ERR_RESET_THRESHOLD` stays a const |
| `let running = false` | `Map<connId, boolean>` + `Map<connId, boolean> pendingTrigger` | a hung central must not block the others' cadence; see §5.2 |
| `let _centralIntervalSec` | `Map<connId, number>` | each central owns *its own* cadence |
| `let _onChangeTimer` | `Map<connId, Timeout>` | the debounce floor is per-connection |
| the recursive `setTimeout` chain | `Map<connId, Timeout>` | one chain per connection |
| `let started = false` | stays global | one `startUploader()` |

Functions taking a `connId` (or a `TeamConnection`): `warnPushError`, `clearPushError`, `markPushSuccess`, `notifyPushError`, `notifyPushRecovered`, `handleAuthError`, `autoResetOnRevoke` → `removeConnection`, `reconcileSyncState`, `resetSyncState`, `triggerPush`, `loadSentState`, `saveSentState`, `pushOnce`, `pushOnceDetailed`, `handleLeaveCentral`.

**The central still owns the interval — per connection.** `clampPushInterval(centralValue, EXPRESS_MIN_SEC)` is applied independently for each connection. There is never a machine-wide max or min across centrals.

### 5.2 The supervisor, the shared context, and the trigger queue

A supervisor tick (~5s) diffs `prefs.team.connections` against the live timer map: it starts a chain for a new id, clears and deletes the chain for a removed id, and runs `migrateTeamStateOnce()` if it has not yet. It does **not** GC state files (§3.4). This is what makes an "Add central" in the browser take effect without a restart.

Because each connection runs at its own central-dictated cadence there is no common tick, so the shared inputs are a **time-windowed, single-flight memo** rather than a per-tick value:

```ts
interface PushCycleContext {
  realStatsCache: StatsCache | null // buildApiResponse(), FIRST
  sessions: SessionMeta[]           // loadConsolidated()
  projects: ServerProject[]
  workflows: WorkflowRun[]
  index: PathRepoIndex              // buildPathRepoIndex(sessions, projects)
  builtAt: number
}
async function getPushContext(): Promise<PushCycleContext>
```

`getPushContext()` returns a cached value younger than `min(intervals)/2`; concurrent callers await the same in-flight promise. `loadConsolidated()` is additionally memoized against the consolidate store's write counter (`writeConsolidated` already returns the number of files changed). Without this, `readMemberStatsCache` (which awaits `buildApiResponse`) and a full directory scan plus one `readFile` per session run once **per central per cycle**.

**Ordering inside the context is load-bearing: `buildApiResponse()` runs BEFORE `loadConsolidated()`.** `buildApiResponse` is what *writes* the consolidate store; the current code loads the store first and reads the cache second. On a restricted connection that ordering makes the first cycle after boot (800ms) see a cold or half-written store, build `buildSharedStatsCache([]) ≈ emptyStatsCache()`, and `replaceOne` the central's stored totals for that machine with **zeros**. It self-heals next cycle — unless the process crash-loops or a container restarts often, in which case the machine reads as zero indefinitely.

Per-connection pushes run **sequentially with a small concurrency cap (2)**, never `Promise.all` over N — a hung central must not exhaust sockets or starve the others.

**`running` gains a companion `pendingTrigger`.** Today `notifyDataChanged` nulls the debounce timer *before* calling `triggerPush`, and `triggerPush` is `if (running) return` — so a change event arriving while a cycle runs is **dropped**, not deferred. With a purge-and-resync holding the lock for minutes (§6.1) that is guaranteed to happen, and `data.ts` fires `notifyDataChanged()` immediately after a `git_remote` heal — the event most likely to change *what is shared*. On unlock, a set `pendingTrigger` re-arms immediately, and the sync/rules files are never written for a sequence during which an event was swallowed.

### 5.3 Where the denylist bites

1. **`pushOnceDetailed`** — `filterShared(ctx.sessions, denied, ctx.index)` runs **before** `selectDeltas`. Filtering afterwards would let a denied session enter `nextSent`; a later un-block would then never re-push it, because its hash is already recorded as sent.
2. **The statsCache** — `readRealStatsCache()` (unchanged behaviour) when `hasRestrictions(denied)` is false; `buildSharedStatsCache(sharedSessions, {version})` when it is true, with no fallback (§4.4).
3. **`readMemberWorkflows`** — filtered by `sharedSessionIds`, fail-closed (§4.2).
4. **The empty-delta keep-alive is suppressed on a restricted connection unless something actually changed.** Today a cycle with zero session deltas still POSTs `{sessions: [], statsCache, workflows}`, and `notifyDataChanged()` fires that cycle on **any** local session write — including inside a denied repo. The central therefore receives a request at ~2s resolution every time the user works on a hidden repo, and `validateIngestToken` stamps `lastSeenAt` on each: session boundaries, working hours and intensity of the hidden work, reconstructable from request timing alone. On a restricted connection: `notifyDataChanged()` does not fan out; an empty-delta push is skipped when the synthetic cache and the filtered workflow set are byte-identical to the last ones pushed; and the remaining periodic push carries ±20% jitter so cadence carries no information about local activity.
5. **`handleTeamTestConnection`** already posts `{org:'default', user:'', sessions: []}` — nothing to filter, and it is used *pre*-connection, so it keeps its stateless `{endpoint, token}` body and takes no `connId`. Post-connection probing uses `POST /api/team/connections/:id/probe`, which reads the stored token server-side (§5.8).
6. **The reverse channel** carries no session content today. Any future on-demand fetch over it must route through `sessionShared()` on the member, using the `connId` the socket is bound to.
7. **OTel is out of the denylist's reach and must say so.** `otel-watcher.ts` exports unfiltered totals to whatever OTLP endpoint is configured, with no notion of connections. When any connection has restrictions and OTel export is enabled, Settings shows `otelWarn`; the export itself is unchanged.

### 5.4 `sessionHash` becomes a real digest

`sessionHash(s) { return JSON.stringify(s) }` — the "hash" *is* the whole serialized session, so `team-sent.json` is already roughly the size of the consolidate store, and `loadSentState()` re-parses it inside the batch loop. With N connections that is N full copies on disk and O(batches²) I/O per connection.

It becomes `createHash('sha256').update(JSON.stringify(s)).digest('hex')`, and the sent-state file becomes `{ version: 2, hashes: {...}, runIds: [...] }`. Because the v1 value *is* the input to the new digest, `migrateTeamStateOnce()` converts existing files exactly (§3.3) — the upgrade costs **zero** re-pushes from this change. A file with no `version` that is not convertible is treated as empty. Without the version field, two code versions racing would re-push forever.

`runIds` is new and required: `handleTeamIngest` calls `ingestWorkflows` only when `workflows.length > 0` and there is no per-run delete, so pushing `workflows: []` removes nothing. Recording which runs have been accepted lets §5.5 detect a run whose owning session later becomes denied — otherwise runs pushed in batch 0 of a push whose later batches failed are never represented in `sent`, never appear stale, and keep their `name`, `agents[].label` and `totals` on the central indefinitely.

### 5.5 Rules state, the shrink detector, and its ordering against the sig

Two independent reconciliations run each cycle, **rules first**:

**(a) Rules / shrink — local facts, evaluated before anything that depends on the central.** `reconcileSyncState` opens with `if (!instanceId) return`, and `fetchCentralPolicy` returns `instanceId: null` for any non-OK response, parse failure, timeout, or a central predating the field — including every `AGENTISTICS_INGEST_ONLY=1` central, which 404s `/api/team/policy` by construction. Putting the rules check behind that guard means a user on an older or flaky central can block a repo, see a green pill, and have the purge never run. Rules and shrink need no central identity and are evaluated unconditionally.

`team-rules-<connId>.json` stores `{ rulesHash, sharedIds[] }`, where `rulesHash = denialSignature(deniedRepos)` (order- and normalization-independent). Each cycle:

```
denied      = normalizeDenied(conn.deniedRepos)
deniedIds   = deniedSessionIds(ctx.sessions, denied, ctx.index)
staleSent   = sent.hashes keys ∩ deniedIds
staleRuns   = sent.runIds ∖ sharedRunIds
purge       = staleSent.size > 0 || staleRuns.length > 0
            || (prev.rulesHash !== undefined && prev.rulesHash !== rulesHash && shrank)
```

**The trigger is DENIAL, never ABSENCE.** An earlier draft used `stale = sent keys ∉ sharedIds`, which treats "the session is no longer in the store" as "the session became denied". `loadConsolidated()` is built on `safeReadJson`/`safeReadDir`, both of which swallow every error and return empty; `writeConsolidated` writes non-atomically, 20-way concurrent, from `buildApiResponse` in the **same process** as the uploader; `HOME_DIR` falls back to `''`; a container can start before its bind mount is ready. Any one of those makes a cycle read fewer sessions — or zero — and the machine would then `POST /api/team/leave`, wipe its entire history from the central, and (per §6.2) drop `machineStatsCaches[memberId]`, degrading every machine and team filter on that central to per-session sums for the duration. A session that merely vanished from the store is not evidence of a rule change. As a second belt, no purge runs while `ctx.sessions.length === 0`.

The detector is nonetheless **mandatory and runs every cycle, not only on a rules edit**: `git_remote` is not stable. `backfillGitRemote` retro-stamps a remote onto previously remote-less sessions, a repo can be renamed on GitHub (new canonical key), a folder can gain a remote after the fact. Without it, a session that *becomes* denied is simply omitted from the next delta and stays on the central forever.

**A missing `rulesHash` counts as `denialSignature([])`.** The migrated file is seeded with it (§3.3); treating `undefined !== denialSignature([])` as a change would make the entire fleet purge its central on upgrade day, simultaneously.

**Growth never purges.** Un-blocking a repo, renaming a connection, or a no-op save only clears the sent-state and pushes. A purge on growth is gratuitous data loss that re-enters the crash window for nothing.

**(b) Sig — depends on the central's identity.** `sig = sha256(connId \0 endpoint \0 token \0 instanceId)`; `connId` is included because two legitimate connections can share an endpoint identity space and without it they would share a signature and thrash each other into a permanent re-push loop. A sig mismatch keeps today's behaviour — clear sent-state, re-push — **except** when `hasRestrictions(denied)` is true, in which case it takes the purge path. A token rotation changes the sig without deleting anything on the central; on a restricted connection, clearing the sent-state alone would leave already-pushed denied sessions there forever.

### 5.6 Notifications

Every `broadcastNotification` from the uploader and the agent client gains `meta: { connectionId, central }`, where `central = conn.label ?? hostOf(conn.endpoint)` — the host, never the token. `NOTIFICATION_TEXT` in `web/src/lib/notifications.ts` interpolates `{central}` into `member.auth_rejected`, `member.unreachable`, `member.reconnected`, `member.removed`, `machine.renamed`, `machine.reassigned` (EN + PT), and gains two new codes, `member.resync_started` and `member.resync_done` (`meta: { central, count }`), so a running purge-and-resync is visible from any route and after a page change. The store's dedupe key must include `meta.connectionId`, otherwise "central A unreachable" and "central B unreachable" collapse into one toast and A's recovery clears B's badge.

### 5.7 Auto-reset-on-revoke — one connection, not the machine

Today `autoResetOnRevoke()` does `writePreferences({ team: { ...DEFAULT_TEAM } })`. With N connections that disconnects every central because one revoked a token, and destroys every denylist. New `removeConnection(connId, reason)`:

1. re-read prefs under the write lock; if `connections` no longer contains `connId`, no-op (preserves today's idempotence guard);
2. splice that entry out — a **read-modify-write on `connections`**, never a blind write of a stale snapshot;
3. `normalizeTeamConfig` derives `mode` and rebuilds the legacy mirror; `mode` becomes `'solo'` only when the list empties;
4. GC this connection's sent / sync / rules / purge files inside the same write;
5. clear all Map entries for `connId`, stop its timer, close its socket (`reconcileNow()`);
6. `broadcastNotification({ code: 'member.removed', meta: { connectionId, central } })`.

### 5.8 Connection mutation routes, write serialization, and secret handling

`writePreferencesTo` is a read-merge-`Bun.write` with **no lock**, and Bun serves requests concurrently while `cli-member.ts` writes the same file from a separate process. With one flat team block a lost update cost one field; with `connections[]` it costs the privacy rules, and a torn read makes `readJsonPrefs` return `null` → `DEFAULT_PREFS` → **the machine reads as solo**, losing every connection, `archiveMode`, layouts and theme, and re-firing the archive-consent gate.

Three changes to `preferences.ts`, all prerequisites of this feature:

- every write goes through a module-level promise chain (single writer per process);
- writes are temp-file + `rename` (atomic on the same filesystem);
- `readJsonPrefs` distinguishes "absent" from "corrupt" and **refuses** to fall through to defaults on a parse error of an existing non-empty file — it throws, and the caller surfaces it, rather than silently presenting a wiped machine.

Cross-process safety uses an `O_EXCL` lock file in `~/.agentistics` with a stale-lock timeout; the CLI prefers the local server's routes and only takes the lock when no server is running.

| Route | Body | Behaviour |
|---|---|---|
| `POST /api/team/connections` | `{ endpoint, token, org?, label?, deniedRepos? }` | whoami-verify; if the normalized endpoint already exists → **update in place** (token/org/user refreshed, `id`/`deniedRepos`/`label` preserved); refuse if the token belongs to another connection; else mint id and append (read-modify-write). Starts timer + socket. Does **not** push until `deniedRepos` has been committed by the wizard (§9.2) |
| `PATCH /api/team/connections/:id` | `{ deniedRepos?, label? }` | read-modify-write that entry only. `label` alone is local and applies instantly. A `deniedRepos` change applies `withUnresolvedDenied` on the zero→non-zero transition, runs the §6 sequence and returns `{ ok, queued? }` |
| `DELETE /api/team/connections/:id` | — | whoami → `POST <endpoint>/api/team/leave` → remove the entry + its files |
| `POST /api/team/connections/:id/probe` | — | server-side identity/latency probe using the **stored** token; feeds `ConnectionIdentity` |
| `POST /api/team/push-now` | `{ connectionId? }` | one connection or all; response `{ ok, results: [{connectionId, count, error?}], count }` (`count` = sum, for older clients) |
| `POST /api/team/test-connection` | `{ endpoint, token }` | **unchanged** — stateless, used pre-connection |
| `POST /api/team/leave-central` | `{ endpoint, token, org?, user? }` | **kept** for the old cached SPA. Maps `{endpoint, token}` → `connId`, resets **only that** connection's files, and removes the entry itself rather than trusting a follow-up PUT. Today it ends in a global `resetSyncState()`, which with N connections would give an unrelated central a spurious full re-push while the actually-purged one keeps its sent-state and re-pushes nothing |

`PUT /api/preferences` keeps working, with one rule that is not optional: **a `team` payload with no `connections` key is a legacy single-connection edit, never a replacement of the array.** The shallow merge means an old cached tab — or the pre-upgrade SPA in an old container — that saves Settings, or clicks Disconnect (which PUTs a full solo object), would otherwise delete every connection and every denylist. The server matches the payload's `endpoint` into `connections[]` and merges (preserving `id` and `deniedRepos`), never overwrites a stored non-empty token with an empty one, and returns `409` when `connections.length > 1` so the stale tab surfaces an error instead of destroying state.

**Secrets stop travelling outward.** `GET /api/preferences` **redacts `team.connections[].token` to `''`** and drops the legacy `team.token` mirror from the response. Nothing in the new UI needs a token: add posts one, probe/leave/test are server-side. Combined with the legacy-merge rule above, an old client PUTing the redacted shape back cannot blank the stored token. On the same routes (`/api/preferences`, `/api/team/status`, `/api/team/connections*`) the wildcard `Access-Control-Allow-Origin: *` is replaced by an echo of the request Origin **only when it matches this server's own origins** (`localhost`/`127.0.0.1`/the bound host on `PORT`/`WEB_PORT`). Today any website the user visits can `fetch('http://localhost:47291/api/preferences')` cross-origin and read every central token; `deniedRepos` would join it. Same-origin use from a phone on the LAN is unaffected — it needs no CORS header at all — so mobile rule editing (§9.6) keeps working.

### 5.9 `GET /api/team/status`

```jsonc
{
  "mode": "solo" | "member",
  "connections": [{
    "id", "endpoint", "org", "user", "label",
    "lastSuccessAt", "errKind": "auth" | "net" | null, "latencyMs",
    "deniedCount": 3, "restricted": true, "coverageFrom": "2026-04-11",
    "canPurge": true, "centralTooOld": false,
    "resync": { "phase": "purge" | "push", "sent": 400, "total": 2100 } | null,
    "pendingRules": false
  }],
  // legacy mirror of connections[0] for a cached older SPA:
  "user", "endpoint", "lastSuccessAt", "errKind", "latencyMs"
}
```

- **Never** return `token` or the contents of `deniedRepos` here. `deniedCount` is enough for the pill; the full list comes from `/api/preferences`, same-origin.
- The current handler does a **blocking 4s latency probe per request**, polled every 5s. With N connections that would exceed its own poll interval with two offline centrals. **The probe moves into the uploader cycle** (which already fetches `/api/team/policy`) and the route returns cached values — O(1) regardless of N.
- `errKind` stays per connection; the aggregate pill is `any auth > any net > any resync > ok`.
- `mode` stays top-level because `App.tsx` sets `isMember` from it.
- `coverageFrom` is the local honesty marker (§4.4); it exists on this route and nowhere on the wire to a central.

### 5.10 `team-agent-client.ts` — one socket per connection

`activeWs` and `backoffIdx` become `Map<connId, …>`. `reconcileConnection()` becomes a fan-out: open a socket for each connection that lacks one, and close + delete every socket whose key is no longer in `connections[]` or whose credentials changed. The single `POLL_INTERVAL_MS` interval stays; the *work* inside it fans out, per connection, so one hanging endpoint cannot stall the others.

`scheduleReconnect(connId)` must re-read *that* connection **by id** from prefs on each attempt: a reconnect must not resurrect a socket for a connection the user just removed, and must pick up a rotated token. `openConnection(connId, endpoint, token)`; the dedupe guard keys off `activeWs.get(connId)`.

Leaving these as singletons is a hard failure, not a delay: presence is WS-authoritative, so whichever connection reconciles first owns the socket and **the member appears permanently offline on every other central**.

Both the uploader and the WS client gate on a non-empty `user` today. That gate moves to `token || open-central endpoint`, and any cycle where `conn.user === ''` **re-runs whoami and updates that connection in place** — identity is stamped server-side from the token anyway (`handleIngestBody`'s `overrideUser`). Otherwise a connection added while its central was briefly down never resolves a name and pushes nothing, forever, with no retry.

Inbound `renamed` / `reassigned` frames must carry `meta.connectionId` / `meta.central` — with N centrals an unattributed "you were renamed" is unactionable — and a rename frame updates that connection's `user` in prefs.

---

## 6. Rule changes and retroactive removal

### 6.1 The sequence

Triggered by (a) a `deniedRepos` edit that **shrinks** the shared set, (b) the cycle-time shrink detector (§5.5), (c) a sig change on a restricted connection, or (d) a stale purge journal found at boot.

```
0. capability + identity check:  conn.canPurge  (§7)  AND  GET /api/team/whoami == ok
1. write teamPurgeFile(connId) = { state: 'purging', rulesHash, startedAt }   ← journal FIRST
2. saveSentState(connId, { version: 2, hashes: {}, runIds: [] })              ← clear BEFORE the leave
3. POST <endpoint>/api/team/leave  (Bearer <token>)   → require 200 AND body.ok === true
4. on success → journal.state = 'pushing'
5. pushOnceDetailed(conn, ctx) in a loop until one full pass completes, PACED at the
   connection's normal cadence with jitter — not as a back-to-back burst
6. delete teamPurgeFile(connId); write teamSyncFile + teamRulesFile(connId)
```

Step ordering is load-bearing:

- **whoami before the leave.** `handleTeamLeave`'s minted branch deletes by `memberId`; its legacy/open branch deletes by `{org, user}` and purges `legacy:<user>` stats and workflows — and **both branches return `{ok:true, deleted:N}`**, so the member cannot tell them apart from the response. On a central whose DB was wiped or restored, `validateIngestToken` fails, `hasAnyTokens()` is false, and one machine's rules change deletes **every** machine of the same person, none of which will re-push (their sent-state and sig are untouched). `GET /api/team/whoami` is minted-token-only, so an `ok` response immediately before the leave is the member-side proof that the token branch will be taken. Anything else aborts with `pendingRules: true`.
- **Assert on the body, not on `res.ok`.** `/api/*` is excluded from the SPA fallback so a central without the route returns a JSON 404 — but a reverse proxy in front of a central can turn that into a 200 HTML page, which the journal would read as a successful purge.
- **Journal before leave.** If the process dies between the leave and the first ingest, the central is empty and nothing would notice: `reconcileSyncState` only re-pushes when the sig changes, and none of `endpoint`/`token`/`instanceId` did. `startUploader()` checks for a stale journal at boot and forces a full re-push.
- **Clear sent-state before the leave, not after.** If the purge succeeds and the sent-state is still populated, `selectDeltas` finds zero deltas, `pushOnceDetailed` returns `{count: 0}`, the empty-delta branch still calls `markPushSuccess()`, and the central stays empty **forever behind a green status pill**. Step 2 is idempotent under the journal, so a failed leave retried next cycle does not re-clear a sent-state that has since been rebuilt.
- **A per-connection push lock is taken for the whole sequence**, with `pendingTrigger` (§5.2) so events arriving during it are deferred rather than dropped. Without the lock, a `notifyDataChanged()`-debounced push already in flight can land *after* the `deleteMany` and re-insert **unfiltered** documents, including denied-repo sessions; the subsequent filtered re-push never overwrites them, so they persist forever. This is the single worst race in the design.
- **Coalesce and pace.** The UI commits the whole draft once, so toggling five repos is one purge, not five; a second rules change arriving mid-resync queues rather than interleaves. The re-push is paced at the normal cadence rather than as a `BATCH_SIZE = 200` burst — a burst's request count and duration alone give an observer the withheld/retained split.

### 6.2 What the central sees

- Both the leave route and `team-watch.ts`'s change stream fire `triggerSseNotification()` → `invalidateCache()`. A rebuild landing inside the window returns nothing for that `memberId` and no `memberStats` doc, so `data.ts` drops the machine from both `userStatsCaches` and `machineStatsCaches`.
- **Second-order effect, worse than the visible zero:** with `machineStatsCaches[memberId]` missing, `resolveMachineCacheScope` returns `null` and every machine/team filter including that machine degrades to per-session sums — a fraction of the truth, exactly the failure CLAUDE.md's team-mode rule warns about. The dip is not confined to the leaving machine's row.
- The `statsCache` rides **batch 0 only**, so aggregates recover on the first batch and the session list fills progressively. The visible artifact is "totals right, session list still filling" — the least-bad ordering.
- During the re-push every `bulkWrite` triggers a change event → another `invalidateCache()`; `_revalidating` guards concurrency, so expect one sustained rebuild loop, not N. On a large central that is the real cost of retroactive removal, and pacing (§6.1) spreads it.
- **Presence is unaffected.** It is WS-authoritative and keyed by display name; leave touches neither the socket registry nor `tokens.lastSeenAt`. The member stays green throughout — which is correct, and is why the member-side status must report `resync`, not "synced", for the duration.

### 6.3 Failure and retry

| Failure | Behaviour |
|---|---|
| leave returns a network error | rules are persisted, journal stays `purging`, status reports `pendingRules: true`, UI shows `applyQueued`. Retried every cycle with backoff. **The UI must never report success here** — a user who believes a repo is hidden while the central still holds it is the worst outcome in this design |
| leave returns 401/403, or whoami fails | the token is dead or the central would take the legacy branch → `removeConnection(connId, 'revoked')` on 401/403; abort with `pendingRules` on a whoami mismatch. Never purge broadly |
| `canPurge === false` (§7) | the rules editor is **disabled** for that connection with `centralTooOld`; existing rules keep filtering *new* pushes, and the card says plainly that already-sent data cannot be removed until the central is upgraded |
| process dies mid-purge | boot finds the journal, forces sent-state clear + full re-push |
| re-push partially fails | journal stays `pushing`, cycle retries; deltas are already correct because the sent-state only records what was accepted |
| `archiveMode === 'off'` | the purge deletes documents the member **cannot regenerate** (Claude already deleted the transcripts and there is no consolidate store). The rules editor is **disabled** with `archiveOffNote`, and — because rules can predate the switch — a connection with existing restrictions and `archiveMode: 'off'` pushes **no statsCache at all** rather than falling back to the real one (§4.4) |

### 6.4 The guarantee, stated precisely

`deniedRepos` exists in exactly three places: `~/.agentistics/preferences.json`, the in-memory `TeamConnection` on the member, and the browser tab talking to that machine's own origin. It appears in **no** request body sent to a central. `IngestBody` is unchanged — not one field is added. `GET /api/team/status` exposes only `deniedCount` and a local `coverageFrom`, same-origin.

**What is guaranteed:** a central never learns *which* repositories are hidden, nor how many, nor their names, sessions, prompts, titles, models or cost — provided the repository was never pushed to it.

**What is NOT guaranteed, and must be said in the UI:**

1. **A repo that was already pushed is disclosed by its removal.** The central holds those documents with `git_remote`, `project_path`, `first_prompt`, `title`, `model`, tokens and cost. A `deleteMany` followed by a re-ingest from the same `memberId` is machine-detectable — `team-watch.ts` already consumes the change stream — and diffing the pre-delete snapshot against the re-pushed set yields the exact denied repo set, the exact volume withheld and the moment the rule was created. The strong promise applies to *never-shared* repos; the weak one to *already-shared* repos, and `applyConfirmBody` says so in those terms.
2. **The existence of a filter is observable.** A synthetic cache's `totalSessions` equals the member's session-document count exactly, while an unrestricted member's does not. This is inherent to withholding aggregate history; no marker field is what creates it.
3. **Colluding centrals can reconstruct each other's denied set.** Two centrals (or one operator with accounts on both) see the same machine, overlapping presence windows and overlapping shared-session sets; a set difference yields the other's rules. Per-connection restrictions are confidential against a *single* central operator, not against collusion. The design reduces the correlation surface where it is free — `user` is already per-connection — and documents the rest.
4. **CI ingest and OTel are outside the denylist** (§7, §5.3).

---

## 7. Central-side

**Required changes: one additive, optional field.** Everything the design uses already has the right shape:

| Route / module | Why it suffices |
|---|---|
| `POST /api/team/leave` → `handleTeamLeave` | On the minted-token branch it does `sessions.deleteMany({memberId})` + `deleteMemberStats(memberId)` + `deleteMemberWorkflows(memberId)`. Token-authoritative and org-agnostic — exactly the purge primitive D4 needs |
| `POST /api/team/ingest` | All three writers are deterministic-key `replaceOne` upserts (`teamDocId(org, memberId, harness, sessionId)`, `org:memberId:runId`, `_id: memberId`). No `$inc`, no array append → re-push after purge is idempotent, and real-cache → synthetic-cache → real-cache is a plain overwrite |
| `GET /api/team/whoami` | minted-token-only → the member-side proof that leave will take the token branch (§6.1) |
| `tokens` doc | untouched by leave, so the machine keeps pushing and `lastSeenAt` keeps presence honest |
| `team-agent.ts` WS registry | keyed by display name, never `memberId`; leave neither closes the socket nor flickers presence |
| `tags-*` | resolve against whatever sessions exist; a denied repo simply contributes nothing. No dangling references, no cleanup |
| `repos` (CI) | keyed by remote with `memberId = ciMemberId(remote)`; a machine leave can never touch CI data |
| `team-source.ts`, `data.ts` read path | pure projections of what happens to be in Mongo |

**The one change: `GET /api/team/policy` returns `capabilities: string[]`** (currently `['leave', 'leave.stats', 'leave.workflows']`). It is public, already fetched every cycle, and additive — an older member ignores it. It exists because the purge primitive was assembled in three releases and the member cannot otherwise tell which one it is talking to: `/api/team/leave` landed in **v1.6.6**, `deleteMemberStats` in the leave path in **v1.6.6**, and `deleteMemberWorkflows` only in **v1.7.3**. Against a published v1.7.0–v1.7.2 central the purge deletes sessions and stats but **leaves the workflow documents**, whose `name`, `phases`, `agents[].label` and `totals` are exactly what §4.2 fails closed over — and `ingestWorkflows` upserts per `runId`, so the filtered re-push never removes them. The UI would say "Rules applied" while the blocked repo's workflow names and cost stayed on the central forever.

Member behaviour by probe result:

- `capabilities` present and containing `leave.workflows` → `canPurge: true`, full behaviour.
- `capabilities` absent (central < this release) → probe `POST /api/team/leave`. A JSON 404 (`AGENTISTICS_INGEST_ONLY=1`, or a pre-v1.6.6 central) → `canPurge: false`. A working leave → `canPurge: true` **only if the machine has zero local workflow runs**; otherwise `canPurge: false` with `centralTooOld`, and the rules editor is disabled with an explicit "upgrade this central to 1.7.3 or later to use sharing rules".

`canPurge: false` never turns into a silent partial purge, and never into an endless retry loop: the rules editor refuses up front rather than clearing the sent-state every cycle against a central that will never purge.

**One member-side refusal, not a feature.** `handleTeamLeave`'s legacy/open branch deletes by `{org, user}` and cannot be distinguished from the token branch by its response — hence the whoami precondition in §6.1. The member fails loudly rather than deleting broadly.

**Two product caveats to state in docs and UI copy, not code:**

1. A machine denylist does **not** hide a repo that also pushes via GitHub Actions. CI sessions are stamped server-side under a different `memberId`; the repo card stays on `/repositories`. The denylist is a *machine* rule, not a central-wide one.
2. Presence cannot be filtered. A member who blocks everything still appears as a live, named, latency-measured machine. Accepted non-goal.

**Explicitly unchanged:** `team-tokens.ts`, `team-presence.ts`, `team-agent.ts`, `team-admin.ts`, `team-repos.ts`, `central-config.ts`, `team-stats.ts`, `team-watch.ts`, `team-scope.ts`, `tags-*`, and the `IngestBody` shape.

---

## 8. CLI

Repo rules are **web-only** — no `--deny-repo` flag anywhere. The `member` noun is kept.

```
agentop member connect --endpoint <url> --token <tok> [--org <org>] [--label <name>]
    Adds or UPDATES one central, keyed by normalized endpoint. An existing endpoint is
    updated in place (token/org/user refreshed; id, deniedRepos and label PRESERVED) —
    this is the token-rotation path. A token already used by a DIFFERENT connection is
    refused. Prints "connected as <user> — N central(s) total."
    Refuses only when whoami fails (unchanged).

agentop member list                       (new; `status` remains an alias)
agentop member status [--endpoint <url>]
    No flag  → one block per connection.
    With flag→ just that one; exit 1 if no match.

agentop member leave [--endpoint <url>] [--all]
    0 connections   → "not connected to a central — nothing to leave." exit 0
    1 connection    → leaves it, no prompt (today's behaviour)
    N, no flag, TTY → arrow-key select() over the endpoints + "Leave all" + Cancel
    N, no flag, non-TTY → exit 1: "connected to N centrals — pass --endpoint <url> or --all."
    --all           → leaves every one
```

Never guess in the non-TTY N-connection case: a silent `connections[0]` is data loss.

**Every CLI mutation goes through the local server's routes** (`POST /api/team/connections`, `DELETE /api/team/connections/:id`) — the way `nudgeLocalServer` already reaches the server. `cli-member.ts` today PUTs the whole `team` block to `/api/preferences`; under this design that is a whole-object write of `connections[]` from a process holding a snapshot read seconds earlier, so a browser-added central and its denylist vanish the next time the user runs `member connect` in a terminal. When no server is running, the CLI performs the full serialized sequence itself under the preferences lock (§5.8) — mint, persist, rename — and skips the PUT entirely.

**`bin/cli.ts`:** `readFlag` returns the *next* argv token, so `--all` must be parsed as a boolean (`rest.includes('--all')`) or `agentop member leave --all` swallows whatever follows and falls into the ambiguous path. `HELP` and `EXAMPLES` gain the new forms; the `sub` whitelist gains `list`. The unconfigured check becomes `(prefs.team?.connections?.length ?? 0) === 0`.

**`agentop member status` is fixed while we are here.** It currently calls `getUploaderStatus()` **in the CLI process**, which never ran `startUploader()`, so it always prints "last sync: never / state: ok". It must query `http://localhost:${PORT}/api/team/status`. With N connections the existing bug would become N wrong lines.

### 8.1 Rendering

`cli-status.ts` — `configValue`: 0 → `solo`; 1 → today's exact line, unchanged; N →

```
  CONFIG
    mode      member → 2 centrals
              ↳ http://acme:48080
              ↳ http://client-b:48080 · 2 repos blocked
```

The blocked count is `deniedRepos.length` — no repo resolution, no I/O, so `status` stays a fast one-shot.

`cli-start.ts` — `printStatus()` gets the same treatment. **The menu branch at ~397 is the single highest-risk line:** `if (mode === 'member') show Disconnect else show Connect` must become **additive** — always show Connect (relabelled "add another central" when N ≥ 1), and show Disconnect whenever N ≥ 1. Leaving the `else` makes a second central unreachable from the launcher. `disconnectFlow()` delegates the picker to `memberLeave` so the launcher and the CLI cannot diverge.

`cli-setup.ts` — the solo branch does `writePreferences({ team: { ...DEFAULT_TEAM } })`, which with the shallow merge **wipes an existing connections array**. Since `agentop setup` is reachable on an already-configured machine, it must confirm before discarding N connections. The member branch is fine: it calls `memberConnect`, which now adds or updates.

`cli-member.ts` currently prints raw English while the launcher prints localized strings right after it. **`cliStrings()` is wired into `cli-member.ts`**, consistent with `cli-start.ts`.

### 8.2 New `CliStrings` keys

| key | EN | PT |
|---|---|---|
| `configMembers(n)` | `member — sends metrics to ${n} centrals` | `member — envia métricas para ${n} centrais` |
| `configMemberLine(endpoint, suffix)` | `  ↳ ${endpoint}${suffix}` | idem |
| `deniedSuffix(n)` | ` · ${n} repo(s) blocked` | ` · ${n} repo(s) bloqueado(s)` |
| `itemConnectMore` | `Add another central` | `Adicionar outra central` |
| `itemDisconnectHint` | `pick a central to leave` | `escolher de qual central sair` |
| `leaveWhich` | `Leave which central?` | `Sair de qual central?` |
| `leaveAll` | `Leave all centrals` | `Sair de todas as centrais` |
| `leftOne(endpoint)` | `left ${endpoint}` | `saiu de ${endpoint}` |
| `leftAll(n)` | `left all ${n} centrals — back to solo.` | `saiu de todas as ${n} centrais — de volta para solo.` |
| `stillConnected(n)` | `still connected to ${n} central(s).` | `ainda conectado a ${n} central(is).` |
| `noConnections` | `not connected to any central.` | `sem conexão com nenhuma central.` |
| `ambiguousLeave(n)` | `connected to ${n} centrals — pass --endpoint <url> or --all.` | `conectado a ${n} centrais — use --endpoint <url> ou --all.` |
| `connectedAs(user, n)` | `connected as ${user} — ${n} central(s) total.` | `conectado como ${user} — ${n} central(is) no total.` |
| `updatedExisting(endpoint)` | `updated the existing connection to ${endpoint}` | `atualizou a conexão existente com ${endpoint}` |
| `tokenInUse(endpoint)` | `that token already belongs to ${endpoint}` | `esse token já pertence a ${endpoint}` |

---

## 9. Web UI

### 9.1 `TeamSettings.tsx` is dissolved, not extended

It is three unrelated components sharing one file and one prop bag: duplicated primitives (`SectionHeader`, `Divider`, `PrefRow`, `Toggle` already exist in `pages/settings/primitives.tsx`), a central-admin branch, and a single-connection member form — with the `central` boolean acting as a branch discriminator smuggled in as a prop. The file is **deleted**. Its two call sites (`ConnectionSettings.tsx`, and `SoloMemberMachinesView` in `MachinesSettings.tsx` — the easily-missed second copy) both switch to `<ConnectionsPanel/>`.

```
packages/web/src/
  pages/settings/
    ConnectionSettings.tsx          (rewritten, ~70)  route shell + central/member branch
    primitives.tsx                  (+ FieldInput, + IntervalSelect, + StatusDot, + RowSwitch)
  components/team/
    CentralAdminPanel.tsx           (~110)  central branch, lifted verbatim
    ConnectionsPanel.tsx            (~190)  list + add + prefs load/save + one status poll
    ConnectionCard.tsx              (~210)  header row + accordion body + rename
    ConnectionIdentity.tsx          (~90)   read-only identity/endpoint/cadence
    SharedReposPanel.tsx            (~250)  the denylist editor
    AddCentralDrawer.tsx            (~200)  paste token → test → repo rules → connect
    ConnectionStatusPill.tsx        (~130)  generalized MemberConnectionStatus, per connId + aggregate
    copy.ts                         ({en, pt} table below + plural())
  lib/shareRepos.ts                 (pure, unit-tested)
```

`FieldInput` moves into `primitives.tsx` **and gains the 16px mobile rule** — its current hardcoded `fontSize: 13` violates CLAUDE.md and would zoom iOS Safari, breaking the sticky settings header.

`RowSwitch` is new and exists for a specific reason: `index.css` forces `min-height: 44px` on **every** `button` inside `.ag-settings`, and `SettingsPage.tsx` wraps the whole settings tree in that class, so the existing `Toggle` (a `<button>` with inline `width:34; height:20` and a knob at `top: 3`) computes to 34×44 on mobile with the knob pinned to the top third. `RowSwitch` makes the **row** the only `<button>` (`minHeight: 48`, `width: 100%`, `role="switch"`, `aria-checked`, `aria-label`) and renders the switch visual as a `<span aria-hidden>` — which also avoids the invalid `<button>`-inside-`<button>` that "the whole row is the tap target" plus a nested `Toggle` would produce. Separately, `.ag-settings button.ag-switch { min-height: 0 }` un-deforms the existing toggles in `LiveSettings` / `PreferencesSettings`.

### 9.2 Contracts

- **`ConnectionSettings`** (route) — `isCentral === true` → `<CentralAdminPanel/>`; `false` → `<ConnectionsPanel sessions={ctx.data.sessions} projects={ctx.data.projects}/>`; `null` → the existing 80px placeholder.
- **`ConnectionsPanel`** owns: `GET /api/preferences` on mount (with a defensive client-side legacy migration so an old server payload never renders an empty list); **one** `GET /api/team/status` poll every 5s sliced per card (N cards must not mean N pollers); the `shareTargets` memo; the header row (`connectedCentrals · N` + `addCentral`); the card list; the empty state. Each card is wrapped so one broken row cannot take the page down (see `hostOf` below).
- **`ConnectionCard`** header (always visible, `minHeight: 56`, whole row is the accordion button): status dot, central label (`conn.label ?? identity.team ?? hostOf(endpoint)`), "appears as <user>", an amber `{n} hidden` pill with an `EyeOff` icon when `deniedRepos.length > 0`, chevron. Body: status pill → identity → shared repos → `Sync now` → Disconnect (`ConfirmModal` with `requireText={centralLabel}`). A pencil next to the label opens an inline rename wired to `PATCH {label}` — local-only, so no confirm and no resync.
- **`hostOf(endpoint)`** (`lib/shareRepos.ts`) is `try { new URL(e).host } catch { return e || '—' }`. A bare `new URL()` inside a `.map` render throws on one hand-edited or pre-normalization endpoint and takes down the entire Connection page — including the Disconnect button that would fix it. A connection whose endpoint will not parse renders a `brokenConn` card offering only Disconnect.
- **Two connections that resolve to the same host** automatically promote `identity.user` into the primary label (`acme:48080 · lucas`), because that is the actual discriminator and §5.5 explicitly legitimizes the personal+work case.
- **`ConnectionIdentity`** — read-only rows fed by one `POST /api/team/connections/:id/probe` fired **on expand**, not on mount for all N (an offline central would block the list behind N timeouts). Endpoint and token are **not editable in place**: to change them you Disconnect and Add, or re-run `member connect` for a rotation. This deletes the entire `editing` / `userTouched` / `editingInitialized` ref machinery, the most fragile part of the old file.
- **`AddCentralDrawer` is a two-step wizard, and the second step is the repo rules.** Step 1: paste token → `unpackConnectToken` auto-fills the endpoint → optional `label` → Test → resolved identity. Step 2: the same `SharedReposPanel` list, defaulted to share-everything, with `addRulesIntro` explaining that rules chosen here apply *before* anything is sent. Connect posts `{endpoint, token, org, label, deniedRepos}` in one call; **the timer, the socket and `push-now` do not start until that body has been committed.** Deferring the picker to after the connection exists would push the entire unfiltered history of every repo first, converting the safe case (block before ever sharing, §6.4's strong guarantee) into the weak one for every user. Duplicate endpoint → inline `dupCentral` with a "replace the token on the existing connection?" action; a token already in use → `tokenInUse`, no request. The drawer passes `dirty={!!token || !!endpoint || rulesTouched}` to the existing `Drawer`, which already implements backdrop/Escape/tab-close discard confirmation — on a full-screen mobile drawer a backdrop tap is the most common accidental gesture, and a pasted 200-char token must not vanish silently.

### 9.3 Where the repo list comes from

**Not `ctx.derived.repoStats`.** That map is built from `filteredSessions`, so an active date or project filter would silently shrink the list of things you can block — a privacy control whose shape changes with a dashboard filter is a bug. It also splits unlinked sessions into one entry *per folder*, while the denylist needs exactly one.

Source of truth is `ctx.data.sessions` (unfiltered) plus `ctx.data.projects` (for `gitRemote`):

```ts
export interface ShareTarget {
  key: string                  // canonical remote, or NO_REPO_KEY
  kind: 'repo' | 'none'
  name: string                 // repoShortName(remote), or the localized "No repository"
  host: string                 // 'github.com'; '' for the none bucket
  sessions: number
  lastActive: string           // ISO, '' when unknown
  orphan: boolean              // denied but no longer produces sessions
  /** project paths under this key that also contain another repo (§4.2) */
  conflictPaths: string[]
}
export function buildShareTargets(
  sessions: SessionMeta[], projects: ServerProject[], deniedKeys: string[],
): ShareTarget[]
export function countDenied(targets: ShareTarget[], denied: string[]): number
export function hostOf(endpoint: string): string
export function plural(entry: {one: string; other: string}, n: number): string
```

Rows are grouped by **canonical** key, so `git@github.com:Acme/API.git` and `https://github.com/acme/api` are one row and one toggle. Sorted by sessions desc, then name — the busiest repo (the one you most likely want to hide) is first, and the "No repository" bucket sorts by the same rule rather than being pinned last where it is missed. When that bucket has 0 sessions and is not denied, the row is hidden entirely.

`NO_REPO_KEY` is imported from `@agentistics/core`, the same constant the server's `share-rules.ts` uses.

**A row with `conflictPaths` is rendered blocked-and-locked, not annotated**, matching §4.2's fail-closed rule: the whole ambiguous directory is excluded from that connection, and the row explains why with `mixedRepoWarn`. The picker otherwise shows targets exactly as the machine resolved them; it must not imply a per-session precision `data.ts` cannot deliver.

### 9.4 `SharedReposPanel` — save and apply

Wrapped in the existing `Section` primitive (read-first with a right-aligned Edit; mobile-correct Save/Cancel stacking for free).

- **One polarity, everywhere.** The panel is shared-positive: `sharedRepos` heading, switch on = shared, summary `nShared`, bulk `shareAll` / `blockAll`. The only shared-negative surface is the card pill, and it carries an explicit verb and icon (`{n} hidden` + `EyeOff`) so it cannot be misread as a mode.
- **Read view:** amber chips for each denied entry, rendered as `repoShortName(remote)` in a `flexWrap: 'wrap'` container, each `maxWidth: '100%'` with ellipsis and the full remote in `title` — full normalized remotes run ~48 chars and would otherwise break the 390px no-horizontal-scroll rule. Plus `nShared` (or `sharingAll`) and, whenever `deniedRepos.length > 0`, the `statsNote` footnote naming the local coverage date.
- **Edit view:** search box (16px on mobile) + two groups, `groupBlocked ({n})` first then `groupShared ({n})`, each sessions-desc internally, a row animating between groups on toggle. Blocked rows scattered through a 14-row sessions-desc list make "what am I hiding from this central?" a full scan; the amber chip summary also stays visible above the list in edit mode so the read view's answer never disappears mid-edit. Each row is a `RowSwitch`: icon, name, host chip, second line `sessionsN · lastActiveT`; a blocked row dims to `opacity: .55` with `line-through` on the name — deny state must be readable without relying on colour. Header has `shareAll` / `blockAll` and the live `nShared` counter. `orphan` rows live in a collapsed `staleGroup` disclosure at the bottom.
- **A live impact line above Save, repeated in the confirm modal:** `applyImpact` — "Removes {sessions} sessions (~{cost}) from this central." Every input is already in the browser (`ctx.data.sessions` + `blendedCostPerToken`), and it is the only number the user actually cares about.
- **Explicit Save, never per-toggle.** Each applied rule change is a purge and a full re-push; saving on every toggle would rebuild the central once per tap. Record this rationale in a code comment.
- **Flow:** Save → `ConfirmModal` showing `applyConfirmBody` (mechanic + already-shared disclosure, §6.4), `applyConfirmStats` (the coverage collapse with both dates) and `applyImpact` → `PATCH /api/team/connections/:id {deniedRepos}`. **One server call.** The UI must never orchestrate purge-then-push itself — a tab closing mid-sequence would leave the central purged and unpopulated.
- **While it runs:** the Section body becomes a progress strip driven by `status.resync` — `applyingPurge` → `applyingPush {sent}/{total}` → `applyingDone` — with `applyingSafeToLeave` beneath it, and the `member.resync_started` / `member.resync_done` notifications (§5.6) carry the state to any other route. The card header shows a spinner pill. The Section's Edit, the card's Disconnect, `Sync now` and `addCentral` are disabled for the duration; a second apply mid-resync is the one way to genuinely lose data.
- **Done** → green `applyOk`, auto-clears after 6s. **Error** → red `applyErr` with the draft **kept in edit mode**, so the user retries without re-toggling 14 switches.

### 9.5 Per-card states

| state | trigger | render |
|---|---|---|
| checking | `status === undefined` | grey dot, `checking` |
| connecting | no `lastSuccessAt`, no error | grey dot, `connecting` |
| no identity | `user === ''` | grey dot, `noIdentity` + `retry` — whoami is re-run automatically each cycle (§5.10); the button forces one |
| connected | `errKind === null && lastSuccessAt` | green dot, `connected · lastSync 12s · 41ms` |
| offline | `errKind === 'net'` | amber dot, `reconnecting`, amber card border. Repo panel stays **editable** — rules are local |
| unauthorized | `errKind === 'auth'` | red dot, `unauthorized` + `authHelp`. Repo panel hidden — there is nothing to purge |
| resyncing | `status.resync != null` | spinner pill, progress strip, sibling write actions disabled |
| apply-queued | apply attempted while offline (`pendingRules`) | amber `applyQueued` — **not optional**: an offline apply reporting success would leave the user believing a repo is hidden while the central still holds it |
| central too old | `canPurge === false` | repo panel replaced by `centralTooOld`, Edit disabled |
| archive off | `prefs.archiveMode === 'off'` | repo panel replaced by `archiveOffNote` (a `<Link to="/settings/sessions">`), Edit disabled |
| broken endpoint | `hostOf` fell back | `brokenConn` card, Disconnect only |
| empty list | `connections.length === 0` | dashed panel, `emptyTitle`/`emptyBody` + Add button |
| prefs load error | GET failed | the existing red panel; list not rendered |

### 9.6 Beyond the Connection page

Two surfaces outside Settings must change, or a blocked repo is invisible three weeks later and the sidebar lies.

**Repository surfaces.** `deniedRepos` is local and same-origin, so the web app can read it for free without touching §6.4. `ConnectionsPanel`'s prefs load lifts `Map<repoKey, connectionLabel[]>` into `AppContext` beside `isMember`; `RepositoriesList` cards and the `RepoDetailPage` header render an `EyeOff` badge — `hiddenFromN` — whose second line names the centrals and which links to `/settings/connection`. On mobile the repo cards are already stacked `RecordCard`s, so this is one extra `fields` row, not a layout fork.

**The sidebar pill.** `MemberConnectionStatus` is rendered twice in `App.tsx` (account button, SideNav header) and reads `connections[0]`'s legacy mirror if left alone — central B can be unauthorized for a week behind a green dot. It becomes an aggregate over `status.connections`, worst-status-wins: 1 connection → today's exact string, unchanged; N all ok → `centralsN` (`2 centrals · synced 12s ago`); N mixed → `nReconnecting` / `nUnauthorized` / `nResyncing` with an amber dot. It links to `/settings/connection`.

### 9.7 Mobile at 390px

- `useIsMobile()` (768px) in `ConnectionCard`, `SharedReposPanel`, `AddCentralDrawer`. No new breakpoint.
- Card header `flex-wrap`s to a second line (dot + hidden pill) so nothing truncates to nothing; chevron 20px inside a 44px hit box.
- Card list is a plain vertical stack, `gap: 10` — **not** `.ag-grid`; a 2-col grid of expanding accordions reflows the neighbour. Desktop keeps `maxWidth: 760`, single column, for the same reason.
- **No nested scroll container on mobile.** The repo list's `maxHeight: 360, overflowY: auto` is **desktop only**; on mobile the list grows and the page scrolls, capped by a `showAllRepos` disclosure after 12 rows. A scroll region inside an accordion inside a sticky-header page, with the keyboard consuming half the viewport when the search box is focused, produces scroll chaining and an unreachable Save — and nothing else in the app does it (`ProjectsModal` goes full-screen, tables become `RecordCard` stacks, only `overflow-x` containers nest). Save/Cancel are pinned by the existing `Section` edit footer.
- Repo rows are a 2-line `RowSwitch`, `minHeight: 48`; long remotes ellipsize with the full value in `title`.
- Every input ≥16px on mobile (`fontSize: isMobile ? 16 : 13`).
- `addCentral`, Save, Cancel, `Sync now`, Disconnect, bulk share/block → `width: 100%, minHeight: 44` on mobile only.
- No tables in this feature, so there is no desktop-table/mobile-card fork to keep in sync. The endpoint is the only long unbreakable string → `wordBreak: 'break-all'` in its own container.
- **Verification gate:** `document.documentElement.scrollWidth <= window.innerWidth` at 390px on `/settings/connection` with (a) 0 connections; (b) 3 connections, one expanded; (c) the repo panel in edit mode with a 60-char remote; (d) `AddCentralDrawer` open on step 1 and step 2; (e) the read view with 5 blocked repos, longest remote 60 chars; (f) the resync progress strip active; (g) the Disconnect `ConfirmModal` with `requireText` open. Plus a real-device check that no input zooms on focus.
- No nav change needed — `/settings` is already in both `SideNav` and `navTiles`.

### 9.8 EN/PT copy (`components/team/copy.ts`)

Entries written as `{one, other}` are pluralized by `plural(key, n)`. `(s)`-style fudges are acceptable in the CLI table; they are not acceptable in the panel, and "1 bloqueados" / "1 sessões" is what a naive `{n}` template produces in PT.

| key | en | pt |
|---|---|---|
| `pageIntro` | Connect this machine to one or more centrals. You choose, per central, which repositories it may see. | Conecte esta máquina a uma ou mais centrais. Você escolhe, por central, quais repositórios ela pode ver. |
| `connectedCentrals` | Connected centrals | Centrais conectadas |
| `addCentral` | Add central | Adicionar central |
| `emptyTitle` | Not connected to any central | Sem conexão com nenhuma central |
| `emptyBody` | All data stays on this machine. Add a central to start sharing your metrics. | Todos os dados ficam nesta máquina. Adicione uma central para começar a compartilhar suas métricas. |
| `checking` | Checking… | Verificando… |
| `connecting` | Connecting… | Conectando… |
| `connected` | Connected | Conectado |
| `reconnecting` | Reconnecting… | Reconectando… |
| `unauthorized` | Unauthorized | Não autorizado |
| `noIdentity` | Not yet identified by this central | Ainda não identificado por esta central |
| `retry` | Retry | Tentar novamente |
| `authHelp` | This central rejected the token. Rotate it in the central's Machines panel, then run `agentop member connect` again with the new token. | A central rejeitou o token. Rotacione-o no painel de Máquinas da central e rode `agentop member connect` de novo com o novo token. |
| `lastSync` | last sync {t} | último envio {t} |
| `lastActiveT` | last active {t} | ativo há {t} |
| `blockedPill` | {one: `1 hidden`, other: `{n} hidden`} | {one: `1 oculto`, other: `{n} ocultos`} |
| `centralsN` | {n} centrals | {n} centrais |
| `nReconnecting` | {n} reconnecting | {n} reconectando |
| `nUnauthorized` | {n} unauthorized | {n} não autorizadas |
| `nResyncing` | {n} re-syncing | {n} ressincronizando |
| `hiddenFromN` | {one: `Hidden from 1 central`, other: `Hidden from {n} centrals`} | {one: `Oculto de 1 central`, other: `Oculto de {n} centrais`} |
| `sharedRepos` | Shared repositories | Repositórios compartilhados |
| `sharingAll` | Sharing every repository on this machine, including new ones. | Compartilhando todos os repositórios desta máquina, inclusive os novos. |
| `nShared` | {one: `1 of {total} shared`, other: `{n} of {total} shared`} | {one: `1 de {total} compartilhado`, other: `{n} de {total} compartilhados`} |
| `newRepoNote` | A repository that appears later is shared by default. | Um repositório que aparecer depois é compartilhado por padrão. |
| `searchRepos` | Search repositories… | Buscar repositórios… |
| `shareAll` | Share all | Compartilhar todos |
| `blockAll` | Block all | Bloquear todos |
| `groupBlocked` | Blocked ({n}) | Bloqueados ({n}) |
| `groupShared` | Shared ({n}) | Compartilhados ({n}) |
| `showAllRepos` | Show all {n} | Mostrar todos ({n}) |
| `sessionsN` | {one: `1 session`, other: `{n} sessions`} | {one: `1 sessão`, other: `{n} sessões`} |
| `noRepoTitle` | No repository | Sem repositório |
| `noRepoSub` | Sessions with no detected git remote — including sessions from CLIs that don't record one. Blocked automatically when you block anything else. | Sessões sem remote git detectado — inclusive de CLIs que não registram um. Bloqueadas automaticamente quando você bloqueia qualquer outra coisa. |
| `mixedRepoWarn` | This folder contains more than one repository, so sessions in it can't be split. It is blocked as a whole. | Esta pasta contém mais de um repositório, então as sessões nela não podem ser separadas. Ela é bloqueada por inteiro. |
| `staleGroup` | {one: `1 blocked repository with no sessions on this machine`, other: `{n} blocked repositories with no sessions on this machine`} | {one: `1 repositório bloqueado sem sessões nesta máquina`, other: `{n} repositórios bloqueados sem sessões nesta máquina`} |
| `staleHint` | Still blocked. If the repository comes back, it stays hidden from this central. | Continuam bloqueados. Se o repositório voltar, ele segue oculto desta central. |
| `applyImpact` | Removes {sessions} sessions (~{cost}) from this central. | Remove {sessions} sessões (~{cost}) desta central. |
| `applyConfirmTitle` | Apply sharing rules? | Aplicar regras de compartilhamento? |
| `applyConfirmBody` | Your data on this central is deleted and re-sent using the new rules. Anything already sent has been seen — whoever runs this central can tell that data was removed, and what it was. | Seus dados nesta central são apagados e reenviados com as novas regras. O que já foi enviado já foi visto — quem opera a central consegue perceber que algo foi removido, e o quê. |
| `applyConfirmStats` | This central also stops receiving your full Claude history. Its totals for this machine will be computed only from the sessions you share, starting {date} instead of {realFirstDate} — with no explanation shown on that dashboard. | Esta central também deixa de receber seu histórico completo do Claude. Os totais dela para esta máquina passam a ser calculados só com as sessões compartilhadas, a partir de {date} em vez de {realFirstDate} — sem nenhuma explicação no dashboard dela. |
| `applyConfirmBtn` | Apply and resend | Aplicar e reenviar |
| `applyingPurge` | Removing your data from the central… | Removendo seus dados da central… |
| `applyingPush` | Re-sending {sent} of {total} sessions… | Reenviando {sent} de {total} sessões… |
| `applyingSafeToLeave` | You can leave this page — this continues in the background. | Você pode sair desta página — isso continua em segundo plano. |
| `applyingDone` | Done — re-syncing finished | Pronto — ressincronização concluída |
| `applyOk` | {one: `Rules applied — 1 session re-sent`, other: `Rules applied — {n} sessions re-sent`} | {one: `Regras aplicadas — 1 sessão reenviada`, other: `Regras aplicadas — {n} sessões reenviadas`} |
| `applyErr` | Could not apply the rules | Não foi possível aplicar as regras |
| `applyQueued` | Rules saved. The central is unreachable — they will be applied on the next successful sync. | Regras salvas. A central está inacessível — elas serão aplicadas no próximo envio bem-sucedido. |
| `statsNote` | While any repository is blocked, this central receives totals computed only from the sessions you share — its history for this machine starts on {date}. | Enquanto houver repositório bloqueado, esta central recebe totais calculados apenas com as sessões que você compartilha — o histórico dela para esta máquina começa em {date}. |
| `ciNote` | This only covers sessions from this machine. If the repository also pushes from GitHub Actions, it stays visible on the central. | Isto cobre apenas as sessões desta máquina. Se o repositório também envia pelo GitHub Actions, ele continua visível na central. |
| `otelWarn` | OpenTelemetry export is on. It sends unfiltered totals and is not covered by these rules. | A exportação OpenTelemetry está ligada. Ela envia totais sem filtro e não é coberta por estas regras. |
| `centralTooOld` | This central is too old to remove data on request. Upgrade it to 1.7.3 or later to use sharing rules. | Esta central é antiga demais para remover dados sob demanda. Atualize-a para 1.7.3 ou superior para usar regras de compartilhamento. |
| `archiveOffNote` | Sharing rules need session archiving. Open Settings → Sessions and choose "Consolidate metrics". | As regras de compartilhamento exigem o arquivamento de sessões. Abra Configurações → Sessões e escolha "Consolidar métricas". |
| `syncNow` | Sync now | Sincronizar agora |
| `disconnect` | Disconnect | Desconectar |
| `disconnectBtn` | Disconnect | Desconectar |
| `cancel` | Cancel | Cancelar |
| `disconnectTitle` | Disconnect from {central}? | Desconectar de {central}? |
| `disconnectBody` | Your data is deleted from this central and this machine stops pushing to it. Other centrals are unaffected. | Seus dados são apagados desta central e esta máquina para de enviar para ela. As outras centrais não são afetadas. |
| `disconnectHint` | Type "{central}" to confirm | Digite "{central}" para confirmar |
| `brokenConn` | This connection's address can't be read. Disconnect and add it again. | Não foi possível ler o endereço desta conexão. Desconecte e adicione de novo. |
| `addTitle` | Add a central | Adicionar uma central |
| `addTokenLabel` | Machine token | Token da máquina |
| `addTokenSub` | The token minted for this machine on the central (Settings → Machines). The URL is filled in from it. | O token gerado para esta máquina na central (Configurações → Máquinas). A URL é preenchida a partir dele. |
| `addEndpointLabel` | Central URL | URL da central |
| `addLabelLabel` | Name (optional) | Nome (opcional) |
| `addLabelSub` | Only for you — the central never sees it. | Só para você — a central nunca vê isso. |
| `addRulesIntro` | Choose what this central may see. Nothing is sent until you finish — a repository you block here is never shared with it. | Escolha o que esta central pode ver. Nada é enviado até você concluir — um repositório bloqueado aqui nunca é compartilhado com ela. |
| `dupCentral` | This machine is already connected to that central. Replace the token on the existing connection? | Esta máquina já está conectada a essa central. Substituir o token da conexão existente? |
| `tokenInUse` | That token is already used by {central}. | Esse token já é usado por {central}. |
| `connectBtn` | Connect | Conectar |
| `whatIsPushed` | Only computed session metrics (tokens, cost, duration) are pushed — no conversation content. | Apenas métricas computadas (tokens, custo, duração) são enviadas — nenhum conteúdo de conversa. |

---

## 10. Migration and backwards compatibility

**Solo machines.** `migrateTeamConfig` returns `{schema:2, mode:'solo', connections: []}`. No uploader, no socket, no files created. Zero change in behaviour beyond the added `schema` key.

**Existing single-central members.** On the first read after upgrade the flat config becomes `connections[0]` with `deniedRepos: []` and a **deterministic** id (`legacyConnectionId`), so every reader agrees before anything is persisted. `migrateTeamStateOnce()` then persists it, moves `team-sent.json` / `team-sync.json` into `connections/`, converts the hashes losslessly (`sha256(oldValue)`), and seeds `rulesHash: denialSignature([])`. Because the denylist is empty, `pushOnceDetailed` takes the unrestricted path and pushes the real supplemented statsCache exactly as before. The sync signature gains `connId`, so it changes once → **one** sig-mismatch re-push per member on upgrade, idempotent, non-recurring. Nothing purges: a missing `rulesHash` is defined as "no restrictions", and the shrink detector triggers on denial, not absence.

**Older centrals.** Nothing on the wire changes at all — `IngestBody` is byte-compatible and `StatsCache` gains no fields. `POST /api/team/leave` and `POST /api/team/ingest` are used exactly as they are today. A new member works against an old central with full functionality **except** retroactive removal, which is capability-probed (§7): pre-1.6.6 and ingest-only centrals cannot purge at all, 1.7.0–1.7.2 cannot purge workflow runs, and in both cases the rules editor refuses up front with `centralTooOld` rather than reporting a success it cannot deliver.

**Older members against a new central.** Unaffected — the central has no new expectations, and `capabilities` is additive.

**Older clients sharing the same `~/.agentistics`.** This is the Docker-machine case CLAUDE.md documents (configure on the host, container inherits) and it is why the legacy flat fields keep being **written** for one release. Without the mirror, an upgraded host binary plus an un-rebuilt container gives a container that reads `mode: 'member'` with `endpoint: undefined`, fails `pushCycleCore`'s `endpoint && user` guard, and stops pushing entirely — no error, no notification, a status pill still reading "member", and a member permanently offline on the central because `reconcileConnection` refuses to open the WS. With the mirror, the old container keeps working against `connections[0]` while the new binary owns the array.

**Older cached SPA.** `/api/team/status` keeps `mode` plus a legacy mirror of `connections[0]`'s flat fields, and `PUT /api/preferences` treats a `connections`-less team payload as a single-connection edit (§5.8), so a stale bundle renders a working single-central pill and cannot delete the array. `POST /api/team/leave-central` is retained and rewritten per-connection. Remove the mirrors one release later.

**Rollback.** Downgrading leaves `connections/` on disk and `connections[]` in preferences, but the legacy flat mirror is still there and still points at `connections[0]`, so the old binary reads a working single-central member and keeps pushing. Reinstalling forward restores the full list. The one asymmetry to document: connections 2..N are invisible (and un-pushed) while downgraded, and any rules created while upgraded are inert for that period.

---

## 11. Risks and mitigations

Ranked. Every mitigation is folded into the design above.

| # | Risk | Severity | Mitigation (section) |
|---|---|---|---|
| R1 | Migration mints a random id inside a **read** path nobody persists → a new identity every cycle: full re-push forever, a new WebSocket every 5s, and the previous cycle's state file deleted each tick | critical | Deterministic `legacyConnectionId(endpoint, token)` on the migration path only, plus a single-flight, marker-guarded `migrateTeamStateOnce()` that persists before anything else reads (§3.2, §3.3) |
| R2 | Synthetic cache destroys the member's deep history; a user with 2y of `stats-cache.json` and a 3m store loses 80% of their reported usage on a central by blocking one repo, silently | critical | Selected by the **declared** rule so the transition coincides with the confirm dialog; both dates stated in `applyConfirmStats` **before** the commit; `coverageFrom` on the local status route and in the persistent `statsNote` (§4.4, §9.4) |
| R3 | The real-vs-synthetic switch keyed on `filtered.length < all.length` fails **open** — an empty/short store, `archiveMode: 'off'` after rules exist, or a `loadConsolidated` error pushes the real full-history cache **with the denied repo in it** | critical | Switch on `hasRestrictions(denied)`; no raw-file fallback on the restricted path; omit `statsCache` entirely rather than send the real one (§4.4) |
| R4 | The shrink detector reading absence as denial purges the central whenever the store momentarily reads short — non-atomic `writeConsolidated`, `safeReadJson` swallowing errors, a container starting before its bind mount | critical | Trigger is `deniedSessionIds`, never absence; no purge while `ctx.sessions.length === 0` (§5.5) |
| R5 | Purge-then-repush has no journal — a killed process leaves the central permanently empty behind a green pill | critical | `team-purge-<connId>.json` written **before** the leave; sent-state cleared **before** the leave; boot checks for a stale journal; explicit retry loop (§6.1, §6.3) |
| R6 | `autoResetOnRevoke` nukes all connections when one central revokes | critical | `removeConnection(connId)` — read-modify-write on `connections`, `mode` derived, other centrals untouched (§5.7) |
| R7 | `POST /api/team/leave` silently takes the `{org, user}` branch on a wiped/restored central and deletes a **sibling machine's** data, which never re-pushes because its own state is intact — and both branches return `{ok:true}` | critical | `GET /api/team/whoami` (minted-token-only) immediately before every leave; assert on `body.ok`, not `res.ok`; abort with `pendingRules` otherwise (§6.1, §7) |
| R8 | A legacy `PUT /api/preferences {team}` from a stale tab or an old container replaces the whole block — every connection and every denylist gone | critical | A team payload with no `connections` key is merged as a legacy single-connection edit, `409` when N > 1; dedicated connection routes for everything else (§5.8) |
| R9 | Purge-then-repush is itself the disclosure for any repo already pushed | high | §6.4 states the guarantee as strong for never-shared repos and weak for already-shared ones; `applyConfirmBody` says it in those words; the Add wizard makes "block before the first push" the default path (§6.4, §9.2) |
| R10 | Adding a central pushes the full unfiltered history before the user can restrict anything, converting every safe case into R9's unsafe one | high | Repo rules are step 2 of the add wizard; `POST /api/team/connections` accepts `deniedRepos`; no timer, socket or `push-now` before that body is committed (§5.8, §9.2) |
| R11 | `partial` / `coverageFrom` on the wire is a self-declared "I am withholding data" flag that quantifies how much | high | Both removed from `IngestBody`; `StatsCache` gains nothing; disclosure is local and pre-commit (§4.4) |
| R12 | Retroactive removal is silently incomplete against 1.7.0–1.7.2 (workflow runs survive) and impossible before 1.6.6 / on ingest-only centrals, while the UI reports success | high | `capabilities` on `/api/team/policy` + a leave probe; `canPurge:false` disables the rules editor with `centralTooOld` (§7, §6.3) |
| R13 | Token rotation appends a **second, unrestricted** connection: the machine double-counts on the central under two `memberId`s and the blocked repo silently re-shares | high | Uniqueness is the normalized endpoint; a known endpoint updates in place preserving `id`/`deniedRepos`; a token already used elsewhere is refused (§3.2, §5.8, §8) |
| R14 | Two connections to one central via different endpoint spellings collapse onto one `memberId`: alternating `replaceOne` of `memberStats` and a purge on one deleting the other's sessions | high | Same rule — one token, one connection (§3.2) |
| R15 | `notifyDataChanged()` turns denied-repo activity into a ~2s-resolution timestamped heartbeat on the central via the empty-delta push | high | Restricted connections never fan out on change; empty-delta pushes suppressed when nothing changed; periodic pushes jittered (§5.3) |
| R16 | Non-Claude sessions carry no `git_remote` (the persisted backfill runs Claude-only, pre-merge), so blocking a repo does not block Codex/Gemini/Kimi/agy work in it — and `project_path` names the repo | high | `buildPathRepoIndex` seeded from `ServerProject.gitRemote` as well as sessions; everything still unresolved lands in `NO_REPO_KEY`, which is pre-blocked on the first restriction (§4.2) |
| R17 | Sessions that *become* denied (backfilled remote, repo rename, folder gains a remote) stay on the central forever | high | The denial-based shrink detector runs **every cycle**, before the `instanceId` guard (§5.5) |
| R18 | The rules check sitting behind `reconcileSyncState`'s `if (!instanceId) return` means an older, flaky or ingest-only central never triggers a purge, behind a green pill | high | Rules and shrink are local facts, evaluated first and unconditionally (§5.5) |
| R19 | A migrated sync file has no `rulesHash`, so `undefined !== denialSignature([])` purges the entire fleet's centrals on upgrade day, simultaneously | high | Missing `rulesHash` is defined as `denialSignature([])`; the migration seeds it explicitly (§3.3, §5.5) |
| R20 | `WorkflowRun` has no repo — names, agent labels and cost of a denied repo keep flowing; and runs pushed in batch 0 of a failed push are in no sent-state, so they never appear stale | high | `filterSharedWorkflows` fail-closed; `runIds` recorded in the sent-state and included in the stale computation (§4.2, §5.4) |
| R21 | Multi-repo project directories mis-attribute; denied work is shared while the user believes it is not | high | `PathRepoIndex.conflicts`; the whole ambiguous path is excluded and the row renders blocked-and-locked, not annotated (§4.2, §9.3) |
| R22 | Preference writes are unlocked and non-atomic; a torn read falls through to `DEFAULT_PREFS` and the machine silently reads as **solo** — every connection, denylist, `archiveMode` and layout gone | high | Serialized single-writer chain, tmp+rename, and a reader that refuses to default on a parse error of a non-empty file (§5.8) |
| R23 | State-file GC on a timer races the add route and the preferences write, deleting a live connection's sent-state | high | GC runs only inside the serialized write that mutated `connections[]`, against the post-write array (§3.4) |
| R24 | `GET /api/preferences` is unauthenticated with wildcard CORS — any website the user visits can read every central token, and `deniedRepos` would join it | high | Tokens redacted out of the GET entirely (the UI never needs one); origin-echo instead of `*` on preferences/status/connection routes; same-origin mobile use unaffected (§5.8) |
| R25 | Push-cycle ordering (`loadConsolidated` before `buildApiResponse`) makes a restricted connection's first cycle after boot `replaceOne` the central's totals with **zeros** | high | `buildApiResponse()` first in `PushCycleContext`; refuse to push a synthetic cache of zero sessions while the real cache is non-empty (§5.2, §4.4) |
| R26 | Keying state by endpoint (or endpoint+token) collides — two accounts on one central share a sync file and thrash into a re-push loop | high | Random `connId` in every Map, every filename, and the sync signature (§3.2, §5.5) |
| R27 | In-flight unfiltered push lands after the `deleteMany` and resurrects denied sessions permanently | high | Per-connection push lock held across the whole purge sequence (§6.1) |
| R28 | Case- and host-variant remote keys produce two rows and two rules; blocking the recognized one leaves the other shared | high | `canonicalRepoKey` folds case and `ssh.`/`altssh.` aliases; picker rows group by it (§4.2, §9.3) |
| R29 | `cli-member.ts`'s `nudgeLocalServer` PUTs the whole `team` block — the exact write §5.8 forbids, on every invocation of the shipped CLI | high | CLI mutations go through the connection routes; the no-server path takes the preferences lock and writes directly (§8) |
| R30 | Sessions that cannot be attributed are "new repos" under D2 and ship `project_path`, `first_prompt`, `title` and cost | high | Unresolved ≠ new: `withUnresolvedDenied` writes `NO_REPO_KEY` into the list on the first restriction, visible and pre-blocked (§4.2) |
| R31 | Synthetic cache double-counts non-Claude sessions on the central (a naive extraction keeps `supplementStatsCache`'s all-harness `dailyActivity`) | high | `claudeOnly` on the accumulator, gated in `buildSharedStatsCache`, with a mixed-harness unit test (§4.2, §4.5) |
| R32 | One WebSocket singleton → whichever connection reconciles first owns the socket, and the member reads as **hard offline** on every other central | medium-high | `Map<connId, WebSocket>` + per-connection reconcile and backoff (§5.10) |
| R33 | A change event arriving while the purge lock is held is **dropped**, not deferred — including the `backfillGitRemote` heal that most likely changed what is shared | medium-high | `pendingTrigger` per connection; never write the sync/rules files for a sequence during which an event was swallowed (§5.2, §6.1) |
| R34 | `sessionHash` stores a full session copy per connection; O(batches²) I/O × N | medium-high | sha256 digest + versioned sent-state, with a lossless offline v1→v2 conversion so the upgrade costs zero re-pushes (§5.4, §3.3) |
| R35 | `getUploaderStatus()` singleton feeds three surfaces; `agentop member status` already reports garbage; the sidebar pill would silently show only `connections[0]` | medium-high | Per-connection status; the CLI queries the local server; the pill aggregates worst-status-wins (§5.9, §8, §9.6) |
| R36 | No shared tick, so `PushCycleContext` cannot be "built once": N× `buildApiResponse` + full store scans per period | medium-high | Time-windowed single-flight memo; `loadConsolidated` memoized against the store's write counter; concurrency cap of 2 (§5.2) |
| R37 | `AGENTISTICS_TEAM_SENT_FILE` bound to a positional `connections[0]` cross-assigns state after a splice — the surviving central reads a foreign sent-state and silently never delivers those sessions | medium | Honoured only while `connections.length === 1` and only pre-migration; hard error on adding a second connection while set (§3.4) |
| R38 | `handleLeaveCentral` calls the global `resetSyncState()` — an old SPA's Disconnect gives an unrelated central a spurious re-push while the purged one keeps its sent-state | medium | Maps `{endpoint, token}` → `connId`, resets only that connection, removes the entry itself (§5.8) |
| R39 | Purge on *un-block* is gratuitous loss and re-enters the R5 window for nothing | medium | Purge only when the shared set shrinks; growth just clears sent-state; the UI commits the whole draft once (§5.5, §9.4) |
| R40 | `archiveMode: 'off'` makes every rules change permanently truncate the central's history — and rules created *before* the switch would silently start pushing the real cache again | medium | Editor disabled with `archiveOffNote`; existing restrictions push **no** statsCache rather than the real one (§4.4, §6.3) |
| R41 | N latency probes × 4s inside a 5s poll | medium | Probe moves into the uploader cycle; the route returns cached values (§5.9) |
| R42 | One debounce timer and one interval floor for N cadences; the global `running` guard blocks all pushes | medium | Per-connection timer, floor and running flag; `notifyDataChanged()` fans out (§5.1) |
| R43 | `resolveMachineCacheScope` now serves *filtered* totals; the same machine reports different numbers to A, to B and to its own dashboard | medium | Intended and internally consistent, disclosed locally pre-commit. Nobody may "fix" it by falling back to session sums — the project rule forbids that (§4.4) |
| R44 | `first_prompt` and `title` are already on the wire, so a filter miss leaks content, not just volume | medium | Fail-closed everywhere in `share-rules.ts`, explicitly tested for `undefined`/`''`/unknown `git_remote`/conflicting paths (§4.2, §12) |
| R45 | The post-purge re-push burst leaks the withheld/retained split through request counts and duration alone | medium | Re-push paced at the connection's normal cadence with jitter; resync progress never leaves the local status route (§6.1) |
| R46 | Colluding centrals set-difference each other's shared sets and recover the denied list exactly | medium | Documented in §6.4 as an explicit non-guarantee; per-connection identity is already the design's shape |
| R47 | OTel export is an unfiltered side door that no denylist covers | medium | Documented; `otelWarn` shown in Settings when OTel is on and any repo is blocked (§5.3) |
| R48 | CI ingest bypasses the machine denylist entirely | medium | Documented; `ciNote` in the UI copy (§7, §9.8) |
| R49 | A connection whose `user` never resolved pushes nothing forever with no retry | medium | Gate on token, not name; re-run whoami on any cycle where `user === ''`; `noIdentity` card state with a manual `retry` (§5.10, §9.5) |
| R50 | `new URL(conn.endpoint)` in a `.map` render takes the whole Connection page down on one malformed endpoint — including the Disconnect that would fix it | medium | `hostOf()` + a `brokenConn` card (§9.2) |
| R51 | `.ag-settings button { min-height: 44px }` deforms every `Toggle`, and "the whole row is the tap target" plus a nested `Toggle` is a `<button>` inside a `<button>` | medium | `RowSwitch` (row is the only button, `role="switch"`); `.ag-settings button.ag-switch { min-height: 0 }` un-deforms the existing toggles (§9.1) |
| R52 | The mobile repo list as a nested scroll container under a sticky header with the keyboard open — scroll chaining and an unreachable Save | medium | Height cap is desktop-only; mobile grows the page with a `showAllRepos` disclosure after 12 rows (§9.7) |
| R53 | Blocked repos are invisible outside Settings; the pill lies with N centrals | medium | `EyeOff` badge on `RepositoriesList` / `RepoDetailPage` via `AppContext`; aggregate sidebar pill (§9.6) |
| R54 | Resync progress lives only on the page that started it; the pill reads green throughout because presence is unaffected | medium | `applyingSafeToLeave` + `member.resync_started` / `member.resync_done` notifications + `nResyncing` in the pill (§5.6, §9.4, §9.6) |
| R55 | Denied-repo chips overflow the viewport at 390px (full remotes ~48 chars) | medium | `repoShortName` + wrap + per-chip ellipsis with `title`; added to the verification gate (§9.4, §9.7) |
| R56 | `{n}` templates read "1 bloqueados" / "1 sessões" throughout PT | low-medium | `{one, other}` entries + a two-line `plural()` helper in `copy.ts` (§9.8) |
| R57 | Two connections to the same central are visually identical and un-renamable | low-medium | `label` in the add wizard, inline rename on the card, automatic `host · user` promotion on a duplicate host (§9.2) |
| R58 | `Sync now` disappears in the rewrite — with N centrals and per-connection cadence, "make B sync" becomes unreachable | low-medium | Per-card `syncNow` wired to `POST /api/team/push-now {connectionId}` (§9.2) |
| R59 | `AddCentralDrawer` silently discards a pasted token on a backdrop tap (full-screen on mobile) | low-medium | Pass `dirty` to the existing `Drawer`, which already confirms discard (§9.2) |
| R60 | Reverse-channel chat fetch is a `410` today; a future re-add would bypass the denylist | low | Recorded as an invariant: any future reverse-channel data request routes through `sessionShared()` on the member, with the socket's `connId` selecting the denylist (§5.3) |
| R61 | `connections` added to `TeamConfig` while web-local `DEFAULT_TEAM_CONFIG` duplicates remain → `.map` of `undefined` | low | `connections` non-optional in the type, `readTeamConnections(prefs)` in core, the three web duplicates deleted (§3.5) |
| R62 | Presence cannot be filtered — a member blocking everything is still a live named machine | low | Accepted non-goal, stated in §6.4 and §7 |
| R63 | `archiveOffNote` points at the wrong tab (the control lives in Settings → Sessions, labelled "Consolidate metrics") | low | Corrected copy + a real `<Link to="/settings/sessions">` (§9.8) |

### Invariant ledger

| CLAUDE.md invariant | Status under this design |
|---|---|
| "The member's deep Claude history exists ONLY aggregated … must NOT silently fall back to summing sessions" | **Held** — the fallback is never silent *to the person choosing it*: both dates are stated in the confirm modal before the commit and restated in the card. It is unexplained *on the central*, which is the inherent consequence of withholding history and is disclosed as such (§4.4, R2) |
| "`stats-cache.json` is Claude-only" | **Held** — `buildSharedStatsCache` is Claude-gated (R31) |
| "Members never push chat" | Held; weakened in practice by the pre-existing `first_prompt`/`title` fields (R44) |
| "The central is the sole authority on the push interval" | Held, restated **per connection**; no machine-wide max or min. Post-purge pacing and jitter stay within the central's floor |
| "Tokens stored only as sha256 hashes, never logged" | Unchanged on the central; member-side plaintext multiplies in `preferences.json`, but tokens no longer leave the machine over HTTP at all (R24) |
| "EVERY new screen MUST also deliver its mobile version" | Held — §9.7 with an explicit seven-state verification gate |
| "CI attribution is server-authoritative" | Unchanged; means the denylist does not cover CI (R48) |

---

## 12. Testing

Pure functions only, no filesystem mocks, per repo convention.

### `packages/server/server/share-rules.test.ts`

**Keys and normalization**
1. `NO_REPO_KEY` contains no `/` and `normalizeGitRemote(NO_REPO_KEY) === ''` — proves collision is impossible.
2. `git_remote: 'github.com/org/repo'` → that key; `undefined` and `''` → `NO_REPO_KEY`.
3. A denormalized survivor `git@github.com:Org/Repo.git` and `https://github.com/org/repo` produce the **same** canonical key; a denylist entry in either spelling matches both.
4. `canonicalRepoKey` folds `ssh.github.com` and `altssh.bitbucket.org` to their base hosts.
5. `normalizeDenied(['', '__no_repo__', 'junk', 'GitHub.com/O/R.git'])` → `{NO_REPO_KEY, 'github.com/o/r'}`.
6. `normalizeDenied(undefined | [])` → empty; `hasRestrictions` false.
7. `repoKeyOf` with an index: a remote-less Codex session at a known path resolves via the map; a session with its own `git_remote` ignores the map.

**Filtering**
8. Empty denylist → every session shared, including `NO_REPO` ones (the share-by-default rule).
9. Denying one remote drops exactly its sessions and keeps `NO_REPO` sessions.
10. Denying `NO_REPO_KEY` drops only unresolved sessions.
11. `filterShared` preserves order, returns a new array, and leaves the input deep-equal.
12. Non-Claude sessions obey the same rule.
13. **Gap regression:** with the index, a remote-less Codex session in a denied repo's folder is dropped.
14. **Index seeding:** a directory used only by non-Claude sessions resolves via `ServerProject.gitRemote`; with neither source it falls to `NO_REPO_KEY`.
15. `buildPathRepoIndex` — first writer wins for `resolved`; a path seen with two remotes lands in `conflicts`.
16. **Conflict fail-closed:** a session in a conflicting path is denied when *any* remote of that path is denied, even though its own key is shared.
17. `withUnresolvedDenied([])` → `[]`; `withUnresolvedDenied(['github.com/o/r'])` includes `NO_REPO_KEY`; applying it twice is idempotent.
18. `deniedSessionIds` returns only ids present in the input **and** excluded — never ids that are merely absent from the store.

**Workflows**
19. A run whose session is shared survives; 20. whose session is denied is dropped; 21. whose `sessionId` matches nothing is dropped (fail-closed); 22. empty shared set → `[]`.

**Synthetic cache**
23. Empty input deep-equals `emptyStatsCache()` except `version` when supplied.
24. Non-Claude sessions contribute **nothing** to any field (the R31 regression test).
25. `lastComputedDate === ''` even when the input spans months.
26. `totalSessions === Σ dailyActivity.sessionCount` and `totalMessages === Σ dailyActivity.messageCount`.
27. `Σ hourCounts === totalSessions`; keys are **string** start hours (`'9'`, not `9`); two sessions started 09:xx local → `hourCounts['9'] === 2`; `message_hours` is not used.
28. Local-clock bucketing matches `new Date(start_time).getHours()`.
29. `dailyModelTokens` sums the four token fields per model per day; a `<synthetic>` or `gpt-5.4` model is skipped while its session still counts in `dailyActivity`.
30. `modelUsage[m].costUSD === 0` and `webSearchRequests === 0`.
31. `firstSessionDate` is the earliest **full ISO** `start_time`, `''` when none.
32. `longestSession` is the zero value even with a 400-minute session present.
33. Sessions with no `start_time` are skipped without throwing.
34. Output is JSON-round-trippable, structurally a `StatsCache`, and **has no keys outside the `StatsCache` shape** — the guard against a marker field creeping back onto the wire.
35. **End-to-end:** with `denied = {repoA}`, `buildSharedStatsCache(filterShared(...))` has zero contribution from repoA on **every field**, asserted per field, not just on totals.
36. `coverageFrom` returns the earliest shared local day, `''` for an empty set.

**Accumulator extraction**
37. `{ after: '2026-06-22' }` excludes days `<= '2026-06-22'`; without `after`, nothing is excluded.
38. **Regression:** an all-Claude fixture produces the same `dailyActivity` / `dailyModel` / `modelTotals` as the pre-extraction `supplementStatsCache` — proving the harness gate is a no-op on that path.

**Signature**
39. `denialSignature` is order-, case- and normalization-independent; adding or removing an entry changes it.
40. `denialSignature([])` is stable and distinct from any non-empty list, so clearing all restrictions triggers exactly one purge-and-resync.

### `packages/core/src/team.test.ts`

41. `migrateTeamConfig` on a legacy flat member config → one connection with the same endpoint/org/user/token and `deniedRepos: []`.
42. On a solo config with empty-string `endpoint`/`token` → `{mode:'solo', connections: []}` — **no fabricated connection**.
43. On a legacy config with an endpoint and **no token** → one connection with `token: ''`, `mode: 'member'` (the open/legacy-central member is not dropped to solo).
44. On an already-migrated config → identity, ids preserved.
45. On `undefined` / `null` / a string → `DEFAULT_TEAM`.
46. Two consecutive calls return **distinct array instances** (the `DEFAULT_PREFS` aliasing hazard).
47. **Determinism:** 100 calls on the same legacy input yield the same `id`; `legacyConnectionId` matches `/^c_[a-f0-9]{12}$/`.
48. `normalizeTeamConfig` forces `mode` from `connections.length` in both directions, writes `schema: 2`, and mirrors `connections[0]`'s flat fields — clearing them when the list empties.
49. `connectionId()` matches `/^c_[a-f0-9]{12}$/` and 10 000 calls produce no duplicate.
50. Duplicate normalized endpoints in the input collapse to one connection; the first wins.

### `packages/server/server/team-uploader.test.ts`

51. `sessionHash` is a 64-char hex digest, stable for equal inputs, different for a changed field.
52. `selectDeltas` against a version-2 sent-state; a version-less, non-convertible file is treated as empty.
53. **Lossless conversion:** `sha256(v1value) === sessionHash(session)` for the session that produced `v1value` — the property the migration depends on.
54. `selectDeltas` never marks a denied session as sent (filter-before-select ordering, asserted on `nextSent`).

### `packages/web/src/lib/shareRepos.test.ts`

55. `buildShareTargets` emits exactly **one** `kind: 'none'` entry regardless of how many distinct remote-less folders exist.
56. Case/alias variants of one remote collapse to one row whose `sessions` is the sum.
57. Sorted by sessions desc then name; the none bucket obeys the same rule.
58. A denied key with zero sessions is emitted with `orphan: true`.
59. A `kind: 'none'` entry with zero sessions and not denied is omitted.
60. A path seen with two remotes surfaces as `conflictPaths` on both rows.
61. `countDenied` against a mixed list.
62. `hostOf` returns the host for a valid URL, the raw string for junk, and `'—'` for `''` — never throws.
63. `plural` picks `one` at n=1 and `other` at 0 and 2, in both languages.

### Manual / integration checks

1. **Fresh migration:** a member on the previous version upgrades → exactly one connection with a stable id across restarts, sent-state files renamed **and converted**, **zero** re-push from the hash change and exactly one from the sig change, `agentop member status` shows one block, and the old container sharing `~/.agentistics` keeps pushing via the legacy mirror.
2. **Two centrals:** connect A and B; kill A's process → B's pill stays green, B's socket stays open, B's cadence unaffected; the notification names A.
3. **Revoke on B:** A stays connected, B is removed, prefs keep A's denylist, the toast names B.
4. **Rotate B's token, re-run `member connect`:** the existing connection is updated in place — one connection, one `memberId` on the central, denylist preserved, no duplicate machine row.
5. **Block a repo on B only:** A's totals are unchanged (real cache); B's shrink and the card shows the coverage date; B's session list has no denied session, no denied workflow run, and no denied `project_path`; B's `memberStats.totalSessions` equals B's session-document count.
6. **Block at add time:** add C with a repo blocked in the wizard → the central never receives a single document from that repo, and no leave is ever issued.
7. **Purge crash:** `kill -9` between the leave 200 and the first batch; restart → the journal forces a full re-push and B recovers without user action.
8. **Wiped central:** `down -v` on B, then a rules change on machine 1 while machine 2 is also connected as the same user → whoami fails, the apply aborts with `applyQueued`, and machine 2's data is untouched.
9. **Old central:** point a connection at a 1.7.1 central → `centralTooOld`, the rules editor is disabled, and no sent-state clearing loop occurs.
10. **Offline apply:** stop B, change rules → `applyQueued`; start B → the rules apply on the next cycle and the pill goes green only after the resync completes.
11. **Un-block:** re-share the repo → **no purge** occurs (assert via the central's logs), the sessions reappear by delta.
12. **Retro reclassification:** run a session in a folder with no remote, push, then `git remote add`, let `backfillGitRemote` stamp it while the repo is denied → the shrink detector fires and the session disappears from the central.
13. **Store hiccup:** make `loadConsolidated()` return empty for one cycle on a restricted connection → **no** leave is issued and **no** zero statsCache is pushed.
14. **Heartbeat:** with a repo blocked, work exclusively inside it for 10 minutes and confirm the central's ingest log shows only jittered periodic requests, uncorrelated with local file writes.
15. **Concurrency:** add a central in the browser while `agentop member connect` runs in a terminal → both connections survive, neither denylist is lost.
16. **CLI:** `member leave` with 2 connections in a non-TTY exits 1 with the ambiguity message; with `--all` it leaves both; `cli-start.ts` shows Connect **and** Disconnect with one connection present.
17. **Cross-origin:** `fetch('http://localhost:47291/api/preferences')` from an unrelated page is blocked by CORS, and the same-origin response contains no token.
18. **Mobile 390px** on `/settings/connection` in all seven states of §9.7, plus a real device check that no input zooms on focus and that the repo list scrolls the page rather than a nested container.

---

## 13. Out of scope / YAGNI

- **Allowlist semantics.** D2 fixes denylist. No "share only these repos" mode, no per-repo allow/deny mix.
- **Per-session, per-project, per-model or per-date sharing rules.** Repo (plus the unattributed bucket) is the only dimension.
- **A CLI surface for repo rules.** Web-only by D7. No `--deny-repo`, no `agentop member rules`.
- **Hiding the *fact* that a filter exists.** The only genuinely indistinguishable option is pushing a synthetic cache for every member, restricted or not, which would destroy every member's deep history to protect a fact §6.4 does not promise. Rejected.
- **`pushGeneration` on the central** (delete-after-write, zero purge window). Better than purge-then-repush, but it requires every central to be upgraded before any member can rely on it, which contradicts D4 and §10. Intended follow-up once the member side is proven.
- **A surgical `POST /api/team/leave { sessionIds[] }`.** Would make removal cheap and eliminate R39 entirely, and would also remove the pre/post-delete diff of R9 — but it is a central change with the same upgrade dependency. Same follow-up bucket, and the higher-value one.
- **Editing a connection's endpoint or token in place.** Disconnect and re-add, or re-run `member connect` for a rotation. This deletes the fragile `editing`/`userTouched` ref machinery and an entire class of half-configured states. `label` is editable because it is local and carries no state.
- **Reordering or grouping connections.** The list is sorted by `addedAt`.
- **Moving the `data.ts` `backfillGitRemote` pass after the harness merge and persisting it.** That is the *proper* fix for non-Claude sessions having no `git_remote`, and would improve the dashboard, tags and the Repositories page as well. This design closes the leak from the push side with `buildPathRepoIndex` (seeded from projects) plus the fail-closed unattributed bucket, which touches nothing outside the push path. The reorder is a separate change with its own blast radius, and it is the first thing to do after this ships.
- **Cross-central reconciliation.** A person on two centrals with different restrictions will have irreconcilable totals. Inherent to the feature, not a defect to be engineered away.
- **Defending against colluding centrals.** Documented as a non-guarantee (§6.4); mitigating it would require per-connection machine identities and decorrelated push timing, which is a different feature.
- **Hiding presence.** A restricted member is still visibly online. Accepted non-goal.
- **Covering CI ingest.** A repo registered under `/api/team/repos` stays visible on that central regardless of any machine's denylist. Documented in the UI, not solved.
- **Filtering the OTel exporter.** Out of scope; surfaced as `otelWarn` so a user with both enabled is not misled.
- **Encrypting tokens at rest in `preferences.json`.** Tokens no longer travel over HTTP (§5.8), which is the reachable half of the problem; local-disk encryption needs a key-management story this project does not have.