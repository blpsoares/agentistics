/**
 * TopBar — the fixed window chrome, spanning the full width ABOVE the aside.
 *
 * These icons belong to the window, not to the sidebar. They lived inside the aside for one
 * iteration and stacked into the 64px rail the moment it was collapsed — which is the tell that
 * they were never sidebar content: sidebar content shrinks with the sidebar, window chrome does not.
 *
 * Back and forward earn their place because this ships as an installed PWA, where there is no
 * browser chrome to fall back on. There is deliberately no search icon yet: in the dashboard
 * workspace it would have nothing to open, and a control that does nothing is indistinguishable
 * from one that is broken. It arrives with the session list, which is the thing there is to search.
 */

import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react'

export interface TopBarProps {
  lang: 'pt' | 'en'
  height: number
  /** Width of the aside beneath, so the mark and the toggle line up with it. */
  asideWidth: number
  collapsed: boolean
  onToggleSidebar: () => void
}

const iconBtn: React.CSSProperties = {
  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: 'none', background: 'transparent',
  color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0,
  transition: 'background 0.15s, color 0.15s',
}

export function TopBar({ lang, height, asideWidth, collapsed, onToggleSidebar }: TopBarProps) {
  const pt = lang === 'pt'
  const navigate = useNavigate()

  const hover = (on: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const t = e.currentTarget
    t.style.color = on ? 'var(--text-primary)' : 'var(--text-tertiary)'
    t.style.background = on ? 'var(--bg-elevated)' : 'transparent'
  }

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height, zIndex: 300,
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '0 10px', boxSizing: 'border-box',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
      }}
    >
      {/* The mark sits over the aside's own column, so the two read as one edge. */}
      <div style={{ width: Math.max(0, asideWidth - 20), display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <button
          onClick={onToggleSidebar}
          aria-label={collapsed ? (pt ? 'Mostrar barra lateral' : 'Show sidebar') : (pt ? 'Ocultar barra lateral' : 'Hide sidebar')}
          title={`${collapsed ? (pt ? 'Mostrar barra lateral' : 'Show sidebar') : (pt ? 'Ocultar barra lateral' : 'Hide sidebar')}  Ctrl+B`}
          style={iconBtn}
          onMouseEnter={hover(true)}
          onMouseLeave={hover(false)}
        >
          <PanelLeft size={16} />
        </button>
        <button
          onClick={() => navigate(-1)}
          aria-label={pt ? 'Voltar' : 'Back'} title={pt ? 'Voltar' : 'Back'}
          style={iconBtn} onMouseEnter={hover(true)} onMouseLeave={hover(false)}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          onClick={() => navigate(1)}
          aria-label={pt ? 'Avançar' : 'Forward'} title={pt ? 'Avançar' : 'Forward'}
          style={iconBtn} onMouseEnter={hover(true)} onMouseLeave={hover(false)}
        >
          <ArrowRight size={16} />
        </button>
      </div>
      <img
        src='/minimalistLogo.png'
        alt="agentistics"
        style={{ height: 24, width: 'auto', flexShrink: 0, opacity: 0.9 }}
      />
    </div>
  )
}
