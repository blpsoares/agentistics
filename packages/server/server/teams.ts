/**
 * teams.ts — the `teams` collection. A team is the unit of visibility + permission;
 * members/repos carry a teamId. `makeTeamDoc` is pure/deterministic for unit tests.
 */
import { randomBytes } from 'node:crypto'
import type { Collection } from 'mongodb'
import { getMongoDb } from './mongo'
import type { TeamDoc } from './iam-types'

/** Stable id of the seeded team every pre-existing member/repo is migrated into (Phase 2). */
export const DEFAULT_TEAM_ID = 'default'

export function makeTeamDoc(name: string, id: string, nowIso: string, createdBy?: string): TeamDoc {
  return { _id: id, name, createdAt: nowIso, createdBy }
}

export async function getTeamsCollection(): Promise<Collection<TeamDoc>> {
  const db = await getMongoDb()
  return db.collection<TeamDoc>('teams')
}

export async function createTeam(name: string, createdBy?: string): Promise<TeamDoc> {
  const doc = makeTeamDoc(name, randomBytes(8).toString('hex'), new Date().toISOString(), createdBy)
  const col = await getTeamsCollection()
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
    { $setOnInsert: { name: 'Default team', createdAt: new Date().toISOString() } },
    { upsert: true },
  )
}
