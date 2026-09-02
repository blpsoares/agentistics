import { describe, it, expect } from 'bun:test'
import { resolveMachineFleet, type MachineFleetRouteDeps } from './machine-fleet-route'

const owner = { accountId: 'o1', role: 'owner', memberships: [] }
const bob = { accountId: 'bob', role: 'member', memberships: [] }
const carol = { accountId: 'carol', role: 'member', memberships: [] }

const reply = { rows: [], attention: 2, withheld: 1 }

function deps(over: Partial<MachineFleetRouteDeps> = {}): MachineFleetRouteDeps {
  return {
    listMachines: async () => [{ id: 'm1', accountIds: ['bob'] }],
    isOnline: () => true,
    consentOf: () => ({ sessions: true, screens: false }),
    request: async () => reply,
    ...over,
  }
}

describe('resolveMachineFleet', () => {
  it('the owning account gets the fleet', async () => {
    expect(await resolveMachineFleet(bob, 'm1', deps())).toEqual({ reply })
  })

  it('the INSTANCE OWNER is refused — administering a machine is not reaching into its sessions', async () => {
    // The whole point of machineOwnedBy existing beside canManageMachine, asserted at the route.
    expect(await resolveMachineFleet(owner, 'm1', deps())).toEqual({ reply: null, reason: 'not-owner' })
  })

  it('another account is refused', async () => {
    expect(await resolveMachineFleet(carol, 'm1', deps())).toEqual({ reply: null, reason: 'not-owner' })
  })

  it('an UNKNOWN machine answers exactly like one you do not own — never an existence oracle', async () => {
    // Distinguishing them would tell a caller whether a machine id exists on this central.
    expect(await resolveMachineFleet(bob, 'nope', deps())).toEqual({ reply: null, reason: 'not-owner' })
  })

  it('a machine that says no is REFUSED, not empty', async () => {
    const r = await resolveMachineFleet(bob, 'm1', deps({ consentOf: () => ({ sessions: false, screens: false }) }))
    expect(r).toEqual({ reply: null, reason: 'refused' })
  })

  it('a machine that says no while OFFLINE reports offline — the more actionable half', async () => {
    // A machine that has never spoken has no consent recorded and no socket. Calling that
    // "refused" sends its owner to a switch that is already off.
    const r = await resolveMachineFleet(bob, 'm1', deps({
      consentOf: () => ({ sessions: false, screens: false }),
      isOnline: () => false,
    }))
    expect(r).toEqual({ reply: null, reason: 'offline' })
  })

  it('a consenting machine with no socket is OFFLINE', async () => {
    const r = await resolveMachineFleet(bob, 'm1', deps({ isOnline: () => false }))
    expect(r).toEqual({ reply: null, reason: 'offline' })
  })

  it('a consenting, connected machine that does not answer is SILENT', async () => {
    // An older build with no handler, or a wedged one. Three silences, three sentences.
    const r = await resolveMachineFleet(bob, 'm1', deps({ request: async () => null }))
    expect(r).toEqual({ reply: null, reason: 'silent' })
  })

  it('the four reasons are all distinct — an empty list never stands in for any of them', async () => {
    const seen = new Set<string>()
    seen.add((await resolveMachineFleet(owner, 'm1', deps())).reason!)
    seen.add((await resolveMachineFleet(bob, 'm1', deps({ consentOf: () => ({ sessions: false, screens: false }) }))).reason!)
    seen.add((await resolveMachineFleet(bob, 'm1', deps({ isOnline: () => false }))).reason!)
    seen.add((await resolveMachineFleet(bob, 'm1', deps({ request: async () => null }))).reason!)
    expect(seen).toEqual(new Set(['not-owner', 'refused', 'offline', 'silent']))
  })

  it('the legacy single accountId field still identifies an owner', async () => {
    const r = await resolveMachineFleet(bob, 'm1', deps({
      listMachines: async () => [{ id: 'm1', accountId: 'bob' }],
    }))
    expect(r).toEqual({ reply: reply })
  })

  it('a machine owned by nobody is reachable by nobody, the instance owner included', async () => {
    const loose = deps({ listMachines: async () => [{ id: 'm1' }] })
    expect((await resolveMachineFleet(owner, 'm1', loose)).reason).toBe('not-owner')
    expect((await resolveMachineFleet(bob, 'm1', loose)).reason).toBe('not-owner')
  })
})
