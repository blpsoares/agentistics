import { describe, it, expect } from 'bun:test'
import {
  generateMachineKeypair,
  fingerprintOf,
  seal,
  open,
  type SealedEnvelope,
} from './envelope-crypto'

const A = generateMachineKeypair() // sender
const B = generateMachineKeypair() // recipient
const C = generateMachineKeypair() // a third machine

function sealAtoB(plaintext = 'hello', over: Partial<Parameters<typeof seal>[0]> = {}): SealedEnvelope {
  return seal({
    plaintext,
    senderMachineId: 'machine-a',
    senderPrivateKey: A.privateKey,
    senderPublicKey: A.publicKey,
    recipientMachineId: 'machine-b',
    recipientPublicKey: B.publicKey,
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
    const res = open({ envelope: sealAtoB('restricted: acme/api'), recipientPrivateKey: B.privateKey, pinnedSenderPublicKey: A.publicKey })
    expect(res).toEqual({ ok: true, plaintext: 'restricted: acme/api' })
  })

  it('accepts a first-sight sender (no pin yet)', () => {
    const res = open({ envelope: sealAtoB(), recipientPrivateKey: B.privateKey, pinnedSenderPublicKey: null })
    expect(res.ok).toBe(true)
  })

  it('fails for the wrong recipient', () => {
    const res = open({ envelope: sealAtoB(), recipientPrivateKey: C.privateKey, pinnedSenderPublicKey: A.publicKey })
    expect(res).toEqual({ ok: false, reason: 'undecryptable' })
  })

  it('fails on a tampered ciphertext', () => {
    const env = sealAtoB('hello')
    const bytes = Buffer.from(env.ciphertext, 'base64')
    bytes[0]! ^= 0xff
    const res = open({ envelope: { ...env, ciphertext: bytes.toString('base64') }, recipientPrivateKey: B.privateKey, pinnedSenderPublicKey: A.publicKey })
    expect(res).toEqual({ ok: false, reason: 'undecryptable' })
  })

  it('fails on a tampered authentication tag', () => {
    const env = sealAtoB()
    const tag = Buffer.from(env.tag, 'base64')
    tag[0]! ^= 0xff
    const res = open({ envelope: { ...env, tag: tag.toString('base64') }, recipientPrivateKey: B.privateKey, pinnedSenderPublicKey: A.publicKey })
    expect(res).toEqual({ ok: false, reason: 'undecryptable' })
  })

  it('fails when a header field is rewritten in transit — the header is authenticated data', () => {
    // The central routes on these fields; if it could rewrite them without breaking the seal it
    // could redirect or relabel a message.
    const env = sealAtoB()
    for (const patched of [
      { ...env, senderMachineId: 'machine-c' },
      { ...env, recipientMachineId: 'machine-c' },
      { ...env, createdAt: '1999-01-01T00:00:00.000Z' },
    ]) {
      const res = open({ envelope: patched, recipientPrivateKey: B.privateKey, pinnedSenderPublicKey: A.publicKey })
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
    })
    const res = open({ envelope: impostor, recipientPrivateKey: B.privateKey, pinnedSenderPublicKey: A.publicKey })
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
    })
    expect(open({ envelope: impostor, recipientPrivateKey: B.privateKey, pinnedSenderPublicKey: A.publicKey }).ok).toBe(false)
  })

  it('reports malformed input rather than throwing', () => {
    for (const junk of [null, undefined, 'nope', 42, {}, { v: 2 }, { ...sealAtoB(), ciphertext: 1 }]) {
      const res = open({ envelope: junk, recipientPrivateKey: B.privateKey, pinnedSenderPublicKey: null })
      expect(res).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('reports malformed rather than throwing on a junk recipient key', () => {
    const res = open({ envelope: sealAtoB(), recipientPrivateKey: 'garbage', pinnedSenderPublicKey: null })
    expect(res.ok).toBe(false)
  })
})
