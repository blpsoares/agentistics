/**
 * envelope-store.ts — CENTRAL side storage for the sealed-envelope channel.
 *
 * Two collections, and the central can read neither's contents in any meaningful sense:
 *
 *   `machineKeys`  { _id: machineId, publicKey, updatedAt: Date }
 *       A public-key directory. Public keys are public; there is nothing here to protect. What
 *       matters is the INTEGRITY of this collection — a central that substitutes a key here at the
 *       moment a machine first sees a peer can read that peer's envelopes. That limit is inherent
 *       to automatic key distribution and is documented in docs/security.md; the machine-side pin
 *       (`envelope-keys.ts`) is what makes every substitution AFTER the first one loud.
 *
 *   `envelopes`    { _id, senderMachineId, recipientMachineId, envelope, createdAt: Date }
 *       Ciphertext plus routing metadata. WHAT THE CENTRAL LEARNS ANYWAY, and must not be implied
 *       away: that a machine deposited an envelope, when, for whom, and how big it was. Since this
 *       channel carries only rule changes, "an envelope exists" ≈ "that machine changed its rules"
 *       — which the scoped delete (`POST /api/team/forget`) arriving at the same instant already
 *       reveals, so it concedes nothing new. It does NOT reveal WHICH repository, WHICH direction,
 *       or whether the peer acted on it.
 *
 * Retention is bounded on both axes (age and per-recipient count) because an undelivered mailbox
 * for a machine that never comes back would otherwise grow forever.
 */
import { randomBytes } from 'node:crypto'
import type { Collection } from 'mongodb'
import { getMongoDb } from './mongo'
import { fromBsonDate } from './mongo-dates'

export interface MachineKeyDoc {
  _id: string
  publicKey: string
  updatedAt: Date
}

export interface EnvelopeDoc {
  _id: string
  senderMachineId: string
  recipientMachineId: string
  /** The sealed envelope, verbatim. Opaque to the central. */
  envelope: unknown
  createdAt: Date
}

/** An undelivered envelope older than this is dropped: a machine that has not collected in a
 *  month is not going to act on a rule change from a month ago. */
/** Kept in step with `ENVELOPE_FRESH_MS` (envelope-crypto.ts): a recipient refuses anything older,
 *  so storing it longer only keeps bytes nobody will ever open. */
export const ENVELOPE_MAX_AGE_MS = 7 * 24 * 60 * 60_000
/** Per recipient. Deposits past this evict the OLDEST, so a chatty sender cannot use the mailbox
 *  as unbounded storage on someone else's central. */
export const ENVELOPE_MAX_PER_RECIPIENT = 100

async function keysCollection(): Promise<Collection<MachineKeyDoc>> {
  const db = await getMongoDb()
  return db.collection<MachineKeyDoc>('machineKeys')
}

async function envelopesCollection(): Promise<Collection<EnvelopeDoc>> {
  const db = await getMongoDb()
  return db.collection<EnvelopeDoc>('envelopes')
}

/** Publish (or replace) a machine's own public key. A machine may only ever write its OWN row —
 *  the caller passes the id the TOKEN proves, never one from the body. */
export async function publishMachineKey(machineId: string, publicKey: string): Promise<void> {
  const col = await keysCollection()
  await col.updateOne(
    { _id: machineId },
    { $set: { publicKey, updatedAt: new Date() } },
    { upsert: true },
  )
}

export interface PeerKey {
  machineId: string
  machineName: string
  publicKey: string
  updatedAt: string
}

/** The published keys of the given machines. Callers pass only the caller's own account's
 *  machines; this function does no scoping of its own and must never be handed a wider set. */
export async function peerKeysFor(machines: readonly { id: string; name: string }[]): Promise<PeerKey[]> {
  if (machines.length === 0) return []
  const names = new Map(machines.map(m => [m.id, m.name]))
  const col = await keysCollection()
  const docs = await col.find({ _id: { $in: machines.map(m => m.id) } }).toArray()
  return docs
    .map(d => ({
      machineId: d._id,
      machineName: names.get(d._id) ?? d._id,
      publicKey: d.publicKey,
      updatedAt: fromBsonDate(d.updatedAt),
    }))
    .sort((a, b) => a.machineName.localeCompare(b.machineName) || a.machineId.localeCompare(b.machineId))
}

/** Store one sealed envelope. `senderMachineId` is stamped by the route from the token, never read
 *  from the body — a machine cannot deposit as someone else. */
export async function depositEnvelope(input: {
  senderMachineId: string
  recipientMachineId: string
  envelope: unknown
}): Promise<string> {
  const col = await envelopesCollection()
  const id = randomBytes(12).toString('hex')
  await col.insertOne({
    _id: id,
    senderMachineId: input.senderMachineId,
    recipientMachineId: input.recipientMachineId,
    envelope: input.envelope,
    createdAt: new Date(),
  })
  await enforceRetention(input.recipientMachineId)
  return id
}

async function enforceRetention(recipientMachineId: string): Promise<void> {
  const col = await envelopesCollection()
  await col.deleteMany({ createdAt: { $lt: new Date(Date.now() - ENVELOPE_MAX_AGE_MS) } })
  const count = await col.countDocuments({ recipientMachineId })
  if (count <= ENVELOPE_MAX_PER_RECIPIENT) return
  const excess = await col
    .find({ recipientMachineId }, { projection: { _id: 1 } })
    .sort({ createdAt: 1 })
    .limit(count - ENVELOPE_MAX_PER_RECIPIENT)
    .toArray()
  if (excess.length > 0) await col.deleteMany({ _id: { $in: excess.map(d => d._id) } })
}

export interface StoredEnvelope {
  id: string
  senderMachineId: string
  envelope: unknown
  createdAt: string
}

/** Everything waiting for one machine. Scoped by recipient, which the caller proves with a token. */
export async function fetchEnvelopesFor(recipientMachineId: string): Promise<StoredEnvelope[]> {
  const col = await envelopesCollection()
  const docs = await col.find({ recipientMachineId }).sort({ createdAt: 1 }).limit(ENVELOPE_MAX_PER_RECIPIENT).toArray()
  return docs.map(d => ({
    id: d._id,
    senderMachineId: d.senderMachineId,
    envelope: d.envelope,
    createdAt: fromBsonDate(d.createdAt),
  }))
}

/**
 * Drop a machine's published key and every envelope to or from it. Called when its token is
 * revoked: the machine no longer exists, so neither should the key anyone would seal to nor the
 * mail nobody will ever collect.
 */
export async function forgetMachineKeys(machineId: string): Promise<void> {
  const [keys, envelopes] = await Promise.all([keysCollection(), envelopesCollection()])
  await Promise.all([
    keys.deleteOne({ _id: machineId }),
    envelopes.deleteMany({ $or: [{ senderMachineId: machineId }, { recipientMachineId: machineId }] }),
  ])
}

/** Acknowledge and delete. Scoped to the RECIPIENT: a machine can only ever delete its own mail,
 *  so a hostile id list cannot clear a sibling's mailbox. */
export async function ackEnvelopes(recipientMachineId: string, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0
  const col = await envelopesCollection()
  const res = await col.deleteMany({ recipientMachineId, _id: { $in: [...ids] } })
  return res.deletedCount ?? 0
}
