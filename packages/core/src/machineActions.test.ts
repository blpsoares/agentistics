import { describe, it, expect } from 'bun:test'
import {
  remoteActionAllowed, remoteActionRefusal, REMOTE_SCREENLESS_ACTIONS, REMOTE_SCREEN_ACTIONS,
} from './machineActions'

const granted = { sessions: true, screens: false }
const withScreens = { sessions: true, screens: true }
const nothing = { sessions: false, screens: false }

describe('remoteActionAllowed', () => {
  it('allows every screenless verb once the fleet consent is given', () => {
    for (const a of REMOTE_SCREENLESS_ACTIONS) expect(remoteActionAllowed(a, granted)).toBe(true)
  })

  it('allows nothing at all without the fleet consent', () => {
    // The machine's own switch is the gate; a central that asks anyway is refused by the member.
    for (const a of REMOTE_SCREENLESS_ACTIONS) expect(remoteActionAllowed(a, nothing)).toBe(false)
    for (const a of REMOTE_SCREEN_ACTIONS) expect(remoteActionAllowed(a, nothing)).toBe(false)
  })

  it('refuses approve and prompt EVEN WITH the screen consent — they are not implemented yet', () => {
    // The screen does not travel in this phase, so the honest answer is that they are unavailable.
    // A button that takes an unread choice is the accident parseDialogOptions exists to prevent.
    for (const a of REMOTE_SCREEN_ACTIONS) {
      expect(remoteActionAllowed(a, granted)).toBe(false)
      expect(remoteActionAllowed(a, withScreens)).toBe(false)
    }
  })

  it('is CLOSED — an action it does not know is refused', () => {
    // A new FleetActionId added upstream must be listed here on purpose before a central can
    // drive it. Same allowlist reasoning as the row reduction, applied to verbs.
    for (const junk of ['', 'wipe', 'exec', 'RENAME', 'rename ', 'approve;kill']) {
      expect(remoteActionAllowed(junk, withScreens)).toBe(false)
    }
  })

  it('the two lists never overlap', () => {
    const screenless = new Set<string>(REMOTE_SCREENLESS_ACTIONS)
    for (const a of REMOTE_SCREEN_ACTIONS) expect(screenless.has(a)).toBe(false)
  })
})

describe('remoteActionRefusal', () => {
  it('says nothing for an action that is offered', () => {
    for (const a of REMOTE_SCREENLESS_ACTIONS) expect(remoteActionRefusal(a, granted)).toBeNull()
  })

  it('distinguishes the three reasons — a missing verb must never be unexplained', () => {
    expect(remoteActionRefusal('rename', nothing)).toBe('no-consent')
    expect(remoteActionRefusal('approve', granted)).toBe('needs-screen')
    expect(remoteActionRefusal('prompt', withScreens)).toBe('needs-screen')
    expect(remoteActionRefusal('teleport', granted)).toBe('unknown')
  })

  it('no consent outranks everything — it is the reason the user can act on', () => {
    expect(remoteActionRefusal('approve', nothing)).toBe('no-consent')
    expect(remoteActionRefusal('teleport', nothing)).toBe('no-consent')
  })

  it('agrees with remoteActionAllowed on every case', () => {
    // Two predicates over one policy is two places to drift; this pins them together.
    const actions = [...REMOTE_SCREENLESS_ACTIONS, ...REMOTE_SCREEN_ACTIONS, 'nonsense']
    for (const consent of [nothing, granted, withScreens]) {
      for (const a of actions) {
        expect(remoteActionAllowed(a, consent)).toBe(remoteActionRefusal(a, consent) === null)
      }
    }
  })
})
