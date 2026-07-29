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
