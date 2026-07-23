// Unambiguous alphabet — excludes 0/O/1/l/I so a shown-once password is easy to read aloud/copy.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*_-'

/** Cryptographically-random password from an unambiguous alphabet. Min length 12, default 16. */
export function generatePassword(length: number = 16): string {
  const len = Math.max(12, length)
  const out: string[] = []
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < len; i++) {
    const idx = bytes[i]! % ALPHABET.length
    out.push(ALPHABET[idx]!)
  }
  return out.join('')
}
