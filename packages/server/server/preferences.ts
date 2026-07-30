import { join, dirname } from 'path'
import { mkdir, rename, writeFile, open, unlink, stat } from 'node:fs/promises'
import { AGENTISTICS_DATA_DIR, CLAUDE_DIR } from './config'
import type { TeamConfig } from '@agentistics/core'
import { migrateTeamConfig } from '@agentistics/core'

// Preferences live in the writable ~/.agentistics dir. The legacy location under CLAUDE_DIR
// is read-only in Docker (host ~/.claude mounted :ro), which silently broke persistence and
// re-asked the consent gate every launch. We still READ the legacy file (and migrate it) so
// native installs that predate this change keep their saved choices.
export const PREFERENCES_FILE = join(AGENTISTICS_DATA_DIR, 'preferences.json')
export const LEGACY_PREFERENCES_FILE = join(CLAUDE_DIR, 'agentistics-preferences.json')

export interface CustomGridItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
  componentId: string
}

export interface Preferences {
  customLayout?: CustomGridItem[]
  monthlyBudgetUSD?: number | null
  cardOrder?: string[]
  lang?: 'pt' | 'en'
  theme?: 'dark' | 'light'
  currency?: 'USD' | 'BRL'
  cardPrecision?: Record<string, boolean>
  chatModel?: string
  chatSoundEnabled?: boolean
  /** true once the user dismissed the install prompt with "don't show again".
   *  Persisted server-side (not localStorage) so it survives incognito windows. */
  installDismissed?: boolean
  /** How the app preserves session history past Claude's 30-day cleanup.
   *  `undefined` = not chosen yet (the blocking consent gate is shown).
   *    - 'consolidate' = store computed per-session metrics only (~KB, recommended)
   *    - 'full'        = mirror raw transcripts too (heavy, lets you re-read chats)
   *    - 'off'         = do nothing, use Claude's default folder */
  archiveMode?: 'off' | 'consolidate' | 'full'
  /** @deprecated legacy boolean — read by resolveArchiveMode for migration only */
  archiveSessions?: boolean
  /** Team mode configuration. Absent / mode=solo means solo behavior (no push). */
  team?: TeamConfig
}

export type ArchiveMode = 'off' | 'consolidate' | 'full'

/** Resolve the effective mode, migrating the legacy `archiveSessions` boolean.
 *  Returns undefined when the user has never chosen (gate must be shown). */
export function resolveArchiveMode(p: Preferences): ArchiveMode | undefined {
  if (p.archiveMode) return p.archiveMode
  if (p.archiveSessions === true) return 'full'
  if (p.archiveSessions === false) return 'off'
  return undefined
}

export async function getArchiveMode(): Promise<ArchiveMode | undefined> {
  return resolveArchiveMode(await readPreferences())
}

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

/** Read the effective preferences (primary, else migrated legacy, else defaults) with NO
 *  side-effecting write. `writePreferencesTo`'s read-merge step uses this (never the
 *  write-triggering `readPreferencesFrom`) so it can never re-enter `enqueueWrite` from inside
 *  an already-running chained callback — see the deadlock note on `enqueueWrite`. */
async function readEffective(primary: string, legacy: string): Promise<{ prefs: Preferences; migratedFromLegacy: boolean }> {
  const p = await readJsonPrefs(primary)
  if (p) return { prefs: withMigratedTeam(p), migratedFromLegacy: false }
  let l: Preferences | null = null
  try {
    l = await readJsonPrefs(legacy)
  } catch {
    // A corrupt LEGACY file is not fatal — the primary is authoritative and the legacy
    // location is read-only in Docker. Treat it as absent.
    l = null
  }
  if (l) return { prefs: withMigratedTeam(l), migratedFromLegacy: true }
  return { prefs: defaultPrefs(), migratedFromLegacy: false }
}

/** Read preferences from `primary`, falling back to `legacy` (and migrating it to `primary`
 *  best-effort) when the primary file is absent. Exported for tests; `readPreferences` binds
 *  the real paths. */
export async function readPreferencesFrom(primary: string, legacy: string): Promise<Preferences> {
  const { prefs, migratedFromLegacy } = await readEffective(primary, legacy)
  if (!migratedFromLegacy) return prefs
  // One-time migration so future reads hit the writable primary. Routed through the SAME
  // write chain as writePreferencesTo (enqueueWrite): without this, two concurrent migration
  // writes (or a migration racing an explicit writePreferencesTo) would call writeFileAtomic
  // independently and could interleave/clobber each other. Safe against reentrancy —
  // readPreferencesFrom is never called from inside an enqueueWrite callback; see there.
  return enqueueWrite(async () => {
    const release = await acquireFileLock(primary)
    try {
      // Re-check under the chain (and now the cross-process lock): primary may have been
      // created — by our own read above racing another queued write, by that write itself, or
      // by a SEPARATE PROCESS that migrated first — since we decided to migrate.
      const p2 = await readJsonPrefs(primary)
      if (p2) return withMigratedTeam(p2)
      // The legacy dir may be read-only (Docker), so a failed migration write is expected and
      // ignored — the caller still gets the migrated-in-memory result.
      try { await writeFileAtomic(primary, JSON.stringify(prefs, null, 2)) } catch { /* read-only legacy dir */ }
      return prefs
    } finally {
      await release()
    }
  })
}

/** The ONE choke point where the shape migration runs, so every reader — CLI, uploader, WS
 *  client, GET/PUT /api/preferences — sees connections[]. Migrating only in the uploader
 *  would leave cli-status.ts, cli-start.ts and bin/cli.ts on the un-migrated shape. */
function withMigratedTeam(p: Preferences): Preferences {
  return { ...defaultPrefs(), ...p, team: migrateTeamConfig(p.team) }
}

export async function readPreferences(): Promise<Preferences> {
  return readPreferencesFrom(PREFERENCES_FILE, LEGACY_PREFERENCES_FILE)
}

/**
 * CLI entry points: read the preferences or die with ONE clear line naming the file.
 *
 * `readPreferences` now THROWS on a corrupt (present, non-empty, unparseable) file instead of
 * silently presenting the machine as solo. Every command that reads it must therefore say what
 * is wrong and exit non-zero — an unhandled rejection stack, or a bare `mode: solo`, are both
 * worse than the truth. Never prints the file's contents (it holds central tokens).
 */
export async function readPreferencesOrExit(): Promise<Preferences> {
  try {
    return await readPreferences()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    process.stderr.write(`agentop: cannot read ${PREFERENCES_FILE} — ${reason}\n`)
    process.stderr.write('  fix or move that file, then run the command again.\n')
    process.exit(1)
  }
}

/** Monotonic per-process counter mixed into every tmp filename so concurrent `writeFileAtomic`
 *  calls to the SAME target never pick the same tmp path — `${pid}` alone is unique per
 *  process, not per call, and two calls racing on the identical tmp name would interleave their
 *  writes before either `rename()` fires. */
let _tmpSeq = 0

/** tmp + rename. `Bun.write` truncates in place, so a concurrent reader can observe a
 *  half-written file; rename on the same filesystem is atomic. The tmp name is unique per
 *  CALL (pid + monotonic counter + random suffix), not just per process. */
async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${++_tmpSeq}-${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmp, text, 'utf-8')
  await rename(tmp, path)
}

// ---------------------------------------------------------------------------
// Cross-process lock — `enqueueWrite` only serializes writes WITHIN this process. Bun serves
// dashboard requests concurrently in the long-running server process while `cli-member.ts` (and
// any other CLI subcommand that falls back to a direct write — see cli-member.ts's docstring)
// writes the SAME preferences.json from a SEPARATE `bun` process with its own, independent
// `_writeChain`. Two processes racing a read-merge-write on the same file is the exact "two
// connections read [A,B,C], one writes [B,C], the other writes [A,C] from a stale read" hazard
// `updateTeamConfig` closes WITHIN a process — an O_EXCL lock FILE closes it ACROSS processes,
// since the filesystem is the only thing both processes can see.
// ---------------------------------------------------------------------------

/** A lock older than this is presumed abandoned by a crashed/killed process holding it, and is
 *  reclaimed rather than blocking every future write on this machine forever. Comfortably above
 *  how long a single read-merge-write-atomic-rename cycle could plausibly take. */
const LOCK_STALE_MS = 10_000
/** How long to wait on a LIVE lock (one whose mtime is still fresh) before giving up and
 *  proceeding WITHOUT it. A preferences write must never simply stop working because another
 *  process is slow — that would turn lock contention into an outage. The warning this logs is
 *  the visible signal that atomicity was not guaranteed for that one write. */
const LOCK_WAIT_TIMEOUT_MS = 5_000
const LOCK_POLL_MS = 40

function lockPathFor(primary: string): string {
  return `${primary}.lock`
}

/**
 * Acquire an O_EXCL lock file next to `primary`. `open(path, 'wx')` fails with EEXIST if the
 * file already exists — the same primitive `mkdir -p` style tools use for a filesystem mutex,
 * portable across the platforms this ships on (no `flock` dependency). Returns a release
 * function; the caller MUST call it in a `finally` (see `writePreferencesTo`/`updateTeamConfigAt`
 * below) or a crash mid-critical-section leaves a lock for the NEXT writer to reclaim once it
 * goes stale — never a permanent deadlock, but a real wait for `LOCK_STALE_MS`.
 */
async function acquireFileLock(primary: string): Promise<() => Promise<void>> {
  const lockPath = lockPathFor(primary)
  await mkdir(dirname(lockPath), { recursive: true })
  const start = Date.now()
  while (true) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.close()
      return async () => { try { await unlink(lockPath) } catch { /* already gone — fine */ } }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err
      // Someone else holds it (or held it and crashed) — decide whether to reclaim or wait.
      try {
        const st = await stat(lockPath)
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { await unlink(lockPath) } catch { /* another reclaimer won the race — loop and retry open */ }
          continue
        }
      } catch {
        continue // the lock vanished between our failed open() and this stat() — retry immediately
      }
      if (Date.now() - start > LOCK_WAIT_TIMEOUT_MS) {
        console.warn(`[preferences] lock at ${lockPath} held past ${LOCK_WAIT_TIMEOUT_MS}ms by another process — proceeding without it`)
        return async () => {}
      }
      await new Promise(resolve => setTimeout(resolve, LOCK_POLL_MS))
    }
  }
}

/** Single write chain for the WHOLE module: every enqueued function awaits the previous one,
 *  so a read-merge-write can never interleave with another queued write and lose the
 *  connections array. `writePreferencesTo`, `readPreferencesFrom`'s legacy-migration branch, and
 *  `updateTeamConfig` all enqueue onto this SAME chain, so none of the three can interleave or
 *  clobber another.
 *
 *  Deadlock-freedom: `enqueueWrite` is called only from those three call sites (never from inside
 *  a callback already running as part of this chain). The callbacks queued here call
 *  `readEffective` (a plain, non-enqueuing read) and `writeFileAtomic` (plain fs I/O) — neither
 *  calls back into `enqueueWrite`. `updateTeamConfig`'s `mutate` callback is synchronous and pure
 *  by contract (it must never itself call `readPreferences`/`writePreferences`/
 *  `updateTeamConfig`), so it cannot reintroduce a cycle either. No queued callback ever awaits a
 *  promise that is itself waiting on that same callback to finish; the chain is a straight FIFO
 *  with no cycle. */
let _writeChain: Promise<unknown> = Promise.resolve()

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeChain.then(fn, fn)
  _writeChain = next.catch(() => {})
  return next
}

/**
 * Spec §5.8: **a `team` payload with no `connections` key is a legacy single-connection edit,
 * never a replacement of the array.**
 *
 * The top-level merge is shallow, so any caller handing over a `team` object replaces the whole
 * connections array. An old cached tab — or an older sidecar sharing ~/.agentistics — that saves
 * Settings, or clicks Disconnect (which PUTs a full flat solo object), would otherwise delete
 * every connection and every denylist. When the payload carries `connections` explicitly it
 * replaces, exactly as before.
 */
/**
 * Spec §5.8: the GET response blanks every token, so the shape the UI holds cannot be written
 * back verbatim without destroying the credentials. An EMPTY incoming token therefore means
 * "unchanged", never "clear it": a stored non-empty token survives, matched by connection id and
 * falling back to the normalized endpoint for a payload that predates ids.
 *
 * A genuinely new connection carries no stored counterpart, so its empty token stays empty —
 * token-less members against an open central remain expressible.
 */
function keepStoredTokens(current: TeamConfig | undefined, incoming: TeamConfig): TeamConfig {
  const stored = current?.connections ?? []
  if (stored.length === 0) return incoming
  const byId = new Map(stored.map(c => [c.id, c]))
  const byEndpoint = new Map(stored.map(c => [c.endpoint.replace(/\/+$/, ''), c]))
  return {
    ...incoming,
    connections: (incoming.connections ?? []).map(c => {
      if (c.token) return c
      const previous = byId.get(c.id) ?? byEndpoint.get((c.endpoint ?? '').replace(/\/+$/, ''))
      return previous?.token ? { ...c, token: previous.token } : c
    }),
  }
}

function mergeTeamPayload(current: TeamConfig | undefined, incoming: TeamConfig): TeamConfig {
  if (Object.prototype.hasOwnProperty.call(incoming, 'connections')) {
    return keepStoredTokens(current, incoming)
  }
  const stored = current?.connections ?? []
  // With nothing stored there is no array to protect: run the payload through the migration so
  // a legacy flat edit that DOES name an endpoint still lands as a connection.
  if (stored.length === 0) return migrateTeamConfig(incoming)
  return migrateTeamConfig({ ...incoming, connections: stored })
}

/** Merge `prefs` over the current preferences and persist to `primary`. Exported for tests. */
export async function writePreferencesTo(primary: string, legacy: string, prefs: Preferences): Promise<void> {
  return enqueueWrite(async () => {
    const release = await acquireFileLock(primary)
    try {
      const { prefs: current } = await readEffective(primary, legacy)
      const merged = { ...current, ...prefs }
      if (prefs.team) merged.team = mergeTeamPayload(current.team, prefs.team)
      await writeFileAtomic(primary, JSON.stringify(merged, null, 2))
    } finally {
      await release()
    }
  })
}

export async function writePreferences(prefs: Preferences): Promise<void> {
  return writePreferencesTo(PREFERENCES_FILE, LEGACY_PREFERENCES_FILE, prefs)
}

/**
 * Atomically read-modify-write JUST the team config, running `mutate` INSIDE the single write
 * chain (`enqueueWrite`) instead of outside it.
 *
 * Why this exists: a plain `readPreferences()` followed by `writePreferences({ team })` reads the
 * current `connections[]` OUTSIDE the chain, then writes a value computed from that stale read.
 * With two callers racing (e.g. two connections both crossing their auth-error threshold in the
 * same window, which the concurrency cap makes routine, not theoretical) both read `[A, B, C]`;
 * A's removal writes `[B, C]`, then B's (computed from the SAME stale `[A, B, C]`) writes
 * `[A, C]` — A is back in preferences with its state files already unlinked, B is gone. A
 * mutator run inside the chain instead reads the CURRENT array at the moment it is its turn to
 * write, so the second caller sees the first caller's result and can never resurrect it.
 *
 * `mutate` receives the current (already-migrated) team config and returns the new one, or
 * `undefined` to signal "nothing to do" — no write happens in that case, so a caller like
 * `removeConnection` can stay idempotent without an extra disk write on a repeat call.
 */
export type TeamConfigMutator = (current: TeamConfig) => TeamConfig | undefined

/** Path-parameterized implementation — exported for tests (mirrors `writePreferencesTo`'s split
 *  from `writePreferences`), so the atomicity `updateTeamConfig` provides can be exercised
 *  against real tmp files and the REAL `enqueueWrite` chain, without ever touching the
 *  developer's actual `~/.agentistics/preferences.json`. */
export async function updateTeamConfigAt(primary: string, legacy: string, mutate: TeamConfigMutator): Promise<TeamConfig> {
  return enqueueWrite(async () => {
    const release = await acquireFileLock(primary)
    try {
      const { prefs: current } = await readEffective(primary, legacy)
      const currentTeam = current.team ?? migrateTeamConfig(undefined)
      const nextTeam = mutate(currentTeam)
      if (nextTeam === undefined) return currentTeam
      const merged = { ...current, team: mergeTeamPayload(current.team, nextTeam) }
      await writeFileAtomic(primary, JSON.stringify(merged, null, 2))
      return merged.team as TeamConfig
    } finally {
      await release()
    }
  })
}

export async function updateTeamConfig(mutate: TeamConfigMutator): Promise<TeamConfig> {
  return updateTeamConfigAt(PREFERENCES_FILE, LEGACY_PREFERENCES_FILE, mutate)
}

/**
 * Strip every secret from a preferences object before it leaves the process.
 *
 * `GET /api/preferences` is reachable from any page the user happens to visit (the port is
 * local, not private), and nothing in the UI needs a token: adding a connection POSTs one,
 * and probe/leave/test all run server-side. So the read-out blanks `team.connections[].token`
 * and drops the legacy `team.token` mirror entirely.
 *
 * Pure — never mutates its input. Total: a solo config, an absent `team` and a malformed one
 * all pass through without throwing.
 */
export function redactPreferences(prefs: Preferences): Preferences {
  if (!prefs?.team) return { ...prefs }
  const { token: _dropped, ...teamRest } = prefs.team
  const connections = Array.isArray(prefs.team.connections)
    ? prefs.team.connections.map(c => ({ ...c, token: '' }))
    : prefs.team.connections
  return { ...prefs, team: { ...teamRest, connections } as TeamConfig }
}
