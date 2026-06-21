import { test, expect } from 'bun:test'
import { existsSync } from 'fs'
import { getEnabledAdapters } from './types'
import { CODEX_SESSIONS_DIR, GEMINI_DIR, COPILOT_DIR } from '../config'

const KNOWN_HARNESS_IDS = new Set(['claude', 'codex', 'gemini', 'copilot'])

test('registry returns only known harness ids, always includes claude', async () => {
  const adapters = await getEnabledAdapters()
  const ids = adapters.map(a => a.id)

  // claude is always present (no directory requirement)
  expect(ids).toContain('claude')

  // no unexpected ids may appear
  for (const id of ids) {
    expect(KNOWN_HARNESS_IDS.has(id)).toBe(true)
  }

  // each optional harness is present if and only if its directory exists
  if (existsSync(CODEX_SESSIONS_DIR)) {
    expect(ids).toContain('codex')
  }

  if (existsSync(GEMINI_DIR)) {
    expect(ids).toContain('gemini')
  }

  if (existsSync(COPILOT_DIR)) {
    expect(ids).toContain('copilot')
  }
})
