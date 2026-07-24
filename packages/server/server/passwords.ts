/**
 * passwords.ts — argon2id password hashing via Bun's built-in Bun.password.
 * No external dependency (keeps `bun build --compile` of the machine binary working).
 * Raw passwords and hashes are never logged.
 */

/** Hash a plaintext password with argon2id. Returns the encoded `$argon2id$...` string. */
export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: 'argon2id' })
}

/** Verify a plaintext password against an encoded hash. Returns false on any malformed hash. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false
  try {
    return await Bun.password.verify(plain, hash)
  } catch {
    return false
  }
}
