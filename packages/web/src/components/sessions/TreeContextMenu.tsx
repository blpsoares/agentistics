/**
 * TreeContextMenu — the right-click menu on a tree row, and the `⋯` button that opens the same
 * menu without a pointer (hover/focus on desktop, always visible at 44px on a phone — there is no
 * long-press here, because one collides with scrolling and with selecting the row's own text).
 *
 * A PORTAL, the same posture `SessionRowMenu.tsx` already takes for exactly the same reasons: it
 * must escape the tree's own `overflow: auto` clipping, it is positioned at the pointer (or at the
 * button that opened it) and flipped rather than clamped when it would run off the viewport edge —
 * a menu pinned to the screen's corner would cover the very row it belongs to — and it closes on an
 * outside `mousedown`, on `Escape`, and after any entry is taken, returning focus to what opened it.
 *
 * **THIS COMPONENT DECIDES NOTHING ABOUT WHAT AN ACTION DOES.** It renders a fixed ORDER of
 * entries and reports which one was picked; `RepoTreeView` and, above it, `Studio.tsx` own every
 * rule about create/rename/delete/move. That split is what `treeMenuEntries` exists to test on its
 * own — which entries exist for a file versus a folder, and the one entry that can be absent.
 *
 * **`onMention` IS THE ONE OPTIONAL HANDLER, AND ITS ABSENCE REMOVES THE ROW RATHER THAN GREYING
 * IT.** "Mencionar na conversa" belongs to a later package (§6 of the design this feature shipped
 * under); until that package wires a real handler in, a disabled row with no explanation would read
 * as a bug report waiting to be filed, while an absent row is simply a menu that does not yet offer
 * something nobody can use.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../../hooks/useIsMobile'

export type TreeMenuAction =
  | 'new-file' | 'new-folder' | 'rename' | 'move' | 'copy-relative-path' | 'copy-path'
  | 'mention' | 'delete'

export interface TreeMenuEntry {
  action: TreeMenuAction
  label: string
}

/**
 * The fixed order this menu draws in, for one row — the order the design states verbatim: create
 * (scoped to the row — a folder's own contents, or the row's own parent for a file), rename, move,
 * the two copy actions, mention, delete last (destructive actions read last, everywhere else in
 * this product's menus).
 *
 * **Exported and pure so the "one item, one condition" rule is testable without a portal, a pointer
 * or a render at all.** `mentionAvailable` mirrors the prop it is named after — see the file header.
 */
export function treeMenuEntries(
  kind: 'file' | 'dir', lang: 'pt' | 'en', mentionAvailable: boolean, copyPathAvailable: boolean,
): TreeMenuEntry[] {
  const pt = lang === 'pt'
  const entries: TreeMenuEntry[] = [
    { action: 'new-file', label: pt ? 'Novo arquivo' : 'New file' },
    { action: 'new-folder', label: pt ? 'Nova pasta' : 'New folder' },
    { action: 'rename', label: pt ? 'Renomear' : 'Rename' },
    { action: 'move', label: pt ? 'Mover para…' : 'Move to…' },
    { action: 'copy-relative-path', label: pt ? 'Copiar caminho relativo' : 'Copy relative path' },
  ]
  if (copyPathAvailable) entries.push({ action: 'copy-path', label: pt ? 'Copiar caminho' : 'Copy path' })
  if (mentionAvailable) entries.push({ action: 'mention', label: pt ? 'Mencionar na conversa' : 'Mention in the conversation' })
  entries.push({
    action: 'delete',
    label: kind === 'dir' ? (pt ? 'Excluir pasta' : 'Delete folder') : (pt ? 'Excluir' : 'Delete'),
  })
  return entries
}

export interface TreeContextMenuProps {
  x: number
  y: number
  kind: 'file' | 'dir'
  lang: 'pt' | 'en'
  /** Absent removes the "Mencionar na conversa" row — see the file header. */
  onMention?: () => void
  /** Absent removes the "Copiar caminho" row — see `repoTreeModel.ts`'s own note on the two copies. */
  copyPath?: () => void
  onAction: (action: Exclude<TreeMenuAction, 'mention' | 'copy-path'>) => void
  onClose: () => void
}

export function TreeContextMenu({ x, y, kind, lang, onMention, copyPath, onAction, onClose }: TreeContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const entries = treeMenuEntries(kind, lang, onMention !== undefined, copyPath !== undefined)

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  const pick = (action: TreeMenuAction) => {
    if (action === 'mention') { onMention?.(); onClose(); return }
    if (action === 'copy-path') { copyPath?.(); onClose(); return }
    onAction(action)
    onClose()
  }

  // Flipped rather than clamped — the same rule `SessionRowMenu` applies, for the same reason: a
  // menu pinned to the viewport's edge would sit on top of the row it is ABOUT.
  const w = 220
  const rowH = isMobile ? 44 : 32
  const left = typeof window === 'undefined' ? x
    : x + w > window.innerWidth ? Math.max(4, x - w) : x
  const top = typeof window === 'undefined' ? y
    : y + entries.length * rowH + 8 > window.innerHeight
      ? Math.max(4, y - (entries.length * rowH + 8))
      : y

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed', top, left, width: w, zIndex: 700,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
        padding: 4, boxShadow: 'var(--ag-shadow-pop)',
      }}
    >
      {entries.map(e => (
        <button
          key={e.action}
          type="button"
          role="menuitem"
          onClick={() => pick(e.action)}
          style={{
            display: 'flex', alignItems: 'center', width: '100%', boxSizing: 'border-box',
            minHeight: isMobile ? 44 : 0,
            padding: '8px 10px', borderRadius: 7, border: 'none', textAlign: 'left',
            background: 'transparent', fontFamily: 'inherit', fontSize: 12.5,
            color: e.action === 'delete' ? 'var(--accent-red)' : 'var(--text-primary)',
            cursor: 'pointer',
          }}
          onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
        >
          {e.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
