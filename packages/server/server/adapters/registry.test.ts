import { test, expect } from 'bun:test'
import { getEnabledAdapters } from './types'

test('registry includes claude and codex when available', async () => {
  const ids = (await getEnabledAdapters()).map(a => a.id)
  expect(ids).toContain('claude')
  // codex is available on this machine
  expect(ids).toContain('codex')
})
