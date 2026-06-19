import { test, expect } from 'bun:test'
import { claudeAdapter } from './claude'

test('claude adapter returns sessions all tagged claude', async () => {
  const sessions = await claudeAdapter.loadSessions()
  // On this machine ~/.claude exists with sessions
  expect(sessions.length).toBeGreaterThan(0)
  expect(sessions.every(s => s.harness === 'claude')).toBe(true)
}, 60_000)
