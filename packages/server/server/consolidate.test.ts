import { test, expect } from 'bun:test'
import { consolidatedPath } from './consolidate'

test('consolidatedPath namespaces by harness', () => {
  expect(consolidatedPath('codex', 'abc')).toMatch(/\/sessions\/codex\/abc\.json$/)
  expect(consolidatedPath('claude', 'xyz')).toMatch(/\/sessions\/claude\/xyz\.json$/)
})
