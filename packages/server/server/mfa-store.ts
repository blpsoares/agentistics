/**
 * mfa-store.ts — per-account TOTP enrolment, in the `mfa` collection.
 * Thin IO over the shared Mongo singleton; the crypto lives in totp.ts.
 * Recovery codes are stored ONLY as sha256 hashes and are removed as they are consumed.
 */
import { getMongoDb } from './mongo'

export interface MfaDoc {
  _id: string // accountId
  secret: string // base32 TOTP secret
  enabledAt: string
  recoveryHashes: string[]
}

async function col() {
  const db = await getMongoDb()
  return db.collection<MfaDoc>('mfa')
}

export async function getMfa(accountId: string): Promise<MfaDoc | null> {
  return (await col()).findOne({ _id: accountId })
}

export async function isMfaEnabled(accountId: string): Promise<boolean> {
  return !!(await getMfa(accountId))
}

export async function enableMfa(
  accountId: string,
  secret: string,
  recoveryHashes: string[],
): Promise<void> {
  await (await col()).updateOne(
    { _id: accountId },
    { $set: { secret, recoveryHashes, enabledAt: new Date().toISOString() } },
    { upsert: true },
  )
}

/** Single-use: the code is removed from the account as it is spent. */
export async function consumeRecoveryCode(accountId: string, hash: string): Promise<boolean> {
  const res = await (await col()).updateOne({ _id: accountId }, { $pull: { recoveryHashes: hash } })
  return res.modifiedCount === 1
}

export async function disableMfa(accountId: string): Promise<void> {
  await (await col()).deleteOne({ _id: accountId })
}

/** Account ids of every owner that has NOT enrolled — drives the exposure preflight. */
export async function accountsWithoutMfa(accountIds: string[]): Promise<string[]> {
  if (!accountIds.length) return []
  const docs = await (await col()).find({ _id: { $in: accountIds } }).toArray()
  const enrolled = new Set(docs.map(d => d._id))
  return accountIds.filter(id => !enrolled.has(id))
}
