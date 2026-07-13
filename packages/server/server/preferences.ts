import { join } from 'path'
import { AGENTISTICS_DATA_DIR, CLAUDE_DIR } from './config'
import type { TeamConfig } from '@agentistics/core'
import { DEFAULT_TEAM } from '@agentistics/core'

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

const DEFAULT_PREFS: Preferences = {
  customLayout: [],
  team: DEFAULT_TEAM,
}

/** Read + parse a preferences JSON file, or null if it's absent/empty/corrupt. */
async function readJsonPrefs(path: string): Promise<Preferences | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    const text = await file.text()
    if (!text.trim()) return null
    return JSON.parse(text) as Preferences
  } catch (err) {
    console.error('[preferences] failed to read', path, err)
    return null
  }
}

/** Read preferences from `primary`, falling back to `legacy` (and migrating it to `primary`
 *  best-effort) when the primary file is absent. Exported for tests; `readPreferences` binds
 *  the real paths. */
export async function readPreferencesFrom(primary: string, legacy: string): Promise<Preferences> {
  const p = await readJsonPrefs(primary)
  if (p) return { ...DEFAULT_PREFS, ...p }
  const l = await readJsonPrefs(legacy)
  if (l) {
    // One-time migration so future reads hit the writable primary. The legacy dir may be
    // read-only (Docker), so a failed migration write is expected and ignored.
    try { await Bun.write(primary, JSON.stringify({ ...DEFAULT_PREFS, ...l }, null, 2)) } catch { /* read-only legacy dir */ }
    return { ...DEFAULT_PREFS, ...l }
  }
  return DEFAULT_PREFS
}

export async function readPreferences(): Promise<Preferences> {
  return readPreferencesFrom(PREFERENCES_FILE, LEGACY_PREFERENCES_FILE)
}

/** Merge `prefs` over the current preferences and persist to `primary`. Exported for tests. */
export async function writePreferencesTo(primary: string, legacy: string, prefs: Preferences): Promise<void> {
  const current = await readPreferencesFrom(primary, legacy)
  const merged = { ...current, ...prefs }
  await Bun.write(primary, JSON.stringify(merged, null, 2))
}

export async function writePreferences(prefs: Preferences): Promise<void> {
  return writePreferencesTo(PREFERENCES_FILE, LEGACY_PREFERENCES_FILE, prefs)
}
