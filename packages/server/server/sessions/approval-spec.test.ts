import { describe, expect, it } from 'bun:test'
import { HARNESS_ORDER } from '@agentistics/core'
import { APPROVAL_SPECS, approvalFor } from './approval-spec'
import { ATTENTION_RULES } from './attention-rules'

describe('APPROVAL_SPECS', () => {
  it('has decided about every harness — absence is a decision, never an omission', () => {
    // The same rule `SPAWN_SPECS` and `ATTENTION_RULES` follow. A harness added to `HarnessId` must
    // fail the build until somebody reads its dialog; `null` is how "nobody has" is said.
    for (const id of HARNESS_ORDER) expect(id in APPROVAL_SPECS).toBe(true)
    expect(Object.keys(APPROVAL_SPECS).sort()).toEqual([...HARNESS_ORDER].sort())
  })

  it('records where every key came from, with a version and a date', () => {
    // Provenance is not decoration here: the key is sent into somebody's session, and a value with
    // no probe behind it is a guess wearing the same shape as a measurement.
    for (const [id, spec] of Object.entries(APPROVAL_SPECS)) {
      if (!spec) continue
      expect(spec.key.length, id).toBeGreaterThan(0)
      // "<tool> <version>, <yyyy-mm-dd>"
      expect(spec.probed, id).toMatch(/\d.*\d, \d{4}-\d{2}-\d{2}$/)
    }
  })

  it('never offers a key for a harness whose screen cannot be read', () => {
    // A spec is only ever REACHED through `waiting-approval`, which only exists where
    // `ATTENTION_RULES` has approval patterns. A spec without them would be an unreachable promise —
    // and, worse, would be the thing a future caller reaches for when it decides to trust the spec
    // alone.
    for (const id of HARNESS_ORDER) {
      if (!APPROVAL_SPECS[id]) continue
      expect(ATTENTION_RULES[id]?.approval.length ?? 0, id).toBeGreaterThan(0)
    }
  })

  it('answers with undefined rather than null, and for an absent harness at all', () => {
    expect(approvalFor('claude')?.key).toBe('Enter')
    expect(approvalFor(undefined)).toBeUndefined()
  })
})
