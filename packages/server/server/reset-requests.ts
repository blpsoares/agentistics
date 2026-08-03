/**
 * reset-requests.ts — "I forgot my password, please reset it" from a member.
 *
 * The owner path (`/api/iam/recover`) proves the second factor and needs nobody. A member may
 * have no second factor at all, so theirs is a REQUEST: it grants nothing, changes nothing, and
 * only puts a row in front of the people who could already reset that account anyway (an owner,
 * or a manager of one of their teams — the same `canDeleteAccount` authority the account PATCH
 * uses). The reset itself remains the existing, step-up-protected route.
 *
 * The creating endpoint is PUBLIC, because the person is locked out. Everything below exists
 * because of that: one open request per account so the queue cannot be flooded, a reason field
 * that is length-capped and scrubbed, and no response that distinguishes a real account from an
 * invented one.
 */
import { randomBytes } from 'node:crypto'
import { getMongoDb } from './mongo'
import { redactSecrets } from '@agentistics/core'

const COLLECTION = 'resetRequests'

/** Long enough to explain, short enough not to be a storage channel. */
export const REASON_MAX = 280

export interface ResetRequestDoc {
  _id: string
  accountId: string
  /** Denormalized for the admin list; the account may be renamed but not re-keyed. */
  email: string
  name: string
  reason?: string
  /** BSON Dates — see mongo-dates.ts. */
  createdAt: Date
  resolvedAt?: Date
  /** Who acted, when it was resolved. */
  resolvedBy?: string
  status: 'open' | 'done' | 'dismissed'
}

/** What the admin UI sees. Dates cross the wire as ISO strings, like every other API type. */
export interface ResetRequestInfo {
  id: string
  accountId: string
  email: string
  name: string
  reason?: string
  createdAt: string
  status: 'open' | 'done' | 'dismissed'
}

/**
 * Normalize a submitted reason (pure).
 *
 * Capped, control characters flattened, and run through `redactSecrets` — this is free text from
 * an UNAUTHENTICATED caller that lands in an owner's browser and in the central's database. The
 * redactor is the same one the team pipeline uses on `first_prompt`, and is here for the same
 * reason: somebody, eventually, pastes a credential into a box that asked them to explain
 * themselves.
 */
export function normalizeReason(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const flat = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  return redactSecrets(flat.slice(0, REASON_MAX))
}

async function col() {
  const db = await getMongoDb()
  return db.collection<ResetRequestDoc>(COLLECTION)
}

export async function ensureResetRequestIndexes(): Promise<void> {
  const c = await col()
  await c.createIndex({ accountId: 1, status: 1 }).catch(() => {})
  await c.createIndex({ createdAt: -1 }).catch(() => {})
}

/**
 * Record a request, or leave the existing open one alone.
 *
 * Returns whether a NEW row was written — the caller must not vary its response on that (the
 * endpoint is public), but the notification should not fire again for a request already sitting
 * in somebody's list.
 */
export async function openResetRequest(input: {
  accountId: string
  email: string
  name: string
  reason?: string
  now: Date
}): Promise<boolean> {
  const c = await col()
  const existing = await c.findOne({ accountId: input.accountId, status: 'open' })
  if (existing) {
    // Keep the newest explanation — someone who asks twice usually adds detail the second time —
    // without multiplying rows.
    if (input.reason && input.reason !== existing.reason) {
      await c.updateOne({ _id: existing._id }, { $set: { reason: input.reason } })
    }
    return false
  }
  await c.insertOne({
    _id: randomBytes(12).toString('hex'),
    accountId: input.accountId,
    email: input.email,
    name: input.name,
    reason: input.reason,
    createdAt: input.now,
    status: 'open',
  })
  return true
}

export async function listOpenResetRequests(): Promise<ResetRequestDoc[]> {
  const c = await col()
  return c.find({ status: 'open' }).sort({ createdAt: -1 }).limit(200).toArray()
}

/** Close every open request for an account. Called when its password is actually reset, so the
 *  queue cannot disagree with reality by being a separate thing to remember. */
export async function closeResetRequests(
  accountId: string,
  by: string,
  status: 'done' | 'dismissed',
  now: Date,
): Promise<number> {
  const c = await col()
  const res = await c.updateMany(
    { accountId, status: 'open' },
    { $set: { status, resolvedBy: by, resolvedAt: now } },
  )
  return res.modifiedCount ?? 0
}

export async function getResetRequest(id: string): Promise<ResetRequestDoc | null> {
  return (await col()).findOne({ _id: id })
}
