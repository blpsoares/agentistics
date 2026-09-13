import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import {
  mermaidScratchElementId, mermaidThemeVariables, removeMermaidScratchElement,
  widenSvgToNaturalSize,
} from './MermaidDiagram'
import { TOKENS_DARK, TOKENS_LIGHT } from '../../lib/monacoTheme'
import { stripComments } from '../../lib/stripComments'

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

// C1: a mermaid parse error used to leave a scratch element as a live child of `document.body`,
// outside this component's own tree, on EVERY failed render — with no jsdom in this repo's test
// stack, `MermaidDiagram` itself never runs its effects under `renderToStaticMarkup`, so the
// belt-and-suspenders cleanup is pulled out as its own pure function and tested directly against a
// fake host instead of a real DOM.
describe('mermaidScratchElementId', () => {
  test('is mermaid\'s own d<id> naming, never the render id itself', () => {
    expect(mermaidScratchElementId('ag-mermaid-7')).toBe('dag-mermaid-7')
    expect(mermaidScratchElementId('ag-mermaid-7')).not.toBe('ag-mermaid-7')
  })
})

describe('removeMermaidScratchElement', () => {
  test('removes exactly the scratch element for THIS render id, and only that one', () => {
    let removed7 = false
    let removed8 = false
    const host = {
      getElementById(id: string) {
        if (id === 'dag-mermaid-7') return { remove: () => { removed7 = true } }
        if (id === 'dag-mermaid-8') return { remove: () => { removed8 = true } }
        return null
      },
    }
    expect(removeMermaidScratchElement(host, 'ag-mermaid-7')).toBe(true)
    expect(removed7).toBe(true)
    expect(removed8).toBe(false)
  })

  test('is a no-op — never throws — when suppressErrorRendering already stopped the element from being attached', () => {
    const host = { getElementById: () => null }
    expect(removeMermaidScratchElement(host, 'ag-mermaid-9')).toBe(false)
  })

  test('called for every failed render, a stray never survives — the actual C1 shape', () => {
    // Models the leak this guards: N failed renders of the SAME source (I1's remount-per-poll)
    // each attaching, then removing, their own scratch element. Without the call in the `catch`,
    // `attached` would grow without bound exactly as `document.body.children` did in the bug.
    const attached = new Set<string>()
    const host = {
      getElementById(id: string) {
        return attached.has(id) ? { remove: () => attached.delete(id) } : null
      },
    }
    for (let i = 0; i < 30; i++) {
      const renderId = `ag-mermaid-${i}`
      attached.add(mermaidScratchElementId(renderId)) // mermaid's own failure path
      removeMermaidScratchElement(host, renderId) // this component's cleanup
    }
    expect(attached.size).toBe(0)
  })
})

// I4: a wide diagram shrank to ~4px text instead of scrolling horizontally, because mermaid emits
// its root <svg> at `width="100%"` with `style="max-width:<viewBox width>px"` — meant to shrink a
// diagram to fit a reading column, the opposite of what this component's own `overflowX: auto` box
// wants (draw at natural size, let the BOX scroll).
describe('widenSvgToNaturalSize', () => {
  test('rewrites width to the viewBox width and drops the max-width clamp', () => {
    const svg = '<svg viewBox="0 0 842.5 213" width="100%" style="max-width: 842.5px;" role="graphics-document">'
    const out = widenSvgToNaturalSize(svg)
    expect(out).toContain('width="842.5"')
    expect(out).not.toContain('max-width: 842.5px')
    expect(out).toContain('max-width: none')
  })

  test('touches ONLY the opening <svg> tag — a width/max-width appearing later, inside a node, survives', () => {
    const svg = '<svg viewBox="0 0 100 50" width="100%" style="max-width:100px;">'
      + '<rect width="100%" style="max-width:40px" /></svg>'
    const out = widenSvgToNaturalSize(svg)
    expect(out).toContain('<svg viewBox="0 0 100 50" width="100" style="max-width: none;">')
    // The nested <rect>'s own attributes are untouched — the substitution is anchored to `<svg\b`.
    expect(out).toContain('<rect width="100%" style="max-width:40px" />')
  })

  test('a markup with no viewBox (should never happen) is returned untouched, never guessed at', () => {
    const svg = '<svg width="100%" style="max-width:200px;"></svg>'
    expect(widenSvgToNaturalSize(svg)).toBe(svg)
  })
})

/**
 * I2 / C1, over the SOURCE: `mermaid.initialize()` is only ever exercised in a browser (dynamic
 * `import('mermaid')` inside an effect, which this repo's no-jsdom stack never runs), so the one
 * thing a unit test can pin is that the options THEMSELVES are real CODE, not merely named in a
 * comment above the call — comments are stripped first (`stripComments.ts`, the shared stripper
 * this file's own header exists to be the only one of), and the assertions match the literal
 * key-and-value pair, not just the key, so a `htmlLabels: true` typo would still fail this.
 */
describe('mermaid.initialize options, as CODE rather than as prose about them', () => {
  const src = stripComments(readFileSync(new URL('./MermaidDiagram.tsx', import.meta.url), 'utf8'))

  test('suppressErrorRendering is on (C1) — comments above the call do not count', () => {
    expect(src).toContain('suppressErrorRendering: true')
  })
  test('htmlLabels is off (I2) — an HTML label can still carry an <img src> after sanitisation', () => {
    expect(src).toContain('htmlLabels: false')
  })
  test('securityLevel stays strict — the one thing that makes dangerouslySetInnerHTML safe here', () => {
    expect(src).toContain("securityLevel: 'strict'")
  })

  test('the scan still sees code a comment-only version would not', () => {
    // The test of the test: plant the exact defect (the option present only in prose) and confirm
    // the stripped source no longer contains it.
    const commentOnly = '// suppressErrorRendering: true\n// htmlLabels: false\nconst x = 1'
    const stripped = stripComments(commentOnly)
    expect(stripped).not.toContain('suppressErrorRendering: true')
    expect(stripped).not.toContain('htmlLabels: false')
  })
})
