import { test, expect } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { readPreferencesFrom, writePreferencesTo } from './preferences'

// Regression: preferences were stored under CLAUDE_DIR, which in Docker (machine +
// self-contributing central) is the host ~/.claude mounted READ-ONLY at /host-claude.
// writePreferences therefore failed (EROFS) and every launch re-asked the archive-mode
// consent gate + the install prompt. Preferences must live in the writable ~/.agentistics
// dir, with a one-time migration from the legacy CLAUDE_DIR location so native installs
// keep their existing choices.

function tmpPaths() {
  const base = join(tmpdir(), `agentistics-prefs-${crypto.randomUUID()}`)
  return {
    primary: join(base, 'agentistics', 'preferences.json'),
    legacy: join(base, 'claude', 'agentistics-preferences.json'),
  }
}

test('write then read round-trips through the primary (writable) path', async () => {
  const { primary, legacy } = tmpPaths()
  await writePreferencesTo(primary, legacy, { installDismissed: true, archiveMode: 'consolidate' })
  const p = await readPreferencesFrom(primary, legacy)
  expect(p.installDismissed).toBe(true)
  expect(p.archiveMode).toBe('consolidate')
  expect(await Bun.file(primary).exists()).toBe(true)
})

test('falls back to the legacy file and migrates it to the primary', async () => {
  const { primary, legacy } = tmpPaths()
  await Bun.write(legacy, JSON.stringify({ archiveMode: 'full', theme: 'light' }))
  const p = await readPreferencesFrom(primary, legacy)
  expect(p.archiveMode).toBe('full')
  expect(p.theme).toBe('light')
  // migration: the primary now exists so future reads never touch the (read-only) legacy dir
  expect(await Bun.file(primary).exists()).toBe(true)
})

test('primary wins over legacy when both exist', async () => {
  const { primary, legacy } = tmpPaths()
  await Bun.write(legacy, JSON.stringify({ archiveMode: 'off' }))
  await Bun.write(primary, JSON.stringify({ archiveMode: 'consolidate' }))
  const p = await readPreferencesFrom(primary, legacy)
  expect(p.archiveMode).toBe('consolidate')
})

test('both missing yields defaults (archiveMode undefined → gate shows once)', async () => {
  const { primary, legacy } = tmpPaths()
  const p = await readPreferencesFrom(primary, legacy)
  expect(p.archiveMode).toBeUndefined()
  expect(p.customLayout).toEqual([])
})

test('writePreferencesTo merges with legacy values on first write', async () => {
  const { primary, legacy } = tmpPaths()
  await Bun.write(legacy, JSON.stringify({ theme: 'light' }))
  await writePreferencesTo(primary, legacy, { installDismissed: true })
  const p = await readPreferencesFrom(primary, legacy)
  expect(p.theme).toBe('light')        // preserved from legacy
  expect(p.installDismissed).toBe(true)
})
