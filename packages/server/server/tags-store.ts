/**
 * tags-store.ts — Mongo persistence for tags (B5).
 *
 * Collection: `tags`
 *   { _id, name, color?, sources[], filters[], sharedWith[], createdBy, createdAt: Date, updatedAt: Date }
 *
 * Visibility is an explicit account list — never derived from teams. The creator and every owner
 * always see a tag; everyone else must be in `sharedWith`.
 */
import { randomBytes } from 'node:crypto'
import type { Collection } from 'mongodb'
import { getMongoDb } from './mongo'
import type { TagSource } from './tags-resolve'

export interface TagDoc {
  _id: string
  name: string
  color?: string
  sources: TagSource[]
  /** Optional narrowing of the union: OR within a type, AND across types. Never widens. */
  filters?: TagSource[]
  /** accountIds granted read access. The creator and owners are implicit and not stored here. */
  sharedWith: string[]
  createdBy: string
  /** BSON Dates — see mongo-dates.ts. The /api/tags responses render them as ISO strings. */
  createdAt: Date
  updatedAt: Date
}

async function getTagsCollection(): Promise<Collection<TagDoc>> {
  const db = await getMongoDb()
  return db.collection<TagDoc>('tags')
}

export async function listAllTags(): Promise<TagDoc[]> {
  const col = await getTagsCollection()
  return col.find({}).sort({ name: 1 }).toArray()
}

export async function getTag(id: string): Promise<TagDoc | null> {
  const col = await getTagsCollection()
  return col.findOne({ _id: id })
}

export async function createTag(input: {
  name: string; color?: string; sources: TagSource[]; filters?: TagSource[]; sharedWith: string[]; createdBy: string
}): Promise<TagDoc> {
  const now = new Date()
  const doc: TagDoc = {
    _id: randomBytes(12).toString('hex'),
    name: input.name,
    ...(input.color ? { color: input.color } : {}),
    sources: input.sources,
    ...(input.filters && input.filters.length ? { filters: input.filters } : {}),
    sharedWith: [...new Set(input.sharedWith.filter(Boolean))],
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  }
  const col = await getTagsCollection()
  await col.insertOne(doc)
  return doc
}

export async function updateTag(id: string, patch: {
  name?: string; color?: string; sources?: TagSource[]; filters?: TagSource[]; sharedWith?: string[]
}): Promise<boolean> {
  const col = await getTagsCollection()
  const $set: Partial<TagDoc> = { updatedAt: new Date() }
  if (patch.name !== undefined) $set.name = patch.name
  if (patch.color !== undefined) $set.color = patch.color
  if (patch.sources !== undefined) $set.sources = patch.sources
  if (patch.filters !== undefined) $set.filters = patch.filters
  if (patch.sharedWith !== undefined) $set.sharedWith = [...new Set(patch.sharedWith.filter(Boolean))]
  const res = await col.updateOne({ _id: id }, { $set })
  return res.matchedCount > 0
}

export async function deleteTag(id: string): Promise<boolean> {
  const col = await getTagsCollection()
  const res = await col.deleteOne({ _id: id })
  return res.deletedCount > 0
}

/**
 * Tags a principal may READ, decided by a caller-supplied predicate.
 *
 * The rule used to live here as `createdBy === me || sharedWith.includes(me)`, which is a stored
 * fact and therefore never expires: a manager removed from a team kept full aggregates over it
 * through a tag they had created. The live decision needs the principal's current source
 * visibility, which is Mongo-free and belongs in tags-authority — so this function only walks the
 * collection and defers to `canReadTag`.
 */
export async function visibleTagsFor(canRead: (tag: TagDoc) => boolean): Promise<TagDoc[]> {
  const all = await listAllTags()
  return all.filter(canRead)
}
