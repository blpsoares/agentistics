import { describe, it, expect } from 'bun:test'
import {
  parsePublishKeyBody, parseDepositBody, parseAckBody, allowedRecipients,
  MAX_PUBLIC_KEY_CHARS, MAX_ENVELOPES_PER_DEPOSIT, MAX_ACK_IDS,
} from './envelope-routes'
import { parseDismissBody } from './envelope-proposals'

describe('parsePublishKeyBody', () => {
  it('accepts a key', () => {
    expect(parsePublishKeyBody({ publicKey: 'AAAA' })).toEqual({ ok: true, publicKey: 'AAAA' })
  })

  it('rejects junk and unbounded blobs', () => {
    for (const junk of [null, 'x', [], {}, { publicKey: '' }, { publicKey: 7 }]) {
      expect(parsePublishKeyBody(junk).ok).toBe(false)
    }
    expect(parsePublishKeyBody({ publicKey: 'A'.repeat(MAX_PUBLIC_KEY_CHARS + 1) }).ok).toBe(false)
  })
})

describe('parseDepositBody', () => {
  const item = { recipientMachineId: 'm2', envelope: { v: 1 } }

  it('accepts a deposit', () => {
    expect(parseDepositBody({ envelopes: [item] })).toEqual({ ok: true, items: [item] })
  })

  it('rejects a malformed entry outright rather than dropping it', () => {
    for (const junk of [
      { envelopes: 'nope' },
      { envelopes: [null] },
      { envelopes: [{ recipientMachineId: '', envelope: {} }] },
      { envelopes: [{ recipientMachineId: 'm2' }] },
      { envelopes: [{ recipientMachineId: 'm2', envelope: 'string' }] },
      { envelopes: [item, { recipientMachineId: 'm3' }] },
    ]) {
      expect(parseDepositBody(junk).ok).toBe(false)
    }
  })

  it('bounds the batch size', () => {
    const many = Array.from({ length: MAX_ENVELOPES_PER_DEPOSIT + 1 }, () => item)
    expect(parseDepositBody({ envelopes: many }).ok).toBe(false)
  })
})

describe('parseAckBody', () => {
  it('accepts ids and bounds the batch', () => {
    expect(parseAckBody({ ids: ['a', 'b'] })).toEqual({ ok: true, ids: ['a', 'b'] })
    expect(parseAckBody({ ids: Array.from({ length: MAX_ACK_IDS + 1 }, () => 'a') }).ok).toBe(false)
    expect(parseAckBody({ ids: [''] }).ok).toBe(false)
    expect(parseAckBody({ ids: 'x' }).ok).toBe(false)
  })
})

describe('allowedRecipients — the central authorization rule', () => {
  const siblings = [{ id: 'self' }, { id: 'peer-1' }, { id: 'peer-2' }]

  it('allows the caller\'s own account\'s other machines', () => {
    expect(allowedRecipients(['peer-1', 'peer-2'], siblings, 'self')).toEqual(['peer-1', 'peer-2'])
  })

  it('refuses a machine outside the caller\'s account — the mailbox is not a write primitive against strangers', () => {
    expect(allowedRecipients(['stranger'], siblings, 'self')).toEqual([])
    expect(allowedRecipients(['peer-1', 'stranger'], siblings, 'self')).toEqual(['peer-1'])
  })

  it('refuses the caller itself — a machine must not read its own proposal back as a sibling\'s', () => {
    expect(allowedRecipients(['self'], siblings, 'self')).toEqual([])
  })

  it('deduplicates so one deposit cannot be multiplied into a mailbox flood', () => {
    expect(allowedRecipients(['peer-1', 'peer-1', 'peer-1'], siblings, 'self')).toEqual(['peer-1'])
  })

  it('allows nothing when the caller has no siblings', () => {
    expect(allowedRecipients(['peer-1'], [], 'self')).toEqual([])
  })
})

describe('parseDismissBody', () => {
  it('accepts a proposal dismissal and a key-warning dismissal', () => {
    expect(parseDismissBody({ connId: 'c_1', proposalId: 'e1' }))
      .toEqual({ ok: true, body: { connId: 'c_1', proposalId: 'e1', keyWarningMachineId: undefined } })
    expect(parseDismissBody({ connId: 'c_1', keyWarningMachineId: 'm2' }))
      .toEqual({ ok: true, body: { connId: 'c_1', proposalId: undefined, keyWarningMachineId: 'm2' } })
  })

  it('requires exactly one target, so a request can never be ambiguous about what it clears', () => {
    expect(parseDismissBody({ connId: 'c_1' }).ok).toBe(false)
    expect(parseDismissBody({ connId: 'c_1', proposalId: 'e1', keyWarningMachineId: 'm2' }).ok).toBe(false)
  })

  it('rejects junk', () => {
    for (const junk of [null, 'x', [], {}, { connId: '' }, { connId: 7, proposalId: 'e' }]) {
      expect(parseDismissBody(junk).ok).toBe(false)
    }
  })
})
