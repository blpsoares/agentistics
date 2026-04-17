import { join } from 'path'
import { CLAUDE_DIR } from './config'

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
}

const DEFAULT_PREFS: Preferences = {
  customLayout: [],
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
