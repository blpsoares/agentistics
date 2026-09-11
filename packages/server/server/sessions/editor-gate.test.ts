import { describe, expect, test } from 'bun:test'
import { editorAllowed } from './editor-gate'

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
