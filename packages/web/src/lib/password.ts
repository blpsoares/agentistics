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
  // Guarantee the classes the policy requires. Drawing uniformly leaves a real chance of a
  // password with no uppercase or no symbol — about one in twenty at this length — and handing
  // an admin a generated password the server then refuses is the worst possible moment to
  // discover a rule. Placed at random positions so the shape is not predictable.
  return enforceClasses(out).join('')
}

/** Random index in [0, n) without modulo bias for the small n used here. */
function pick(n: number): number {
  const b = new Uint32Array(1)
  const bound = Math.floor(0xffffffff / n) * n
  do { crypto.getRandomValues(b) } while (b[0]! >= bound)
  return b[0]! % n
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const SYMBOLS = '!@#$%^&*_-'

function enforceClasses(chars: string[]): string[] {
  const out = [...chars]
  const missing: string[] = []
  if (!out.some(c => UPPER.includes(c))) missing.push(UPPER[pick(UPPER.length)]!)
  if (!out.some(c => SYMBOLS.includes(c))) missing.push(SYMBOLS[pick(SYMBOLS.length)]!)
  // Distinct positions, so the second insertion cannot overwrite the first.
  const used = new Set<number>()
  for (const ch of missing) {
    let at = pick(out.length)
    while (used.has(at)) at = pick(out.length)
    used.add(at)
    out[at] = ch
  }
  return out
}
