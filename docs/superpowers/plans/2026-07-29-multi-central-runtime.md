# Multi-central runtime — per-connection push, sockets, routes and CLI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a machine actually push to, and hold a live socket with, several centrals at once — turning the foundation Plan 1 landed into working behaviour, with no repository filtering yet.

**Architecture:** Every module-level singleton in the push path becomes a `Map` keyed by connection id: one timer chain, one sent-state file, one sync signature and one WebSocket per connection. A boot-once migration moves the legacy single-connection state files into `connections/` and converts their hashes losslessly, so an upgrading member re-pushes nothing. New routes own connection mutation, because `PUT /api/preferences` cannot express "add one" safely.

**Tech Stack:** TypeScript, Bun, `@agentistics/core`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-28-multi-central-and-repo-sharing-design.md` — §3.3, §3.4, §5 (all), §8, §9.5's status shape.

**Depends on:** Plan 1 (`docs/superpowers/plans/2026-07-28-multi-central-foundation.md`), merged. Read its "Follow-ups booked out of the final review" section before Task 2 — item 1 is a hard requirement on this plan's wiring.

---

## Before you start

1. **Integrate `origin/dev` first.** At the time of writing this branch was 22 ahead / 36 behind, with 140 files diverging. The remote did NOT touch `team-uploader.ts`, `team-agent-client.ts`, `preferences.ts`, the `cli-*` files, `core/src/team.ts` or `share-rules.ts` — everything this plan rewrites wholesale is untouched — but it did touch `config.ts`, `index.ts` and `core/src/index.ts`, where this plan's changes are additive. Merge, get the suite green, then start.
2. **`team-agent-client.ts` may be under active local edits** (a live-reporting feature that adds `startLiveReporting` and `team-live.ts` around the same socket lifecycle Task 3 rewrites). Confirm that work is committed before Task 3, or the two rewrites collide.

## Global Constraints

- **Everything in English** — code, comments, commit messages. Conventional Commits (commitlint runs on `commit-msg`).
- **The pre-commit hook must pass.** `bun run stub && bun tsc --noEmit && bun test` runs on every commit and the suite is green (809/0) as of Plan 1's close. **Do not use `--no-verify`.** A failure is yours; fix it.
- **Tokens are secrets.** Never log a `TeamConnection`, a token, or a whole preferences object. `GET /api/preferences` redacts tokens (Plan 1) — keep it that way, and never add a route that returns one.
- **The central owns the cadence**, per connection. `clampPushInterval(policy, EXPRESS_MIN_SEC)`; no member-side override that goes faster.
- **`share-rules.ts` stays pure** and stays uncalled by the push path in this plan. Repo filtering is Plan 3.
- **Connection ids** match `/^c_[a-f0-9]{12}$/` and reach the filesystem only through `safeConnId` (Plan 1, `config.ts`).
- **No filesystem mocks in tests.** Pure functions tested directly; path/IO behaviour tested against `tmpdir()`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/server/server/team-migrate.ts` (create) | `migrateTeamStateOnce()` — persist the migrated config, move and convert the legacy sent/sync files, seed the rules file. Runs once per process, marker-guarded. |
| `packages/server/server/team-migrate.test.ts` (create) | The pure hash conversion and the marker/idempotence logic. |
| `packages/server/server/team-uploader.ts` (rewrite) | Per-connection state, timers, sent-state, sync signature, notifications, status. The `PushCycleContext` memo. |
| `packages/server/server/team-agent-client.ts` (rewrite) | One socket per connection; per-connection backoff and reconcile. |
| `packages/server/server/team-connections.ts` (create) | The connection mutation routes' handlers — add / patch / remove / probe — so `index.ts` stays a router. |
| `packages/server/server/team-connections.test.ts` (create) | Pure parts: body validation, uniqueness rules, the update-in-place decision. |
| `packages/server/server/index.ts` (modify) | Route wiring only. |
| `packages/server/server/preferences.ts` (modify) | Cross-process `O_EXCL` lock around the write chain. |
| `packages/server/server/cli-member.ts`, `cli-status.ts`, `cli-start.ts`, `cli-setup.ts`, `bin/cli.ts` (modify) | Multi-central command surface. |
| `packages/server/server/cli-i18n.ts` (modify) | The EN/PT strings §8.2 lists. |

---

### Task 1: The boot-once state migration

**Files:**
- Create: `packages/server/server/team-migrate.ts`, `packages/server/server/team-migrate.test.ts`
- Modify: `packages/server/server/team-uploader.ts` (call it from `startUploader`), `packages/server/server/index.ts` (call it at boot)

**Interfaces:**
- Consumes: `readPreferences` / `writePreferences`, `TEAM_CONN_DIR`, `teamSentFile`, `teamSyncFile`, `teamRulesFile` (Plan 1), `TEAM_SENT_FILE` / `TEAM_SYNC_FILE` (the legacy single-file constants).
- Produces:
  - `export function convertSentStateV1(raw: unknown): SentStateV2 | null` — pure
  - `export async function migrateTeamStateOnce(): Promise<void>`

**Why the conversion is lossless, and why that matters.** The v1 sent-state stored, per session id, `JSON.stringify(session)` — the whole serialized session as its own "hash". Plan 1's v2 stores `sha256(JSON.stringify(session))`. So `v2 = sha256(v1value)` **offline, exactly**: the upgrade costs zero re-pushes. Discarding the file instead would make every member in the fleet re-push its entire history on upgrade day, simultaneously, at the central.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/server/team-migrate.test.ts`:

```ts
import { test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { convertSentStateV1 } from './team-migrate'

test('a v1 entry converts to sha256 of its own stored value', () => {
  const sessionJson = JSON.stringify({ session_id: 'a', input_tokens: 1 })
  const out = convertSentStateV1({ a: sessionJson })!
  expect(out.version).toBe(2)
  expect(out.hashes.a).toBe(createHash('sha256').update(sessionJson).digest('hex'))
  expect(out.runIds).toEqual([])
})

test('an already-v2 file is returned as-is', () => {
  const v2 = { version: 2, hashes: { a: 'ff'.repeat(32) }, runIds: ['r1'] }
  expect(convertSentStateV1(v2)).toEqual(v2)
})

test('junk and unconvertible shapes yield null, never a half file', () => {
  for (const junk of [null, undefined, 42, 'nope', [], { a: 7 }, { version: 9, hashes: {} }]) {
    expect(convertSentStateV1(junk)).toBeNull()
  }
})

test('an empty v1 file converts to an empty v2 file', () => {
  expect(convertSentStateV1({})).toEqual({ version: 2, hashes: {}, runIds: [] })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test packages/server/server/team-migrate.test.ts` — FAIL, module not found.

- [ ] **Step 3: Implement**

Create `packages/server/server/team-migrate.ts`:

```ts
/**
 * team-migrate.ts — the once-per-install move from single-connection state files to the
 * per-connection layout. Impure by design; the conversion itself is pure and tested.
 *
 * Nothing here may run from `readPreferencesFrom`: that function is exported for tests with tmp
 * paths while these paths are module constants, so a rename there would touch the developer's
 * real ~/.agentistics — and since a pure read persists nothing, it would re-run on every read
 * forever.
 */
import { rename, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readPreferences, writePreferences } from './preferences'
import { TEAM_CONN_DIR, teamSentFile, teamSyncFile, teamRulesFile, TEAM_SENT_FILE, TEAM_SYNC_FILE } from './config'
import { safeReadJson } from './utils'
import { denialSignature } from './share-rules'

export interface SentStateV2 {
  version: 2
  hashes: Record<string, string>
  runIds: string[]
}

/**
 * v1 → v2, offline and exact: the v1 value IS `JSON.stringify(session)`, which is precisely the
 * input to v2's digest. Returns null for anything that is neither a v1 map of string→string nor
 * an already-v2 file — a half-converted file would make two code versions re-push forever.
 */
export function convertSentStateV1(raw: unknown): SentStateV2 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.version === 2) {
    const hashes = r.hashes
    if (!hashes || typeof hashes !== 'object') return null
    return {
      version: 2,
      hashes: hashes as Record<string, string>,
      runIds: Array.isArray(r.runIds) ? (r.runIds as string[]) : [],
    }
  }
  if ('version' in r) return null
  const hashes: Record<string, string> = {}
  for (const [id, value] of Object.entries(r)) {
    if (typeof value !== 'string') return null
    hashes[id] = createHash('sha256').update(value).digest('hex')
  }
  return { version: 2, hashes, runIds: [] }
}

const MARKER = join(TEAM_CONN_DIR, '.migrated-v2')
let inflight: Promise<void> | null = null

/** Idempotent, single-flight, marker-guarded. Safe to call from boot and from startUploader. */
export async function migrateTeamStateOnce(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    if (await Bun.file(MARKER).exists()) return
    await mkdir(TEAM_CONN_DIR, { recursive: true })

    // Persisting the migrated config makes the stored id authoritative, so no later read ever
    // re-derives it. writePreferences runs the shape migration on the way in.
    const prefs = await readPreferences()
    await writePreferences({ team: prefs.team })

    const connections = prefs.team?.connections ?? []
    if (connections.length === 1) {
      const id = connections[0]!.id
      const legacySent = await safeReadJson<unknown>(TEAM_SENT_FILE)
      const converted = convertSentStateV1(legacySent)
      if (converted) {
        await writeFile(teamSentFile(id), JSON.stringify(converted, null, 2), 'utf-8')
        try { await rename(TEAM_SENT_FILE, `${TEAM_SENT_FILE}.migrated`) } catch { /* best-effort */ }
      }
      const legacySync = await safeReadJson<{ sig?: string }>(TEAM_SYNC_FILE)
      if (legacySync?.sig) {
        try { await rename(TEAM_SYNC_FILE, teamSyncFile(id)) } catch { /* best-effort */ }
      }
      // Seed the rules file so the first post-upgrade cycle does not read a missing rulesHash as
      // a rules change — that would make the whole fleet run a removal on upgrade day.
      await writeFile(
        teamRulesFile(id),
        JSON.stringify({ rulesHash: denialSignature([]), sharedIds: [], boundary: '', sealed: {}, pending: {} }, null, 2),
        'utf-8',
      )
    }
    await writeFile(MARKER, new Date().toISOString(), 'utf-8')
  })()
  return inflight
}
```

- [ ] **Step 4: Run the tests — PASS.** `bun test packages/server/server/team-migrate.test.ts`

- [ ] **Step 5: Call it**

In `index.ts`, at boot, right after the preferences read guard Plan 1 added:

```ts
await import('./team-migrate').then(m => m.migrateTeamStateOnce()).catch(err =>
  console.warn('[team-migrate] state migration failed (will retry next boot):', err instanceof Error ? err.message : String(err)))
```

And as the first thing inside `startUploader()`'s first cycle, so a machine that never boots the full server still migrates.

- [ ] **Step 6: Verify against a real legacy layout**

```bash
cp ~/.agentistics/team-sent.json /tmp/sent-backup.json
bun run packages/server/bin/cli.ts server &  # or PORT=47391 if 47291 is taken
sleep 8; kill %1
ls ~/.agentistics/connections/
```
Expected: `team-sent-c_*.json`, `team-sync-c_*.json`, `team-rules-c_*.json`, `.migrated-v2`. Confirm the converted file has the same key set as the backup and 64-hex values.

- [ ] **Step 7: Commit** — `feat(team): migrate the single-connection state files to the per-connection layout`

---

### Task 2: Per-connection push

**Files:**
- Modify: `packages/server/server/team-uploader.ts`
- Modify: `packages/server/server/team-uploader.test.ts`

**Interfaces:**
- Produces: `startUploader()`, `notifyDataChanged()`, `pushNow(connId?)`, `getUploaderStatus(): Record<string, UploaderStatus>`, `pushOnceDetailed(conn, ctx)`.

**Every singleton becomes a Map keyed by `connId`:** `_netErrStreak`, `_lastSuccessAt`, `_pushErrKind`, `_authErrStreak`, `_centralIntervalSec`, `running`, plus the sent-state and sync-signature file paths.

**The hard requirement from Plan 1's follow-up #1 — read it before writing code.** `buildSplitStatsCache` asserts that the cache it splits was supplemented from the very array handed to it. `supplementStatsCache` builds the cache from `buildApiResponse`'s **live** session array; `loadConsolidated()` is an asynchronously written subset. Measured on a real machine, one day disagreed by 5 stored sessions against 12. So `PushCycleContext` must carry **both** from a single `buildApiResponse()` call:

```ts
interface PushCycleContext {
  /** The supplemented cache — and the array it was supplemented from. They must be the pair. */
  realStatsCache: StatsCache | null
  liveSessions: SessionMeta[]      // <- feeds the split's arithmetic (Plan 3)
  /** The consolidate store — what is actually PUSHED as session documents. A different set. */
  storedSessions: SessionMeta[]
  projects: ServerProject[]
  workflows: WorkflowRun[]
  builtAt: number
}
```
Plan 3 wires the split; this plan only has to build the context correctly and not conflate the two arrays. Name them `liveSessions` and `storedSessions` — never a bare `sessions` — so the conflation is not expressible by accident.

**Ordering inside the context is load-bearing:** `buildApiResponse()` runs FIRST, before `loadConsolidated()`. `buildApiResponse` is what *writes* the store; loading the store first makes the boot cycle read a cold or half-written one.

**`getPushContext()`** returns a cached value younger than `min(intervals)/2`, with concurrent callers awaiting one in-flight promise. Without it, `buildApiResponse` plus a full store scan run once **per central per cycle**.

- [ ] **Step 1: Write the failing tests** (append to `team-uploader.test.ts`)

```ts
import { selectDeltas, sessionHash } from './team-uploader'

test('sent-state is per connection — one central advancing never marks another as sent', () => {
  const s = (id: string) => ({ session_id: id }) as unknown as SessionMeta
  const sessions = [s('a'), s('b')]
  const a = selectDeltas(sessions, {})
  expect(a.toSend).toHaveLength(2)
  // A second connection starts from ITS OWN empty state, not from the first one's result.
  const b = selectDeltas(sessions, {})
  expect(b.toSend).toHaveLength(2)
  // And a connection that already has one of them sends only the other.
  const c = selectDeltas(sessions, { a: sessionHash(s('a')) })
  expect(c.toSend.map(x => x.session_id)).toEqual(['b'])
})
```

Plus, in a new `team-uploader.test.ts` block, a pure test for the per-connection status shape:

```ts
import { emptyStatusFor } from './team-uploader'

test('a fresh connection reports no success and no error', () => {
  const st = emptyStatusFor('c_0123456789ab')
  expect(st.lastSuccessAt).toBeNull()
  expect(st.errKind).toBeNull()
})
```

- [ ] **Step 2: Confirm they fail** — `emptyStatusFor` does not exist.

- [ ] **Step 3: Implement the Map-per-connection rewrite**

Replace every module-level mutable with a Map and a small accessor, e.g.:

```ts
const _lastSuccessAt = new Map<string, number>()
const _pushErrKind = new Map<string, 'auth' | 'net'>()
const _authErrStreak = new Map<string, number>()
const _netErrStreak = new Map<string, number>()
const _centralIntervalSec = new Map<string, number>()
const _running = new Set<string>()
const _pendingTrigger = new Set<string>()

export interface UploaderStatus { lastSuccessAt: number | null; errKind: 'auth' | 'net' | null }
export function emptyStatusFor(_connId: string): UploaderStatus {
  return { lastSuccessAt: null, errKind: null }
}
export function getUploaderStatus(): Record<string, UploaderStatus> {
  const out: Record<string, UploaderStatus> = {}
  for (const id of new Set([..._lastSuccessAt.keys(), ..._pushErrKind.keys()])) {
    out[id] = { lastSuccessAt: _lastSuccessAt.get(id) ?? null, errKind: _pushErrKind.get(id) ?? null }
  }
  return out
}
```

Every notification gains `meta: { connectionId, central }`, where `central = conn.label ?? hostOf(conn.endpoint)` — **the host, never the token**. `web/src/lib/notifications.ts`'s dedupe key must include `meta.connectionId`, or "central A unreachable" and "central B unreachable" collapse into one toast and A's recovery clears B's badge.

**`autoResetOnRevoke` becomes `removeConnection(connId, reason)`** — read-modify-write on `connections`, splice that entry only, `normalizeTeamConfig` derives `mode`, GC that connection's four state files inside the same serialized write, clear its Map entries, stop its timer, close its socket. Today it writes `{ ...DEFAULT_TEAM }`, which with N connections disconnects every central because one revoked a token.

**`pendingTrigger`:** today `notifyDataChanged` nulls the debounce timer *before* calling `triggerPush`, and `triggerPush` is `if (running) return` — so a change arriving mid-cycle is **dropped**, not deferred. Per connection: if a trigger arrives while that connection is running, set its pending flag and re-arm on unlock.

**A supervisor tick (~5s)** diffs `prefs.team.connections` against the live timer map: start a chain for a new id, clear and delete the chain for a removed one. That is what makes "Add central" in the browser take effect without a restart. It does **not** GC state files — that happens only inside the serialized preferences write that mutated `connections[]` (Plan 1's rule), because a timer GC races the add route.

**Per-connection pushes run sequentially with a concurrency cap of 2** — never `Promise.all` over N. A hung central must not exhaust sockets or starve the others.

- [ ] **Step 4: Tests pass; full suite green.**

- [ ] **Step 5: Verify with two centrals**

Bring up a second central (or point a second connection at the same one with a second minted token — note the uniqueness rule in Task 4 forbids the same token twice, so mint two). Then:
```bash
agentop member status
```
Expected: two blocks, independent `lastSync`. Kill one central: the other's pill stays green, its cadence is unaffected, and the notification names the dead one.

- [ ] **Step 6: Commit** — `feat(team): per-connection push state, timers and status`

---

### Task 3: One socket per connection

**Files:** `packages/server/server/team-agent-client.ts` (rewrite), `packages/server/server/team-agent-client.test.ts` (create, for the pure URL and backoff helpers)

**Confirm the live-reporting work is committed before starting** (see "Before you start").

`activeWs` and `backoffIdx` become `Map<connId, …>`. `reconcileConnection()` fans out: open a socket for each connection lacking one, close and delete every socket whose id is gone from `connections[]` or whose credentials changed. The single poll interval stays; the work inside it fans out, so one hanging endpoint cannot stall the others.

**Leaving these as singletons is a hard failure, not a delay:** presence is WS-authoritative, so whichever connection reconciles first owns the socket and the member reads as **permanently offline on every other central**.

`scheduleReconnect(connId)` must re-read *that* connection **by id** from preferences on each attempt: a reconnect must not resurrect a socket for a connection the user just removed, and must pick up a rotated token.

Inbound `renamed` / `reassigned` frames carry `meta.connectionId` / `meta.central` — with N centrals an unattributed "you were renamed" is unactionable — and a rename updates that connection's `user` in preferences.

**Both the uploader and the WS client gate on a non-empty `user` today. That gate moves to `token || open-central endpoint`,** and any cycle where `conn.user === ''` re-runs whoami and updates that connection in place. Otherwise a connection added while its central was briefly down never resolves a name and pushes nothing, forever, with no retry.

- [ ] **Steps:** extract `agentWsUrl(endpoint)` and `backoffDelay(idx)` as pure functions with tests (the URL builder must trim a trailing slash — `http://host/` yields `ws://host//api/team/agent`, whose double slash misses the server's exact-match upgrade route and the WS never connects); rewrite the client; run the suite; verify two connections show online simultaneously on two centrals; commit — `feat(team): one reverse-channel socket per connection`.

---

### Task 4: Connection routes

**Files:** `packages/server/server/team-connections.ts` (create) + its test, `packages/server/server/index.ts` (wiring)

| Route | Body | Behaviour |
|---|---|---|
| `POST /api/team/connections` | `{ endpoint, token, org?, label? }` | whoami-verify; **a known normalized endpoint updates in place** (token/org/user refreshed, `id`/`label` preserved); a token already belonging to another connection is refused; else mint an id and append (read-modify-write). Starts timer + socket. |
| `PATCH /api/team/connections/:id` | `{ label? }` | read-modify-write that entry only. |
| `DELETE /api/team/connections/:id` | — | whoami → `POST <endpoint>/api/team/leave` → remove the entry and its state files. |
| `POST /api/team/connections/:id/probe` | — | server-side identity/latency probe using the **stored** token. |
| `POST /api/team/push-now` | `{ connectionId? }` | one connection or all; `{ ok, results: [{connectionId, count, error?}], count }` (`count` = sum, for older clients). |
| `GET /api/team/status` | — | the per-connection shape in spec §9.5, minus the `deniedCount`/`boundary` fields (Plan 3). **Never returns a token.** |
| `POST /api/team/test-connection` | `{ endpoint, token }` | **unchanged** — stateless, used pre-connection. |
| `POST /api/team/leave-central` | `{ endpoint, token, … }` | **kept** for an old cached SPA; maps `{endpoint, token}` → `connId`, resets only that connection's files and removes the entry. Today it ends in a global `resetSyncState()`, which with N connections gives an unrelated central a spurious full re-push. |

**Why endpoint-uniqueness and token-uniqueness are both enforced:** token rotation is a documented admin action and is exactly when the user re-runs connect. Appending a second connection there would double-count the machine on the central under two `memberId`s (a different token means a different `sha256`). And two connections sharing one token collapse onto one `memberId`: they would alternately `replaceOne` the same `memberStats` document, flipping the machine's reported totals on every push.

**`GET /api/team/status` moves its latency probe into the uploader cycle** (which already fetches `/api/team/policy`) and returns cached values — the current handler does a blocking 4s probe per request, polled every 5s, which with two offline centrals exceeds its own poll interval.

**The sensitive-route CORS and the redaction Plan 1 added already cover `/api/team/connections*`** — `isSensitiveRoute` matches the prefix. Do not add a wildcard back.

- [ ] **Steps:** pure body-validation and uniqueness tests first; implement; wire; verify add/remove/rotate from the browser with the server running; commit — `feat(team): connection routes`.

---

### Task 5: Cross-process preferences lock

**Files:** `packages/server/server/preferences.ts`, its test

Plan 1 serialized writes **within** one process. Bun serves requests concurrently while `cli-member.ts` writes the same file from a **separate process**. Add an `O_EXCL` lock file in `~/.agentistics` with a stale-lock timeout around the write chain; the CLI prefers the local server's routes and takes the lock only when no server is running.

- [ ] **Steps:** test that two processes cannot interleave (spawn a second `bun -e` writer); implement; commit — `fix(preferences): a cross-process write lock`.

---

### Task 6: The CLI

**Files:** `cli-member.ts`, `cli-status.ts`, `cli-start.ts`, `cli-setup.ts`, `bin/cli.ts`, `cli-i18n.ts`

Command surface, per spec §8 (repo rules are web-only — no `--deny-repo` anywhere):

```
agentop member connect --endpoint <url> --token <tok> [--org <org>] [--label <name>]
agentop member list                       (new; `status` remains an alias)
agentop member status [--endpoint <url>]
agentop member leave [--endpoint <url>] [--all]
    0 connections   → "not connected to a central — nothing to leave." exit 0
    1 connection    → leaves it, no prompt (today's behaviour)
    N, no flag, TTY → arrow-key select over the endpoints + "Leave all" + Cancel
    N, no flag, non-TTY → exit 1: "connected to N centrals — pass --endpoint <url> or --all."
```

**Never guess in the non-TTY N-connection case** — a silent `connections[0]` is data loss.

**Every CLI mutation goes through the local server's routes.** `cli-member.ts` today PUTs the whole `team` block to `/api/preferences`; with `connections[]` that is a whole-array write from a process holding a snapshot read seconds earlier, so a browser-added central vanishes the next time the user runs `member connect` in a terminal. When no server is running, the CLI performs the sequence itself under the Task 5 lock.

**`bin/cli.ts`:** `readFlag` returns the *next* argv token, so `--all` must be parsed as a boolean (`rest.includes('--all')`) or `member leave --all` swallows whatever follows.

**`agentop member status` is fixed while we are here** — it calls `getUploaderStatus()` in the CLI process, which never ran `startUploader()`, so it always prints "last sync: never". It must query `http://localhost:${PORT}/api/team/status`. With N connections the existing bug becomes N wrong lines.

**`cli-start.ts`'s menu branch is the single highest-risk line:** `if (mode === 'member') show Disconnect else show Connect` must become **additive** — always show Connect (relabelled "add another central" when N ≥ 1), and show Disconnect whenever N ≥ 1. Leaving the `else` makes a second central unreachable from the launcher.

**`cli-setup.ts`'s solo branch** does `writePreferences({ team: { ...DEFAULT_TEAM } })`, which now wipes an existing array; `agentop setup` is reachable on a configured machine, so it must confirm before discarding N connections.

- [ ] **Steps:** the EN/PT strings from spec §8.2 first, then each command with its test where the logic is pure (the leave-selection decision is); manual verification of the four `member leave` cases; commit — `feat(cli): multi-central member commands`.

---

## Done when

- Two centrals receive this machine's metrics independently, each at its own cadence, and both show it online at once.
- Killing one central leaves the other's pill green and its cadence unchanged; the notification names the dead one.
- Revoking one token removes only that connection; the other keeps working and its config survives.
- `agentop member status` prints one accurate block per connection, with a real last-sync time.
- An upgrading single-central member migrates its state files, re-pushes **nothing** from the hash change, and exactly once from the sync-signature change.
- `bun run stub && bun tsc --noEmit && bun test` green, with no `--no-verify` anywhere.

## Out of scope

Repository filtering, `POST /api/team/forget`, the `capabilities` probe, the removal journal and the Settings UI — all Plan 3.
