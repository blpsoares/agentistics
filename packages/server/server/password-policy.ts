/**
 * password-policy.ts — NIST-aligned password rules: length over composition, plus a blocklist.
 *
 * No character-class requirements (they push people to predictable substitutions); instead a
 * 12-character floor, a small embedded list of the passwords that actually get sprayed, and
 * context checks so nobody uses their own e-mail or name.
 *
 * The upper bound exists because argon2id hashing cost grows with input: a 1 MB "password"
 * would be a free CPU-exhaustion lever on an unauthenticated endpoint.
 */

export const PASSWORD_MIN_LENGTH = 12
const PASSWORD_MAX_LENGTH = 1024

/** Password stems that dominate credential-spraying lists, lowercase. */
const COMMON_STEMS = [
  'password', 'passw0rd', '123456789', '1234567890', 'qwertyuiop', 'qwerty123',
  'letmein', 'iloveyou', 'admin123', 'welcome1', 'monkey12', 'abc12345',
  'changeme', 'dragon12', 'football', 'baseball', 'sunshine', 'princess',
  'agentistics', 'claudecode',
]

function containsToken(password: string, token: string | undefined): boolean {
  if (!token) return false
  const t = token.trim().toLowerCase()
  if (t.length < 4) return false
  return password.toLowerCase().includes(t)
}

export function validatePasswordPolicy(
  password: string,
  ctx: { email?: string; name?: string },
): { ok: true } | { ok: false; error: string } {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `password must be at least ${PASSWORD_MIN_LENGTH} characters` }
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: 'password is too long' }
  }
  const lower = password.toLowerCase()
  // A common stem padded out to reach the length floor is still a common password —
  // `password123456` and `password123456!!` are both on every spraying list.
  for (const stem of COMMON_STEMS) {
    if (lower.startsWith(stem)) return { ok: false, error: 'password is too common' }
  }
  if (new Set(password).size < 5) return { ok: false, error: 'password is not varied enough' }
  const localPart = ctx.email?.split('@')[0]
  if (containsToken(password, localPart)) return { ok: false, error: 'password must not contain your email' }
  if (containsToken(password, ctx.name)) return { ok: false, error: 'password must not contain your name' }
  return { ok: true }
}
