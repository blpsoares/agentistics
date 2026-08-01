import { describe, it, expect } from 'bun:test'
import {
  generateMachineKeypair,
  fingerprintOf,
  seal,
  open,
  envelopeDigest,
  type SealedEnvelope,
} from './envelope-crypto'

const A = generateMachineKeypair() // sender
const B = generateMachineKeypair() // recipient
const C = generateMachineKeypair() // a third machine

const NOW = new Date('2026-07-31T10:00:00.000Z')

function sealAtoB(plaintext = 'hello', over: Partial<Parameters<typeof seal>[0]> = {}): SealedEnvelope {
  return seal({
    plaintext,
    senderMachineId: 'machine-a',
    senderPrivateKey: A.privateKey,
    senderPublicKey: A.publicKey,
    recipientMachineId: 'machine-b',
    recipientPublicKey: B.publicKey,
    instanceId: 'inst-1',
    createdAt: NOW.toISOString(),
    ...over,
  })
}

/** The honest caller: every identity the transport claims is stated and therefore checked. */
function openAsB(envelope: unknown, over: Partial<Parameters<typeof open>[0]> = {}) {
  return open({
    envelope,
    recipientPrivateKey: B.privateKey,
    pinnedSenderPublicKey: A.publicKey,
    expectedSenderMachineId: 'machine-a',
    expectedRecipientMachineId: 'machine-b',
    expectedInstanceId: 'inst-1',
    now: NOW,
    ...over,
  })
}

describe('generateMachineKeypair / fingerprintOf', () => {
  it('produces a distinct keypair each time', () => {
    expect(A.publicKey).not.toBe(B.publicKey)
    expect(A.privateKey).not.toBe(B.privateKey)
  })

  it('fingerprints are stable per key and differ between keys', () => {
    expect(fingerprintOf(A.publicKey)).toBe(fingerprintOf(A.publicKey))
    expect(fingerprintOf(A.publicKey)).not.toBe(fingerprintOf(B.publicKey))
  })

  it('a fingerprint is short enough for a human to compare', () => {
    // Groups of 4 hex chars, space-separated — read aloud between two machines you own.
    expect(fingerprintOf(A.publicKey)).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/)
  })

  it('never throws on junk', () => {
    expect(fingerprintOf('')).toBe('')
    expect(fingerprintOf('not-base64-!!!')).toBe('')
  })
})

describe('seal', () => {
  it('never carries a private key', () => {
    const env = sealAtoB()
    const wire = JSON.stringify(env)
    expect(wire).not.toContain(A.privateKey)
    expect(wire).not.toContain(B.privateKey)
  })

  it('never carries the plaintext', () => {
    expect(JSON.stringify(sealAtoB('github.com/acme/secret-repo'))).not.toContain('secret-repo')
  })

  it('encrypts the same plaintext to different bytes each time', () => {
    // One ephemeral sender keypair per message — the central must not be able to tell that the
    // same restriction was re-sent.
    const one = sealAtoB('same')
    const two = sealAtoB('same')
    expect(one.ciphertext).not.toBe(two.ciphertext)
    expect(one.ephemeralPublicKey).not.toBe(two.ephemeralPublicKey)
  })
})

describe('open', () => {
  it('round-trips a message to the intended recipient', () => {
    const res = openAsB(sealAtoB('restricted: acme/api'))
    expect(res).toEqual({ ok: true, plaintext: 'restricted: acme/api' })
  })

  it('accepts a first-sight sender (no pin yet)', () => {
    const res = openAsB(sealAtoB(), { pinnedSenderPublicKey: null })
    expect(res.ok).toBe(true)
  })

  it('fails for the wrong recipient', () => {
    const res = openAsB(sealAtoB(), { recipientPrivateKey: C.privateKey })
    expect(res).toEqual({ ok: false, reason: 'undecryptable' })
  })

  it('fails on a tampered ciphertext', () => {
    const env = sealAtoB('hello')
    const bytes = Buffer.from(env.ciphertext, 'base64')
    bytes[0]! ^= 0xff
    const res = openAsB({ ...env, ciphertext: bytes.toString('base64') })
    expect(res).toEqual({ ok: false, reason: 'undecryptable' })
  })

  it('fails on a tampered authentication tag', () => {
    const env = sealAtoB()
    const tag = Buffer.from(env.tag, 'base64')
    tag[0]! ^= 0xff
    const res = openAsB({ ...env, tag: tag.toString('base64') })
    expect(res).toEqual({ ok: false, reason: 'undecryptable' })
  })

  it('fails when a header field is rewritten in transit — the header is authenticated data', () => {
    // The central routes on these fields; if it could rewrite them without breaking the seal it
    // could redirect or relabel a message.
    const env = sealAtoB()
    for (const patched of [
      { ...env, senderMachineId: 'machine-c' },
      { ...env, recipientMachineId: 'machine-c' },
      { ...env, createdAt: NOW.toISOString().replace('10:00', '10:01') },
      { ...env, instanceId: 'inst-2' },
    ]) {
      // Stated as the values the transport claimed, so the failure is the SEAL breaking rather
      // than an id comparison — the AAD property this test is about.
      const res = openAsB(patched, {
        expectedSenderMachineId: patched.senderMachineId,
        expectedRecipientMachineId: patched.recipientMachineId,
        expectedInstanceId: patched.instanceId,
        now: new Date(patched.createdAt),
      })
      expect(res.ok).toBe(false)
    }
  })

  it('refuses a changed sender key rather than decrypting it', () => {
    // C seals a perfectly valid envelope while CLAIMING to be machine-a. Without the pin it would
    // open; with it, the recipient refuses and says why. This is the one control that stands
    // between the user and a central that substitutes a public key.
    const impostor = seal({
      plaintext: 'trust me',
      senderMachineId: 'machine-a',
      senderPrivateKey: C.privateKey,
      senderPublicKey: C.publicKey,
      recipientMachineId: 'machine-b',
      recipientPublicKey: B.publicKey,
      instanceId: 'inst-1',
      createdAt: NOW.toISOString(),
    })
    const res = openAsB(impostor)
    expect(res).toEqual({ ok: false, reason: 'sender_key_changed' })
  })

  it('a sender cannot forge a message as another machine even at first sight, once the peer key is known', () => {
    // At first sight the pin is set from the CENTRAL's published key for machine-a, not from the
    // envelope, so an impostor's envelope is refused the same way.
    const impostor = seal({
      plaintext: 'x',
      senderMachineId: 'machine-a',
      senderPrivateKey: C.privateKey,
      senderPublicKey: C.publicKey,
      recipientMachineId: 'machine-b',
      recipientPublicKey: B.publicKey,
      instanceId: 'inst-1',
      createdAt: NOW.toISOString(),
    })
    expect(openAsB(impostor).ok).toBe(false)
  })

  it('reports malformed input rather than throwing', () => {
    for (const junk of [null, undefined, 'nope', 42, {}, { v: 2 }, { ...sealAtoB(), ciphertext: 1 }]) {
      const res = openAsB(junk, { pinnedSenderPublicKey: null })
      expect(res).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('reports malformed rather than throwing on a junk recipient key', () => {
    const res = openAsB(sealAtoB(), { recipientPrivateKey: 'garbage', pinnedSenderPublicKey: null })
    expect(res.ok).toBe(false)
  })
})

// --- the authenticated header must be CONSULTED, not merely computed --------------------------
//
// Review CRITICAL 1: the seal binds sender, recipient, instance and time into the AAD, which
// proves they cannot be rewritten in transit. That proves nothing on its own if the recipient
// never compares them to what the TRANSPORT claimed — the central chooses the routing fields.

describe('open — identity checks against the authenticated header', () => {
  it('refuses when the transport names a different sender than the header does', () => {
    // The central relays A's genuine bytes under a machine id it invented, whose directory entry
    // it pointed at A's real public key. Pin matches, GCM verifies — and only this check catches it.
    const res = openAsB(sealAtoB(), { expectedSenderMachineId: 'zzz' })
    expect(res).toEqual({ ok: false, reason: 'sender_mismatch' })
  })

  it('refuses an envelope addressed to a different machine', () => {
    const res = openAsB(sealAtoB(), { expectedRecipientMachineId: 'machine-c' })
    expect(res).toEqual({ ok: false, reason: 'recipient_mismatch' })
  })

  it('refuses an envelope sealed for a different central', () => {
    // Review IMPORTANT 1: the keypair is machine-wide, so central-2 could otherwise replay
    // central-1's envelope and transplant its (typically more permissive) rules.
    const res = openAsB(sealAtoB(), { expectedInstanceId: 'inst-2' })
    expect(res).toEqual({ ok: false, reason: 'instance_mismatch' })
  })

  it('checks identity BEFORE any key agreement — a mismatch never reaches the cipher', () => {
    // Junk key material would make decryption throw; the identity refusal must come first.
    const res = openAsB(sealAtoB(), { expectedSenderMachineId: 'zzz', recipientPrivateKey: 'garbage' })
    expect(res).toEqual({ ok: false, reason: 'sender_mismatch' })
  })
})

describe('open — freshness', () => {
  it('accepts an envelope from a peer that was offline for a few days', () => {
    // The mailbox exists FOR offline peers; a minutes-wide window would drop legitimate messages.
    const env = sealAtoB('hi', { createdAt: new Date(NOW.getTime() - 3 * 24 * 3600_000).toISOString() })
    expect(openAsB(env).ok).toBe(true)
  })

  it('refuses an envelope older than the freshness window', () => {
    const env = sealAtoB('hi', { createdAt: new Date(NOW.getTime() - 8 * 24 * 3600_000).toISOString() })
    expect(openAsB(env)).toEqual({ ok: false, reason: 'stale' })
  })

  it('refuses an envelope dated far in the future', () => {
    const env = sealAtoB('hi', { createdAt: new Date(NOW.getTime() + 5 * 3600_000).toISOString() })
    expect(openAsB(env)).toEqual({ ok: false, reason: 'stale' })
  })

  it('tolerates ordinary clock skew between two machines', () => {
    const env = sealAtoB('hi', { createdAt: new Date(NOW.getTime() + 5 * 60_000).toISOString() })
    expect(openAsB(env).ok).toBe(true)
  })

  it('refuses an unparseable timestamp rather than treating it as fresh', () => {
    const env = sealAtoB('hi', { createdAt: 'whenever' })
    expect(openAsB(env, { expectedInstanceId: 'inst-1' })).toEqual({ ok: false, reason: 'stale' })
  })
})

describe('envelopeDigest', () => {
  it('is stable for the same envelope and differs between envelopes', () => {
    const env = sealAtoB('x')
    expect(envelopeDigest(env)).toBe(envelopeDigest({ ...env }))
    expect(envelopeDigest(env)).not.toBe(envelopeDigest(sealAtoB('x')))
  })

  it('does not depend on any field the central controls outside the seal', () => {
    // Keyed on ciphertext+tag, so re-minting the wrapper id cannot dodge replay detection.
    const env = sealAtoB('x')
    expect(envelopeDigest({ ...env, senderMachineId: 'rewritten' } as typeof env)).toBe(envelopeDigest(env))
  })
})

describe('open — version', () => {
  it('refuses a peer running a different build, with its own reason', () => {
    // Folding this into `undecryptable` would read as an attack; in a mixed-version fleet the
    // machine on the older build is exactly the one whose proposals silently vanish.
    const res = openAsB({ ...sealAtoB(), v: 1 })
    expect(res).toEqual({ ok: false, reason: 'version_mismatch' })
  })

  it('reports a non-numeric version as malformed', () => {
    expect(openAsB({ ...sealAtoB(), v: 'two' })).toEqual({ ok: false, reason: 'malformed' })
  })
})
