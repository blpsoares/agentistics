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
  agentActivity, closeOutcome, EditorStack, Layer, mountedEditors, NewFileRow, Studio, StudioBar,
  sameFile, TabStrip, Toolbar, Watermark, watermarkOpacity,
} from './Studio'
import type { OpenTab } from '../../lib/repoTreeModel'
import type { LiveEvent, LiveTurn } from '../../lib/artifactTabs'

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
  return { path, dirty }
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
})

// --- the toolbar and the new-file row ---------------------------------------------------------------

describe('Toolbar', () => {
  const bar = (working: boolean) => renderToStaticMarkup(
    <Toolbar working={working} isMobile={false} lang="en" onSearch={() => {}} onNew={() => {}} />,
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

describe('NewFileRow', () => {
  const row = (state: { name: string; busy: boolean; error: string | null }, lang: 'pt' | 'en' = 'en') =>
    renderToStaticMarkup(
      <NewFileRow
        state={state}
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
    <Studio sessionId="s1" lang={lang} autosave={false} turns={turns} onExit={() => {}} />,
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
 * THE EXIT. The Studio covers the aside's header and its tab strip, so this bar is the only way out
 * of it — and a way out that can be absent is a reader trapped in a panel. `onExit` is therefore a
 * REQUIRED prop (the type carries that) and the bar is drawn unconditionally (these tests carry
 * that): neither half is enough on its own, because a required callback nobody renders a control for
 * is exactly the shape this guards against.
 */
describe('StudioBar — the only chrome the Studio has', () => {
  const bar = (lang: 'pt' | 'en', isMobile = false) => renderToStaticMarkup(
    <StudioBar isMobile={isMobile} lang={lang} onExit={() => {}} />,
  )

  test('the way back NAMES where it goes, in both languages', () => {
    // Not a bare arrow: `ArrowLeft` already means "back to the tree" on the strip below, and the
    // word is the heading the reader actually lands on.
    expect(bar('en')).toContain('Contents')
    expect(bar('pt')).toContain('Conteúdo')
  })

  test('it is a BUTTON with an accessible name, not a decorated glyph', () => {
    expect(bar('en')).toContain('aria-label="Leave the Studio and go back to Contents"')
    expect(bar('pt')).toContain('Sair do Studio e voltar para Conteúdo')
  })

  test('the product names itself, and carries the beta caveat', () => {
    const html = bar('en')
    expect(html).toContain('Agentistics Studio')
    expect(html).toContain('>beta<')
  })

  test('mobile keeps the short name and takes the 44px target; desktop does NOT', () => {
    // 44px is the mobile figure. On desktop this bar sits above a tab strip and must stay thin.
    expect(bar('en', true)).toContain('min-height:44px')
    expect(bar('en', true)).not.toContain('Agentistics Studio')
    expect(bar('en', false)).not.toContain('min-height:44px')
    expect(bar('en', false)).toContain('min-height:30px')
  })
})

describe('the Studio draws its exit from the first frame', () => {
  const render = (lang: 'pt' | 'en' = 'en') => renderToStaticMarkup(
    <Studio sessionId="s1" lang={lang} autosave={false} turns={[]} onExit={() => {}} />,
  )

  test('before any listing has arrived, the way out is already on screen', () => {
    // The root listing is a fetch and `useEffect` never runs here, so this is the panel at its
    // emptiest — the moment a missing exit would strand somebody.
    expect(render()).toContain('Leave the Studio and go back to Contents')
    expect(render('pt')).toContain('Sair do Studio e voltar para Conteúdo')
  })
})
