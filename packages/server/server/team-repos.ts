/**
 * team-repos.ts — central-side registry of repositories tracked via GitHub Actions.
 *
 * A "registered repo" binds a normalized git remote to a long CI ingest token that is stored
 * as a GitHub Actions secret. When an ephemeral runner pushes with that token, the ingest path
 * stamps every session's `git_remote` (= the registered remote) and `ci: true` authoritatively,
 * so a repo's CI usage lands under the right repository regardless of what the runner reports.
 *
 * Collection: `repos`
 *   { _id: <normalized remote>, remote, name, tokenId, createdAt }
 * The plaintext token is returned once at registration time and never persisted (only its hash,
 * in the `tokens` collection, keyed by `tokenId`).
 */

import type { Collection } from 'mongodb'
import { normalizeGitRemote } from '@agentistics/core'
import { getMongoDb } from './mongo'
import { mintToken, revokeToken } from './team-tokens'
import { ciMemberId } from './team-oidc'
import { DEFAULT_TEAM_ID } from './teams'

export interface RepoDoc {
  _id: string        // the normalized remote (host/org/repo) — also the dedup key
  remote: string     // same as _id, explicit for reads
  tokenId: string    // sha256 hash of the CI token (memberId of pushed sessions)
  createdAt: string
  teamId?: string
}

/** Safe repo record for listing (no token material). The display name is always derived from
 *  the remote (`repoShortName`) client-side — there is no separately-stored name. */
export interface RepoInfo {
  remote: string
  createdAt: string
}

async function getReposCollection(): Promise<Collection<RepoDoc>> {
  const db = await getMongoDb()
  return db.collection<RepoDoc>('repos')
}

/**
 * Register a repository and mint its CI token. Idempotent on the remote: re-registering an
 * existing repo revokes the old token (and its sessions) and issues a fresh one, so a leaked
 * secret can be rotated by simply registering again.
 *
 * @returns the plaintext CI token (shown once) + the normalized remote, or an error string.
 */
export async function registerRepo(
  rawUrl: string,
): Promise<{ ok: true; token: string; remote: string } | { ok: false; error: string }> {
  const remote = normalizeGitRemote(rawUrl)
  if (!remote) return { ok: false, error: 'invalid or unrecognized git remote URL' }

  const col = await getReposCollection()
  const existing = await col.findOne({ _id: remote })
  if (existing) {
    // Rotate: revoke the old token (cascades its CI sessions) before minting a new one.
    await revokeToken(existing.tokenId).catch(() => {})
    try {
      const db = await getMongoDb()
      // Clear this repo's CI sessions under both possible identities: the old token hash
      // (static-token pushes) and the repo-scoped id (OIDC/keyless pushes).
      await db.collection('sessions').deleteMany({ memberId: { $in: [existing.tokenId, ciMemberId(remote)] } }).catch(() => {})
    } catch { /* best-effort cleanup */ }
  }

  const token = await mintToken('github-actions', `CI · ${remote}`, { repo: remote, ci: true })
  const { hashToken } = await import('./team-tokens')
  const tokenId = hashToken(token)

  await col.replaceOne(
    { _id: remote },
    { remote, tokenId, teamId: DEFAULT_TEAM_ID, createdAt: new Date().toISOString() },
    { upsert: true },
  )
  return { ok: true, token, remote }
}

/** Is this normalized remote in the registry (i.e. allowed to push CI metrics)? Used by the
 *  OIDC ingest path as the repo allowlist — a valid GitHub OIDC token still only counts if the
 *  admin has registered that repo. */
export async function isRepoRegistered(remote: string): Promise<boolean> {
  if (!remote) return false
  const col = await getReposCollection()
  const doc = await col.findOne({ _id: remote }, { projection: { _id: 1 } })
  return !!doc
}

/** List all registered repositories (no token material). */
export async function listRepos(): Promise<RepoInfo[]> {
  const col = await getReposCollection()
  const docs = await col.find({}).sort({ createdAt: 1 }).toArray()
  return docs.map(d => ({ remote: d.remote, createdAt: d.createdAt }))
}

/**
 * Unregister a repository: revoke its CI token (cascading its CI sessions) and drop the repo doc.
 * `remote` may be any URL form; it is normalized first. Returns true if a repo was removed.
 */
export async function unregisterRepo(rawRemote: string): Promise<boolean> {
  const remote = normalizeGitRemote(rawRemote) || rawRemote
  const col = await getReposCollection()
  const doc = await col.findOne({ _id: remote })
  if (!doc) return false
  await revokeToken(doc.tokenId).catch(() => {})
  try {
    const db = await getMongoDb()
    const ids = [doc.tokenId, ciMemberId(remote)]
    await db.collection('sessions').deleteMany({ memberId: { $in: ids } }).catch(() => {})
    const { deleteMemberStats } = await import('./team-stats')
    for (const id of ids) await deleteMemberStats(id).catch(() => {})
  } catch { /* best-effort */ }
  await col.deleteOne({ _id: remote })
  return true
}

/** Assign the Default team to any repo registered before teams existed. Idempotent. */
export async function backfillRepoTeamIds(): Promise<void> {
  const col = await getReposCollection()
  await col.updateMany({ teamId: { $exists: false } }, { $set: { teamId: DEFAULT_TEAM_ID } })
}
