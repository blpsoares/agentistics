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
import { teamDocId, type TeamSessionDoc } from './team-store'
import { DEFAULT_TEAM_ID } from './teams'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenDoc {
  _id: string
  user: string
  label: string
  createdAt: string
  lastSeenAt: string | null
  /** Normalized git remote (`host/org/repo`) this token is bound to, for repo/CI tokens.
   *  When set, ingest stamps every pushed session's `git_remote` with this value authoritatively. */
  repo?: string
  /** True for GitHub Actions / CI tokens — ingest stamps `ci: true` on every pushed session. */
  ci?: boolean
  teamId?: string
  /** Account ID for machine tokens — identifies which account owns a registered machine. */
  accountId?: string
}

export type MemberInfo = {
  id: string
  user: string
  label: string
  createdAt: string
  lastSeenAt: string | null
  /** Live status — populated by the members endpoint from the presence snapshot. */
  online?: boolean
  latencyMs?: number | null
}

export type MachineInfo = {
  id: string
  accountId?: string
  machineName: string
  user: string
  teamId?: string
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
export async function mintToken(user: string, label: string, opts?: { repo?: string; ci?: boolean; accountId?: string; teamId?: string }): Promise<string> {
  // 32 random bytes → 64-char hex string (256 bits of entropy). Repo/CI tokens use 48 bytes
  // (96-char) — longer since they live as a GitHub Actions secret with broader blast radius.
  const token = randomBytes(opts?.ci ? 48 : 32).toString('hex')
  const id = hashToken(token)
  const doc: TokenDoc = {
    _id: id,
    user,
    label,
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
    teamId: opts?.teamId ?? DEFAULT_TEAM_ID,
    ...(opts?.repo ? { repo: opts.repo } : {}),
    ...(opts?.ci ? { ci: true } : {}),
    ...(opts?.accountId ? { accountId: opts.accountId } : {}),
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
 * Rotate a member's token: mint a fresh token while preserving all of the member's
 * history. Returns the new plaintext token (shown once), or `null` if no token with
 * `oldId` exists.
 *
 * The member's identity key is the token hash (`memberId`), so rotating the token
 * changes that key. To keep history, every doc keyed by the old id is migrated to the
 * new id:
 *   - `sessions`     — each TeamSessionDoc is re-inserted with the new memberId and a
 *                      recomputed _id (teamDocId), then the old docs are removed.
 *   - `memberStats`  — the per-member aggregate (keyed by _id = memberId) is copied.
 *   - `tokens`       — the token doc is replaced (new hash id, same metadata).
 */
export async function rotateToken(oldId: string): Promise<string | null> {
  const col = await getTokensCollection()
  const doc = await col.findOne({ _id: oldId })
  if (!doc) return null

  const token = randomBytes(32).toString('hex')
  const newId = hashToken(token)

  const db = await getMongoDb()

  // Migrate sessions: rebuild each doc under the new memberId + _id.
  const sessions = db.collection<TeamSessionDoc>('sessions')
  const oldSessions = await sessions.find({ memberId: oldId }).toArray()
  if (oldSessions.length > 0) {
    const migrated = oldSessions.map(d => ({
      ...d,
      memberId: newId,
      _id: teamDocId(d.org, newId, d.harness ?? 'claude', d.session_id),
    }))
    await sessions.insertMany(migrated, { ordered: false }).catch(() => {})
    await sessions.deleteMany({ memberId: oldId })
  }

  // Migrate memberStats: keyed by _id = memberId.
  const memberStats = db.collection<{ _id: string }>('memberStats')
  const statsDoc = await memberStats.findOne({ _id: oldId })
  if (statsDoc) {
    await memberStats.insertOne({ ...statsDoc, _id: newId }).catch(() => {})
    await memberStats.deleteOne({ _id: oldId })
  }

  // Replace the token doc (new hash id, same metadata).
  await col.insertOne({
    _id: newId,
    user: doc.user,
    label: doc.label,
    createdAt: doc.createdAt,
    lastSeenAt: doc.lastSeenAt,
  })
  await col.deleteOne({ _id: oldId })

  return token
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
 *   - If found, updates `lastSeenAt` and returns `{ ok: true, user, memberId }`.
 *   - `memberId` is the token's hash `_id` — the stable identity key used in Mongo docs.
 *   - If not found, returns `{ ok: false }`.
 * Never logs the raw bearer string.
 */
export async function validateIngestToken(
  bearer: string | null,
): Promise<{ ok: true; user: string; memberId: string; repo?: string; ci?: boolean; label?: string; teamId?: string; accountId?: string } | { ok: false }> {
  if (!bearer) return { ok: false }
  const id = hashToken(bearer)
  const col = await getTokensCollection()
  const doc = await col.findOne({ _id: id })
  if (!doc) return { ok: false }
  // Update last-seen — fire and forget (non-critical, must not block the caller).
  void col.updateOne({ _id: id }, { $set: { lastSeenAt: new Date().toISOString() } }).catch(() => {})
  return { ok: true, user: doc.user, memberId: id, repo: doc.repo, ci: doc.ci, label: doc.label, teamId: doc.teamId, accountId: doc.accountId }
}

/**
 * Rename a member by updating the `user` field on their token doc.
 * Returns `true` if a document was matched (and updated), `false` if no token with that id exists.
 * Subsequent ingests by that member will carry the new name automatically; existing session docs
 * in the `sessions` collection are resolved at read time via `getMemberNameMap()`.
 */
export async function setMemberName(id: string, user: string): Promise<boolean> {
  const col = await getTokensCollection()
  const result = await col.updateOne({ _id: id }, { $set: { user } })
  return result.matchedCount > 0
}

/**
 * Returns a map of `{ [tokenId]: user }` for every token in the collection.
 * Used by `loadTeamSessionsFromMongo` to resolve the current display name for each session
 * at read time, so a member rename is reflected immediately without re-ingesting sessions.
 */
export async function getMemberNameMap(): Promise<Record<string, string>> {
  const col = await getTokensCollection()
  const docs = await col.find({}, { projection: { _id: 1, user: 1 } }).toArray()
  const map: Record<string, string> = {}
  for (const doc of docs) {
    map[doc._id] = doc.user
  }
  return map
}

/** memberId (token hash) → teamId, for read-time team tagging. Defaults to DEFAULT_TEAM_ID. */
export async function getMemberTeamMap(): Promise<Record<string, string>> {
  const col = await getTokensCollection()
  const docs = await col.find({}, { projection: { _id: 1, teamId: 1 } }).toArray()
  const map: Record<string, string> = {}
  for (const d of docs) map[d._id] = d.teamId ?? DEFAULT_TEAM_ID
  return map
}

/**
 * Mint a machine token bound to an accountId and team.
 * Returns the token hash (id) and plaintext token.
 */
export async function mintMachineToken(input: { accountId: string; user: string; machineName: string; teamId: string }): Promise<{ id: string; token: string }> {
  const token = await mintToken(input.user, input.machineName, { accountId: input.accountId, teamId: input.teamId })
  const id = hashToken(token)
  return { id, token }
}

/**
 * List all machine tokens (excludes CI and repo tokens).
 * Returns machine records with the token hash as id (no plaintext).
 */
export async function listMachines(): Promise<MachineInfo[]> {
  const col = await getTokensCollection()
  const docs = await col.find({ ci: { $ne: true }, repo: { $exists: false } }).toArray()
  return docs.map(d => ({
    id: d._id,
    accountId: d.accountId,
    machineName: d.label || d.user,
    user: d.user,
    teamId: d.teamId,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
  }))
}

/** Set of every live token id (hash). Central reads filter team data by this so a revoked
 *  member's orphaned sessions/stats/workflows never keep showing after the token is gone. */
export async function getLiveTokenIds(): Promise<Set<string>> {
  const col = await getTokensCollection()
  const docs = await col.find({}, { projection: { _id: 1 } }).toArray()
  return new Set(docs.map(d => d._id))
}

/** Reassign a machine token to a different team. Returns true if a doc was matched. */
export async function setMachineTeam(id: string, teamId: string): Promise<boolean> {
  const col = await getTokensCollection()
  const res = await col.updateOne({ _id: id }, { $set: { teamId } })
  return res.matchedCount > 0
}

/** Rename a machine (updates the token doc's `label`). Returns true if a doc was matched. The new
 *  name reflects on the machine on its next whoami handshake (machineName = label). */
export async function setMachineLabel(id: string, label: string): Promise<boolean> {
  const col = await getTokensCollection()
  const res = await col.updateOne({ _id: id }, { $set: { label } })
  return res.matchedCount > 0
}

/** Assign/replace a machine's owner account (sets accountId + user = the account's display name). */
export async function setMachineOwner(id: string, accountId: string, user: string): Promise<boolean> {
  const col = await getTokensCollection()
  const res = await col.updateOne({ _id: id }, { $set: { accountId, user } })
  return res.matchedCount > 0
}

/** Assign the Default team to any token minted before teams existed. Idempotent. */
export async function backfillTokenTeamIds(): Promise<void> {
  const col = await getTokensCollection()
  await col.updateMany({ teamId: { $exists: false } }, { $set: { teamId: DEFAULT_TEAM_ID } })
}
