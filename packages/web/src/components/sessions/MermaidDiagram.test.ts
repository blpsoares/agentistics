import { describe, expect, test } from 'bun:test'
import { mermaidThemeVariables } from './MermaidDiagram'
import { TOKENS_DARK, TOKENS_LIGHT } from '../../lib/monacoTheme'

const HEX6 = /^#[0-9a-fA-F]{6}$/

describe('mermaidThemeVariables', () => {
  test('every colour it hands mermaid is a flat, opaque hex — never the app\'s own rgba tokens', () => {
    for (const tokens of [TOKENS_DARK, TOKENS_LIGHT]) {
      const vars = mermaidThemeVariables(tokens)
      for (const [key, value] of Object.entries(vars)) {
        if (key === 'fontFamily') continue
        expect(HEX6.test(value)).toBe(true)
      }
    }
  })

  test('the background is the ground itself, not composited over anything', () => {
    expect(mermaidThemeVariables(TOKENS_DARK).background).toBe(TOKENS_DARK.bgBase)
    expect(mermaidThemeVariables(TOKENS_LIGHT).background).toBe(TOKENS_LIGHT.bgBase)
  })

  test('dark and light produce genuinely different palettes', () => {
    expect(mermaidThemeVariables(TOKENS_DARK)).not.toEqual(mermaidThemeVariables(TOKENS_LIGHT))
  })

  test('the node border is the product\'s own orange accent, composited on the ground', () => {
    const dark = mermaidThemeVariables(TOKENS_DARK)
    // TOKENS_DARK.orange is already an opaque hex, so flatten() is the identity here.
    expect(dark.nodeBorder).toBe(TOKENS_DARK.orange.toLowerCase())
  })
})
