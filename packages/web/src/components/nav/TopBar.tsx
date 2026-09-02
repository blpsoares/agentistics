/**
 * TopBar — the fixed strip above everything, holding the three controls that must never move.
 *
 * The mark, the search button and the sidebar toggle live here rather than inside the aside, and
 * that is the whole point: the aside changes width, changes body between workspaces, and disappears
 * on mobile, so anything mounted in it moves when it does. An earlier pass put the toggle in the
 * aside and it jumped from beside the mark to beneath it every time the sidebar collapsed — the
 * control that reopens the sidebar is the one control that must be findable in the same place every
 * time.
 *
 * There are deliberately no history arrows. They were tried, they duplicated the browser's own in
 * every context except an installed PWA, and they were removed.
 */

import { Search, PanelLeft } from 'lucide-react'

export interface TopBarProps {
  lang: 'pt' | 'en'
  height: number
  /** Matches the aside beneath, so the three controls sit over its column. */
  asideWidth: number
  collapsed: boolean
  onToggleSidebar: () => void
  /**
   * Open search. Absent where there is nothing to search, and the button is then ABSENT rather than
   * disabled — a control that does nothing is indistinguishable from one that is broken.
   */
  onSearch?: () => void
}

const iconBtn: React.CSSProperties = {
  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: 'none', background: 'transparent',
  color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0,
  transition: 'background 0.15s, color 0.15s',
}

export function TopBar({ lang, height, asideWidth, collapsed, onToggleSidebar, onSearch }: TopBarProps) {
  const pt = lang === 'pt'

  const hover = (on: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const t = e.currentTarget
    t.style.color = on ? 'var(--text-primary)' : 'var(--text-tertiary)'
    t.style.background = on ? 'var(--bg-elevated)' : 'transparent'
  }

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height, zIndex: 300,
        display: 'flex', alignItems: 'center',
        padding: '0 10px', boxSizing: 'border-box',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Over the aside's own column, so the two read as one left edge whatever the width. */}
      <div style={{
        width: Math.max(0, asideWidth - 20),
        display: 'flex', alignItems: 'center', gap: 4, minWidth: 0,
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        {!collapsed && (
          <img
            src='/minimalistLogo.png'
            alt="agentistics"
            style={{ height: 26, width: 'auto', flexShrink: 0, marginRight: 'auto' }}
          />
        )}
        {onSearch && (
          <button
            onClick={onSearch}
            aria-label={pt ? 'Buscar' : 'Search'}
            title={`${pt ? 'Buscar' : 'Search'}  ·  Ctrl+K`}
            style={iconBtn} onMouseEnter={hover(true)} onMouseLeave={hover(false)}
          >
            <Search size={16} />
          </button>
        )}
        <button
          onClick={onToggleSidebar}
          aria-label={collapsed ? (pt ? 'Mostrar barra lateral' : 'Show sidebar') : (pt ? 'Ocultar barra lateral' : 'Hide sidebar')}
          title={`${collapsed ? (pt ? 'Mostrar barra lateral' : 'Show sidebar') : (pt ? 'Ocultar barra lateral' : 'Hide sidebar')}  ·  Ctrl+B`}
          style={iconBtn} onMouseEnter={hover(true)} onMouseLeave={hover(false)}
        >
          <PanelLeft size={16} />
        </button>
      </div>
    </div>
  )
}
