import { test, expect } from 'bun:test'
import {
  CENTRAL_REACHES,
  bindWarning,
  reachOfExisting,
  settingsForReach,
  type CentralReach,
} from './central-reach'
import { capabilitiesFor, resolveProfile } from './exposure'

test('every reach maps to a profile exposure.ts actually understands', () => {
  for (const reach of CENTRAL_REACHES) {
    const { exposure } = settingsForReach(reach)
    expect(resolveProfile({ central: true, exposure, allowLocalShell: false, tls: false })).toBe(exposure)
  }
})

// The whole point of the `internet` answer: the host-power routes stop existing.
test('choosing the internet revokes every host-power capability', () => {
  const s = settingsForReach('internet')
  const caps = capabilitiesFor(
    resolveProfile({ central: true, exposure: s.exposure, allowLocalShell: true, tls: s.tls }),
    { central: true, exposure: s.exposure, allowLocalShell: true, tls: s.tls },
  )
  expect(caps.localShell).toBe(false)
  expect(caps.localChat).toBe(false)
  expect(caps.localTranscripts).toBe(false)
  expect(caps.mcpAdmin).toBe(false)
  expect(caps.requireSecureCookies).toBe(true)
})

// Loopback is not an oversight on the published answer — it is the property every other control
// at the edge assumes.
test('the internet answer binds LOOPBACK, and turns on TLS + proxy trust together', () => {
  expect(settingsForReach('internet')).toEqual({
    exposure: 'public', bind: '127.0.0.1', tls: true, trustProxy: true,
  })
})

// Trusting the proxy header while the app is reachable directly lets a client pick its own
// rate-limit bucket, so the two must never come apart.
test('proxy trust is never suggested without a loopback bind', () => {
  for (const reach of CENTRAL_REACHES) {
    const s = settingsForReach(reach)
    if (s.trustProxy) expect(s.bind).toBe('127.0.0.1')
  }
})

test('a trusted network binds wide but keeps the lan profile', () => {
  expect(settingsForReach('trusted-network')).toEqual({
    exposure: 'lan', bind: '0.0.0.0', tls: false, trustProxy: false,
  })
})

test('re-running the wizard defaults to what the central already is', () => {
  expect(reachOfExisting({ exposure: 'public' })).toBe('internet')
  expect(reachOfExisting({ exposure: 'lan' })).toBe('trusted-network')
  expect(reachOfExisting({ exposure: 'local' })).toBe('this-host')
})

// An absent profile on a central resolves to `lan`, but a loopback bind is far more likely to be a
// central that never answered the question — proposing to widen it would be the wizard suggesting a
// change nobody asked for.
test('with no profile written, the bind decides, and loopback reads as this-host', () => {
  expect(reachOfExisting({ bind: '127.0.0.1' })).toBe('this-host')
  expect(reachOfExisting({ bind: 'localhost' })).toBe('this-host')
  expect(reachOfExisting({ bind: '0.0.0.0' })).toBe('trusted-network')
  expect(reachOfExisting({ bind: '100.64.1.2' })).toBe('trusted-network')
})

test('nothing to go on, or a value nobody recognises, yields no opinion', () => {
  expect(reachOfExisting({})).toBeUndefined()
  expect(reachOfExisting({ bind: '' })).toBeUndefined()
  expect(reachOfExisting({ exposure: 'PUBLIC' })).toBeUndefined()
  expect(reachOfExisting({ exposure: 'wat', bind: '127.0.0.1' })).toBeUndefined()
})

// A warning, never a refusal: someone may be fronting the app from another machine.
test('publishing while bound wide is warned about, and only that combination', () => {
  expect(bindWarning('internet', '0.0.0.0')).toContain('bypassing')
  expect(bindWarning('internet', '100.64.1.2')).toContain('not the only')
  expect(bindWarning('internet', '127.0.0.1')).toBeNull()
  expect(bindWarning('internet', 'localhost')).toBeNull()
  for (const reach of ['this-host', 'trusted-network'] as CentralReach[]) {
    expect(bindWarning(reach, '0.0.0.0')).toBeNull()
  }
})
