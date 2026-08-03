import { test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { convertSentStateV1 } from './team-migrate'

test('a v1 entry converts to sha256 of its own stored value', () => {
  const sessionJson = JSON.stringify({ session_id: 'a', input_tokens: 1 })
  const out = convertSentStateV1({ a: sessionJson })!
  expect(out.version).toBe(2)
  expect(out.hashes.a).toBe(createHash('sha256').update(sessionJson).digest('hex'))
  expect(out.runIds).toEqual([])
})

test('an already-v2 file is returned as-is', () => {
  const v2 = { version: 2 as const, hashes: { a: 'ff'.repeat(32) }, runIds: ['r1'] }
  expect(convertSentStateV1(v2)).toEqual(v2)
})

test('junk and unconvertible shapes yield null, never a half file', () => {
  for (const junk of [null, undefined, 42, 'nope', [], { a: 7 }, { version: 9, hashes: {} }]) {
    expect(convertSentStateV1(junk)).toBeNull()
  }
})

test('an empty v1 file converts to an empty v2 file', () => {
  expect(convertSentStateV1({})).toEqual({ version: 2, hashes: {}, runIds: [] })
})

// ---------------------------------------------------------------------------
// M4 — the marker path must be resolved per call, not frozen at module load.
//
// `TEAM_CONN_DIR` is a LIVE binding (`__setTeamConnDirForTests` reassigns it); a `const MARKER`
// captured at import time kept pointing at the developer's real ~/.agentistics/connections, so the
// first test ever written for `migrateTeamStateOnce` would have written its marker there while
// every other path it touches went to a tmp dir. Reads/writes nothing itself.
// ---------------------------------------------------------------------------

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { markerFile } from './team-migrate'
import { TEAM_CONN_DIR, __setTeamConnDirForTests } from './config'

test('markerFile() follows TEAM_CONN_DIR at call time', () => {
  const original = TEAM_CONN_DIR
  try {
    const redirected = join(tmpdir(), 'agentistics-marker-path-check')
    __setTeamConnDirForTests(redirected)
    expect(markerFile()).toBe(join(redirected, '.migrated-v2'))
  } finally {
    // Restored immediately, in the same synchronous test body, so no other test file can observe
    // the redirection (this suite shares one process).
    __setTeamConnDirForTests(original)
  }
  expect(markerFile()).toBe(join(original, '.migrated-v2'))
})
