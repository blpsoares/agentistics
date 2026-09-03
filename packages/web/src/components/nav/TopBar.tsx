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
 *
 * The SELECTED SESSION's title, view tabs and actions ride here too, in the space to the right of
 * the mark that this strip has always left empty. They used to be a second full-width row under the
 * filters, with its own rule across the top — a whole band of chrome for three controls, directly
 * below a band that was already there. `trailing` is deliberately an opaque node rather than
 * session-shaped props: this component knows about a left column and a right remainder, and nothing
 * about sessions.
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
  /**
   * Whatever the current screen wants in the empty half of this strip. Absent on most screens, and
   * absent is the normal case — this is a place to put something, not a slot that must be filled.
   */
  trailing?: React.ReactNode
}

const iconBtn: React.CSSProperties = {
  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: 'none', background: 'transparent',
  color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0,
  transition: 'background 0.15s, color 0.15s',
}

export function TopBar({ lang, height, asideWidth, collapsed, onToggleSidebar, onSearch, trailing }: TopBarProps) {
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
        padding: collapsed ? '0 6px 0 0' : '0 10px', boxSizing: 'border-box',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Over the aside's own column, so the two read as one left edge whatever the width. */}
      {/* Sized to the aside beneath so the two read as one left edge. Collapsed it takes the whole
          64px rather than insetting: the mark and the toggle together need 52 of it, and the inset
          that looks right at 248px is what would push the toggle out of the rail. */}
      <div style={{
        width: collapsed ? asideWidth : Math.max(0, asideWidth - 20),
        display: 'flex', alignItems: 'center', gap: collapsed ? 2 : 4, minWidth: 0,
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        {/* The mark shows in BOTH states. A collapsed sidebar is still the product's left edge, and
            an earlier pass hid it there — leaving the app with no identity anywhere on screen. */}
        <img
          src='/minimalistLogo.png'
          alt="agentistics"
          style={{ height: collapsed ? 22 : 26, width: 'auto', flexShrink: 0, marginRight: collapsed ? 0 : 'auto' }}
        />
        {/* Collapsed, the rail holds the mark and the toggle and nothing else: three controls in
            64px is three cramped controls. Search is one keystroke away (Ctrl+K) and one click away
            once the sidebar is open. */}
        {onSearch && !collapsed && (
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
          style={{ ...iconBtn, width: collapsed ? 28 : 30, height: collapsed ? 28 : 30 }}
          onMouseEnter={hover(true)} onMouseLeave={hover(false)}
        >
          <PanelLeft size={16} />
        </button>
      </div>

      {/* The remainder. `minWidth: 0` so a long session title truncates instead of pushing the
          strip wider than the window — the one thing a fixed full-width bar must never do. */}
      {trailing && (
        // 9px, not 4: the title now starts on the same vertical line as the content inside the
        // session below it, so the eye follows one edge down the page instead of two that are
        // nearly the same and therefore read as a misalignment.
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 9 }}>
          {trailing}
        </div>
      )}
    </div>
  )
}
