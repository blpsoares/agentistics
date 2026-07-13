import { test, expect } from 'bun:test'
import { addHookBlock, removeHookBlock } from './autostart'

// The update-check hook was only installed into ~/.bashrc, so zsh users (who source ~/.zshrc)
// never saw the "update available" banner. The install/uninstall now span both rc files; these
// cover the pure block transforms that back that behavior.

test('addHookBlock appends a guarded, zsh-compatible block', () => {
  const out = addHookBlock('export PATH=$PATH\n')!
  expect(out).toContain('# >>> agentop update check >>>')
  expect(out).toContain('command -v agentop >/dev/null 2>&1 && agentop check-update 2>/dev/null')
  expect(out).toContain('# <<< agentop update check <<<')
  expect(out.startsWith('export PATH=$PATH\n')).toBe(true) // preserves prior content
})

test('addHookBlock is idempotent (returns null when already present)', () => {
  const once = addHookBlock('# rc\n')!
  expect(addHookBlock(once)).toBeNull()
})

test('removeHookBlock reverses addHookBlock back to the original', () => {
  const original = 'alias ll="ls -la"\n'
  const withHook = addHookBlock(original)!
  expect(removeHookBlock(withHook)).toBe(original)
})

test('removeHookBlock returns null when the block is absent', () => {
  expect(removeHookBlock('plain rc, no hook\n')).toBeNull()
})

test('removeHookBlock throws on a corrupt block (BEGIN without END)', () => {
  expect(() => removeHookBlock('# >>> agentop update check >>>\nagentop check-update\n')).toThrow()
})
