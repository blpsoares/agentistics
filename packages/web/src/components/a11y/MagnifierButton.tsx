/**
 * MagnifierButton.tsx — the header icon.
 *
 * Left click makes a lens; right click opens the general menu, which is the only way a MOUSE can
 * reach a pinned lens again (a pinned lens takes no pointer events at all — that is what pinning
 * means). There is no keyboard way in yet — that is Task 10.
 */
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { AppContext } from '../../lib/app-context'
import { useIsMobile } from '../../hooks/useIsMobile'
import { a11yText } from './i18n'

export function MagnifierButton({ ctx }: { ctx: AppContext }) {
  const { a11y, lang } = ctx
  const text = useMemo(() => a11yText(lang), [lang])
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (!a11y.prefs.enabled) return null

  const item: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left',
    padding: isMobile ? '12px 10px' : '7px 10px', minHeight: isMobile ? 44 : undefined,
    borderRadius: 8, border: 'none', background: 'transparent',
    color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => a11y.addLens()}
        onContextMenu={e => { e.preventDefault(); setOpen(v => !v) }}
        title={`${text.headerTitle} — ${text.headerHint}`}
        aria-label={text.headerTitle}
        aria-haspopup="menu"
        style={{
          width: isMobile ? 44 : 32, height: isMobile ? 44 : 32,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
          color: 'var(--anthropic-orange)', cursor: 'pointer', position: 'relative', flexShrink: 0,
        }}
      >
        <Search size={isMobile ? 18 : 14} />
        {a11y.lenses.length > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: 'var(--anthropic-orange)', color: '#fff',
            fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{a11y.lenses.length}</span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2147483100 }} />
          <div role="dialog" aria-label={text.headerTitle} style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 6, width: 290, zIndex: 2147483200,
            padding: 8, borderRadius: 12, background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          }}>
            <button style={item} onClick={() => { a11y.addLens(); setOpen(false) }}>{text.newLens}</button>
            <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 10px 6px' }}>{text.lensesHere}</div>
            {a11y.lenses.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '0 10px 8px' }}>{text.noLensesHere}</div>
            )}
            {a11y.lenses.map(l => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px' }}>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
                  {l.id} · {l.zoom}×{l.pinned ? ` · ${text.pin}` : ''}
                </span>
                <button style={{ ...item, width: 'auto', padding: '6px 8px' }}
                  onClick={() => { a11y.select(l.id); setOpen(false) }}>{text.select}</button>
                {l.pinned && (
                  <button style={{ ...item, width: 'auto', padding: '6px 8px' }}
                    onClick={() => a11y.updateLens(l.id, { pinned: false })}>{text.unpin}</button>
                )}
              </div>
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            <button style={item} onClick={() => { a11y.setAllPinned(false); setOpen(false) }}>{text.unpinAll}</button>
            <button style={item} onClick={() => { a11y.setAllPinned(true); setOpen(false) }}>{text.pinAll}</button>
            <button style={{ ...item, color: 'var(--accent-red)' }}
              onClick={() => { a11y.removePage(a11y.page); setOpen(false) }}>{text.removeAllHere}</button>
            <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            <button style={item} onClick={() => { a11y.toggleFollow(); setOpen(false) }}>
              {a11y.followOn ? text.followOff : text.followOn}
            </button>
            <button style={item} onClick={() => { navigate('/settings/accessibility'); setOpen(false) }}>
              {text.openSettings}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
