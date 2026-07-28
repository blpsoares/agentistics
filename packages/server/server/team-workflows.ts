/**
 * team-workflows.ts — per-member workflow-run storage (central).
 *
 * Mirrors team-store.ts (sessions): each member pushes its local WorkflowRun[] (computed
 * metrics only — runId/name/sessionId/status/phases/agents/totals, NEVER chat or prompt
 * text, same as WorkflowRun's shape in @agentistics/core) and the central upserts them into
 * the `workflows` collection, keyed by `(org, memberId, runId)` so re-ingesting an unchanged
 * run is a no-op write and reruns/renames never duplicate documents.
 *
 * `memberId` is the same stable token-hash identity used for sessions (team-store.ts),
 * making member renames safe here too.
 */
import type { WorkflowRun } from '@agentistics/core'
import { getWorkflowsCollection } from './mongo'
import { toBsonDate, fromBsonDate, type StoredDate } from './mongo-dates'

/** As stored: `startedAt` is a BSON Date (null when the run's start is unknown), not an ISO
 *  string. See mongo-dates.ts for why, and toTeamWorkflowDoc/fromTeamWorkflowDoc for the
 *  conversion — they are the only places that cross the boundary. */
export type TeamWorkflowDoc = Omit<WorkflowRun, 'startedAt'> & {
  _id: string
  org: string
  /** Stable token identity key (SHA-256 hash of the bearer token, or `legacy:<user>`). */
  memberId: string
  /** Cached display name as of the last ingest; overridden at read time by getMemberNameMap(). */
  user: string
  startedAt: Date | null
}

/** Stable, collision-safe Mongo _id keyed by memberId (token hash), mirroring teamDocId(). */
export function teamWorkflowDocId(org: string, memberId: string, runId: string): string {
  return `${org}:${memberId}:${runId}`
}

/** Map a WorkflowRun + identity to a Mongo doc. Pure — does not mutate the input. */
export function toTeamWorkflowDoc(run: WorkflowRun, org: string, memberId: string, user: string): TeamWorkflowDoc {
  const { startedAt, ...rest } = run
  return {
    ...rest,
    user,      // always string — overrides the optional user field on WorkflowRun
    org,
    memberId,
    _id: teamWorkflowDocId(org, memberId, run.runId),
    startedAt: toBsonDate(startedAt),
  }
}

/** Map a Mongo doc back to a plain WorkflowRun (drops _id/org/memberId, keeps user). Pure.
 *  `startedAt` returns to its ISO wire shape ('' when unknown); a legacy string date in an
 *  unmigrated doc reads identically. */
export function fromTeamWorkflowDoc(doc: Omit<TeamWorkflowDoc, 'startedAt'> & { startedAt?: StoredDate }): WorkflowRun {
  const { _id, org, memberId, startedAt, ...rest } = doc
  void _id; void org; void memberId
  return { ...rest, startedAt: fromBsonDate(startedAt) }
}

/**
 * Upsert every workflow run as a team doc keyed by org:memberId:runId.
 * Idempotent: re-posting an identical run is a no-op write. Returns count.
 */
export async function ingestWorkflows(org: string, memberId: string, user: string, runs: WorkflowRun[]): Promise<number> {
  if (runs.length === 0) return 0
  const col = await getWorkflowsCollection()
  const ops = runs.filter(r => r.runId).map(r => {
    const doc = toTeamWorkflowDoc(r, org, memberId, user)
    return { replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }
  })
  if (ops.length === 0) return 0
  await col.bulkWrite(ops, { ordered: false })
  return ops.length
}

/**
 * Central read: load every team workflow run from Mongo, mapped back to plain WorkflowRun.
 * `user` is resolved the same way as loadTeamSessionsFromMongo (team-source.ts): the live
 * tokens table takes precedence over the cached doc value, so a member rename is reflected
 * immediately without re-ingest.
 */
export async function loadAllTeamWorkflows(nameMap: Record<string, string> = {}, liveIds?: Set<string> | null): Promise<WorkflowRun[]> {
  const col = await getWorkflowsCollection()
  const docs = await col.find({}).toArray()
  return docs
    // Drop runs from revoked members (when a live-token set is supplied) so a removed machine's
    // workflows don't linger. Omitting liveIds keeps the old passthrough behavior.
    .filter(doc => liveIds === undefined || liveIds === null || liveIds.has(doc.memberId))
    .map(doc => {
      const resolved = { ...doc, user: nameMap[doc.memberId] ?? doc.user }
      return fromTeamWorkflowDoc(resolved)
    })
}

/** Remove a member's stored workflow runs (used by revoke cascade / leave). Best-effort. */
export async function deleteMemberWorkflows(memberId: string): Promise<number> {
  try {
    const col = await getWorkflowsCollection()
    const res = await col.deleteMany({ memberId })
    return res.deletedCount ?? 0
  } catch {
    return 0
  }
}
