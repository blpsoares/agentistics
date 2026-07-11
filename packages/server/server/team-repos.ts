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
import { normalizeGitRemote, repoShortName } from '@agentistics/core'
import { getMongoDb } from './mongo'
import { mintToken, revokeToken } from './team-tokens'

export interface RepoDoc {
  _id: string        // the normalized remote (host/org/repo) — also the dedup key
  remote: string     // same as _id, explicit for reads
  name: string       // display name (defaults to org/repo)
  tokenId: string    // sha256 hash of the CI token (memberId of pushed sessions)
  createdAt: string
}

/** Safe repo record for listing (no token material). */
export interface RepoInfo {
  remote: string
  name: string
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
  name?: string,
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
      await db.collection('sessions').deleteMany({ memberId: existing.tokenId }).catch(() => {})
    } catch { /* best-effort cleanup */ }
  }

  const displayName = (name && name.trim()) || repoShortName(remote)
  const token = await mintToken('github-actions', `CI · ${remote}`, { repo: remote, ci: true })
  const { hashToken } = await import('./team-tokens')
  const tokenId = hashToken(token)

  await col.replaceOne(
    { _id: remote },
    { remote, name: displayName, tokenId, createdAt: new Date().toISOString() },
    { upsert: true },
  )
  return { ok: true, token, remote }
}

/** List all registered repositories (no token material). */
export async function listRepos(): Promise<RepoInfo[]> {
  const col = await getReposCollection()
  const docs = await col.find({}).sort({ createdAt: 1 }).toArray()
  return docs.map(d => ({ remote: d.remote, name: d.name, createdAt: d.createdAt }))
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
    await db.collection('sessions').deleteMany({ memberId: doc.tokenId }).catch(() => {})
    const { deleteMemberStats } = await import('./team-stats')
    await deleteMemberStats(doc.tokenId).catch(() => {})
  } catch { /* best-effort */ }
  await col.deleteOne({ _id: remote })
  return true
}
