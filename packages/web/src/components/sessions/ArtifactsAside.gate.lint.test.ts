/**
 * THE REPOSITORY TAB IS ABSENT, NOT DISABLED — asserted over `ArtifactsAside.tsx`'s own source.
 *
 * This is the one rule of the wiring that can regress silently, and nothing else in this repo would
 * notice. A read/write file editor is opt-in: `editorEnabled` is the SERVER's combination of
 * `CAPS.localShell` and the user's own switch (`sessions/editor-gate.ts`), and a machine where
 * either is off must not draw the tab at all. The two failure shapes are both green builds:
 *
 *  1. **The gate is dropped from the tabs array.** Every machine grows a Repository tab; pressing it
 *     on a central — which refuses the whole `/api/fleet` prefix before the editor gate is even
 *     reached — lands a reader on a panel whose every request is refused. A greyed tab is no better:
 *     a disabled control that explains nothing is indistinguishable from a broken one.
 *  2. **The gate is dropped from the BODY branch.** `tab` is state, so it outlives the moment the
 *     switch is turned off in another surface, and the second guard is what makes that render
 *     nothing rather than a panel the server will refuse.
 *
 * There is no jsdom and no `@testing-library/react` here, so neither shape is reachable by rendering:
 * the tabs array is inline in a component whose props would have to be fabricated whole, and a click
 * cannot be performed at all. The source is therefore what there is to assert against — in the shape
 * `monacoEntry.lint.test.ts` and `tokens.lint.test.ts` already use here.
 *
 * **COMMENTS ARE STRIPPED FIRST, and that is not a detail.** The file NAMES `editorEnabled` and the
 * absent-not-disabled rule in prose beside every line below, so a grep over the raw source would be
 * satisfied by the very comment explaining the rule it failed to keep — an assertion worse than
 * none. Each check below is paired with a self-check that plants the defect and proves the scan
 * still sees it.
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

/** The tabs array literal, on its own — so "inside the gate" is a question with an answer. */
function tabsArray(s: string): string {
  const start = s.indexOf('const tabs:')
  if (start < 0) throw new Error('ArtifactsAside.gate.lint: the tabs array is no longer `const tabs:`')
  const end = s.indexOf('\n  ]\n', start)
  if (end < 0) throw new Error('ArtifactsAside.gate.lint: cannot find the end of the tabs array')
  return s.slice(start, end)
}

describe('the file this reads is the real one', () => {
  it('read something, and read the right thing', () => {
    // An empty or mis-rooted read would make every assertion below pass by examining nothing.
    expect(raw.length).toBeGreaterThan(50_000)
    expect(has('export function ArtifactsAside(')).toBe(true)
    expect(tabsArray(src).length).toBeGreaterThan(500)
  })
})

describe('the Repository tab is gated on editorEnabled, in both places', () => {
  it("'repo' is a TabId", () => {
    expect(src).toMatch(/type TabId =[^\n]*'repo'/)
  })

  it('the tab ENTRY exists only inside the `editorEnabled` spread', () => {
    const tabs = tabsArray(src)
    // It is named exactly once, and that one naming is inside the conditional spread.
    expect([...tabs.matchAll(/id: 'repo'/g)]).toHaveLength(1)
    expect(tabs).toMatch(/\.\.\.\(editorEnabled\s*\?\s*\[\{[\s\S]{0,200}?id: 'repo' as const/)
  })

  it('the tab entry carries NO count', () => {
    // A repository is not a list of this session's work. `null` would print a dash and
    // "open the tab to count", which this tab can never honour; a number would be invented.
    const entry = tabsArray(src).match(/\.\.\.\(editorEnabled\s*\?\s*\[\{[\s\S]*?\}\]\s*:\s*\[\]\)/)?.[0] ?? ''
    expect(entry).toContain("id: 'repo' as const")
    expect(entry).not.toContain('count')
  })

  it('the BODY is mounted only behind the gate', () => {
    expect(has("const repoMounted = editorEnabled === true && (tab === 'repo' || repoOpened)")).toBe(true)
    expect(has('{repoMounted && (')).toBe(true)
    expect(has('<RepositoryTab')).toBe(true)
  })

  /**
   * THE TAB'S BODY IS NEVER UNMOUNTED BY A TAB SWITCH — the third place this feature's one rule had
   * to be applied, and the one a reviewer caught missing.
   *
   * `RepositoryTab` holds Monaco buffers; an unsaved one exists in exactly one place in the world.
   * Rendered as a branch of the aside's single `tab === 'x' ? … : …` chain it was torn down the
   * moment the reader glanced at Live, taking the text with it and prompting nothing. So it is a
   * `Layer` — IMPORTED from `RepositoryTab`, which already owns this rule for its own two layers and
   * its own editor stack, rather than re-implemented for a fourth time — and the chain renders
   * NOTHING for `repo`.
   */
  it('renders the body as a hidden LAYER, never as a branch of the one-body chain', () => {
    expect(has("import { Layer, RepositoryTab } from './RepositoryTab'")).toBe(true)
    expect(has("<Layer shown={tab === 'repo'}>")).toBe(true)
    // The chain's `repo` arm must be empty: a `<RepositoryTab` inside it is the defect, because
    // every arm of that chain is unmounted the moment another one is chosen.
    expect(has("{tab === 'repo' ? null")).toBe(true)
    const chain = src.slice(src.indexOf("{tab === 'repo' ? null"))
    expect(chain.slice(0, chain.indexOf('</div>'))).not.toContain('<RepositoryTab')
  })

  it('a requested tab of `repo` is honoured only while the gate is open', () => {
    expect(has("t === 'repo' && editorEnabled === true")).toBe(true)
  })

  it('both props are consumed, not merely declared', () => {
    // Task 5 left them optional on the props and undestructured for this task to take up.
    // Declared-and-unused is dead code; the destructure is the proof they are read.
    expect(src).toMatch(/export function ArtifactsAside\(\{[\s\S]*?editorEnabled[\s\S]*?\}: ArtifactsAsideProps\)/)
    expect(has('autosave={editorAutosave === true}')).toBe(true)
  })

  it('the scan still sees the defect it exists to catch', () => {
    // The test of the test, all four plants, with the comment form proving the stripper earns its
    // place: the prose that explains the rule must not be able to satisfy the assertion.
    const gated = "...(editorEnabled\n      ? [{\n          id: 'repo' as const,\n        }]\n      : []),"
    const bare = "{ id: 'repo' as const, label: 'Repository' },"
    expect(code(gated)).toMatch(/\.\.\.\(editorEnabled\s*\?\s*\[\{[\s\S]{0,200}?id: 'repo' as const/)
    expect(code(bare)).not.toMatch(/\.\.\.\(editorEnabled\s*\?\s*\[\{[\s\S]{0,200}?id: 'repo' as const/)
    expect(code("// gated on editorEnabled: tab === 'repo' && editorEnabled")).not.toContain("tab === 'repo'")
    expect(code('/* mounted behind a Layer */ x')).not.toContain('Layer')
    expect(code("/* t === 'repo' && editorEnabled === true */")).not.toContain("t === 'repo'")
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
