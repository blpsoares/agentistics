import { join, dirname } from 'path'
import { mkdir, rename, writeFile } from 'node:fs/promises'
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
    // Re-check under the chain: primary may have been created (by our own read above racing
    // another queued write, or by that write itself) since we decided to migrate.
    const p2 = await readJsonPrefs(primary)
    if (p2) return withMigratedTeam(p2)
    // The legacy dir may be read-only (Docker), so a failed migration write is expected and
    // ignored — the caller still gets the migrated-in-memory result.
    try { await writeFileAtomic(primary, JSON.stringify(prefs, null, 2)) } catch { /* read-only legacy dir */ }
    return prefs
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

/** Single write chain for the WHOLE module: every enqueued function awaits the previous one,
 *  so a read-merge-write can never interleave with another queued write and lose the
 *  connections array. Both `writePreferencesTo` and `readPreferencesFrom`'s legacy-migration
 *  branch enqueue onto this SAME chain, so the two can never interleave/clobber each other
 *  either.
 *
 *  Deadlock-freedom: `enqueueWrite` is called only from `writePreferencesTo` and from
 *  `readPreferencesFrom` (never from inside a callback already running as part of this chain).
 *  The callbacks queued here call `readEffective` (a plain, non-enqueuing read) and
 *  `writeFileAtomic` (plain fs I/O) — neither calls back into `enqueueWrite`. So no queued
 *  callback ever awaits a promise that is itself waiting on that same callback to finish; the
 *  chain is a straight FIFO with no cycle. */
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
function mergeTeamPayload(current: TeamConfig | undefined, incoming: TeamConfig): TeamConfig {
  if (Object.prototype.hasOwnProperty.call(incoming, 'connections')) return incoming
  const stored = current?.connections ?? []
  // With nothing stored there is no array to protect: run the payload through the migration so
  // a legacy flat edit that DOES name an endpoint still lands as a connection.
  if (stored.length === 0) return migrateTeamConfig(incoming)
  return migrateTeamConfig({ ...incoming, connections: stored })
}

/** Merge `prefs` over the current preferences and persist to `primary`. Exported for tests. */
export async function writePreferencesTo(primary: string, legacy: string, prefs: Preferences): Promise<void> {
  return enqueueWrite(async () => {
    const { prefs: current } = await readEffective(primary, legacy)
    const merged = { ...current, ...prefs }
    if (prefs.team) merged.team = mergeTeamPayload(current.team, prefs.team)
    await writeFileAtomic(primary, JSON.stringify(merged, null, 2))
  })
}

export async function writePreferences(prefs: Preferences): Promise<void> {
  return writePreferencesTo(PREFERENCES_FILE, LEGACY_PREFERENCES_FILE, prefs)
}
