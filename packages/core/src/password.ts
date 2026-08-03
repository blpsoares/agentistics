/**
 * password.ts — the password rule, in ONE place.
 *
 * It lives in core rather than on the server because both sides need it: the server enforces it,
 * and the form has to be able to state it before you type. It used to exist only server-side, so
 * the account drawer promised "8+" while the server demanded twelve characters, no common stem,
 * five distinct characters and nothing resembling your own name — and the only way to discover
 * any of that was to be refused, one rule at a time, with a three-word message.
 *
 * The rule is now the one the product asks for: eight characters, an uppercase letter and a
 * symbol. That is a deliberate choice by the product owner over the NIST-style
 * length-beats-composition default; the trade is written down in docs/security.md rather than
 * enforced quietly here.
 */

export const PASSWORD_MIN_LENGTH = 8

/**
 * Not policy — a bound. argon2id's cost grows with input, so an unauthenticated endpoint that
 * accepted a megabyte "password" would be a free CPU-exhaustion lever.
 */
export const PASSWORD_MAX_LENGTH = 1024

export type PasswordFailure = 'too_short' | 'too_long' | 'no_uppercase' | 'no_symbol'

/** Every rule, as booleans — so a form can show which ones are still missing while typing. */
export function passwordChecks(password: string): Record<Exclude<PasswordFailure, 'too_long'>, boolean> {
  return {
    too_short: password.length < PASSWORD_MIN_LENGTH,
    no_uppercase: !/[A-Z]/.test(password),
    // Anything that is not a letter or a digit. Deliberately broad: a rule that lists the
    // acceptable symbols is a rule people fail by picking the wrong one.
    no_symbol: !/[^A-Za-z0-9]/.test(password),
  }
}

/**
 * Validate a password. `ctx` is accepted (and ignored) so call sites that pass the account's
 * name and e-mail keep compiling — reinstating a containment check is then a one-line change
 * here rather than a hunt through six callers.
 */
export function validatePasswordPolicy(
  password: string,
  _ctx: { email?: string; name?: string } = {},
): { ok: true } | { ok: false; error: string; reason: PasswordFailure } {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: 'password is too long', reason: 'too_long' }
  }
  const checks = passwordChecks(password)
  if (checks.too_short) {
    return {
      ok: false,
      reason: 'too_short',
      error: `password must be at least ${PASSWORD_MIN_LENGTH} characters, with one uppercase letter and one symbol`,
    }
  }
  if (checks.no_uppercase) {
    return { ok: false, reason: 'no_uppercase', error: 'password must contain an uppercase letter' }
  }
  if (checks.no_symbol) {
    return { ok: false, reason: 'no_symbol', error: 'password must contain a symbol (for example ! @ # $)' }
  }
  return { ok: true }
}

/** The rule as a sentence, to be shown BEFORE anyone types — the fix for guessing it by refusal. */
export function passwordRuleText(lang: 'pt' | 'en'): string {
  return lang === 'pt'
    ? `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres, com pelo menos 1 letra maiúscula e 1 caractere especial.`
    : `At least ${PASSWORD_MIN_LENGTH} characters, including one uppercase letter and one symbol.`
}
