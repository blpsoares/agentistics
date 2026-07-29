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

import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir as osTmpdir } from 'node:os'
import { dirname } from 'node:path'

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

/**
 * A CONCURRENT READER is what makes this test about atomicity. Asserting only that the file
 * parses AFTER every write has settled passes just as well against a plain `Bun.write`, which
 * truncates in place — the torn state exists, the old test simply never looked at it. Here a
 * second task reads the file in a tight loop while the writes run and every single read must
 * parse.
 */
async function readUntilDone(path: string, done: () => boolean): Promise<number> {
  let reads = 0
  while (!done()) {
    let text: string
    try {
      text = await readFile(path, 'utf-8')
    } catch {
      continue // not created yet, or observed exactly between unlink and rename — not a tear
    }
    if (text === '') continue
    reads++
    JSON.parse(text) // throws → the reader observed a partially written file
    await new Promise(r => setTimeout(r, 0))
  }
  return reads
}

test('a concurrent reader NEVER observes a partially written file', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writePreferencesTo(primary, legacy, { monthlyBudgetUSD: -1 })
  let finished = false
  const reader = readUntilDone(primary, () => finished)
  const writes = Array.from({ length: 40 }, (_, i) => writePreferencesTo(primary, legacy, { monthlyBudgetUSD: i, theme: i % 2 ? 'dark' : 'light' }))
  await Promise.all(writes)
  finished = true
  const reads = await reader
  expect(reads).toBeGreaterThan(0)
  const text = await readFile(primary, 'utf-8')
  expect(() => JSON.parse(text)).not.toThrow()
  const leftoverTmp = (await readdir(dirname(primary))).filter(f => f.includes('.tmp-'))
  expect(leftoverTmp).toEqual([])
})

// Follow-up fix (review): writeFileAtomic's tmp name used to be unique only per PROCESS
// (`${path}.tmp-${process.pid}`), not per call. readPreferencesFrom's legacy-migration branch
// called writeFileAtomic directly, outside the write chain writePreferencesTo uses — two
// concurrent migration writes (or a migration racing writePreferencesTo) could pick the
// IDENTICAL tmp filename and interleave/corrupt it before either rename() fired. Fixed by (1)
// mixing a monotonic counter + random suffix into the tmp name so every call gets a distinct
// path, and (2) routing the migration write through the SAME `enqueueWrite` chain as
// writePreferencesTo (via a non-writing `readEffective` helper so the chain can't re-enter
// itself and deadlock).

test('concurrent legacy-migration reads never collide on the tmp filename — a reader mid-flight always sees whole JSON', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writeFile(legacy, JSON.stringify({ archiveMode: 'full', theme: 'light' }))
  let finished = false
  const reader = readUntilDone(primary, () => finished)
  const results = await Promise.all(Array.from({ length: 20 }, () => readPreferencesFrom(primary, legacy)))
  finished = true
  await reader
  for (const r of results) {
    expect(r.archiveMode).toBe('full')
    expect(r.theme).toBe('light')
  }
  const text = await readFile(primary, 'utf-8')
  expect(() => JSON.parse(text)).not.toThrow()
  const leftoverTmp = (await readdir(dirname(primary))).filter(f => f.includes('.tmp-'))
  expect(leftoverTmp).toEqual([])
})

test('a legacy migration racing an explicit write never loses either — both survive', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writeFile(legacy, JSON.stringify({ archiveMode: 'full', theme: 'light' }))
  const [migrated] = await Promise.all([
    readPreferencesFrom(primary, legacy),
    writePreferencesTo(primary, legacy, { installDismissed: true }),
  ])
  // The migration read itself always sees the legacy content (in-memory result), regardless
  // of which write wins the race to land on disk first.
  expect(migrated.archiveMode).toBe('full')
  expect(migrated.theme).toBe('light')
  // The FINAL on-disk state must have both the migrated legacy fields and the explicit write —
  // neither the migration's write nor writePreferencesTo's write may clobber the other's data.
  const final = await readPreferencesFrom(primary, legacy)
  expect(final.archiveMode).toBe('full')
  expect(final.theme).toBe('light')
  expect(final.installDismissed).toBe(true)
})

// I4 / spec §5.8: a `team` payload with NO `connections` key is a legacy single-connection edit,
// never a replacement of the array. The shallow top-level merge would otherwise let an old
// cached tab (or an older sidecar sharing ~/.agentistics) wipe every connection and denylist.

const conn = (id: string, endpoint: string, denied: string[] = []) => ({
  id, endpoint, org: 'default', user: 'u', token: 'tok', deniedRepos: denied,
})

test('a legacy-shaped team payload CANNOT empty a stored two-connection array', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writePreferencesTo(primary, legacy, {
    team: { schema: 2, mode: 'member', connections: [conn('c_aaaaaaaaaaaa', 'http://a:48080', ['github.com/o/secret']), conn('c_bbbbbbbbbbbb', 'http://b:48080')] },
  })
  // The pre-upgrade SPA's "Disconnect": a full flat solo object, no connections key.
  await writePreferencesTo(primary, legacy, { team: { mode: 'solo', endpoint: '', token: '', user: '', org: 'default' } as never })
  const prefs = await readPreferencesFrom(primary, legacy)
  expect(prefs.team?.connections.map(c => c.id)).toEqual(['c_aaaaaaaaaaaa', 'c_bbbbbbbbbbbb'])
  expect(prefs.team?.connections[0]!.deniedRepos).toEqual(['github.com/o/secret'])
  expect(prefs.team?.mode).toBe('member')
})

test('a team payload WITH a connections key replaces the array, as before', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writePreferencesTo(primary, legacy, {
    team: { schema: 2, mode: 'member', connections: [conn('c_aaaaaaaaaaaa', 'http://a:48080'), conn('c_bbbbbbbbbbbb', 'http://b:48080')] },
  })
  await writePreferencesTo(primary, legacy, {
    team: { schema: 2, mode: 'member', connections: [conn('c_cccccccccccc', 'http://c:48080')] },
  })
  const prefs = await readPreferencesFrom(primary, legacy)
  expect(prefs.team?.connections.map(c => c.id)).toEqual(['c_cccccccccccc'])
})

test('a legacy flat team edit on a machine with NO stored connections still lands as one', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writePreferencesTo(primary, legacy, { team: { mode: 'member', endpoint: 'http://c:48080', token: 't', user: 'lucas', org: 'acme' } as never })
  const prefs = await readPreferencesFrom(primary, legacy)
  expect(prefs.team?.connections).toHaveLength(1)
  expect(prefs.team?.connections[0]!.endpoint).toBe('http://c:48080')
  expect(prefs.team?.mode).toBe('member')
})

test('a legacy team edit leaves the rest of the preferences alone', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writePreferencesTo(primary, legacy, { theme: 'light', archiveMode: 'consolidate' })
  await writePreferencesTo(primary, legacy, { team: { mode: 'solo' } as never })
  const prefs = await readPreferencesFrom(primary, legacy)
  expect(prefs.theme).toBe('light')
  expect(prefs.archiveMode).toBe('consolidate')
})

test('a corrupt LEGACY file does not throw — the primary is authoritative and legacy corruption is not fatal', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writeFile(legacy, '{not valid json')
  const prefs = await readPreferencesFrom(primary, legacy)
  expect(prefs.team?.connections).toEqual([])
  expect(prefs.customLayout).toEqual([])
})

// ---------------------------------------------------------------------------
// Secret redaction on read-out (spec §5.8)
// ---------------------------------------------------------------------------

import { redactPreferences } from './preferences'
import type { Preferences } from './preferences'

function prefsWithTokens(): Preferences {
  return {
    theme: 'dark',
    team: {
      schema: 2,
      mode: 'member',
      connections: [
        { id: 'c_0123456789ab', endpoint: 'http://a:48080', org: 'acme', user: 'lucas', token: 'SECRET-A', deniedRepos: ['github.com/o/r'] },
        { id: 'c_ba9876543210', endpoint: 'http://b:48080', org: 'default', user: 'lucas', token: 'SECRET-B', deniedRepos: [] },
      ],
      endpoint: 'http://a:48080', org: 'acme', user: 'lucas', token: 'SECRET-A',
    },
  } as Preferences
}

test('redactPreferences blanks every connection token and drops the legacy mirror', () => {
  const out = redactPreferences(prefsWithTokens())
  expect(out.team!.connections.map(c => c.token)).toEqual(['', ''])
  expect(out.team!.token).toBeUndefined()
  expect(JSON.stringify(out)).not.toContain('SECRET-A')
  expect(JSON.stringify(out)).not.toContain('SECRET-B')
})

test('redactPreferences keeps everything the UI actually needs', () => {
  const out = redactPreferences(prefsWithTokens())
  expect(out.theme).toBe('dark')
  expect(out.team!.mode).toBe('member')
  expect(out.team!.connections[0]!.endpoint).toBe('http://a:48080')
  expect(out.team!.connections[0]!.user).toBe('lucas')
  expect(out.team!.connections[0]!.deniedRepos).toEqual(['github.com/o/r'])
  expect(out.team!.endpoint).toBe('http://a:48080')
})

test('redactPreferences never mutates its input', () => {
  const input = prefsWithTokens()
  redactPreferences(input)
  expect(input.team!.connections[0]!.token).toBe('SECRET-A')
  expect(input.team!.token).toBe('SECRET-A')
})

test('redactPreferences is total — solo, absent team and a missing array', () => {
  expect(redactPreferences({} as Preferences).team).toBeUndefined()
  const solo = redactPreferences({ team: { schema: 2, mode: 'solo', connections: [] } } as Preferences)
  expect(solo.team!.connections).toEqual([])
  expect(() => redactPreferences({ team: { mode: 'member' } } as unknown as Preferences)).not.toThrow()
})

test('a PUT of the REDACTED shape cannot blank a stored token', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writePreferencesTo(primary, legacy, prefsWithTokens())
  const redacted = redactPreferences(await readPreferencesFrom(primary, legacy))

  await writePreferencesTo(primary, legacy, { team: redacted.team })

  const after = await readPreferencesFrom(primary, legacy)
  expect(after.team!.connections.map(c => c.token)).toEqual(['SECRET-A', 'SECRET-B'])
  expect(after.team!.connections).toHaveLength(2)
})

test('a genuine token change still lands — an empty token only ever means "unchanged"', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writePreferencesTo(primary, legacy, prefsWithTokens())
  const team = (await readPreferencesFrom(primary, legacy)).team!
  team.connections[0]!.token = 'ROTATED'
  team.connections[1]!.token = ''

  await writePreferencesTo(primary, legacy, { team })

  const after = await readPreferencesFrom(primary, legacy)
  expect(after.team!.connections[0]!.token).toBe('ROTATED')
  expect(after.team!.connections[1]!.token).toBe('SECRET-B')
})

test('a brand-new connection with no token is still stored token-less', async () => {
  const { primary, legacy } = await tmpPaths2()
  await writePreferencesTo(primary, legacy, prefsWithTokens())
  const team = (await readPreferencesFrom(primary, legacy)).team!
  team.connections.push({ id: 'c_ffffffffffff', endpoint: 'http://open:48080', org: 'default', user: 'lucas', token: '', deniedRepos: [] })

  await writePreferencesTo(primary, legacy, { team })

  const after = await readPreferencesFrom(primary, legacy)
  expect(after.team!.connections).toHaveLength(3)
  expect(after.team!.connections[2]!.token).toBe('')
})
