/**
 * What THIS composition adds to four already-tested pieces.
 *
 * `repoTreeModel.test.ts` owns the tree and the open-tabs arithmetic, `repoApi.test.ts` the three
 * outcomes of a call, and `RepoTreeView` / `RepoSearchView` / `RepoFileEditor` their own behaviour;
 * none of it is re-asserted here. What is left is this file's own: WHICH FILES KEEP A LIVE EDITOR
 * (the one rule this task must not ship without), what closing a tab leaves behind, what the live
 * feed says about the file on screen, and the chrome — the strip, the toolbar, the new-file row and
 * the watermark — including at 390px.
 *
 * Rendering is `renderToStaticMarkup`, the same stack `RepoTreeView.test.tsx` uses: this repo has no
 * jsdom and no `@testing-library/react` (see `ConnectionCard.test.tsx`'s own note), so a CLICK
 * cannot be simulated and `useEffect` never runs. That is exactly why the rules above are exported
 * FUNCTIONS and the chrome takes its state as PROPS — a fact reachable only by clicking is a fact no
 * test in this repo could carry.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  agentActivity, applyRootRefresh, clampTreeWidth, closeOutcome, DIVIDER_W,
  dividerKeyDelta, dividerWantedWidth, EDITOR_MIN, EditorStack,
  Layer, mountedEditors, nextGoTo, NewFileRow, paneHits, resolveEditorShown, resolveTreeCollapsed,
  resolveTreeShown,
  resolveTreeSide, resolveTreeWidth, searchRequestNeedsExpand, sessionMovedOn, SPLIT_MIN,
  Studio, StudioBody, sameFile,
  studioGearEntries, studioLayout, studioToolbarFit, TabStrip, Toolbar, treeCollapsible, TREE_DEFAULT,
  TREE_MAX, TREE_MIN, TreeDivider, Watermark, watermarkOpacity,
} from './Studio'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../lib/stripComments'
import { makeRootNode, type OpenTab, type TreeNode } from '../../lib/repoTreeModel'
import { ICON_HUES, fileIconHueOnActiveTab } from './fileIcon'
import type { LiveEvent, LiveTurn } from '../../lib/artifactTabs'
import { RepoFileEditor } from './RepoFileEditor'
import type { ReactElement } from 'react'

/**
 * `useIsMobile` reads `window.innerWidth` in its state initializer. Bun's runtime has no DOM, and
 * this file renders to a string rather than to one — so the width is the only thing that has to
 * exist. `useEffect` (where `matchMedia` and the theme observer live) never runs here.
 */
const env = globalThis as unknown as { window?: { innerWidth: number } }
const windowIsOurs = env.window === undefined
env.window ??= { innerWidth: 1280 }
const desktop = () => { env.window!.innerWidth = 1280 }
const phone = () => { env.window!.innerWidth = 390 }

// Restored in HOOKS, never by hand at the end of a test body: a `phone()` undone only when the test
// reaches that line leaves 390 set for whatever runs next in the same process — someone else's file.
beforeEach(desktop)
afterEach(desktop)
afterAll(() => { if (windowIsOurs) delete env.window })

function tab(path: string, dirty = false): OpenTab {
  return { id: path, path, dirty }
}

// --- the rule this task must not ship without ----------------------------------------------------

describe('mountedEditors — which files keep a live editor', () => {
  test('THE headline case: typing in one file and clicking the tab beside it keeps the first mounted', () => {
    // `a.ts` has unsaved text and the reader has just clicked `b.ts`. Unmounting `a.ts` here is the
    // silent loss this whole composition is arranged to make impossible.
    const tabs = [tab('a.ts', true), tab('b.ts')]
    expect(mountedEditors(tabs, 'b.ts')).toEqual(['a.ts', 'b.ts'])
  })

  test('and across the WHOLE gesture — type, leave, come back — `a.ts` is never once unmounted', () => {
    // The three frames of "type three lines in a.ts, click b.ts, click back". `a.ts` is in the
    // mounted set at every one of them, so its Monaco model, its text and its dirty flag are never
    // torn down to be restored — there is nothing to restore.
    const typed = [tab('a.ts', true), tab('b.ts')]
    expect(mountedEditors(typed, 'a.ts')).toContain('a.ts')   // typing
    expect(mountedEditors(typed, 'b.ts')).toContain('a.ts')   // looking at b.ts
    expect(mountedEditors(typed, 'a.ts')).toContain('a.ts')   // back on a.ts
    // And `b.ts`, which was never edited, is mounted only while it is the one on screen.
    expect(mountedEditors(typed, 'b.ts')).toContain('b.ts')
    expect(mountedEditors(typed, 'a.ts')).not.toContain('b.ts')
  })

  test('a CLEAN background file is unmounted: the server hands back the same bytes', () => {
    const tabs = [tab('a.ts'), tab('b.ts')]
    expect(mountedEditors(tabs, 'b.ts')).toEqual(['b.ts'])
  })

  test('three dirty files and one active are four editors — the bound is what you have edited', () => {
    const tabs = [tab('a.ts', true), tab('b.ts', true), tab('c.ts', true), tab('d.ts')]
    expect(mountedEditors(tabs, 'd.ts')).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  })

  test('nothing open mounts nothing', () => {
    expect(mountedEditors([], null)).toEqual([])
  })

  test('the strip with nothing selected still holds a dirty buffer open', () => {
    // The reader pressed "back to the tree" over an unsaved file. The tab is still there and so is
    // its text.
    expect(mountedEditors([tab('a.ts', true), tab('b.ts')], null)).toEqual(['a.ts'])
  })

  test('an active path the strip does not carry is mounted anyway, never dropped', () => {
    expect(mountedEditors([tab('a.ts')], 'ghost.ts')).toEqual(['ghost.ts'])
  })
})

// --- closing --------------------------------------------------------------------------------------

describe('closeOutcome', () => {
  const three = [tab('a.ts'), tab('b.ts', true), tab('c.ts')]

  test('closing the ACTIVE tab lands on the one that slid into its place', () => {
    expect(closeOutcome(three, 'b.ts', 'b.ts')).toEqual({
      tabs: [tab('a.ts'), tab('c.ts')], activePath: 'c.ts',
    })
  })

  test('closing the RIGHTMOST active tab lands on the new last one', () => {
    expect(closeOutcome(three, 'c.ts', 'c.ts')).toEqual({
      tabs: [tab('a.ts'), tab('b.ts', true)], activePath: 'b.ts',
    })
  })

  test('closing a BACKGROUND tab never moves the reader', () => {
    expect(closeOutcome(three, 'c.ts', 'a.ts')).toEqual({
      tabs: [tab('b.ts', true), tab('c.ts')], activePath: 'c.ts',
    })
  })

  test('closing the last tab returns to the tree', () => {
    expect(closeOutcome([tab('a.ts')], 'a.ts', 'a.ts')).toEqual({ tabs: [], activePath: null })
  })

  test('the unsaved flag of every surviving tab is carried through untouched', () => {
    const out = closeOutcome(three, 'a.ts', 'a.ts')
    expect(out.tabs.find(t => t.path === 'b.ts')?.dirty).toBe(true)
  })

  test('closing a path that is not open changes nothing but says so consistently', () => {
    expect(closeOutcome(three, 'b.ts', 'nope.ts')).toEqual({ tabs: three, activePath: 'b.ts' })
  })
})

// --- the root re-read after a create --------------------------------------------------------------

describe('applyRootRefresh — the one path a create used to drop the refusal on', () => {
  test('a successful re-read applies the real listing', () => {
    const next = applyRootRefresh(makeRootNode(), { ok: true, children: [{ name: 'a.ts', kind: 'file' }] }, 'en')
    expect(next.children).toEqual([
      { path: 'a.ts', name: 'a.ts', kind: 'file', expanded: false, loading: false, children: null },
    ])
    expect(next.error).toBeUndefined()
  })

  test('a REFUSED re-read is a visible error on the tree — the defect this replaces', () => {
    // Before this function existed, `submitCreate`'s re-read had `if (res.ok) …` with no `else`: a
    // refused re-read left the tree silently holding the pre-create listing, with nothing on screen
    // saying it was stale. `applyRootRefresh` is the one path both the session load and the create
    // flow now go through, so this failure mode is structurally the same as every other tree failure.
    const next = applyRootRefresh(
      makeRootNode(),
      { ok: false, failure: 'refused', status: 403, reason: 'editor_disabled' },
      'en',
    )
    expect(next.error).toBe('The Studio is off on this machine. Turn it on in Settings → Sessions.')
  })

  test('the sentence is the SAME wording table the rest of the feature uses, in Portuguese too', () => {
    const next = applyRootRefresh(
      makeRootNode(),
      { ok: false, failure: 'unreachable', cause: 'timeout' },
      'pt',
    )
    expect(next.error).toBe(
      'O servidor está demorando demais para responder. Talvez ainda esteja lendo este diretório.',
    )
  })

  test('a refusal never keeps stale CHILDREN silently — the node carries the error, and nothing to show alongside it changes', () => {
    const withChildren = applyChildrenFixture()
    const next = applyRootRefresh(
      withChildren,
      { ok: false, failure: 'refused', status: 404, reason: 'not-found' },
      'en',
    )
    // The error is set (the tree can now show it); the previous listing is left exactly as it was —
    // `applyError` never touches `children` — which is the honest half of "stale but visible": the
    // reader sees the old rows AND the sentence saying the listing did not just refresh.
    expect(next.error).toBe('not-found')
    expect(next.children).toEqual(withChildren.children)
  })
})

function applyChildrenFixture(): TreeNode {
  return applyRootRefresh(makeRootNode(), { ok: true, children: [{ name: 'old.ts', kind: 'file' }] }, 'en')
}

// --- a session switch racing an in-flight request --------------------------------------------------

describe('sessionMovedOn — the cancellation guard `submitCreate` checks after every await', () => {
  test('the same session throughout: nothing moved on', () => {
    expect(sessionMovedOn('s1', 's1')).toBe(false)
  })

  test('the reader switched sessions while the request was out', () => {
    expect(sessionMovedOn('s1', 's2')).toBe(true)
  })
})

// --- re-clicking the same search hit ----------------------------------------------------------------

describe('nextGoTo — what makes a re-click of the SAME hit jump again', () => {
  test('a first jump request gets seq 1', () => {
    expect(nextGoTo(0, 'a.ts', 10)).toEqual({ goTo: { path: 'a.ts', line: 10, seq: 1 }, counter: 1 })
  })

  test('clicking the IDENTICAL hit twice produces two DIFFERENT `seq` values', () => {
    // This is the whole fix: `{path, line}` alone repeats exactly on a re-click of the same hit, and
    // `RepoFileEditor`'s reveal effect depends on the line NUMBER, so a dependency array that did not
    // change left the jump silently not happening a second time. `seq` never repeats.
    const first = nextGoTo(0, 'a.ts', 10)
    const second = nextGoTo(first.counter, 'a.ts', 10)
    expect(first.goTo?.seq).not.toBe(second.goTo?.seq)
    expect(second.goTo).toEqual({ path: 'a.ts', line: 10, seq: 2 })
  })

  test('clicking a DIFFERENT hit also advances the counter — every request is distinct', () => {
    const first = nextGoTo(0, 'a.ts', 10)
    const second = nextGoTo(first.counter, 'b.ts', 20)
    expect(second.goTo).toEqual({ path: 'b.ts', line: 20, seq: 2 })
  })

  test('no line (opening from the tree, not a search hit) clears goTo and spends no seq', () => {
    expect(nextGoTo(3, 'a.ts', undefined)).toEqual({ goTo: null, counter: 3 })
  })

  test('a non-positive line is treated the same as no line', () => {
    expect(nextGoTo(3, 'a.ts', 0)).toEqual({ goTo: null, counter: 3 })
  })
})

// --- the live agent -------------------------------------------------------------------------------

describe('sameFile', () => {
  test('an absolute path the harness wrote matches the tab it belongs to', () => {
    expect(sameFile('/home/me/proj/src/a.ts', 'src/a.ts')).toBe(true)
  })

  test('an exact relative path matches', () => {
    expect(sameFile('src/a.ts', 'src/a.ts')).toBe(true)
  })

  test('a SUFFIX that is not segment-aligned does not match — `foobar.ts` is not `bar.ts`', () => {
    expect(sameFile('/home/me/proj/foobar.ts', 'bar.ts')).toBe(false)
  })

  test('another file entirely does not match', () => {
    expect(sameFile('/home/me/proj/src/b.ts', 'src/a.ts')).toBe(false)
  })
})

function ev(kind: LiveEvent['kind'], text: string, live: boolean): LiveEvent {
  return { kind, text, live }
}

describe('agentActivity', () => {
  test('nothing pending is not working, whatever happened before', () => {
    expect(agentActivity([ev('wrote', 'src/a.ts', false)], 'src/a.ts'))
      .toEqual({ working: false, here: false })
  })

  test('a pending tail is the agent working', () => {
    expect(agentActivity([ev('ran', 'bun test', true)], null))
      .toEqual({ working: true, here: false })
  })

  test('a pending WRITE to the open file lights the file-specific badge', () => {
    expect(agentActivity([ev('wrote', '/p/src/a.ts', true)], 'src/a.ts'))
      .toEqual({ working: true, here: true })
  })

  test('the whole pending TAIL is read, not just its last event', () => {
    // A write followed by a shell command inside one pending turn still means "it is editing this".
    const feed = [ev('wrote', '/p/src/a.ts', true), ev('ran', 'bun test', true)]
    expect(agentActivity(feed, 'src/a.ts')).toEqual({ working: true, here: true })
  })

  test('a FINISHED write to the open file lights nothing — the badge is about now', () => {
    const feed = [ev('wrote', '/p/src/a.ts', false), ev('ran', 'bun test', true)]
    expect(agentActivity(feed, 'src/a.ts')).toEqual({ working: true, here: false })
  })

  test('a pending write to ANOTHER file is working but not here', () => {
    expect(agentActivity([ev('wrote', '/p/src/b.ts', true)], 'src/a.ts'))
      .toEqual({ working: true, here: false })
  })

  test('a READ of the open file is not an edit', () => {
    expect(agentActivity([ev('read', '/p/src/a.ts', true)], 'src/a.ts'))
      .toEqual({ working: true, here: false })
  })

  test('an empty feed claims nothing', () => {
    expect(agentActivity([], 'src/a.ts')).toEqual({ working: false, here: false })
  })
})

// --- the stack: hidden, never unmounted ------------------------------------------------------------

describe('EditorStack', () => {
  const stack = (paths: string[], activePath: string | null) => renderToStaticMarkup(
    <EditorStack
      sessionId="s1" paths={paths} activePath={activePath} autosave={false} lang="en"
      goTo={null} onDirtyChange={() => {}}
    />,
  )

  test('every mounted path is IN THE MARKUP, the inactive one included', () => {
    const html = stack(['a.ts', 'b.ts'], 'b.ts')
    expect(html).toContain('data-editor-path="a.ts"')
    expect(html).toContain('data-editor-path="b.ts"')
  })

  test('exactly one of them is visible, and the other is hidden rather than gone', () => {
    const html = stack(['a.ts', 'b.ts'], 'b.ts')
    // Through `Layer`, so the stack cannot hide by a different rule from the two layers above it.
    expect(html.match(/data-layer-shown="false"/g)?.length).toBe(1)
    expect(html.match(/data-layer-shown="true"/g)?.length).toBe(1)
  })

  test('the hidden one is INERT — out of the keyboard’s reach while it is not on screen', () => {
    const html = stack(['a.ts', 'b.ts'], 'b.ts')
    // One `inert` for one hidden editor: the active one must not carry it.
    expect(html.match(/inert=""/g)?.length).toBe(1)
  })

  test('nothing mounted draws an empty region rather than a note about it', () => {
    expect(stack([], null)).not.toContain('data-editor-path')
  })

  /**
   * I5 — relative links in a rendered markdown preview open the file in the Studio. `RepoFileEditor`
   * never mounts under `renderToStaticMarkup` (its file read is async, so it is stuck in `loading`),
   * so the wiring cannot be observed in the markup — the same reason `MarkdownPreview.test.tsx`'s I1
   * fix walks the returned ELEMENT TREE instead of rendered HTML. `EditorStack` takes no hooks, so
   * calling it directly (not through JSX) hands back that tree without any DOM at all.
   */
  test('onOpenPath reaches RepoFileEditor unchanged (I5 wiring)', () => {
    const onOpenPath = (_path: string) => {}
    const tree = EditorStack({
      sessionId: 's1', paths: ['a.md'], activePath: 'a.md', autosave: false, lang: 'en',
      goTo: null, onDirtyChange: () => {}, onOpenPath,
    }) as ReactElement<{ children: ReactElement[] }>
    const [layer] = tree.props.children
    const editorDiv = (layer as ReactElement<{ children: ReactElement }>).props.children
    const editor = (editorDiv as ReactElement<{ children: ReactElement }>).props.children
    expect(editor.type).toBe(RepoFileEditor)
    expect((editor.props as { onOpenPath?: unknown }).onOpenPath).toBe(onOpenPath)
  })

  test('onOpenPath omitted leaves RepoFileEditor without one, not a stub', () => {
    const tree = EditorStack({
      sessionId: 's1', paths: ['a.md'], activePath: 'a.md', autosave: false, lang: 'en',
      goTo: null, onDirtyChange: () => {},
    }) as ReactElement<{ children: ReactElement[] }>
    const [layer] = tree.props.children
    const editorDiv = (layer as ReactElement<{ children: ReactElement }>).props.children
    const editor = (editorDiv as ReactElement<{ children: ReactElement }>).props.children
    expect((editor.props as { onOpenPath?: unknown }).onOpenPath).toBeUndefined()
  })
})

// --- the two layers --------------------------------------------------------------------------------

describe('Layer', () => {
  test('a hidden layer is HIDDEN and inert — not removed', () => {
    const html = renderToStaticMarkup(<Layer shown={false}><p>tree</p></Layer>)
    expect(html).toContain('<p>tree</p>')
    expect(html).toContain('opacity:0')
    expect(html).toContain('pointer-events:none')
    expect(html).toContain('inert=""')
  })

  test('a shown layer takes the keyboard and the clicks', () => {
    const html = renderToStaticMarkup(<Layer shown={true}><p>tree</p></Layer>)
    expect(html).toContain('opacity:1')
    expect(html).not.toContain('inert=""')
    expect(html).not.toContain('pointer-events:none')
  })

  /**
   * THE HIDE MAY NOT BE `visibility`, AND THIS IS THE TEST THAT SAYS SO.
   *
   * `visibility` is inherited AND overridable: a descendant setting `visibility: visible` re-shows
   * itself inside a hidden ancestor. That is not a theoretical hazard here — `Layer` is nested three
   * deep (the aside's Studio layer, the Studio's tree/editor pair, the editor stack's buffers) and at
   * every level one child is always shown, so the inner one re-showed itself and painted, frozen and
   * unclickable, over whatever the reader had switched to. Reproduced in Chromium: the inner box
   * computed `visible` under an ancestor computing `hidden`, and `elementsFromPoint` returned it
   * above the tab body.
   *
   * A static render cannot compute styles, so what is asserted is the thing that actually fixed it:
   * `Layer` NEVER NAMES `visibility` at all, at any nesting depth. `opacity` is not inherited — a
   * child's `opacity: 1` composites inside a parent's `opacity: 0` and stays invisible — so the
   * shown inner layer below is allowed to say `opacity:1` and must still be hidden.
   */
  test('a SHOWN layer inside a HIDDEN one cannot re-show itself', () => {
    const html = renderToStaticMarkup(
      <Layer shown={false}><Layer shown={true}><p>inner</p></Layer></Layer>,
    )
    expect(html).toContain('<p>inner</p>')
    expect(html).not.toContain('visibility')
    // The outer is the hidden one, and it hides with the non-overridable property.
    expect(html.indexOf('opacity:0')).toBeLessThan(html.indexOf('<p>inner</p>'))
  })

  test('the scan still sees the defect it exists to catch', () => {
    // The test of the test: a `Layer` that went back to `visibility` would fail the assertion above.
    const planted = '<div style="visibility:hidden"><div style="visibility:visible"><p>inner</p></div></div>'
    expect(planted).toContain('visibility')
  })
})

// --- the strip -------------------------------------------------------------------------------------

describe('TabStrip', () => {
  const strip = (tabs: OpenTab[], activePath: string | null, opts?: {
    agentHere?: boolean; back?: boolean; lang?: 'pt' | 'en'
  }) => renderToStaticMarkup(
    <TabStrip
      tabs={tabs}
      activePath={activePath}
      agentHere={opts?.agentHere === true}
      isMobile={env.window!.innerWidth < 768}
      lang={opts?.lang ?? 'en'}
      onSelect={() => {}}
      onClose={() => {}}
      {...(opts?.back === true ? { onBack: () => {} } : {})}
    />,
  )

  test('every open file is named, and its close control says WHICH file it closes', () => {
    const html = strip([tab('src/a.ts'), tab('b.ts')], 'b.ts')
    expect(html).toContain('>a.ts<')
    expect(html).toContain('aria-label="Close a.ts"')
    expect(html).toContain('aria-label="Close b.ts"')
  })

  test('an unsaved tab SAYS so, not only in orange', () => {
    const html = strip([tab('a.ts', true)], 'a.ts')
    expect(html).toContain('a.ts — unsaved')
    expect(html).toContain('data-dirty="true"')
  })

  test('a saved tab claims nothing', () => {
    const html = strip([tab('a.ts')], 'a.ts')
    expect(html).not.toContain('unsaved')
    expect(html).toContain('data-dirty="false"')
  })

  test('the back control exists only when there is a file open to come back FROM', () => {
    expect(strip([tab('a.ts')], 'a.ts', { back: true })).toContain('Back to the file tree')
    expect(strip([tab('a.ts')], null)).not.toContain('Back to the file tree')
  })

  test('the agent badge is on the ACTIVE tab only, and names what it means', () => {
    const html = strip([tab('a.ts'), tab('b.ts')], 'b.ts', { agentHere: true })
    expect(html.match(/aria-label="The agent is editing this file right now"/g)?.length).toBe(1)
  })

  test('no badge when the agent is elsewhere', () => {
    expect(strip([tab('a.ts')], 'a.ts')).not.toContain('editing this file right now')
  })

  test('at 390px a tab is a 44px touch target', () => {
    phone()
    expect(strip([tab('a.ts')], 'a.ts')).toContain('min-height:44px')
  })

  test('it is a scroller of its own, so a long strip never widens the panel', () => {
    const html = strip([tab('a.ts')], 'a.ts')
    expect(html).toContain('overflow-x:auto')
    expect(html).toContain('overscroll-behavior:contain')
  })

  /**
   * §3 of the slots/references design: an extension icon on every open tab, the same `fileIcon.tsx`
   * glyph the tree draws. `a.ts` wears the TypeScript letter badge — every tab used to be the same
   * shape, distinguished only by a truncated name.
   */
  describe('the extension icon', () => {
    test('every tab carries its own mark, drawn before the name', () => {
      const html = strip([tab('a.ts'), tab('.env')], 'a.ts')
      // Both marks are on screen — `TS` (the letter badge) and the key stroke `.env` draws with.
      expect(html).toContain('TS')
      expect(html).toContain(ICON_HUES.env!)
    })

    test('an unmapped extension takes the neutral glyph, not a near-miss', () => {
      expect(strip([tab('data.xyz123')], 'a.ts')).toContain('lucide-file')
    })

    test('the ACTIVE tab draws in the elevated-ground hue; an inactive one keeps the tree default', () => {
      // `env` is one of the eight `fileIconHueOnActiveTab` had to lift — see that function's own
      // comment. Planting the regression (rendering every tab with the tree's default `ICON_HUES.env`
      // regardless of `active`) makes this fail on the active assertion.
      const html = strip([tab('.env')], '.env')
      expect(html).toContain(fileIconHueOnActiveTab('env')!)
      expect(html).not.toContain(ICON_HUES.env!)

      const inactiveHtml = strip([tab('.env'), tab('b.ts')], 'b.ts')
      expect(inactiveHtml).toContain(ICON_HUES.env!)
      expect(inactiveHtml).not.toContain(fileIconHueOnActiveTab('env')!)
    })
  })
})

// --- the toolbar and the new-file row ---------------------------------------------------------------

describe('Toolbar', () => {
  // `studioToolbarFit(0)` is the WIDEST state — "not measured yet" reads as wide, the same
  // convention `useElementWidth`'s own header documents — so these chrome tests (which care about
  // presence, not about the width-driven fit) render every optional item every time.
  const bar = (working: boolean) => renderToStaticMarkup(
    <Toolbar
      working={working} isMobile={false} lang="en" onSearch={() => {}} onNew={() => {}}
      fit={studioToolbarFit(0)}
    />,
  )

  test('search and new are both reachable', () => {
    expect(bar(false)).toContain('Search')
    expect(bar(false)).toContain('New')
  })

  test('the working dot is SAID, not only coloured', () => {
    expect(bar(true)).toContain('The agent is working in this session')
  })

  test('and it is absent when nothing is pending', () => {
    expect(bar(false)).not.toContain('The agent is working in this session')
  })
})

/**
 * studioToolbarFit — the pure arithmetic behind the live fix (owner, 2026-09-19, follow-up: "the
 * three fixed controls are the whole point of this change... a placement where they are cut off by
 * `overflow: hidden` and unreachable by mouse is this change's own bug"). Tested as WIDTHS, not
 * screenshots — the same shape `fitColumns`/`fitKpis` are tested with in the TUI package.
 */
describe('studioToolbarFit — the trio is never negotiable, everything else degrades in order', () => {
  test('unmeasured (<= 0) reads as the WIDEST state — everything shown, everything labelled', () => {
    for (const w of [0, -1, -100]) {
      expect(studioToolbarFit(w)).toEqual({
        showSearch: true, showNewFile: true, showNewFolder: true, showWorking: true,
        beta: 'full', treeLabels: true,
      })
    }
  })

  test('THE RULE: the fixed trio needs no explicit assertion — it is not part of this data at all, '
    + 'and every width below still leaves room for it (94px) plus its own row padding', () => {
    // `studioToolbarFit` never returns anything about the trio; it exists only so the OTHER items
    // never claim more than what is left over. This test's own existence is the assertion: nothing
    // in `StudioToolbarFit` can ever say "hide the trio".
    expect(Object.keys(studioToolbarFit(50))).toEqual([
      'showSearch', 'showNewFile', 'showNewFolder', 'showWorking', 'beta', 'treeLabels',
    ])
  })

  test('a width narrower than the trio itself still returns a defined, safe (all-false) result', () => {
    expect(studioToolbarFit(1)).toEqual({
      showSearch: false, showNewFile: false, showNewFolder: false, showWorking: false,
      beta: 'hidden', treeLabels: false,
    })
  })

  test('TREE_MIN (150px) — the narrowest the tree column itself can ever be dragged to — still leaves room for the trio plus at least Search', () => {
    // `studioToolbarFit` receives the CONTENT box, not the column's own border-box width — see the
    // `studioToolbarFit — measured against the DOM` block below for why (`useElementWidth`'s
    // `ResizeObserver` reading, 16px less than `TREE_MIN` itself for this row's own padding).
    const fit = studioToolbarFit(TREE_MIN - 16)
    expect(fit.showSearch).toBe(true)
    // At the true minimum there is not room for all three AND the trio — the trio wins, as it must.
    expect(fit.showNewFile).toBe(false)
  })

  test('the drop order, most important first: search survives narrower than new-file, which survives narrower than new-folder', () => {
    // Walk widths downward and record the width at which each first disappears.
    const disappearsAt = (pick: (fit: ReturnType<typeof studioToolbarFit>) => boolean): number => {
      for (let w = 400; w >= 0; w -= 1) if (!pick(studioToolbarFit(w))) return w + 1
      return 0
    }
    const search = disappearsAt(f => f.showSearch)
    const newFile = disappearsAt(f => f.showNewFile)
    const newFolder = disappearsAt(f => f.showNewFolder)
    expect(newFolder).toBeGreaterThanOrEqual(newFile)
    expect(newFile).toBeGreaterThanOrEqual(search)
  })

  test('labels are ALL-OR-NOTHING across the three tree actions, never half-labelled', () => {
    // 0..600, not 0..400 — the real label threshold is 481px (measured against the DOM; see the
    // block below), which a narrower loop would never reach, making the `if` branch below vacuous.
    for (let w = 0; w <= 600; w += 4) {
      const fit = studioToolbarFit(w)
      if (fit.treeLabels) {
        // Labels only ever apply to buttons that are actually shown; this asserts the flag itself
        // never appears with zero buttons present to label.
        expect(fit.showSearch || fit.showNewFile || fit.showNewFolder).toBe(true)
      }
    }
  })

  test('beta only ever reaches "full" by way of "compact" — never hidden straight to full', () => {
    // Start at 1, not 0 — `studioToolbarFit(0)` is the special "unmeasured" widest reading (`beta:
    // 'full'` immediately), never a real narrow-to-wide walk, exactly like the monotonic test above.
    // Ends at 600, not 500 — the measured full-BETA threshold is 513px, which 500 would miss
    // entirely, leaving the 'full' branch below unexercised.
    let sawCompact = false
    let sawFull = false
    for (let w = 1; w <= 600; w += 1) {
      const fit = studioToolbarFit(w)
      if (fit.beta === 'compact') sawCompact = true
      if (fit.beta === 'full') { expect(sawCompact).toBe(true); sawFull = true }
    }
    // Neither branch above is vacuously true — both states are genuinely reached in this range.
    expect(sawCompact).toBe(true)
    expect(sawFull).toBe(true)
  })

  test('monotonic: nothing that is shown at a narrower width is ever hidden at a wider one', () => {
    let prev = studioToolbarFit(1)
    for (let w = 2; w <= 600; w += 1) {
      const fit = studioToolbarFit(w)
      if (prev.showSearch) expect(fit.showSearch).toBe(true)
      if (prev.showNewFile) expect(fit.showNewFile).toBe(true)
      if (prev.showNewFolder) expect(fit.showNewFolder).toBe(true)
      if (prev.showWorking) expect(fit.showWorking).toBe(true)
      if (prev.treeLabels) expect(fit.treeLabels).toBe(true)
      if (prev.beta === 'compact') expect(fit.beta !== 'hidden').toBe(true)
      if (prev.beta === 'full') expect(fit.beta).toBe('full')
      prev = fit
    }
  })

  test('a very wide toolbar (1440px worth of room) reaches the widest state exactly like unmeasured', () => {
    expect(studioToolbarFit(1200)).toEqual(studioToolbarFit(0))
  })

  /**
   * MEASURED AGAINST THE REAL DOM (owner follow-up, live check 2026-09-20): a clone of the exact
   * `BarButton`/`PanelFixedControls`/`BetaTag` markup, same font/padding/border, gave the widths
   * `studioToolbarFit`'s own constants are now built from. This block pins the resulting thresholds
   * so a future edit to those constants cannot drift back into a guess without a test noticing.
   *
   * EVERY WIDTH BELOW IS A CONTENT-BOX NUMBER, NOT A VIEWPORT/COLUMN ONE — a second thing the live
   * check caught, at the true `TREE_MIN` (150px) itself: a debug probe echoing the exact number this
   * function receives read `134`, sixteen less than the tree column's own `150`. `useElementWidth`
   * measures the FIRST frame with `getBoundingClientRect()` (border box) but every frame after a
   * resize with `ResizeObserver`'s `contentRect` (content box, this row's own 16px of padding already
   * subtracted) — and every width this function is ever asked about in practice has been through a
   * resize by the time a reader can act on it. So "the mobile viewport that surfaced this bug" is
   * 390px of BORDER box and 374px of the CONTENT box `studioToolbarFit` actually receives — the
   * numbers below are that 374, not 390, with the conversion stated at each one.
   */
  test('MEASURED: at the mobile viewport that surfaced this bug live (390px border box, 374px of '
    + 'content box once `useElementWidth` has been through a resize), all three tree actions show as '
    + 'ICONS — labels genuinely do not fit there (465px of content box needed; the first, guessed '
    + 'version of this function claimed 390px was enough and pushed the fixed trio to x≈417, clipped '
    + 'off a 390px-wide screen and unreachable by touch)', () => {
    const fit = studioToolbarFit(390 - 16)
    expect(fit.showSearch).toBe(true)
    expect(fit.showNewFile).toBe(true)
    expect(fit.showNewFolder).toBe(true)
    expect(fit.treeLabels).toBe(false)
  })

  test('MEASURED: at the true TREE_MIN (150px border box, 134px of content box), the row has room for '
    + 'Search alone — the bug a live check at exactly this width caught: the first attempt at this fix '
    + 'reserved the 16px of row padding a SECOND time on top of the already-padding-exclusive content '
    + 'box, requiring 138px of content box for Search when the row only ever needed 122, and hid '
    + 'Search outright at the one width this whole feature exists to keep usable at', () => {
    const fit = studioToolbarFit(150 - 16)
    expect(fit.showSearch).toBe(true)
    expect(fit.showNewFile).toBe(false)
  })

  test('MEASURED: the exact threshold width of every step — one pixel under never shows it, that '
    + 'pixel and beyond always does (content-box widths throughout — see this block\'s own header)', () => {
    // The floor: 94px fixed trio, nothing else shown below it.
    expect(studioToolbarFit(93).showSearch).toBe(false)
    // Search: +6px row gap +22px icon.
    expect(studioToolbarFit(121).showSearch).toBe(false)
    expect(studioToolbarFit(122)).toMatchObject({ showSearch: true, showNewFile: false })
    // New file: another +6 +22.
    expect(studioToolbarFit(149).showNewFile).toBe(false)
    expect(studioToolbarFit(150)).toMatchObject({ showNewFile: true, showNewFolder: false })
    // New folder: another +6 +22.
    expect(studioToolbarFit(177).showNewFolder).toBe(false)
    expect(studioToolbarFit(178)).toMatchObject({ showNewFolder: true, showWorking: false })
    // The working dot: +8px INNER gap (not the row's 6px — it lives inside the trailing span) +7px.
    expect(studioToolbarFit(192).showWorking).toBe(false)
    expect(studioToolbarFit(193)).toMatchObject({ showWorking: true, beta: 'hidden' })
    // The compact BETA dot: +8px inner gap +5px.
    expect(studioToolbarFit(205).beta).toBe('hidden')
    expect(studioToolbarFit(206)).toMatchObject({ beta: 'compact', treeLabels: false })
    // Labels on all three tree actions at once: +65 (Search) +103 (New file) +91 (New folder) — no
    // new gap, since these widen buttons already on the row rather than adding new ones.
    expect(studioToolbarFit(464).treeLabels).toBe(false)
    expect(studioToolbarFit(465)).toMatchObject({ treeLabels: true, beta: 'compact' })
    // The full "BETA" word: +32px over the compact dot, again no new gap.
    expect(studioToolbarFit(496).beta).toBe('compact')
    expect(studioToolbarFit(497).beta).toBe('full')
  })
})

describe('NewFileRow', () => {
  const row = (
    state: { name: string; busy: boolean; error: string | null },
    lang: 'pt' | 'en' = 'en',
    extra: { parentPath?: string; kind?: 'file' | 'dir' } = {},
  ) =>
    renderToStaticMarkup(
      <NewFileRow
        state={{ parentPath: extra.parentPath ?? '', kind: extra.kind ?? 'file', ...state }}
        isMobile={env.window!.innerWidth < 768}
        lang={lang}
        onChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )

  test('the question is asked INSIDE the panel, with a labelled field', () => {
    expect(row({ name: '', busy: false, error: null })).toContain('aria-label="New file name"')
  })

  test('the server’s own refusal is shown verbatim, beside the name that caused it', () => {
    const html = row({ name: 'a.ts', busy: false, error: 'Já existe algo nesse caminho.' })
    expect(html).toContain('Já existe algo nesse caminho.')
    expect(html).toContain('value="a.ts"')
  })

  test('a busy row disables its own field rather than accepting a second name', () => {
    expect(row({ name: 'a.ts', busy: true, error: null })).toContain('disabled=""')
  })

  test('at 390px the field is 16px, or iOS Safari zooms the whole workspace', () => {
    phone()
    expect(row({ name: '', busy: false, error: null })).toContain('font-size:16px')
  })
})

// --- the watermark ----------------------------------------------------------------------------------

describe('the watermark', () => {
  test('it is decoration: hidden from assistive technology and untouchable by a pointer', () => {
    const html = renderToStaticMarkup(<Watermark />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('pointer-events:none')
  })

  test('ONE asset, painted through a mask in the theme’s own colour', () => {
    const html = renderToStaticMarkup(<Watermark />)
    expect(html).toContain('mask-image:url(/markMask.png)')
    expect(html).toContain('background-color:currentColor')
    expect(html).toContain('color:var(--text-primary)')
  })

  test('it carries no text of its own — the empty-state sentence is the one thing to read', () => {
    expect(renderToStaticMarkup(<Watermark />).replace(/<[^>]*>/g, '').trim()).toBe('')
  })

  test('the light theme takes its own, lower opacity; everything else is the dark one', () => {
    expect(watermarkOpacity('light')).toBe(0.065)
    expect(watermarkOpacity('dark')).toBe(0.085)
    // No attribute at all is this app's DEFAULT, and the default is dark.
    expect(watermarkOpacity(null)).toBe(0.085)
  })
})

// --- the composition itself --------------------------------------------------------------------------

describe('Studio', () => {
  const render = (turns: LiveTurn[] = [], lang: 'pt' | 'en' = 'en') => renderToStaticMarkup(
    <Studio
      sessionId="s1" lang={lang} autosave={false} turns={turns} onExit={() => {}}
      slot="right" placement="rail" onMove={() => {}}
    />,
  )

  test('before the root listing arrives it SAYS it is reading — the tree draws nothing there', () => {
    // `RepoTreeView` deliberately returns null while the root has never been read, because the
    // parent owns that fetch. This is the parent owning the sentence that goes with it.
    expect(render()).toContain('Reading this session’s files…')
  })

  test('and in Portuguese', () => {
    expect(render([], 'pt')).toContain('Lendo os arquivos desta sessão…')
  })

  test('with nothing open there is no strip to read', () => {
    expect(render()).not.toContain('Open files')
  })

  test('BOTH layers are mounted from the first frame — one of them merely hidden', () => {
    // The regression this pins cost a real unsaved buffer: rendering the tree OR the stack made
    // "back to the tree" unmount every open editor. Two layers, one shown.
    const html = render()
    expect(html).toContain('data-layer-shown="true"')
    expect(html).toContain('data-layer-shown="false"')
  })

  test('the toolbar is there from the first frame — search and new never wait on a listing', () => {
    const html = render()
    expect(html).toContain('Search')
    expect(html).toContain('New')
  })
})

/**
 * THE GEAR MENU (§2) — everything `StudioBar`'s own always-on row used to carry (the exit, the tree
 * toggle, the flip-side control), now as ROWS of one popover reached from a gear icon on the
 * Buscar/Novo arquivo/Nova pasta row. Full screen is NO LONGER one of these rows (2026-09-19) — it
 * is `PanelFixedControls`' own fixed button now, tested separately in `bandControls.test.tsx`.
 * `studioGearEntries` decides WHAT is offered and what each row SAYS — pure, so it is testable as
 * DATA without a DOM (this package has none, and a popover's own rows render only once OPENED,
 * which `renderToStaticMarkup` cannot do at all).
 */
describe('studioGearEntries — the gear menu\'s own rows, as data', () => {
  const base = {
    lang: 'en' as const, treeCollapsible: false, treeCollapsed: false, treeSide: 'left' as const,
    // The Studio's own REAL placement (`lib/panelSlots.ts`'s `OpenPlacement`) — never folded for a
    // phone's viewport the way the old `slot` param this replaced could be (rail-loose-ends, item
    // 4). `'rail'` is the desktop-right-slot reading the old `slot: 'right'` base used to mean.
    placement: 'rail' as const,
  }

  test('with nothing else offered, the Studio still always offers close — MOVE is gone from here (addendum, 2026-09-21), it lives on the icon\'s own right-click menu now', () => {
    expect(studioGearEntries(base)).toEqual([
      { id: 'close', label: 'Close Studio', iconId: 'x' },
    ])
  })

  test('at the bottom, still just close — no move row either way any more', () => {
    const ids = studioGearEntries({ ...base, placement: 'bottom' }).map(e => e.id)
    expect(ids).toEqual(['close'])
  })

  test('and in Portuguese', () => {
    expect(studioGearEntries({ ...base, lang: 'pt' })).toEqual([
      { id: 'close', label: 'Fechar Studio', iconId: 'x' },
    ])
  })

  test('the tree rows are ABSENT with no split — a row that does nothing is worse than none', () => {
    const ids = studioGearEntries(base).map(e => e.id)
    expect(ids).not.toContain('tree-toggle')
    expect(ids).not.toContain('tree-side')
  })

  test('the split offers the toggle, and it SAYS which way it goes', () => {
    const shown = studioGearEntries({ ...base, treeCollapsible: true, treeCollapsed: false })
    expect(shown.find(e => e.id === 'tree-toggle')?.label).toBe('Hide tree')
    const hidden = studioGearEntries({ ...base, treeCollapsible: true, treeCollapsed: true })
    expect(hidden.find(e => e.id === 'tree-toggle')?.label).toBe('Show tree')
  })

  test('and in Portuguese', () => {
    const shown = studioGearEntries({ ...base, lang: 'pt', treeCollapsible: true, treeCollapsed: false })
    expect(shown.find(e => e.id === 'tree-toggle')?.label).toBe('Ocultar árvore')
    const hidden = studioGearEntries({ ...base, lang: 'pt', treeCollapsible: true, treeCollapsed: true })
    expect(hidden.find(e => e.id === 'tree-toggle')?.label).toBe('Mostrar árvore')
  })

  // item 10 — "move side bar right".
  test('the flip-side row says where it would go, from either side', () => {
    const fromLeft = studioGearEntries({ ...base, treeCollapsible: true, treeSide: 'left' })
    expect(fromLeft.find(e => e.id === 'tree-side')?.label).toBe('Move tree to the right')
    const fromRight = studioGearEntries({ ...base, treeCollapsible: true, treeSide: 'right' })
    expect(fromRight.find(e => e.id === 'tree-side')?.label).toBe('Move tree to the left')
  })

  test('and in Portuguese', () => {
    const fromLeft = studioGearEntries({ ...base, lang: 'pt', treeCollapsible: true, treeSide: 'left' })
    expect(fromLeft.find(e => e.id === 'tree-side')?.label).toBe('Mover árvore para a direita')
    const fromRight = studioGearEntries({ ...base, lang: 'pt', treeCollapsible: true, treeSide: 'right' })
    expect(fromRight.find(e => e.id === 'tree-side')?.label).toBe('Mover árvore para a esquerda')
  })

  test('full screen is NEVER one of these rows any more (2026-09-19) — it is a fixed button now', () => {
    const ids = studioGearEntries(base).map(e => e.id)
    expect(ids).not.toContain('fullscreen')
    expect(ids).not.toContain('exit-fullscreen')
  })

  test('every row, in order — tree first (what StudioBar used to carry), close LAST — move is gone', () => {
    const everything = studioGearEntries({
      lang: 'en', treeCollapsible: true, treeCollapsed: false, treeSide: 'left', placement: 'bottom',
    })
    expect(everything.map(e => e.id)).toEqual(['tree-toggle', 'tree-side', 'close'])
  })

  test(
    'ON DESKTOP, MOVE NEVER APPEARS HERE ANY MORE (addendum, 2026-09-21) — in neither placement, ' +
    'since it now lives exclusively on the icon\'s own right-click menu (`PanelRail`/`PanelBar`), ' +
    'never duplicated in the gear the way it once was split across two menus (owner, 2026-09-19: ' +
    '"ao clicar na engrenagem nao aparecem as opcoes corretas de mover")',
    () => {
      const onRail = studioGearEntries({ ...base, placement: 'rail' })
      expect(onRail.find(e => e.id === 'move-bottom')).toBeUndefined()
      expect(onRail.find(e => e.id === 'move-right')).toBeUndefined()
      const atBottom = studioGearEntries({ ...base, placement: 'bottom' })
      expect(atBottom.find(e => e.id === 'move-right')).toBeUndefined()
      expect(atBottom.find(e => e.id === 'move-bottom')).toBeUndefined()
    },
  )

  test(
    'ON MOBILE, MOVE STAYS — there is no rail to right-click and no reliable touch context-menu ' +
    'gesture, and spec §8 already says the gear covers those verbs there. Reproduced live at 390px ' +
    'before this fix: the gear opened with only "Fechar Studio", no way to move it at all.',
    () => {
      const onRail = studioGearEntries({ ...base, placement: 'rail', mobile: true })
      expect(onRail.map(e => e.id)).toEqual(['move-bottom', 'close'])
      const atBottom = studioGearEntries({ ...base, placement: 'bottom', mobile: true })
      expect(atBottom.map(e => e.id)).toEqual(['move-right', 'close'])
    },
  )

  // Pins rail-loose-ends item 4: the label/verb must be driven by the panel's REAL placement, not
  // by a visual occupancy fact a phone's viewport fold can leave stale. Reproduced live: with the
  // Studio's real placement already `'bottom'`, the OLD code (deriving placement from a folded
  // `slot: 'right'`) still offered "Mover Studio para baixo" — this is the exact input shape that
  // bug fed it, asserted directly against the parameter that replaced it.
  test('the label always names where the panel is NOT — even the exact folded-mobile shape that once got this backwards', () => {
    const reallyOnBottom = studioGearEntries({ ...base, placement: 'bottom', mobile: true })
    const moveRow = reallyOnBottom.find(e => e.id === 'move-right' || e.id === 'move-bottom')
    expect(moveRow?.id).toBe('move-right')
    expect(moveRow?.label).toBe('Move Studio to the right')
  })

  // PLANTED-REVERT: a version that ignores `mobile` (always calls `panelMenuEntriesWithoutMove`)
  // silently strands mobile without a move verb again — the exact regression found live.
  test('[planted-revert coverage] ignoring mobile strips move even when it must stay', () => {
    function brokenGearEntries(mobileFlag: boolean) {
      // always strips move, regardless of mobileFlag — the bug this test catches
      void mobileFlag
      return studioGearEntries({ ...base, placement: 'rail', mobile: false })
    }
    const broken = brokenGearEntries(true)
    const correct = studioGearEntries({ ...base, placement: 'rail', mobile: true })
    expect(broken.map(e => e.id)).not.toEqual(correct.map(e => e.id))
    expect(correct.map(e => e.id)).toContain('move-bottom')
  })
})

/**
 * THE GEAR IS THE ONLY CHROME THE STUDIO HAS NOW, and it is reachable from the first frame — the
 * exact guarantee `StudioBar`'s own always-on exit used to carry, moved to the control that OPENS
 * the menu rather than to the menu's own rows (which render only once opened, and which
 * `studioGearEntries` above already covers as data). `onExit` stays a REQUIRED prop on `Studio` —
 * seethis component's own header — precisely because "Close Studio" is one of those rows and must
 * never have nothing behind it.
 */
describe('the Studio draws its gear from the first frame', () => {
  const render = (lang: 'pt' | 'en' = 'en') => renderToStaticMarkup(
    <Studio
      sessionId="s1" lang={lang} autosave={false} turns={[]} onExit={() => {}}
      slot="right" placement="rail" onMove={() => {}}
    />,
  )

  test('before any listing has arrived, the gear trigger is already on screen', () => {
    // The root listing is a fetch and `useEffect` never runs here, so this is the panel at its
    // emptiest — the moment a missing way-in to the exit would strand somebody.
    expect(render()).toContain('aria-haspopup="menu"')
    expect(render()).toContain('aria-label="Studio options"')
    expect(render('pt')).toContain('aria-label="Opções do Studio"')
  })

  test('the old unconditional exit row is gone — Search/New/the gear share ONE row now', () => {
    const html = render()
    expect(html).not.toContain('aria-label="Close Studio"')
    expect(html).toContain('Search')
  })
})

// --- the split: the tree stays beside the editor ----------------------------------------------------

/**
 * THE ASK, AND THE THREE THINGS THAT COULD GO WRONG WITH IT.
 *
 * "quando um arquivo for aberto tenhamos uma barra aqui redimensionavel e minimizavel que ainda
 * mostra a arvore de arquivos pra eu poder continuar navegando" — so a file open on a wide enough
 * panel puts the tree in a column beside the editor.
 *
 * What is worth pinning is not that it renders. It is (1) that the column can never be dragged to
 * something useless in either direction, (2) that a panel with no room for both says so by falling
 * back to the stacked arrangement rather than shipping two unusable halves, and (3) that NOTHING
 * about the arrangement touches what is mounted — the one rule this whole composition exists to
 * keep. A `renderToStaticMarkup` run cannot click a divider, which is exactly why the clamp and the
 * layout are exported functions and `StudioBody` takes its state as props.
 */
describe('studioLayout — whether there is a split at all', () => {
  const at = (isMobile: boolean, fileOpen: boolean, available: number) =>
    studioLayout({ isMobile, fileOpen, available })

  test('a file open on a wide panel is the split — the whole point of the change', () => {
    expect(at(false, true, 620)).toBe('split')
  })

  test('a PHONE is never split: a tree and an editor sharing 390px is two things doing neither job', () => {
    expect(at(true, true, 390)).toBe('layers')
    // And it stays stacked however wide the viewport claims to be — the switch is the breakpoint.
    expect(at(true, true, 1400)).toBe('layers')
  })

  test('nothing open is stacked, so the tree keeps the whole panel', () => {
    expect(at(false, false, 620)).toBe('layers')
  })

  test('a panel too narrow for both minima degrades rather than halving them', () => {
    // The aside is itself draggable down to 280px, so this is an ordinary Tuesday.
    expect(at(false, true, SPLIT_MIN - 1)).toBe('layers')
    expect(at(false, true, SPLIT_MIN)).toBe('split')
    expect(SPLIT_MIN).toBe(TREE_MIN + DIVIDER_W + EDITOR_MIN)
  })

  test('UNMEASURED answers split, because the common panel holds one', () => {
    // The first render, before the ref callback has seen a box. Guessing `layers` here would flash
    // a full-width tree for a frame on every single open.
    expect(at(false, true, 0)).toBe('split')
    expect(at(false, true, Number.NaN)).toBe('split')
    // But `isMobile` still outranks it: a phone is a phone before anything is measured.
    expect(at(true, true, 0)).toBe('layers')
  })
})

/**
 * FIX-WAVE REVIEW, CRITICAL #1 — "with no file open... there is no collapse toggle, no rail,
 * nothing." `treeCollapsible` and `resolveTreeShown` are the fix, extracted so it can be pinned
 * without mounting the whole `Studio` component (which fetches over the network from its first
 * effect — see this file's own header on why the composition's rules are exported functions).
 */
describe('treeCollapsible — whether the minimize toggle has anything to act on', () => {
  test('the split always qualifies — it is what the toggle was built for', () => {
    expect(treeCollapsible(false, true, true)).toBe(true)
  })

  /** Plant: drop the `|| !fileOpen` half. This is the exact regression the review reported —
   *  the toggle silently disappears the moment the last file closes. */
  test('no file open ALSO qualifies, on a desktop — the tree is the only pane there is', () => {
    expect(treeCollapsible(false, false, false)).toBe(true)
  })

  test('a file open on a too-narrow desktop panel does NOT — the editor already replaced the tree', () => {
    expect(treeCollapsible(false, false, true)).toBe(false)
  })

  /** Plant: drop the `!isMobile` guard. A phone would then offer a toggle nothing on screen can act
   *  on, since `studioLayout` never gives it a split and `resolveTreeShown` already ignores
   *  `treeCollapsed` there — see the mobile case below. */
  test('mobile never qualifies, file open or not — there is nothing here for it to act on', () => {
    expect(treeCollapsible(true, false, false)).toBe(false)
    expect(treeCollapsible(true, false, true)).toBe(false)
  })
})

describe('resolveTreeShown — the tree pane, with the fix-wave fix applied', () => {
  test('split: the collapse is the only thing that hides it, exactly as before', () => {
    expect(resolveTreeShown(true, true, false, true)).toBe(true)
    expect(resolveTreeShown(true, true, true, true)).toBe(false)
  })

  test('stacked with a file open: the open file decides, exactly as before item 9 ever existed', () => {
    expect(resolveTreeShown(false, true, false, false)).toBe(false)
    expect(resolveTreeShown(false, true, true, false)).toBe(false)
  })

  /** Plant: replace `!(collapsible && treeCollapsed)` with `true` (ignore the flag entirely). The
   *  tree renders full-size forever with no file open, whatever the reader chose — the ORIGINAL
   *  Critical #1 bug, now caught in isolation instead of only live in a browser. */
  test('stacked with NOTHING open: `treeCollapsed` now reaches in — the fix itself', () => {
    expect(resolveTreeShown(false, false, false, true)).toBe(true)
    expect(resolveTreeShown(false, false, true, true)).toBe(false)
  })

  /** Plant: drop the `collapsible` guard (`!(treeCollapsed)` unconditionally). A phone that once
   *  had `treeCollapsed` set from a desktop session would then render its one pane hidden with
   *  nothing else to show — a blank Studio. */
  test('stacked with nothing open, but NOT collapsible (mobile): the flag is inert', () => {
    expect(resolveTreeShown(false, false, true, false)).toBe(true)
  })
})

/**
 * resolveEditorShown — the companion reading, and the exact fix for the fix-wave report this task
 * shipped: "cliquei pra ocultar a arvore e agora simplesmente se tornou inutil o studio... nao
 * aparece nada". Before this function existed, `editorShown` was `split ? true : fileOpen` — with
 * the tree hidden AND no file open (`resolveTreeShown(false, false, true, true) === false`, asserted
 * above), `fileOpen` is ALSO `false`, so BOTH panes read "not shown": a Studio with nothing on
 * screen and, because the toolbar used to live inside the tree pane's own `Layer`, no control to
 * undo it either.
 */
describe('resolveEditorShown — exactly one of the two panes is shown, never neither', () => {
  test('split: the editor is unconditionally on screen, whatever the tree is doing', () => {
    expect(resolveEditorShown(true, true)).toBe(true)
    expect(resolveEditorShown(true, false)).toBe(true)
  })

  test('stacked, tree shown: the editor stays off — the tree is the one pane there is', () => {
    expect(resolveEditorShown(false, true)).toBe(false)
  })

  /** THE BUG ITSELF: stacked, tree hidden (minimized with nothing open, or a file open — either
   *  way `resolveTreeShown` already answers `false`). The editor pane must pick up the slack, or
   *  this is the "nothing appears" report reproduced by two pure functions instead of a browser.
   *  Plant: `return split` (drop the `|| !treeShown` half) — this assertion alone catches it. */
  test('stacked, tree hidden: the editor takes over — the dead-panel fix', () => {
    expect(resolveEditorShown(false, false)).toBe(true)
  })

  /** The full chain, exactly as `Studio`'s own render computes it: tree collapsed, nothing open. */
  test('end to end with resolveTreeShown: hiding the tree with no file open never leaves neither pane shown', () => {
    const split = false
    const fileOpen = false
    const treeCollapsed = true
    const collapsible = true
    const treeShown = resolveTreeShown(split, fileOpen, treeCollapsed, collapsible)
    const editorShown = resolveEditorShown(split, treeShown)
    expect(treeShown).toBe(false)
    expect(editorShown).toBe(true)
    expect(treeShown || editorShown).toBe(true)
  })
})

describe('searchRequestNeedsExpand — item 8 must never search inside a pane nobody can see', () => {
  /** Plant: invert the return (`!treeCollapsed`). Both assertions below then read backwards. */
  test('a minimized tree needs expanding; an already-visible one needs nothing', () => {
    expect(searchRequestNeedsExpand(true)).toBe(true)
    expect(searchRequestNeedsExpand(false)).toBe(false)
  })
})

describe('clampTreeWidth — the column can never be dragged to something useless', () => {
  test('a width that fits is kept, to the pixel', () => {
    expect(clampTreeWidth(240, 800)).toBe(240)
  })

  test('dragging it to nothing stops at a width a file name still fits in', () => {
    expect(clampTreeWidth(10, 800)).toBe(TREE_MIN)
    expect(clampTreeWidth(-500, 800)).toBe(TREE_MIN)
  })

  test('dragging it over the editor stops where the editor’s own floor begins', () => {
    // 620 - 6 - 220 = 394. Past that the editor is a gutter with two tokens in it.
    expect(clampTreeWidth(9000, 620)).toBe(620 - DIVIDER_W - EDITOR_MIN)
  })

  test('and never past the absolute cap, however much room there is', () => {
    expect(clampTreeWidth(9000, 4000)).toBe(TREE_MAX)
  })

  test('a panel with no room for both still answers the minimum rather than a negative', () => {
    // `studioLayout` has already said `layers` here; the clamp must not produce a nonsense number
    // for the frame in between.
    expect(clampTreeWidth(200, 100)).toBe(TREE_MIN)
  })

  test('unmeasured falls back to the absolute cap, which is the only honest ceiling then', () => {
    expect(clampTreeWidth(9000)).toBe(TREE_MAX)
    expect(clampTreeWidth(9000, 0)).toBe(TREE_MAX)
  })

  test('a fraction lands on a whole pixel, and junk lands on the default', () => {
    expect(clampTreeWidth(240.6, 800)).toBe(241)
    expect(clampTreeWidth(Number.NaN, 800)).toBe(TREE_DEFAULT)
  })
})

describe('resolveTreeWidth — what a stored width may be', () => {
  test('a real stored number is the reader’s answer and is kept', () => {
    expect(resolveTreeWidth('260', 800)).toBe(260)
  })

  test('nothing stored is the default — a first visit, not a zero-width column', () => {
    expect(resolveTreeWidth(null, 800)).toBe(TREE_DEFAULT)
    expect(resolveTreeWidth('', 800)).toBe(TREE_DEFAULT)
    expect(resolveTreeWidth('   ', 800)).toBe(TREE_DEFAULT)
  })

  test('junk, a negative and a zero are all "nobody has said", never a literal width', () => {
    expect(resolveTreeWidth('wide', 800)).toBe(TREE_DEFAULT)
    expect(resolveTreeWidth('-40', 800)).toBe(TREE_DEFAULT)
    expect(resolveTreeWidth('0', 800)).toBe(TREE_DEFAULT)
  })

  test('a width stored on a wide monitor is narrowed by the panel it is reopened in', () => {
    expect(resolveTreeWidth('500', 500)).toBe(500 - DIVIDER_W - EDITOR_MIN)
  })
})

// item 9 — this REVERSES the earlier "collapse is momentary, never stored" decision recorded in
// Studio.tsx: the owner asked for a minimized tree to stay minimized across sessions.
describe('resolveTreeCollapsed — item 9, the minimized state is now remembered', () => {
  test('only the literal "1" reads as collapsed', () => {
    expect(resolveTreeCollapsed('1')).toBe(true)
  })

  test('nothing stored, junk, or a stray "0" all read as NOT collapsed — the safer floor', () => {
    expect(resolveTreeCollapsed(null)).toBe(false)
    expect(resolveTreeCollapsed('')).toBe(false)
    expect(resolveTreeCollapsed('true')).toBe(false)
    expect(resolveTreeCollapsed('0')).toBe(false)
  })
})

describe('resolveTreeSide — item 10, "move side bar right"', () => {
  test('the literal "right" is the only way to the right side', () => {
    expect(resolveTreeSide('right')).toBe('right')
  })

  test('nothing stored, or anything else, reads as "left" — where the tree has always been', () => {
    expect(resolveTreeSide(null)).toBe('left')
    expect(resolveTreeSide('')).toBe('left')
    expect(resolveTreeSide('RIGHT')).toBe('left')
    expect(resolveTreeSide('left')).toBe('left')
  })
})

describe('dividerWantedWidth / dividerKeyDelta — the drag/keyboard direction follows the side (item 10)', () => {
  test('from the left (the ordinary case), dragging right grows the column', () => {
    expect(dividerWantedWidth(200, 40, false)).toBe(240)
    expect(dividerWantedWidth(200, -40, false)).toBe(160)
  })

  test('from the right, the SAME rightward drag now shrinks it — the divider sits on the other side', () => {
    expect(dividerWantedWidth(200, 40, true)).toBe(160)
    expect(dividerWantedWidth(200, -40, true)).toBe(240)
  })

  test('ArrowRight always means "grow the column" — the keyboard ignores `side` entirely', () => {
    expect(dividerKeyDelta('ArrowRight')).toBeGreaterThan(0)
    expect(dividerKeyDelta('ArrowLeft')).toBeLessThan(0)
  })

  test('a key that means nothing to the divider asks for no change', () => {
    expect(dividerKeyDelta('Tab')).toBe(0)
  })
})

describe('StudioBody — where the panes sit, and what that may never cost', () => {
  const body = (over: Partial<Parameters<typeof StudioBody>[0]> = {}) => renderToStaticMarkup(
    <StudioBody
      layout="split" treeWidth={200} treeShown={true} editorShown={true} available={620} lang="en"
      onResize={() => {}} onCommit={() => {}} onCollapse={() => {}}
      tree={<p>THE TREE</p>} editor={<p>THE EDITOR</p>}
      {...over}
    />,
  )

  test('the split puts BOTH on screen — which is the whole of what was asked for', () => {
    const html = body()
    expect(html).toContain('THE TREE')
    expect(html).toContain('THE EDITOR')
    expect(html).toContain('data-studio-layout="split"')
    // Neither is hidden: two shown layers, no hidden one.
    expect(html.match(/data-layer-shown="true"/g)?.length).toBe(2)
    expect(html).not.toContain('data-layer-shown="false"')
  })

  test('the tree column takes its width and the editor takes the rest', () => {
    const html = body({ treeWidth: 240 })
    expect(html).toContain('width:240px')
    expect(html).toContain('flex:1')
  })

  test('stacked, the two panes are absolute over ONE region and exactly one is shown', () => {
    const html = body({ layout: 'layers', treeShown: true, editorShown: false })
    expect(html).toContain('data-studio-layout="layers"')
    // Two panes and the two layers inside them: the HIDDEN layer is absolute too, which is what
    // keeps it measuring — see `Layer`'s own comment on why it may not be `display: none`.
    expect(html.match(/position:absolute/g)?.length).toBe(4)
    // And both panes really are the same rectangle, one over the other.
    expect(html.match(/data-studio-pane="\w+" style="position:absolute;inset:0/g)?.length).toBe(2)
    expect(html.match(/data-layer-shown="true"/g)?.length).toBe(1)
    expect(html.match(/data-layer-shown="false"/g)?.length).toBe(1)
  })

  /**
   * THE TAP HAZARD OF STACKING THEM, PINNED — see `paneHits`.
   *
   * The two boxes are the same rectangle, so whichever comes LAST in the DOM is on top, and the
   * editor is the one that comes last. Its box paints nothing when its layer is hidden and is still
   * a hit target, so on a phone every tap meant for the file tree landed on an invisible editor
   * pane: the tree drew, scrolled, and did nothing. Measured at 390x844 against a live session,
   * `document.elementsFromPoint` over the middle of the `AGENTS.md` row answered
   * `DIV[data-studio-pane=editor] pe=auto op=1 inert=false` ABOVE the row's own button.
   */
  test('stacked, the HIDDEN pane\'s box cannot take a tap — the visible one can', () => {
    const onTree = body({ layout: 'layers', treeShown: true, editorShown: false })
    expect(onTree).toContain('data-studio-pane="tree" style="position:absolute;inset:0"')
    expect(onTree).toContain('data-studio-pane="editor" style="position:absolute;inset:0;pointer-events:none"')
    // And symmetrically, with a file open: the tree is the one that may not be hit. (It comes FIRST
    // in the DOM, so it was never the pane that stole anything — which is exactly why only half of
    // this was ever noticed.)
    const onFile = body({ layout: 'layers', treeShown: false, editorShown: true })
    expect(onFile).toContain('data-studio-pane="tree" style="position:absolute;inset:0;pointer-events:none"')
    expect(onFile).toContain('data-studio-pane="editor" style="position:absolute;inset:0"')
  })

  test('the rule is `paneHits`, and it answers for the box rather than for the layer', () => {
    // A plain ternary, stated once so the two panes cannot disagree. `undefined` rather than `auto`:
    // the box has no reason to re-enable anything its ancestors turned off.
    expect(paneHits(true)).toBeUndefined()
    expect(paneHits(false)).toBe('none')
  })

  /**
   * THE REMOUNT HAZARD, PINNED.
   *
   * A layout that rendered a different TREE per arrangement would remount everything under it the
   * moment the aside crossed `SPLIT_MIN` — which is `RepoFileEditor` re-reading its file and
   * disposing its Monaco model, i.e. the silent loss of typed text this composition exists to make
   * impossible. The same two boxes in the same order, in both arrangements, is what rules that out;
   * only their styles differ.
   */
  test('both arrangements are the SAME two boxes in the same order — nothing can remount', () => {
    const order = (html: string) => html.match(/data-studio-pane="(tree|editor)"/g)
    expect(order(body())).toEqual(['data-studio-pane="tree"', 'data-studio-pane="editor"'])
    expect(order(body({ layout: 'layers', editorShown: false })))
      .toEqual(['data-studio-pane="tree"', 'data-studio-pane="editor"'])
  })

  test('minimizing CLIPS the column and keeps the tree laid out at its full width', () => {
    const html = body({ treeShown: false })
    // The pane goes to zero (React writes a unitless `0` for a zero length)...
    expect(html).toContain('overflow:hidden;width:0"')
    // ...while the sizer inside it still holds 200px, so a long listing keeps its scroll position.
    expect(html).toContain('width:200px')
    // And the tree is HIDDEN, never unmounted: the text is still there, behind an inert layer.
    expect(html).toContain('THE TREE')
    expect(html).toContain('data-layer-shown="false"')
    expect(html).toContain('inert=""')
  })

  test('a minimized column has no separator left to drag — the bar is what brings it back', () => {
    expect(body({ treeShown: false })).not.toContain('role="separator"')
  })

  /**
   * DESIGN ITEM 4, screenshot 3 — "there is a floating aside button when the tree is closed". A
   * `CollapsedTreeRail` used to render here in place of the separator, so a minimized tree had TWO
   * controls back to it on screen at once: this rail AND the Studio bar's own labelled "Mostrar
   * árvore" toggle. The rail is gone outright — `StudioBar`'s toggle (see that component's own
   * tests) is now the ONLY way back, wherever the tree sits and whether or not a file is open.
   *
   * Plant: reintroduce `<CollapsedTreeRail .../>` in the `collapsed` branch (either arrangement) —
   * these assertions then fail on the exact string the old rail rendered.
   */
  test('minimizing leaves no rail behind — no second "show the file tree" control in the pane itself', () => {
    const html = body({ treeShown: false })
    expect(html).not.toContain('aria-label="Show the file tree"')
    expect(html).not.toContain('Show the file tree')
  })

  test('no rail whether or not a file is open — the split case and the no-file-open case alike', () => {
    expect(body({ treeShown: false, editorShown: false })).not.toContain('Show the file tree')
    expect(body({ treeShown: false, editorShown: true })).not.toContain('Show the file tree')
    expect(body({ layout: 'layers', treeShown: false, editorShown: false })).not.toContain('Show the file tree')
  })

  test('an EXPANDED column offers the separator; a minimized one offers neither the separator nor a rail', () => {
    const html = body()
    expect(html).toContain('role="separator"')
    const minimized = body({ treeShown: false })
    expect(minimized).not.toContain('role="separator"')
    expect(minimized).not.toContain('Show the file tree')
  })

  test('stacked, there is no separator either: there is nothing beside anything', () => {
    expect(body({ layout: 'layers', editorShown: false })).not.toContain('role="separator"')
  })

  test('the split offers one', () => {
    expect(body()).toContain('role="separator"')
  })

  test('minimized with no file open renders neither a full-size tree nor a rail — the bar alone is the way back', () => {
    const html = body({ layout: 'layers', treeShown: false, editorShown: false })
    expect(html).not.toContain('role="separator"')
    expect(html).not.toContain('Show the file tree')
  })

  // item 10 — "move side bar right": the SAME two boxes, only their paint order flips.
  describe('side', () => {
    test('defaults to a plain row — the tree paints first, as it always has', () => {
      // The closing quote is what tells "row" apart from "row-reverse", both of which contain "row".
      expect(body()).toContain('flex-direction:row"')
    })

    test('"right" flips ONLY the CSS direction — the DOM order (and so React\'s identity) is untouched', () => {
      const html = body({ side: 'right' })
      expect(html).toContain('flex-direction:row-reverse')
      const order = html.match(/data-studio-pane="(tree|editor)"/g)
      expect(order).toEqual(['data-studio-pane="tree"', 'data-studio-pane="editor"'])
    })

    test('the side rides on the container as data, for anything that needs to ask from outside', () => {
      expect(body()).toContain('data-studio-side="left"')
      expect(body({ side: 'right' })).toContain('data-studio-side="right"')
    })

    test('minimized and flipped: still no rail on either side', () => {
      expect(body({ treeShown: false, side: 'left' })).not.toContain('Show the file tree')
      expect(body({ treeShown: false, side: 'right' })).not.toContain('Show the file tree')
    })
  })
})

describe('TreeDivider — draggable, and reachable without a pointer', () => {
  const div = (lang: 'pt' | 'en' = 'en', available = 620, width = 200) => renderToStaticMarkup(
    <TreeDivider
      width={width} available={available} lang={lang}
      onResize={() => {}} onCommit={() => {}} onCollapse={() => {}}
    />,
  )

  test('it is a separator that takes the keyboard, not a bare div with a cursor on it', () => {
    const html = div()
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('tabindex="0"')
  })

  test('it announces where it is and how far it may go — the REAL maximum, not the cap', () => {
    const html = div('en', 620, 200)
    expect(html).toContain('aria-valuenow="200"')
    expect(html).toContain(`aria-valuemin="${TREE_MIN}"`)
    expect(html).toContain(`aria-valuemax="${620 - DIVIDER_W - EDITOR_MIN}"`)
  })

  test('unmeasured announces the absolute cap, which is the only honest answer then', () => {
    expect(div('en', 0)).toContain(`aria-valuemax="${TREE_MAX}"`)
  })

  test('and it is NAMED, in both languages', () => {
    expect(div('en')).toContain('Resize the file tree')
    expect(div('pt')).toContain('Redimensionar a árvore de arquivos')
  })
})

// `StudioBar`'s own "minimizing the tree, and getting it back" behavioural matrix — no split means
// no toggle, the split offers it and says which way it goes, the toggle reports its own state, in
// both languages — now lives in `studioGearEntries — the gear menu's own rows, as data`, above,
// which covers the SAME matrix (plus the flip-side control, plus full screen) as pure data rather
// than as rendered `StudioBar` markup, since the gear's own rows render only once its popover is
// open and a render-only test cannot open one.

/**
 * THE SCAN, AND WHY IT READS THROUGH `stripComments`.
 *
 * This file's subject is a hiding rule, so the module it scans necessarily contains, in prose, the
 * exact shapes the rule forbids — `display: none` and `visibility` are both NAMED in `Layer`'s own
 * doc comment, at length, because that is where the defect was recorded. A scan that read the
 * comments would fail on the explanation of the thing it is checking, and the positive half would
 * be satisfied by a doc comment sitting above the line that dropped the call. `lib/stripComments.ts`
 * is the one stripper in this package and there is no second one.
 */
describe('the split obeys the hiding rule rather than inventing a second one', () => {
  const RAW = readFileSync(join(import.meta.dir, 'Studio.tsx'), 'utf8')
  const CODE = stripComments(RAW)

  test('the panes hide through `Layer`, never with a rule of their own', () => {
    expect(CODE).toContain('<Layer shown={treeShown}>{tree}</Layer>')
    expect(CODE).toContain('<Layer shown={editorShown}>{editor}</Layer>')
  })

  test('nothing in this module hides with `display: none` or with `visibility`', () => {
    // `display: none` measures zero, and a zero-sized Monaco is the state `automaticLayout` then has
    // to recover from; `visibility` is inherited AND overridable, which shipped once and painted a
    // frozen file tree over the tab the reader had switched to.
    expect(CODE).not.toMatch(/display:\s*'none'/)
    expect(CODE).not.toMatch(/visibility\s*:/)
  })

  test('the scan still sees the defects it exists to catch, and a COMMENT does not satisfy it', () => {
    // Planted: each shape, as real code, is found.
    expect(stripComments("const s = { display: 'none' }")).toMatch(/display:\s*'none'/)
    expect(stripComments("const s = { visibility: shown ? 'visible' : 'hidden' }")).toMatch(/visibility\s*:/)
    // And the positive half is NOT satisfied by prose above the line, nor by a trailing comment —
    // the two forms that have shipped green in this package.
    expect(stripComments('/** <Layer shown={treeShown}>{tree}</Layer> */'))
      .not.toContain('<Layer shown={treeShown}>')
    expect(stripComments('const x = 1 // <Layer shown={treeShown}>{tree}</Layer>'))
      .not.toContain('<Layer shown={treeShown}>')
    // ...while the real line survives the stripper untouched.
    expect(stripComments('  <Layer shown={treeShown}>{tree}</Layer>\n'))
      .toContain('<Layer shown={treeShown}>{tree}</Layer>')
  })
})

/**
 * THE DESKTOP TOOLBAR IS A SIBLING OF `StudioBody`, NEVER A CHILD OF THE TREE PANE — fix-wave
 * review, Critical #1 and its layout sibling ("tudo empilhado em cima da tree, deveriam ficar a
 * direita"). Before this fix `<Toolbar` (carrying `fixedControls` — full screen/minimize/gear,
 * including the "Mostrar árvore" row) was rendered INSIDE the `tree` prop passed to `StudioBody`,
 * gated on `view === 'tree'`: mounted inside `<Layer shown={treeShown}>`, so minimizing the tree
 * made the ONE control that could undo it `inert` along with the pane it was meant to reopen — the
 * dead panel — and, in the split, confined to the narrow tree COLUMN rather than the row spanning
 * the whole Studio, so its trailing controls sat pinned to a 150–500px sliver's own right edge
 * instead of the panel's.
 *
 * Not reachable by rendering `<Studio>` itself (it fetches over the network from its first effect,
 * which is exactly why no test in this file mounts it — see this file's own header), so the shape
 * is what is asserted, over comment-free source, the same approach the hiding-rule scan just above
 * already takes for this identical file.
 */
describe('the desktop toolbar is hoisted above StudioBody, not inside the tree pane', () => {
  const RAW = readFileSync(join(import.meta.dir, 'Studio.tsx'), 'utf8')
  const CODE = stripComments(RAW)

  test('`Studio` computes `editorShown` through `resolveEditorShown`, never the old `fileOpen`-only formula', () => {
    expect(CODE).toContain('const editorShown = resolveEditorShown(split, treeShown)')
    expect(CODE).not.toMatch(/const editorShown = split \? true : fileOpen/)
  })

  test('a desktop `<Toolbar` call precedes `<StudioBody`, gated on `!isMobile` alone — not on `view`', () => {
    const desktopGateAt = CODE.indexOf('{!isMobile && (\n        <Toolbar')
    const studioBodyAt = CODE.indexOf('<StudioBody')
    expect(desktopGateAt).toBeGreaterThan(-1)
    expect(studioBodyAt).toBeGreaterThan(-1)
    expect(desktopGateAt).toBeLessThan(studioBodyAt)
  })

  test('that hoisted call carries `fixedControls` — the gear, and "Mostrar árvore" inside it', () => {
    const desktopGateAt = CODE.indexOf('{!isMobile && (\n        <Toolbar')
    const studioBodyAt = CODE.indexOf('<StudioBody')
    const hoisted = CODE.slice(desktopGateAt, studioBodyAt)
    expect(hoisted).toContain('{fixedControls}')
  })

  test('the ONLY `<Toolbar` left inside the `tree` prop is mobile-only', () => {
    const treePropAt = CODE.indexOf('tree={<>')
    const editorPropAt = CODE.indexOf('editor={')
    expect(treePropAt).toBeGreaterThan(-1)
    expect(editorPropAt).toBeGreaterThan(treePropAt)
    const treeProp = CODE.slice(treePropAt, editorPropAt)
    expect(treeProp.match(/<Toolbar/g)?.length).toBe(1)
    expect(treeProp).toContain('{isMobile && view === \'tree\' && (')
  })

  test('mounted.length === 0 draws the empty state INSIDE the editor pane, not a blank region', () => {
    const editorPropAt = CODE.indexOf('editor={')
    expect(editorPropAt).toBeGreaterThan(-1)
    expect(CODE.slice(editorPropAt)).toContain('mounted.length === 0')
    expect(CODE.slice(editorPropAt)).toContain('<StudioEditorEmptyState')
  })

  /** Plant: the ORIGINAL shape — `<Toolbar` back inside `tree={<>`, gated on `view === 'tree'` with
   *  no `isMobile` split at all. The first assertion above (desktop call precedes `StudioBody`)
   *  would then find NO desktop-gated call at all (`indexOf` returns `-1`), which is exactly the
   *  dead-panel bug: nothing to hoist means nothing reachable once the tree pane goes `inert`. */
  test('the scan still catches the original bug if it comes back', () => {
    const reverted = stripComments([
      'function Studio() {',
      '  return (',
      '    <StudioBody',
      '      tree={<>',
      '        {view === \'tree\' && (',
      '          <Toolbar trailing={<>{fixedControls}</>} />',
      '        )}',
      '      </>}',
      '      editor={<EditorStack />}',
      '    />',
      '  )',
      '}',
    ].join('\n'))
    expect(reverted.indexOf('{!isMobile && (\n        <Toolbar')).toBe(-1)
  })
})
