import { describe, expect, test } from 'bun:test'
import { editorAllowed } from './editor-gate'
import { routeCapability } from '../capability-guard'

describe('editorAllowed', () => {
  test('absent preference reads as OFF', () => {
    expect(editorAllowed(true, undefined)).toBe(false)
  })
  test('preference true but not capable is still OFF — the preference only narrows', () => {
    expect(editorAllowed(false, true)).toBe(false)
  })
  test('capable and explicitly on is ON', () => {
    expect(editorAllowed(true, true)).toBe(true)
  })
  test('preference explicitly false is OFF even when capable', () => {
    expect(editorAllowed(true, false)).toBe(false)
  })
})

describe('the /api/fleet/tree routes ride the existing /api/fleet prefix', () => {
  test('every route this feature defines is guarded', () => {
    expect(routeCapability('/api/fleet/tree')).toBe('localShell')
    expect(routeCapability('/api/fleet/tree/search')).toBe('localShell')
    expect(routeCapability('/api/fleet/tree/file')).toBe('localShell')
    expect(routeCapability('/api/fleet/tree/entry')).toBe('localShell')
  })
  test('and so is a fleet-tree route that does not exist yet — the PREFIX is what guards it', () => {
    expect(routeCapability('/api/fleet/tree/whatever-comes-next')).toBe('localShell')
  })
})
