import { describe, expect, test } from 'bun:test'
import { CTRL_SHORTCUTS, shortcutDecision } from './terminalShortcuts'

const ev = (over: Partial<Parameters<typeof shortcutDecision>[0]> = {}) => ({
  ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'c', ...over,
})

describe('the shortcuts a terminal owns while it has the keyboard', () => {
  test('every ctrl key the channel accepts is TAKEN from the browser', () => {
    // Reported: "quando eu estiver no terminal, quero que os atalhos funcionem (ctrl l ctrl w etc)".
    // Today `ctrl+w` closes the tab and `ctrl+l` goes to the address bar; neither reaches the pane.
    for (const key of CTRL_SHORTCUTS) expect(shortcutDecision(ev({ key }))).toBe('take')
  })

  test('a ctrl key the channel does NOT accept is left to the browser', () => {
    // `C-z` (suspend) and `C-t`/`C-n`/`C-r` are outside `KEY_ALLOWLIST`. Swallowing one would cost
    // the person their browser shortcut and deliver nothing in exchange.
    for (const key of ['z', 't', 'n', 'r', 'p', 's']) {
      expect(shortcutDecision(ev({ key }))).toBe('leave')
    }
  })
})

describe('what may NEVER be swallowed', () => {
  test('ctrl+shift+* stays the browser’s', () => {
    // Devtools, the incognito window, reopen-tab. The VS Code extension records the same rule for
    // its panel: swallow these and the editor around the terminal stops working.
    for (const key of CTRL_SHORTCUTS) {
      expect(shortcutDecision(ev({ key, shiftKey: true }))).toBe('leave')
    }
  })

  test('Cmd / Win is never touched', () => {
    // On a Mac every application shortcut is Cmd. A terminal that ate them would be a terminal you
    // cannot copy out of, quit, or switch away from.
    for (const key of CTRL_SHORTCUTS) {
      expect(shortcutDecision(ev({ key, metaKey: true }))).toBe('leave')
      expect(shortcutDecision(ev({ key, ctrlKey: false, metaKey: true }))).toBe('leave')
    }
  })

  test('alt combinations are left alone', () => {
    expect(shortcutDecision(ev({ key: 'c', altKey: true }))).toBe('leave')
  })

  test('a bare letter is not a shortcut at all', () => {
    expect(shortcutDecision(ev({ key: 'c', ctrlKey: false }))).toBe('leave')
  })

  test('case does not decide it — a capital arrives with shift, and shift already refuses', () => {
    expect(shortcutDecision(ev({ key: 'C' }))).toBe('take')
    expect(shortcutDecision(ev({ key: 'C', shiftKey: true }))).toBe('leave')
  })
})

describe('the set is closed and matches the channel', () => {
  test('exactly the letters `KEY_ALLOWLIST` carries as C-<letter>', () => {
    expect([...CTRL_SHORTCUTS].sort()).toEqual(['a', 'c', 'd', 'e', 'k', 'l', 'u', 'w'])
  })
})
