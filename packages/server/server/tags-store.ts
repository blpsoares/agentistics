/**
 * tags-store.ts — Mongo persistence for tags (B5).
 *
 * Collection: `tags`
 *   { _id, name, color?, sources[], sharedWith[], createdBy, createdAt, updatedAt }
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
  /** accountIds granted read access. The creator and owners are implicit and not stored here. */
  sharedWith: string[]
  createdBy: string
  createdAt: string
  updatedAt: string
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
  name: string; color?: string; sources: TagSource[]; sharedWith: string[]; createdBy: string
}): Promise<TagDoc> {
  const now = new Date().toISOString()
  const doc: TagDoc = {
    _id: randomBytes(12).toString('hex'),
    name: input.name,
    ...(input.color ? { color: input.color } : {}),
    sources: input.sources,
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
  name?: string; color?: string; sources?: TagSource[]; sharedWith?: string[]
}): Promise<boolean> {
  const col = await getTagsCollection()
  const $set: Partial<TagDoc> = { updatedAt: new Date().toISOString() }
  if (patch.name !== undefined) $set.name = patch.name
  if (patch.color !== undefined) $set.color = patch.color
  if (patch.sources !== undefined) $set.sources = patch.sources
  if (patch.sharedWith !== undefined) $set.sharedWith = [...new Set(patch.sharedWith.filter(Boolean))]
  const res = await col.updateOne({ _id: id }, { $set })
  return res.matchedCount > 0
}

export async function deleteTag(id: string): Promise<boolean> {
  const col = await getTagsCollection()
  const res = await col.deleteOne({ _id: id })
  return res.deletedCount > 0
}

/** Tags a principal may READ: owners see all; everyone else sees what they created or were granted. */
export async function visibleTagsFor(accountId: string, isOwner: boolean): Promise<TagDoc[]> {
  const all = await listAllTags()
  if (isOwner) return all
  return all.filter(t => t.createdBy === accountId || t.sharedWith.includes(accountId))
}
