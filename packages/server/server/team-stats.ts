/**
 * team-stats.ts — per-member statsCache storage (central).
 *
 * Each member pushes its own raw Claude statsCache (aggregated history that survives
 * Claude's 30-day file cleanup and therefore never exists as individual sessions). The
 * central stores the latest one per member so it can reproduce the member's authoritative
 * totals exactly — the fix for "central numbers don't match the machine".
 *
 * Stored in the `memberStats` collection, keyed by the stable memberId (token hash, or
 * `legacy:<user>` for shared-secret ingests).
 */
import type { StatsCache } from '@agentistics/core'
import { getMongoDb } from './mongo'

interface MemberStatsDoc {
  _id: string        // memberId
  org: string
  user: string       // cached display name (read-time resolution overrides for the dashboard)
  statsCache: StatsCache
  updatedAt: string
}

async function statsCol() {
  const db = await getMongoDb()
  return db.collection<MemberStatsDoc>('memberStats')
}

/** Upsert a member's latest statsCache. Idempotent. */
export async function upsertMemberStats(org: string, memberId: string, user: string, statsCache: StatsCache): Promise<void> {
  const col = await statsCol()
  await col.replaceOne(
    { _id: memberId },
    { org, user, statsCache, updatedAt: new Date().toISOString() },
    { upsert: true },
  )
}

/** All stored member statsCaches (memberId + cached user + the cache). */
export async function loadAllMemberStats(): Promise<{ memberId: string; user: string; statsCache: StatsCache }[]> {
  const col = await statsCol()
  const docs = await col.find({}).toArray()
  return docs.map(d => ({ memberId: d._id, user: d.user, statsCache: d.statsCache }))
}

/** Remove a member's stored statsCache (used by revoke cascade / leave). Best-effort. */
export async function deleteMemberStats(memberId: string): Promise<number> {
  try {
    const col = await statsCol()
    const res = await col.deleteOne({ _id: memberId })
    return res.deletedCount ?? 0
  } catch {
    return 0
  }
}
