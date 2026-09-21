# 15 — Is `bun:sqlite` (WAL) safe for a multi-process append-only event journal?

Measurement task, 2026-09-20. Tests the recommendation in
`docs/superpowers/specs/2026-09-19-agentistics-runtime-master.md` §19.2 (SQLite WAL journal at
`~/.agentistics/journal.db`, `UNIQUE(event_id)`, `rowid` as cursor) against real concurrent Bun
processes on this machine, rather than confirming it on paper.

## 1. Environment

```
bun --version        1.3.14
uname -a              Linux BRAIAODE2 5.15.167.4-microsoft-standard-WSL2 #1 SMP x86_64 GNU/Linux
```

- This is **WSL2**. `$HOME` (`/home/mithrandir`) is on `/dev/sdc`, filesystem **ext4**, mounted at
  `/` — i.e. the WSL2 VM's own virtual disk, native Linux filesystem, **not** a `/mnt/c` DrvFs
  mount. `stat -f` confirms `Type: ext2/ext3` (ext4 reports as ext2/ext3 family).
- `/mnt/c` is present and is DrvFs, mounted over **9p** with the `mmap` option
  (`C:\ on /mnt/c type 9p (rw,noatime,dirsync,...,mmap,access=client,...)`) — a modern WSL2 build
  that does support `mmap` on DrvFs (older builds did not, which is why WAL used to be flatly unsafe
  there). This machine's real journal path (`~/.agentistics/journal.db`) is **not** exposed to that
  risk today, because `$HOME` is on the ext4 disk — but see §6 for what breaks if that ever changes.

## 2–3. Benchmark: N concurrent writer processes, WAL, `busy_timeout`

Script (`worker.ts`, run by `run-bench.ts`) below. Each of N separate **Bun processes** opens the
same SQLite file, sets `busy_timeout` (**before** `journal_mode`, see the ordering finding in §4),
inserts rows in batches of 100 inside one transaction per batch, each row's `event_id` a fresh
UUID. `run-bench.ts` spawns 1/2/4/8 workers × 2000 rows each, then verifies `COUNT(*)` and
`COUNT(DISTINCT event_id)` against the expected total.

**Results, ext4 (this machine's real disk), 2000 rows/worker, batch 100:**

| N writers | expected rows | actual | distinct | lost | duplicated | SQLITE_BUSY seen | wall ms | aggregate rows/s | batch p50 ms | batch p99 ms (worst worker) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2,000  | 2,000  | 2,000  | 0 | 0 | 0 | 69  | 28,986 | 0.47 | 8.5   |
| 2 | 4,000  | 4,000  | 4,000  | 0 | 0 | 0 | 95  | 42,105 | 0.70 | 20.0  |
| 4 | 8,000  | 8,000  | 8,000  | 0 | 0 | 0 | 158 | 50,633 | 1.20 | 58.4  |
| 8 | 16,000 | 16,000 | 16,000 | 0 | 0 | 0 | 265 | 60,377 | 1.61 | 130.0 |

**Zero rows lost, zero duplicated, zero `SQLITE_BUSY` surfaced to the caller, at every concurrency
level.** Throughput scales roughly with N (SQLite serializes writers under WAL — only one writer
transaction commits at a time — so this is contention latency, not parallel throughput; the p99
batch latency for a 100-row batch grows from 8ms at N=1 to 130ms at N=8, all comfortably inside the
5000ms `busy_timeout`). `totalBusy: 0` does **not** mean there was no contention — it means SQLite's
internal busy-handler (driven by `busy_timeout`) absorbed every collision by retrying internally
before returning to JS; the rising p99 latency **is** the contention, made invisible as an error and
visible only as delay. That is the correct behaviour for `busy_timeout`, but it means "no errors" is
not proof of "no contention" — latency percentiles are the signal to watch in production.

**Reader concurrent with writers** (4 writers × 30,000 rows = 120,000 rows, one separate read-only
connection doing a polling cursor scan `WHERE rowid > $cursor ORDER BY rowid LIMIT 5000` for 5s):

```json
{
  "writersDoneMs": 1192,
  "readerTotalWallMs": 5102,
  "scans": 3104993,
  "maxScanLatencyMs": 5.99,
  "totalRowsSeen": 120000,
  "errors": 0,
  "finalCursor": 120000,
  "nonMonotonicCursor": 0
}
```

The reader **never blocked** on the writers (max single-scan latency 6ms even while 4 processes were
committing), saw **every** row exactly once, in strictly increasing `rowid` order, and never saw a
non-monotonic or torn cursor. This is WAL's headline guarantee working as documented: readers see a
consistent snapshot and do not contend with writers at all.

## 4. Failure modes

**(a) Kill a writer mid-transaction.** `killer-writer.ts` opens the db, `BEGIN IMMEDIATE`, then
inserts ~1–5M rows in a loop with periodic `Bun.sleepSync(2)` so the parent can `SIGKILL` it
mid-transaction (never reaches `COMMIT`). Repeated 4 times, WAL files at kill time ranging 7–12MB:

```json
{ "walExisted": true, "walSizeAtKillBytes": 9438952, "rowCountAfterRecovery": 0,
  "killTestTypeRows": 0, "integrityCheck": "ok" }
```

**The file survives and recovers correctly every time**: reopening triggers WAL rollback of the
uncommitted transaction, `PRAGMA integrity_check` reports `ok`, and the killed transaction's rows
are **entirely** absent (0, not partial) — SQLite's all-or-nothing transaction guarantee held under
a hard `SIGKILL`, as documented.

**One real finding here**: the very first write attempt **immediately after** reopening a
just-crashed, WAL-heavy file sometimes throws `SQLITE_BUSY` (confirmed via `err.code`, not a
message-string guess) even with `busy_timeout=5000` already set on that same connection — resolved
after 1–4 retries (~50–200ms) with a small manual backoff. This reads as the connection's own
implicit recovery/checkpoint work on open colliding with the very next statement on the *same*
connection, a case `busy_timeout`'s handler does not fully cover. **A crash-recovery reopen needs
its own short retry loop around the first write, not just a bare `busy_timeout` pragma.**

**(b) Same DB, two processes, different working directories.** `test-cwd.ts` runs one writer from
`cwd-a` addressing the db as `../cwd-test.db` and another from `cwd-b` addressing it the same
relative way (both resolve to the same absolute file) — 500 rows each, concurrently:

```json
{ "expectedRows": 1000, "actualRows": 1000, "distinctIds": 1000 }
```

No issue: locking is by the OS-resolved path (inode), not by the process's notion of cwd, once both
resolve to the same file. Not interesting on its own here, but it is the shape of bug this is meant
to rule out (a relative path resolving to *two different files* under two cwds would silently split
the journal into two — worth a runtime assertion that the resolved path is absolute and identical
across launchers, since `agentop` runs as several processes with different cwds by design).

**(c) A long transaction held open while a second process tries to write.** `test-longtxn.ts`: one
process does `BEGIN IMMEDIATE`, inserts a row, holds the transaction open for 2000ms, then commits.
A second process (waiter) tries to insert immediately (300ms after the holder started) with
`busy_timeout=5000`. A third process (reader, separate read-only connection) polls `COUNT(*)` every
50ms throughout:

```json
{ "waiterResult": { "waitedMs": 1736, "err": null },
  "readerMaxLatencyMs": 0.54,
  "readerCountsSeenDuringHold": [1,1,1,...,1, 3,3,3,3,3] }
```

The waiter **blocked for ~1.7s (matching the remaining hold time) and then succeeded** — no error,
`busy_timeout` did exactly its job waiting out a real writer lock, not just transient contention.
The reader **never blocked** (sub-millisecond throughout) and **never saw the holder's uncommitted
row** (count stayed at 1, the seed row, for the whole 2s hold; jumped to 3 only after both the
holder and the waiter had committed) — no dirty reads, confirming snapshot isolation for readers
under WAL.

## 5. Comparison: append-only JSONL (`O_APPEND`)

Same workload (N processes × 2000 lines, one `writeSync` per batch of 100, one file descriptor
opened with `'a'` per process):

| N writers | expected | lines written | distinct ids | parse errors | wall ms | aggregate rows/s |
|---|---|---|---|---|---|---|
| 1 | 2,000  | 2,000  | 2,000  | 0 | 73 | 27,397  |
| 2 | 4,000  | 4,000  | 4,000  | 0 | 59 | 67,797  |
| 4 | 8,000  | 8,000  | 8,000  | 0 | 77 | 103,896 |
| 8 | 16,000 | 16,000 | 16,000 | 0 | 84 | 190,476 |

JSONL is **1.5–3× faster in aggregate throughput** here (Linux `O_APPEND` writes from multiple file
descriptors to one file are atomic per `write(2)` call and the kernel serializes them at the VFS
layer, with none of SQLite's page-cache/WAL bookkeeping) and never showed a lost or duplicated line
in this test — but that guarantee is **weaker than it looks**: `O_APPEND` atomicity is per single
`write(2)` syscall, so a "batch" here is only actually safe because the whole batch string was built
in memory and handed to `writeSync` in one call; a naive per-line `appendFileSync` call from several
processes has no such guarantee and can interleave partial lines under load or on some
network/overlay filesystems. More importantly, JSONL **cannot enforce `UNIQUE(event_id)` structurally**
(a duplicate is only caught by a full-file scan after the fact, which is exactly the class of
multi-process race `registry.ts`'s docstring and `session-adopt.ts` already paid for twice on this
JSON-registry pattern), and it **has no indexed read**: `events_run`/`events_type` in the spec's
schema make `WHERE run_id = ? ORDER BY occurred_at` an index seek; on JSONL that is a full scan of
the file, every time, for every projection.

## 6. WSL2/DrvFs-specific findings

Ran the identical corrected benchmark (§4 ordering fix applied) against a DrvFs path
(`/mnt/c/Users/<user>/...`) for direct comparison, then deleted that scratch directory (it is
outside `/tmp` and outside this task's scope; not part of the committed artifacts).

- **WAL mode is accepted and functions correctly on DrvFs** on this build (`mmap` 9p option
  present) — `PRAGMA journal_mode=WAL` reports `wal`, `-wal`/`-shm` sidecar files are created
  normally, and the same kill-mid-transaction test recovered cleanly (`rowCount: 0`,
  `integrity_check: ok`) after a `SIGKILL`. This is **not guaranteed on older WSL2/DrvFs builds** —
  historically DrvFs lacked reliable `mmap`/byte-range-lock support and SQLite's own documentation
  and issue tracker record WAL as unsafe there; this is a property of *this* WSL build, not of DrvFs
  in general, and must be re-checked if the target machine's WSL version is older or on a network
  share.
- **DrvFs is 6–20× slower for this workload** and the gap **widens with concurrency**, not just a
  flat constant-factor tax:

  | N writers | ext4 aggregate rows/s | DrvFs aggregate rows/s | DrvFs worst-worker batch-of-100 latency |
  |---|---|---|---|
  | 1 | 28,986 | 3,396 | 37 ms |
  | 2 | 42,105 | 5,006 | 371 ms |
  | 4 | 50,633 | 4,022 | 1,164 ms |
  | 8 | 60,377 | 4,070 | 3,201 ms |

  At 8 concurrent writers on DrvFs, the worst-case single-batch latency (3.2s) is already 64% of the
  way to a 5000ms `busy_timeout` ceiling with only a 100-row batch — a slightly larger batch, more
  writers, or a slower Windows-side disk would start producing real `SQLITE_BUSY` failures, not just
  slowness. **No rows were lost or duplicated on DrvFs at any concurrency tested here** — the
  correctness guarantees held — but the safety margin against `busy_timeout` exhaustion is thin and
  shrinks fast with writer count, in a way it does not on ext4 (ext4's worst case at N=8 was 130ms,
  25× smaller).
- **A real, filesystem-agnostic bug this run found, made visible first on DrvFs**: setting
  `PRAGMA journal_mode = WAL` **before** `PRAGMA busy_timeout` on a freshly-created file, with a
  second process racing to do the same thing, produced an **uncaught, unretried**
  `SQLITE_BUSY_RECOVERY` that killed the whole worker process instantly (0 rows written) — on ext4
  this race window was apparently too narrow to hit in several runs, but on DrvFs's higher latency
  it reproduced on the very first attempt. Reordering the pragmas so `busy_timeout` is set **first**
  eliminated it on both filesystems in every subsequent run. **This is the single actionable
  correctness requirement this measurement found**, independent of WSL/DrvFs: it would eventually
  bite on ext4 too under enough concurrent first-time opens (e.g. many one-shot `agentop` CLI
  invocations racing to create `journal.db` on a fresh machine).
- Nothing else measured here is WSL2-specific in the other direction (i.e. nothing passed on WSL2
  that would fail on a "normal" Linux box or macOS) — the ext4 numbers above are what a native Linux
  or macOS APFS/HFS+ disk should be expected to resemble, modulo each filesystem's own fsync cost.

## VERDICT

**The recommendation is safe as written, for this machine, with three amendments the spec text
should make explicit:**

1. **Pragma order is load-bearing**: `PRAGMA busy_timeout = <N>;` **before** `PRAGMA journal_mode =
   WAL;` on every connection, every time — not the other way round. Measured: the wrong order
   produces an uncaught `SQLITE_BUSY_RECOVERY` on first concurrent open of a fresh file, invisible
   on ext4 in this run's sample size but reproducible on the first try on DrvFs, and structurally the
   same race exists everywhere, just narrower on a fast local disk.
2. **A crash-recovery reopen needs a short bounded retry (a handful of attempts, ~50ms apart) around
   its first write**, not a bare reliance on `busy_timeout` — measured a transient `SQLITE_BUSY` on
   the very next statement after reopening a file whose last writer was `SIGKILL`ed mid-transaction,
   on the *same* connection that had already set `busy_timeout`.
3. **One-writer-per-process discipline is not required for correctness** (WAL serializes writers
   internally and `UNIQUE(event_id)` plus `busy_timeout` were sufficient for zero loss/duplication at
   up to 8 concurrent writer *processes* in every test here), but **it is required for acceptable
   latency**: p99 batch latency grows roughly linearly with writer count on ext4 (8ms → 130ms,
   N=1→8) and much worse on DrvFs (37ms → 3.2s). If the real system ever runs many more than 8
   concurrent writers against one journal (plausible: server + daemon + TUI + several one-shot CLI
   invocations + VS Code extension client, all at once), that latency curve — not row loss — is what
   will be felt first, as slow appends rather than failed ones.

**Required settings**: `journal_mode = WAL`, `synchronous = NORMAL` (matches the spec's implicit
choice; note this trades power-loss durability of the very last transaction(s) for speed — it is
safe against process crashes, which is what was tested and confirmed here, but **not** tested
against OS-level power loss, which `synchronous = FULL` would cost more to guard), `busy_timeout`
set first on every connection (≥ 5000ms tested; the DrvFs worst case suggests erring toward a higher
value, e.g. 10–15s, if the target machine's `~/.agentistics` could ever end up on a slow or foreign
filesystem), and `UNIQUE(event_id)` exactly as specced.

**What would make it wrong**: the journal living on a filesystem where WAL's shared-memory index
(`mmap` on the `-shm` file) does not work reliably — an older WSL2/DrvFs build than this one, a
network filesystem (NFS/SMB — SQLite's own documentation explicitly warns WAL is unsafe there
regardless of platform), or a container `pid`/`fs` isolation boundary that splits `mmap` semantics
between processes. None of those apply to this machine (`~/.agentistics` sits on the WSL2 VM's own
ext4 disk), but the risk is real enough that a defensive one-time check at startup — try WAL mode,
confirm `PRAGMA journal_mode` actually reports `wal` (SQLite silently falls back to `DELETE` mode on
some filesystems that can't support WAL, e.g. genuine network shares) and fail loudly rather than
silently downgrading — costs nothing and catches exactly the scenario this section describes.

## Benchmark scripts (re-runnable; written to `/tmp/sqlite-journal-bench/`, never in the repo)

### `schema.sql`
```sql
CREATE TABLE IF NOT EXISTS events (
  rowid       INTEGER PRIMARY KEY,
  event_id    TEXT NOT NULL UNIQUE,
  schema      INTEGER NOT NULL,
  type        TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  session_id  TEXT, run_id TEXT, agent_id TEXT, task_id TEXT,
  source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_version TEXT,
  mode        TEXT NOT NULL, confidence TEXT NOT NULL, adapter_version TEXT NOT NULL,
  source_ref  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run  ON events(run_id, occurred_at);
CREATE INDEX IF NOT EXISTS events_type ON events(type, occurred_at);
```

### `worker.ts` (one writer process; corrected pragma order)
```ts
// worker.ts — one writer process. Appends rowsPerWorker events to dbPath in batches of
// batchSize, inside one SQLite transaction per batch. Reports per-batch latency, SQLITE_BUSY
// retries, and the set of event_ids it wrote (so the orchestrator can check for loss/duplication
// across the WHOLE fleet, not just within one process).
//
// Usage: bun worker.ts <dbPath> <workerId> <rowsPerWorker> <batchSize> <resultPath>

import { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const [dbPath, workerIdStr, rowsStr, batchStr, resultPath] = process.argv.slice(2)
const workerId = Number(workerIdStr)
const totalRows = Number(rowsStr)
const batchSize = Number(batchStr)

const db = new Database(dbPath, { create: true })
// busy_timeout MUST be the first pragma, before journal_mode. Setting journal_mode=WAL itself
// takes a lock, and on a slow/foreign filesystem (measured on DrvFs) a second process opening the
// same fresh file concurrently can hit SQLITE_BUSY_RECOVERY on THAT statement, before busy_timeout
// is in effect, crashing the whole connection setup rather than being retried.
db.exec('PRAGMA busy_timeout = 5000;')
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA synchronous = NORMAL;')

const insert = db.prepare(
  `INSERT INTO events (event_id, schema, type, occurred_at, recorded_at, session_id, run_id,
     agent_id, task_id, source_kind, source_id, source_version, mode, confidence,
     adapter_version, source_ref, data)
   VALUES ($event_id, 1, 'bench.row', $ts, $ts, NULL, $run_id, NULL, NULL, 'bench',
     $source_id, NULL, 'live', 'measured', 'bench-1', NULL, $data)`
)

const insertBatch = db.transaction((rows: { event_id: string; ts: string; run_id: string; source_id: string; data: string }[]) => {
  for (const row of rows) {
    insert.run({
      $event_id: row.event_id,
      $ts: row.ts,
      $run_id: row.run_id,
      $source_id: row.source_id,
      $data: row.data,
    })
  }
})

let busyCount = 0
let sqliteErrors = 0
const batchLatenciesMs: number[] = []
const writtenIds: string[] = []
const startedAt = Date.now()

let written = 0
while (written < totalRows) {
  const n = Math.min(batchSize, totalRows - written)
  const rows = Array.from({ length: n }, (_, i) => {
    const id = `w${workerId}-${written + i}-${randomUUID()}`
    writtenIds.push(id)
    return {
      event_id: id,
      ts: new Date().toISOString(),
      run_id: `run-${workerId}`,
      source_id: `worker-${workerId}`,
      data: JSON.stringify({ workerId, seq: written + i, payload: 'x'.repeat(64) }),
    }
  })

  const t0 = performance.now()
  let attempts = 0
  for (;;) {
    try {
      insertBatch(rows)
      break
    } catch (err: any) {
      attempts++
      const msg = String(err?.message ?? err)
      if (/SQLITE_BUSY|database is locked/i.test(msg)) {
        busyCount++
        if (attempts > 50) {
          sqliteErrors++
          break
        }
        Bun.sleepSync(5)
        continue
      }
      sqliteErrors++
      console.error(`worker ${workerId} error: ${msg}`)
      break
    }
  }
  const t1 = performance.now()
  batchLatenciesMs.push(t1 - t0)
  written += n
}

const elapsedMs = Date.now() - startedAt
db.close()

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

const result = {
  workerId,
  totalRows,
  batchSize,
  elapsedMs,
  rowsPerSec: totalRows / (elapsedMs / 1000),
  busyCount,
  sqliteErrors,
  batchLatencyMsP50: pct(batchLatenciesMs, 50),
  batchLatencyMsP95: pct(batchLatenciesMs, 95),
  batchLatencyMsP99: pct(batchLatenciesMs, 99),
  batchLatencyMsMax: Math.max(...batchLatenciesMs, 0),
  writtenIds,
}

writeFileSync(resultPath, JSON.stringify(result))
```

### `reader.ts` (concurrent cursor-scan reader)
```ts
// reader.ts — runs concurrently with writers, doing repeated cursor scans (as a projection would),
// to see whether it ever blocks for a long time or observes torn/invalid state.
//
// Usage: bun reader.ts <dbPath> <durationMs> <resultPath>

import { Database } from 'bun:sqlite'
import { writeFileSync } from 'node:fs'

const [dbPath, durationStr, resultPath] = process.argv.slice(2)
const durationMs = Number(durationStr)

const db = new Database(dbPath)
db.exec('PRAGMA busy_timeout = 5000;')

let scans = 0
let maxScanLatencyMs = 0
let totalRowsSeen = 0
let errors = 0
const errorMessages: string[] = []
let lastCursor = 0
let nonMonotonicCursor = 0

const start = Date.now()
while (Date.now() - start < durationMs) {
  const t0 = performance.now()
  try {
    const rows = db
      .query('SELECT rowid, event_id FROM events WHERE rowid > $cursor ORDER BY rowid LIMIT 5000')
      .all({ $cursor: lastCursor }) as { rowid: number; event_id: string }[]
    totalRowsSeen += rows.length
    if (rows.length > 0) {
      const newCursor = rows[rows.length - 1].rowid
      if (newCursor < lastCursor) nonMonotonicCursor++
      lastCursor = newCursor
    }
    scans++
  } catch (err: any) {
    errors++
    errorMessages.push(String(err?.message ?? err))
  }
  const t1 = performance.now()
  maxScanLatencyMs = Math.max(maxScanLatencyMs, t1 - t0)
}

db.close()

writeFileSync(
  resultPath,
  JSON.stringify({ scans, maxScanLatencyMs, totalRowsSeen, errors, errorMessages: errorMessages.slice(0, 5), finalCursor: lastCursor, nonMonotonicCursor })
)
```

### `run-bench.ts` (orchestrator: spawns N worker processes at 1/2/4/8, verifies, runs the
reader-while-writing case, and the JSONL comparison)
```ts
// run-bench.ts — orchestrates N concurrent writer processes against one fresh SQLite (WAL) file,
// optionally with a concurrent reader, verifies row counts (loss/duplication), and prints a
// summary table. Also runs a JSONL O_APPEND comparison for the same total row count.
//
// Usage: bun run-bench.ts

import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, appendFileSync, openSync, writeSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const DIR = '/tmp/sqlite-journal-bench'
const ROWS_PER_WORKER = 2000
const BATCH_SIZE = 100

function freshDb(path: string) {
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    try { rmSync(path + ext) } catch {}
  }
  const db = new Database(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(readFileSync(join(DIR, 'schema.sql'), 'utf8'))
  db.close()
}

async function runConcurrency(n: number, withReader: boolean) {
  const dbPath = join(DIR, `bench-${n}.db`)
  freshDb(dbPath)

  const procs: Bun.Subprocess[] = []
  const resultPaths: string[] = []
  const t0 = Date.now()

  for (let i = 0; i < n; i++) {
    const resultPath = join(DIR, `result-${n}-${i}.json`)
    resultPaths.push(resultPath)
    procs.push(
      Bun.spawn(['bun', 'worker.ts', dbPath, String(i), String(ROWS_PER_WORKER), String(BATCH_SIZE), resultPath], {
        cwd: DIR,
        stdout: 'pipe',
        stderr: 'pipe',
      })
    )
  }

  const exitCodes = await Promise.all(procs.map((p) => p.exited))
  const wallMs = Date.now() - t0

  const workerResults = resultPaths.map((p) => JSON.parse(readFileSync(p, 'utf8')))
  const badExit = exitCodes.filter((c) => c !== 0).length

  const db = new Database(dbPath, { readonly: true })
  const [{ cnt }] = db.query('SELECT COUNT(*) as cnt FROM events').all() as { cnt: number }[]
  const [{ distinctCnt }] = db.query('SELECT COUNT(DISTINCT event_id) as distinctCnt FROM events').all() as { distinctCnt: number }[]
  db.close()

  const expected = n * ROWS_PER_WORKER
  const totalBusy = workerResults.reduce((s, r) => s + r.busyCount, 0)
  const totalErrors = workerResults.reduce((s, r) => s + r.sqliteErrors, 0)
  const totalRowsPerSec = workerResults.reduce((s, r) => s + r.rowsPerSec, 0)
  const allP99 = workerResults.map((r) => r.batchLatencyMsP99)

  return {
    n, expected, actualRowCount: cnt, distinctEventIds: distinctCnt,
    lost: expected - cnt, duplicated: cnt - distinctCnt,
    badExitCount: badExit, wallMs,
    aggregateRowsPerSec: expected / (wallMs / 1000),
    sumPerProcessRowsPerSec: totalRowsPerSec,
    totalBusy, totalErrors,
    batchLatencyP99MaxAcrossWorkers: Math.max(...allP99),
    batchLatencyP50Avg: workerResults.reduce((s, r) => s + r.batchLatencyMsP50, 0) / workerResults.length,
  }
}

async function readerWhileWriting(n: number, rowsPerWorker: number) {
  const dbPath = join(DIR, `bench-reader-${n}.db`)
  freshDb(dbPath)

  const resultPaths: string[] = []
  const procs: Bun.Subprocess[] = []
  for (let i = 0; i < n; i++) {
    const resultPath = join(DIR, `result-reader-${n}-${i}.json`)
    resultPaths.push(resultPath)
    procs.push(
      Bun.spawn(['bun', 'worker.ts', dbPath, String(i), String(rowsPerWorker), String(BATCH_SIZE), resultPath], { cwd: DIR, stdout: 'pipe', stderr: 'pipe' })
    )
  }
  const readerResultPath = join(DIR, `reader-${n}.json`)
  const readerProc = Bun.spawn(['bun', 'reader.ts', dbPath, '5000', readerResultPath], { cwd: DIR, stdout: 'pipe', stderr: 'pipe' })

  const t0 = Date.now()
  await Promise.all(procs.map((p) => p.exited))
  await readerProc.exited
  const wallMs = Date.now() - t0

  const readerResult = existsSync(readerResultPath) ? JSON.parse(readFileSync(readerResultPath, 'utf8')) : null

  const db = new Database(dbPath, { readonly: true })
  const [{ cnt }] = db.query('SELECT COUNT(*) as cnt FROM events').all() as { cnt: number }[]
  db.close()

  return { n, rowsPerWorker, expected: n * rowsPerWorker, actualRowCount: cnt, readerTotalWallMs: wallMs, readerResult }
}

async function jsonlComparison(n: number) {
  const path = join(DIR, `bench-${n}.jsonl`)
  try { rmSync(path) } catch {}
  writeFileSync(path, '')

  const script = `
    import { openSync, writeSync, closeSync } from 'node:fs'
    import { randomUUID } from 'node:crypto'
    const [path, workerId, rows, batch] = process.argv.slice(2)
    const fd = openSync(path, 'a')
    for (let i = 0; i < Number(rows); i += Number(batch)) {
      let buf = ''
      const n = Math.min(Number(batch), Number(rows) - i)
      for (let j = 0; j < n; j++) {
        buf += JSON.stringify({ event_id: \`w\${workerId}-\${i+j}-\${randomUUID()}\`, ts: new Date().toISOString(), workerId: Number(workerId), seq: i+j, payload: 'x'.repeat(64) }) + '\\n'
      }
      writeSync(fd, buf)
    }
    closeSync(fd)
  `
  writeFileSync(join(DIR, 'jsonl-worker.ts'), script)

  const t0 = Date.now()
  const procs = Array.from({ length: n }, (_, i) =>
    Bun.spawn(['bun', 'jsonl-worker.ts', path, String(i), String(ROWS_PER_WORKER), String(BATCH_SIZE)], { cwd: DIR, stdout: 'pipe' })
  )
  await Promise.all(procs.map((p) => p.exited))
  const wallMs = Date.now() - t0

  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  const ids = new Set<string>()
  let parseErrors = 0
  for (const line of lines) {
    try { ids.add(JSON.parse(line).event_id) } catch { parseErrors++ }
  }

  return { n, expected: n * ROWS_PER_WORKER, linesWritten: lines.length, distinctIds: ids.size, parseErrors, wallMs, aggregateRowsPerSec: (n * ROWS_PER_WORKER) / (wallMs / 1000) }
}

async function main() {
  for (const n of [1, 2, 4, 8]) console.log(JSON.stringify(await runConcurrency(n, false), null, 2))
  console.log(JSON.stringify(await readerWhileWriting(4, 30000), null, 2))
  for (const n of [1, 2, 4, 8]) console.log(JSON.stringify(await jsonlComparison(n), null, 2))
}

main()
```

### `killer-writer.ts` (used by the kill-mid-transaction test)
```ts
import { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

const [dbPath] = process.argv.slice(2)
const db = new Database(dbPath, { create: true })
db.exec('PRAGMA busy_timeout = 5000;')
db.exec('PRAGMA journal_mode = WAL;')

const insert = db.prepare(
  `INSERT INTO events (event_id, schema, type, occurred_at, recorded_at, session_id, run_id,
     agent_id, task_id, source_kind, source_id, source_version, mode, confidence,
     adapter_version, source_ref, data)
   VALUES ($event_id, 1, 'kill-test', $ts, $ts, NULL, 'kill-run', NULL, NULL, 'bench',
     'killer', NULL, 'live', 'measured', 'bench-1', NULL, 'x')`
)

db.exec('BEGIN IMMEDIATE;')
for (let i = 0; i < 2_000_000; i++) {
  insert.run({ $event_id: `kill-${i}-${randomUUID()}`, $ts: new Date().toISOString() })
  if (i % 1000 === 0) Bun.sleepSync(2) // wide window for the parent to SIGKILL mid-transaction
}
db.exec('COMMIT;')
```

Run the kill test by spawning `killer-writer.ts`, `SIGKILL`ing it ~300-500ms in, then reopening the
db and checking `SELECT COUNT(*)`, `PRAGMA integrity_check`, and that a fresh write (retried a few
times on `SQLITE_BUSY`) succeeds.
