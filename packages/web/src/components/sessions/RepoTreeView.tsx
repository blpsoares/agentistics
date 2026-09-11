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
 * `onTreeChange` takes an UPDATER, never a finished `TreeNode`: the state lives in the parent
 * (`RepositoryTab`), which passes its `setTree` straight in, so every model call runs against the
 * LATEST tree rather than one a closure captured before an `await`.
 */

import type { ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, File, Folder, FolderOpen, Loader } from 'lucide-react'
import {
  applyChildren, applyError, flattenVisible, setLoading, toggleExpanded,
  type FlatRow, type TreeNode,
} from '../../lib/repoTreeModel'
import { fetchTree, type RepoLang, type TreeListResult } from '../../lib/repoApi'
import { repoFailureText } from '../../lib/repoErrorText'
import { useIsMobile } from '../../hooks/useIsMobile'

export interface RepoTreeViewProps {
  sessionId: string
  tree: TreeNode
  onTreeChange: (updater: (prev: TreeNode) => TreeNode) => void
  onOpenFile: (path: string) => void
  lang: 'pt' | 'en'
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

export function RepoTreeView({ sessionId, tree, onTreeChange, onOpenFile, lang }: RepoTreeViewProps) {
  const isMobile = useIsMobile()
  const pt = lang === 'pt'
  const rows = flattenVisible(tree)
  const state = treeViewState(tree)

  const onToggle = (path: string) => {
    void toggleDirectory(tree, path, lang, onTreeChange, p => fetchTree(sessionId, p, lang))
  }

  if (state === 'loading') {
    // The parent owns the root fetch, so it owns the sentence for it. Drawing a second loader here
    // would put two of them in one panel.
    return null
  }

  if (state === 'failed') {
    return (
      <Note
        icon={<AlertTriangle size={15} style={{ color: 'var(--accent-red)' }} />}
        text={tree.error ?? (pt ? 'Não foi possível ler esta pasta.' : 'This folder could not be read.')}
      />
    )
  }

  if (state === 'empty') {
    return (
      <Note
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
      style={{
        flex: 1, minHeight: 0, minWidth: 0,
        overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
        padding: '4px 0',
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
          return (
            <div role="listitem" aria-level={row.depth + 1} key={row.path}>
              <Row
                row={row}
                indent={indent}
                isMobile={isMobile}
                onActivate={() => (row.kind === 'dir' ? onToggle(row.path) : onOpenFile(row.path))}
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
    </div>
  )
}

/**
 * One row.
 *
 * `box-sizing: border-box` is load-bearing, not tidiness: the indent is LEFT PADDING on a
 * `width: 100%` button, so without it every level of depth would push the row wider than its column
 * and the panel would scroll sideways — the thing CLAUDE.md requires to hold at 390px.
 */
function Row({ row, indent, isMobile, onActivate }: {
  row: FlatRow
  indent: number
  isMobile: boolean
  onActivate: () => void
}) {
  const isDir = row.kind === 'dir'
  const glyph = 13
  return (
    <button
      type="button"
      {...(isDir ? { 'aria-expanded': row.expanded } : {})}
      title={row.path}
      onClick={onActivate}
      onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        width: '100%', boxSizing: 'border-box', minWidth: 0, textAlign: 'left',
        // 44px on a phone is the touch-target floor; a desktop row stays as dense as every other
        // list in this aside.
        minHeight: isMobile ? 44 : undefined,
        padding: isMobile ? '6px 12px' : '3px 10px', paddingLeft: indent,
        background: 'transparent', border: 'none', borderRadius: 0,
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
      <span style={{ flexShrink: 0, display: 'inline-flex', color: isDir ? 'var(--anthropic-orange)' : 'var(--text-tertiary)' }}>
        {isDir
          ? (row.expanded ? <FolderOpen size={glyph} /> : <Folder size={glyph} />)
          : <File size={glyph} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.name}
      </span>
    </button>
  )
}

/** The one empty-region shape, so the three sentences differ only in what they SAY. */
function Note({ text, icon }: { text: string; icon: ReactNode }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px 18px',
    }}>
      <p style={{
        margin: 0, fontSize: 12, lineHeight: 1.6, textAlign: 'center', color: 'var(--text-tertiary)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}>
        {icon}
        {text}
      </p>
    </div>
  )
}
