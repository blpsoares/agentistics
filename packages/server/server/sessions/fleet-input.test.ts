/**
 * fleet-input.test.ts — the raw keystroke channel's one rule: nothing outside the table is sent.
 *
 * `send-keys` given an unrecognised key name does not fail cleanly — it falls back to sending the
 * string — so a bogus "key" becomes typed text in somebody's live session. Every case below exists
 * to keep that from happening.
 */
import { describe, expect, it } from 'bun:test'
import { MAX_INPUT_TEXT, planFleetInput, tmuxKeyName } from './fleet-input'

describe('tmuxKeyName', () => {
  it('uses tmux\'s vocabulary, not the browser\'s', () => {
    // `BSpace` not `Backspace`, `PPage` not `PageUp`, `DC` not `Delete`. A guess here does not
    // fail — it gets typed into the session.
    expect(tmuxKeyName({ key: 'Backspace' })).toBe('BSpace')
    expect(tmuxKeyName({ key: 'PageUp' })).toBe('PPage')
    expect(tmuxKeyName({ key: 'PageDown' })).toBe('NPage')
    expect(tmuxKeyName({ key: 'Delete' })).toBe('DC')
    expect(tmuxKeyName({ key: 'Insert' })).toBe('IC')
    expect(tmuxKeyName({ key: 'ArrowUp' })).toBe('Up')
    expect(tmuxKeyName({ key: 'ArrowDown' })).toBe('Down')
    expect(tmuxKeyName({ key: 'Escape' })).toBe('Escape')
    expect(tmuxKeyName({ key: 'Enter' })).toBe('Enter')
    expect(tmuxKeyName({ key: ' ' })).toBe('Space')
  })

  it('carries Ctrl and Alt in the two forms tmux accepts', () => {
    expect(tmuxKeyName({ key: 'c', ctrl: true })).toBe('C-c')
    // Ctrl-C arrives as an uppercase `C` when shift is down; the key name is lowercase either way.
    expect(tmuxKeyName({ key: 'C', ctrl: true, shift: true })).toBe('C-c')
    expect(tmuxKeyName({ key: 'd', ctrl: true })).toBe('C-d')
    expect(tmuxKeyName({ key: 'ArrowLeft', ctrl: true })).toBe('C-Left')
    expect(tmuxKeyName({ key: 'b', alt: true })).toBe('M-b')
  })

  it('refuses a combination it cannot express, rather than approximating one', () => {
    // Sending `C-M-a` to a tmux that does not parse it puts that literal string into the session.
    expect(tmuxKeyName({ key: 'a', ctrl: true, alt: true })).toBeNull()
    expect(tmuxKeyName({ key: 'F13' })).toBeNull()
    expect(tmuxKeyName({ key: 'Unidentified' })).toBeNull()
    expect(tmuxKeyName({ key: '' })).toBeNull()
  })

  it('knows Shift-Tab is its own key', () => {
    expect(tmuxKeyName({ key: 'Tab' })).toBe('Tab')
    expect(tmuxKeyName({ key: 'Tab', shift: true })).toBe('BTab')
  })

  it('accepts the function keys tmux names identically', () => {
    expect(tmuxKeyName({ key: 'F1' })).toBe('F1')
    expect(tmuxKeyName({ key: 'F12' })).toBe('F12')
  })
})

describe('planFleetInput', () => {
  it('types literal text, and submits nothing', () => {
    expect(planFleetInput({ id: 'abc', text: 'hello' }))
      .toEqual({ ok: true, plan: { kind: 'text', id: 'abc', text: 'hello' } })
  })

  it('keeps whitespace inside text — it is what was typed', () => {
    // Trimming here would eat the space bar, which is the most-pressed key there is.
    expect(planFleetInput({ id: 'abc', text: '  ' }))
      .toEqual({ ok: true, plan: { kind: 'text', id: 'abc', text: '  ' } })
  })

  it('turns a plain printable key into text, whichever field it arrived in', () => {
    // The distinction is the server's to make; a client that got it wrong would send `a` as a key
    // name and tmux would type it by luck rather than by design.
    expect(planFleetInput({ id: 'abc', key: { key: 'a' } }))
      .toEqual({ ok: true, plan: { kind: 'text', id: 'abc', text: 'a' } })
    expect(planFleetInput({ id: 'abc', key: { key: 'A', shift: true } }))
      .toEqual({ ok: true, plan: { kind: 'text', id: 'abc', text: 'A' } })
  })

  it('sends space as a KEY, not as text', () => {
    // tmux's `-l` would take a bare space fine, but the named key is unambiguous and is what the
    // approval path already uses.
    expect(planFleetInput({ id: 'abc', key: { key: ' ' } }))
      .toEqual({ ok: true, plan: { kind: 'key', id: 'abc', key: 'Space' } })
  })

  it('refuses control characters inside text', () => {
    // Each one IS a key and has a name; smuggled through `-l` they would be typed, not pressed.
    expect(planFleetInput({ id: 'abc', text: 'a\x03b' }))
      .toEqual({ ok: false, reason: 'control_in_text' })
    expect(planFleetInput({ id: 'abc', text: 'line\nline' }).ok).toBe(false)
  })

  it('refuses a paste that is really a file', () => {
    expect(planFleetInput({ id: 'abc', text: 'x'.repeat(MAX_INPUT_TEXT + 1) }))
      .toEqual({ ok: false, reason: 'too_long' })
    expect(planFleetInput({ id: 'abc', text: 'x'.repeat(MAX_INPUT_TEXT) }).ok).toBe(true)
  })

  it('names the combination it refused', () => {
    expect(planFleetInput({ id: 'abc', key: { key: 'a', ctrl: true, alt: true } }))
      .toEqual({ ok: false, reason: 'unknown_key', detail: 'Ctrl+Alt+a' })
  })

  it('needs a session and something to send', () => {
    expect(planFleetInput({ text: 'x' })).toEqual({ ok: false, reason: 'no_session' })
    expect(planFleetInput({ id: '   ', text: 'x' })).toEqual({ ok: false, reason: 'no_session' })
    expect(planFleetInput({ id: 'abc' })).toEqual({ ok: false, reason: 'empty' })
    expect(planFleetInput({ id: 'abc', text: '' })).toEqual({ ok: false, reason: 'empty' })
  })

  it('is total — a body of junk is refused, never thrown on', () => {
    expect(planFleetInput({ id: 5, text: [] } as never).ok).toBe(false)
    expect(planFleetInput({ id: 'abc', key: 'Enter' } as never).ok).toBe(false)
    expect(planFleetInput({ id: 'abc', key: { key: 42 } } as never).ok).toBe(false)
  })
})
