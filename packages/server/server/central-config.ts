/**
 * central-config.ts — Mongo-backed central configuration for Team Mode Phase 6.
 *
 * Stores a single document (_id: 'team') in the 'config' collection.
 * Tolerates an unreachable DB: falls back to PUSH_INTERVAL.DEFAULT_SEC.
 *
 * getCentralConfig() — read the stored config (or return defaults)
 * setPushInterval(sec) — clamp + upsert pushIntervalSec, return stored value
 */

import { randomBytes } from 'node:crypto'
import { PUSH_INTERVAL, clampPushInterval } from '@agentistics/core'
import { getMongoDb } from './mongo'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CentralConfig {
  pushIntervalSec: number
  /** Central policy: whether offline members' data is included in aggregates by default. */
  includeOfflineData: boolean
  /** Public base URL of this central (no trailing slash). When set, minted machine tokens embed
   *  it so a machine can auto-fill the endpoint from the pasted token. Empty = not configured. */
  publicUrl?: string
}

interface CentralConfigDoc extends Partial<CentralConfig> {
  _id: 'team'
  /** Stable identity of this central's DATA store. Created once, persisted in Mongo, so it
   *  survives redeploys — but a wiped DB (docker `down -v`) starts fresh with a NEW id.
   *  Members compare it to detect a reset and auto re-push their full history. */
  instanceId?: string
}

const DEFAULT_INCLUDE_OFFLINE = true

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLLECTION = 'config'
const DOC_ID = 'team' as const

/** Return the live central config, or defaults if Mongo is unreachable. */
export async function getCentralConfig(): Promise<CentralConfig> {
  try {
    const db = await getMongoDb()
    const col = db.collection<CentralConfigDoc>(COLLECTION)
    const doc = await col.findOne({ _id: DOC_ID })
    if (!doc) return { pushIntervalSec: PUSH_INTERVAL.DEFAULT_SEC, includeOfflineData: DEFAULT_INCLUDE_OFFLINE }
    // Read with the express floor so an express value (<15s) survives the round-trip.
    return {
      pushIntervalSec: clampPushInterval(doc.pushIntervalSec ?? PUSH_INTERVAL.DEFAULT_SEC, PUSH_INTERVAL.EXPRESS_MIN_SEC),
      includeOfflineData: doc.includeOfflineData ?? DEFAULT_INCLUDE_OFFLINE,
      ...(doc.publicUrl ? { publicUrl: doc.publicUrl } : {}),
    }
  } catch {
    // DB unreachable — return safe defaults
    return { pushIntervalSec: PUSH_INTERVAL.DEFAULT_SEC, includeOfflineData: DEFAULT_INCLUDE_OFFLINE }
  }
}

/**
 * Return this central's stable data-store instanceId, creating it on first call.
 * Persisted in Mongo, so a redeploy keeps it — but a wiped DB (`down -v`) has no doc,
 * so a fresh id is minted. Members use it to detect a reset and re-push. Returns null
 * if Mongo is unreachable (the member then keeps its current sync state).
 */
export async function getInstanceId(): Promise<string | null> {
  try {
    const db = await getMongoDb()
    const col = db.collection<CentralConfigDoc>(COLLECTION)
    const doc = await col.findOne({ _id: DOC_ID })
    if (doc?.instanceId) return doc.instanceId
    // Mint one atomically — only sets it if still absent, so concurrent callers converge.
    const id = randomBytes(12).toString('hex')
    await col.updateOne(
      { _id: DOC_ID, instanceId: { $exists: false } },
      { $set: { instanceId: id } },
      { upsert: true },
    )
    const fresh = await col.findOne({ _id: DOC_ID })
    return fresh?.instanceId ?? id
  } catch {
    return null
  }
}

/**
 * Set the includeOfflineData policy, upsert into Mongo, and return the stored value.
 * If Mongo is unreachable, the value is returned without being persisted.
 */
/** Set the central's public URL (trailing slash stripped; empty clears it). Upsert into Mongo. */
export async function setPublicUrl(url: string): Promise<string> {
  const clean = url.trim().replace(/\/+$/, '')
  try {
    const db = await getMongoDb()
    const col = db.collection<CentralConfigDoc>(COLLECTION)
    await col.updateOne({ _id: DOC_ID }, { $set: { publicUrl: clean } }, { upsert: true })
  } catch { /* DB unreachable — return the value anyway */ }
  return clean
}

export async function setIncludeOfflineData(value: boolean): Promise<boolean> {
  try {
    const db = await getMongoDb()
    const col = db.collection<CentralConfigDoc>(COLLECTION)
    await col.updateOne({ _id: DOC_ID }, { $set: { includeOfflineData: value } }, { upsert: true })
    return value
  } catch {
    return value
  }
}

/**
 * Clamp `sec` into [MIN_SEC, MAX_SEC], upsert into Mongo, and return the
 * stored value. If Mongo is unreachable, the clamped value is returned
 * without being persisted.
 */
export async function setPushInterval(sec: number): Promise<number> {
  // The central is the authority on the interval and may go below the normal 15s floor
  // (down to EXPRESS_MIN_SEC) when the admin picks an express value.
  const clamped = clampPushInterval(sec, PUSH_INTERVAL.EXPRESS_MIN_SEC)
  try {
    const db = await getMongoDb()
    const col = db.collection<CentralConfigDoc>(COLLECTION)
    await col.updateOne(
      { _id: DOC_ID },
      { $set: { pushIntervalSec: clamped } },
      { upsert: true },
    )
    return clamped
  } catch {
    // DB unreachable — return the clamped value without persisting
    return clamped
  }
}
