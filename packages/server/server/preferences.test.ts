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

// Task 2: serialized/atomic writes + migrateTeamConfig at the single choke point + refuse to
// silently default over a corrupt primary file (which would present the machine as solo and
// discard every connection, denylist, archiveMode and layout).

import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir as osTmpdir } from 'node:os'

async function tmpPaths2() {
  const dir = await mkdtemp(join(osTmpdir(), 'agentistics-prefs-'))
  return { primary: join(dir, 'preferences.json'), legacy: join(dir, 'legacy.json') }
}

test('readPreferencesFrom migrates a legacy flat team block into connections[]', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writeFile(primary, JSON.stringify({
    team: { mode: 'member', endpoint: 'http://c:48080', org: 'acme', user: 'lucas', token: 'tok' },
  }))
  const prefs = await readPreferencesFrom(primary, legacy)
  expect(prefs.team?.connections).toHaveLength(1)
  expect(prefs.team?.connections[0]!.endpoint).toBe('http://c:48080')
  expect(prefs.team?.mode).toBe('member')
})

test('readPreferencesFrom returns defaults for an absent or empty file', async () => {
  const { primary, legacy } = await tmpPaths2()
  expect((await readPreferencesFrom(primary, legacy)).team?.connections).toEqual([])
  await writeFile(primary, '   ')
  expect((await readPreferencesFrom(primary, legacy)).team?.connections).toEqual([])
})

test('readPreferencesFrom THROWS on a corrupt non-empty file instead of silently defaulting', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writeFile(primary, '{"team": {"connections": [')
  await expect(readPreferencesFrom(primary, legacy)).rejects.toThrow()
})

test('the default team object is never shared between reads', async () => {
  const { primary, legacy } = await tmpPaths2()
  const a = await readPreferencesFrom(primary, legacy)
  const b = await readPreferencesFrom(primary, legacy)
  expect(a.team).not.toBe(b.team)
  a.team!.connections.push({ id: 'c_aaaaaaaaaaaa', endpoint: 'x', org: 'o', user: 'u', token: 't', deniedRepos: [] })
  expect(b.team!.connections).toEqual([])
})

test('concurrent writes are serialized — no lost update', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writePreferencesTo(primary, legacy, { theme: 'dark' })
  await Promise.all([
    writePreferencesTo(primary, legacy, { lang: 'pt' }),
    writePreferencesTo(primary, legacy, { currency: 'BRL' }),
    writePreferencesTo(primary, legacy, { monthlyBudgetUSD: 100 }),
  ])
  const prefs = await readPreferencesFrom(primary, legacy)
  expect(prefs.theme).toBe('dark')
  expect(prefs.lang).toBe('pt')
  expect(prefs.currency).toBe('BRL')
  expect(prefs.monthlyBudgetUSD).toBe(100)
})

test('a write leaves no partial file behind — the target is always valid JSON', async () => {
  const { primary, legacy } = await tmpPaths2()
  const writes = Array.from({ length: 40 }, (_, i) => writePreferencesTo(primary, legacy, { monthlyBudgetUSD: i }))
  await Promise.all(writes)
  const text = await readFile(primary, 'utf-8')
  expect(() => JSON.parse(text)).not.toThrow()
})
