import { join } from 'path'
import { CLAUDE_DIR } from './config'
import type { TeamConfig } from '@agentistics/core'
import { DEFAULT_TEAM } from '@agentistics/core'

export const PREFERENCES_FILE = join(CLAUDE_DIR, 'agentistics-preferences.json')

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

export async function readPreferences(): Promise<Preferences> {
  try {
    const file = Bun.file(PREFERENCES_FILE)
    if (!(await file.exists())) return DEFAULT_PREFS
    const text = await file.text()
    if (!text.trim()) return DEFAULT_PREFS
    const parsed = JSON.parse(text) as Preferences
    return { ...DEFAULT_PREFS, ...parsed }
  } catch (err) {
    console.error('[preferences] failed to read', err)
    return DEFAULT_PREFS
  }
}

export async function writePreferences(prefs: Preferences): Promise<void> {
  const current = await readPreferences()
  const merged = { ...current, ...prefs }
  await Bun.write(PREFERENCES_FILE, JSON.stringify(merged, null, 2))
}
