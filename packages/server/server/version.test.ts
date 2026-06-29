import { test, expect } from 'bun:test'
import { compareVersions } from './version'

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
