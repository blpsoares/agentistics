import React from 'react'
import { Info, Maximize2, Minimize2 } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  accent?: string
  info?: {
    source: string
    formula?: string
    note?: string
  }
  onInfoClick?: () => void
  action?: React.ReactNode
  fullPrecision?: boolean
  onTogglePrecision?: () => void
}

export function StatCard({ label, value, sub, icon, accent = 'var(--anthropic-orange)', info, onInfoClick, action, fullPrecision, onTogglePrecision }: StatCardProps) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 22px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      position: 'relative',
      overflow: 'hidden',
      transition: 'border-color 0.2s, background 0.2s',
      height: '100%',
      boxSizing: 'border-box',
    }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = `${accent}40`
        el.style.background = 'var(--bg-card-hover)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = 'var(--border)'
        el.style.background = 'var(--bg-card)'
      }}
    >
      {/* Top accent line */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: 2,
        background: `linear-gradient(90deg, ${accent}60, ${accent}10, transparent)`,
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {action}
          {onTogglePrecision && (
            <button
              onClick={onTogglePrecision}
              title={fullPrecision ? 'Show abbreviated' : 'Show exact number'}
              style={{
                width: 18, height: 18,
                borderRadius: '50%',
                background: fullPrecision ? `${accent}20` : 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: fullPrecision ? accent : 'var(--text-tertiary)',
                padding: 0,
                transition: 'color 0.15s, background 0.15s',
              }}
            >
              {fullPrecision ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            </button>
          )}
          {info && (
            <button
              onClick={onInfoClick}
              style={{
                width: 18, height: 18,
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                cursor: onInfoClick ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-tertiary)',
                padding: 0,
                transition: 'color 0.15s',
              }}
            >
              <Info size={13} />
            </button>
          )}
          <span style={{
            width: 32, height: 32,
            borderRadius: 8,
            background: `${accent}18`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: accent,
            flexShrink: 0,
          }}>
            {icon}
          </span>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {value}
        </div>
        {sub && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  )
}
