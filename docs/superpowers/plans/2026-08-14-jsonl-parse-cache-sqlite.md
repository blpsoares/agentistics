# JSONL Parse Cache (SQLite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop re-parsing every Claude transcript on every build by caching the *derived* result of each JSONL parse in a local SQLite database keyed by `(path, mtimeMs, size)`.

**Architecture:** A new SQLite file at `~/.agentistics/cache.db` holds one row per *slot* — a `(kind, path, variant)` triple — carrying the file version the row was derived from and the derived value as a JSON blob. A build `stat()`s each transcript (cheap) and reuses the row when the version matches; on a miss it parses as it does today and writes the row back. The cache is **derived state only**: deleting the file must cost nothing but time. The key arithmetic lives in a pure, tested module; the SQLite IO lives in a separate module that degrades to a no-op cache when the database cannot be opened.

**Tech Stack:** Bun, `bun:sqlite` (a Bun builtin — no new dependency, and already used read-only by `adapters/antigravity.ts`), TypeScript, `bun:test`.

## Global Constraints

- **Everything in this project is in English**: code, comments, commit messages, PR titles and descriptions, documentation.
- Commits follow **Conventional Commits** (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `perf:`).
  commitlint runs on `commit-msg` and REJECTS a subject whose first character is uppercase
  (`subject-case`: no sentence-case/start-case/pascal-case/upper-case). Start the subject in
  lowercase — `feat(cache): sqlite-backed store`, never `feat(cache): SQLite-backed store`.
- **The cache is never a source of truth.** Every value in it must be recomputable from the file it was derived from. Deleting `~/.agentistics/cache.db` may only ever cost one slow build.
- **`packages/server/server/` modules are server-only** — never import them from `packages/web/src/`.
- **Pure logic goes in its own module and is tested**; IO modules stay thin and never throw.
- **`bun:sqlite` must be imported dynamically** (`await import('bun:sqlite')`), matching `adapters/antigravity.ts:59`, so a non-Bun runtime degrades instead of crashing at import time.
- Work in an isolated worktree on a branch based on `origin/dev` (see CLAUDE.md § "Concurrent work"). A fresh worktree needs `bun install` plus `bun run packages/server/scripts/ensure-type-stub.ts`.
- Pre-commit hooks run `bun tsc --noEmit` + `bun test`. Both must pass before every commit.

## Baseline (measured 2026-08-14, before any change)

| | |
|---|---|
| JSONL in `~/.claude/projects` | 815 files / 318 MB |
| JSONL in `~/.agentistics/archive` | 284 files / 98 MB |
| `buildApiResponse()` cold | **19,668 ms**, peak RSS 320 MB, 277 sessions / 53 projects |
| `loadConsolidated()` | 97 ms (277 files) — *not* the bottleneck |
| `CACHE_TTL_MS` (`data.ts:472`) | 30 s — a full rebuild runs in the background every 30 s |

**Acceptance target:** a warm build (cache populated, no transcript changed) completes in
**under 25% of the cold time** and reports the **same content** as the cold build.

Two corrections to how this is measured, both learned the hard way during execution:

1. **Measure against a FROZEN snapshot of `~/.claude`, never the live directory.** This machine
   runs assistant sessions that append to their transcripts continuously; two sequential builds
   over the live directory legitimately disagree, and the difference is the machine working, not
   the cache misbehaving. Copy `projects/`, `usage-data/` and `stats-cache.json` to a temp dir,
   then run both builds with `CLAUDE_DIR=<snapshot> AGENTISTICS_DIR=<fresh temp>
   AGENTISTICS_ARCHIVE=0`.
2. **Compare CONTENT, not bytes.** A `JSON.stringify`-identical payload is not achievable and never
   was: `scanProjectDir` collects sessions inside `Promise.all` over concurrent IO, so the ORDER of
   the `sessions` and `projects` arrays was already nondeterministic before this cache existed —
   the cache only changes the timing that decides the interleaving. Additionally, a cached session
   round-trips through JSON, so its object keys come back in serialized order rather than
   construction order: same values, different `stringify`. Measured over a frozen snapshot,
   188/188 sessions were content-identical with only array order differing. The gate is therefore:
   same session ids, and every session's canonical (recursively key-sorted) form equal, keyed by
   `session_id`. `sdd/cmp.py` in the worktree is the reference implementation.

## Platform support

The release ships **linux/x64** (`agentop`) and **win32/x64** (`agentop.exe`); macOS has
no published binary and runs from source under Bun (`resolveUpgradeAsset`,
`upgrade.ts:50-55`). All three must work.

`bun:sqlite` is a Bun builtin on all three platforms, so this adds no dependency and
nothing to install. Verified on Linux with Bun 1.3.14: WAL mode engages, the
`ON CONFLICT DO UPDATE` upsert keeps one row, and `.run()` returns
`{changes, lastInsertRowid}`. The plan does not rely on that return shape anyway — `gc`
counts by difference, precisely because it has moved between versions.

Platform-specific things this plan deliberately handles:

- **Windows file locking is mandatory, not advisory.** A file another process holds
  open cannot be deleted. Nothing in the product path deletes `cache.db` — `gc` deletes
  ROWS — but the dev scripts do, so `bench-build.ts` must be run with no agentop server
  running. On POSIX the same delete succeeds silently and the running process keeps
  writing to an unlinked inode, which is a *worse* failure because it looks like it
  worked.
- **Two processes, one database.** The server and the otel-watcher both run as
  `agentop`, and `docker-compose.machine.yml` can put a container on the same
  `~/.agentistics` as a native process — a state the control center already reports as
  a `conflict`. WAL allows concurrent readers with one writer; anything it refuses
  surfaces as `SQLITE_BUSY`, which every method in `parse-cache.ts` catches and reports
  as a MISS. Degraded, never wrong.
- **Network and translated filesystems.** SQLite locking is unreliable over SMB/NFS and
  over WSL's `/mnt/c` (drvfs). `~/.agentistics` is in the native filesystem by default,
  so this only bites if `AGENTISTICS_DIR` is pointed at one — where a failed open falls
  back to `NOOP_PARSE_CACHE` and the build stays correct and slow. Worth knowing that a
  database turns what used to be a preference into a real constraint.
- **mtime granularity.** ext4, APFS and NTFS all resolve finer than the 1 ms this plan
  truncates to. FAT32/exFAT resolves to 2 seconds — a removable drive. The `size` half
  of the key covers it unless a file is rewritten to the same byte length inside the
  same 2 s window, which append-only transcripts never do.

**The shell in the verification steps is POSIX.** Steps using `PROBE=`, `&`, `sleep` and
`kill %1` are written for bash/zsh; on Windows run them from WSL or Git Bash. The two
gates that matter — `bun test` and `bun packages/server/scripts/bench-build.ts` — need
no shell at all (`bench-build.ts` uses `Bun.spawnSync` with an argv, not a command
string) and run natively on all three platforms.

## File Structure

**Created:**
- `packages/server/server/parse-cache-key.ts` — PURE. The key arithmetic: `FileStamp`, `ParseCacheKind`, `cacheKey()`, `cacheSlot()`. No IO, no imports beyond types.
- `packages/server/server/parse-cache-key.test.ts` — tests for the above.
- `packages/server/server/parse-cache.ts` — IO. Opens the SQLite file, `get`/`set`/`touch`/`stats`/`close`, GC of vanished files, and the no-op fallback. Never throws.
- `packages/server/server/parse-cache.test.ts` — tests against a temp database file.
- `packages/server/server/parse-cache-jsonl.ts` — the two cached wrappers that bridge the cache to the existing parsers: `cachedParseSession()` and `cachedEnrich()`. Depends on `jsonl.ts`, `agent-metrics.ts`, `parse-cache.ts`.
- `packages/server/server/parse-cache-jsonl.test.ts` — equivalence tests (cached result === uncached result) using real fixture transcripts.
- `packages/server/scripts/bench-build.ts` — measures cold vs warm `buildApiResponse()`.

**Modified:**
- `packages/server/server/config.ts` — add `PARSE_CACHE_FILE` and `PARSE_CACHE_ENABLED` next to the other `AGENTISTICS_DATA_DIR` constants (after line 70).
- `packages/server/server/data.ts` — thread a `ParseCache` through `scanProjects` (`:395`) → `scanProjectDir` (`:157`), and route the three hot parses (`:207`, `:214-250`, `:305`) through the wrappers.
- `CLAUDE.md` — the rules the cache introduces.
- `docs/architecture.md` — a short section describing the cache.

**Explicitly out of scope (do not implement):**
- Workflow discovery (`data.ts:272-285`) reads the main transcript too, but `extractWorkflowRuns` also reads a whole directory whose contents are part of the derivation — a correct key needs that directory's listing, which is a different problem. It fires only for sessions that have a `subagents/workflows/` dir. Leave it.
- The consolidate store (`consolidate.ts`) stays on JSON files. It loads in 97 ms; moving it buys nothing and is a separate decision.

---

### Task 1: The pure key module

**Files:**
- Create: `packages/server/server/parse-cache-key.ts`
- Test: `packages/server/server/parse-cache-key.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ParseCacheKind = 'session' | 'enrich'`
  - `interface FileStamp { path: string; mtimeMs: number; size: number }`
  - `function cacheSlot(kind: ParseCacheKind, path: string, variant?: string): string`
  - `function cacheKey(stamp: FileStamp): string`

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/parse-cache-key.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { cacheKey, cacheSlot, type FileStamp } from './parse-cache-key'

const stamp = (over: Partial<FileStamp> = {}): FileStamp => ({
  path: '/home/u/.claude/projects/-home-u-app/abc.jsonl',
  mtimeMs: 1_700_000_000_123,
  size: 4096,
  ...over,
})

describe('cacheSlot', () => {
  test('one slot per (kind, path, variant)', () => {
    expect(cacheSlot('session', '/a.jsonl')).toBe(cacheSlot('session', '/a.jsonl'))
  })

  test('the kind is part of the identity', () => {
    expect(cacheSlot('session', '/a.jsonl')).not.toBe(cacheSlot('enrich', '/a.jsonl'))
  })

  test('the variant is part of the identity', () => {
    // Two derivations of ONE file that differ by something outside the file's
    // bytes (the model id agent-metrics prices against) must not share a row.
    expect(cacheSlot('enrich', '/a.jsonl', 'claude-opus-4-6'))
      .not.toBe(cacheSlot('enrich', '/a.jsonl', 'claude-sonnet-4-6'))
  })

  test('an absent variant is the empty variant', () => {
    expect(cacheSlot('enrich', '/a.jsonl')).toBe(cacheSlot('enrich', '/a.jsonl', ''))
  })

  test('the separator cannot be forged out of a path and a variant', () => {
    // The failing case for ANY separator character: with a space, both of these
    // flatten to "session /a.jsonl b c" and two different files would share one row.
    // JSON array encoding quotes and escapes every field, so no crafted path — a
    // Windows "C:\\Users\\..." included — can reach across a field boundary.
    expect(cacheSlot('session', '/a.jsonl', 'b c')).not.toBe(cacheSlot('session', '/a.jsonl b', 'c'))
  })
})

describe('cacheKey', () => {
  test('the same file version yields the same key', () => {
    expect(cacheKey(stamp())).toBe(cacheKey(stamp()))
  })

  test('a changed mtime is a new version', () => {
    expect(cacheKey(stamp())).not.toBe(cacheKey(stamp({ mtimeMs: 1_700_000_000_124 })))
  })

  test('a changed size is a new version', () => {
    // Appending to a live transcript changes BOTH, but size alone must be enough:
    // a filesystem with coarse mtime granularity would otherwise serve stale bytes.
    expect(cacheKey(stamp())).not.toBe(cacheKey(stamp({ size: 4097 })))
  })

  test('sub-millisecond mtime jitter does not invent versions', () => {
    // stat() reports mtimeMs as a float. Two stats of one untouched file can differ
    // in the fraction, which would miss on every build and defeat the whole cache.
    expect(cacheKey(stamp({ mtimeMs: 1_700_000_000_123.4 })))
      .toBe(cacheKey(stamp({ mtimeMs: 1_700_000_000_123.9 })))
  })

  test('the key does not carry the path', () => {
    // The path already lives in the slot, which is the primary key. Repeating it
    // in the version column doubles the stored bytes for no added discrimination.
    expect(cacheKey(stamp())).toBe(cacheKey(stamp({ path: '/somewhere/else.jsonl' })))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/parse-cache-key.test.ts`
Expected: FAIL — `Cannot find module './parse-cache-key'`

- [ ] **Step 3: Write the implementation**

Create `packages/server/server/parse-cache-key.ts`:

```ts
/**
 * The key arithmetic for the JSONL parse cache. PURE — no IO, no SQLite.
 *
 * Two identities, deliberately separate:
 *
 *   SLOT — WHICH derivation of WHICH file this row holds: (kind, path, variant).
 *          It is the table's primary key, so the store holds exactly ONE row per
 *          slot and cannot grow with every append to a live transcript.
 *
 *   KEY  — WHICH VERSION of that file the row was derived from: (mtime, size).
 *          A hit requires the stored key to equal the current file's key.
 *
 * `variant` exists because a derivation may depend on something beyond the file's
 * bytes — `extractAgentMetrics` prices against a model id supplied by the CALLER.
 * Anything outside the file that changes the result MUST go in the variant, or two
 * callers silently poison each other's row.
 */

/** What kind of derived value a row holds. Part of the slot, so two derivations
 *  of one file never collide. */
export type ParseCacheKind = 'session' | 'enrich'

/** The identity of a file VERSION, as `stat()` reports it. */
export interface FileStamp {
  /** Absolute path of the source file. */
  path: string
  /** Modification time in milliseconds (may carry a fraction — see cacheKey). */
  mtimeMs: number
  /** Size in bytes. */
  size: number
}

/**
 * The row's identity, independent of the file's version.
 *
 * Encoded as a JSON ARRAY, not joined with a separator character. Any separator can be
 * forged: with a space, cacheSlot('session', '/a.jsonl', 'b c') and
 * cacheSlot('session', '/a.jsonl b', 'c') collapse to one string and two different
 * files share a row. A NUL cannot appear in a POSIX path and would also work, but it
 * then has to survive `sqlite3_bind_text` intact — a binding that measured the string
 * with strlen() would truncate the slot at its first field and silently merge every
 * row. (It does survive in bun:sqlite 1.3.14, verified; this encoding makes the
 * question moot rather than betting on it staying true.)
 *
 * JSON also keeps the column READABLE in any SQLite browser, which is most of what a
 * plain JSON file gives up when a cache like this replaces one. Windows paths
 * ("C:\\Users\\...") are escaped by JSON.stringify like any other string.
 */
export function cacheSlot(kind: ParseCacheKind, path: string, variant = ''): string {
  return JSON.stringify([kind, path, variant])
}

/**
 * The file VERSION a row was derived from.
 *
 * `mtimeMs` is TRUNCATED to whole milliseconds: `stat()` reports it as a float and
 * two stats of one untouched file can disagree in the fraction, which would miss on
 * every build and defeat the cache entirely.
 *
 * Size is carried alongside mtime because mtime granularity is a filesystem
 * property, not a guarantee — on a coarse clock two different contents can share a
 * timestamp. The residual risk is a file rewritten to the SAME byte length inside
 * the same millisecond; for append-only transcripts that cannot happen, and the
 * cost of being wrong is a stale metric until the next write, never lost data.
 *
 * The path is NOT part of the key — it is already the slot, and repeating it here
 * would double the stored bytes for no added discrimination.
 */
export function cacheKey(stamp: FileStamp): string {
  return `${Math.trunc(stamp.mtimeMs)}:${stamp.size}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/parse-cache-key.test.ts`
Expected: PASS — 10 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/parse-cache-key.ts packages/server/server/parse-cache-key.test.ts
git commit -m "feat(cache): pure key arithmetic for the JSONL parse cache"
```

---

### Task 2: The SQLite store

**Files:**
- Create: `packages/server/server/parse-cache.ts`
- Create: `packages/server/server/parse-cache.test.ts`
- Modify: `packages/server/server/config.ts` (append after line 70, the `MANAGED_SESSIONS_FILE` line)

**Interfaces:**
- Consumes: `cacheSlot`, `cacheKey`, `ParseCacheKind`, `FileStamp` from Task 1.
- Produces:
  - `interface ParseCache { get<T>(kind, stamp, variant?): T | null; set(kind, stamp, value, variant?): void; flush(): void; gc(cutoffMs: number): number; stats(): ParseCacheStats; rowCount(): number; close(): void }` — **no test-only members**
  - `interface ParseCacheStats { hits: number; misses: number; writes: number }`
  - `function openParseCache(file?: string, now?: () => number): Promise<ParseCache>`
  - `const NOOP_PARSE_CACHE: ParseCache`
  - `const PARSE_CACHE_FILE: string`, `const PARSE_CACHE_ENABLED: boolean` (from `config.ts`)

- [ ] **Step 1: Add the config constants**

In `packages/server/server/config.ts`, immediately after the `MANAGED_SESSIONS_FILE` line (line 70), add:

```ts
// Derived-value cache for JSONL parses: <data dir>/cache.db (SQLite).
// DERIVED STATE ONLY — every row is recomputable from the file it names, so deleting
// this file may only ever cost one slow build. Never store anything here that is not
// also on disk somewhere else.
export const PARSE_CACHE_FILE = process.env.AGENTISTICS_PARSE_CACHE_FILE ?? join(AGENTISTICS_DATA_DIR, 'cache.db')
export const PARSE_CACHE_ENABLED = process.env.AGENTISTICS_PARSE_CACHE !== '0'
```

- [ ] **Step 2: Write the failing test**

Create `packages/server/server/parse-cache.test.ts`:

```ts
import { describe, expect, test, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { openParseCache, NOOP_PARSE_CACHE, type ParseCache } from './parse-cache'
import { cacheSlot, type FileStamp } from './parse-cache-key'

const dirs: string[] = []
async function tempDb(name = 'cache.db'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentistics-parse-cache-'))
  dirs.push(dir)
  return join(dir, name)
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})

const stamp = (over: Partial<FileStamp> = {}): FileStamp => ({
  path: '/transcripts/abc.jsonl',
  mtimeMs: 1_700_000_000_000,
  size: 100,
  ...over,
})

describe('openParseCache', () => {
  test('a miss returns null and is counted', async () => {
    const c = await openParseCache(await tempDb())
    expect(c.get('session', stamp())).toBeNull()
    expect(c.stats()).toEqual({ hits: 0, misses: 1, writes: 0 })
    c.close()
  })

  test('what was written is read back, structurally intact', async () => {
    const c = await openParseCache(await tempDb())
    const value = { session_id: 'abc', tokens: 42, tools: { Read: 3 }, langs: ['ts'] }
    c.set('session', stamp(), value)
    expect(c.get('session', stamp())).toEqual(value)
    expect(c.stats()).toEqual({ hits: 1, misses: 0, writes: 1 })
    c.close()
  })

  test('a changed file version misses', async () => {
    const c = await openParseCache(await tempDb())
    c.set('session', stamp(), { v: 1 })
    expect(c.get('session', stamp({ size: 101 }))).toBeNull()
    expect(c.get('session', stamp({ mtimeMs: 1_700_000_000_001 }))).toBeNull()
    c.close()
  })

  test('a new version REPLACES the old row rather than joining it', async () => {
    // A live transcript is appended to constantly. One row per slot is what stops
    // the database growing without bound over a machine's lifetime.
    const c = await openParseCache(await tempDb())
    c.set('session', stamp({ size: 100 }), { v: 1 })
    c.set('session', stamp({ size: 200 }), { v: 2 })
    c.set('session', stamp({ size: 300 }), { v: 3 })
    expect(c.rowCount()).toBe(1)
    expect(c.get('session', stamp({ size: 300 }))).toEqual({ v: 3 })
    expect(c.get('session', stamp({ size: 100 }))).toBeNull()
    c.close()
  })

  test('kind and variant do not share a row', async () => {
    const c = await openParseCache(await tempDb())
    c.set('session', stamp(), { which: 'session' })
    c.set('enrich', stamp(), { which: 'enrich' })
    c.set('enrich', stamp(), { which: 'enrich-opus' }, 'claude-opus-4-6')
    expect(c.get('session', stamp())).toEqual({ which: 'session' })
    expect(c.get('enrich', stamp())).toEqual({ which: 'enrich' })
    expect(c.get('enrich', stamp(), 'claude-opus-4-6')).toEqual({ which: 'enrich-opus' })
    expect(c.rowCount()).toBe(3)
    c.close()
  })

  test('rows survive a close and reopen', async () => {
    const file = await tempDb()
    const a = await openParseCache(file)
    a.set('session', stamp(), { v: 1 })
    a.flush()
    a.close()
    const b = await openParseCache(file)
    expect(b.get('session', stamp())).toEqual({ v: 1 })
    b.close()
  })

  test('a database that cannot be opened degrades to a no-op, never a throw', async () => {
    // An unwritable path is an ordinary outcome: a read-only container, a full disk,
    // a home directory the process does not own. The build must still complete.
    // A path whose PARENT is a regular file fails with ENOTDIR on every platform —
    // deterministic, unlike relying on /proc permissions.
    const dir = await mkdtemp(join(tmpdir(), 'agentistics-parse-cache-'))
    dirs.push(dir)
    const blocker = join(dir, 'not-a-dir')
    await writeFile(blocker, 'x')

    const c = await openParseCache(join(blocker, 'cache.db'))
    expect(c.get('session', stamp())).toBeNull()
    expect(() => c.set('session', stamp(), { v: 1 })).not.toThrow()
    expect(c.get('session', stamp())).toBeNull()
    expect(c.rowCount()).toBe(0)
    expect(() => c.close()).not.toThrow()
  })

  test('gc drops rows untouched since the cutoff and keeps the rest', async () => {
    // The clock is INJECTED: with Date.now() both writes land in the same millisecond
    // on a fast machine, so any cutoff either keeps both rows or drops both, and the
    // test passes or fails by timing rather than by behaviour.
    let clock = 1_000_000
    const c = await openParseCache(await tempDb(), () => clock)

    c.set('session', stamp({ path: '/gone.jsonl' }), { v: 1 })
    c.flush()

    // A later build reads /live.jsonl and never sees /gone.jsonl again.
    clock += 10_000
    c.set('session', stamp({ path: '/live.jsonl' }), { v: 2 })
    c.get('session', stamp({ path: '/live.jsonl' }))
    c.flush()

    expect(c.gc(clock - 5_000)).toBe(1)
    expect(c.get('session', stamp({ path: '/live.jsonl' }))).toEqual({ v: 2 })
    expect(c.get('session', stamp({ path: '/gone.jsonl' }))).toBeNull()
    c.close()
  })

  test('flush keeps a row that is always hit and never rewritten', async () => {
    // Without the batched touch, a transcript that never changes ages out on `used`
    // and is reparsed — the exact file the cache exists to stop reparsing.
    let clock = 1_000_000
    const c = await openParseCache(await tempDb(), () => clock)
    c.set('session', stamp(), { v: 1 })
    c.flush()

    clock += 60_000
    expect(c.get('session', stamp())).toEqual({ v: 1 })
    c.flush()

    expect(c.gc(clock - 1_000)).toBe(0)
    expect(c.get('session', stamp())).toEqual({ v: 1 })
    c.close()
  })

  test('a Windows path survives the round trip through SQLite', async () => {
    // The slot is the PRIMARY KEY, so whatever the driver does to the string on the
    // way in is what identity means. Backslashes, a drive letter and a space are the
    // three things a naive encoding mangles, and this repo ships an agentop.exe.
    const c = await openParseCache(await tempDb())
    const win = stamp({ path: 'C:\\Users\\Ana Paula\\.claude\\projects\\p\\s.jsonl' })
    c.set('session', win, { v: 'win' })
    expect(c.get('session', win)).toEqual({ v: 'win' })
    expect(c.get('session', stamp({ path: 'C:\\Users\\Ana' }))).toBeNull()
    expect(c.rowCount()).toBe(1)
    c.close()
  })

  test('a corrupt value is a miss, not a crash', async () => {
    // The blob is JSON written by an older build. A shape change or a truncated
    // write must degrade to "recompute it", exactly like an absent row.
    //
    // The bad blob is planted through a SEPARATE connection rather than through a
    // test-only method on ParseCache: production code must not carry an affordance
    // only tests use, and this row is exactly what a half-finished write would leave.
    const file = await tempDb()
    const c = await openParseCache(file)
    c.set('session', stamp(), { v: 1 })
    c.flush()

    const { Database } = await import('bun:sqlite')
    const raw = new Database(file)
    raw.query('UPDATE parse_cache SET value = ? WHERE slot = ?')
      .run('{not json', cacheSlot('session', stamp().path))
    raw.close()

    expect(c.get('session', stamp())).toBeNull()
    c.close()
  })
})

describe('NOOP_PARSE_CACHE', () => {
  test('never stores and never throws', () => {
    const c: ParseCache = NOOP_PARSE_CACHE
    c.set('session', stamp(), { v: 1 })
    expect(c.get('session', stamp())).toBeNull()
    expect(() => { c.flush(); c.close() }).not.toThrow()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/server/server/parse-cache.test.ts`
Expected: FAIL — `Cannot find module './parse-cache'`

- [ ] **Step 4: Write the implementation**

Create `packages/server/server/parse-cache.ts`:

```ts
import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import { PARSE_CACHE_FILE } from './config'
import { cacheKey, cacheSlot, type FileStamp, type ParseCacheKind } from './parse-cache-key'

export interface ParseCacheStats {
  hits: number
  misses: number
  writes: number
}

export interface ParseCache {
  /** The cached derivation of THIS version of the file, or null to recompute. */
  get<T>(kind: ParseCacheKind, stamp: FileStamp, variant?: string): T | null
  /** Store a derivation, replacing any earlier version of the same slot. */
  set(kind: ParseCacheKind, stamp: FileStamp, value: unknown, variant?: string): void
  /** Mark every slot READ this build as live, in one statement. Call once per build,
   *  before gc — without it, a row that is always hit and never rewritten ages out. */
  flush(): void
  /** Drop rows untouched since `cutoffMs`. Returns how many were dropped. */
  gc(cutoffMs: number): number
  stats(): ParseCacheStats
  /** Row count — used by gc() to report what it dropped, and by diagnostics. */
  rowCount(): number
  close(): void
}

/** The cache that is not there. Returned whenever the database cannot be opened, and
 *  used by callers that deliberately bypass it. Every method is a safe nothing. */
export const NOOP_PARSE_CACHE: ParseCache = {
  get: () => null,
  set: () => {},
  flush: () => {},
  gc: () => 0,
  stats: () => ({ hits: 0, misses: 0, writes: 0 }),
  rowCount: () => 0,
  close: () => {},
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS parse_cache (
  slot  TEXT PRIMARY KEY,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  used  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS parse_cache_used ON parse_cache(used);
`

/**
 * Open the parse cache, creating it if needed.
 *
 * EVERY failure path returns NOOP_PARSE_CACHE rather than throwing: an unwritable
 * home directory, a read-only container, a corrupt database and a non-Bun runtime are
 * all ordinary outcomes here, and none of them may stop a build. The cost of the
 * fallback is exactly the time this cache was meant to save — never a wrong number,
 * because every value in it is recomputable from the file it names.
 */
export async function openParseCache(
  file: string = PARSE_CACHE_FILE,
  /** Injected so gc/flush behaviour is testable without sleeping. Production passes none. */
  now: () => number = Date.now,
): Promise<ParseCache> {
  let db: any
  let selectStmt: any, upsertStmt: any, touchStmt: any, countStmt: any, gcStmt: any
  try {
    await mkdir(dirname(file), { recursive: true })
    // Dynamic import so a non-Bun runtime degrades instead of crashing at import time
    // (same guard as adapters/antigravity.ts).
    const { Database } = await import('bun:sqlite')
    db = new Database(file, { create: true })
    // WAL: the server and the otel-watcher are separate processes over one file, and
    // a reader must not block behind a writer holding the whole database.
    db.exec('PRAGMA journal_mode = WAL')
    // NORMAL is the right durability for derived state — a row lost to a power cut is
    // one file reparsed, and FULL would fsync on every transcript we cache.
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec(SCHEMA)

    // Statement preparation MUST stay inside this try. `db.query()` COMPILES the statement
    // immediately, and `CREATE TABLE IF NOT EXISTS` matches on the table NAME only — it does
    // not validate columns. So a cache.db whose `parse_cache` exists with a drifted schema
    // sails through exec(SCHEMA) and then throws here, rejecting the promise (which stops the
    // build) and leaking the open handle. Found by review, reproduced as
    // "table parse_cache has no column named used".
    selectStmt = db.query('SELECT key, value FROM parse_cache WHERE slot = ?')
    upsertStmt = db.query(
      'INSERT INTO parse_cache (slot, key, value, used) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(slot) DO UPDATE SET key = excluded.key, value = excluded.value, used = excluded.used'
    )
    touchStmt = db.query('UPDATE parse_cache SET used = ? WHERE slot = ?')
    countStmt = db.query('SELECT COUNT(*) AS n FROM parse_cache')
    gcStmt = db.query('DELETE FROM parse_cache WHERE used < ?')
  } catch {
    try { db?.close() } catch { /* already gone */ }
    return NOOP_PARSE_CACHE
  }

  const stats: ParseCacheStats = { hits: 0, misses: 0, writes: 0 }
  // Slots READ this build. Touched in one transaction by flush() so a row that is
  // always hit and never rewritten does not age out under gc().
  const readSlots = new Set<string>()

  const store: ParseCache = {
    get<T>(kind: ParseCacheKind, stamp: FileStamp, variant = ''): T | null {
      const slot = cacheSlot(kind, stamp.path, variant)
      try {
        const row = selectStmt.get(slot) as { key: string; value: string } | null
        if (!row || row.key !== cacheKey(stamp)) { stats.misses++; return null }
        // A blob written by an older build may no longer parse or may no longer hold
        // the shape the caller expects. Both are a miss — recompute, never crash.
        const parsed = JSON.parse(row.value) as T
        readSlots.add(slot)
        stats.hits++
        return parsed
      } catch {
        stats.misses++
        return null
      }
    },

    set(kind: ParseCacheKind, stamp: FileStamp, value: unknown, variant = ''): void {
      try {
        const slot = cacheSlot(kind, stamp.path, variant)
        upsertStmt.run(slot, cacheKey(stamp), JSON.stringify(value), now())
        readSlots.add(slot)
        stats.writes++
      } catch { /* a cache that cannot store is still a correct cache */ }
    },

    flush(): void {
      if (readSlots.size === 0) return
      try {
        const at = now()
        const slots = [...readSlots]
        readSlots.clear()
        db.transaction(() => { for (const s of slots) touchStmt.run(at, s) })()
      } catch { /* the touch is an optimisation; losing it costs one reparse */ }
    },

    gc(cutoffMs: number): number {
      // Counted by difference rather than read off `run().changes`: the shape of that
      // return has moved between bun:sqlite versions, and a gc that silently reports 0
      // is indistinguishable from one that is not running at all.
      try {
        const before = store.rowCount()
        gcStmt.run(cutoffMs)
        return before - store.rowCount()
      } catch { return 0 }
    },

    stats: () => ({ ...stats }),

    rowCount(): number {
      try { return Number((countStmt.get() as { n: number } | null)?.n ?? 0) } catch { return 0 }
    },

    close(): void {
      try { store.flush(); db.close() } catch { /* already gone */ }
    },
  }

  return store
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/server/server/parse-cache.test.ts`
Expected: PASS — 11 tests pass

- [ ] **Step 6: Verify the whole suite and types still pass**

Run: `bun tsc --noEmit && bun test`
Expected: no type errors; no previously-passing test now fails.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/parse-cache.ts packages/server/server/parse-cache.test.ts packages/server/server/config.ts
git commit -m "feat(cache): sqlite-backed derived-value store for JSONL parses"
```

---

### Task 3: Cache full session parses

**Files:**
- Create: `packages/server/server/parse-cache-jsonl.ts`
- Create: `packages/server/server/parse-cache-jsonl.test.ts`
- Modify: `packages/server/server/data.ts` — `scanProjectDir` signature (`:157-163`), the Format A parse (`:207`), the Format B parse (`:305`), `scanProjects` signature (`:395-400`), the `scanProjectDir` call (`:421`), and the `scanProjects` call (`:716-720`)

**Interfaces:**
- Consumes: `ParseCache`, `NOOP_PARSE_CACHE`, `openParseCache` from Task 2; `parseSessionJsonl` from `./jsonl`.
- Produces:
  - `async function cachedParseSession(cache: ParseCache, filePath: string, sessionId: string, fallbackPath: string, source: 'jsonl' | 'subdir'): Promise<SessionMeta>`
  - `scanProjects(knownIds, metaMap, roots?, onProjectComplete?, cache?)` — a 5th optional parameter defaulting to `NOOP_PARSE_CACHE`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/server/parse-cache-jsonl.test.ts`:

```ts
import { describe, expect, test, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, utimes } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { openParseCache } from './parse-cache'
import { cachedParseSession } from './parse-cache-jsonl'
import { parseSessionJsonl } from './jsonl'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentistics-parse-jsonl-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})

/** A minimal but REAL Claude transcript: a user turn, an assistant turn with usage,
 *  and a tool call — enough that the parser produces non-trivial counters to compare. */
const TRANSCRIPT = [
  JSON.stringify({ type: 'user', cwd: '/home/u/app', timestamp: '2026-08-01T10:00:00.000Z', message: { role: 'user', content: 'hello there' } }),
  JSON.stringify({ type: 'assistant', timestamp: '2026-08-01T10:00:05.000Z', message: { role: 'assistant', model: 'claude-opus-4-6', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 }, content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/home/u/app/a.ts' } }] } }),
  JSON.stringify({ type: 'user', cwd: '/home/u/app', timestamp: '2026-08-01T10:00:09.000Z', message: { role: 'user', content: 'thanks' } }),
].join('\n')

async function fixture(): Promise<{ dir: string; file: string }> {
  const dir = await tempDir()
  const file = join(dir, 'sess-1.jsonl')
  await writeFile(file, TRANSCRIPT)
  return { dir, file }
}

describe('cachedParseSession', () => {
  test('a hit reproduces the uncached parse exactly', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))

    const direct = await parseSessionJsonl(file, 'sess-1', '/fallback', 'jsonl')
    const cold = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')
    const warm = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')

    expect(cold).toEqual(direct)
    expect(warm).toEqual(direct)
    // The whole point: byte-identical, not merely "close enough".
    expect(JSON.stringify(warm)).toBe(JSON.stringify(direct))
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, writes: 1 })
    cache.close()
  })

  test('a hit does not read the file', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')

    // Delete the transcript. A real hit answers from the database alone; a parse
    // would fall back to makeEmptySession and lose every counter.
    await rm(file)
    const warm = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')
    expect(warm.user_message_count).toBe(2)
    expect(warm.input_tokens).toBe(10)
    cache.close()
  })

  test('an appended transcript is reparsed, not served stale', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const before = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')

    await writeFile(file, TRANSCRIPT + '\n' + JSON.stringify({
      type: 'user', cwd: '/home/u/app', timestamp: '2026-08-01T10:01:00.000Z',
      message: { role: 'user', content: 'one more' },
    }))
    const after = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')

    expect(after.user_message_count).toBe(before.user_message_count + 1)
    cache.close()
  })

  test('the caller returns to the live parser when the file cannot be stat-ed', async () => {
    // A vanished file has no version, so there is nothing to key on. The wrapper must
    // fall through to the parser (which answers with an empty session) rather than throw.
    const dir = await tempDir()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const s = await cachedParseSession(cache, join(dir, 'missing.jsonl'), 'nope', '/fallback', 'jsonl')
    expect(s.session_id).toBe('nope')
    expect(s.project_path).toBe('/fallback')
    expect(cache.rowCount()).toBe(0)
    cache.close()
  })

  test('two sources of one path do not share a row', async () => {
    // `source` changes the SessionMeta the parser produces, and Format A and Format B
    // can name the same transcript. It has to be part of the identity.
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const a = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')
    const b = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'subdir')
    expect(a._source).toBe('jsonl')
    expect(b._source).toBe('subdir')
    cache.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/parse-cache-jsonl.test.ts`
Expected: FAIL — `Cannot find module './parse-cache-jsonl'`

- [ ] **Step 3: Write the wrapper**

Create `packages/server/server/parse-cache-jsonl.ts`:

```ts
import type { SessionMeta } from '@agentistics/core'
import { parseSessionJsonl } from './jsonl'
import { safeStat } from './utils'
import type { ParseCache } from './parse-cache'
import type { FileStamp } from './parse-cache-key'

/** The file's version, or null when it cannot be stat-ed — in which case there is
 *  nothing to key on and the caller must go to the live parser. */
export async function stampOf(filePath: string): Promise<FileStamp | null> {
  const st = await safeStat(filePath)
  if (!st?.isFile()) return null
  return { path: filePath, mtimeMs: st.mtimeMs, size: st.size }
}

/**
 * `parseSessionJsonl`, through the cache.
 *
 * `source` is part of the VARIANT, not merely a parser argument: it changes the
 * SessionMeta produced, and Format A and Format B in `scanProjectDir` can name the
 * same transcript. `sessionId` and `fallbackPath` are NOT — both are derived
 * deterministically from the path the key already carries.
 *
 * A file that cannot be stat-ed falls through to the parser unchanged, which answers
 * with an empty session exactly as it does today.
 */
export async function cachedParseSession(
  cache: ParseCache,
  filePath: string,
  sessionId: string,
  fallbackPath: string,
  source: 'jsonl' | 'subdir',
): Promise<SessionMeta> {
  const stamp = await stampOf(filePath)
  if (!stamp) return parseSessionJsonl(filePath, sessionId, fallbackPath, source)

  const hit = cache.get<SessionMeta>('session', stamp, source)
  if (hit) return hit

  const parsed = await parseSessionJsonl(filePath, sessionId, fallbackPath, source)
  cache.set('session', stamp, parsed, source)
  return parsed
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/parse-cache-jsonl.test.ts`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Thread the cache through `data.ts`**

In `packages/server/server/data.ts`:

**(a)** Add to the imports near line 11:

```ts
import { openParseCache, NOOP_PARSE_CACHE, type ParseCache } from './parse-cache'
import { cachedParseSession } from './parse-cache-jsonl'
```

**(b)** Change the `scanProjectDir` signature (line 157-163) to take the cache as a final parameter:

```ts
async function scanProjectDir(
  projDir: string,
  rootDirPaths: string[],
  knownIds: Set<string>,
  metaMap: Map<string, SessionMeta>,
  fileLimit: ReturnType<typeof createLimiter>,
  cache: ParseCache
): Promise<{ project: ServerProject; extraSessions: SessionMeta[]; workflowRuns: WorkflowRun[] } | null> {
```

**(c)** Replace the Format A parse at line 207:

```ts
        const session = await fileLimit(() => cachedParseSession(cache, filePath, sessionId, fallbackPath, 'jsonl'))
```

**(d)** Replace the Format B parse at line 305:

```ts
        const session = await fileLimit(() => cachedParseSession(cache, agentFilePath, sessionId, fallbackPath, 'subdir'))
```

**(e)** Change the `scanProjects` signature (line 395-400):

```ts
export async function scanProjects(
  knownIds: Set<string>,
  metaMap: Map<string, SessionMeta>,
  roots: string[] = [PROJECTS_DIR],
  onProjectComplete?: (completed: number, total: number) => void,
  cache: ParseCache = NOOP_PARSE_CACHE,
): Promise<ScanResult> {
```

The default is `NOOP_PARSE_CACHE` so every existing caller and test keeps working unchanged, and a caller that wants the cache opts in.

**(f)** Pass it at the `scanProjectDir` call (line 421):

```ts
      scanProjectDir(projDir, rootDirPaths, knownIds, metaMap, fileLimit, cache).then(r => {
```

**(g)** In `_buildApiResponse`, replace lines 716-721 in full — this is the whole existing statement, including the `onProgress` callback that was already its 4th argument:

```ts
    const parseCache = PARSE_CACHE_ENABLED ? await openParseCache() : NOOP_PARSE_CACHE
    const { projects, extraSessions, workflowRuns: collectedWorkflowRuns } = await scanProjects(
      knownIds,
      metaMap,
      projectRoots,
      (done, total) => onProgress('projects', total > 0 ? done / total : 1),
      parseCache,
    )
    // Mark everything read this build as live, then drop rows for files not seen in 30
    // days — Claude deletes transcripts at 30 days by default, so their rows are dead
    // weight after that. The cache is derived state: dropping too much costs one
    // reparse, dropping too little costs disk. Neither can cost a wrong number.
    parseCache.flush()
    parseCache.gc(Date.now() - 30 * 24 * 60 * 60 * 1000)
    parseCache.close()
```

Add `PARSE_CACHE_ENABLED` to the existing `./config` import at line 5.

Note the ordering: `parseCache.close()` runs right after `scanProjects` returns, not at the end of `_buildApiResponse`. Nothing after this point parses a transcript, and holding the handle open across the rest of the build would keep a WAL lock for no reason.

- [ ] **Step 6: Verify the build produces the same answer with and without the cache**

Two separate processes (`data.ts` holds a 30-second in-memory result that would otherwise
answer the second build from the first one's object), over a FROZEN snapshot of `~/.claude`
(a live directory is being appended to by running assistants, and two builds over it
legitimately disagree):

```bash
B=/tmp/parse-cache-bench
rm -rf "$B" && mkdir -p "$B/snap" "$B/ag"
cp -a ~/.claude/projects ~/.claude/usage-data ~/.claude/stats-cache.json "$B/snap"/

cat > "$B/dump.ts" <<'TS'
const out = process.argv[2]!
const { buildApiResponse } = await import(process.env.DATA_TS!)
const t = performance.now()
const data: any = await buildApiResponse()
console.log(JSON.stringify({ ms: Math.round(performance.now() - t), sessions: data.sessions?.length ?? 0 }))
await Bun.write(out, JSON.stringify(data))
TS

export DATA_TS="$PWD/packages/server/server/data.ts"
export CLAUDE_DIR="$B/snap" AGENTISTICS_DIR="$B/ag" AGENTISTICS_ARCHIVE=0
bun "$B/dump.ts" "$B/cold.json"   # cold — populates the cache
bun "$B/dump.ts" "$B/warm.json"   # warm — served from it
python3 sdd/cmp.py "$B"
```

Expected from `cmp.py`: `session ids equal: True`, `sessions with DIFFERENT content: 0`.
`sessions array ORDER identical: False` is EXPECTED and not a failure — that ordering was
nondeterministic before this cache existed. Any nonzero content mismatch IS a correctness bug
in the wiring: stop and report it rather than committing.

- [ ] **Step 7: Run the full suite**

Run: `bun tsc --noEmit && bun test`
Expected: no type errors; every test passes.

- [ ] **Step 8: Commit**

```bash
git add packages/server/server/parse-cache-jsonl.ts packages/server/server/parse-cache-jsonl.test.ts packages/server/server/data.ts
git commit -m "perf(data): serve full session parses from the parse cache"
```

---

### Task 4: Cache the meta-session enrichment

This is the hot path that matters most: most Claude sessions arrive through `session-meta` and are enriched by re-reading the whole transcript up to three times (`data.ts:214-250`).

**Files:**
- Modify: `packages/server/server/parse-cache-jsonl.ts` — add `cachedEnrich`
- Modify: `packages/server/server/parse-cache-jsonl.test.ts` — add its tests
- Modify: `packages/server/server/data.ts:210-251` — replace the enrichment block

**Interfaces:**
- Consumes: `ParseCache`, `stampOf` (Task 3); `activeMinutesFromClaudeJsonl` from `./jsonl`; `extractAgentMetrics` from `./agent-metrics`.
- Produces:
  - `interface EnrichResult { model: string | null; activeMinutes: number | null; agentMetrics: SessionAgentMetrics | null }`
  - `async function cachedEnrich(cache: ParseCache, filePath: string, metaModel: string): Promise<EnrichResult | null>`

- [ ] **Step 1: Write the failing test**

First extend the two existing import lines at the TOP of
`packages/server/server/parse-cache-jsonl.test.ts` (do not add imports mid-file):

```ts
import { cachedParseSession, cachedEnrich } from './parse-cache-jsonl'
import { parseSessionJsonl, activeMinutesFromClaudeJsonl } from './jsonl'
```

Then append the new block to the end of the file. `TRANSCRIPT`, `fixture()`, `tempDir()`
and the `dirs` cleanup hook are already defined there by Task 3 and are in scope:

```ts
describe('cachedEnrich', () => {
  test('derives the model from the transcript when the caller has none', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const r = await cachedEnrich(cache, file, '')
    expect(r?.model).toBe('claude-opus-4-6')
    cache.close()
  })

  test('active minutes match the live computation', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const r = await cachedEnrich(cache, file, '')
    expect(r?.activeMinutes).toBe(activeMinutesFromClaudeJsonl(TRANSCRIPT.split('\n')) ?? null)
    cache.close()
  })

  test('a hit reproduces the cold result exactly and reads no file', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const cold = await cachedEnrich(cache, file, '')
    await rm(file)
    const warm = await cachedEnrich(cache, file, '')
    expect(JSON.stringify(warm)).toBe(JSON.stringify(cold))
    cache.close()
  })

  test('the caller-supplied model is part of the identity', async () => {
    // extractAgentMetrics PRICES against the model id the caller passes. Two callers
    // with different ids must not read each other's row, or a session is costed with
    // another session's rate.
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    await cachedEnrich(cache, file, 'claude-opus-4-6')
    await cachedEnrich(cache, file, 'claude-haiku-4-5-20251001')
    expect(cache.rowCount()).toBe(2)
    cache.close()
  })

  test('a missing file yields null rather than an invented result', async () => {
    const dir = await tempDir()
    const cache = await openParseCache(join(dir, 'cache.db'))
    expect(await cachedEnrich(cache, join(dir, 'missing.jsonl'), '')).toBeNull()
    cache.close()
  })

  test('an empty file yields null', async () => {
    const dir = await tempDir()
    const file = join(dir, 'empty.jsonl')
    await writeFile(file, '')
    const cache = await openParseCache(join(dir, 'cache.db'))
    expect(await cachedEnrich(cache, file, '')).toBeNull()
    cache.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/server/parse-cache-jsonl.test.ts`
Expected: FAIL — `cachedEnrich is not a function`

- [ ] **Step 3: Implement `cachedEnrich`**

Append to `packages/server/server/parse-cache-jsonl.ts` (and extend the existing imports):

```ts
import { activeMinutesFromClaudeJsonl } from './jsonl'
import { extractAgentMetrics } from './agent-metrics'
import type { SessionAgentMetrics } from '@agentistics/core'

/** Everything `scanProjectDir` needs from a transcript whose session already exists in
 *  Claude's own session-meta — which carries none of the three. */
export interface EnrichResult {
  /** The first assistant model id in the transcript, or null when there is none. */
  model: string | null
  /** Per-turn active time; null when the transcript has no usable timing. */
  activeMinutes: number | null
  /** Agent metrics, or null when the session invoked no agent. */
  agentMetrics: SessionAgentMetrics | null
}

/** The first `claude-*` model in the transcript's opening 200 lines — the same scan
 *  `scanProjectDir` did inline, kept identical on purpose. */
function deriveModel(lines: string[]): string | null {
  for (const raw of lines.slice(0, 200)) {
    const line = raw.trim()
    if (!line) continue
    try {
      const e = JSON.parse(line)
      const m = e.message?.model
      if (e.type === 'assistant' && typeof m === 'string' && m && m.startsWith('claude-')) return m
    } catch { /* skip */ }
  }
  return null
}

/**
 * The whole enrichment of one transcript, cached as a unit.
 *
 * All three values are computed on a miss even when the caller needs only one. That is
 * deliberate: the read and the `split('\n')` dominate, they happen once per file
 * VERSION rather than once per build, and computing the triple removes the three
 * separate cache identities the conditional version would need.
 *
 * `metaModel` is the VARIANT because `extractAgentMetrics` prices against it, so it
 * changes the result without being in the file. The effective id is `metaModel ||
 * derived`, preserving the inline order exactly: the old code set `metaEntry.model`
 * from the transcript BEFORE passing `metaEntry.model` to extractAgentMetrics.
 *
 * Returns null when the file is gone or empty — the same "nothing to say" the inline
 * block expressed by returning early, never a zeroed result that would read as a
 * measurement.
 */
export async function cachedEnrich(
  cache: ParseCache,
  filePath: string,
  metaModel: string,
): Promise<EnrichResult | null> {
  const stamp = await stampOf(filePath)
  if (!stamp) return null

  const hit = cache.get<EnrichResult>('enrich', stamp, metaModel)
  if (hit) return hit

  const content = await readFile(filePath, 'utf-8').catch(() => '')
  if (!content) return null

  const lines = content.split('\n')
  const model = deriveModel(lines)
  const metrics = extractAgentMetrics(lines, metaModel || model || '')
  const result: EnrichResult = {
    model,
    activeMinutes: activeMinutesFromClaudeJsonl(lines) ?? null,
    agentMetrics: metrics.totalInvocations > 0 ? metrics : null,
  }
  cache.set('enrich', stamp, result, metaModel)
  return result
}
```

Add `import { readFile } from 'fs/promises'` to the top of the file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/server/parse-cache-jsonl.test.ts`
Expected: PASS — 11 tests pass

- [ ] **Step 5: Replace the inline enrichment block in `data.ts`**

Replace `data.ts` lines 210-251 (the `else if (metaEntry && ...)` branch, from `} else if` through its closing `}`) with:

```ts
      } else if (metaEntry && (!metaEntry.model || metaEntry.active_minutes === undefined
        || (metaEntry.uses_task_agent && !metaEntry.agentMetrics))) {
        // Meta session — model, active time and agent metrics all come from the
        // transcript (Claude's own session-meta files carry none of the three), and all
        // three are cached as one unit keyed on the file's version. Wall-clock duration
        // is in the meta file; per-turn active time only exists here, so it has to be
        // computed or the metric is blank for the path that serves MOST Claude sessions.
        await fileLimit(async () => {
          const needsModel = !metaEntry.model
          const needsAgentMetrics = metaEntry.uses_task_agent && !metaEntry.agentMetrics
          const needsActive = metaEntry.active_minutes === undefined
          if (!needsModel && !needsAgentMetrics && !needsActive) return

          const enriched = await cachedEnrich(cache, filePath, metaEntry.model ?? '')
          if (!enriched) return

          if (needsModel && enriched.model) metaEntry.model = enriched.model
          if (needsActive) metaEntry.active_minutes = enriched.activeMinutes ?? undefined
          if (needsAgentMetrics && enriched.agentMetrics) metaEntry.agentMetrics = enriched.agentMetrics
        })
      }
```

Add `cachedEnrich` to the existing `./parse-cache-jsonl` import.

- [ ] **Step 6: Verify the payload is unchanged**

Run the frozen-snapshot comparison from Task 3 Step 6 again (fresh `AGENTISTICS_DIR`, so the
cold run really is cold).

Expected: same session ids and every session content-identical between the cold and the warm run.
Array ORDER will differ and that is fine — see the Acceptance target section for why byte
comparison is not the gate.
This is the step that catches the one behavioural trap in `cachedEnrich`: the old inline
code set `metaEntry.model` from the transcript *before* handing it to
`extractAgentMetrics`, so the effective model id must be `metaModel || derived`. Get
that order backwards and the hashes diverge on any session whose meta carried no model.

- [ ] **Step 7: Run the full suite**

Run: `bun tsc --noEmit && bun test`
Expected: no type errors; every test passes.

- [ ] **Step 8: Commit**

```bash
git add packages/server/server/parse-cache-jsonl.ts packages/server/server/parse-cache-jsonl.test.ts packages/server/server/data.ts
git commit -m "perf(data): serve meta-session enrichment from the parse cache"
```

---

### Task 5: Measure, verify against the compiled binary, document

**Files:**
- Create: `packages/server/scripts/bench-build.ts`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: `buildApiResponse` from `./packages/server/server/data.ts`; `PARSE_CACHE_FILE` from config.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the benchmark script**

Create `packages/server/scripts/bench-build.ts`:

```ts
/**
 * Cold vs warm `buildApiResponse()`, against whatever is really in ~/.claude.
 *
 * Not a unit test — it measures THIS machine and prints what it found. The
 * correctness gate is the equality assertion at the end: a cache that is fast and
 * answers differently is a bug, not an optimisation.
 *
 * Run: bun packages/server/scripts/bench-build.ts
 */
import { rm } from 'fs/promises'
import { join } from 'path'
import { PARSE_CACHE_FILE } from '../server/config'

const HERE = new URL('.', import.meta.url).pathname

/**
 * One build per CHILD PROCESS.
 *
 * `data.ts` holds a 30-second in-memory result (CACHE_TTL_MS) and would answer the
 * second build from the first one's object, measuring nothing. A query-suffixed
 * dynamic import is not a reliable cache-buster for a .ts specifier in Bun, so the
 * only dependable isolation is a fresh process.
 *
 * The payload is compared by HASH rather than by returning megabytes over a pipe.
 */
function build(): { ms: number; hash: string; bytes: number } {
  const child = Bun.spawnSync({
    cmd: ['bun', '-e', `
      const t = performance.now()
      const { buildApiResponse } = await import(${JSON.stringify(join(HERE, '../server/data.ts'))})
      const data = await buildApiResponse()
      const ms = performance.now() - t
      const { createHash } = await import('crypto')
      // CANONICAL content hash, not a hash of the raw payload. The order of the
      // sessions/projects arrays is nondeterministic (scanProjectDir collects inside
      // Promise.all over concurrent IO) and a cached session's keys come back in
      // serialized rather than construction order. Neither is a content change, and
      // hashing raw bytes would fail the gate for reasons that predate this cache.
      const canon = (x) => Array.isArray(x) ? x.map(canon)
        : (x && typeof x === 'object')
          ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])]))
          : x
      const content = JSON.stringify({
        sessions: (data.sessions ?? []).map(s => JSON.stringify(canon(s))).sort(),
        projects: (data.projects ?? []).map(p => JSON.stringify(canon(p))).sort(),
      })
      console.log(JSON.stringify({
        ms,
        sessions: (data.sessions ?? []).length,
        hash: createHash('sha256').update(content).digest('hex'),
      }))
    `],
    stdout: 'pipe',
    stderr: 'inherit',
    cwd: join(HERE, '../../..'),
  })
  const out = child.stdout.toString().trim().split('\n').pop() ?? ''
  if (child.exitCode !== 0 || !out) {
    console.error('FAIL: the build process did not complete')
    process.exit(1)
  }
  return JSON.parse(out)
}

for (const f of [PARSE_CACHE_FILE, `${PARSE_CACHE_FILE}-wal`, `${PARSE_CACHE_FILE}-shm`]) {
  await rm(f, { force: true })
}

const cold = build()
console.log(`cold: ${cold.ms.toFixed(0)}ms  sessions=${cold.sessions}`)

const warm = build()
console.log(`warm: ${warm.ms.toFixed(0)}ms  sessions=${warm.sessions}`)

const ratio = warm.ms / cold.ms
console.log(`speedup: ${(cold.ms / warm.ms).toFixed(1)}x  (warm is ${(ratio * 100).toFixed(0)}% of cold)`)

if (warm.hash !== cold.hash || warm.sessions !== cold.sessions) {
  console.error('FAIL: the warm build reported DIFFERENT CONTENT. The cache is wrong.')
  console.error(`  cold canon=${cold.hash} sessions=${cold.sessions}`)
  console.error(`  warm canon=${warm.hash} sessions=${warm.sessions}`)
  process.exit(1)
}
console.log(ratio <= 0.25 ? 'PASS: warm build is at or under 25% of cold' : `FAIL: warm build is ${(ratio * 100).toFixed(0)}% of cold, target is 25%`)
process.exit(ratio <= 0.25 ? 0 : 1)
```

- [ ] **Step 2: Run the benchmark**

Run: `bun packages/server/scripts/bench-build.ts`
Expected: `PASS`, with a cold time near the 19,668 ms baseline and a warm time at or under ~4,900 ms. Record both numbers — they go in the commit message.

If it prints `FAIL: the warm build produced a DIFFERENT payload`, stop and diff the two payloads before doing anything else; that is a correctness bug in Task 3 or 4, not a tuning problem.

- [ ] **Step 3: Verify against the COMPILED BINARY** *(POSIX shell; on Windows use WSL or Git Bash)*

`bun:sqlite` is a Bun builtin and this cache is the first code in the repo that WRITES with it. CLAUDE.md already mandates verifying `bun:sqlite`-adjacent and binary-sensitive work against the compiled artifact rather than `bun run`.

```bash
bun run build:binary
rm -f ~/.agentistics/cache.db*
./release/agentop server &
sleep 20 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:47291/api/data
ls -la ~/.agentistics/cache.db
kill %1
```

Expected: `200`, and `~/.agentistics/cache.db` exists with a non-zero size. If the file is absent, the binary silently fell back to `NOOP_PARSE_CACHE` — investigate before continuing.

- [ ] **Step 4: Document the rules in CLAUDE.md**

In `CLAUDE.md`, in the `packages/server/server/` module list, add after the `consolidate.ts` line:

```
  ├── parse-cache.ts / parse-cache-key.ts / parse-cache-jsonl.ts → the JSONL parse cache
  │                          (`~/.agentistics/cache.db`, SQLite via the `bun:sqlite` builtin).
  │                          **DERIVED STATE ONLY** — every row is recomputable from the file it
  │                          names, so deleting the database may only ever cost one slow build.
  │                          Measured before it existed: a cold `buildApiResponse()` took 19.7s and
  │                          320MB RSS re-parsing 815 transcripts / 318MB on every build, and
  │                          `CACHE_TTL_MS` runs a full rebuild every 30 seconds. Two identities,
  │                          deliberately separate in the PURE `parse-cache-key.ts`: the **SLOT**
  │                          (`kind`, `path`, `variant`) is the primary key, so one row per
  │                          derivation per file — a transcript appended to a hundred times leaves
  │                          ONE row, not a hundred; the **KEY** (truncated `mtimeMs`, `size`) is
  │                          the file VERSION a hit must match. `mtimeMs` is TRUNCATED because
  │                          `stat()` reports a float and two stats of one untouched file disagree
  │                          in the fraction, which would miss on every build and defeat the cache.
  │                          **Anything outside the file's bytes that changes the result MUST go in
  │                          the `variant`** — `cachedEnrich` keys on the caller's model id because
  │                          `extractAgentMetrics` PRICES against it, and two callers sharing a row
  │                          would cost one session at another's rate. Every failure is a MISS, never
  │                          a throw: an unwritable home, a read-only container, a corrupt blob and a
  │                          non-Bun runtime all degrade to `NOOP_PARSE_CACHE` and a slow, correct
  │                          build. Kill switch: `AGENTISTICS_PARSE_CACHE=0`
```

- [ ] **Step 5: Document it in docs/architecture.md**

Add a section after the archive-mirror material:

```markdown
### The JSONL parse cache

`~/.agentistics/cache.db` (SQLite) holds the *derived* result of parsing each Claude
transcript, keyed by the file's `(mtime, size)`. It exists because `buildApiResponse()`
re-read and re-parsed every transcript on every build — measured at 19.7 s and 320 MB
of resident memory over 815 files / 318 MB — while `data.ts` runs a full rebuild in the
background every 30 seconds.

It is **derived state and nothing else**. Every row can be recomputed from the file it
names, so the database can be deleted at any time and the only cost is one slow build.
Nothing may be stored here that does not also exist on disk somewhere else — that rule
is what separates this cache from the consolidate store (`~/.agentistics/sessions/`),
which IS a source of truth for sessions Claude has since deleted.

Disable it with `AGENTISTICS_PARSE_CACHE=0`; relocate it with
`AGENTISTICS_PARSE_CACHE_FILE`.
```

- [ ] **Step 6: Run the full suite one last time**

Run: `bun tsc --noEmit && bun test`
Expected: no type errors; every test passes.

- [ ] **Step 7: Commit**

```bash
git add packages/server/scripts/bench-build.ts CLAUDE.md docs/architecture.md
git commit -m "docs(cache): benchmark and document the JSONL parse cache"
```

---

## Verification Checklist

Before calling this done, all of the following must hold:

- [ ] `bun tsc --noEmit` passes.
- [ ] `bun test` passes, with no previously-green test now red.
- [ ] `bun packages/server/scripts/bench-build.ts` prints `PASS` on both gates (identical payload, warm ≤ 25% of cold).
- [ ] The compiled binary (`./release/agentop server`) creates `~/.agentistics/cache.db` and serves `/api/data` with a `200`.
- [ ] The **Windows** binary does the same. `bun run build:binary:windows` produces `release/agentop.exe`; run it on a Windows machine (or the Tauri desktop build) and confirm `%USERPROFILE%\.agentistics\cache.db` appears with a non-zero size. `bun:sqlite` is cross-compiled into `agentop.exe` by `--target=bun-windows-x64`, and this is the first code in the repo that WRITES with it — an absent file means it silently fell back to `NOOP_PARSE_CACHE`, which is correct behaviour hiding a build problem.
- [ ] `AGENTISTICS_PARSE_CACHE=0 bun packages/server/scripts/bench-build.ts` still completes (the cold path is intact) — it will fail the 25% gate by design, which is the expected outcome for that run.
- [ ] Deleting `~/.agentistics/cache.db` and rebuilding yields the same payload as before the deletion.
