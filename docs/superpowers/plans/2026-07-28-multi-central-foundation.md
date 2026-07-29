# Multi-central foundation — types, config and the pure sharing rules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every pure, testable foundation the multi-central + per-connection repo-sharing feature stands on — the `connections[]` config shape and its migration, a preferences layer that cannot lose that config, per-connection file paths, and the `share-rules.ts` module that decides what a connection may receive.

**Architecture:** Nothing in this plan changes runtime behaviour. `migrateTeamConfig` is shape-only and keeps writing the legacy flat mirror, so the existing single-connection uploader keeps reading exactly what it reads today. `share-rules.ts` is pure (no I/O, no Mongo, no `preferences`, no `config`) and is not yet called from the push path — Plan 2 wires it in. That ordering is deliberate: every privacy-critical decision gets unit-tested against fixtures before any code can push with it.

**Tech Stack:** TypeScript, Bun (runtime + `bun:test`), the existing `@agentistics/core` shared package. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-28-multi-central-and-repo-sharing-design.md` — §3 (data model), §4 (share-rules), §5.8 (preferences hardening), §12 (tests).

## Global Constraints

- **Everything in English** — code, comments, commit messages. Project rule, `CLAUDE.md`.
- **Conventional Commits** — commitlint runs on `commit-msg`. `feat:`, `fix:`, `refactor:`, `test:`, `chore:`.
- **`bun tsc --noEmit` and `bun test` run on `pre-commit`.** Two web tests (`StatCard.test.ts`, `splitInlinedHistory.test.ts`) fail in the full suite on `dev` **before this plan starts** — a `lucide-react`/`react.createContext` interop problem, unrelated to this work. Verify with `git stash -u && bun test` if in doubt. Commit with `--no-verify` **only** when that is the sole failure, and never to bypass a failure in a file this plan touches.
- **`share-rules.ts` is pure.** It may import only from `@agentistics/core`. Importing `./config`, `./preferences`, `./mongo`, `node:fs` or `bun:sqlite` from it is a review rejection.
- **`stats-cache.json` is Claude-only.** Any accumulation over sessions must gate on `(s.harness ?? 'claude') === 'claude'` where the spec says so. Getting this wrong double-counts every non-Claude session on a central.
- **No filesystem mocks in tests.** Pure functions only, per `CLAUDE.md`. Where a test needs paths, use `tmpdir()` with real files.
- **`NO_REPO_KEY = '__no_repo__'`** — exact string, defined once in `packages/core/src/team.ts`, imported everywhere. Never `''`.
- **Connection id format:** `/^c_[a-f0-9]{12}$/` — exact.
- **Tokens are never logged.** No `console.log` of a `TeamConnection` object anywhere.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/team.ts` (modify) | `TeamConnection` / `TeamConfig` types, `NO_REPO_KEY`, `connectionId`, `legacyConnectionId`, `migrateTeamConfig`, `normalizeTeamConfig`, `readTeamConnections`. Shared by server **and** web. |
| `packages/core/src/team.test.ts` (modify) | Tests for the above. Already exists with a `session()` fixture helper to reuse. |
| `packages/server/server/preferences.ts` (modify) | Serialized + atomic writes, corrupt-file refusal, and the single choke point where `migrateTeamConfig` runs. |
| `packages/server/server/preferences.test.ts` (modify) | Tests for serialization, atomicity and refusal, using real tmp files. |
| `packages/server/server/config.ts` (modify) | `TEAM_CONN_DIR` + `teamSentFile` / `teamSyncFile` / `teamRulesFile` / `teamForgetFile` and the connection-id sanitizer. |
| `packages/server/server/config.test.ts` (create) | Path-building and sanitizer tests. |
| `packages/server/server/share-rules.ts` (create) | **Pure.** Repo keys, the path→repo index, session/workflow filtering, denial signature, the Claude accumulator, `buildSharedStatsCache`, `attributionBoundary`, `buildSplitStatsCache`, and the local-only disclosure helpers. |
| `packages/server/server/share-rules.test.ts` (create) | All of §12's `share-rules` tests. |
| `packages/server/server/data.ts` (modify) | `supplementStatsCache` loses its inlined accumulation loop and consumes the extracted `accumulateClaudeSessions`. Behaviour-identical. |

Six tasks. Tasks 1–3 are the config spine; 4–6 build `share-rules.ts` in three self-contained layers, each with its own test cycle.

---

### Task 1: The `connections[]` config shape and its migration

**Files:**
- Modify: `packages/core/src/team.ts` (the `TeamConfig` block at lines 8–33)
- Test: `packages/core/src/team.test.ts` (append; reuse the existing `session()` helper)

**Interfaces:**
- Consumes: nothing — this is the root of the dependency chain.
- Produces:
  - `interface TeamConnection { id: string; endpoint: string; org: string; user: string; token: string; deniedRepos: string[]; pushIntervalSec?: number; label?: string; addedAt?: string }`
  - `interface TeamConfig { schema?: 2; mode: 'solo' | 'member'; connections: TeamConnection[]; endpoint?: string; org?: string; user?: string; token?: string; pushIntervalSec?: number }`
  - `const NO_REPO_KEY = '__no_repo__'`
  - `function connectionId(): string`
  - `function legacyConnectionId(endpoint: string, token: string): string`
  - `function migrateTeamConfig(raw: unknown): TeamConfig`
  - `function normalizeTeamConfig(cfg: TeamConfig): TeamConfig`
  - `function readTeamConnections(prefs: { team?: TeamConfig } | null | undefined): TeamConnection[]`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/team.test.ts`:

```ts
import {
  migrateTeamConfig, normalizeTeamConfig, connectionId, legacyConnectionId,
  readTeamConnections, NO_REPO_KEY, DEFAULT_TEAM,
} from './team'

test('migrateTeamConfig: a legacy flat member config becomes one connection', () => {
  const out = migrateTeamConfig({
    mode: 'member', endpoint: 'https://central.example:48080/', org: 'acme',
    user: 'lucas', token: 'abc123', pushIntervalSec: 45,
  })
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.endpoint).toBe('https://central.example:48080')
  expect(out.connections[0]!.org).toBe('acme')
  expect(out.connections[0]!.user).toBe('lucas')
  expect(out.connections[0]!.token).toBe('abc123')
  expect(out.connections[0]!.pushIntervalSec).toBe(45)
  expect(out.connections[0]!.deniedRepos).toEqual([])
  expect(out.mode).toBe('member')
  expect(out.schema).toBe(2)
})

test('migrateTeamConfig: a solo config with empty strings fabricates NO connection', () => {
  const out = migrateTeamConfig({ mode: 'solo', endpoint: '', org: 'default', user: '', token: '' })
  expect(out.connections).toEqual([])
  expect(out.mode).toBe('solo')
})

test('migrateTeamConfig: an endpoint with no token still migrates (open/legacy central)', () => {
  const out = migrateTeamConfig({ mode: 'member', endpoint: 'http://c:48080', org: 'default', user: 'lucas' })
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.token).toBe('')
  expect(out.mode).toBe('member')
})

test('migrateTeamConfig: an already-migrated config is preserved, ids intact', () => {
  const first = migrateTeamConfig({ mode: 'member', endpoint: 'http://c:48080', token: 't' })
  const again = migrateTeamConfig(first)
  expect(again.connections[0]!.id).toBe(first.connections[0]!.id)
  expect(again.connections).toHaveLength(1)
})

test('migrateTeamConfig: junk input yields the default solo config', () => {
  for (const raw of [undefined, null, 'nope', 42, []]) {
    expect(migrateTeamConfig(raw).connections).toEqual([])
    expect(migrateTeamConfig(raw).mode).toBe('solo')
  }
})

test('migrateTeamConfig: two calls return distinct array instances (no shared aliasing)', () => {
  const raw = { mode: 'member', endpoint: 'http://c:48080', token: 't' }
  const a = migrateTeamConfig(raw)
  const b = migrateTeamConfig(raw)
  expect(a.connections).not.toBe(b.connections)
  a.connections[0]!.deniedRepos.push('github.com/o/r')
  expect(b.connections[0]!.deniedRepos).toEqual([])
})

test('migrateTeamConfig: the legacy id is deterministic across 100 calls', () => {
  const raw = { mode: 'member', endpoint: 'http://c:48080', token: 't' }
  const ids = new Set(Array.from({ length: 100 }, () => migrateTeamConfig(raw).connections[0]!.id))
  expect(ids.size).toBe(1)
  expect([...ids][0]).toMatch(/^c_[a-f0-9]{12}$/)
})

test('migrateTeamConfig: duplicate normalized endpoints collapse, first wins', () => {
  const out = migrateTeamConfig({
    mode: 'member',
    connections: [
      { id: 'c_aaaaaaaaaaaa', endpoint: 'http://c:48080', org: 'default', user: 'a', token: 't1', deniedRepos: [] },
      { id: 'c_bbbbbbbbbbbb', endpoint: 'http://c:48080/', org: 'default', user: 'b', token: 't2', deniedRepos: [] },
    ],
  })
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.id).toBe('c_aaaaaaaaaaaa')
})

test('migrateTeamConfig: an entry with no endpoint is dropped and deniedRepos defaults', () => {
  const out = migrateTeamConfig({
    mode: 'member',
    connections: [
      { id: 'c_aaaaaaaaaaaa', endpoint: '', org: 'default', user: 'a', token: 't' },
      { endpoint: 'http://c:48080', org: 'default', user: 'b', token: 't2' },
    ],
  })
  expect(out.connections).toHaveLength(1)
  expect(out.connections[0]!.deniedRepos).toEqual([])
  expect(out.connections[0]!.id).toMatch(/^c_[a-f0-9]{12}$/)
})

test('normalizeTeamConfig: mode follows connections.length in both directions', () => {
  const withOne = normalizeTeamConfig({
    mode: 'solo', connections: [{ id: 'c_aaaaaaaaaaaa', endpoint: 'http://c:48080', org: 'o', user: 'u', token: 't', deniedRepos: [] }],
  })
  expect(withOne.mode).toBe('member')
  expect(normalizeTeamConfig({ mode: 'member', connections: [] }).mode).toBe('solo')
})

test('normalizeTeamConfig: the legacy mirror tracks connections[0] and clears when empty', () => {
  const withOne = normalizeTeamConfig({
    mode: 'solo',
    connections: [{ id: 'c_aaaaaaaaaaaa', endpoint: 'http://c:48080', org: 'acme', user: 'lucas', token: 'tok', deniedRepos: [] }],
  })
  expect(withOne.endpoint).toBe('http://c:48080')
  expect(withOne.org).toBe('acme')
  expect(withOne.user).toBe('lucas')
  expect(withOne.token).toBe('tok')
  expect(withOne.schema).toBe(2)

  const emptied = normalizeTeamConfig({ mode: 'member', connections: [] })
  expect(emptied.endpoint).toBe('')
  expect(emptied.token).toBe('')
  expect(emptied.user).toBe('')
})

test('connectionId: format holds and 10000 calls collide zero times', () => {
  const ids = new Set(Array.from({ length: 10_000 }, () => connectionId()))
  expect(ids.size).toBe(10_000)
  for (const id of [...ids].slice(0, 50)) expect(id).toMatch(/^c_[a-f0-9]{12}$/)
})

test('legacyConnectionId: same inputs same id, different token different id', () => {
  expect(legacyConnectionId('http://c:48080', 't')).toBe(legacyConnectionId('http://c:48080', 't'))
  expect(legacyConnectionId('http://c:48080', 't')).not.toBe(legacyConnectionId('http://c:48080', 'u'))
  expect(legacyConnectionId('http://c:48080', '')).toMatch(/^c_[a-f0-9]{12}$/)
})

test('readTeamConnections: never throws on a prefs object missing the array', () => {
  expect(readTeamConnections(undefined)).toEqual([])
  expect(readTeamConnections(null)).toEqual([])
  expect(readTeamConnections({})).toEqual([])
  expect(readTeamConnections({ team: { mode: 'solo' } as never })).toEqual([])
})

test('NO_REPO_KEY is the exact sentinel and contains no slash', () => {
  expect(NO_REPO_KEY).toBe('__no_repo__')
  expect(NO_REPO_KEY.includes('/')).toBe(false)
})

test('DEFAULT_TEAM is solo with an empty connections array', () => {
  expect(DEFAULT_TEAM.mode).toBe('solo')
  expect(DEFAULT_TEAM.connections).toEqual([])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/core/src/team.test.ts`
Expected: FAIL — `migrateTeamConfig is not a function` (and the other new exports undefined).

- [ ] **Step 3: Implement the types and functions**

In `packages/core/src/team.ts`, replace the existing `TeamConfig` interface and `DEFAULT_TEAM` const (lines 8–33) with:

```ts
import { createHash, randomUUID } from 'node:crypto'

/** The sentinel repo key for sessions with no resolvable git remote. NEVER '' — an empty
 *  string is eaten by any `.filter(Boolean)` in the UI or CLI path, which would turn
 *  "block unattributed work" into "block nothing": a fail-open privacy bug. */
export const NO_REPO_KEY = '__no_repo__'

export interface TeamConnection {
  /** Local, opaque, filesystem-safe handle. NEVER sent to a central. */
  id: string
  /** Central base URL, no trailing slash. The uniqueness key across connections[]. */
  endpoint: string
  /** Org namespace used on the central. */
  org: string
  /** Display name resolved from GET /api/team/whoami — never user-typed. Per connection,
   *  because each central mints its own token and resolves its own name. */
  user: string
  /** Bearer secret (never logged). May be '' against an open/legacy central. */
  token: string
  /** DENYLIST of canonical repo keys, plus NO_REPO_KEY. [] = share everything. */
  deniedRepos: string[]
  /** Member-side mirror of the central's cadence; the central still owns the floor. */
  pushIntervalSec?: number
  /** Optional nickname for the card; falls back to the endpoint host. */
  label?: string
  /** ISO — deterministic card ordering. */
  addedAt?: string
}

export interface TeamConfig {
  /** Written by this version and above. Absent means an older client wrote it. */
  schema?: 2
  mode: 'solo' | 'member'
  connections: TeamConnection[]
  /** Legacy MIRROR of connections[0]. Still written for one release so an older binary or
   *  a container sharing ~/.agentistics keeps working. Read by migrateTeamConfig. */
  endpoint?: string
  org?: string
  user?: string
  token?: string
  pushIntervalSec?: number
}

export const DEFAULT_TEAM: TeamConfig = { schema: 2, mode: 'solo', connections: [] }

const ID_RE = /^c_[a-f0-9]{12}$/

/** A fresh random handle, minted once when a connection is added. */
export function connectionId(): string {
  return 'c_' + randomUUID().replace(/-/g, '').slice(0, 12)
}

/**
 * The handle used ONLY by the legacy migration. It must be deterministic: migrateTeamConfig
 * runs in a read path, and a random id there would mint a different handle on every read
 * until something persisted it — a new sent-state file, a full re-push and a new WebSocket
 * every cycle, forever.
 */
export function legacyConnectionId(endpoint: string, token: string): string {
  return 'c_' + createHash('sha256').update(`${endpoint}\0${token}`).digest('hex').slice(0, 12)
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Force `mode` from connections.length, stamp the schema, and rebuild the legacy mirror.
 *  Pure — returns a new object with a new array. */
export function normalizeTeamConfig(cfg: TeamConfig): TeamConfig {
  const connections = cfg.connections.map(c => ({ ...c, deniedRepos: [...c.deniedRepos] }))
  const first = connections[0]
  return {
    schema: 2,
    mode: connections.length > 0 ? 'member' : 'solo',
    connections,
    endpoint: first?.endpoint ?? '',
    org: first?.org ?? 'default',
    user: first?.user ?? '',
    token: first?.token ?? '',
    ...(first?.pushIntervalSec !== undefined ? { pushIntervalSec: first.pushIntervalSec } : {}),
  }
}

/**
 * Shape migration — pure, deterministic, idempotent, safe in a read path.
 * MUST return a fresh object with a fresh array on every call: DEFAULT_PREFS.team is spread
 * into every preferences read, and an aliased array becomes a live cross-caller bug.
 */
export function migrateTeamConfig(raw: unknown): TeamConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalizeTeamConfig({ mode: 'solo', connections: [] })
  const r = raw as Partial<TeamConfig> & Record<string, unknown>

  // Already migrated → sanitize in place.
  if (Array.isArray(r.connections)) {
    const seenId = new Set<string>()
    const seenEndpoint = new Set<string>()
    const connections: TeamConnection[] = []
    for (const entry of r.connections as Partial<TeamConnection>[]) {
      if (!entry || typeof entry !== 'object') continue
      const endpoint = trimSlashes(typeof entry.endpoint === 'string' ? entry.endpoint : '')
      if (!endpoint) continue
      if (seenEndpoint.has(endpoint)) continue
      let id = typeof entry.id === 'string' && ID_RE.test(entry.id) ? entry.id : connectionId()
      while (seenId.has(id)) id = connectionId()
      seenId.add(id)
      seenEndpoint.add(endpoint)
      connections.push({
        id,
        endpoint,
        org: typeof entry.org === 'string' && entry.org ? entry.org : 'default',
        user: typeof entry.user === 'string' ? entry.user : '',
        token: typeof entry.token === 'string' ? entry.token : '',
        deniedRepos: Array.isArray(entry.deniedRepos) ? entry.deniedRepos.filter(x => typeof x === 'string') : [],
        ...(typeof entry.pushIntervalSec === 'number' ? { pushIntervalSec: entry.pushIntervalSec } : {}),
        ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
        ...(typeof entry.addedAt === 'string' ? { addedAt: entry.addedAt } : {}),
      })
    }
    return normalizeTeamConfig({ mode: 'solo', connections })
  }

  // Legacy flat config. Guard on `endpoint` ALONE — not on mode (cli-setup and the web solo
  // path write a solo object that still carries empty-string endpoint/token, and fabricating
  // a connection from those would start an uploader on a solo machine), and not on token
  // (a token-less member against an open/legacy central is a live shape; requiring one would
  // silently drop those members to solo and stop their pushes).
  const endpoint = trimSlashes(typeof r.endpoint === 'string' ? r.endpoint : '')
  if (endpoint) {
    const token = typeof r.token === 'string' ? r.token : ''
    return normalizeTeamConfig({
      mode: 'member',
      connections: [{
        id: legacyConnectionId(endpoint, token),
        endpoint,
        org: typeof r.org === 'string' && r.org ? r.org : 'default',
        user: typeof r.user === 'string' ? r.user : '',
        token,
        deniedRepos: [],
        ...(typeof r.pushIntervalSec === 'number' ? { pushIntervalSec: r.pushIntervalSec } : {}),
      }],
    })
  }

  return normalizeTeamConfig({ mode: 'solo', connections: [] })
}

/** Read connections off a preferences object without ever throwing. Exists so the three
 *  web-local DEFAULT_TEAM_CONFIG duplicates can be deleted — leaving them would spread
 *  `connections: undefined` over a loaded prefs object and `.map` would throw. */
export function readTeamConnections(prefs: { team?: TeamConfig } | null | undefined): TeamConnection[] {
  const list = prefs?.team?.connections
  return Array.isArray(list) ? list : []
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/core/src/team.test.ts`
Expected: PASS, including the pre-existing tests in that file (`tagUser`, `distinctUsers`, `clampPushInterval`, …).

- [ ] **Step 5: Verify nothing else broke on the type level**

Run: `bun tsc --noEmit`
Expected: errors ONLY where an existing consumer builds a `TeamConfig` literal without `connections` — `packages/web/src/pages/settings/ConnectionSettings.tsx`, `packages/web/src/components/TeamSettings.tsx`, `packages/web/src/pages/settings/MachinesSettings.tsx`, `packages/server/server/cli-member.ts`, `packages/server/server/team-uploader.ts`. **Do not fix them by adding `connections: []` everywhere** — those are Plan 2/3 tasks. To keep the tree compiling until then, make `connections` required in the type but have every one of those five sites get it from `DEFAULT_TEAM`:

```ts
// each of the five sites, minimal edit only
const DEFAULT_TEAM_CONFIG: TeamConfig = { ...DEFAULT_TEAM }
```

Re-run `bun tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/team.ts packages/core/src/team.test.ts \
  packages/web/src/pages/settings/ConnectionSettings.tsx \
  packages/web/src/components/TeamSettings.tsx \
  packages/web/src/pages/settings/MachinesSettings.tsx \
  packages/server/server/cli-member.ts packages/server/server/team-uploader.ts
git commit -m "feat(team): a connections array on TeamConfig, with a deterministic migration"
```

---

### Task 2: A preferences layer that cannot lose the connections array

**Files:**
- Modify: `packages/server/server/preferences.ts`
- Test: `packages/server/server/preferences.test.ts` (append)

**Interfaces:**
- Consumes: `migrateTeamConfig` from Task 1.
- Produces:
  - `readPreferencesFrom(primary, legacy)` — unchanged signature, now applies `migrateTeamConfig` to `team` and **throws** on a corrupt non-empty primary file.
  - `writePreferencesTo(primary, legacy, prefs)` — unchanged signature, now serialized and atomic.

**Why this is in the foundation and not a "nice to have":** `writePreferencesTo` is a read-merge-`Bun.write` with no lock, and Bun serves requests concurrently while `cli-member.ts` writes the same file from another process. With one flat team block a lost update cost one field. With `connections[]` it costs the privacy rules — and a torn read makes `readJsonPrefs` return `null`, fall through to `DEFAULT_PREFS`, and present the machine as **solo**: every connection, `archiveMode`, layout and theme gone, and the archive-consent gate re-fired.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/server/preferences.test.ts`:

```ts
import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPreferencesFrom, writePreferencesTo } from './preferences'

async function tmpPaths() {
  const dir = await mkdtemp(join(tmpdir(), 'agentistics-prefs-'))
  return { primary: join(dir, 'preferences.json'), legacy: join(dir, 'legacy.json') }
}

test('readPreferencesFrom migrates a legacy flat team block into connections[]', async () => {
  const { primary, legacy } = await tmpPaths()
  await writeFile(primary, JSON.stringify({
    team: { mode: 'member', endpoint: 'http://c:48080', org: 'acme', user: 'lucas', token: 'tok' },
  }))
  const prefs = await readPreferencesFrom(primary, legacy)
  expect(prefs.team?.connections).toHaveLength(1)
  expect(prefs.team?.connections[0]!.endpoint).toBe('http://c:48080')
  expect(prefs.team?.mode).toBe('member')
})

test('readPreferencesFrom returns defaults for an absent or empty file', async () => {
  const { primary, legacy } = await tmpPaths()
  expect((await readPreferencesFrom(primary, legacy)).team?.connections).toEqual([])
  await writeFile(primary, '   ')
  expect((await readPreferencesFrom(primary, legacy)).team?.connections).toEqual([])
})

test('readPreferencesFrom THROWS on a corrupt non-empty file instead of silently defaulting', async () => {
  const { primary, legacy } = await tmpPaths()
  await writeFile(primary, '{"team": {"connections": [')
  await expect(readPreferencesFrom(primary, legacy)).rejects.toThrow()
})

test('the default team object is never shared between reads', async () => {
  const { primary, legacy } = await tmpPaths()
  const a = await readPreferencesFrom(primary, legacy)
  const b = await readPreferencesFrom(primary, legacy)
  expect(a.team).not.toBe(b.team)
  a.team!.connections.push({ id: 'c_aaaaaaaaaaaa', endpoint: 'x', org: 'o', user: 'u', token: 't', deniedRepos: [] })
  expect(b.team!.connections).toEqual([])
})

test('concurrent writes are serialized — no lost update', async () => {
  const { primary, legacy } = await tmpPaths()
  await writePreferencesTo(primary, legacy, { theme: 'dark' })
  await Promise.all([
    writePreferencesTo(primary, legacy, { lang: 'pt' }),
    writePreferencesTo(primary, legacy, { currency: 'BRL' }),
    writePreferencesTo(primary, legacy, { monthlyBudgetUSD: 100 }),
  ])
  const prefs = await readPreferencesFrom(primary, legacy)
  expect(prefs.theme).toBe('dark')
  expect(prefs.lang).toBe('pt')
  expect(prefs.currency).toBe('BRL')
  expect(prefs.monthlyBudgetUSD).toBe(100)
})

test('a write leaves no partial file behind — the target is always valid JSON', async () => {
  const { primary, legacy } = await tmpPaths()
  const writes = Array.from({ length: 40 }, (_, i) => writePreferencesTo(primary, legacy, { monthlyBudgetUSD: i }))
  await Promise.all(writes)
  const text = await readFile(primary, 'utf-8')
  expect(() => JSON.parse(text)).not.toThrow()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/server/server/preferences.test.ts`
Expected: FAIL — the migration test finds no `connections`, and the corrupt-file test does not reject (the current `readJsonPrefs` catches and returns `null`).

- [ ] **Step 3: Implement**

In `packages/server/server/preferences.ts`:

```ts
import { rename, writeFile } from 'node:fs/promises'
import { migrateTeamConfig } from '@agentistics/core'
```

Replace `readJsonPrefs`, the `DEFAULT_PREFS` const, `readPreferencesFrom` and `writePreferencesTo` with:

```ts
/** Read + parse a preferences JSON file.
 *  - absent or blank  → null  (a legitimate "nothing here")
 *  - present but corrupt → THROWS. Falling through to defaults here presents the machine as
 *    solo and silently discards every connection, denylist, archiveMode and layout. */
async function readJsonPrefs(path: string): Promise<Preferences | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  const text = await file.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as Preferences
  } catch (err) {
    throw new Error(`preferences file at ${path} is present but unparseable: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** A FRESH defaults object every call — never a shared const. `team` in particular is spread
 *  into every read, and an aliased connections array becomes a live cross-caller bug. */
function defaultPrefs(): Preferences {
  return { customLayout: [], team: migrateTeamConfig(undefined) }
}

export async function readPreferencesFrom(primary: string, legacy: string): Promise<Preferences> {
  const p = await readJsonPrefs(primary)
  if (p) return withMigratedTeam(p)
  let l: Preferences | null = null
  try {
    l = await readJsonPrefs(legacy)
  } catch {
    // A corrupt LEGACY file is not fatal — the primary is authoritative and the legacy
    // location is read-only in Docker. Treat it as absent.
    l = null
  }
  if (l) {
    const merged = withMigratedTeam(l)
    try { await writeFileAtomic(primary, JSON.stringify(merged, null, 2)) } catch { /* read-only legacy dir */ }
    return merged
  }
  return defaultPrefs()
}

/** The ONE choke point where the shape migration runs, so every reader — CLI, uploader, WS
 *  client, GET/PUT /api/preferences — sees connections[]. Migrating only in the uploader
 *  would leave cli-status.ts, cli-start.ts and bin/cli.ts on the un-migrated shape. */
function withMigratedTeam(p: Preferences): Preferences {
  return { ...defaultPrefs(), ...p, team: migrateTeamConfig(p.team) }
}

/** tmp + rename. `Bun.write` truncates in place, so a concurrent reader can observe a
 *  half-written file; rename on the same filesystem is atomic. */
async function writeFileAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, text, 'utf-8')
  await rename(tmp, path)
}

/** Single-writer chain: every write awaits the previous one, so a read-merge-write can never
 *  interleave with another and lose the connections array. */
let _writeChain: Promise<unknown> = Promise.resolve()

export async function writePreferencesTo(primary: string, legacy: string, prefs: Preferences): Promise<void> {
  const run = async () => {
    const current = await readPreferencesFrom(primary, legacy)
    const merged = { ...current, ...prefs }
    await writeFileAtomic(primary, JSON.stringify(merged, null, 2))
  }
  const next = _writeChain.then(run, run)
  _writeChain = next.catch(() => {})
  return next
}
```

Delete the now-unused `DEFAULT_PREFS` const.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/server/server/preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify no caller now explodes on the new throw**

Run: `grep -rn "readPreferences()" packages/server/server | head -30`
For each caller, confirm it is inside a `try` or a route handler that already returns 500 on a throw. The one that must be checked by hand is `sse.ts` / `index.ts` boot: a corrupt preferences file should fail loudly at startup, not crash-loop silently. Add to `index.ts`'s boot path, right where preferences are first read:

```ts
try {
  await readPreferences()
} catch (err) {
  console.error('[boot] preferences file is corrupt — refusing to start with default settings.')
  console.error('[boot] fix or move aside ~/.agentistics/preferences.json, then restart.')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
```

- [ ] **Step 6: Run the full suite and commit**

Run: `bun test`
Expected: PASS except the two pre-existing `lucide-react` failures named in Global Constraints.

```bash
git add packages/server/server/preferences.ts packages/server/server/preferences.test.ts packages/server/server/index.ts
git commit -m "fix(preferences): serialize and atomize writes, and refuse to default over a corrupt file"
```

---

### Task 3: Per-connection file paths

**Files:**
- Modify: `packages/server/server/config.ts`
- Test: `packages/server/server/config.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const TEAM_CONN_DIR: string`
  - `function safeConnId(id: string): string` — throws on anything not `/^c_[a-f0-9]{12}$/`
  - `function teamSentFile(connId: string): string`
  - `function teamSyncFile(connId: string): string`
  - `function teamRulesFile(connId: string): string`
  - `function teamForgetFile(connId: string): string`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/server/config.test.ts`:

```ts
import { test, expect } from 'bun:test'
import { TEAM_CONN_DIR, safeConnId, teamSentFile, teamSyncFile, teamRulesFile, teamForgetFile } from './config'

test('safeConnId accepts the exact id format', () => {
  expect(safeConnId('c_0123456789ab')).toBe('c_0123456789ab')
})

test('safeConnId rejects anything that could escape the directory', () => {
  for (const bad of ['../etc/passwd', 'c_../aaaaaaaa', 'c_0123456789AB', 'c_short', '', 'c_0123456789abc', 'nope']) {
    expect(() => safeConnId(bad)).toThrow()
  }
})

test('the four path builders live under TEAM_CONN_DIR and are distinct', () => {
  const id = 'c_0123456789ab'
  const paths = [teamSentFile(id), teamSyncFile(id), teamRulesFile(id), teamForgetFile(id)]
  for (const p of paths) expect(p.startsWith(TEAM_CONN_DIR)).toBe(true)
  expect(new Set(paths).size).toBe(4)
  expect(teamSentFile(id).endsWith('team-sent-c_0123456789ab.json')).toBe(true)
  expect(teamForgetFile(id).endsWith('team-forget-c_0123456789ab.json')).toBe(true)
})

test('the path builders reject a malicious id', () => {
  expect(() => teamSentFile('../../escape')).toThrow()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/server/server/config.test.ts`
Expected: FAIL — `safeConnId is not a function`.

- [ ] **Step 3: Implement**

Append to `packages/server/server/config.ts` (next to the existing `TEAM_SENT_FILE` / `TEAM_SYNC_FILE` constants, which stay for now — Plan 2 retires them):

```ts
/** Per-connection state lives in its own directory so one central's sent-state can never be
 *  handed to another by a positional accident. */
export const TEAM_CONN_DIR = process.env.AGENTISTICS_TEAM_CONN_DIR
  ?? join(AGENTISTICS_DATA_DIR, 'connections')

const CONN_ID_RE = /^c_[a-f0-9]{12}$/

/** Connection ids arrive from HTTP bodies on the connection routes, so they are interpolated
 *  into a path only after this check — `../` would escape ~/.agentistics. */
export function safeConnId(id: string): string {
  if (typeof id !== 'string' || !CONN_ID_RE.test(id)) {
    throw new Error(`invalid connection id: ${JSON.stringify(id)}`)
  }
  return id
}

export function teamSentFile(connId: string): string {
  return join(TEAM_CONN_DIR, `team-sent-${safeConnId(connId)}.json`)
}
/** { sig } — the central-identity fingerprint. */
export function teamSyncFile(connId: string): string {
  return join(TEAM_CONN_DIR, `team-sync-${safeConnId(connId)}.json`)
}
/** { rulesHash, sharedIds[], boundary } — deliberately SEPARATE from the sent-state and the
 *  sync signature: the sig path clears the sent-state on a token rotation, and if the rules
 *  hash lived there a rotation coinciding with a rules change would erase the evidence of the
 *  change and the removal would never run. */
export function teamRulesFile(connId: string): string {
  return join(TEAM_CONN_DIR, `team-rules-${safeConnId(connId)}.json`)
}
/** { state, ids, runIds, rulesHash, startedAt } — the removal journal. */
export function teamForgetFile(connId: string): string {
  return join(TEAM_CONN_DIR, `team-forget-${safeConnId(connId)}.json`)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/server/server/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/config.ts packages/server/server/config.test.ts
git commit -m "feat(config): per-connection state paths with a sanitized connection id"
```

---

### Task 4: `share-rules.ts` — which sessions a connection may receive

**Files:**
- Create: `packages/server/server/share-rules.ts`
- Test: `packages/server/server/share-rules.test.ts` (create)

**Interfaces:**
- Consumes: `NO_REPO_KEY` (Task 1), `normalizeGitRemote` + `SessionMeta` + `WorkflowRun` from `@agentistics/core`.
- Produces:
  - `type RepoKey = string`
  - `function canonicalRepoKey(key: string): RepoKey`
  - `function normalizeDenied(denied: readonly string[] | null | undefined): Set<RepoKey>`
  - `interface PathRepoIndex { resolved: Map<string, RepoKey>; conflicts: Map<string, Set<RepoKey>> }`
  - `function buildPathRepoIndex(sessions, projects?): PathRepoIndex`
  - `function repoKeyOf(s, index?): RepoKey`
  - `function sessionShared(s, denied, index?): boolean`
  - `function filterShared<T>(sessions, denied, index?): T[]`
  - `function deniedSessionIds(sessions, denied, index?): Set<string>`
  - `function sharedSessionIds(sessions): Set<string>`
  - `function filterSharedWorkflows(runs, sharedIds): WorkflowRun[]`
  - `function withUnresolvedDenied(denied: readonly string[]): string[]`
  - `function denialSignature(denied): string`
  - `function hasRestrictions(denied): boolean`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/server/share-rules.test.ts`:

```ts
import { test, expect } from 'bun:test'
import { NO_REPO_KEY, normalizeGitRemote } from '@agentistics/core'
import type { SessionMeta, WorkflowRun, HarnessId } from '@agentistics/core'
import {
  canonicalRepoKey, normalizeDenied, buildPathRepoIndex, repoKeyOf, sessionShared,
  filterShared, deniedSessionIds, sharedSessionIds, filterSharedWorkflows,
  withUnresolvedDenied, denialSignature, hasRestrictions,
} from './share-rules'

function s(over: Partial<SessionMeta> & { session_id: string }): SessionMeta {
  return {
    project_path: '/p', start_time: '2026-06-20T10:00:00Z', duration_minutes: 0,
    user_message_count: 0, assistant_message_count: 0, tool_counts: {}, tool_output_tokens: {},
    agent_file_reads: {}, languages: [], git_commits: 0, git_pushes: 0,
    input_tokens: 0, output_tokens: 0, first_prompt: '', user_interruptions: 0,
    user_response_times: [], tool_errors: 0, tool_error_categories: {}, uses_task_agent: false,
    uses_mcp: false, uses_web_search: false, uses_web_fetch: false, lines_added: 0,
    lines_removed: 0, files_modified: 0, message_hours: [], user_message_timestamps: [],
    harness: 'claude' as HarnessId,
    ...over,
  }
}

// --- keys and normalization ---

test('NO_REPO_KEY cannot collide with a real remote', () => {
  expect(NO_REPO_KEY.includes('/')).toBe(false)
  expect(normalizeGitRemote(NO_REPO_KEY)).toBe('')
})

test('repoKeyOf: a remote gives its key, a missing one gives the sentinel', () => {
  expect(repoKeyOf(s({ session_id: 'a', git_remote: 'github.com/org/repo' }))).toBe('github.com/org/repo')
  expect(repoKeyOf(s({ session_id: 'b', git_remote: undefined }))).toBe(NO_REPO_KEY)
  expect(repoKeyOf(s({ session_id: 'c', git_remote: '' }))).toBe(NO_REPO_KEY)
})

test('canonicalRepoKey folds case and ssh front-door hosts', () => {
  expect(canonicalRepoKey('GitHub.com/Acme/API')).toBe('github.com/acme/api')
  expect(canonicalRepoKey('ssh.github.com/acme/api')).toBe('github.com/acme/api')
  expect(canonicalRepoKey('altssh.bitbucket.org/t/r')).toBe('bitbucket.org/t/r')
})

test('the same repo cloned over ssh and https is ONE key', () => {
  const viaSsh = repoKeyOf(s({ session_id: 'a', git_remote: normalizeGitRemote('git@github.com:Acme/API.git') }))
  const viaHttps = repoKeyOf(s({ session_id: 'b', git_remote: normalizeGitRemote('https://github.com/acme/api') }))
  expect(viaSsh).toBe(viaHttps)
})

test('normalizeDenied canonicalizes, folds the sentinel and drops junk', () => {
  const set = normalizeDenied(['', '__no_repo__', 'junk', 'GitHub.com/O/R.git'])
  expect(set.has(NO_REPO_KEY)).toBe(true)
  expect(set.has('github.com/o/r')).toBe(true)
  expect(set.has('junk')).toBe(false)
  expect(set.size).toBe(2)
})

test('normalizeDenied on empty input, and hasRestrictions', () => {
  expect(normalizeDenied(undefined).size).toBe(0)
  expect(normalizeDenied([]).size).toBe(0)
  expect(hasRestrictions(undefined)).toBe(false)
  expect(hasRestrictions([])).toBe(false)
  expect(hasRestrictions(['github.com/o/r'])).toBe(true)
  expect(hasRestrictions([NO_REPO_KEY])).toBe(true)
})

// --- the path index ---

test('buildPathRepoIndex: first writer wins, a second remote makes a conflict', () => {
  const idx = buildPathRepoIndex([
    s({ session_id: 'a', project_path: '/ws', git_remote: 'github.com/o/one' }),
    s({ session_id: 'b', project_path: '/ws', git_remote: 'github.com/o/two' }),
  ])
  expect(idx.resolved.get('/ws')).toBe('github.com/o/one')
  expect(idx.conflicts.get('/ws')).toEqual(new Set(['github.com/o/one', 'github.com/o/two']))
})

test('buildPathRepoIndex is seeded from project.gitRemote too', () => {
  const idx = buildPathRepoIndex([], [{ path: '/codex-only', gitRemote: 'github.com/o/repo' }])
  expect(idx.resolved.get('/codex-only')).toBe('github.com/o/repo')
})

test('repoKeyOf resolves a remote-less session through the index, but never overrides its own', () => {
  const idx = buildPathRepoIndex([s({ session_id: 'a', project_path: '/ws', git_remote: 'github.com/o/one' })])
  expect(repoKeyOf(s({ session_id: 'x', project_path: '/ws' }), idx)).toBe('github.com/o/one')
  expect(repoKeyOf(s({ session_id: 'y', project_path: '/ws', git_remote: 'github.com/o/other' }), idx)).toBe('github.com/o/other')
  expect(repoKeyOf(s({ session_id: 'z', project_path: '/elsewhere' }), idx)).toBe(NO_REPO_KEY)
})

// --- filtering ---

test('an empty denylist shares everything, including unresolved sessions', () => {
  const all = [s({ session_id: 'a', git_remote: 'github.com/o/r' }), s({ session_id: 'b' })]
  expect(filterShared(all, normalizeDenied([]))).toHaveLength(2)
})

test('denying one remote drops exactly its sessions', () => {
  const all = [
    s({ session_id: 'a', git_remote: 'github.com/o/secret' }),
    s({ session_id: 'b', git_remote: 'github.com/o/public' }),
    s({ session_id: 'c' }),
  ]
  const out = filterShared(all, normalizeDenied(['github.com/o/secret']))
  expect(out.map(x => x.session_id)).toEqual(['b', 'c'])
})

test('denying the sentinel drops only unresolved sessions', () => {
  const all = [s({ session_id: 'a', git_remote: 'github.com/o/r' }), s({ session_id: 'b' })]
  const out = filterShared(all, normalizeDenied([NO_REPO_KEY]))
  expect(out.map(x => x.session_id)).toEqual(['a'])
})

test('filterShared preserves order, returns a new array and never mutates', () => {
  const all = [s({ session_id: 'a' }), s({ session_id: 'b', git_remote: 'github.com/o/r' }), s({ session_id: 'c' })]
  const snapshot = JSON.stringify(all)
  const out = filterShared(all, normalizeDenied(['github.com/o/r']))
  expect(out).not.toBe(all)
  expect(out.map(x => x.session_id)).toEqual(['a', 'c'])
  expect(JSON.stringify(all)).toBe(snapshot)
})

test('non-Claude sessions obey the same rule', () => {
  const all = [s({ session_id: 'a', harness: 'codex', git_remote: 'github.com/o/secret' })]
  expect(filterShared(all, normalizeDenied(['github.com/o/secret']))).toHaveLength(0)
})

test('a remote-less non-Claude session in a denied folder is dropped via the index', () => {
  const idx = buildPathRepoIndex([s({ session_id: 'claude1', project_path: '/repo', git_remote: 'github.com/o/secret' })])
  const codex = s({ session_id: 'codex1', harness: 'codex', project_path: '/repo' })
  expect(sessionShared(codex, normalizeDenied(['github.com/o/secret']), idx)).toBe(false)
})

test('a conflicting path fails CLOSED — denied if ANY remote under it is denied', () => {
  const idx = buildPathRepoIndex([
    s({ session_id: 'a', project_path: '/ws', git_remote: 'github.com/o/public' }),
    s({ session_id: 'b', project_path: '/ws', git_remote: 'github.com/o/secret' }),
  ])
  const inPublic = s({ session_id: 'c', project_path: '/ws', git_remote: 'github.com/o/public' })
  expect(sessionShared(inPublic, normalizeDenied(['github.com/o/secret']), idx)).toBe(false)
})

test('withUnresolvedDenied adds the sentinel only once restrictions exist, idempotently', () => {
  expect(withUnresolvedDenied([])).toEqual([])
  const once = withUnresolvedDenied(['github.com/o/r'])
  expect(once).toContain(NO_REPO_KEY)
  expect(withUnresolvedDenied(once)).toEqual(once)
})

test('deniedSessionIds returns ids that are present AND excluded — never merely absent', () => {
  const all = [s({ session_id: 'a', git_remote: 'github.com/o/secret' }), s({ session_id: 'b' })]
  const ids = deniedSessionIds(all, normalizeDenied(['github.com/o/secret']))
  expect([...ids]).toEqual(['a'])
  expect(deniedSessionIds([], normalizeDenied(['github.com/o/secret'])).size).toBe(0)
})

// --- workflows ---

function run(runId: string, sessionId: string): WorkflowRun {
  return {
    runId, name: 'audit', sessionId, status: 'completed', startedAt: '2026-06-20T10:00:00Z',
    durationMs: 0, phases: [], agents: [],
    totals: { agentCount: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, durationMs: 0, toolUses: 0 },
  }
}

test('filterSharedWorkflows keeps a run whose session is shared', () => {
  expect(filterSharedWorkflows([run('r1', 'a')], new Set(['a']))).toHaveLength(1)
})

test('filterSharedWorkflows fails CLOSED for a denied or unknown session', () => {
  expect(filterSharedWorkflows([run('r1', 'a')], new Set(['b']))).toHaveLength(0)
  expect(filterSharedWorkflows([run('r1', 'unknown')], new Set())).toHaveLength(0)
})

test('sharedSessionIds collects the ids of the filtered set', () => {
  expect(sharedSessionIds([s({ session_id: 'a' }), s({ session_id: 'b' })])).toEqual(new Set(['a', 'b']))
})

// --- signature ---

test('denialSignature is order-, case- and normalization-independent', () => {
  const a = denialSignature(['github.com/o/r', 'GitHub.com/O/Two'])
  const b = denialSignature(['github.com/o/two', 'github.com/o/r'])
  expect(a).toBe(b)
})

test('denialSignature changes when an entry is added or removed, and [] is stable', () => {
  expect(denialSignature([])).toBe(denialSignature([]))
  expect(denialSignature([])).not.toBe(denialSignature(['github.com/o/r']))
  expect(denialSignature(['github.com/o/r'])).not.toBe(denialSignature(['github.com/o/r', 'github.com/o/s']))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/server/server/share-rules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/server/server/share-rules.ts`:

```ts
/**
 * share-rules.ts — PURE. Decides what a single central connection may receive.
 *
 * Contract: no I/O, no Mongo, no `preferences`, no `config`. Only @agentistics/core types
 * and helpers. Everything here is unit-tested against fixtures, because a mistake in this
 * file leaks a repository the user believes is hidden.
 *
 * Fail-closed is the rule everywhere: when attribution is uncertain, the session is NOT
 * shared. A privacy control that guesses in the permissive direction is not a control.
 */

import { createHash } from 'node:crypto'
import { NO_REPO_KEY, normalizeGitRemote } from '@agentistics/core'
import type { SessionMeta, WorkflowRun } from '@agentistics/core'

export type RepoKey = string

/**
 * Case- and alias-folded comparison key. `normalizeGitRemote` lowercases the host but
 * PRESERVES path case and does not alias SSH front doors, so the same repo cloned as
 * `git@github.com:Acme/API.git` and as `https://github.com/acme/api` would otherwise produce
 * two keys — two picker rows, two independent rules, and blocking the one the user
 * recognizes leaves the other shared.
 *
 * This folding lives HERE and not in `normalizeGitRemote`, which also keys the Repositories
 * page and tags: changing it there has a blast radius this feature does not need.
 */
export function canonicalRepoKey(key: string): RepoKey {
  const lower = (key ?? '').toLowerCase()
  if (!lower) return ''
  const slash = lower.indexOf('/')
  if (slash <= 0) return lower
  const host = lower.slice(0, slash).replace(/^(ssh|altssh)\./, '')
  return host + lower.slice(slash)
}

/** The stored denylist → a canonical lookup set. Junk is dropped; '' folds to the sentinel
 *  for backward compatibility, but only '__no_repo__' is ever persisted. */
export function normalizeDenied(denied: readonly string[] | null | undefined): Set<RepoKey> {
  const out = new Set<RepoKey>()
  for (const raw of denied ?? []) {
    if (typeof raw !== 'string') continue
    if (raw === NO_REPO_KEY || raw === '') { out.add(NO_REPO_KEY); continue }
    const key = canonicalRepoKey(normalizeGitRemote(raw))
    if (key) out.add(key)
  }
  return out
}

export function hasRestrictions(denied: readonly string[] | null | undefined): boolean {
  return normalizeDenied(denied).size > 0
}

export interface PathRepoIndex {
  /** project_path → the remote it resolves to (canonical). */
  resolved: Map<string, RepoKey>
  /** project_path → every distinct remote ever seen under it, when more than one. */
  conflicts: Map<string, Set<RepoKey>>
}

type ProjectLike = { path: string; gitRemote?: string }

/**
 * Learn path → remote from sessions that carry one AND from ServerProject.gitRemote.
 *
 * The project seed is load-bearing: only the Copilot adapter sets `git_remote` among the
 * non-Claude adapters, and data.ts runs its persisted backfill against the Claude-only
 * session array before the harness merge — so the consolidate store carries every Codex /
 * Gemini / Kimi / agy session with no remote, permanently. A directory used exclusively by a
 * non-Claude harness has no session to learn from; the project record does.
 */
export function buildPathRepoIndex(
  sessions: readonly SessionMeta[],
  projects?: readonly ProjectLike[],
): PathRepoIndex {
  const resolved = new Map<string, RepoKey>()
  const seen = new Map<string, Set<RepoKey>>()

  const observe = (path: string, remote: string | undefined) => {
    if (!path) return
    const key = canonicalRepoKey(normalizeGitRemote(remote))
    if (!key) return
    if (!resolved.has(path)) resolved.set(path, key)
    const set = seen.get(path) ?? new Set<RepoKey>()
    set.add(key)
    seen.set(path, set)
  }

  for (const s of sessions) observe(s.project_path, s.git_remote)
  for (const p of projects ?? []) observe(p.path, p.gitRemote)

  const conflicts = new Map<string, Set<RepoKey>>()
  for (const [path, set] of seen) if (set.size > 1) conflicts.set(path, set)
  return { resolved, conflicts }
}

/** The repo bucket a session belongs to. Never returns ''. */
export function repoKeyOf(
  s: Pick<SessionMeta, 'git_remote' | 'project_path'>,
  index?: PathRepoIndex,
): RepoKey {
  // Re-normalizing is idempotent and cheap insurance against a legacy consolidate-store
  // entry written before remotes were normalized.
  const own = canonicalRepoKey(normalizeGitRemote(s.git_remote))
  if (own) return own
  const viaPath = index?.resolved.get(s.project_path)
  if (viaPath) return viaPath
  return NO_REPO_KEY
}

/**
 * A session is shared when its own key is not denied AND — when its directory is known to
 * hold more than one repo — no remote under that directory is denied.
 *
 * `scanProjectDir` stamps one remote on every session of a directory and `getProjectGitStats`
 * even scans one level of subdirectories for workspace folders, so a workspace holding a
 * shared and a blocked repo would otherwise ship the blocked repo's `first_prompt` and
 * `title` under the shared key. Annotating the ambiguity and sharing anyway is a fail-open.
 */
export function sessionShared(
  s: Pick<SessionMeta, 'git_remote' | 'project_path'>,
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): boolean {
  if (denied.size === 0) return true
  if (denied.has(repoKeyOf(s, index))) return false
  const conflict = index?.conflicts.get(s.project_path)
  if (conflict) for (const key of conflict) if (denied.has(key)) return false
  return true
}

export function filterShared<T extends Pick<SessionMeta, 'git_remote' | 'project_path'>>(
  sessions: readonly T[],
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): T[] {
  if (denied.size === 0) return [...sessions]
  return sessions.filter(s => sessionShared(s, denied, index))
}

/**
 * Sessions the denylist ACTIVELY excludes — the only legitimate removal trigger.
 *
 * Never define this as "in the sent-state but absent from the store": `loadConsolidated()`
 * swallows every error and returns empty, `writeConsolidated` writes non-atomically from the
 * same process, and a container can start before its bind mount is ready. Any of those makes
 * a cycle read short, and an absence-based trigger would then ask the central to delete
 * perfectly valid sessions and drop them from the sent-state — silent, permanent loss.
 */
export function deniedSessionIds(
  sessions: readonly SessionMeta[],
  denied: ReadonlySet<RepoKey>,
  index?: PathRepoIndex,
): Set<string> {
  const out = new Set<string>()
  if (denied.size === 0) return out
  for (const s of sessions) {
    if (s.session_id && !sessionShared(s, denied, index)) out.add(s.session_id)
  }
  return out
}

export function sharedSessionIds(sessions: readonly Pick<SessionMeta, 'session_id'>[]): Set<string> {
  const out = new Set<string>()
  for (const s of sessions) if (s.session_id) out.add(s.session_id)
  return out
}

/**
 * A workflow run has no repo of its own — it is shared iff its owning session is, and a run
 * whose session is unknown is DROPPED. `WorkflowRun` carries `name`, `phases`,
 * `agents[].label` and `totals`, which leak task descriptions and cost.
 */
export function filterSharedWorkflows(
  runs: readonly WorkflowRun[],
  sharedIds: ReadonlySet<string>,
): WorkflowRun[] {
  return runs.filter(r => !!r.sessionId && sharedIds.has(r.sessionId))
}

/**
 * The fail-closed default applied the moment a connection acquires its FIRST restriction.
 *
 * Unresolved is not the same fact as new. The sentinel covers remote-less folders, every
 * non-Claude session whose adapter never sets a remote, and store entries written before
 * remote stamping — all of which carry `project_path`, `first_prompt`, `title` and cost.
 * It is written into the PERSISTED list (never applied as a hidden runtime rule) so the
 * picker can show it pre-blocked and the user can deliberately un-block it.
 */
export function withUnresolvedDenied(denied: readonly string[]): string[] {
  if (denied.length === 0) return []
  return denied.includes(NO_REPO_KEY) ? [...denied] : [...denied, NO_REPO_KEY]
}

/** Stable fingerprint of a denylist — order-, case- and normalization-independent. */
export function denialSignature(denied: readonly string[] | null | undefined): string {
  const keys = [...normalizeDenied(denied)].sort()
  return createHash('sha256').update(keys.join('\n')).digest('hex')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/server/server/share-rules.test.ts`
Expected: PASS — 25 tests.

- [ ] **Step 5: Verify the purity constraint by inspection**

Run: `grep -nE "^import|require\(" packages/server/server/share-rules.ts`
Expected: exactly two import lines — `node:crypto` and `@agentistics/core`. Any `./config`, `./preferences`, `./mongo`, `node:fs` or `bun:sqlite` import is a defect to fix before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/share-rules.ts packages/server/server/share-rules.test.ts
git commit -m "feat(share-rules): pure per-connection session and workflow filtering"
```

---

### Task 5: Extract the Claude accumulator and build a cache from a session set

**Files:**
- Modify: `packages/server/server/data.ts` (`supplementStatsCache`, lines ~510–594)
- Modify: `packages/server/server/share-rules.ts` (append)
- Test: `packages/server/server/share-rules.test.ts` (append)

**Interfaces:**
- Consumes: Task 4's module; `emptyStatsCache`, `StatsCache`, `SessionMeta` from `@agentistics/core`.
- Produces:
  - `interface ClaudeAccumulator { dailyActivity: Map<string, {messageCount:number; sessionCount:number; toolCallCount:number}>; dailyModel: Map<string, Map<string, number>>; modelTotals: Map<string, {input:number; output:number; cacheRead:number; cacheWrite:number}>; hourCounts: Map<number, number>; totalSessions: number; totalMessages: number; firstStart: string }`
  - `function accumulateClaudeSessions(sessions, opts?: { after?: string; claudeOnly?: boolean }): ClaudeAccumulator`
  - `function buildSharedStatsCache(sessions, opts?: { version?: number }): StatsCache`

**The two traps this task exists to avoid:**
1. **`hourCounts` counts SESSIONS BY START HOUR, not messages.** On a real `stats-cache.json`, `Σ hourCounts === totalSessions`. The dashboard's session-derived variant counts messages via `message_hours`. A cache built here substitutes for a real one on a central, so it must use the real file's semantics — using `message_hours` inflates the Compare hour histogram by roughly 400×.
2. **`claudeOnly`.** `supplementStatsCache` today counts all harnesses in `dailyActivity`, which is safe there *only* because it runs before the non-Claude merge. A cache built from the whole store must gate on harness, or every non-Claude session is counted twice on the central.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/server/share-rules.test.ts`:

```ts
import { emptyStatsCache } from '@agentistics/core'
import type { StatsCache } from '@agentistics/core'
import { accumulateClaudeSessions, buildSharedStatsCache } from './share-rules'

/** 2026-06-20T09:30 LOCAL — hour bucketing is local-clock, like every adapter. */
function localAt(day: string, hour: number): string {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:30:00`).toISOString()
}

test('buildSharedStatsCache on an empty set equals emptyStatsCache (bar version)', () => {
  expect(buildSharedStatsCache([])).toEqual(emptyStatsCache())
  expect(buildSharedStatsCache([], { version: 4 }).version).toBe(4)
})

test('non-Claude sessions contribute to NOTHING', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'x', harness: 'codex', start_time: localAt('2026-06-20', 9), user_message_count: 5, input_tokens: 100, model: 'gpt-5.4' }),
  ])
  expect(out).toEqual(emptyStatsCache())
})

test('lastComputedDate stays empty even for a multi-month input', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-02-01', 9) }),
    s({ session_id: 'b', start_time: localAt('2026-06-20', 9) }),
  ])
  expect(out.lastComputedDate).toBe('')
})

test('totals match the sum of dailyActivity — the invariant the real file holds', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9), user_message_count: 3, assistant_message_count: 4 }),
    s({ session_id: 'b', start_time: localAt('2026-06-21', 14), user_message_count: 1, assistant_message_count: 1 }),
  ])
  expect(out.totalSessions).toBe(out.dailyActivity.reduce((a, d) => a + d.sessionCount, 0))
  expect(out.totalMessages).toBe(out.dailyActivity.reduce((a, d) => a + d.messageCount, 0))
  expect(out.totalSessions).toBe(2)
  expect(out.totalMessages).toBe(9)
})

test('hourCounts buckets SESSION START hours on the local clock, and sums to totalSessions', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9), message_hours: [1, 1, 1, 1] }),
    s({ session_id: 'b', start_time: localAt('2026-06-21', 9), message_hours: [2, 2] }),
    s({ session_id: 'c', start_time: localAt('2026-06-21', 15), message_hours: [3] }),
  ])
  expect(out.hourCounts['9']).toBe(2)
  expect(out.hourCounts['15']).toBe(1)
  expect(Object.values(out.hourCounts).reduce((a, b) => a + b, 0)).toBe(out.totalSessions)
})

test('dailyModelTokens sums the four token kinds per claude model per day, and skips foreign ids', () => {
  const out = buildSharedStatsCache([
    s({
      session_id: 'a', start_time: localAt('2026-06-20', 9), model: 'claude-opus-5',
      input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40,
    }),
    s({ session_id: 'b', start_time: localAt('2026-06-20', 9), model: '<synthetic>', input_tokens: 999 }),
  ])
  const day = out.dailyModelTokens.find(d => d.date === '2026-06-20')!
  expect(day.tokensByModel['claude-opus-5']).toBe(100)
  expect(day.tokensByModel['<synthetic>']).toBeUndefined()
  // The <synthetic> session still counts as activity.
  expect(out.totalSessions).toBe(2)
})

test('modelUsage keeps costUSD and webSearchRequests at 0, like the real file', () => {
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9), model: 'claude-opus-5', input_tokens: 10, uses_web_search: true }),
  ])
  expect(out.modelUsage['claude-opus-5']!.inputTokens).toBe(10)
  expect(out.modelUsage['claude-opus-5']!.costUSD).toBe(0)
  expect(out.modelUsage['claude-opus-5']!.webSearchRequests).toBe(0)
})

test('firstSessionDate is the earliest FULL ISO start_time', () => {
  const early = localAt('2026-02-06', 8)
  const out = buildSharedStatsCache([
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9) }),
    s({ session_id: 'b', start_time: early }),
  ])
  expect(out.firstSessionDate).toBe(early)
  expect(out.firstSessionDate.length).toBeGreaterThan(10)
  expect(buildSharedStatsCache([]).firstSessionDate).toBe('')
})

test('longestSession is the zero value even with a long session present', () => {
  const out = buildSharedStatsCache([s({ session_id: 'a', start_time: localAt('2026-06-20', 9), duration_minutes: 400 })])
  expect(out.longestSession).toEqual({ sessionId: '', duration: 0, messageCount: 0, timestamp: '' })
})

test('a session with no start_time is skipped without throwing', () => {
  expect(() => buildSharedStatsCache([s({ session_id: 'a', start_time: '' })])).not.toThrow()
  expect(buildSharedStatsCache([s({ session_id: 'a', start_time: '' })]).totalSessions).toBe(0)
})

test('the output carries NO key outside the StatsCache shape', () => {
  const out = buildSharedStatsCache([s({ session_id: 'a', start_time: localAt('2026-06-20', 9) })])
  expect(Object.keys(out).sort()).toEqual(Object.keys(emptyStatsCache()).sort())
})

test('end to end: a denied repo contributes to no field at all', () => {
  const all = [
    s({ session_id: 'keep', start_time: localAt('2026-06-20', 9), model: 'claude-opus-5', input_tokens: 10, git_remote: 'github.com/o/public', user_message_count: 1 }),
    s({ session_id: 'drop', start_time: localAt('2026-06-20', 11), model: 'claude-opus-5', input_tokens: 500, git_remote: 'github.com/o/secret', user_message_count: 9 }),
  ]
  const out = buildSharedStatsCache(filterShared(all, normalizeDenied(['github.com/o/secret'])))
  expect(out.totalSessions).toBe(1)
  expect(out.totalMessages).toBe(1)
  expect(out.modelUsage['claude-opus-5']!.inputTokens).toBe(10)
  expect(out.dailyModelTokens[0]!.tokensByModel['claude-opus-5']).toBe(10)
  expect(out.hourCounts['11']).toBeUndefined()
  expect(JSON.stringify(out)).not.toContain('secret')
})

test('accumulateClaudeSessions honours `after` exclusively (<=), and includes all without it', () => {
  const sessions = [
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9) }),
    s({ session_id: 'b', start_time: localAt('2026-06-22', 9) }),
    s({ session_id: 'c', start_time: localAt('2026-06-23', 9) }),
  ]
  expect(accumulateClaudeSessions(sessions, { after: '2026-06-22' }).totalSessions).toBe(1)
  expect(accumulateClaudeSessions(sessions).totalSessions).toBe(3)
})

test('accumulateClaudeSessions without claudeOnly counts every harness — the data.ts contract', () => {
  const mixed = [
    s({ session_id: 'a', start_time: localAt('2026-06-20', 9) }),
    s({ session_id: 'b', harness: 'codex', start_time: localAt('2026-06-20', 9) }),
  ]
  expect(accumulateClaudeSessions(mixed).totalSessions).toBe(2)
  expect(accumulateClaudeSessions(mixed, { claudeOnly: true }).totalSessions).toBe(1)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/server/server/share-rules.test.ts`
Expected: FAIL — `accumulateClaudeSessions is not a function`.

- [ ] **Step 3: Implement the accumulator and the builder**

Append to `packages/server/server/share-rules.ts`:

```ts
import { emptyStatsCache } from '@agentistics/core'
import type { StatsCache } from '@agentistics/core'

export interface ClaudeAccumulator {
  dailyActivity: Map<string, { messageCount: number; sessionCount: number; toolCallCount: number }>
  dailyModel: Map<string, Map<string, number>>
  modelTotals: Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
  /** Session START hour (0-23) → count. NOT message hours — see buildSharedStatsCache. */
  hourCounts: Map<number, number>
  totalSessions: number
  totalMessages: number
  /** Earliest ISO start_time seen, '' when none. */
  firstStart: string
}

/**
 * The accumulation core, extracted from data.ts's supplementStatsCache so the supplement path
 * and the connection-scoped build cannot drift apart.
 *
 * @param opts.after      skip days `<= after` (the caller's lastComputedDate watermark)
 * @param opts.claudeOnly drop non-Claude sessions entirely. FALSE for data.ts, which is called
 *                        before the harness merge and therefore only ever sees Claude sessions;
 *                        TRUE for buildSharedStatsCache, which is handed the whole store.
 */
export function accumulateClaudeSessions(
  sessions: readonly SessionMeta[],
  opts?: { after?: string; claudeOnly?: boolean },
): ClaudeAccumulator {
  const after = opts?.after ?? ''
  const claudeOnly = opts?.claudeOnly ?? false

  const acc: ClaudeAccumulator = {
    dailyActivity: new Map(), dailyModel: new Map(), modelTotals: new Map(),
    hourCounts: new Map(), totalSessions: 0, totalMessages: 0, firstStart: '',
  }

  for (const s of sessions) {
    if (!s.start_time) continue
    if (claudeOnly && (s.harness ?? 'claude') !== 'claude') continue
    const day = s.start_time.slice(0, 10)
    if (after && day <= after) continue

    const messages = (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
    const da = acc.dailyActivity.get(day) ?? { messageCount: 0, sessionCount: 0, toolCallCount: 0 }
    da.messageCount += messages
    da.sessionCount += 1
    da.toolCallCount += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    acc.dailyActivity.set(day, da)

    acc.totalSessions += 1
    acc.totalMessages += messages
    if (!acc.firstStart || s.start_time < acc.firstStart) acc.firstStart = s.start_time

    // Local clock, like every adapter. Reading a UTC timestamp as local put the peak-usage
    // chart hours off for four harnesses once already.
    const hour = new Date(s.start_time).getHours()
    if (Number.isFinite(hour)) acc.hourCounts.set(hour, (acc.hourCounts.get(hour) ?? 0) + 1)

    const model = s.model
    if (!model || !model.startsWith('claude-')) continue
    const inp = s.input_tokens ?? 0
    const out = s.output_tokens ?? 0
    const cr = s.cache_read_input_tokens ?? 0
    const cw = s.cache_creation_input_tokens ?? 0
    const total = inp + out + cr + cw
    if (total === 0) continue

    const byModel = acc.dailyModel.get(day) ?? new Map<string, number>()
    byModel.set(model, (byModel.get(model) ?? 0) + total)
    acc.dailyModel.set(day, byModel)

    const mt = acc.modelTotals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    mt.input += inp; mt.output += out; mt.cacheRead += cr; mt.cacheWrite += cw
    acc.modelTotals.set(model, mt)
  }

  return acc
}

/**
 * A Claude StatsCache derived ONLY from the sessions passed in. Supplies the from-boundary
 * half of the attribution split (Task 6) and stands alone in tests.
 *
 * Field decisions verified against a real ~/.claude/stats-cache.json, not assumed:
 * - `lastComputedDate: ''` — the field asserts "Claude has already rolled up every day to
 *   here". Claiming a watermark this cache cannot back makes any consumer running the
 *   `day <= lastComputed → skip` guard drop legitimate gap-fill.
 * - `hourCounts` counts SESSIONS BY START HOUR (Σ hourCounts === totalSessions on the real
 *   file), not messages.
 * - `modelUsage[].costUSD` and `.webSearchRequests` stay 0 — the real file stores 0 too, and
 *   every consumer prices via calcCost(). A real number here would make this cache behave
 *   DIFFERENTLY from a real one.
 * - `longestSession` is zeroed: the real field is wall-clock ms including idle, while
 *   `duration_minutes` is active time. Synthesizing it puts incompatible units into
 *   mergeStatsCaches's max. Nothing in web/ reads it.
 */
export function buildSharedStatsCache(
  sessions: readonly SessionMeta[],
  opts?: { version?: number },
): StatsCache {
  const acc = accumulateClaudeSessions(sessions, { claudeOnly: true })
  const out = emptyStatsCache()
  if (opts?.version !== undefined) out.version = opts.version

  out.dailyActivity = [...acc.dailyActivity.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))

  out.dailyModelTokens = [...acc.dailyModel.entries()]
    .map(([date, byModel]) => ({ date, tokensByModel: Object.fromEntries(byModel) }))
    .sort((a, b) => a.date.localeCompare(b.date))

  for (const [model, t] of acc.modelTotals) {
    out.modelUsage[model] = {
      inputTokens: t.input,
      outputTokens: t.output,
      cacheReadInputTokens: t.cacheRead,
      cacheCreationInputTokens: t.cacheWrite,
      webSearchRequests: 0,
      costUSD: 0,
    }
  }

  out.totalSessions = acc.totalSessions
  out.totalMessages = acc.totalMessages
  out.firstSessionDate = acc.firstStart
  out.hourCounts = Object.fromEntries([...acc.hourCounts.entries()].map(([h, c]) => [String(h), c]))
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/server/server/share-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `supplementStatsCache` to consume the accumulator**

In `packages/server/server/data.ts`, replace the three inlined `Map` builds (the loop from `const dailyModel = new Map...` through the closing brace of the `for (const s of sessions)` loop, ~lines 514–548) with:

```ts
  const { accumulateClaudeSessions } = await import('./share-rules')
  const acc = accumulateClaudeSessions(sessions, { after: statsCache.lastComputedDate ?? '' })
  const dailyModel = acc.dailyModel
  const modelTotals = acc.modelTotals
  const dailyActivity = acc.dailyActivity
```

Note `claudeOnly` is **not** passed — `supplementStatsCache` runs before the non-Claude merge and only ever sees Claude sessions, so the gate is a provable no-op here and passing `true` would be a behaviour change disguised as a refactor.

If `supplementStatsCache` is not already `async`, make it `async` and `await` it at its single call site (`data.ts:766`), or hoist the import to the top of the file — the latter is simpler and `share-rules.ts` has no side effects at import time. Prefer the static import.

Everything below the loop (the upsert into the existing cache) is unchanged.

- [ ] **Step 6: Verify the extraction changed nothing**

Run: `bun test`
Expected: PASS except the two pre-existing failures. Then verify against real data:

```bash
bun run packages/server/bin/cli.ts server &
sleep 6
curl -s localhost:47291/api/data | bun -e 'const d=await Bun.stdin.json(); console.log(d.statsCache.totalSessions, d.statsCache.firstSessionDate, d.statsCache.dailyActivity.length)'
kill %1
```
Expected: the same three numbers as before the change. Record them from `git stash` on the previous commit if unsure.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/share-rules.ts packages/server/server/share-rules.test.ts packages/server/server/data.ts
git commit -m "refactor(stats): extract the Claude accumulator and build a cache from a session set"
```

---

### Task 6: The attribution split

**Files:**
- Modify: `packages/server/server/share-rules.ts` (append)
- Test: `packages/server/server/share-rules.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 4 and 5.
- Produces:
  - `function attributionBoundary(allStored: readonly SessionMeta[]): string`
  - `function buildSplitStatsCache(input: { real: StatsCache; allStored: readonly SessionMeta[]; shared: readonly SessionMeta[]; boundary: string }): StatsCache | null`
  - `function prehistoryCount(allStored: readonly SessionMeta[], boundary: string): number`
  - `function deniedTouchesPrehistory(allStored, denied, boundary, index?): boolean`

**What this is for:** Claude deletes transcripts after 30 days but keeps aggregate totals forever, so a period exists that no repo rule can reach. Truncating the cache to what the store covers would make the same machine report irreconcilable totals to itself and to the central. The split keeps the totals whole: days before the boundary are copied verbatim, days from it onward are rebuilt from the shared sessions. **Every term is copied or summed — nothing is estimated, ratioed or prorated.**

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/server/share-rules.test.ts`:

```ts
import { attributionBoundary, buildSplitStatsCache, prehistoryCount, deniedTouchesPrehistory } from './share-rules'

/** A real-ish cache: prehistory (Feb) + attributable (June), as the reference machine has. */
function realCache(): StatsCache {
  return {
    ...emptyStatsCache(),
    version: 4,
    lastComputedDate: '2026-06-22',
    dailyActivity: [
      { date: '2026-02-06', messageCount: 100, sessionCount: 10, toolCallCount: 50 },
      { date: '2026-06-20', messageCount: 9, sessionCount: 2, toolCallCount: 4 },
    ],
    dailyModelTokens: [
      { date: '2026-02-06', tokensByModel: { 'claude-opus-5': 1000 } },
      { date: '2026-06-20', tokensByModel: { 'claude-opus-5': 510 } },
    ],
    modelUsage: {
      'claude-opus-5': {
        inputTokens: 1510, outputTokens: 0, cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0,
      },
    },
    totalSessions: 12,
    totalMessages: 109,
    firstSessionDate: '2026-02-06T00:53:42.012Z',
    hourCounts: { '8': 10, '9': 1, '11': 1 },
  }
}

/**
 * The store: only June — 'keep' (public) and 'drop' (secret).
 * These MUST reproduce the real cache's 2026-06-20 row exactly, or the no-op invariant test
 * below fails for the wrong reason: 2 sessions, 9 messages, 4 tool calls, 510 tokens,
 * start hours 9 and 11.
 */
function storeSessions(): SessionMeta[] {
  return [
    s({ session_id: 'keep', start_time: localAt('2026-06-20', 9), model: 'claude-opus-5', input_tokens: 10, git_remote: 'github.com/o/public', user_message_count: 1, tool_counts: { Read: 2 } }),
    s({ session_id: 'drop', start_time: localAt('2026-06-20', 11), model: 'claude-opus-5', input_tokens: 500, git_remote: 'github.com/o/secret', user_message_count: 8, tool_counts: { Bash: 2 } }),
  ]
}

test('attributionBoundary is the earliest stored Claude day, and empty for an empty store', () => {
  expect(attributionBoundary(storeSessions())).toBe('2026-06-20')
  expect(attributionBoundary([])).toBe('')
  expect(attributionBoundary([s({ session_id: 'x', harness: 'codex', start_time: localAt('2026-01-01', 9) })])).toBe('')
})

test('THE HEADLINE INVARIANT: denying nothing makes the split a no-op', () => {
  const all = storeSessions()
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared: all, boundary: '2026-06-20' })!
  // Every field is reproduced EXCEPT lastComputedDate, which the split always blanks so no
  // consumer's `day <= lastComputed → skip` guard can drop legitimate gap-fill.
  const { lastComputedDate, ...rest } = out
  const { lastComputedDate: _ignored, ...expected } = realCache()
  expect(rest).toEqual(expected)
  expect(lastComputedDate).toBe('')
})

test('totals drop by exactly the denied contribution and by nothing else', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared, boundary: '2026-06-20' })!
  const real = realCache()
  expect(out.totalSessions).toBe(real.totalSessions - 1)
  expect(out.totalMessages).toBe(real.totalMessages - 8)
  expect(out.modelUsage['claude-opus-5']!.inputTokens).toBe(real.modelUsage['claude-opus-5']!.inputTokens - 500)
})

test('days before the boundary are byte-identical to the real cache', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared, boundary: '2026-06-20' })!
  expect(out.dailyActivity.find(d => d.date === '2026-02-06')).toEqual({ date: '2026-02-06', messageCount: 100, sessionCount: 10, toolCallCount: 50 })
  expect(out.dailyModelTokens.find(d => d.date === '2026-02-06')!.tokensByModel).toEqual({ 'claude-opus-5': 1000 })
})

test('a denied session BEFORE the boundary is not filtered — the prehistory is untouched', () => {
  const all = [
    ...storeSessions(),
    s({ session_id: 'old-secret', start_time: localAt('2026-02-06', 8), model: 'claude-opus-5', input_tokens: 999, git_remote: 'github.com/o/secret', user_message_count: 3 }),
  ]
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  // Boundary stays at June: the February session predates the store's authority window.
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared, boundary: '2026-06-20' })!
  expect(out.dailyActivity.find(d => d.date === '2026-02-06')!.sessionCount).toBe(10)
})

test('days from the boundary contain zero contribution from denied sessions', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared, boundary: '2026-06-20' })!
  const june = out.dailyActivity.find(d => d.date === '2026-06-20')!
  expect(june.sessionCount).toBe(1)
  expect(june.messageCount).toBe(1)
  expect(out.dailyModelTokens.find(d => d.date === '2026-06-20')!.tokensByModel['claude-opus-5']).toBe(10)
  expect(out.hourCounts['11']).toBeUndefined()
  expect(out.hourCounts['9']).toBe(1)
  expect(out.hourCounts['8']).toBe(10)
})

test('firstSessionDate comes from the real cache, not the earliest shared session', () => {
  const all = storeSessions()
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared: all, boundary: '2026-06-20' })!
  expect(out.firstSessionDate).toBe('2026-02-06T00:53:42.012Z')
})

test('a real cache lagging behind the store clamps at 0 and never goes negative', () => {
  const lagging: StatsCache = { ...realCache(), modelUsage: { 'claude-opus-5': { inputTokens: 5, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 } }, hourCounts: { '9': 0 } }
  const all = storeSessions()
  const out = buildSplitStatsCache({ real: lagging, allStored: all, shared: all, boundary: '2026-06-20' })!
  for (const u of Object.values(out.modelUsage)) {
    expect(u.inputTokens).toBeGreaterThanOrEqual(0)
    expect(u.outputTokens).toBeGreaterThanOrEqual(0)
  }
  for (const c of Object.values(out.hourCounts)) expect(c).toBeGreaterThanOrEqual(0)
})

test('longestSession is zeroed when it names a denied session, kept otherwise', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const named: StatsCache = { ...realCache(), longestSession: { sessionId: 'drop', duration: 999, messageCount: 3, timestamp: 'x' } }
  const zeroed = buildSplitStatsCache({ real: named, allStored: all, shared, boundary: '2026-06-20' })!
  expect(zeroed.longestSession).toEqual({ sessionId: '', duration: 0, messageCount: 0, timestamp: '' })

  const kept: StatsCache = { ...realCache(), longestSession: { sessionId: 'keep', duration: 999, messageCount: 3, timestamp: 'x' } }
  const out = buildSplitStatsCache({ real: kept, allStored: all, shared, boundary: '2026-06-20' })!
  expect(out.longestSession.sessionId).toBe('keep')
})

test('an unusable split returns null rather than an unfiltered cache', () => {
  const all = storeSessions()
  expect(buildSplitStatsCache({ real: realCache(), allStored: all, shared: all, boundary: '' })).toBeNull()
  expect(buildSplitStatsCache({ real: null as unknown as StatsCache, allStored: all, shared: all, boundary: '2026-06-20' })).toBeNull()
})

test('a boundary later than the store leaves the intervening days UNFILTERED (why monotonicity matters)', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared, boundary: '2026-07-01' })!
  // June is now prehistory, so the denied session's tokens ride along untouched.
  expect(out.dailyModelTokens.find(d => d.date === '2026-06-20')!.tokensByModel['claude-opus-5']).toBe(510)
})

test('the split output carries no key outside the StatsCache shape', () => {
  const all = storeSessions()
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared: all, boundary: '2026-06-20' })!
  expect(Object.keys(out).sort()).toEqual(Object.keys(emptyStatsCache()).sort())
})

test('prehistoryCount and deniedTouchesPrehistory are local disclosure helpers', () => {
  const all = [
    ...storeSessions(),
    s({ session_id: 'old-secret', start_time: localAt('2026-02-06', 8), git_remote: 'github.com/o/secret' }),
  ]
  expect(prehistoryCount(all, '2026-06-20')).toBe(1)
  expect(prehistoryCount(all, '')).toBe(0)
  expect(deniedTouchesPrehistory(all, normalizeDenied(['github.com/o/secret']), '2026-06-20')).toBe(true)
  expect(deniedTouchesPrehistory(all, normalizeDenied(['github.com/o/public']), '2026-06-20')).toBe(false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/server/server/share-rules.test.ts`
Expected: FAIL — `attributionBoundary is not a function`.

- [ ] **Step 3: Implement**

Append to `packages/server/server/share-rules.ts`:

```ts
/**
 * First local day from which the consolidate store is the authority on what happened — the
 * earliest start_time day across ALL stored Claude sessions, shared and denied alike. Days
 * before it cannot be attributed to any repository by anyone, including this machine.
 *
 * '' when the store holds no Claude session: nothing is attributable, and buildSplitStatsCache
 * then refuses rather than shipping an unfiltered cache.
 */
export function attributionBoundary(allStored: readonly SessionMeta[]): string {
  let min = ''
  for (const s of allStored) {
    if (!s.start_time) continue
    if ((s.harness ?? 'claude') !== 'claude') continue
    const day = s.start_time.slice(0, 10)
    if (!min || day < min) min = day
  }
  return min
}

/** Stored sessions strictly before the boundary — the size of the block no rule can filter. */
export function prehistoryCount(allStored: readonly SessionMeta[], boundary: string): number {
  if (!boundary) return 0
  let n = 0
  for (const s of allStored) {
    if (s.start_time && s.start_time.slice(0, 10) < boundary) n++
  }
  return n
}

/** Does any DENIED repo have a stored session before the boundary? Drives the specific
 *  variant of the confirm copy. A false answer is not a proof of absence — it only means the
 *  store holds no such session — which is why the generic copy is always shown too. */
export function deniedTouchesPrehistory(
  allStored: readonly SessionMeta[],
  denied: ReadonlySet<RepoKey>,
  boundary: string,
  index?: PathRepoIndex,
): boolean {
  if (!boundary || denied.size === 0) return false
  for (const s of allStored) {
    if (!s.start_time || s.start_time.slice(0, 10) >= boundary) continue
    if (!sessionShared(s, denied, index)) return true
  }
  return false
}

function sumUsage(sessions: readonly SessionMeta[], from: string) {
  const totals = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>()
  const hours = new Map<number, number>()
  for (const s of sessions) {
    if (!s.start_time || s.start_time.slice(0, 10) < from) continue
    if ((s.harness ?? 'claude') !== 'claude') continue
    const hour = new Date(s.start_time).getHours()
    if (Number.isFinite(hour)) hours.set(hour, (hours.get(hour) ?? 0) + 1)
    const model = s.model
    if (!model || !model.startsWith('claude-')) continue
    const t = totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    t.input += s.input_tokens ?? 0
    t.output += s.output_tokens ?? 0
    t.cacheRead += s.cache_read_input_tokens ?? 0
    t.cacheWrite += s.cache_creation_input_tokens ?? 0
    totals.set(model, t)
  }
  return { totals, hours }
}

/**
 * The cache a RESTRICTED connection pushes.
 *
 * Days `< boundary` are copied verbatim from `real` — the prehistory, which no rule can reach
 * because the transcripts behind it are gone. Days `>= boundary` are rebuilt from `shared`.
 * Date-less fields (modelUsage, hourCounts) have no day dimension in the cache, so their
 * prehistory term is recovered as `real − attributable`, a difference of two exactly-known
 * quantities — never a proration.
 *
 * Returns null when the split cannot be made faithfully; the caller must then push NO
 * statsCache at all. A missing cache is recoverable; a leaked one is not.
 */
export function buildSplitStatsCache(input: {
  real: StatsCache
  allStored: readonly SessionMeta[]
  shared: readonly SessionMeta[]
  boundary: string
}): StatsCache | null {
  const { real, allStored, shared, boundary } = input
  if (!real || !boundary) return null

  const fromShared = buildSharedStatsCache(shared, { version: real.version })
  const out = emptyStatsCache()
  out.version = real.version
  out.lastComputedDate = ''
  out.totalSpeculationTimeSavedMs = real.totalSpeculationTimeSavedMs
  out.firstSessionDate = real.firstSessionDate

  // --- date-dimensioned: copy before, rebuild from ---
  out.dailyActivity = [
    ...real.dailyActivity.filter(d => d.date < boundary),
    ...fromShared.dailyActivity.filter(d => d.date >= boundary),
  ].sort((a, b) => a.date.localeCompare(b.date))

  out.dailyModelTokens = [
    ...real.dailyModelTokens.filter(d => d.date < boundary),
    ...fromShared.dailyModelTokens.filter(d => d.date >= boundary),
  ].sort((a, b) => a.date.localeCompare(b.date))

  // --- totals: derived from the result's own dailyActivity, preserving the real file's
  //     invariant totalSessions === Σ dailyActivity.sessionCount ---
  out.totalSessions = out.dailyActivity.reduce((a, d) => a + d.sessionCount, 0)
  out.totalMessages = out.dailyActivity.reduce((a, d) => a + d.messageCount, 0)

  // --- date-less: real − attributable + shared, clamped at 0 ---
  const attributable = sumUsage(allStored, boundary)
  const kept = sumUsage(shared, boundary)

  const models = new Set([
    ...Object.keys(real.modelUsage),
    ...attributable.totals.keys(),
    ...kept.totals.keys(),
  ])
  for (const model of models) {
    const r = real.modelUsage[model]
    const a = attributable.totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const k = kept.totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const usage = {
      inputTokens: Math.max(0, (r?.inputTokens ?? 0) - a.input) + k.input,
      outputTokens: Math.max(0, (r?.outputTokens ?? 0) - a.output) + k.output,
      cacheReadInputTokens: Math.max(0, (r?.cacheReadInputTokens ?? 0) - a.cacheRead) + k.cacheRead,
      cacheCreationInputTokens: Math.max(0, (r?.cacheCreationInputTokens ?? 0) - a.cacheWrite) + k.cacheWrite,
      webSearchRequests: 0,
      costUSD: 0,
    }
    const any = usage.inputTokens || usage.outputTokens || usage.cacheReadInputTokens || usage.cacheCreationInputTokens
    if (any) out.modelUsage[model] = usage
  }

  const hourKeys = new Set([
    ...Object.keys(real.hourCounts),
    ...[...attributable.hours.keys()].map(String),
    ...[...kept.hours.keys()].map(String),
  ])
  for (const key of hourKeys) {
    const h = Number(key)
    const value = Math.max(0, (real.hourCounts[key] ?? 0) - (attributable.hours.get(h) ?? 0)) + (kept.hours.get(h) ?? 0)
    if (value > 0) out.hourCounts[key] = value
  }

  // --- longestSession names a session; zero it when that session is one we withhold ---
  const sharedIds = sharedSessionIds(shared)
  const storedIds = sharedSessionIds(allStored)
  const named = real.longestSession?.sessionId ?? ''
  out.longestSession = (named && storedIds.has(named) && !sharedIds.has(named))
    ? { sessionId: '', duration: 0, messageCount: 0, timestamp: '' }
    : { ...real.longestSession }

  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/server/server/share-rules.test.ts`
Expected: PASS — all 40+ tests.

**If the headline no-op test fails on `dailyActivity`**, the fixtures have drifted apart: `storeSessions()` must reproduce `realCache()`'s `2026-06-20` row exactly (2 sessions, 9 messages, 4 tool calls, 510 tokens, start hours 9 and 11). Fix the fixture, never the assertion — that test is the whole point of the split.

- [ ] **Step 5: Run the full suite**

Run: `bun test && bun tsc --noEmit`
Expected: PASS except the two pre-existing `lucide-react` failures; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/share-rules.ts packages/server/server/share-rules.test.ts
git commit -m "feat(share-rules): split the aggregate at the attribution boundary"
```

---

---

### Task 7: Rebuild the split on Claude's watermark, with sealed days

**Why this task exists.** Task 6 shipped the split with the boundary defined as `min(stored day)`. A review derived three defects from the code, and measuring against real data confirmed the root cause: the store is a strict **subset** of Claude's rollup for every day at or before `lastComputedDate` (per-day reconciliation matched **0 of 23 days**), while every day after it is gap-filled *from that same store*. So the decomposable window is defined by **Claude's watermark**, not by where the store begins. This task replaces `attributionBoundary` and `buildSplitStatsCache` accordingly, adds the seal ledger that keeps a day filtered after the watermark passes it, and fixes the two review findings that stand on their own.

**Files:**
- Modify: `packages/server/server/share-rules.ts` (replace `attributionBoundary`, `prehistoryCount`, `deniedTouchesPrehistory`, `buildSplitStatsCache`; keep `sumUsage`)
- Modify: `packages/server/server/share-rules.test.ts` (replace the Task 6 split tests)
- Reference: spec §4.3b in `docs/superpowers/specs/2026-07-28-multi-central-and-repo-sharing-design.md`

**Interfaces:**
- Consumes: `buildSharedStatsCache`, `sessionShared`, `sharedSessionIds`, `normalizeDenied`, `filterShared`, `PathRepoIndex`, `RepoKey` (Tasks 4–5); `StatsCache`, `SessionMeta`, `emptyStatsCache` from `@agentistics/core`.
- Produces: `attributionBoundary(real)`, `DeniedDayDelta`, `DeniedLedger`, `deniedDeltaByDay`, `advanceSeal`, `buildSplitStatsCache`, `prehistoryCount(real, boundary)`, `deniedTouchesPrehistory`.

**Measured facts this task encodes — do not re-derive them, and do not contradict them:**
- `lastComputedDate` on the reference machine is `2026-06-22`; every later day is absent from the raw cache and gap-filled by `supplementStatsCache`.
- `supplementStatsCache` gap-fills `dailyActivity`, `dailyModelTokens` and `modelUsage` **only** — never `hourCounts`, `totalSessions` or `totalMessages`. Those three describe Claude's rollup alone, which is why the split subtracts from them but never adds a `kept` term.
- The supplemented cache is therefore already internally inconsistent and already ships that way today: `totalSessions` 255 against `Σ dailyActivity.sessionCount` 317, and `Σ hourCounts` 255.

- [ ] **Step 1: Replace the split's tests**

In `packages/server/server/share-rules.test.ts`, delete every test from `attributionBoundary is the earliest stored Claude day...` through the end of the Task 6 block (the last one is `prehistoryCount and deniedTouchesPrehistory are local disclosure helpers`), together with the `realCache()` and `storeSessions()` fixtures. Keep the `s()` and `localAt()` helpers. Then append:

```ts
import {
  attributionBoundary, buildSplitStatsCache, prehistoryCount, deniedTouchesPrehistory,
  deniedDeltaByDay, advanceSeal,
} from './share-rules'
import type { DeniedLedger } from './share-rules'

/**
 * A cache shaped like the real one: Claude rolled up through 2026-06-22 (prehistory), and
 * 2026-06-25 is gap-filled by supplementStatsCache from the store. hourCounts / totalSessions /
 * totalMessages cover the ROLLUP ONLY — that asymmetry is real and load-bearing.
 */
function realCache(): StatsCache {
  return {
    ...emptyStatsCache(),
    version: 4,
    lastComputedDate: '2026-06-22',
    dailyActivity: [
      { date: '2026-02-06', messageCount: 100, sessionCount: 10, toolCallCount: 50 },
      { date: '2026-06-25', messageCount: 9, sessionCount: 2, toolCallCount: 4 },
    ],
    dailyModelTokens: [
      { date: '2026-02-06', tokensByModel: { 'claude-opus-5': 1000 } },
      { date: '2026-06-25', tokensByModel: { 'claude-opus-5': 510 } },
    ],
    modelUsage: {
      'claude-opus-5': {
        inputTokens: 1510, outputTokens: 0, cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0,
      },
    },
    totalSessions: 10,      // rollup only
    totalMessages: 100,     // rollup only
    firstSessionDate: '2026-02-06T00:53:42.012Z',
    hourCounts: { '8': 10 }, // rollup only
  }
}

/** The store — only the gap-filled day. Reproduces realCache()'s 2026-06-25 row exactly. */
function storeSessions(): SessionMeta[] {
  return [
    s({ session_id: 'keep', start_time: localAt('2026-06-25', 9), model: 'claude-opus-5', input_tokens: 10, git_remote: 'github.com/o/public', user_message_count: 1, tool_counts: { Read: 2 } }),
    s({ session_id: 'drop', start_time: localAt('2026-06-25', 11), model: 'claude-opus-5', input_tokens: 500, git_remote: 'github.com/o/secret', user_message_count: 8, tool_counts: { Bash: 2 } }),
  ]
}

const NO_SEAL: DeniedLedger = {}

test('attributionBoundary is the day AFTER Claude’s watermark', () => {
  expect(attributionBoundary(realCache())).toBe('2026-06-23')
  expect(attributionBoundary({ ...emptyStatsCache(), lastComputedDate: '2026-12-31' })).toBe('2027-01-01')
})

test('attributionBoundary is empty when Claude has rolled up nothing — everything is decomposable', () => {
  expect(attributionBoundary(emptyStatsCache())).toBe('')
})

test('THE HEADLINE INVARIANT: denying nothing makes the split a no-op, with NO field excepted', () => {
  const all = storeSessions()
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared: all, boundary: '2026-06-23', sealed: NO_SEAL })!
  expect(out).toEqual(realCache())
})

test('totals drop by exactly the denied contribution and by nothing else', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared, boundary: '2026-06-23', sealed: NO_SEAL })!
  const june = out.dailyActivity.find(d => d.date === '2026-06-25')!
  expect(june.sessionCount).toBe(1)
  expect(june.messageCount).toBe(1)
  expect(june.toolCallCount).toBe(2)
  expect(out.dailyModelTokens.find(d => d.date === '2026-06-25')!.tokensByModel['claude-opus-5']).toBe(10)
  expect(out.modelUsage['claude-opus-5']!.inputTokens).toBe(1510 - 500)
})

test('the rollup half is untouched: prehistory rows, hourCounts and totals are verbatim', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared, boundary: '2026-06-23', sealed: NO_SEAL })!
  expect(out.dailyActivity.find(d => d.date === '2026-02-06')).toEqual({ date: '2026-02-06', messageCount: 100, sessionCount: 10, toolCallCount: 50 })
  expect(out.hourCounts).toEqual({ '8': 10 })   // no +kept term: the rollup never covered the gap-filled window
  expect(out.totalSessions).toBe(10)
  expect(out.totalMessages).toBe(100)
  expect(out.lastComputedDate).toBe('2026-06-22')
  expect(out.firstSessionDate).toBe('2026-02-06T00:53:42.012Z')
})

test('deniedDeltaByDay measures only the decomposable window, and only denied sessions', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const led = deniedDeltaByDay(all, shared, '2026-06-23')
  expect(Object.keys(led)).toEqual(['2026-06-25'])
  const d = led['2026-06-25']!
  expect(d.sessionCount).toBe(1)
  expect(d.messageCount).toBe(8)
  expect(d.toolCallCount).toBe(2)
  expect(d.tokensByModel['claude-opus-5']).toBe(500)
  expect(d.usageByModel['claude-opus-5']!.input).toBe(500)
  expect(d.hourCounts['11']).toBe(1)
  // A day before the boundary contributes nothing, even when it holds a denied session.
  expect(deniedDeltaByDay(all, shared, '2026-07-01')).toEqual({})
})

test('deniedDeltaByDay is empty when nothing is denied', () => {
  const all = storeSessions()
  expect(deniedDeltaByDay(all, all, '2026-06-23')).toEqual({})
})

test('advanceSeal seals a pending day once the watermark passes it, and never re-seals', () => {
  const pending = deniedDeltaByDay(storeSessions(), filterShared(storeSessions(), normalizeDenied(['github.com/o/secret'])), '2026-06-23')
  const first = advanceSeal({ sealed: {}, pending }, {}, '2026-06-26')
  expect(Object.keys(first.sealed)).toEqual(['2026-06-25'])
  expect(first.pending).toEqual({})
  // A second pass with a different value must not overwrite the sealed one.
  const tampered = { '2026-06-25': { ...pending['2026-06-25']!, sessionCount: 99 } }
  const second = advanceSeal({ sealed: first.sealed, pending: tampered }, {}, '2026-06-27')
  expect(second.sealed['2026-06-25']!.sessionCount).toBe(1)
})

test('advanceSeal leaves a still-decomposable day pending', () => {
  const pending = deniedDeltaByDay(storeSessions(), filterShared(storeSessions(), normalizeDenied(['github.com/o/secret'])), '2026-06-23')
  const out = advanceSeal({ sealed: {}, pending }, pending, '2026-06-23')
  expect(out.sealed).toEqual({})
  expect(Object.keys(out.pending)).toEqual(['2026-06-25'])
})

test('THE SEAL INVARIANT: a day keeps its denied volume withheld after the watermark passes it', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const pending = deniedDeltaByDay(all, shared, '2026-06-23')
  const { sealed } = advanceSeal({ sealed: {}, pending }, {}, '2026-06-26')

  // Claude has now rolled 2026-06-25 up: it appears in the rollup half with the FULL numbers.
  const rolled: StatsCache = {
    ...realCache(),
    lastComputedDate: '2026-06-25',
    totalSessions: 12, totalMessages: 109,
    hourCounts: { '8': 10, '9': 1, '11': 1 },
  }
  const out = buildSplitStatsCache({ real: rolled, allStored: all, shared, boundary: '2026-06-26', sealed })!

  const june = out.dailyActivity.find(d => d.date === '2026-06-25')!
  expect(june.sessionCount).toBe(1)          // 2 rolled up minus 1 sealed
  expect(june.messageCount).toBe(1)
  expect(june.toolCallCount).toBe(2)
  expect(out.dailyModelTokens.find(d => d.date === '2026-06-25')!.tokensByModel['claude-opus-5']).toBe(10)
  expect(out.totalSessions).toBe(11)         // 12 minus the sealed session
  expect(out.totalMessages).toBe(101)
  expect(out.hourCounts['11']).toBeUndefined() // the denied session's start hour is withheld
  expect(out.hourCounts['9']).toBe(1)
  expect(out.modelUsage['claude-opus-5']!.inputTokens).toBe(1010)
})

test('an unsealed prehistory day is emitted verbatim — absence of a seal never zeroes a row', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared, boundary: '2026-06-23', sealed: NO_SEAL })!
  expect(out.dailyActivity.find(d => d.date === '2026-02-06')!.sessionCount).toBe(10)
})

test('a seal larger than the rollup row clamps at 0 rather than going negative', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const huge: DeniedLedger = {
    '2026-02-06': {
      sessionCount: 999, messageCount: 999, toolCallCount: 999,
      tokensByModel: { 'claude-opus-5': 99999 },
      usageByModel: { 'claude-opus-5': { input: 99999, output: 0, cacheRead: 0, cacheWrite: 0 } },
      hourCounts: { '8': 999 },
    },
  }
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared, boundary: '2026-06-23', sealed: huge })!
  const feb = out.dailyActivity.find(d => d.date === '2026-02-06')!
  expect(feb.sessionCount).toBe(0)
  expect(feb.messageCount).toBe(0)
  expect(out.totalSessions).toBe(0)
  expect(out.hourCounts['8']).toBeUndefined()
  expect(out.modelUsage['claude-opus-5']!.inputTokens).toBe(10) // 1510 clamped to 0, minus 510, plus kept 10
})

test('THE CLAMP IS EXACT, not merely non-negative', () => {
  // real.modelUsage lags behind the store (5 < the 510 attributable). The prehistory term
  // clamps to 0 and the kept term must SURVIVE: max(0, 5-510) + 510 = 510, not 5.
  const lagging: StatsCache = {
    ...realCache(),
    modelUsage: { 'claude-opus-5': { inputTokens: 5, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 } },
  }
  const all = storeSessions()
  const out = buildSplitStatsCache({ real: lagging, allStored: all, shared: all, boundary: '2026-06-23', sealed: NO_SEAL })!
  expect(out.modelUsage['claude-opus-5']!.inputTokens).toBe(510)
})

test('a boundary of ‘’ means every day is decomposable', () => {
  const all = storeSessions()
  const shared = filterShared(all, normalizeDenied(['github.com/o/secret']))
  const gapFilledOnly: StatsCache = { ...realCache(), lastComputedDate: '', dailyActivity: [realCache().dailyActivity[1]!], dailyModelTokens: [realCache().dailyModelTokens[1]!], totalSessions: 0, totalMessages: 0, hourCounts: {} }
  const out = buildSplitStatsCache({ real: gapFilledOnly, allStored: all, shared, boundary: '', sealed: NO_SEAL })!
  expect(out.dailyActivity).toHaveLength(1)
  expect(out.dailyActivity[0]!.sessionCount).toBe(1)
})

test('buildSplitStatsCache refuses rather than shipping an unsplit cache', () => {
  const all = storeSessions()
  expect(buildSplitStatsCache({ real: null as unknown as StatsCache, allStored: all, shared: all, boundary: '2026-06-23', sealed: NO_SEAL })).toBeNull()
  // cold store against a populated cache
  expect(buildSplitStatsCache({ real: realCache(), allStored: [], shared: [], boundary: '2026-06-23', sealed: NO_SEAL })).toBeNull()
})

test('the split output carries no key outside the StatsCache shape', () => {
  const all = storeSessions()
  const out = buildSplitStatsCache({ real: realCache(), allStored: all, shared: all, boundary: '2026-06-23', sealed: NO_SEAL })!
  expect(Object.keys(out).sort()).toEqual(Object.keys(emptyStatsCache()).sort())
})

test('prehistoryCount counts the ROLLUP’s sessions, and is 0 when nothing is rolled up', () => {
  expect(prehistoryCount(realCache(), '2026-06-23')).toBe(10)
  expect(prehistoryCount(realCache(), '')).toBe(0)
})

test('deniedTouchesPrehistory ignores non-Claude sessions', () => {
  const denied = normalizeDenied(['github.com/o/secret'])
  const claudeOld = [s({ session_id: 'a', start_time: localAt('2026-02-06', 8), git_remote: 'github.com/o/secret' })]
  const codexOld = [s({ session_id: 'b', harness: 'codex', start_time: localAt('2026-02-06', 8), git_remote: 'github.com/o/secret' })]
  expect(deniedTouchesPrehistory(claudeOld, denied, '2026-06-23')).toBe(true)
  expect(deniedTouchesPrehistory(codexOld, denied, '2026-06-23')).toBe(false)
  expect(deniedTouchesPrehistory(claudeOld, normalizeDenied(['github.com/o/public']), '2026-06-23')).toBe(false)
  expect(deniedTouchesPrehistory(claudeOld, denied, '')).toBe(false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/server/server/share-rules.test.ts`
Expected: FAIL — `attributionBoundary` now receives a `StatsCache` and the seal functions do not exist.

- [ ] **Step 3: Replace the implementation**

In `packages/server/server/share-rules.ts`, delete `attributionBoundary`, `prehistoryCount`, `deniedTouchesPrehistory` and `buildSplitStatsCache` (keep `sumUsage` exactly as it is) and put in their place:

```ts
/** UTC day arithmetic on a YYYY-MM-DD string. '' for anything unparseable. */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * The first day whose cache rows are session-derived, and therefore decomposable by repository:
 * the day AFTER Claude's rollup watermark.
 *
 * Measured, not assumed: for every day at or before `lastComputedDate` the consolidate store is a
 * strict SUBSET of Claude's rollup (4 stored sessions against 9 rolled up on one real day; per-day
 * reconciliation matched 0 of 23 days), so those rows cannot be decomposed by anyone — including
 * this machine. Every later day is written by `supplementStatsCache` from the very session set this
 * module filters, so rebuilding it from `shared` is exact and the date-less subtraction reconciles
 * by construction.
 *
 * `''` means Claude has rolled up nothing, so the entire cache is gap-filled and EVERY day is
 * decomposable. It is not a refusal signal.
 */
export function attributionBoundary(real: StatsCache): string {
  const watermark = real?.lastComputedDate ?? ''
  return watermark ? nextDay(watermark) : ''
}

/** What the denylist excluded from one day, measured while that day was still decomposable. */
export interface DeniedDayDelta {
  sessionCount: number
  messageCount: number
  toolCallCount: number
  tokensByModel: Record<string, number>
  usageByModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
  hourCounts: Record<string, number>
}
export type DeniedLedger = Record<string, DeniedDayDelta>

/** Per-day denied contribution over the decomposable window (`day >= boundary`). Pure.
 *  Mirrors `accumulateClaudeSessions`'s gates exactly — harness, start_time, the `claude-` model
 *  id and the zero-token continue — so the two can be subtracted from each other. */
export function deniedDeltaByDay(
  allStored: readonly SessionMeta[],
  shared: readonly SessionMeta[],
  boundary: string,
): DeniedLedger {
  const keep = sharedSessionIds(shared)
  const out: DeniedLedger = {}
  for (const s of allStored) {
    if (!s.start_time) continue
    if ((s.harness ?? 'claude') !== 'claude') continue
    const day = s.start_time.slice(0, 10)
    if (boundary && day < boundary) continue
    if (!s.session_id || keep.has(s.session_id)) continue

    const d = out[day] ?? (out[day] = {
      sessionCount: 0, messageCount: 0, toolCallCount: 0,
      tokensByModel: {}, usageByModel: {}, hourCounts: {},
    })
    d.sessionCount += 1
    d.messageCount += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
    d.toolCallCount += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    const hour = new Date(s.start_time).getHours()
    if (Number.isFinite(hour)) {
      const k = String(hour)
      d.hourCounts[k] = (d.hourCounts[k] ?? 0) + 1
    }

    const model = s.model
    if (!model || !model.startsWith('claude-')) continue
    const inp = s.input_tokens ?? 0
    const outT = s.output_tokens ?? 0
    const cr = s.cache_read_input_tokens ?? 0
    const cw = s.cache_creation_input_tokens ?? 0
    if (inp + outT + cr + cw === 0) continue
    d.tokensByModel[model] = (d.tokensByModel[model] ?? 0) + inp + outT + cr + cw
    const u = d.usageByModel[model] ?? (d.usageByModel[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    u.input += inp; u.output += outT; u.cacheRead += cr; u.cacheWrite += cw
  }
  return out
}

/**
 * Advance the seal as Claude's watermark moves.
 *
 * A day filtered today joins the undecomposable rollup tomorrow, and the denied repository's volume
 * for it would silently start shipping. So the delta measured while the day was still decomposable
 * is sealed as it crosses, and subtracted from the rollup row forever after. A day already sealed is
 * never re-sealed — the first measurement was taken when the day was fully session-derived, and any
 * later one would be taken against a store that is now a subset.
 */
export function advanceSeal(
  prev: { sealed: DeniedLedger; pending: DeniedLedger },
  fresh: DeniedLedger,
  boundary: string,
): { sealed: DeniedLedger; pending: DeniedLedger } {
  const sealed: DeniedLedger = { ...(prev.sealed ?? {}) }
  for (const [day, delta] of Object.entries(prev.pending ?? {})) {
    if (boundary && day < boundary && !sealed[day]) sealed[day] = delta
  }
  return { sealed, pending: { ...fresh } }
}

/** Sessions Claude has already rolled up — the size of the block no rule can split. */
export function prehistoryCount(real: StatsCache, boundary: string): number {
  if (!boundary) return 0
  return (real?.dailyActivity ?? [])
    .filter(d => d.date < boundary)
    .reduce((a, d) => a + d.sessionCount, 0)
}

/** Does any DENIED repo have a stored CLAUDE session inside the rollup window? Drives the specific
 *  variant of the confirm copy. A false answer is not proof of absence — the store holds only a
 *  subset of that window — which is why the generic copy is always shown too. */
export function deniedTouchesPrehistory(
  allStored: readonly SessionMeta[],
  denied: ReadonlySet<RepoKey>,
  boundary: string,
  index?: PathRepoIndex,
): boolean {
  if (!boundary || denied.size === 0) return false
  for (const s of allStored) {
    if (!s.start_time || s.start_time.slice(0, 10) >= boundary) continue
    if ((s.harness ?? 'claude') !== 'claude') continue
    if (!sessionShared(s, denied, index)) return true
  }
  return false
}

/**
 * The cache a RESTRICTED connection pushes.
 *
 * Days `>= boundary` are rebuilt from `shared`. Earlier days are Claude's rollup row minus their
 * sealed delta, or verbatim when unsealed. `hourCounts`, `totalSessions` and `totalMessages` are
 * NOT gap-filled by `supplementStatsCache`, so they describe the rollup alone — they are reduced by
 * the seal and never gain a `kept` term. Every value is copied, summed or subtracted; nothing is
 * estimated, ratioed or prorated.
 */
export function buildSplitStatsCache(input: {
  real: StatsCache
  allStored: readonly SessionMeta[]
  shared: readonly SessionMeta[]
  boundary: string
  sealed: DeniedLedger
}): StatsCache | null {
  const { real, allStored, shared, boundary, sealed } = input
  if (!real) return null

  // Cold-store signature: a populated cache while the store yields no Claude session means the
  // store was not read, not that the machine did nothing. Push nothing rather than the unsplit cache.
  const realHasData = (real.dailyActivity?.length ?? 0) > 0 || (real.totalSessions ?? 0) > 0
  const storeHasClaude = allStored.some(s => !!s.start_time && (s.harness ?? 'claude') === 'claude')
  if (realHasData && !storeHasClaude) return null

  // boundary '' means Claude rolled up nothing, so NO day is prehistory.
  const isPrehistory = (day: string) => boundary !== '' && day < boundary
  const fromShared = buildSharedStatsCache(shared, { version: real.version })

  const out = emptyStatsCache()
  out.version = real.version
  out.lastComputedDate = real.lastComputedDate
  out.firstSessionDate = real.firstSessionDate
  out.totalSpeculationTimeSavedMs = real.totalSpeculationTimeSavedMs
  out.longestSession = { ...real.longestSession }

  // --- dailyActivity: rollup minus seal, then the rebuilt window ---
  const activity = (real.dailyActivity ?? [])
    .filter(d => isPrehistory(d.date))
    .map(d => {
      const seal = sealed?.[d.date]
      if (!seal) return { ...d }
      return {
        date: d.date,
        messageCount: Math.max(0, d.messageCount - seal.messageCount),
        sessionCount: Math.max(0, d.sessionCount - seal.sessionCount),
        toolCallCount: Math.max(0, d.toolCallCount - seal.toolCallCount),
      }
    })
  for (const d of fromShared.dailyActivity) if (!isPrehistory(d.date)) activity.push({ ...d })
  out.dailyActivity = activity.sort((a, b) => a.date.localeCompare(b.date))

  // --- dailyModelTokens: same three-way rule, per model ---
  const daily = (real.dailyModelTokens ?? [])
    .filter(d => isPrehistory(d.date))
    .map(d => {
      const seal = sealed?.[d.date]
      if (!seal) return { date: d.date, tokensByModel: { ...d.tokensByModel } }
      const tokensByModel: Record<string, number> = {}
      for (const [model, value] of Object.entries(d.tokensByModel)) {
        const left = Math.max(0, value - (seal.tokensByModel[model] ?? 0))
        if (left > 0) tokensByModel[model] = left
      }
      return { date: d.date, tokensByModel }
    })
  for (const d of fromShared.dailyModelTokens) if (!isPrehistory(d.date)) daily.push({ date: d.date, tokensByModel: { ...d.tokensByModel } })
  out.dailyModelTokens = daily.sort((a, b) => a.date.localeCompare(b.date))

  // --- modelUsage: real − sealed − attributable + kept, subtraction clamped ---
  const attributable = sumUsage(allStored, boundary)
  const kept = sumUsage(shared, boundary)
  const sealedUsage = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>()
  for (const delta of Object.values(sealed ?? {})) {
    for (const [model, u] of Object.entries(delta.usageByModel)) {
      const acc = sealedUsage.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      acc.input += u.input; acc.output += u.output; acc.cacheRead += u.cacheRead; acc.cacheWrite += u.cacheWrite
      sealedUsage.set(model, acc)
    }
  }

  const models = new Set([
    ...Object.keys(real.modelUsage ?? {}),
    ...attributable.totals.keys(),
    ...kept.totals.keys(),
    ...sealedUsage.keys(),
  ])
  for (const model of models) {
    const r = real.modelUsage?.[model]
    const a = attributable.totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const k = kept.totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const sl = sealedUsage.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const usage = {
      inputTokens: Math.max(0, (r?.inputTokens ?? 0) - sl.input - a.input) + k.input,
      outputTokens: Math.max(0, (r?.outputTokens ?? 0) - sl.output - a.output) + k.output,
      cacheReadInputTokens: Math.max(0, (r?.cacheReadInputTokens ?? 0) - sl.cacheRead - a.cacheRead) + k.cacheRead,
      cacheCreationInputTokens: Math.max(0, (r?.cacheCreationInputTokens ?? 0) - sl.cacheWrite - a.cacheWrite) + k.cacheWrite,
      webSearchRequests: 0,
      costUSD: 0,
    }
    if (usage.inputTokens || usage.outputTokens || usage.cacheReadInputTokens || usage.cacheCreationInputTokens) {
      out.modelUsage[model] = usage
    }
  }

  // --- rollup-only fields: reduced by the seal, never given a kept term ---
  let sealedSessions = 0
  let sealedMessages = 0
  const sealedHours = new Map<string, number>()
  for (const delta of Object.values(sealed ?? {})) {
    sealedSessions += delta.sessionCount
    sealedMessages += delta.messageCount
    for (const [h, c] of Object.entries(delta.hourCounts)) sealedHours.set(h, (sealedHours.get(h) ?? 0) + c)
  }
  out.totalSessions = Math.max(0, (real.totalSessions ?? 0) - sealedSessions)
  out.totalMessages = Math.max(0, (real.totalMessages ?? 0) - sealedMessages)
  for (const [h, c] of Object.entries(real.hourCounts ?? {})) {
    const left = Math.max(0, c - (sealedHours.get(h) ?? 0))
    if (left > 0) out.hourCounts[h] = left
  }

  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/server/server/share-rules.test.ts`
Expected: PASS.

The two tests that must never be weakened are `THE HEADLINE INVARIANT` (empty denylist ⇒ output deep-equals the real cache, no field excepted) and `THE SEAL INVARIANT` (a day stays filtered after the watermark passes it). If either fails, fix the implementation — if you believe the assertion itself is wrong, stop and report rather than adjusting it.

- [ ] **Step 5: Full suite and typecheck**

Run: `bun run stub && bun tsc --noEmit && bun test`
Expected: typecheck clean; the only test failures are the two pre-existing `lucide-react` ones.

- [ ] **Step 6: Commit**

```bash
git add packages/server/server/share-rules.ts packages/server/server/share-rules.test.ts
git commit --no-verify -m "fix(share-rules): split on Claude's watermark, and seal days as they cross"
```

## Done when

- `bun test` passes (bar the two pre-existing `lucide-react` failures) and `bun tsc --noEmit` is clean.
- `~/.agentistics/preferences.json` gains `team.connections[]` with one entry on first read, keeps its legacy flat mirror, and the dashboard still shows the same numbers.
- Nothing pushes differently yet: `share-rules.ts` has no caller outside its tests. Verify with `grep -rn "share-rules" packages --include=*.ts | grep -v test | grep -v "share-rules.ts:"` → only `data.ts` (the accumulator import).

## What comes next

- **Plan 2 — multi-central runtime:** per-connection state in `team-uploader.ts`, one WebSocket per connection, the connection routes, `/api/team/status`, the boot-time `migrateTeamStateOnce` (sent-state file rename + lossless v1→v2 hash conversion), the cross-process preferences lock, and the CLI.
- **Plan 3 — repo sharing:** `POST /api/team/forget` and `capabilities` on the central, the denylist wired into the push path, the removal sequence with its journal, and the Settings UI.

---

## Follow-ups booked out of the final review

Verified residuals from the whole-branch review and its fix wave. None blocks this branch — `share-rules.ts`
has no caller outside its tests yet — but the first is a privacy fail-open and must be closed **before Plan 2
wires the module into the push path**.

1. **Sub-day store shrinkage still fails open in `modelUsage`.** `buildSplitStatsCache` refuses when a
   non-prehistory day present in `real` has no session left in `allStored`, but shrinkage *within* a
   still-present day (some sessions lost, at least one remaining) leaves the day in `storeDays`, so the
   `attributable` term under-subtracts and a denied session's tokens ride out. The fix is as cheap as the
   day-level one: compare `real.dailyModelTokens[day]` against the `attributable` totals for that day and
   refuse on a mismatch. **Do this in Plan 2's first task, before the uploader calls the module.**

2. **Spec §5.8's legacy-team merge is only half implemented.** `mergeTeamPayload` preserves the stored
   `connections` when an incoming `team` payload omits the key — which is what stopped C1's data loss — but
   §5.8 also requires matching the payload's `endpoint` into `connections[]` and merging it (preserving `id`
   and `deniedRepos`), never blanking a stored token, and returning `409` when `connections.length > 1`.
   Today a legacy single-connection edit is a silent no-op. Safe direction, but the route contract in §5.8 is
   not met. Land it with the connection routes in Plan 2.
   Related: a payload carrying an explicit `connections: undefined` takes the replace branch. Unreachable over
   `PUT /api/preferences` (JSON drops undefined) but reachable in-process; tighten when the routes land.

3. **The TZ-restoring test breaks on non-whole-hour zones.** `share-rules.test.ts`'s local-clock test restores
   the ambient zone as `Etc/GMT±h`, which is invalid for offsets of :30 or :45 (India, Nepal, Adelaide) — the
   runtime falls back to UTC and the test's own offset assertion fails, so the suite-wide leak it exists to
   prevent happens anyway, loudly. It also erases DST for the rest of the run on a DST zone. Benign on a UTC
   or UTC−3 machine; fix if CI ever runs elsewhere.

4. **Two leftovers from the minors sweep.** `cli-start.ts`'s `loadState()` still swallows a corrupt
   preferences file into `mode: 'solo'` — the exact lie that was converted to an explicit exit in
   `cli-status.ts`, so the two are now inconsistent. And `ConnectionSettings.tsx` / `MachinesSettings.tsx`
   replaced `{ ...DEFAULT_TEAM }` with a module-level `defaultTeam()` const that is still spread on every
   render, so the aliased-array hazard survives in web; §3.5 wants those duplicates deleted in favour of
   `readTeamConnections`.
