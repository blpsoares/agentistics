import React from 'react'
import { X } from 'lucide-react'
import { useIsMobile } from '../../hooks/useIsMobile'

// Right-side slide-in panel + backdrop, full-screen on mobile.
// Shared by the governance settings pages (Users / Teams). Extracted from the
// old combined governance page so both split pages reuse the same panel.
export function Drawer({ open, title, onClose, children, footer }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode
  /** Optional action bar pinned to the bottom of the panel — for a drawer-wide save button. */
  footer?: React.ReactNode
}) {
  const isMobile = useIsMobile()
  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
        justifyContent: 'flex-end', background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: isMobile ? '100%' : 'min(680px, 94vw)',
          height: '100%',
          background: 'var(--bg-card)',
          borderLeft: isMobile ? 'none' : '1px solid var(--border)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', color: 'var(--text-tertiary)',
              cursor: 'pointer', display: 'inline-flex', padding: 4,
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          {children}
        </div>
        {footer && (
          <div style={{
            position: 'sticky', bottom: 0, zIndex: 1,
            padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)',
            display: 'flex', gap: 8, justifyContent: 'flex-end',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Drawer
