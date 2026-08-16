/**
 * teams.ts — the `teams` collection. A team is the unit of visibility + permission;
 * members/repos carry a teamId. `makeTeamDoc` is pure/deterministic for unit tests.
 */
import { randomBytes } from 'node:crypto'
import type { Collection } from 'mongodb'
import { getMongoDb } from './mongo'
import type { TeamDoc } from './iam-types'
import { planOrgTeam } from './org-team'

/** Stable id of the seeded team every pre-existing member/repo is migrated into (Phase 2). */
export const DEFAULT_TEAM_ID = 'default'

export function makeTeamDoc(name: string, id: string, now: Date, createdBy?: string): TeamDoc {
  return { _id: id, name, createdAt: now, createdBy }
}

/** The org team first-boot creates — the same doc, marked with its provenance. Created EMPTY:
 *  a team doc carries no members (accounts join through their own `memberships`), so "empty" is
 *  what NOT writing anything else means. See org-team.ts for why that matters. */
export function makeOrgTeamDoc(name: string, id: string, now: Date, createdBy?: string): TeamDoc {
  return { ...makeTeamDoc(name, id, now, createdBy), orgTeam: true }
}

export async function getTeamsCollection(): Promise<Collection<TeamDoc>> {
  const db = await getMongoDb()
  return db.collection<TeamDoc>('teams')
}

export async function createTeam(name: string, createdBy?: string): Promise<TeamDoc> {
  const doc = makeTeamDoc(name, randomBytes(8).toString('hex'), new Date(), createdBy)
  const col = await getTeamsCollection()
  await col.insertOne(doc)
  return doc
}

/**
 * Create the organisation's team if `planOrgTeam` says to. Returns the team it created, or null
 * when it created nothing (placeholder org, or the central already has a team).
 *
 * IO only — every decision is in the pure `planOrgTeam`. Nobody is added to the team here, and
 * nothing else may add anyone later: see org-team.ts for why an auto-joined team is the thing this
 * is deliberately not.
 */
export async function createOrgTeam(org: string | undefined, createdBy?: string): Promise<TeamDoc | null> {
  const col = await getTeamsCollection()
  const plan = planOrgTeam({ org, existingTeams: await col.countDocuments({}, { limit: 1 }) })
  if (!plan.create) return null
  const doc = makeOrgTeamDoc(plan.name, randomBytes(8).toString('hex'), new Date(), createdBy)
  await col.insertOne(doc)
  return doc
}

export async function getTeam(id: string): Promise<TeamDoc | null> {
  const col = await getTeamsCollection()
  return col.findOne({ _id: id })
}

export async function listTeams(): Promise<TeamDoc[]> {
  const col = await getTeamsCollection()
  return col.find({}).toArray()
}

export async function updateTeam(id: string, name: string): Promise<void> {
  const col = await getTeamsCollection()
  await col.updateOne({ _id: id }, { $set: { name } })
}

export async function deleteTeam(id: string): Promise<void> {
  const col = await getTeamsCollection()
  await col.deleteOne({ _id: id })
}

/** Idempotently ensure the seeded Default team exists (every pre-existing member/repo maps here). */
export async function seedDefaultTeam(): Promise<void> {
  const col = await getTeamsCollection()
  await col.updateOne(
    { _id: DEFAULT_TEAM_ID },
    { $setOnInsert: { name: 'Default team', createdAt: new Date() } },
    { upsert: true },
  )
}
