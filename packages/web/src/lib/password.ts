// Unambiguous alphabet — excludes 0/O/1/l/I so a shown-once password is easy to read aloud/copy.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*_-'

/** Cryptographically-random password from an unambiguous alphabet. Min length 12, default 16. */
export function generatePassword(length: number = 16): string {
  const len = Math.max(12, length)
  const out: string[] = []
  const alphabetLength = ALPHABET.length
  const rejectionBound = 256 - (256 % alphabetLength)

  while (out.length < len) {
    const batch = new Uint8Array(len - out.length)
    crypto.getRandomValues(batch)
    for (let i = 0; i < batch.length && out.length < len; i++) {
      const byte = batch[i]!
      if (byte < rejectionBound) {
        out.push(ALPHABET[byte % alphabetLength]!)
      }
    }
  }
  return out.join('')
}
