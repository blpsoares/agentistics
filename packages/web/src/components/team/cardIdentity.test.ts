import { test, expect } from 'bun:test'
import { resolveCardIdentity } from './cardIdentity'

/**
 * The connection card's names, as a table.
 *
 * The product rule: **the machine's name is set by the CENTRAL and never by the machine**
 * (`GET /api/team/whoami` → the probe's `machineName`). The card used to render
 * `conn.label ?? … identity.machineName …`, so a locally stored nickname MASKED the central's own
 * name for the machine — from the user's seat the machine had renamed itself. The nickname is
 * kept, because several centrals need telling apart, but it names the CONNECTION / CENTRAL, and
 * it may never be a source for the machine name — not even as a fallback.
 */

const base = { host: 'central.example:48080', duplicateHost: false }

test('the machine name is the CENTRAL-assigned one, even when a local nickname exists', () => {
  const id = resolveCardIdentity({
    ...base,
    machineName: 'Alienware 2 (teste da segunda central)',
    label: 'Alienware',
    user: 'lucas',
  })
  expect(id.machine).toBe('Alienware 2 (teste da segunda central)')
  expect(id.machineSource).toBe('central')
})

test('without a central name the machine falls back to the HOST — never to the local nickname', () => {
  const id = resolveCardIdentity({ ...base, label: 'Alienware', user: 'lucas' })
  expect(id.machine).toBe('central.example:48080')
  expect(id.machineSource).toBe('host')
  expect(id.machine).not.toBe('Alienware')
})

test('a blank or whitespace machineName is not a name', () => {
  expect(resolveCardIdentity({ ...base, machineName: '   ', label: 'Alienware' }).machineSource).toBe('host')
  expect(resolveCardIdentity({ ...base, machineName: '' }).machine).toBe('central.example:48080')
})

test('the nickname names the CENTRAL, and only the central', () => {
  const id = resolveCardIdentity({ ...base, machineName: 'desktop-1', label: 'Client B', user: 'lucas' })
  expect(id.central).toBe('Client B')
  expect(id.machine).toBe('desktop-1')
})

test('with no nickname the central is its host', () => {
  expect(resolveCardIdentity({ ...base, machineName: 'desktop-1' }).central).toBe('central.example:48080')
})

test('two connections to the same host are told apart by the ACCOUNT, never by the machine name', () => {
  // Both cards describe the SAME machine, so promoting the machine name here distinguishes
  // nothing; the account the token authenticates as is the only thing that differs.
  const id = resolveCardIdentity({ ...base, duplicateHost: true, machineName: 'desktop-1', user: 'lucas' })
  expect(id.central).toBe('central.example:48080 · lucas')
  expect(id.machine).toBe('desktop-1')
})

test('a duplicate host with no resolved account does not fabricate a separator', () => {
  expect(resolveCardIdentity({ ...base, duplicateHost: true, user: '' }).central).toBe('central.example:48080')
})

test('an explicit nickname wins over the duplicate-host disambiguation — the user named it', () => {
  const id = resolveCardIdentity({ ...base, duplicateHost: true, label: 'Client B', user: 'lucas' })
  expect(id.central).toBe('Client B')
})

/**
 * The central's line is the ORG when there is one — "siths" is what a person calls that central;
 * `100.109.247.39:48080` is where it happens to answer. The nickname still wins (it is the user's
 * own explicit naming), and the DEFAULT placeholder never does: `TEAM_ORG` defaults to the literal
 * string `default`, so adopting it blindly would title a whole fleet of centrals "default" —
 * strictly worse than the addresses it replaced.
 */
test('the central is named by its ORG, not by the address it answers on', () => {
  const id = resolveCardIdentity({ ...base, machineName: 'desktop-1', org: 'siths', user: 'lucas' })
  expect(id.central).toBe('siths')
  expect(id.centralSource).toBe('org')
})

test('the nickname still wins over the org — the user named that central themselves', () => {
  const id = resolveCardIdentity({ ...base, org: 'siths', label: 'Client B' })
  expect(id.central).toBe('Client B')
  expect(id.centralSource).toBe('label')
})

test('the "default" org placeholder is not a name — a fleet of centrals must stay distinguishable', () => {
  for (const org of ['default', 'DEFAULT', '  default  ']) {
    const id = resolveCardIdentity({ ...base, org })
    expect(id.central).toBe('central.example:48080')
    expect(id.centralSource).toBe('host')
  }
})

test('an absent or blank org falls back to the host, never to an empty title', () => {
  expect(resolveCardIdentity({ ...base, org: '   ' }).central).toBe('central.example:48080')
  expect(resolveCardIdentity({ ...base }).centralSource).toBe('host')
})

test('two connections to the same host are still told apart, now under the org name', () => {
  const id = resolveCardIdentity({ ...base, duplicateHost: true, org: 'siths', user: 'lucas' })
  expect(id.central).toBe('siths · lucas')
  expect(id.centralSource).toBe('org')
})

test('naming the central by its org never touches the machine name, which is the central\'s to assign', () => {
  const id = resolveCardIdentity({ ...base, org: 'siths', machineName: 'desktop-1' })
  expect(id.machine).toBe('desktop-1')
  expect(id.machineSource).toBe('central')
  // …and with no central-assigned name it is still the HOST, never the org.
  const pending = resolveCardIdentity({ ...base, org: 'siths' })
  expect(pending.machine).toBe('central.example:48080')
  expect(pending.machineSource).toBe('host')
})

test('the user is the account, reported separately from the machine, blank when unresolved', () => {
  expect(resolveCardIdentity({ ...base, machineName: 'desktop-1', user: 'lucas' }).user).toBe('lucas')
  expect(resolveCardIdentity({ ...base, machineName: 'desktop-1' }).user).toBe('')
  expect(resolveCardIdentity({ ...base, user: '  ' }).user).toBe('')
})

test('machine and user are never the same field: a machine named after its user still reads as two values', () => {
  const id = resolveCardIdentity({ ...base, machineName: 'lucas', user: 'lucas' })
  expect(id.machine).toBe('lucas')
  expect(id.user).toBe('lucas')
  expect(id.machineSource).toBe('central')
})
