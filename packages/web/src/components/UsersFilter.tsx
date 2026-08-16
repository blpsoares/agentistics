import React, { useEffect, useRef, useState } from 'react'
import { Users, Check, ChevronDown } from 'lucide-react'
import type { MemberPresence } from '@agentistics/core'

interface Props {
  users: string[]
  selected: string[]
  onChange: (users: string[]) => void
  lang: 'pt' | 'en'
  presence?: Record<string, MemberPresence>
  presenceFilter?: 'online' | 'offline'
}

const T = {
  pt: { all: 'Todos os membros', online: 'Membros online', offline: 'Membros offline', selected: 'membros', selectAll: 'Selecionar tudo', clear: 'Limpar' },
  en: { all: 'All members', online: 'Online members', offline: 'Offline members', selected: 'members', selectAll: 'Select all', clear: 'Clear' },
} as const

export function UsersFilter({ users, selected, onChange, lang, presence, presenceFilter }: Props) {
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

  // Restrict the list to the active presence filter.
  const visibleUsers = presenceFilter && presence
    ? users.filter(u => (presence[u]?.online ?? false) === (presenceFilter === 'online'))
    : users

  function toggle(user: string) {
    if (selected.includes(user)) onChange(selected.filter(u => u !== user))
    else onChange([...selected, user])
  }

  const defaultLabel = presenceFilter === 'online' ? t.online : presenceFilter === 'offline' ? t.offline : t.all
  const defaultDot = presenceFilter === 'online' ? '#22c55e' : presenceFilter === 'offline' ? '#ef4444' : 'var(--text-secondary)'
  const label = selected.length === 0 ? defaultLabel : `${selected.length} ${t.selected}`
  const active = selected.length > 0
  // Tooltip lists exactly who is selected (or the default label when none is).
  const tip = selected.length === 0 ? defaultLabel : selected.join(', ')

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={tip}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 8,
          border: '1px solid var(--border)',
          background: active ? 'var(--anthropic-orange-dim, rgba(205,93,56,0.12))' : 'var(--bg-elevated)',
          color: active ? 'var(--anthropic-orange, #cd5d38)' : 'var(--text-secondary)',
          fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <Users size={14} />
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: active ? 'var(--anthropic-orange, #cd5d38)' : defaultDot,
        }} />
        <span>{label}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 600,
          minWidth: 200, maxHeight: 320, overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.4)', padding: 6,
        }}>
          <div style={{ display: 'flex', gap: 6, padding: '4px 6px 8px' }}>
            <button
              onClick={() => onChange(visibleUsers)}
              style={miniBtn}
            >{t.selectAll}</button>
            <button
              onClick={() => onChange([])}
              style={miniBtn}
            >{t.clear}</button>
          </div>
          {visibleUsers.map(user => {
            const isSel = selected.includes(user)
            return (
              <div
                key={user}
                onClick={() => toggle(user)}
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
                <span style={{
                  fontSize: 13, color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{user}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  flex: 1, padding: '5px 8px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', fontSize: 11, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
}
