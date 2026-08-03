import React from 'react'
import { Maximize2 } from 'lucide-react'
import { useIsMobile } from '../hooks/useIsMobile'

interface Props {
  title: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
  onExpand?: () => void
  flashId?: string
  style?: React.CSSProperties
}

export function Section({ title, children, action, onExpand, flashId, style: extraStyle }: Props) {
  const isMobile = useIsMobile()
  return (
    <div
      data-flash-id={flashId}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: isMobile ? '14px 14px' : '20px 22px',
        boxSizing: 'border-box',
        // Column flex so a card given an explicit height (e.g. two cards stretched to the same row
        // height) hands the leftover space to its CONTENT instead of leaving a dead band under it.
        display: 'flex',
        flexDirection: 'column',
        ...extraStyle,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 18,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {action}
          {onExpand && (
            <button
              onClick={onExpand}
              title="Expandir"
              style={{
                width: 24, height: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                padding: 0,
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-tertiary)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
              }}
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
      </div>
      {/* minHeight:0 so a scrollable/looser child can shrink inside the flex column rather than
          overflowing it. */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{children}</div>
    </div>
  )
}
