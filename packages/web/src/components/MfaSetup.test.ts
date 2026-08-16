import { test, expect } from 'bun:test'
import { disableActionVisible } from './MfaSetup'

// An owner never sees the Disable action, enrolled or not — the route (`mfaDisableAllowed` in
// iam-view.ts) is the actual control; this is the UI half staying consistent with it so an owner
// is never shown a button that the server will refuse anyway.
test('disableActionVisible: shown only when MFA is enabled AND the caller may disable it', () => {
  expect(disableActionVisible(true, true)).toBe(true)
  expect(disableActionVisible(true, false)).toBe(false) // owner, enrolled — hidden
  expect(disableActionVisible(false, true)).toBe(false) // not enrolled yet — nothing to disable
  expect(disableActionVisible(false, false)).toBe(false)
})
