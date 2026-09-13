/**
 * RepoTreeView — the lazy, gitignore-aware file tree.
 *
 * Expand-on-click, one `GET /api/fleet/tree` call per directory the FIRST time it is opened.
 * `children === null` is the signal — `repoTreeModel.ts`'s own header explains why collapsing never
 * clears the cache, and why that `null` may never be confused with a loaded, empty directory. This
 * component owns NO tree arithmetic: every change goes through the model's `applyChildren` /
 * `applyError` / `setLoading` / `toggleExpanded`, and the rows it draws are `flattenVisible`'s,
 * never a walk of its own.
 *
 * A plain list rather than a virtualized one for now: the row count of an expanded session folder
 * is in the hundreds, not the tens of thousands that would justify windowing — and windowing can be
 * added later without touching the model, since `flattenVisible` already returns exactly what a
 * windowed renderer would slice.
 *
 * THREE EMPTY STATES, THREE SENTENCES, and never one shared empty box. "The listing failed" (which
 * includes the closed gate — `repoErrorText.ts` words both of those), "this folder is genuinely
 * empty" and "the root has not been read yet" are three different facts, and only the second is a
 * statement about the repository. The third draws NOTHING here on purpose: the parent owns the root
 * fetch, so it owns the spinner for it, and two components racing to draw one loader is how a panel
 * ends up with two.
 *
 * A FAILURE IS NEVER SWALLOWED. A directory whose listing was refused keeps its row, with the
 * server's own sentence under it — not a silently missing folder, which is indistinguishable from
 * one the gitignore filtered out.
 *
 * A LIST, NOT AN ARIA `tree`. The role was `tree`/`treeitem` and it claimed two things that are
 * not true here: arrow-key tree navigation (only `Tab` moves between these rows — nothing
 * implements Left/Right/Home/End), and, worse, ownership. ARIA's `tree` owns `treeitem` and `group`
 * children and NOTHING else, so the two error regions — the root-level banner and the sentence under
 * a row whose listing was refused — were plain `div`s sitting directly inside it, which an assistive
 * technology walking the tree may drop: exactly the text the invariant above says is never
 * swallowed. So the rows are a `list` of `listitem`s, each row's failure sentence lives INSIDE its
 * own item (a `listitem` owns arbitrary content, which is the whole reason it is the right
 * container), and the root banner sits OUTSIDE the list, because it is a statement about the whole
 * listing rather than one of its items. Depth rides on the item as `aria-level`, which `listitem`
 * supports and the `button` role does not; `aria-expanded` stays on the button, which does.
 *
 * THE MARK BESIDE A NAME IS `fileIcon.tsx`'s, and this component decides nothing about it. It passes
 * the row's own name and kind and sets only the colour the FALLBACK glyphs inherit — the brand orange
 * for a folder, `--text-tertiary` for a file nothing recognises. A drawn mark carries the language's
 * own hue and ignores that colour, which is why an unmapped file still looks exactly as it did before
 * that module existed.
 *
 * `onTreeChange` takes an UPDATER, never a finished `TreeNode`: the state lives in the parent
 * (`Studio`), which passes its `setTree` straight in, so every model call runs against the
 * LATEST tree rather than one a closure captured before an `await`.
 *
 * **TREE OPERATIONS (create/rename/delete/move) ARE STILL NOT THIS COMPONENT'S DECISION.** Every
 * action a row offers — the context menu, `F2`, a drag — is reported through `TreeOps`, and
 * `Studio.tsx` is what actually calls the server, refreshes a directory and retargets an open tab.
 * What DOES live here, because it is pure interaction chrome with nothing to get wrong about the
 * MODEL, is: which row's context menu is open, which row is the current drag source, and which
 * folder a drag is hovering over — the same class of thing the hover-highlight on `Row` already
 * owned before this task. The one exception is the INLINE RENAME TEXT, which Studio owns (`renaming`
 * on `TreeOps`) because its value survives a refusal round-trip exactly like `Studio`'s own
 * `creating` state for a new file.
 */

import { useRef, useState, type DragEvent } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Folder, Loader, MoreHorizontal, X,
} from 'lucide-react'
import { FileIcon } from './fileIcon'
import {
  applyChildren, applyError, canMoveInto, flattenVisible, setLoading, toggleExpanded,
  type FlatRow, type TreeNode,
} from '../../lib/repoTreeModel'
import { fetchTree, type RepoLang, type TreeListResult } from '../../lib/repoApi'
import { repoFailureText } from '../../lib/repoErrorText'
import { readRepoDrag, writeRepoDrag, type RepoDragPayload } from '../../lib/repoDrag'
import { useIsMobile } from '../../hooks/useIsMobile'
import { RepoNote } from './repoNote'
import { TreeContextMenu, type TreeMenuAction } from './TreeContextMenu'

/**
 * Every tree-level operation this view can ask for, and the one piece of STATE it cannot own
 * itself: the inline rename's live text, because a refusal must put the SAME name back with its
 * OWN error beside it, the same contract `Studio`'s `creating`/`NewFileRow` already keep for a new
 * file.
 *
 * `onMention` is the one OPTIONAL handler — see `TreeContextMenu.tsx`'s own header: its absence
 * removes the menu row rather than greying it, because the feature behind it (§6 of the design)
 * belongs to a later package.
 */
export interface TreeOps {
  renaming: { path: string; name: string; busy: boolean; error: string | null } | null
  onRenameStart: (path: string, kind: 'file' | 'dir') => void
  onRenameChange: (name: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onNewAt: (parentPath: string, kind: 'file' | 'dir') => void
  onDelete: (path: string, kind: 'file' | 'dir') => void
  onMovePicker: (path: string, kind: 'file' | 'dir') => void
  onCopyRelativePath: (path: string) => void
  onCopyPath: (path: string) => void
  onMention?: (path: string, kind: 'file' | 'dir') => void
  /** A drag that already passed `canMoveInto` — this component never asks for an illegal move. */
  onDropMove: (itemPath: string, itemKind: 'file' | 'dir', targetDir: string) => void
}

export interface RepoTreeViewProps {
  sessionId: string
  tree: TreeNode
  onTreeChange: (updater: (prev: TreeNode) => TreeNode) => void
  onOpenFile: (path: string) => void
  lang: 'pt' | 'en'
  ops: TreeOps
}

/** Finds one node by path. The model keeps every path unique, so the first hit is the only one. */
function findNode(node: TreeNode, path: string): TreeNode | null {
  if (node.path === path) return node
  for (const child of node.children ?? []) {
    const hit = findNode(child, path)
    if (hit) return hit
  }
  return null
}

/**
 * What the tree has to say when it has no rows to draw — the three states above, named.
 *
 * It reads the ROOT alone, which is enough: `flattenVisible` pushes a row for every one of the
 * root's children, so "no rows" and "the root has no children" are the same fact.
 */
export type TreeViewState = 'loading' | 'failed' | 'empty' | 'rows'

export function treeViewState(tree: TreeNode): TreeViewState {
  if (tree.children === null) return tree.error === undefined ? 'loading' : 'failed'
  return tree.children.length === 0 ? 'empty' : 'rows'
}

/**
 * Open or close ONE directory, fetching its children the first time and only the first time.
 *
 * Exported, and taking its loader as an argument, so the one piece of behaviour this component adds
 * to the already-tested model can be driven directly — this repo has no React-interaction test
 * stack (see `ConnectionCard.test.tsx`'s own note), and "fires exactly once" is not a fact a
 * statically rendered string can carry.
 *
 * THREE GUARDS, and each closes a different door on a second fetch: a directory being COLLAPSED
 * never reads anything; one whose `children` is no longer `null` has already been read (that is the
 * whole point of the cache surviving a collapse); and one that is already `loading` has a request
 * in flight, which is what a double-click would otherwise duplicate.
 */
export async function toggleDirectory(
  tree: TreeNode,
  path: string,
  lang: RepoLang,
  onTreeChange: (updater: (prev: TreeNode) => TreeNode) => void,
  load: (path: string) => Promise<TreeListResult>,
): Promise<void> {
  const node = findNode(tree, path)
  if (node === null) return
  const willExpand = !node.expanded
  onTreeChange(prev => toggleExpanded(prev, path))
  if (!willExpand || node.children !== null || node.loading) return

  onTreeChange(prev => setLoading(prev, path, true))
  const res = await load(path)
  if (res.ok) onTreeChange(prev => applyChildren(prev, path, res.children))
  // The server's own sentence, already in the reader's language, is stored as the row's error —
  // `repoErrorText.ts` invents one only for the refusals that arrive carrying none.
  else onTreeChange(prev => applyError(prev, path, repoFailureText(res, lang)))
}

/**
 * How far one level steps in, and how many levels still step at all.
 *
 * The cap is the 390px column talking: at 20 levels an uncapped step would spend the whole width on
 * indentation and leave nothing for the names. Past the cap the rows stop stepping and the `title`
 * keeps the exact path, which is the honest trade — a name nobody can read says less than a depth
 * nobody can count.
 */
const INDENT_PX = { mobile: 11, desktop: 14 }
const MAX_INDENT_LEVELS = 12

/** The folder a drag is currently hovering LEGALLY over — `''` is the root's own empty area. */
type DropTarget = string | null

export function RepoTreeView({ sessionId, tree, onTreeChange, onOpenFile, lang, ops }: RepoTreeViewProps) {
  const isMobile = useIsMobile()
  const pt = lang === 'pt'
  const rows = flattenVisible(tree)
  const state = treeViewState(tree)

  const onToggle = (path: string) => {
    void toggleDirectory(tree, path, lang, onTreeChange, p => fetchTree(sessionId, p, lang))
  }

  // --- the context menu: which row opened it, and where -------------------------------------------
  // Pure UI chrome with nothing to get wrong about the TREE MODEL — see the file header — so it
  // lives here rather than being threaded up to `Studio`.
  const [menuFor, setMenuFor] = useState<{ path: string; kind: 'file' | 'dir'; x: number; y: number } | null>(null)
  const openMenuAt = (path: string, kind: 'file' | 'dir', x: number, y: number) => setMenuFor({ path, kind, x, y })

  // --- drag and drop (desktop only — "Mover para…" is the only move gesture on a phone) -----------
  const [dragging, setDragging] = useState<RepoDragPayload | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const expandTimer = useRef<{ path: string; handle: ReturnType<typeof setTimeout> } | null>(null)
  const clearExpandTimer = () => {
    if (expandTimer.current !== null) { clearTimeout(expandTimer.current.handle); expandTimer.current = null }
  }
  const clearDragState = () => { setDragging(null); setDropTarget(null); clearExpandTimer() }

  const startDrag = (row: FlatRow) => (e: DragEvent) => {
    writeRepoDrag(e.dataTransfer, { sessionId, path: row.path, kind: row.kind })
    e.dataTransfer.effectAllowed = 'move'
    setDragging({ sessionId, path: row.path, kind: row.kind })
  }

  /** A folder row (or the root area) being hovered while something is being dragged. */
  const dirOver = (targetDir: string) => ({
    onDragEnter: (e: DragEvent) => {
      e.stopPropagation()
      // A folder that is already expanded has nothing to reveal — no point arming a timer for it.
      const row = rows.find(r => r.path === targetDir)
      if (row !== undefined && !row.expanded && expandTimer.current?.path !== targetDir) {
        clearExpandTimer()
        expandTimer.current = { path: targetDir, handle: setTimeout(() => onToggle(targetDir), 600) }
      }
    },
    onDragOver: (e: DragEvent) => {
      e.stopPropagation()
      const legal = dragging !== null && canMoveInto(dragging.path, targetDir)
      if (legal) e.preventDefault()
      setDropTarget(legal ? targetDir : null)
    },
    onDragLeave: (e: DragEvent) => {
      e.stopPropagation()
      if (expandTimer.current?.path === targetDir) clearExpandTimer()
      setDropTarget(prev => (prev === targetDir ? null : prev))
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const payload = readRepoDrag(e.dataTransfer, sessionId)
      if (payload !== null && canMoveInto(payload.path, targetDir)) ops.onDropMove(payload.path, payload.kind, targetDir)
      clearDragState()
    },
  })

  /** A FILE row never accepts a drop — it stops the event here so it cannot bubble to the root's
      own drop zone and be misread as "dropped in the empty area". No highlight is ever shown. */
  const fileOver = {
    onDragEnter: (e: DragEvent) => e.stopPropagation(),
    onDragOver: (e: DragEvent) => { e.stopPropagation(); setDropTarget(null) },
    onDragLeave: (e: DragEvent) => e.stopPropagation(),
    onDrop: (e: DragEvent) => e.stopPropagation(),
  }

  if (state === 'loading') {
    // The parent owns the root fetch, so it owns the sentence for it. Drawing a second loader here
    // would put two of them in one panel.
    return null
  }

  if (state === 'failed') {
    return (
      <RepoNote
        icon={<AlertTriangle size={15} style={{ color: 'var(--accent-red)' }} />}
        text={tree.error ?? (pt ? 'Não foi possível ler esta pasta.' : 'This folder could not be read.')}
      />
    )
  }

  if (state === 'empty') {
    return (
      <RepoNote
        icon={<Folder size={15} />}
        text={pt
          ? 'Esta pasta está vazia. Arquivos ignorados pelo git não são listados.'
          : 'This folder is empty. Files the gitignore excludes are not listed.'}
      />
    )
  }

  const step = isMobile ? INDENT_PX.mobile : INDENT_PX.desktop
  const basePad = isMobile ? 12 : 10

  return (
    <div
      {...(isMobile ? {} : dirOver(''))}
      onDragEnd={clearDragState}
      style={{
        flex: 1, minHeight: 0, minWidth: 0,
        overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
        padding: '4px 0',
        // The root's own empty-area drop target, highlighted the SAME way a folder row is.
        outline: dropTarget === '' ? '2px solid var(--anthropic-orange)' : undefined,
        outlineOffset: dropTarget === '' ? -2 : undefined,
      }}
    >
      {/* The root itself can carry an error while its children are already on screen — a refresh
          that failed over a tree that had loaded. Saying nothing there would drop a failure. It is
          a banner about the LISTING and not one of its items, so it sits outside the list below. */}
      {tree.error !== undefined && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6,
          padding: '6px 12px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--accent-red)',
        }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ minWidth: 0 }}>{tree.error}</span>
        </div>
      )}

      <div role="list" aria-label={pt ? 'Arquivos da sessão' : 'Session files'}>
        {rows.map(row => {
          // One arithmetic per row: the row steps in by it, and so does the sentence under it.
          const indent = basePad + Math.min(row.depth, MAX_INDENT_LEVELS) * step
          const activeRenaming = ops.renaming !== null && ops.renaming.path === row.path ? ops.renaming : undefined
          return (
            <div role="listitem" aria-level={row.depth + 1} key={row.path}>
              <Row
                row={row}
                indent={indent}
                isMobile={isMobile}
                onActivate={() => (row.kind === 'dir' ? onToggle(row.path) : onOpenFile(row.path))}
                draggable={!isMobile}
                dragOver={isMobile ? undefined : (row.kind === 'dir' ? dirOver(row.path) : fileOver)}
                dropHighlight={dropTarget === row.path}
                onDragStart={startDrag(row)}
                onDragEnd={clearDragState}
                onOpenMenu={(x, y) => openMenuAt(row.path, row.kind, x, y)}
                onRenameKey={() => ops.onRenameStart(row.path, row.kind)}
                renaming={activeRenaming}
                onRenameChange={ops.onRenameChange}
                onRenameCommit={ops.onRenameCommit}
                onRenameCancel={ops.onRenameCancel}
                lang={lang}
              />
              {row.error !== undefined && (
                <div
                  style={{
                    padding: `0 12px 6px ${indent}px`,
                    fontSize: 11, lineHeight: 1.45, color: 'var(--accent-red)',
                  }}
                >
                  {row.error}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {menuFor !== null && (
        <TreeContextMenu
          x={menuFor.x}
          y={menuFor.y}
          kind={menuFor.kind}
          lang={lang}
          {...(ops.onMention ? { onMention: () => ops.onMention?.(menuFor.path, menuFor.kind) } : {})}
          copyPath={() => ops.onCopyPath(menuFor.path)}
          onAction={action => handleMenuAction(action, menuFor, ops, onToggle)}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  )
}

/**
 * Translating a picked menu action into the one `TreeOps` call it means — kept here, not inside
 * `TreeContextMenu.tsx`, because that component renders a menu and decides nothing about what its
 * rows DO (see its own header).
 *
 * `new-file`/`new-folder` on a FILE row create beside it, in its own parent — a file has no
 * contents of its own to create INTO. The parent folder is expanded first (`onToggle`, a no-op if
 * already open) so the new entry's own row is reachable the moment the create answers, rather than
 * asking the reader to find and open a folder they just right-clicked inside of.
 */
function handleMenuAction(
  action: TreeMenuAction, target: { path: string; kind: 'file' | 'dir' }, ops: TreeOps,
  expand: (path: string) => void,
): void {
  const { path, kind } = target
  switch (action) {
    case 'new-file':
    case 'new-folder': {
      const parent = kind === 'dir' ? path : parentDirOf(path)
      if (kind === 'dir') expand(path)
      ops.onNewAt(parent, action === 'new-file' ? 'file' : 'dir')
      return
    }
    case 'rename':
      ops.onRenameStart(path, kind)
      return
    case 'move':
      ops.onMovePicker(path, kind)
      return
    case 'copy-relative-path':
      ops.onCopyRelativePath(path)
      return
    case 'delete':
      ops.onDelete(path, kind)
      return
    case 'mention':
    case 'copy-path':
      // Handled directly by `TreeContextMenu` itself (`onMention`/`copyPath`) — it never reaches
      // `onAction` for these two, see its own `pick()`.
      return
  }
}

function parentDirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/**
 * One row.
 *
 * `box-sizing: border-box` is load-bearing, not tidiness: the indent is LEFT PADDING on a
 * `width: 100%` button, so without it every level of depth would push the row wider than its column
 * and the panel would scroll sideways — the thing CLAUDE.md requires to hold at 390px.
 *
 * **THE "⋯" BUTTON AND THE NAME ARE SIBLINGS, NEVER NESTED** — the same rule `TabStrip`'s own name
 * and close controls already follow, for the identical reason: a button inside a button is invalid
 * markup and makes the inner one a region of the outer rather than a control of its own for
 * anything reading the markup instead of looking at it. `.ag-tree-row` on the wrapper is what lets
 * the menu button reveal itself on the ROW's hover/focus rather than only its own — see
 * `index.css`'s own `.ag-tree-row-menu` rule.
 *
 * **RENAMING REPLACES THE WHOLE ROW WITH A NON-INTERACTIVE WRAPPER** rather than putting an
 * `<input>` inside the row's button — an input is itself interactive, and nesting it the same way
 * would be the identical defect the "⋯" button avoids.
 */
function Row({
  row, indent, isMobile, onActivate, draggable, dragOver, dropHighlight, onDragStart, onDragEnd,
  onOpenMenu, onRenameKey, renaming, onRenameChange, onRenameCommit, onRenameCancel, lang,
}: {
  row: FlatRow
  indent: number
  isMobile: boolean
  onActivate: () => void
  draggable: boolean
  dragOver?: {
    onDragEnter: (e: DragEvent) => void
    onDragOver: (e: DragEvent) => void
    onDragLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
  }
  dropHighlight: boolean
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
  onOpenMenu: (x: number, y: number) => void
  onRenameKey: () => void
  /** Set when THIS row is the one being renamed — its live text, and the last refusal. */
  renaming?: { name: string; busy: boolean; error: string | null }
  onRenameChange: (name: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  lang: 'pt' | 'en'
}) {
  const isDir = row.kind === 'dir'
  const pt = lang === 'pt'
  const glyph = 13
  // The MARK is a notch bigger than the chevron beside it. It is the thing a reader scans a tree
  // with, and a two-letter badge or a whale at 13px is a smudge; the chevron is a direction and has
  // nothing to lose at 13. Verified at both widths — the row's height is set by its text and its
  // 44px touch floor on a phone, so neither size moves it.
  const mark = isMobile ? 17 : 15

  if (renaming !== undefined) {
    return (
      <RenamingRow
        row={row} indent={indent} isMobile={isMobile} glyph={glyph} mark={mark}
        renaming={renaming} onChange={onRenameChange} onCommit={onRenameCommit} onCancel={onRenameCancel}
        lang={lang}
      />
    )
  }

  return (
    <div
      className="ag-tree-row"
      style={{ position: 'relative', display: 'flex', alignItems: 'stretch', minWidth: 0 }}
      onContextMenu={e => { e.preventDefault(); onOpenMenu(e.clientX, e.clientY) }}
      {...(draggable ? { draggable: true, onDragStart, onDragEnd } : {})}
      {...(dragOver ?? {})}
    >
      <button
        type="button"
        {...(isDir ? { 'aria-expanded': row.expanded } : {})}
        title={row.path}
        onClick={onActivate}
        onKeyDown={e => { if (e.key === 'F2' && !isMobile) { e.preventDefault(); onRenameKey() } }}
        onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          flex: 1, boxSizing: 'border-box', minWidth: 0, textAlign: 'left',
          // 44px on a phone is the touch-target floor; a desktop row stays as dense as every other
          // list in this aside.
          minHeight: isMobile ? 44 : undefined,
          padding: isMobile ? '6px 12px' : '3px 10px', paddingLeft: indent,
          background: dropHighlight ? 'var(--anthropic-orange-dim)' : 'transparent',
          border: 'none', borderRadius: 0,
          outline: dropHighlight ? '2px solid var(--anthropic-orange)' : undefined,
          outlineOffset: dropHighlight ? -2 : undefined,
          cursor: 'pointer', fontFamily: 'inherit',
          fontSize: isMobile ? 13.5 : 12.5,
          color: 'var(--text-primary)',
        }}
      >
        <span style={{ width: glyph, height: glyph, flexShrink: 0, display: 'inline-flex', color: 'var(--text-tertiary)' }}>
          {isDir && (row.loading
            ? <Loader size={glyph} className="ag-working-spin" />
            : row.expanded ? <ChevronDown size={glyph} /> : <ChevronRight size={glyph} />)}
        </span>
        {/* The mark for this row, from `fileIcon.tsx`. The colour set here is the one the DELEGATED
            glyphs inherit — a folder's orange, and `--text-tertiary` for a file nothing recognises;
            every drawn mark carries the language's own hue and ignores it. */}
        <span style={{ flexShrink: 0, display: 'inline-flex', color: isDir ? 'var(--anthropic-orange)' : 'var(--text-tertiary)' }}>
          <FileIcon name={row.name} kind={row.kind} expanded={row.expanded} size={mark} />
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.name}
        </span>
      </button>
      <button
        type="button"
        className="ag-tree-row-menu ag-tap-icon"
        aria-label={pt ? `Mais ações para ${row.name}` : `More actions for ${row.name}`}
        title={pt ? 'Mais ações' : 'More actions'}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          onOpenMenu(rect.left, rect.bottom)
        }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          // PAINTED small on every width — `.ag-tree-row-menu`/`.ag-tap-icon` are what grow the
          // actual 44px target on a phone; painting it here too would be the 44x44 square
          // `touchTarget.lint.test.ts` refuses. The row's own `align-items: stretch` is what gives
          // it the row's full height without a number of its own.
          width: 26,
          background: 'transparent', border: 'none', borderRadius: 6,
          cursor: 'pointer', color: 'var(--text-tertiary)',
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  )
}

/**
 * The row mid-rename — the SAME indent and icon as the normal row, a text input instead of the
 * name, and the server's own refusal BESIDE it if there was one, exactly the contract
 * `Studio.tsx`'s `NewFileRow` already keeps for a create. A non-interactive `<div>`, never a
 * `<button>`: an input is already interactive, and the row's click-to-activate meaning would be
 * exactly wrong here (pressing Enter types a newline search? No — it submits; but clicking the ROW
 * ITSELF must not ALSO try to open/toggle the entry mid-rename).
 */
function RenamingRow({ row, indent, isMobile, glyph, mark, renaming, onChange, onCommit, onCancel, lang }: {
  row: FlatRow
  indent: number
  isMobile: boolean
  glyph: number
  mark: number
  renaming: { name: string; busy: boolean; error: string | null }
  onChange: (name: string) => void
  onCommit: () => void
  onCancel: () => void
  lang: 'pt' | 'en'
}) {
  const isDir = row.kind === 'dir'
  const pt = lang === 'pt'
  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
          padding: isMobile ? '6px 12px' : '3px 10px', paddingLeft: indent,
        }}
      >
        <span style={{ width: glyph, height: glyph, flexShrink: 0, display: 'inline-flex', color: 'var(--text-tertiary)' }}>
          {isDir && (row.expanded ? <ChevronDown size={glyph} /> : <ChevronRight size={glyph} />)}
        </span>
        <span style={{ flexShrink: 0, display: 'inline-flex', color: isDir ? 'var(--anthropic-orange)' : 'var(--text-tertiary)' }}>
          <FileIcon name={row.name} kind={row.kind} expanded={row.expanded} size={mark} />
        </span>
        <input
          value={renaming.name}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          disabled={renaming.busy}
          onChange={e => onChange(e.target.value)}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onCommit() }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
          }}
          aria-label={pt ? `Renomear ${row.name}` : `Rename ${row.name}`}
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box',
            background: 'var(--bg-elevated)', border: '1px solid var(--anthropic-orange)',
            borderRadius: 4, outline: 'none', padding: '1px 4px',
            fontFamily: 'inherit', color: 'var(--text-primary)',
            // 16px on a phone is not a taste: below it, iOS Safari zooms the viewport on focus.
            fontSize: isMobile ? 16 : 12.5,
            minHeight: isMobile ? 32 : undefined,
          }}
        />
        {renaming.busy && <Loader size={13} className="ag-working-spin" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />}
        <button
          type="button"
          aria-label={pt ? 'Confirmar' : 'Confirm'}
          onClick={onCommit}
          disabled={renaming.busy}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: isMobile ? 32 : 22, height: isMobile ? 32 : 22,
            background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
            color: 'var(--text-tertiary)',
          }}
        >
          <Check size={13} />
        </button>
        <button
          type="button"
          aria-label={pt ? 'Cancelar' : 'Cancel'}
          onClick={onCancel}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: isMobile ? 32 : 22, height: isMobile ? 32 : 22,
            background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
            color: 'var(--text-tertiary)',
          }}
        >
          <X size={13} />
        </button>
      </div>
      {renaming.error !== null && (
        <p role="status" style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, margin: 0, minWidth: 0,
          padding: `0 12px 6px ${indent}px`,
          fontSize: 11, lineHeight: 1.45, color: 'var(--accent-red)',
        }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ minWidth: 0 }}>{renaming.error}</span>
        </p>
      )}
    </div>
  )
}
