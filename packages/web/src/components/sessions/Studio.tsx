/**
 * Studio — Agentistics Studio's own root: the tree, the search and a multi-tab Monaco editor, as
 * LAYERS over one panel rather than a split.
 *
 * IT IS A MODE, NOT A TAB, and that is the one thing to understand before changing anything here.
 * It began as one tab among the aside's fourteen, under the aside's own "Contents" header and its
 * tab strip — two rows of chrome above a file tree and a code editor, in a column 440px wide. A
 * tree plus an editor cannot share vertical space with that, so opening the Studio now REPLACES the
 * aside's chrome: `ArtifactsAside` renders this component as a `Layer` at its own root, over the
 * header and the strip, at the full size of the aside. The way back is this component's OWN top
 * edge (`onExit`), which is the only chrome there is here — and it is a required prop rather than an
 * optional one, because an exit that can be forgotten is a reader trapped in a panel.
 *
 * The name is the PRODUCT's, deliberately: Agentistics Studio, the studio of this product. It is
 * not "agent studio", which reads as a studio for building agents and is a different thing. The
 * modules under it keep their repository names (`repoApi`, `repoTreeModel`, `RepoTreeView`,
 * `RepoFileEditor`, …): those describe what they read, which really is a repository.
 *
 * Opening a file REPLACES the tree with the editor; a back control returns to it, and the
 * open-files strip stays on screen either way — a tab you cannot see is a buffer you cannot get
 * back to.
 *
 * SWITCHING TABS MAY NEVER DESTROY WHAT WAS TYPED, and that is the one rule this composition
 * exists to keep. `RepoFileEditor` re-reads its file on mount and disposes its Monaco model on
 * unmount, so a composition that mounted only the ACTIVE file would lose three lines of unsaved
 * work to an ordinary click on the tab beside it — a loss far more likely than the conflict the
 * editor's whole save machine is built around, in a feature whose headline promise is that nothing
 * is lost silently. So the editor is kept MOUNTED per open tab (`mountedEditors`), hidden rather
 * than unmounted, which is the cheapest correct answer of the three available: it preserves the
 * text, the dirty flag, the undo history, the scroll position and the cursor, and it needs no
 * change to the editor at all.
 *
 * THE SAME RULE HOLDS ONE LEVEL UP, and it was learned the hard way: the tree and the editor stack
 * are BOTH mounted, one of them hidden (`Layer`). Rendering one OR the other made "back to the
 * tree" — a control that promises to change nothing — destroy the very buffer the paragraph above
 * protects. Caught by running it, not by reading it.
 *
 * AND IT HOLDS A THIRD TIME, ONE LEVEL FURTHER OUT: LEAVING the Studio must not unmount it either.
 * `ArtifactsAside` keeps this component mounted and hidden behind the same `Layer` while the normal
 * aside is showing, so `onExit` is a control that changes what is on screen and nothing else. That
 * is why the exit is a plain callback and never an unmount.
 *
 * It is bounded rather than unbounded: the mounted set is the ACTIVE file plus every file with
 * UNSAVED changes. A clean background tab is unmounted, because re-reading it from the server
 * yields the same bytes and costs one request — there is nothing to lose. So the number of live
 * Monaco instances is "files you have actually edited and not saved", plus one.
 *
 * AUTOSAVE STAYS ON FOR A HIDDEN TAB, and the trade is stated rather than left to be discovered.
 * A background buffer that quietly stopped saving itself under an autosave switch the reader turned
 * ON is the same half-promise this feature refuses everywhere else; the cost is that a CONFLICT
 * raised on a hidden tab opens its question where nobody can see it. Nothing is lost by that — the
 * tab keeps its unsaved dot, the buffer is intact, and the question is there, answerable, the moment
 * the tab is selected again.
 *
 * A LIVE-AGENT BADGE reuses the SAME `turns` feed the Live tab already polls — no new polling loop,
 * per the design spec. The general badge is "the session's most recent live events are still
 * pending"; the STRONGER, file-specific one additionally matches a WRITE among those pending events
 * against the file on screen. It reads `LiveEvent.text`, which is the path, and never `ref`, which
 * is the harness's `tool_use` id: the plan's own draft compared `ref` against the open path, and
 * that badge could never have lit.
 *
 * A STATED LIMIT: the open files belong to ONE session. Selecting a different session resets this
 * panel — the tree, the strip and every buffer with it. There is nowhere to keep them (the panel's
 * whole state is per session) and no honest way to ask, since the switch has already happened
 * elsewhere; the buffer that can be lost that way is one nothing else in this aside survives either.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Check, ChevronLeft, FilePlus, Loader, Plus, Search, X } from 'lucide-react'
import {
  applyChildren, applyError, closeTab, makeRootNode, markDirty, openTab,
  type OpenTab, type TreeNode,
} from '../../lib/repoTreeModel'
import { createRepoEntry, fetchTree, type RepoLang } from '../../lib/repoApi'
import { repoFailureText } from '../../lib/repoErrorText'
import { liveEvents, type LiveEvent, type LiveTurn } from '../../lib/artifactTabs'
import { useIsMobile } from '../../hooks/useIsMobile'
import { ConfirmModal } from '../../pages/settings/primitives'
import { BetaTag } from '../BetaTag'
import { RepoFileEditor } from './RepoFileEditor'
import { RepoSearchView } from './RepoSearchView'
import { RepoTreeView, treeViewState } from './RepoTreeView'
import { RepoNote } from './repoNote'

export interface StudioProps {
  sessionId: string
  lang: 'pt' | 'en'
  /** The user's own autosave preference; see `Preferences.editorAutosave`. */
  autosave: boolean
  /** The Live tab's own feed, passed in rather than polled again. */
  turns: readonly LiveTurn[]
  /**
   * Leave the Studio and put the normal aside back.
   *
   * REQUIRED, and the whole reason is in the header: this component covers the aside's own header
   * and tab strip, so its top edge is the only chrome a reader has. An optional exit is an exit
   * somebody forgets to pass, and the result is a panel with no way out of it.
   *
   * It may never unmount this component — see the third paragraph of the header. A callback is what
   * makes that possible: the parent flips which layer is SHOWN and keeps both mounted.
   */
  onExit: () => void
}

/** Which layer the panel is showing while no file is open. */
type View = 'tree' | 'search'

/** Where an editor should jump on open — set by a CONTENT search hit, which names a line. */
interface GoTo { path: string; line: number }

/** The "new file" row: what has been typed, whether a request is out, and the last refusal. */
interface Creating { name: string; busy: boolean; error: string | null }

// --- the rules, as functions ---------------------------------------------------------------------
//
// Each of these is the part of this component that can be WRONG, so each is a pure function this
// repo can actually test: there is no jsdom and no `@testing-library/react` here (see
// `ConnectionCard.test.tsx`'s own note), so a click is not something a test can perform.

/**
 * WHICH FILES KEEP A LIVE EDITOR — the invariant at the top of this file, as one expression.
 *
 * The active file, plus every file with unsaved changes. Nothing else: a clean buffer holds nothing
 * the server cannot hand back, so unmounting it costs a request and loses nothing, while a dirty one
 * holds text that exists in exactly one place in the world.
 *
 * The order is the STRIP's order, so the editors are mounted in the order their tabs are drawn and a
 * re-render cannot reshuffle them.
 */
export function mountedEditors(tabs: readonly OpenTab[], activePath: string | null): string[] {
  const out = tabs.filter(t => t.dirty || t.path === activePath).map(t => t.path)
  // An active path the strip does not carry cannot happen through any path in this file; it is
  // admitted anyway, because the alternative is an active tab with no editor under it.
  if (activePath !== null && !out.includes(activePath)) out.push(activePath)
  return out
}

/**
 * Closing one tab: what is left, and which file is then on screen.
 *
 * Closing a BACKGROUND tab never moves the reader — the file they are looking at is not the one
 * they closed. Closing the ACTIVE one lands on the tab that slid into its place (the one to its
 * right), and on the last tab when it was the rightmost, which is what every editor does and what
 * keeps a run of closes moving in one direction. An empty strip returns to the tree.
 */
export function closeOutcome(
  tabs: readonly OpenTab[], activePath: string | null, path: string,
): { tabs: OpenTab[]; activePath: string | null } {
  const index = tabs.findIndex(t => t.path === path)
  const rest = closeTab(tabs, path)
  if (activePath !== path) return { tabs: rest, activePath }
  if (rest.length === 0) return { tabs: rest, activePath: null }
  const pick = Math.min(Math.max(index, 0), rest.length - 1)
  return { tabs: rest, activePath: rest[pick]!.path }
}

/**
 * Is the event's path the file on screen?
 *
 * The feed carries whatever path the harness wrote — usually absolute — while a tab is named
 * relative to the session's own folder, so the test is a SEGMENT-aligned suffix. `'/' + open` is
 * what makes it segment-aligned: a bare `endsWith` would match `bar.ts` against `foobar.ts`. A
 * truncated path (the feed caps a line at 160 characters) simply fails to match, which is the right
 * direction to be wrong in — the badge claims nothing rather than claiming the wrong file.
 */
export function sameFile(eventPath: string, openPath: string): boolean {
  return eventPath === openPath || eventPath.endsWith(`/${openPath}`)
}

export interface AgentActivity {
  /** The session's most recent events are still pending — the agent is doing something now. */
  working: boolean
  /** One of those pending events WROTE the file currently on screen. */
  here: boolean
}

/**
 * What the agent is doing, from the feed the Live tab already has.
 *
 * The pending TAIL rather than the single last event: one pending turn can carry several calls, so
 * a write to the open file followed by a shell command would otherwise read as "working, but not
 * here" a moment after it edited the very file being read.
 */
export function agentActivity(events: readonly LiveEvent[], openPath: string | null): AgentActivity {
  let start = events.length
  while (start > 0 && events[start - 1]!.live) start -= 1
  const tail = events.slice(start)
  return {
    working: tail.length > 0,
    here: openPath !== null
      && tail.some(e => e.kind === 'wrote' && sameFile(e.text, openPath)),
  }
}

/**
 * The watermark's opacity, per theme.
 *
 * TWO VALUES, because one does not serve both: the mark is painted in the theme's own text colour,
 * and a near-white line on `#16161f` reads at a strength a near-black line on `#ffffff` does not.
 * Measured against both backgrounds before choosing (see this task's report) — the light theme takes
 * the lower number, since the panel's own text sits on top of it there at full contrast.
 */
export const WATERMARK_OPACITY = { dark: 0.085, light: 0.065 }

export function watermarkOpacity(theme: string | null): number {
  return theme === 'light' ? WATERMARK_OPACITY.light : WATERMARK_OPACITY.dark
}

// --- the component -------------------------------------------------------------------------------

export function Studio({ sessionId, lang, autosave, turns, onExit }: StudioProps) {
  const isMobile = useIsMobile()
  const pt = lang === 'pt'
  const [tree, setTree] = useState<TreeNode>(makeRootNode())
  const [view, setView] = useState<View>('tree')
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [goTo, setGoTo] = useState<GoTo | null>(null)
  const [pendingClose, setPendingClose] = useState<string | null>(null)
  const [creating, setCreating] = useState<Creating | null>(null)

  /**
   * The root loads exactly like any other node — through `applyChildren`, and a failure through
   * `applyError`, so the root cannot drift out of the rules the rest of the tree follows and
   * `RepoTreeView` draws the failure with its own sentence rather than this file inventing a second
   * error surface.
   *
   * A SESSION CHANGE RESETS EVERYTHING, strip included: those tabs name files under the previous
   * session's folder, and leaving them would have the editor read a path against the wrong root.
   */
  useEffect(() => {
    let cancelled = false
    setTree(makeRootNode())
    setTabs([])
    setActivePath(null)
    setGoTo(null)
    setPendingClose(null)
    setCreating(null)
    setView('tree')
    void fetchTree(sessionId, '', lang as RepoLang).then(res => {
      if (cancelled) return
      if (res.ok) setTree(prev => applyChildren(prev, '', res.children))
      else setTree(prev => applyError(prev, '', repoFailureText(res, lang as RepoLang)))
    })
    return () => { cancelled = true }
    // `lang` is deliberately absent: it changes only the WORDING of a refusal, and re-running this
    // would throw away every open buffer to translate a sentence — the same rule `RepoFileEditor`
    // states over its own read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const openFile = (path: string, line?: number) => {
    setTabs(prev => openTab(prev, path))
    setActivePath(path)
    setGoTo(line !== undefined && line > 0 ? { path, line } : null)
    // The view underneath is deliberately left ALONE. Opening from a search hit lands on the file
    // (an active path is what decides which layer is shown), and the back control then returns to
    // the results the hit came from — a reader opening the second of twelve matches should not have
    // to type the query again. The search's own back control is the way out to the tree.
  }

  const requestClose = (path: string) => {
    if (tabs.find(t => t.path === path)?.dirty === true) { setPendingClose(path); return }
    doClose(path)
  }

  const doClose = (path: string) => {
    const next = closeOutcome(tabs, activePath, path)
    setTabs(next.tabs)
    setActivePath(next.activePath)
    setPendingClose(null)
  }

  const submitCreate = async (name: string) => {
    const path = name.trim()
    if (path === '') return
    setCreating({ name, busy: true, error: null })
    const out = await createRepoEntry(sessionId, path, 'file', lang as RepoLang)
    if (!out.ok) {
      setCreating({ name, busy: false, error: repoFailureText(out, lang as RepoLang) })
      return
    }
    setCreating(null)
    // Re-read the root rather than inserting the row here: the real listing is gitignore-aware and
    // sorted by the server, and a second implementation of that is a second thing to disagree with
    // what was actually created.
    const res = await fetchTree(sessionId, '', lang as RepoLang)
    if (res.ok) setTree(prev => applyChildren(prev, '', res.children))
    openFile(path)
  }

  const agent = agentActivity(liveEvents(turns), activePath)
  const mounted = mountedEditors(tabs, activePath)
  const rootLoading = treeViewState(tree) === 'loading'

  return (
    <div style={{
      flex: 1, minHeight: 0, minWidth: 0, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
    }}>
      <StudioBar isMobile={isMobile} lang={lang} onExit={onExit} />

      {tabs.length > 0 && (
        <TabStrip
          tabs={tabs}
          activePath={activePath}
          agentHere={agent.here}
          isMobile={isMobile}
          lang={lang}
          onSelect={setActivePath}
          onClose={requestClose}
          {...(activePath !== null ? { onBack: () => setActivePath(null) } : {})}
        />
      )}

      {/*
        THE TWO LAYERS ARE BOTH MOUNTED, AND ONLY ONE IS SHOWN. Swapping them instead — rendering
        the tree OR the stack — was written first, and the live run caught what it costs: pressing
        "back to the tree" over an unsaved file unmounted the whole stack, so the buffer `mountedEditors`
        exists to protect was destroyed by the one control that promises to change nothing. Measured
        on a real session: `tsconfig.json` came back re-read from disk with the typed characters
        gone, while the strip still showed its unsaved dot. The hiding rule is therefore the SAME one
        the stack applies to its own inactive editors, one level up.

        It buys a second thing: the tree keeps its expanded folders AND its scroll position across a
        visit to a file, and a search keeps its query and its results — so the back control returns
        you to what you were actually looking at.
      */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
        <Layer shown={activePath === null}>
          {view === 'tree' && (
            <Toolbar
              working={agent.working}
              isMobile={isMobile}
              lang={lang}
              onSearch={() => setView('search')}
              onNew={() => setCreating({ name: '', busy: false, error: null })}
            />
          )}

          {view === 'tree' && creating !== null && (
            <NewFileRow
              state={creating}
              isMobile={isMobile}
              lang={lang}
              onChange={name => setCreating(c => (c === null ? c : { ...c, name }))}
              onSubmit={() => { void submitCreate(creating.name) }}
              onCancel={() => setCreating(null)}
            />
          )}

          {view === 'search' ? (
            <RepoSearchView
              sessionId={sessionId}
              onOpenFile={openFile}
              onBack={() => setView('tree')}
              lang={lang}
            />
          ) : rootLoading ? (
            <RepoNote
              icon={<Loader size={15} className="ag-working-spin" />}
              text={pt ? 'Lendo os arquivos desta sessão…' : 'Reading this session’s files…'}
            />
          ) : (
            /* The watermark sits UNDER the tree, in the region a document would occupy if one were
               open — this composition has no separate empty editor pane to paint it in, because
               opening a file replaces the tree rather than sitting beside it. It is decoration:
               `aria-hidden`, no text, and it can never take a click. */
            <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
              <Watermark />
              <RepoTreeView
                sessionId={sessionId}
                tree={tree}
                onTreeChange={setTree}
                onOpenFile={openFile}
                lang={lang}
              />
            </div>
          )}
        </Layer>

        <Layer shown={activePath !== null}>
          <EditorStack
            sessionId={sessionId}
            paths={mounted}
            activePath={activePath}
            autosave={autosave}
            lang={lang}
            goTo={goTo}
            onDirtyChange={(path, dirty) => setTabs(prev => markDirty(prev, path, dirty))}
          />
        </Layer>
      </div>

      <ConfirmModal
        open={pendingClose !== null}
        title={pt ? 'Fechar sem salvar?' : 'Close without saving?'}
        message={pt
          ? 'Este arquivo tem mudanças que não foram salvas. Fechar descarta o que ainda não foi salvo.'
          : 'This file has changes that have not been saved. Closing discards what has not been saved.'}
        confirmLabel={pt ? 'Fechar mesmo assim' : 'Close anyway'}
        cancelLabel={pt ? 'Continuar editando' : 'Keep editing'}
        onConfirm={() => { if (pendingClose !== null) doClose(pendingClose) }}
        onCancel={() => setPendingClose(null)}
      />
    </div>
  )
}

/**
 * THE STUDIO'S OWN TOP EDGE — and the only chrome it has.
 *
 * The Studio covers the aside's header and its tab strip (see the file header), so the way back has
 * to be here. It NAMES where it goes rather than drawing a bare arrow: `ArrowLeft` already means
 * "back to the tree" on `TabStrip` two rows down, and one glyph for two different backs in one panel
 * is a control people press to find out what it does. The word is the aside's own heading, so the
 * destination on the button is the heading the reader lands on.
 *
 * ONE ROW, and as short as a row can be: the whole reason this surface took the aside over is
 * vertical space. It earns its height by being the exit and by saying what this is — the product
 * name in full, with the beta caveat the nav entries already carry, so the mark is on every surface
 * that names the feature rather than on some of them.
 */
export function StudioBar({ isMobile, lang, onExit }: {
  isMobile: boolean
  lang: 'pt' | 'en'
  onExit: () => void
}) {
  const pt = lang === 'pt'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: 0,
      // 44px is the MOBILE figure and only the mobile figure — applied on desktop it would make
      // this thin bar as tall as the tab strip under it.
      minHeight: isMobile ? 44 : 30, padding: '0 8px 0 2px',
      borderBottom: '1px solid var(--border)',
    }}>
      <button
        onClick={onExit}
        aria-label={pt ? 'Sair do Studio e voltar para Conteúdo' : 'Leave the Studio and go back to Contents'}
        title={pt ? 'Sair do Studio e voltar para Conteúdo' : 'Leave the Studio and go back to Contents'}
        style={{
          display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
          minHeight: isMobile ? 44 : 26, padding: isMobile ? '0 10px 0 4px' : '0 7px 0 3px',
          border: 'none', borderRadius: 8, background: 'transparent',
          color: 'var(--text-secondary)', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: isMobile ? 13 : 11.5,
        }}
      >
        <ChevronLeft size={isMobile ? 18 : 15} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pt ? 'Conteúdo' : 'Contents'}
        </span>
      </button>

      <span style={{
        display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', minWidth: 0,
      }}>
        <span style={{
          fontSize: isMobile ? 12 : 11, fontWeight: 700, letterSpacing: 0.3,
          color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {/* The full product name where there is room for it; the tab and the header button say
              `Studio` alone, which is what the feature is called in conversation. */}
          {isMobile ? 'Studio' : 'Agentistics Studio'}
        </span>
        <BetaTag what={pt ? 'O Studio' : 'The Studio'} />
      </span>
    </div>
  )
}

// --- the chrome ----------------------------------------------------------------------------------
//
// Every piece below takes its state as a PROP and is exported for the reason `RepoSearchResults` is:
// `useEffect` never runs under `renderToStaticMarkup`, so anything reachable only by fetching and
// clicking could not be asserted at all.

/**
 * ONE REGION, SEVERAL MOUNTED TREES, EXACTLY ONE OF THEM VISIBLE.
 *
 * **IT IS NESTED, AND `visibility` COULD NOT SURVIVE THAT.** This used to hide with
 * `visibility: hidden`, which is wrong here for a reason CSS states outright: `visibility` is
 * INHERITED AND OVERRIDABLE, so a descendant setting `visibility: visible` re-shows itself inside a
 * hidden ancestor. And a descendant always does — `Studio` renders two of these inside itself and
 * one of them is always `shown`, while `ArtifactsAside` now renders the whole Studio inside one
 * more. Reproduced in Chromium on exactly this nesting: the inner layer computed `visible` under an
 * ancestor computing `hidden`, `elementsFromPoint` returned it ABOVE the tab body, and a screenshot
 * showed the file tree painted over the tab the reader had switched to. Because the box is
 * `position: absolute; inset: 0` it covered the region completely; because `inert` IS inherited and
 * cannot be undone by a descendant, what you got was a frozen, unclickable panel over your content.
 *
 * So the hide is `opacity: 0`, which a descendant cannot reverse (it is not inherited — it composites
 * the whole subtree), plus `pointer-events: none` for the clicks `opacity` leaves live and `inert`
 * for the keyboard and the accessibility tree. **`display: none` is the one thing this component
 * exists to avoid**: a display-less box measures ZERO, and a zero-sized Monaco is the one state its
 * `automaticLayout` then has to recover from — which is why the layer has to keep measuring while it
 * is hidden.
 *
 * THE COST IS STATED RATHER THAN DISCOVERED: `opacity: 0` keeps the subtree in the DOCUMENT's text,
 * which `visibility: hidden` would not — the browser's own find-in-page can still match a hidden
 * buffer. That is the cheaper half of the trade. `inert` is what keeps it out of the ACCESSIBILITY
 * tree and away from the keyboard, so a screen reader never reads it, and nothing here is ever the
 * only copy of anything on screen: the hidden layer is always a file the reader has open and can
 * bring back. Measured on a live session — the hidden layer computed `opacity: 0`,
 * `pointer-events: none` (inherited by its own shown children, which is exactly the point) and
 * `inert`, and `elementsFromPoint` over the middle of the region returned the visible content.
 *
 * `data-layer-shown` is the attribute the tests read; it is also the only honest way to ask this
 * question from outside, since every style here is inline.
 */
export function Layer({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <div
      data-layer-shown={shown}
      inert={!shown}
      style={{
        position: 'absolute', inset: 0, minWidth: 0,
        display: 'flex', flexDirection: 'column',
        // NOT `visibility` — see the note above. These three cannot be undone from inside.
        opacity: shown ? 1 : 0,
        pointerEvents: shown ? undefined : 'none',
      }}
    >
      {children}
    </div>
  )
}

/**
 * Every mounted buffer, stacked — exactly one of them visible.
 *
 * This is where "switching tabs does not destroy what you typed" is actually spent, so it is its own
 * exported component: a test can render it with two paths and see BOTH editors in the markup, which
 * is the one fact the pure `mountedEditors` cannot carry on its own.
 *
 * The editors are stacked absolutely inside one relative box so that every one of them has the full
 * region's size, visible or not — which is exactly what `Layer` is, so it is `Layer` that draws them
 * rather than a second copy of the same three styles. That matters beyond tidiness: this stack sits
 * INSIDE two more layers, and `Layer`'s doc comment records why the hide may not be `visibility`
 * (a descendant can set `visibility: visible` and re-show itself through a hidden ancestor, which
 * shipped once and painted a frozen file tree over the tab the reader had switched to). One hiding
 * rule, in one place, for every level of the nest.
 *
 * `data-editor-path` stays on a wrapper of its own: it is what the tests count mounted buffers by,
 * and `Layer` carries no identity.
 */
export function EditorStack({ sessionId, paths, activePath, autosave, lang, goTo, onDirtyChange }: {
  sessionId: string
  paths: readonly string[]
  activePath: string | null
  autosave: boolean
  lang: 'pt' | 'en'
  goTo: GoTo | null
  onDirtyChange: (path: string, dirty: boolean) => void
}) {
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
      {paths.map(path => {
        const active = path === activePath
        return (
          <Layer key={path} shown={active}>
            <div data-editor-path={path} style={{
              flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column',
            }}>
              <RepoFileEditor
                sessionId={sessionId}
                path={path}
                autosave={autosave}
                onDirtyChange={dirty => onDirtyChange(path, dirty)}
                lang={lang}
                {...(goTo !== null && goTo.path === path ? { gotoLine: goTo.line } : {})}
              />
            </div>
          </Layer>
        )
      })}
    </div>
  )
}

/** The mark, as a CSS MASK: the alpha channel is the shape, so the file's own colour is irrelevant. */
const MARK_URL = '/markMask.png'
/** The asset's own aspect, so the box is the mark's box and the mask fills it exactly. */
const MARK_ASPECT = '323 / 441'

/**
 * The mark, behind the tree.
 *
 * ONE ASSET FOR BOTH THEMES. It is painted with `currentColor` through a mask rather than drawn as
 * an image, so the colour is the theme's own text colour and there is no second file to keep in
 * sync — the dark and light marks cannot drift apart because there is only one. The OPACITY is the
 * one thing that differs, and it differs because it must (`watermarkOpacity`).
 *
 * The theme is read off `<html data-theme>`, the one place `App.tsx` writes it, and followed with an
 * observer — the same route `RepoFileEditor` takes for Monaco's own theme, rather than threading a
 * second copy of one fact through two components.
 */
export function Watermark() {
  const [theme, setTheme] = useState<string | null>(() => (
    typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme')
  ))

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const root = document.documentElement
    const observer = new MutationObserver(() => setTheme(root.getAttribute('data-theme')))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div style={{
        width: 'min(46%, 168px)', aspectRatio: MARK_ASPECT, maxHeight: '62%',
        maskImage: `url(${MARK_URL})`, WebkitMaskImage: `url(${MARK_URL})`,
        maskSize: 'contain', WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center', WebkitMaskPosition: 'center',
        backgroundColor: 'currentColor', color: 'var(--text-primary)',
        opacity: watermarkOpacity(theme),
      }} />
    </div>
  )
}

/**
 * Search, New, and whether the agent is busy.
 *
 * The dot is not a decoration: it is the answer to "is something else writing in here right now",
 * which is the question a person is about to edit a file against. It carries its own label, because
 * a coloured circle says nothing to a reader who cannot see it.
 */
export function Toolbar({ working, isMobile, lang, onSearch, onNew }: {
  working: boolean
  isMobile: boolean
  lang: 'pt' | 'en'
  onSearch: () => void
  onNew: () => void
}) {
  const pt = lang === 'pt'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, minWidth: 0,
      boxSizing: 'border-box',
      padding: isMobile ? '6px 8px' : '5px 8px',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <BarButton
        label={pt ? 'Buscar' : 'Search'}
        icon={<Search size={12} />}
        isMobile={isMobile}
        onClick={onSearch}
      />
      <BarButton
        label={pt ? 'Novo' : 'New'}
        icon={<Plus size={12} />}
        isMobile={isMobile}
        onClick={onNew}
      />
      {working && (
        <span
          role="img"
          aria-label={pt ? 'O agente está trabalhando nesta sessão' : 'The agent is working in this session'}
          title={pt ? 'O agente está trabalhando nesta sessão' : 'The agent is working in this session'}
          style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginLeft: 'auto',
            background: 'var(--accent-green, #22c55e)',
          }}
        />
      )}
    </div>
  )
}

/**
 * Creating a file, asked INSIDE the panel.
 *
 * Never `window.prompt`: it blocks the whole tab, and this panel is mounted inside a workspace that
 * polls the fleet every few seconds — the objection `BackupSettings.tsx` already records three times
 * for `window.confirm`. It is also the only form of this question that can be 16px on a phone (below
 * that iOS Safari zooms the viewport and takes the workspace's sticky header with it), that follows
 * the theme, and that can keep a REFUSAL on screen beside the name that caused it instead of
 * throwing it away with an alert.
 */
export function NewFileRow({ state, isMobile, lang, onChange, onSubmit, onCancel }: {
  state: Creating
  isMobile: boolean
  lang: 'pt' | 'en'
  onChange: (name: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const pt = lang === 'pt'
  const ready = state.name.trim() !== '' && !state.busy
  return (
    <div style={{
      flexShrink: 0, minWidth: 0, boxSizing: 'border-box',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
        padding: isMobile ? '5px 8px' : '4px 8px',
      }}>
        <FilePlus size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <input
          value={state.name}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          disabled={state.busy}
          onChange={ev => onChange(ev.target.value)}
          onKeyDown={ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); if (ready) onSubmit() }
            if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); onCancel() }
          }}
          aria-label={pt ? 'Nome do novo arquivo' : 'New file name'}
          placeholder={pt ? 'pasta/arquivo.ts' : 'folder/file.ts'}
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box',
            background: 'transparent', border: 'none', outline: 'none',
            fontFamily: 'inherit', color: 'var(--text-primary)',
            // 16px on a phone is not a taste: below it, iOS Safari zooms the viewport on focus.
            fontSize: isMobile ? 16 : 13,
            minHeight: isMobile ? 44 : undefined,
          }}
        />
        <IconButton
          label={pt ? 'Criar o arquivo' : 'Create the file'}
          disabled={!ready}
          onClick={onSubmit}
        >
          {state.busy ? <Loader size={14} className="ag-working-spin" /> : <Check size={14} />}
        </IconButton>
        <IconButton label={pt ? 'Cancelar' : 'Cancel'} onClick={onCancel}>
          <X size={14} />
        </IconButton>
      </div>

      {/* The server's own sentence, kept BESIDE the name that caused it — `already-exists` is only
          useful next to the thing that already exists. */}
      {state.error !== null && (
        <p role="status" style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, margin: 0, minWidth: 0,
          padding: '0 10px 6px', fontSize: 11, lineHeight: 1.45, color: 'var(--accent-red)',
        }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ minWidth: 0 }}>{state.error}</span>
        </p>
      )}
    </div>
  )
}

/**
 * The open files.
 *
 * It stays on screen while the TREE is showing too, which is not a detail: the back control returns
 * to the tree without closing anything, and a strip that disappeared with the editor would leave
 * every open buffer — including an unsaved one — reachable only by finding the file again.
 *
 * The name and the close are SIBLING buttons, never a button inside a button: nesting them is
 * invalid, and it makes the close a region of the tab rather than a control of its own for anything
 * that reads the markup instead of looking at it.
 */
export function TabStrip({ tabs, activePath, agentHere, isMobile, lang, onSelect, onClose, onBack }: {
  tabs: readonly OpenTab[]
  activePath: string | null
  agentHere: boolean
  isMobile: boolean
  lang: 'pt' | 'en'
  onSelect: (path: string) => void
  onClose: (path: string) => void
  /** Absent while the tree is already showing — a back control with nothing to go back to. */
  onBack?: () => void
}) {
  const pt = lang === 'pt'
  return (
    <div
      role="list"
      aria-label={pt ? 'Arquivos abertos' : 'Open files'}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, minWidth: 0,
        boxSizing: 'border-box',
        padding: isMobile ? '4px 6px' : '3px 6px',
        borderBottom: '1px solid var(--border-subtle)',
        overflowX: 'auto', overflowY: 'hidden', overscrollBehavior: 'contain',
      }}
    >
      {onBack !== undefined && (
        <IconButton label={pt ? 'Voltar para a árvore de arquivos' : 'Back to the file tree'} onClick={onBack}>
          <ArrowLeft size={15} />
        </IconButton>
      )}
      {tabs.map(tab => {
        const active = tab.path === activePath
        const name = tab.path.split('/').pop() ?? tab.path
        return (
          <span
            role="listitem"
            key={tab.path}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0,
              borderRadius: 6, background: active ? 'var(--bg-elevated)' : 'transparent',
            }}
          >
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              // The dot beside the name is colour only, so the unsaved state is SAID as well —
              // appended to the visible name rather than replacing it, so the accessible name still
              // contains the words on screen.
              aria-label={tab.dirty ? `${name} — ${pt ? 'não salvo' : 'unsaved'}` : name}
              title={tab.path}
              onClick={() => onSelect(tab.path)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                boxSizing: 'border-box', maxWidth: 190,
                minHeight: isMobile ? 44 : undefined,
                padding: isMobile ? '0 6px 0 9px' : '3px 5px 3px 8px',
                background: 'transparent', border: 'none', borderRadius: 6,
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                fontSize: isMobile ? 13 : 11.5,
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {/* Unsaved, said in a way that survives a column too narrow for words. */}
              <span
                aria-hidden="true"
                data-dirty={tab.dirty}
                style={{
                  width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                  background: tab.dirty ? 'var(--anthropic-orange)' : 'transparent',
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
              {active && agentHere && (
                <span
                  role="img"
                  aria-label={pt ? 'O agente está editando este arquivo agora' : 'The agent is editing this file right now'}
                  title={pt ? 'O agente está editando este arquivo agora' : 'The agent is editing this file right now'}
                  style={{
                    width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--accent-green, #22c55e)',
                  }}
                />
              )}
            </button>
            <IconButton
              label={pt ? `Fechar ${name}` : `Close ${name}`}
              onClick={() => onClose(tab.path)}
            >
              <X size={12} />
            </IconButton>
          </span>
        )
      })}
    </div>
  )
}

/** A labelled control in the toolbar: a word, so the label is what makes it wide enough for a finger. */
function BarButton({ label, icon, isMobile, onClick }: {
  label: string
  icon: ReactNode
  isMobile: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        flexShrink: 0, boxSizing: 'border-box',
        // 44px of HEIGHT only: this control carries a word, so it is already wider than a finger,
        // and a 44px box painted around a labelled control is what `touchTarget.lint.test.ts`
        // refuses.
        minHeight: isMobile ? 44 : undefined,
        padding: isMobile ? '0 12px' : '3px 9px',
        borderRadius: 6, border: '1px solid var(--border-subtle)',
        background: 'transparent', fontFamily: 'inherit',
        fontSize: isMobile ? 13 : 11.5, color: 'var(--text-secondary)',
        cursor: 'pointer',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * An icon-only control: PAINTED small, TARGETED at 44px by `.ag-tap-icon`'s invisible box — the
 * repo's rule, and the reason a 13px glyph here is not a 44x44 square on a phone.
 */
function IconButton({ label, onClick, disabled, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      className="ag-tap-icon"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled === true}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, flexShrink: 0, boxSizing: 'border-box',
        padding: 0, background: 'transparent', border: 'none', borderRadius: 6,
        cursor: disabled === true ? 'not-allowed' : 'pointer',
        color: 'var(--text-tertiary)', opacity: disabled === true ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  )
}
