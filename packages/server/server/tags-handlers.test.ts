import { test, expect } from 'bun:test'
import { stampLocalMachine, LOCAL_MACHINE_ID } from './tags-handlers'
import { resolveTagSessions, type TagSource, type TagLookups } from './tags-resolve'
import type { SessionMeta } from '@agentistics/core'

// The solo path of tags-handlers: off a central there is exactly ONE machine, and `machine:local`
// is the only machine source the solo UI offers. Pure input → output, so no fs or Mongo is involved.

function s(over: Partial<SessionMeta>): SessionMeta {
  return { session_id: 'x', project_path: '/p', harness: 'claude', ...over } as SessionMeta
}

const noLookups: TagLookups = { machinesByAccount: {} }
const machineLocal: TagSource[] = [{ type: 'machine', value: LOCAL_MACHINE_ID }]

// Regression: the stamp used to be conditional (`s.memberId ? s : {...s, memberId: local}`), so a
// session revived from ~/.agentistics/sessions after this machine had been enrolled to a central —
// and therefore still carrying the central-minted memberId — was silently excluded from the tag.
test('every local session is attributed to the single local machine, even a pre-stamped one', () => {
  const sessions = [
    s({ session_id: 'fresh' }),
    s({ session_id: 'revived', memberId: 'a9f3centralmintedhash' }),
    s({ session_id: 'other-machine', memberId: 'deadbeefhash' }),
  ]
  const stamped = stampLocalMachine(sessions)
  expect(stamped.map(x => x.memberId)).toEqual([LOCAL_MACHINE_ID, LOCAL_MACHINE_ID, LOCAL_MACHINE_ID])

  // What actually broke: resolution against the only machine source solo mode offers.
  const matched = resolveTagSessions(stamped, machineLocal, noLookups)
  expect(matched.map(x => x.session_id).sort()).toEqual(['fresh', 'other-machine', 'revived'])
})

test('stamping copies — the sessions /api/data serves are never mutated', () => {
  const original = s({ session_id: 'revived', memberId: 'a9f3centralmintedhash' })
  const [copy] = stampLocalMachine([original])
  expect(original.memberId).toBe('a9f3centralmintedhash')
  expect(copy).not.toBe(original)
  expect(copy!.memberId).toBe(LOCAL_MACHINE_ID)
  expect(copy!.project_path).toBe(original.project_path)
})
