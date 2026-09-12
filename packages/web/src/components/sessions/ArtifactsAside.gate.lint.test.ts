/**
 * THE STUDIO IS ABSENT WHEN THE GATE IS CLOSED, IT IS A MODE AND NOT A TAB, AND NOTHING IN THIS
 * PANEL CAN UNMOUNT IT — asserted over `ArtifactsAside.tsx`'s own source.
 *
 * These are the rules of the wiring that can regress silently, and nothing else in this repo would
 * notice. Each one has already been broken at least once:
 *
 *  1. **The gate is dropped from the strip entry.** A read/write file editor is opt-in:
 *     `editorEnabled` is the SERVER's combination of `CAPS.localShell` and the user's own switch
 *     (`sessions/editor-gate.ts`), and a machine where either is off must not draw the entry at all.
 *     Pressing it on a central — which refuses the whole `/api/fleet` prefix — lands a reader on a
 *     panel whose every request is refused. A greyed entry is no better: a disabled control that
 *     explains nothing is indistinguishable from a broken one.
 *  2. **The gate is dropped from the MOUNT.** `studio` is state, so it outlives the moment the switch
 *     is turned off in another surface, and the second guard is what makes that render this panel's
 *     own chrome rather than a frame with nothing behind it.
 *  3. **The Studio becomes a tab body again.** It covers this panel's header AND its tab strip,
 *     because a file tree plus a code editor cannot share 440px with two rows of chrome. The
 *     structural guarantee is that `studio` is absent from `TabId`: `setTab` cannot be handed it, so
 *     no arm of the body chain can be written for it.
 *  4. **The Studio layer sinks back inside a tree something replaces.** It holds Monaco buffers; an
 *     unsaved one exists in exactly one place in the world. As a branch of the tab chain a glance at
 *     Live destroyed it; inside the `open ? <ArtifactDoc/> : …` branch, a WROTE row in the live feed
 *     destroys it. It has to be a SIBLING of both, at the component's root.
 *
 * There is no jsdom and no `@testing-library/react` here, so none of it is reachable by rendering:
 * the strip array is inline in a component whose props would have to be fabricated whole, and a click
 * cannot be performed at all. The source is therefore what there is to assert against — in the shape
 * `monacoEntry.lint.test.ts` and `tokens.lint.test.ts` already use here.
 *
 * **COMMENTS ARE STRIPPED FIRST, and that is not a detail.** The file NAMES `editorEnabled` and every
 * rule below in prose beside the line that keeps it, so a grep over the raw source would be satisfied
 * by the very comment explaining the rule it failed to keep — an assertion worse than none. Each
 * check below is paired with a self-check that plants the defect and proves the scan still sees it.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ASIDE = join(import.meta.dir, 'ArtifactsAside.tsx')

/** Comments out — a doc comment may NAME what the code may not do. Same helper, same reason. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const raw = readFileSync(ASIDE, 'utf8')
const src = code(raw)

/**
 * A needle, as a BOOLEAN.
 *
 * `expect(src).toContain(…)` on a 130 KB file prints the whole file on failure, which buries the
 * one line that says what broke under a screenful of someone else's imports. The needle is in the
 * assertion's own line; what the report has to carry is whether it is there.
 */
const has = (needle: string) => src.includes(needle)

/** The strip array literal, on its own — so "inside the gate" is a question with an answer. */
function tabsArray(s: string): string {
  const start = s.indexOf('const tabs:')
  if (start < 0) throw new Error('ArtifactsAside.gate.lint: the tabs array is no longer `const tabs:`')
  const end = s.indexOf('\n  ]\n', start)
  if (end < 0) throw new Error('ArtifactsAside.gate.lint: cannot find the end of the tabs array')
  return s.slice(start, end)
}

/** The declaration of one type alias, as written. */
function alias(s: string, name: string): string {
  const m = new RegExp(`type ${name} =[^\\n]*`).exec(s)
  if (m === null) throw new Error(`ArtifactsAside.gate.lint: no \`type ${name}\` to read`)
  return m[0]
}

describe('the file this reads is the real one', () => {
  it('read something, and read the right thing', () => {
    // An empty or mis-rooted read would make every assertion below pass by examining nothing.
    expect(raw.length).toBeGreaterThan(50_000)
    expect(has('export function ArtifactsAside(')).toBe(true)
    expect(tabsArray(src).length).toBeGreaterThan(500)
  })
})

describe('the Studio is a MODE, not a tab — and the types are what say so', () => {
  it("'studio' is NOT a TabId", () => {
    // This is rule 3, and it is the whole reason the split exists: `setTab` takes a `TabId`, so a
    // `studio` that is not one cannot be selected as a tab and cannot be given an arm in the chain.
    expect(alias(src, 'TabId')).not.toContain("'studio'")
  })

  it("'studio' is a StripId, which is what the strip and the launcher carry", () => {
    expect(alias(src, 'StripId')).toContain("TabId | 'studio'")
  })

  it('nothing ever hands `studio` to setTab', () => {
    expect(has("setTab('studio')")).toBe(false)
  })

  it('the two file lists are gone from the tabs, not merely hidden', () => {
    const t = alias(src, 'TabId')
    expect(t).not.toContain("'files'")
    expect(t).not.toContain("'docs'")
    // And with them the renderer and the subset they shared.
    expect(has('const fileList =')).toBe(false)
    expect(src).not.toMatch(/const docs = useMemo/)
  })

  it('the scan still sees the defect it exists to catch', () => {
    const widened = "type TabId = 'live' | 'studio'\n"
    expect(alias(code(widened), 'TabId')).toContain("'studio'")
    // The comment form, proving the stripper earns its place: the prose explaining the rule must not
    // be able to satisfy the assertion.
    expect(code("// `studio` is deliberately not a TabId")).not.toContain('TabId')
    expect(code("/* we must never write setTab('studio') */")).not.toContain("setTab('studio')")
  })
})

describe('the Studio is gated on editorEnabled, in both places', () => {
  it('the strip ENTRY exists only inside the `editorEnabled` spread', () => {
    const tabs = tabsArray(src)
    // It is named exactly once, and that one naming is inside the conditional spread.
    expect([...tabs.matchAll(/id: 'studio'/g)]).toHaveLength(1)
    expect(tabs).toMatch(/\.\.\.\(editorEnabled\s*\?\s*\[\{[\s\S]{0,200}?id: 'studio' as const/)
  })

  it('the strip entry carries NO count', () => {
    // A repository is not a list of this session's work. `null` would print a dash and
    // "open the tab to count", which this entry can never honour; a number would be invented.
    const entry = tabsArray(src).match(/\.\.\.\(editorEnabled\s*\?\s*\[\{[\s\S]*?\}\]\s*:\s*\[\]\)/)?.[0] ?? ''
    expect(entry).toContain("id: 'studio' as const")
    expect(entry).not.toContain('count')
  })

  it('the MOUNT and the SHOWING are both gated', () => {
    expect(has('const studioMounted = editorEnabled === true && (studio || studioOpened)')).toBe(true)
    expect(has('const inStudio = studio && editorEnabled === true')).toBe(true)
    expect(has('{studioMounted && (')).toBe(true)
    expect(has('<Studio')).toBe(true)
  })

  it('a requested tab of `studio` is honoured only while the gate is open', () => {
    expect(has("if (t === 'studio') { if (editorEnabled === true) setStudio(true) }")).toBe(true)
  })

  it('the one router from a strip id to an action is the only place `studio` is routed', () => {
    expect(has("if (id === 'studio') setStudio(true)")).toBe(true)
  })

  it('the scan still sees the defect it exists to catch', () => {
    const gated = "...(editorEnabled\n      ? [{\n          id: 'studio' as const,\n        }]\n      : []),"
    const bare = "{ id: 'studio' as const, label: 'Studio' },"
    expect(code(gated)).toMatch(/\.\.\.\(editorEnabled\s*\?\s*\[\{[\s\S]{0,200}?id: 'studio' as const/)
    expect(code(bare)).not.toMatch(/\.\.\.\(editorEnabled\s*\?\s*\[\{[\s\S]{0,200}?id: 'studio' as const/)
    expect(code("// gated: const inStudio = studio && editorEnabled === true")).not.toContain('const inStudio')
    expect(code("/* mounted behind a Layer */ x")).not.toContain('Layer')
  })
})

/**
 * RULE 4, and the one that cost this feature two restarts.
 *
 * Two trees in this component are routinely thrown away: each arm of the tab chain, and the whole
 * `open ? <ArtifactDoc/> : <>chrome</>` branch that a WROTE row in the live feed flips. The Studio
 * must be a SIBLING of both — rendered before them, at the component's root — or an ordinary click
 * takes unsaved Monaco buffers with it and prompts nothing.
 *
 * Asserted by POSITION, because that is what the property actually is. A needle could be satisfied
 * by a `<Layer shown={inStudio}>` sitting anywhere; what matters is that it comes BEFORE the branch
 * and that the branch does not contain the Studio.
 */
describe('nothing in this panel can unmount the Studio', () => {
  const layerAt = src.indexOf('<Layer shown={inStudio}>')
  const branchAt = src.indexOf('{inStudio ? null : open ? (')

  it('both landmarks are there to be compared', () => {
    expect(layerAt).toBeGreaterThan(-1)
    expect(branchAt).toBeGreaterThan(-1)
  })

  it('the layer is rendered BEFORE the branch that replaces the panel', () => {
    expect(layerAt).toBeLessThan(branchAt)
  })

  it('and the branch itself contains no Studio', () => {
    // Everything from the branch to the end of the component: the ArtifactDoc arm, the chrome arm
    // and the whole tab chain. A `<Studio` anywhere in there is the defect.
    expect(src.slice(branchAt)).not.toContain('<Studio')
  })

  it('the hiding rule comes from `Studio`, not from a fourth copy of it', () => {
    expect(has("import { Layer, Studio } from './Studio'")).toBe(true)
    // `Layer` is nested here (the Studio renders two more inside itself), so the one thing this
    // panel must not do is hide with `visibility` of its own — see `Layer`'s doc comment.
    expect(src).not.toMatch(/visibility:\s*inStudio/)
  })

  it('the scan still sees the defect it exists to catch', () => {
    // The two shapes that shipped: the layer inside the chain, and the layer inside the branch.
    const inChain = "{inStudio ? null : open ? (\n  x\n) : (\n  <Layer shown={inStudio}><Studio /></Layer>\n)}"
    const stripped = code(inChain)
    expect(stripped.indexOf('<Layer shown={inStudio}>'))
      .toBeGreaterThan(stripped.indexOf('{inStudio ? null : open ? ('))
    expect(stripped.slice(stripped.indexOf('{inStudio ? null : open ? ('))).toContain('<Studio')
    // And the comment form: the prose above names the defect and must not satisfy the scan.
    expect(code('/* never put <Studio /> inside the chain */')).not.toContain('<Studio')
  })
})

describe('both editor props are consumed, not merely declared', () => {
  it('they are destructured and spent', () => {
    expect(src).toMatch(/export function ArtifactsAside\(\{[\s\S]*?editorEnabled[\s\S]*?\}: ArtifactsAsideProps\)/)
    expect(has('autosave={editorAutosave === true}')).toBe(true)
  })

  it('the exit is passed — a Studio with no way out is a reader trapped in it', () => {
    // It covers this panel's header and strip, so its own top edge is the only chrome there is.
    expect(has('onExit={() => setStudio(false)}')).toBe(true)
  })
})

describe('the fourth copy of the empty-region Note is gone', () => {
  it('imports the shared one and declares none of its own', () => {
    expect(has("import { RepoNote as Note } from './repoNote'")).toBe(true)
    expect(src).not.toMatch(/function Note\s*\(/)
  })

  it('the scan still sees a re-declared Note', () => {
    expect(code('function Note({ text }: { text: string }) { return null }')).toMatch(/function Note\s*\(/)
    expect(code('// function Note(...) used to live here')).not.toMatch(/function Note\s*\(/)
  })
})
