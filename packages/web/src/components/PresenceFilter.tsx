import React, { useEffect, useRef, useState } from 'react'
import { Radio, Check, ChevronDown } from 'lucide-react'

type Presence = 'online' | 'offline' | undefined

interface Props {
  value: Presence
  onChange: (value: Presence) => void
  onlineCount: number
  offlineCount: number
  lang: 'pt' | 'en'
}

const T = {
  pt: { all: 'Todos', online: 'Online', offline: 'Offline', label: 'Status' },
  en: { all: 'All', online: 'Online', offline: 'Offline', label: 'Status' },
} as const

/** Single-select presence filter pill (All / Online / Offline). */
export function PresenceFilter({ value, onChange, onlineCount, offlineCount, lang }: Props) {
  const t = T[lang]
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  const active = value !== undefined
  const label = value === 'online' ? t.online : value === 'offline' ? t.offline : t.all
  const dotColor = value === 'online' ? '#22c55e' : value === 'offline' ? '#ef4444' : 'var(--text-secondary)'

  const options: { key: Presence; text: string; count: number | null; color: string }[] = [
    { key: undefined, text: t.all, count: null, color: 'var(--text-secondary)' },
    { key: 'online', text: t.online, count: onlineCount, color: '#22c55e' },
    { key: 'offline', text: t.offline, count: offlineCount, color: '#ef4444' },
  ]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={`${t.label}: ${label}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 8,
          border: '1px solid var(--border)',
          background: active ? 'var(--anthropic-orange-dim, rgba(205,93,56,0.12))' : 'var(--bg-elevated)',
          color: active ? 'var(--anthropic-orange, #cd5d38)' : 'var(--text-secondary)',
          fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <Radio size={14} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
          {label}
        </span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 600,
          minWidth: 180,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.4)', padding: 6,
        }}>
          {options.map(opt => {
            const isSel = value === opt.key
            return (
              <div
                key={opt.text}
                onClick={() => { onChange(opt.key); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  background: isSel ? 'var(--anthropic-orange-dim, rgba(205,93,56,0.07))' : 'transparent',
                }}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)' }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: isSel ? '1.5px solid var(--anthropic-orange, #cd5d38)' : '1.5px solid var(--border)',
                  background: isSel ? 'var(--anthropic-orange, #cd5d38)' : 'transparent',
                }}>
                  {isSel && <Check size={11} color="#fff" strokeWidth={3} />}
                </div>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>{opt.text}</span>
                {opt.count !== null && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{opt.count}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
