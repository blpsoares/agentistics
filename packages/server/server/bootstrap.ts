/**
 * bootstrap.ts — one-time owner-setup token for first-boot provisioning.
 * The token's sha256 hash lives in the `config` collection (doc _id:'bootstrap').
 * Pure helpers (hash/match/validate) are unit-tested; the doc CRUD is thin IO.
 * The plaintext token is printed to stdout ONCE at generation (see index.ts boot block).
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { getMongoDb } from './mongo'

const COLLECTION = 'config'
const DOC_ID = 'bootstrap'

export interface BootstrapDoc {
  _id: string
  tokenHash?: string
  createdAt: string
  consumedAt?: string
}

export interface OwnerInput {
  name: string
  email: string
  password: string
  confirm: string
  token: string
}

/** sha256 hex of a token (pure). */
export function hashBootstrapToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time compare of a token against a stored sha256-hex hash (pure). */
export function bootstrapTokenMatches(token: string, storedHash: string | undefined): boolean {
  if (!storedHash) return false
  const a = Buffer.from(hashBootstrapToken(token), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Validate + normalize the owner-creation body (pure). */
export function validateOwnerInput(
  b: Record<string, unknown>,
): { ok: true; value: OwnerInput } | { ok: false; error: string } {
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const email = typeof b.email === 'string' ? b.email.trim() : ''
  const password = typeof b.password === 'string' ? b.password : ''
  const confirm = typeof b.confirm === 'string' ? b.confirm : ''
  const token = typeof b.token === 'string' ? b.token : ''
  if (!token) return { ok: false, error: 'missing bootstrap token' }
  if (!name) return { ok: false, error: 'name is required' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'valid email is required' }
  if (password.length < 8) return { ok: false, error: 'password must be at least 8 characters' }
  if (password !== confirm) return { ok: false, error: 'passwords do not match' }
  return { ok: true, value: { name, email, password, confirm, token } }
}

async function bootstrapCollection() {
  const db = await getMongoDb()
  return db.collection<BootstrapDoc>(COLLECTION)
}

/** Generate a fresh token, store its hash (clearing any prior consumed state), return plaintext once. */
export async function generateBootstrapToken(nowIso: string): Promise<string> {
  const token = randomBytes(24).toString('hex')
  const col = await bootstrapCollection()
  await col.updateOne(
    { _id: DOC_ID },
    { $set: { tokenHash: hashBootstrapToken(token), createdAt: nowIso }, $unset: { consumedAt: '' } },
    { upsert: true },
  )
  return token
}

/** The stored bootstrap doc, or null (tolerates an unreachable DB). */
export async function getBootstrapDoc(): Promise<BootstrapDoc | null> {
  try {
    const col = await bootstrapCollection()
    return await col.findOne({ _id: DOC_ID })
  } catch {
    return null
  }
}

/** True if the presented token matches the stored, unconsumed hash. */
export async function verifyBootstrapToken(token: string): Promise<boolean> {
  const doc = await getBootstrapDoc()
  if (!doc || doc.consumedAt) return false
  return bootstrapTokenMatches(token, doc.tokenHash)
}

/** Mark the token consumed (one-time) and drop the hash. */
export async function consumeBootstrapToken(nowIso: string): Promise<void> {
  const col = await bootstrapCollection()
  await col.updateOne({ _id: DOC_ID }, { $set: { consumedAt: nowIso }, $unset: { tokenHash: '' } })
}
