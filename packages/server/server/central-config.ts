/**
 * central-config.ts — Mongo-backed central configuration for Team Mode Phase 6.
 *
 * Stores a single document (_id: 'team') in the 'config' collection.
 * Tolerates an unreachable DB: falls back to PUSH_INTERVAL.DEFAULT_SEC.
 *
 * getCentralConfig() — read the stored config (or return defaults)
 * setPushInterval(sec) — clamp + upsert pushIntervalSec, return stored value
 */

import { PUSH_INTERVAL, clampPushInterval } from '@agentistics/core'
import { getMongoDb } from './mongo'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CentralConfig {
  pushIntervalSec: number
}

interface CentralConfigDoc extends CentralConfig {
  _id: 'team'
}

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
    if (!doc) return { pushIntervalSec: PUSH_INTERVAL.DEFAULT_SEC }
    // Read with the express floor so an express value (<15s) survives the round-trip.
    return { pushIntervalSec: clampPushInterval(doc.pushIntervalSec, PUSH_INTERVAL.EXPRESS_MIN_SEC) }
  } catch {
    // DB unreachable — return safe defaults
    return { pushIntervalSec: PUSH_INTERVAL.DEFAULT_SEC }
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
