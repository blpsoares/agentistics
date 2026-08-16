import { test, expect } from 'bun:test'
import { consolidatedPath } from './consolidate'

test('consolidatedPath namespaces by harness', () => {
  expect(consolidatedPath('codex', 'abc')).toMatch(/\/sessions\/codex\/abc\.json$/)
  expect(consolidatedPath('claude', 'xyz')).toMatch(/\/sessions\/claude\/xyz\.json$/)
})

test('consolidatedPath flattens path separators in the session id (Gemini)', () => {
  // Gemini session ids look like "project/session-2026-...": the slash must not
  // create an intermediate directory, or writeConsolidated fails with ENOENT.
  const p = consolidatedPath('gemini', 'mithrandir/session-2026-04-10T20-40-3217996b')
  expect(p).toMatch(/\/sessions\/gemini\/mithrandir_session-2026-04-10T20-40-3217996b\.json$/)
  expect(p).not.toContain('mithrandir/session')
})
