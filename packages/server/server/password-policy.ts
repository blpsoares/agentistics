/**
 * password-policy.ts — re-export of the shared rule.
 *
 * The implementation moved to `@agentistics/core` (packages/core/src/password.ts) so the browser
 * can state the rule with the same code that enforces it. This file stays as the import path
 * every handler already uses.
 */
export {
  validatePasswordPolicy,
  passwordChecks,
  passwordRuleText,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  type PasswordFailure,
} from '@agentistics/core'
