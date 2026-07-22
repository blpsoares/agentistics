/**
 * accounts.ts — the `accounts` collection (governance/IAM). CRUD is thin IO over
 * the shared Mongo singleton; `makeAccountDoc` is a pure, deterministic builder so
 * it can be unit-tested. Passwords are stored ONLY as argon2id hashes (see passwords.ts).
 */
import { randomBytes } from 'node:crypto'
import type { Collection } from 'mongodb'
import { getMongoDb } from './mongo'
import type { AccountDoc, Membership, Role } from './iam-types'
import { normalizeEmail } from './iam-types'

export interface NewAccount {
  name: string
  email: string
  passwordHash: string
  role: Role
  memberships: Membership[]
  createdBy?: string
}

/** Pure doc builder — deterministic given id + nowIso. */
export function makeAccountDoc(input: NewAccount, id: string, nowIso: string): AccountDoc {
  return {
    _id: id,
    name: input.name,
    email: input.email,
    emailLower: normalizeEmail(input.email),
    passwordHash: input.passwordHash,
    role: input.role,
    memberships: input.memberships,
    sessionVersion: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: input.createdBy,
    lastLoginAt: null,
  }
}

export async function getAccountsCollection(): Promise<Collection<AccountDoc>> {
  const db = await getMongoDb()
  return db.collection<AccountDoc>('accounts')
}

/** Enforce email uniqueness. Idempotent — safe to call on every boot. */
export async function ensureAccountIndexes(): Promise<void> {
  const col = await getAccountsCollection()
  await col.createIndex({ emailLower: 1 }, { unique: true })
}

export async function createAccount(input: NewAccount): Promise<AccountDoc> {
  const doc = makeAccountDoc(input, randomBytes(12).toString('hex'), new Date().toISOString())
  const col = await getAccountsCollection()
  await col.insertOne(doc)
  return doc
}

export async function getAccount(id: string): Promise<AccountDoc | null> {
  const col = await getAccountsCollection()
  return col.findOne({ _id: id })
}

export async function findAccountByEmail(email: string): Promise<AccountDoc | null> {
  const col = await getAccountsCollection()
  return col.findOne({ emailLower: normalizeEmail(email) })
}

export async function listAccounts(): Promise<AccountDoc[]> {
  const col = await getAccountsCollection()
  return col.find({}).toArray()
}

export async function updateAccount(
  id: string,
  patch: Partial<Pick<AccountDoc, 'name' | 'passwordHash' | 'role' | 'memberships' | 'lastLoginAt'>>,
): Promise<void> {
  const col = await getAccountsCollection()
  await col.updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date().toISOString() } })
}

export async function deleteAccount(id: string): Promise<void> {
  const col = await getAccountsCollection()
  await col.deleteOne({ _id: id })
}

/** Invalidate every existing session for this account (logout-all / password change / revoke). */
export async function bumpSessionVersion(id: string): Promise<void> {
  const col = await getAccountsCollection()
  await col.updateOne({ _id: id }, { $inc: { sessionVersion: 1 }, $set: { updatedAt: new Date().toISOString() } })
}

export async function countAccounts(): Promise<number> {
  const col = await getAccountsCollection()
  return col.countDocuments({})
}

/** True once at least one owner account exists — drives the bootstrap gate (Phase 2). */
export async function hasAnyOwner(): Promise<boolean> {
  const col = await getAccountsCollection()
  return (await col.countDocuments({ role: 'owner' }, { limit: 1 })) > 0
}
