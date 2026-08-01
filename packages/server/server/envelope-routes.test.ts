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

describe('GET /api/team/proposals — the response shape is declared, not spread', () => {
  it('ships the panel\'s fields and not the replay memory', async () => {
    // `openedDigests` is up to 500 hex strings per connection and the panel polls every 30s. Not
    // secret, but a spread of the whole store silently exports every field a future revision adds.
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'agentistics-proposals-route-'))
    try {
      const { __setTeamConnDirForTests } = await import('./config')
      __setTeamConnDirForTests(dir)
      const { writeInbox } = await import('./envelope-inbox')
      const { handleProposals } = await import('./envelope-proposals')
      const connId = 'c_cccccccccccc'
      await writeInbox(connId, {
        proposals: [], keyWarnings: [], openedDigests: ['deadbeef'],
        siblingRules: [{
          machineId: 'peer-1', machineName: 'laptop-b', shareMode: 'denylist',
          sources: [{ type: 'repo', value: 'github.com/acme/api' }],
          at: '2026-07-31T10:00:00.000Z', receivedAt: '2026-07-31T10:00:05.000Z',
        }],
      })

      // A stub preferences read — this test must never touch the developer's real ~/.agentistics.
      const res = await handleProposals(new Request('http://localhost/api/team/proposals'), {
        readPreferences: async () => ({ team: { mode: 'member' as const, connections: [
          { id: connId, endpoint: 'https://c.example', org: 'default', user: 'me', token: 't', deniedRepos: [] },
        ] } }),
      })
      const body = await res.json() as { connections: Record<string, unknown>[] }
      expect(Object.keys(body.connections[0]!).sort())
        .toEqual(['connId', 'keyWarnings', 'peers', 'proposals', 'siblingRules'])
      // The standing facts DO travel — they are what the reverse warning reads — while the replay
      // memory still does not: this route ships what its consumer needs, never the whole store.
      expect(JSON.stringify(body)).toContain('github.com/acme/api')
      expect(JSON.stringify(body)).not.toContain('deadbeef')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
