import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TeamConnection } from '@agentistics/core'
import { __setTeamConnDirForTests } from './config'
import { __resetEnvelopeKeysForTests, loadOrCreateKeypair, pinPeerKey, pinnedKeyFor } from './envelope-keys'
import { generateMachineKeypair, seal } from './envelope-crypto'
import { encodeRestrictionMessage } from './envelope-message'
import { readInbox, mergeProposals, mergeKeyWarnings, MAX_PROPOSALS, type Proposal } from './envelope-inbox'
import * as inboxModule from './envelope-inbox'
import { sendRestriction, receiveEnvelopes, parsePeers } from './envelope-client'

const TOKEN = 'member-token'
const SELF = require('node:crypto').createHash('sha256').update(TOKEN).digest('hex') as string
const PEER = generateMachineKeypair()
const PEER_ID = 'peer-machine'

const dirs: string[] = []
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentistics-envelope-client-'))
  dirs.push(dir)
  __setTeamConnDirForTests(dir)
  __resetEnvelopeKeysForTests()
})
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }) })

function conn(over: Partial<TeamConnection> = {}): TeamConnection {
  return {
    id: 'c_aaaaaaaaaaaa',
    endpoint: 'https://central.example',
    org: 'default',
    user: 'me',
    token: TOKEN,
    deniedRepos: [],
    shareMode: 'denylist',
    sources: [{ type: 'repo', value: 'github.com/acme/api' }],
    ...over,
  }
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A fake central: serves the peer directory, records deposits, serves an inbox. */
function fakeCentral(opts: { peers?: unknown[]; inbox?: unknown[] } = {}) {
  const deposited: { recipientMachineId: string; envelope: unknown }[] = []
  const acked: string[] = []
  const published: string[] = []
  const fetch = async (url: string, init: { method: string; body?: string }) => {
    if (url.endsWith('/api/team/keys') && init.method === 'POST') {
      published.push(JSON.parse(init.body!).publicKey)
      return jsonRes({ ok: true })
    }
    if (url.endsWith('/api/team/keys')) {
      return jsonRes({ ok: true, machineId: SELF, peers: opts.peers ?? [{ machineId: PEER_ID, machineName: 'laptop-b', publicKey: PEER.publicKey }] })
    }
    if (url.endsWith('/api/team/envelopes') && init.method === 'POST') {
      deposited.push(...JSON.parse(init.body!).envelopes)
      return jsonRes({ ok: true, stored: JSON.parse(init.body!).envelopes.length })
    }
    if (url.endsWith('/api/team/envelopes') && init.method === 'DELETE') {
      acked.push(...JSON.parse(init.body!).ids)
      return jsonRes({ ok: true, deleted: 1 })
    }
    if (url.endsWith('/api/team/envelopes')) return jsonRes({ ok: true, envelopes: opts.inbox ?? [] })
    return new Response('Not found', { status: 404 })
  }
  return { fetch, deposited, acked, published }
}

describe('parsePeers', () => {
  it('returns nothing for an older central or junk, never throws', () => {
    for (const junk of [null, undefined, {}, { peers: 'x' }, { peers: [null, { machineId: '' }, { machineId: 'm' }] }]) {
      expect(parsePeers(junk)).toEqual([])
    }
  })
})

describe('sendRestriction', () => {
  it('publishes only the PUBLIC key and seals the rules to each peer', async () => {
    const central = fakeCentral()
    const kp = await loadOrCreateKeypair()
    const stored = await sendRestriction(conn(), 'inst-1', { fetch: central.fetch })

    expect(stored).toBe(1)
    expect(central.published).toEqual([kp.publicKey])
    expect(central.published[0]).not.toBe(kp.privateKey)
    expect(central.deposited).toHaveLength(1)
    expect(central.deposited[0]!.recipientMachineId).toBe(PEER_ID)
  })

  it('what the central receives is opaque — no repo name, no rule, no private key', async () => {
    const central = fakeCentral()
    const kp = await loadOrCreateKeypair()
    await sendRestriction(conn({ sources: [{ type: 'repo', value: 'github.com/acme/secret-repo' }] }), 'inst-1', { fetch: central.fetch })
    const wire = JSON.stringify(central.deposited)
    expect(wire).not.toContain('secret-repo')
    expect(wire).not.toContain('denylist')
    expect(wire).not.toContain(kp.privateKey)
  })

  it('skips a peer whose key changed — sealing to a substituted key would hand over the plaintext', async () => {
    await pinPeerKey('c_aaaaaaaaaaaa', PEER_ID, generateMachineKeypair().publicKey)
    const central = fakeCentral()
    expect(await sendRestriction(conn(), 'inst-1', { fetch: central.fetch })).toBe(0)
    expect(central.deposited).toEqual([])
  })

  it('does nothing without a token or an instanceId', async () => {
    const central = fakeCentral()
    expect(await sendRestriction(conn({ token: '' }), 'inst-1', { fetch: central.fetch })).toBe(0)
    expect(await sendRestriction(conn(), '', { fetch: central.fetch })).toBe(0)
    expect(central.deposited).toEqual([])
  })

  it('an unreachable central is not an error', async () => {
    const dead = async () => { throw new Error('ECONNREFUSED') }
    expect(await sendRestriction(conn(), 'inst-1', { fetch: dead })).toBe(0)
  })
})

async function sealedFromPeer(plaintext: string, senderKeys = PEER, senderId = PEER_ID) {
  const me = await loadOrCreateKeypair()
  return seal({
    plaintext,
    senderMachineId: senderId,
    senderPrivateKey: senderKeys.privateKey,
    senderPublicKey: senderKeys.publicKey,
    recipientMachineId: SELF,
    recipientPublicKey: me.publicKey,
  })
}

const RULES_MSG = encodeRestrictionMessage({
  kind: 'restriction',
  instanceId: 'inst-1',
  shareMode: 'denylist',
  sources: [{ type: 'repo', value: 'github.com/acme/api' }],
  at: '2026-07-31T10:00:00.000Z',
})

describe('receiveEnvelopes', () => {
  it('decrypts a sibling proposal into the inbox and acknowledges it', async () => {
    const envelope = await sealedFromPeer(RULES_MSG)
    const central = fakeCentral({ inbox: [{ id: 'e1', senderMachineId: PEER_ID, envelope }] })
    const notes: string[] = []
    const res = await receiveEnvelopes(conn(), { fetch: central.fetch, notify: n => notes.push(n.code) })

    expect(res).toEqual({ proposals: 1, keyWarnings: 0 })
    const inbox = await readInbox('c_aaaaaaaaaaaa')
    expect(inbox.proposals).toHaveLength(1)
    expect(inbox.proposals[0]!.fromMachineName).toBe('laptop-b')
    expect(inbox.proposals[0]!.sources).toEqual([{ type: 'repo', value: 'github.com/acme/api' }])
    expect(central.acked).toEqual(['e1'])
    expect(notes).toEqual(['member.rules_proposed'])
  })

  it('refuses a sender whose key changed, warns, and does NOT acknowledge the envelope', async () => {
    // The peer was pinned to a different key first; the directory now advertises a new one.
    await pinPeerKey('c_aaaaaaaaaaaa', PEER_ID, generateMachineKeypair().publicKey)
    const envelope = await sealedFromPeer(RULES_MSG)
    const central = fakeCentral({ inbox: [{ id: 'e1', senderMachineId: PEER_ID, envelope }] })
    const notes: string[] = []
    const res = await receiveEnvelopes(conn(), { fetch: central.fetch, notify: n => notes.push(n.code) })

    expect(res.proposals).toBe(0)
    expect(res.keyWarnings).toBe(1)
    expect((await readInbox('c_aaaaaaaaaaaa')).proposals).toEqual([])
    // Left on the central so resolving the key does not cost the user the message.
    expect(central.acked).toEqual([])
    expect(notes).toEqual(['member.peer_key_changed'])
  })

  it('an impostor sealing under another machine\'s id is refused', async () => {
    const impostor = generateMachineKeypair()
    const envelope = await sealedFromPeer(RULES_MSG, impostor, PEER_ID)
    const central = fakeCentral({ inbox: [{ id: 'e1', senderMachineId: PEER_ID, envelope }] })
    const res = await receiveEnvelopes(conn(), { fetch: central.fetch, notify: () => {} })
    expect(res.proposals).toBe(0)
    expect(res.keyWarnings).toBe(1)
  })

  it('acknowledges an undecryptable or unparseable envelope rather than looping on it forever', async () => {
    const envelope = await sealedFromPeer('not a restriction message')
    const central = fakeCentral({ inbox: [{ id: 'e1', senderMachineId: PEER_ID, envelope }] })
    const res = await receiveEnvelopes(conn(), { fetch: central.fetch, notify: () => {} })
    expect(res.proposals).toBe(0)
    expect(central.acked).toEqual(['e1'])
  })

  it('pins a first-sight peer from the DIRECTORY, not from an envelope', async () => {
    const central = fakeCentral()
    await receiveEnvelopes(conn(), { fetch: central.fetch, notify: () => {} })
    expect(await pinnedKeyFor('c_aaaaaaaaaaaa', PEER_ID)).toBe(PEER.publicKey)
  })

  it('an older central (404 everywhere) is a quiet no-op', async () => {
    const old = async () => new Response('Not found', { status: 404 })
    expect(await receiveEnvelopes(conn(), { fetch: old, notify: () => {} })).toEqual({ proposals: 0, keyWarnings: 0 })
  })
})

describe('the inbox never applies anything', () => {
  it('exposes no function that could change local rules', () => {
    // A message that arrives must raise a proposal and stop. If someone adds an apply/enable/set
    // path to this module, this test fails — which is the point.
    const forbidden = Object.keys(inboxModule).filter(k => /^(apply|enable|set|patch|update|install)/i.test(k))
    expect(forbidden).toEqual([])
  })

  it('receiving writes only to the inbox store — never to preferences', async () => {
    const envelope = await sealedFromPeer(RULES_MSG)
    const central = fakeCentral({ inbox: [{ id: 'e1', senderMachineId: PEER_ID, envelope }] })
    await receiveEnvelopes(conn(), { fetch: central.fetch, notify: () => {} })
    // The proposal is stored as a PROPOSAL, carrying the sender — not merged into any rule set.
    const inbox = await readInbox('c_aaaaaaaaaaaa')
    expect(inbox.proposals[0]!.fromMachineId).toBe(PEER_ID)
    expect(Object.keys(inbox).sort()).toEqual(['keyWarnings', 'proposals'])
  })
})

describe('inbox merging', () => {
  const p = (id: string): Proposal => ({
    id, fromMachineId: 'm', fromMachineName: 'm', shareMode: 'denylist', sources: [], at: 'a', receivedAt: 'r',
  })

  it('deduplicates by envelope id — a re-sent proposal does not undo a dismissal', () => {
    expect(mergeProposals([p('a')], [p('a')]).map(x => x.id)).toEqual(['a'])
  })

  it('puts fresh proposals first and caps the list', () => {
    const existing = Array.from({ length: MAX_PROPOSALS }, (_, i) => p(`old${i}`))
    const merged = mergeProposals(existing, [p('new')])
    expect(merged[0]!.id).toBe('new')
    expect(merged).toHaveLength(MAX_PROPOSALS)
  })

  it('keeps one key warning per machine', () => {
    const w = { machineId: 'm1', machineName: 'a', at: 't1' }
    expect(mergeKeyWarnings([w], [{ ...w, at: 't2' }])).toEqual([w])
  })
})
