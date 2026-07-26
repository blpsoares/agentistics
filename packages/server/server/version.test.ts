import { test, expect } from 'bun:test'
import { compareVersions, isCriticalRelease, autoInstallAllowed, resolveLatestRelease } from './version'
// The unattended-upgrade lock lives in upgrade.ts, but its pure helpers are part of the
// same "smart auto-update" surface, so they are covered here alongside the version logic.
import { isInstalledBinary, isUpgradeLockActive, parseUpgradeLock, UPGRADE_LOCK_TTL_MS } from './upgrade'

test('compareVersions orders semver correctly', () => {
  expect(compareVersions('1.5.4', '1.5.3')).toBeGreaterThan(0)
  expect(compareVersions('1.5.3', '1.5.4')).toBeLessThan(0)
  expect(compareVersions('1.5.4', '1.5.4')).toBe(0)
  expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
  expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
})

// Picking the newest semver tag from a release list, ignoring the rolling
// "latest" tag — this is the logic that drives the in-app update banner.
const SEMVER_RE = /^\d+\.\d+\.\d+$/
function pickLatest(tags: string[], current: string): string {
  return tags
    .map(t => t.replace(/^v/, '').trim())
    .filter(v => SEMVER_RE.test(v))
    .sort((a, b) => compareVersions(b, a))[0] ?? current
}

test('newest semver tag is chosen, rolling "latest" tag ignored', () => {
  expect(pickLatest(['latest', 'v1.5.4', 'v1.5.3', 'v1.5.10'], '1.5.4')).toBe('1.5.10')
  expect(pickLatest(['latest'], '1.5.4')).toBe('1.5.4') // no semver → fall back to current (no false update)
})

// --- criticality marker -----------------------------------------------------

test('isCriticalRelease requires the [critical] marker on its own line', () => {
  expect(isCriticalRelease('[critical]')).toBe(true)
  expect(isCriticalRelease('  [critical]  ')).toBe(true)          // surrounding whitespace ok
  expect(isCriticalRelease('[CRITICAL]')).toBe(true)              // case-insensitive
  expect(isCriticalRelease('[Critical]')).toBe(true)
  expect(isCriticalRelease('## Fixes\n\n[critical]\n\n- data loss on sync')).toBe(true) // inside a longer body
  expect(isCriticalRelease('- fix\r\n[critical]\r\n- more')).toBe(true) // CRLF release notes
})

test('isCriticalRelease ignores prose and inline mentions', () => {
  expect(isCriticalRelease('Fixes a critical bug in the uploader.')).toBe(false)
  expect(isCriticalRelease('This is [critical] for team mode.')).toBe(false) // inline, not its own line
  expect(isCriticalRelease('[critical-ish]')).toBe(false)
  expect(isCriticalRelease('[ critical ]')).toBe(false)           // exact bracket form only
  expect(isCriticalRelease('')).toBe(false)
  expect(isCriticalRelease(null)).toBe(false)
  expect(isCriticalRelease(undefined)).toBe(false)
})

// --- resolveLatestRelease ---------------------------------------------------

test('resolveLatestRelease picks the newest published semver and flags criticality', () => {
  const releases = [
    { tag_name: 'latest', body: '[critical]' },       // rolling tag — never a version
    { tag_name: 'v1.6.0', body: 'routine polish' },
    { tag_name: 'v1.5.9', body: '[critical]\nfixes data loss' },
    { tag_name: 'v1.5.8', body: 'nothing to see' },
  ]
  // A critical release BETWEEN current and latest still forces the upgrade.
  expect(resolveLatestRelease(releases, '1.5.8')).toEqual({ latest: '1.6.0', hasUpdate: true, critical: true })
  // Already past the critical one → newer release is optional.
  expect(resolveLatestRelease(releases, '1.5.9')).toEqual({ latest: '1.6.0', hasUpdate: true, critical: false })
  // Up to date → never critical, never an update.
  expect(resolveLatestRelease(releases, '1.6.0')).toEqual({ latest: '1.6.0', hasUpdate: false, critical: false })
})

test('resolveLatestRelease ignores drafts and prereleases', () => {
  const releases = [
    { tag_name: 'v2.0.0', body: '[critical]', draft: true },
    { tag_name: 'v1.9.0', body: '[critical]', prerelease: true },
    { tag_name: 'v1.6.0', body: 'stable' },
  ]
  expect(resolveLatestRelease(releases, '1.5.0')).toEqual({ latest: '1.6.0', hasUpdate: true, critical: false })
  // No usable release at all → fall back to current, no false update.
  expect(resolveLatestRelease([], '1.5.0')).toEqual({ latest: '1.5.0', hasUpdate: false, critical: false })
})

// --- unattended-upgrade lock ------------------------------------------------

test('parseUpgradeLock accepts a valid lock and rejects junk', () => {
  expect(parseUpgradeLock('{"pid":42,"version":"1.6.0","startedAt":1000}'))
    .toEqual({ pid: 42, version: '1.6.0', startedAt: 1000 })
  expect(parseUpgradeLock('not json')).toBeNull()
  expect(parseUpgradeLock('{"version":"1.6.0"}')).toBeNull()   // no pid
  expect(parseUpgradeLock('{"pid":0}')).toBeNull()             // invalid pid
  expect(parseUpgradeLock('{"pid":"42"}')).toBeNull()
})

test('unattended upgrade only runs from the installed binary, never a source checkout', () => {
  expect(isInstalledBinary('/home/u/.local/bin/agentop', undefined)).toBe(true)
  expect(isInstalledBinary('C:\\tools\\agentop.exe', undefined)).toBe(true)
  // `bun packages/server/bin/cli.ts` — execPath is the bun runtime, replacing it would
  // clobber the user's bun install.
  expect(isInstalledBinary('/home/u/.bun/bin/bun', '/repo/packages/server/bin/cli.ts')).toBe(false)
  expect(isInstalledBinary('/usr/bin/node', '/repo/dist/cli.js')).toBe(false)
  expect(isInstalledBinary('/home/u/.bun/bin/bun', undefined)).toBe(false)
})

test('a lock is active only while its process lives and it is younger than the TTL', () => {
  const alive = () => true
  const dead = () => false
  const lock = { pid: 42, version: '1.6.0', startedAt: 1_000 }
  expect(isUpgradeLockActive(lock, 2_000, alive)).toBe(true)
  expect(isUpgradeLockActive(lock, 2_000, dead)).toBe(false)               // crashed upgrade
  expect(isUpgradeLockActive(lock, 1_000 + UPGRADE_LOCK_TTL_MS, alive)).toBe(false) // abandoned
  expect(isUpgradeLockActive(null, 2_000, alive)).toBe(false)              // no lock at all
})

test('unattended install is opt-in: only an explicit AGENTISTICS_AUTO_UPGRADE=1 enables it', () => {
  // Guards the DEFAULT, not the mechanism. Flipping this back to opt-out re-arms an unverified,
  // non-atomic, arch-blind binary replacement on every shell that opens.
  expect(autoInstallAllowed({})).toBe(false)
  expect(autoInstallAllowed({ AGENTISTICS_AUTO_UPGRADE: undefined })).toBe(false)
  expect(autoInstallAllowed({ AGENTISTICS_AUTO_UPGRADE: '' })).toBe(false)
  expect(autoInstallAllowed({ AGENTISTICS_AUTO_UPGRADE: '0' })).toBe(false)
  expect(autoInstallAllowed({ AGENTISTICS_AUTO_UPGRADE: 'true' })).toBe(false)
  expect(autoInstallAllowed({ AGENTISTICS_AUTO_UPGRADE: 'yes' })).toBe(false)
  expect(autoInstallAllowed({ AGENTISTICS_AUTO_UPGRADE: '1' })).toBe(true)
})
