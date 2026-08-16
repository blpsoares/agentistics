import { describe, expect, test } from 'bun:test'
import { resolveArchiveChoice } from './archive'

describe('resolveArchiveChoice', () => {
  test('an explicit archiveMode wins', () => {
    expect(resolveArchiveChoice({ archiveMode: 'consolidate' })).toBe('consolidate')
    expect(resolveArchiveChoice({ archiveMode: 'full' })).toBe('full')
    expect(resolveArchiveChoice({ archiveMode: 'off' })).toBe('off')
  })

  test('archiveMode wins even when the legacy boolean disagrees', () => {
    expect(resolveArchiveChoice({ archiveMode: 'off', archiveSessions: true })).toBe('off')
  })

  test('migrates the legacy archiveSessions boolean when archiveMode is absent', () => {
    expect(resolveArchiveChoice({ archiveSessions: true })).toBe('full')
    expect(resolveArchiveChoice({ archiveSessions: false })).toBe('off')
  })

  test('returns null (show the gate) only for a genuine first-run body', () => {
    // A real 200 with nothing chosen yet → null triggers the consent gate. This is the ONLY
    // path that may yield null; a failed load must never reach here (regression guard for the
    // bug where a transient fetch error re-showed the gate to a user who already chose).
    expect(resolveArchiveChoice({})).toBeNull()
  })
})
