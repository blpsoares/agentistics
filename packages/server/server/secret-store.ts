/**
 * secret-store.ts — the session-signing secret.
 *
 * SECURITY: the old behaviour (fall back to the dashboard password when
 * AGENTISTICS_TEAM_SESSION_SECRET was unset) meant a leaked or shared password ALSO let anyone
 * forge a session cookie for any account, because the HMAC key was the password. That fallback
 * is gone. When the env var is unset we generate a 32-byte random secret once and persist it in
 * Mongo, so restarts do not log everyone out and an operator cannot accidentally ship a
 * password-derived key.
 */
import { randomBytes } from 'node:crypto'
import { getMongoDb } from './mongo'

const MIN_LENGTH = 32

export function validateSecret(
  secret: string | undefined,
  password: string | undefined,
): { ok: boolean; reason?: string } {
  if (!secret) return { ok: false, reason: 'secret_missing' }
  if (password && secret === password) return { ok: false, reason: 'secret_equals_password' }
  if (secret.length < MIN_LENGTH) return { ok: false, reason: 'secret_too_short' }
  return { ok: true }
}

interface SecretDoc {
  _id: string
  secret: string
  createdAt: string
}

/** Read the persisted secret, generating one on first boot. Throws if Mongo is unreachable. */
export async function ensureSessionSecret(): Promise<string> {
  const db = await getMongoDb()
  const col = db.collection<SecretDoc>('config')
  const existing = await col.findOne({ _id: 'session-secret' })
  if (existing?.secret) return existing.secret
  const secret = randomBytes(32).toString('hex')
  await col.insertOne({ _id: 'session-secret', secret, createdAt: new Date().toISOString() })
  return secret
}
