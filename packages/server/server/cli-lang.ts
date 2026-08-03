/**
 * cli-lang.ts — resolves the CLI/TUI display language.
 *
 * Shared by the `agentop start` launcher and the terminal dashboard so the two never disagree.
 * Order: an explicit `--lang en|pt` flag, then `preferences.lang` (the same value the web
 * language toggle writes), then English.
 */

import { readPreferences } from './preferences'

export type CliLang = 'en' | 'pt'

export async function resolveLang(): Promise<CliLang> {
  const i = process.argv.indexOf('--lang')
  const flag = i >= 0 ? process.argv[i + 1] : undefined
  if (flag === 'pt' || flag === 'en') return flag
  try {
    const prefs = await readPreferences()
    return prefs.lang === 'pt' ? 'pt' : 'en'
  } catch {
    return 'en'
  }
}
