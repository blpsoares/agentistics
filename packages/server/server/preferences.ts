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

/** Read preferences from `primary`, falling back to `legacy` (and migrating it to `primary`
 *  best-effort) when the primary file is absent. Exported for tests; `readPreferences` binds
 *  the real paths. */
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
    // One-time migration so future reads hit the writable primary. The legacy dir may be
    // read-only (Docker), so a failed migration write is expected and ignored.
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

export async function readPreferences(): Promise<Preferences> {
  return readPreferencesFrom(PREFERENCES_FILE, LEGACY_PREFERENCES_FILE)
}

/** tmp + rename. `Bun.write` truncates in place, so a concurrent reader can observe a
 *  half-written file; rename on the same filesystem is atomic. */
async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, text, 'utf-8')
  await rename(tmp, path)
}

/** Single-writer chain: every write awaits the previous one, so a read-merge-write can never
 *  interleave with another and lose the connections array. */
let _writeChain: Promise<unknown> = Promise.resolve()

/** Merge `prefs` over the current preferences and persist to `primary`. Exported for tests. */
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

export async function writePreferences(prefs: Preferences): Promise<void> {
  return writePreferencesTo(PREFERENCES_FILE, LEGACY_PREFERENCES_FILE, prefs)
}
