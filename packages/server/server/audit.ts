/**
 * audit.ts — append-only security event log in the `audit` collection.
 *
 * OWASP A09: authentication, authorization and administrative events must be recorded with
 * enough context to reconstruct an incident. Without this, a successful takeover leaves no
 * trace at all.
 *
 * The pure builder redacts secret-shaped fields BEFORE anything reaches the database — an audit
 * log that stores credentials is a liability, not a control — and truncates long values so one
 * call cannot bloat the collection.
 */
import { getMongoDb } from './mongo'

export type AuditAction =
  | 'login.success' | 'login.failure' | 'login.mfa_challenge' | 'login.mfa_failure'
  | 'logout' | 'password.change'
  | 'mfa.enable' | 'mfa.disable' | 'mfa.recovery_used'
  | 'account.create' | 'account.update' | 'account.delete'
  | 'team.create' | 'team.update' | 'team.delete'
  | 'token.mint' | 'token.rotate' | 'token.revoke'
  | 'repo.register' | 'repo.unregister'
  | 'config.update' | 'bootstrap.consume'
  | 'capability.denied' | 'authz.denied' | 'rate.blocked'

export interface AuditEvent {
  action: AuditAction
  actorId?: string
  targetId?: string
  ip: string
  at: string
  meta?: Record<string, unknown>
}

export interface AuditInput {
  action: AuditAction
  actorId?: string
  targetId?: string
  ip: string
  meta?: Record<string, unknown>
}

/** Field names whose values must never be persisted, whatever the caller passes. */
const REDACT = new Set([
  'password', 'newPassword', 'currentPassword', 'confirm',
  'token', 'secret', 'code', 'challenge', 'hash', 'passwordHash', 'recoveryCodes',
])
const MAX_VALUE_LENGTH = 512

export function buildAuditEvent(input: AuditInput, nowIso: string): AuditEvent {
  let meta: Record<string, unknown> | undefined
  if (input.meta) {
    meta = {}
    for (const [k, v] of Object.entries(input.meta)) {
      if (REDACT.has(k)) continue
      meta[k] = typeof v === 'string' && v.length > MAX_VALUE_LENGTH ? v.slice(0, MAX_VALUE_LENGTH) : v
    }
  }
  return {
    action: input.action,
    actorId: input.actorId,
    targetId: input.targetId,
    ip: input.ip,
    at: nowIso,
    meta,
  }
}

/** Fire-and-forget: an audit write must never break the request it is describing. */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const db = await getMongoDb()
    await db.collection<AuditEvent>('audit').insertOne(buildAuditEvent(input, new Date().toISOString()))
  } catch {
    // Swallowed on purpose. A failing audit sink is an operational problem, not a reason to
    // deny a legitimate login.
  }
}

/** Owner-only reader, newest first. */
export async function listAudit(opts: { limit?: number; action?: AuditAction } = {}): Promise<AuditEvent[]> {
  const db = await getMongoDb()
  const filter = opts.action ? { action: opts.action } : {}
  return db
    .collection<AuditEvent>('audit')
    .find(filter)
    .sort({ at: -1 })
    .limit(Math.min(opts.limit ?? 200, 1000))
    .toArray()
}

/** Index + a 180-day TTL. Idempotent; called at boot next to ensureAccountIndexes. */
export async function ensureAuditIndexes(): Promise<void> {
  const db = await getMongoDb()
  const col = db.collection<AuditEvent>('audit')
  await col.createIndex({ at: -1 })
  await col.createIndex({ at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 })
}
