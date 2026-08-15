import { beforeEach, describe, expect, it } from 'bun:test'
import { forgetEphemeral, getSessionsMenuHidden, setSessionsMenuHidden } from './ephemeral'

describe('arrangement that survives a REMOUNT but not the process', () => {
  beforeEach(forgetEphemeral)

  it('opens with the menu shown', () => {
    // A fresh process legitimately starts at the default — nothing here may be load-bearing.
    expect(getSessionsMenuHidden()).toBe(false)
  })

  it('remembers the fold across a remount', () => {
    // THE bug. Attaching to a session unmounts this app and detaching mounts it again in the SAME
    // process, so the fold — held in React state — reset every single time. Reported as: fold the
    // menu, enter a session, leave it, and the menu is open again.
    setSessionsMenuHidden(true)
    // A remount reads the value back rather than starting from the default.
    expect(getSessionsMenuHidden()).toBe(true)
  })

  it('is a plain value, so unfolding sticks too', () => {
    // The inverse matters as much: a store that only ever remembered `true` would trap the menu
    // closed, which is the failure the fold was left unpersisted to avoid in the first place.
    setSessionsMenuHidden(true)
    setSessionsMenuHidden(false)
    expect(getSessionsMenuHidden()).toBe(false)
  })

  it('resets when the process does', () => {
    // The honest boundary for a gesture you made to look at something: quitting agentop forgets it,
    // which is why this is module state and not a preference on disk.
    setSessionsMenuHidden(true)
    forgetEphemeral()
    expect(getSessionsMenuHidden()).toBe(false)
  })
})
