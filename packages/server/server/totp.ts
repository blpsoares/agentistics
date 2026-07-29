/**
 * totp.ts — RFC 6238 TOTP (SHA-1, 30s step, 6 digits) and RFC 4648 base32, on node:crypto only.
 *
 * No dependency, so `bun build --compile` of the machine binary keeps working. Pure and unit
 * tested against the published RFC vectors — a home-grown OTP that merely looks plausible fails
 * against real authenticator apps, and you find out during an outage.
 *
 * Recovery codes are stored ONLY as sha256 hashes, the same rule machine tokens follow.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30

export function base32Encode(buf: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  while (out.length % 8 !== 0) out += '='
  return out
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('invalid base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

/** A fresh 20-byte (160-bit) shared secret, base32-encoded for authenticator apps. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20))
}

/** The HOTP value for an explicit counter — the unit-testable core of TOTP. */
export function totpAt(secretBase32: string, counter: number, digits = 6): string {
  const key = Buffer.from(base32Decode(secretBase32))
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const mac = createHmac('sha1', key).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff)
  return String(bin % 10 ** digits).padStart(digits, '0')
}

/** Accepts the current step plus `window` steps either side (default 1 = ±30s of clock skew). */
export function verifyTotp(secretBase32: string, code: string, nowSec: number, window = 1): boolean {
  const trimmed = code.replace(/\s/g, '')
  if (!/^\d{6,8}$/.test(trimmed)) return false
  const counter = Math.floor(nowSec / STEP_SECONDS)
  for (let d = -window; d <= window; d++) {
    let expected: string
    try {
      expected = totpAt(secretBase32, counter + d, trimmed.length)
    } catch {
      return false // unusable secret — never fall through to "accepted"
    }
    const a = Buffer.from(expected)
    const b = Buffer.from(trimmed)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return false
}

export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** Ten single-use codes in XXXXX-XXXXX form. Shown once, stored only as hashes. */
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () =>
    randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'),
  )
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}
