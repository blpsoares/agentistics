/**
 * envelope-crypto.ts — the sealed envelope. PURE (`node:crypto` only, no I/O, no Mongo, no
 * preferences), because a mistake here is a message the central can read.
 *
 * WHAT IT IS FOR. Sharing rules are per machine. Telling this account's OTHER machines that a
 * repository was restricted requires something to cross the central, and the central is exactly
 * who must not learn it. So the machine seals the message to each peer and the central relays
 * ciphertext it cannot open.
 *
 * THE CONSTRUCTION — composed from standard primitives, nothing invented:
 *
 *   ephemeral    E  = fresh X25519 keypair, ONE PER MESSAGE
 *   dh1          = X25519(E.priv,  recipient.pub)     — confidentiality + freshness
 *   dh2          = X25519(sender.priv, recipient.pub) — SENDER AUTHENTICITY
 *   key          = HKDF-SHA256(ikm = dh1 || dh2, salt = E.pub || recipient.pub, info = header)
 *   ciphertext   = AES-256-GCM(key, iv = 12 random bytes, aad = canonical header JSON)
 *
 * This is the Noise `X` / X3DH-style composition: the ephemeral DH gives a fresh key for every
 * message (the same plaintext never seals to the same bytes, so the central cannot tell a re-send
 * from a new decision), and the static-static DH is the authenticator — only a holder of the
 * sender's private key can produce a `dh2` the recipient's private key reproduces.
 *
 * WHY A DH AND NOT A SIGNATURE. A signature would prove authorship to anyone who later sees the
 * envelope, including the central if it ever obtained the plaintext. The DH authenticator is
 * verifiable only by the intended recipient — the two machines already share an account, and
 * nobody else needs a transferable proof of what one told the other. It also avoids a second key
 * type per machine (Ed25519 alongside X25519) and the mismatch bugs that come with it.
 *
 * WHY THE PIN IS LOAD-BEARING. `dh2` proves the sender holds the private key matching
 * `senderPublicKey` IN THE HEADER — it cannot, by itself, prove that key belongs to the machine
 * the header names, because the key came from the central. `open` therefore refuses outright when
 * the header's sender key differs from the one the recipient PINNED (`envelope-keys.ts`), and does
 * so BEFORE attempting decryption. Without that check, a central that substitutes a public key
 * reads and writes this channel; with it, substitution is loud rather than silent. That limit is
 * stated in docs/security.md and cannot be closed by any fully automatic scheme.
 *
 * The whole header is the GCM additional-authenticated-data, so the central cannot re-address,
 * relabel or re-date an envelope it is relaying without destroying it.
 *
 * BINDING IS ONLY HALF THE JOB — THE RECIPIENT MUST COMPARE. An authenticated header proves the
 * central could not REWRITE those fields; it says nothing about the central CHOOSING the fields it
 * reports alongside the ciphertext. The transport hands over its own `senderMachineId`, the peer
 * directory that produced the pin, and the connection this arrived on — so `open` REQUIRES the
 * caller to state each of those and refuses on any disagreement with the sealed header, before any
 * key agreement happens. An earlier revision computed this header and never consulted it, which
 * let a central relay a genuine envelope under a machine id it had invented.
 */
import {
  generateKeyPairSync, diffieHellman, createPublicKey, createPrivateKey,
  hkdfSync, createCipheriv, createDecipheriv, randomBytes, createHash,
} from 'node:crypto'

/**
 * Bumped whenever the SEALED STRUCT or the AAD changes — v2 added `instanceId` to both. `open`
 * refuses any other version outright rather than guessing at a format it does not know.
 *
 * A version mismatch fails closed either way (the AAD differs, so GCM would reject it), but it is
 * given its OWN reason rather than being folded into `undecryptable`: in a mixed-version fleet the
 * machine on the older build is the one whose proposals silently vanish, and "this peer is running
 * a different build" is a fact the user can act on, while "did not authenticate" reads as an attack.
 */
export const ENVELOPE_VERSION = 2

/** Domain separation, so a key derived here can never collide with one derived by some other
 *  feature that happens to use the same primitives. */
const HKDF_PREFIX = 'agentistics-envelope-v1'

const IV_BYTES = 12
const KEY_BYTES = 32

/**
 * How old a sealed envelope may be when it is opened.
 *
 * Deliberately days and not minutes: the mailbox exists BECAUSE peers are offline, so a
 * minutes-wide window would drop exactly the messages the channel was built to deliver — a laptop
 * that was shut for the weekend. Freshness here is the backstop against a central WITHHOLDING an
 * envelope and delivering it much later; the actual anti-replay control is the opened-digest set
 * in `envelope-inbox.ts`, which is what makes a second delivery of the same bytes a no-op. Kept
 * below the central's own retention (`ENVELOPE_MAX_AGE_MS` in envelope-store.ts) so the two agree.
 */
export const ENVELOPE_FRESH_MS = 7 * 24 * 60 * 60_000
/** Tolerance for two machines' clocks disagreeing. Beyond it, a future date is a fabrication. */
export const ENVELOPE_SKEW_MS = 60 * 60_000

/**
 * A machine's long-term keypair, base64 DER. The PUBLIC half is SPKI (44 bytes) and is the only
 * half that is ever published; the PRIVATE half is PKCS#8 (48 bytes) and never leaves the machine,
 * never enters a log, an audit event or a response body.
 */
export interface MachineKeypair {
  publicKey: string
  privateKey: string
}

export interface SealedEnvelope {
  v: number
  /** Who sealed it. Authenticated by `dh2` AGAINST THE PINNED KEY, never on its own. */
  senderMachineId: string
  recipientMachineId: string
  /** The sender's long-term public key, base64 SPKI DER — compared against the pin by `open`. */
  senderPublicKey: string
  /** This message's ephemeral public key, base64 SPKI DER. */
  ephemeralPublicKey: string
  /** The central this envelope is FOR. Bound into the AAD so an envelope sealed on one central
   *  cannot be re-scoped onto another, and compared by `open` against the connection it arrived
   *  on — the keypair is machine-wide, so without this a second central could replay the first
   *  central's (typically more permissive) rule set. */
  instanceId: string
  iv: string
  ciphertext: string
  tag: string
  createdAt: string
}

export type OpenResult =
  | { ok: true; plaintext: string }
  /** The header's sender key is not the one this machine pinned for that sender. Never decrypted:
   *  a reinstall and an attack look identical here, and the machine cannot tell which. */
  | { ok: false; reason: 'sender_key_changed' }
  /** Not an envelope this build understands. */
  | { ok: false; reason: 'malformed' }
  /** A valid envelope from a peer running a different build of this channel. */
  | { ok: false; reason: 'version_mismatch' }
  /** Authenticated decryption failed: wrong recipient, tampered bytes, or a forged header. */
  | { ok: false; reason: 'undecryptable' }
  /** The transport claimed a different sender than the sealed header names. */
  | { ok: false; reason: 'sender_mismatch' }
  /** Sealed for a different machine. */
  | { ok: false; reason: 'recipient_mismatch' }
  /** Sealed for a different central. */
  | { ok: false; reason: 'instance_mismatch' }
  /** Outside the freshness window — withheld and delivered late, or fabricated. */
  | { ok: false; reason: 'stale' }

export function generateMachineKeypair(): MachineKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return {
    publicKey: (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64'),
    privateKey: (privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64'),
  }
}

/**
 * A human-comparable fingerprint of a public key: the first 16 bytes of its SHA-256, in eight
 * space-separated groups of four hex characters. Shown in the connection UI so a user who cares
 * can compare two machines they own; never required, because requiring it would make the feature
 * fail to do the one thing the product owner asked for (work automatically).
 *
 * Total: junk yields `''` rather than throwing — a fingerprint is display, and a display helper
 * must not be able to take down the panel it renders in.
 */
export function fingerprintOf(publicKeyB64: string): string {
  const der = decodeKey(publicKeyB64)
  if (!der) return ''
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32)
  return (hex.match(/.{4}/g) ?? []).join(' ')
}

/** base64 → Buffer, rejecting anything that is not exactly the input re-encoded (so `'not-base64'`
 *  does not silently become a short buffer of whatever characters happened to decode). */
function decodeKey(b64: string): Buffer | null {
  if (typeof b64 !== 'string' || b64 === '') return null
  const buf = Buffer.from(b64, 'base64')
  if (buf.length === 0 || buf.toString('base64') !== b64) return null
  return buf
}

/** The exact bytes that are authenticated (GCM AAD) and mixed into the KDF `info`. Field ORDER is
 *  part of the contract: both sides build this string the same way, so a reordering on one side
 *  would look like tampering on the other. */
function headerBytes(env: Omit<SealedEnvelope, 'ciphertext' | 'tag' | 'iv'>): Buffer {
  return Buffer.from(JSON.stringify([
    HKDF_PREFIX,
    env.v,
    env.senderMachineId,
    env.recipientMachineId,
    env.senderPublicKey,
    env.ephemeralPublicKey,
    env.instanceId,
    env.createdAt,
  ]), 'utf8')
}

function deriveKey(dh1: Buffer, dh2: Buffer, ephemeralPub: Buffer, recipientPub: Buffer, header: Buffer): Buffer {
  const ikm = Buffer.concat([dh1, dh2])
  const salt = Buffer.concat([ephemeralPub, recipientPub])
  return Buffer.from(hkdfSync('sha256', ikm, salt, header, KEY_BYTES))
}

export function seal(input: {
  plaintext: string
  senderMachineId: string
  senderPrivateKey: string
  senderPublicKey: string
  recipientMachineId: string
  recipientPublicKey: string
  instanceId: string
  createdAt?: string
}): SealedEnvelope {
  const recipientDer = decodeKey(input.recipientPublicKey)
  if (!recipientDer) throw new Error('invalid recipient public key')
  const recipientPub = createPublicKey({ key: recipientDer, format: 'der', type: 'spki' })
  const senderPrivDer = decodeKey(input.senderPrivateKey)
  if (!senderPrivDer) throw new Error('invalid sender private key')
  const senderPriv = createPrivateKey({ key: senderPrivDer, format: 'der', type: 'pkcs8' })

  const ephemeral = generateKeyPairSync('x25519')
  const ephemeralDer = ephemeral.publicKey.export({ type: 'spki', format: 'der' }) as Buffer

  const header = {
    v: ENVELOPE_VERSION,
    senderMachineId: input.senderMachineId,
    recipientMachineId: input.recipientMachineId,
    senderPublicKey: input.senderPublicKey,
    ephemeralPublicKey: ephemeralDer.toString('base64'),
    instanceId: input.instanceId,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
  const aad = headerBytes(header)

  const dh1 = Buffer.from(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientPub }))
  const dh2 = Buffer.from(diffieHellman({ privateKey: senderPriv, publicKey: recipientPub }))
  const key = deriveKey(dh1, dh2, ephemeralDer, recipientDer, aad)

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(input.plaintext, 'utf8'), cipher.final()])
  return {
    ...header,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

/**
 * Shape-validate an envelope WITHOUT any cryptography, so a caller can read the header it is about
 * to have checked — specifically to look the sender's pin up by the id INSIDE the seal rather than
 * by the one the transport supplied alongside it. Reading the header this way decides nothing: it
 * only selects which pin `open` will then be held to.
 */
export function peekEnvelope(raw: unknown): SealedEnvelope | null {
  return asEnvelope(raw)
}

function asEnvelope(raw: unknown): SealedEnvelope | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const e = raw as Record<string, unknown>
  // Version is checked by the caller (so it can be REPORTED, not just dropped); shape is checked
  // here for every version this build could be handed.
  if (typeof e.v !== 'number') return null
  for (const k of ['senderMachineId', 'recipientMachineId', 'senderPublicKey', 'ephemeralPublicKey', 'instanceId', 'iv', 'ciphertext', 'tag', 'createdAt']) {
    if (typeof e[k] !== 'string') return null
  }
  return e as unknown as SealedEnvelope
}

/**
 * Digest of an envelope's SEALED BYTES (ciphertext + tag) — the replay key.
 *
 * Deliberately not the central's `id`: the central mints that field and can vary it at will, so
 * deduplicating on it would let the same bytes be re-delivered as a "new" message forever. These
 * two fields cannot be varied without the seal failing, so they identify the message itself.
 */
export function envelopeDigest(env: Pick<SealedEnvelope, 'ciphertext' | 'tag'>): string {
  return createHash('sha256').update(`${env.ciphertext}\0${env.tag}`).digest('hex')
}

export function open(input: {
  envelope: unknown
  recipientPrivateKey: string
  /** The key this machine has PINNED for the named sender, or `null` at first sight. */
  pinnedSenderPublicKey: string | null
  /** REQUIRED. Who the TRANSPORT said sent this. Compared against the sealed header — the central
   *  chooses this field, so leaving it unchecked lets it relay a genuine envelope under an
   *  identity it invented. */
  expectedSenderMachineId: string
  /** REQUIRED. This machine's own id on that central. */
  expectedRecipientMachineId: string
  /** REQUIRED. The instanceId of the central this envelope arrived from. */
  expectedInstanceId: string
  /** Injectable clock for the freshness check. */
  now?: Date
}): OpenResult {
  const env = asEnvelope(input.envelope)
  if (!env) return { ok: false, reason: 'malformed' }
  if (env.v !== ENVELOPE_VERSION) return { ok: false, reason: 'version_mismatch' }

  // EVERYTHING BELOW HAPPENS BEFORE ANY KEY AGREEMENT. Each check compares a value the transport
  // supplied against the same value sealed inside the AAD. The seal proves these fields were not
  // rewritten; only these comparisons prove the message is the one the transport claims it is.
  if (env.senderMachineId !== input.expectedSenderMachineId) return { ok: false, reason: 'sender_mismatch' }
  if (env.recipientMachineId !== input.expectedRecipientMachineId) return { ok: false, reason: 'recipient_mismatch' }
  if (env.instanceId !== input.expectedInstanceId) return { ok: false, reason: 'instance_mismatch' }

  const now = (input.now ?? new Date()).getTime()
  const created = Date.parse(env.createdAt)
  // NaN (an unparseable date) fails both comparisons and reads as stale — never as fresh.
  if (!(created <= now + ENVELOPE_SKEW_MS && created >= now - ENVELOPE_FRESH_MS)) {
    return { ok: false, reason: 'stale' }
  }

  // A sender key that is not the pinned one is refused outright. `dh2` would happily authenticate
  // a substituted key against itself, so this comparison — not the cipher — is what makes key
  // substitution visible.
  if (input.pinnedSenderPublicKey !== null && input.pinnedSenderPublicKey !== env.senderPublicKey) {
    return { ok: false, reason: 'sender_key_changed' }
  }

  try {
    const recipientPrivDer = decodeKey(input.recipientPrivateKey)
    const senderPubDer = decodeKey(env.senderPublicKey)
    const ephemeralDer = decodeKey(env.ephemeralPublicKey)
    if (!recipientPrivDer || !senderPubDer || !ephemeralDer) return { ok: false, reason: 'malformed' }
    const recipientPriv = createPrivateKey({ key: recipientPrivDer, format: 'der', type: 'pkcs8' })
    const recipientPubDer = createPublicKey(recipientPriv).export({ type: 'spki', format: 'der' }) as Buffer

    const aad = headerBytes(env)
    const dh1 = Buffer.from(diffieHellman({
      privateKey: recipientPriv,
      publicKey: createPublicKey({ key: ephemeralDer, format: 'der', type: 'spki' }),
    }))
    const dh2 = Buffer.from(diffieHellman({
      privateKey: recipientPriv,
      publicKey: createPublicKey({ key: senderPubDer, format: 'der', type: 'spki' }),
    }))
    const key = deriveKey(dh1, dh2, ephemeralDer, recipientPubDer, aad)

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'))
    decipher.setAAD(aad)
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(env.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    return { ok: true, plaintext }
  } catch {
    // Wrong recipient, tampered bytes, forged header, unusable key material — all indistinguishable
    // to the recipient and all equally "this did not authenticate".
    return { ok: false, reason: 'undecryptable' }
  }
}
