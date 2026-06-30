/**
 * team-tokens.ts — Mongo-backed ingest token store for Team Mode Phase 3.
 *
 * Only SHA-256 hashes of tokens are stored; the plaintext is returned once
 * at mint time and never persisted or logged.
 *
 * Collection: `tokens` (separate from `sessions`).
 * Document schema:
 *   { _id: <sha256(token) hex>,  // the hash IS the lookup key
 *     user: string,
 *     label: string,
 *     createdAt: string,         // ISO 8601
 *     lastSeenAt: string | null  // updated on every valid ingest request
 *   }
 *
 * Pure helper: hashToken (unit-tested in team-tokens.test.ts, no Mongo needed).
 */

import { createHash, randomBytes } from 'node:crypto'
import type { Collection } from 'mongodb'
import { getMongoDb } from './mongo'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenDoc {
  _id: string
  user: string
  label: string
  createdAt: string
  lastSeenAt: string | null
}

export type MemberInfo = {
  id: string
  user: string
  label: string
  createdAt: string
  lastSeenAt: string | null
}

// ---------------------------------------------------------------------------
// PURE helper (no side effects — unit-tested without Mongo)
// ---------------------------------------------------------------------------

/**
 * Deterministic SHA-256 hash of a token, returned as a 64-character hex string.
 * This is the `_id` stored in Mongo; the plaintext is never persisted.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function getTokensCollection(): Promise<Collection<TokenDoc>> {
  const db = await getMongoDb()
  return db.collection<TokenDoc>('tokens')
}

// ---------------------------------------------------------------------------
// Public async API
// ---------------------------------------------------------------------------

/**
 * Mint a new random ingest token. Stores only the SHA-256 hash in Mongo.
 * Returns the plaintext token (shown once; never stored or logged here).
 */
export async function mintToken(user: string, label: string): Promise<string> {
  // 32 random bytes → 64-char hex string (256 bits of entropy)
  const token = randomBytes(32).toString('hex')
  const id = hashToken(token)
  const doc: TokenDoc = {
    _id: id,
    user,
    label,
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
  }
  const col = await getTokensCollection()
  await col.insertOne(doc)
  return token
}

/**
 * Revoke a token by its hash id. Returns true if a document was deleted.
 */
export async function revokeToken(id: string): Promise<boolean> {
  const col = await getTokensCollection()
  const result = await col.deleteOne({ _id: id })
  return result.deletedCount > 0
}

/**
 * List all minted tokens as safe member records (hash id only; no plaintext).
 */
export async function listMembers(): Promise<MemberInfo[]> {
  const col = await getTokensCollection()
  const docs = await col.find({}).sort({ createdAt: 1 }).toArray()
  return docs.map(d => ({
    id: d._id,
    user: d.user,
    label: d.label,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
  }))
}

/**
 * Returns whether any tokens are stored in the collection.
 * Used by team-ingest.ts to decide whether the "open" Phase-2a fallback applies.
 */
export async function hasAnyTokens(): Promise<boolean> {
  const col = await getTokensCollection()
  const count = await col.estimatedDocumentCount()
  return count > 0
}

/**
 * Validate a bearer token from an ingest request:
 *   - Hashes the bearer, looks up the hash in Mongo.
 *   - If found, updates `lastSeenAt` and returns `{ ok: true, user }`.
 *   - If not found, returns `{ ok: false }`.
 * Never logs the raw bearer string.
 */
export async function validateIngestToken(
  bearer: string | null,
): Promise<{ ok: boolean; user?: string }> {
  if (!bearer) return { ok: false }
  const id = hashToken(bearer)
  const col = await getTokensCollection()
  const doc = await col.findOne({ _id: id })
  if (!doc) return { ok: false }
  // Update last-seen — fire and forget (non-critical, must not block the caller).
  void col.updateOne({ _id: id }, { $set: { lastSeenAt: new Date().toISOString() } }).catch(() => {})
  return { ok: true, user: doc.user }
}
