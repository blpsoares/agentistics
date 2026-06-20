import { test, expect } from 'bun:test'
import { existsSync } from 'fs'
import { claudeAdapter } from './claude'
import { CLAUDE_DIR } from '../config'

// Integration test: reads the real ~/.claude tree. CI-safe — when no Claude data
// is present, the all-claude invariant holds vacuously over an empty result.
test('claude adapter tags every session as claude (and loads data when present)', async () => {
  const sessions = await claudeAdapter.loadSessions()
  // Invariant must always hold, even for an empty result.
  expect(sessions.every(s => s.harness === 'claude')).toBe(true)
  // Only assert non-empty when this machine actually has Claude data on disk.
  if (existsSync(CLAUDE_DIR)) {
    expect(sessions.length).toBeGreaterThan(0)
  }
}, 120_000)
