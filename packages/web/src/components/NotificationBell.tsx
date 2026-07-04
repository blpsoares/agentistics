import React, { useEffect, useRef, useState } from 'react'
import { Bell, AlertCircle, AlertTriangle, Info, CheckCircle2, Trash2 } from 'lucide-react'
import { useNotifications, markAllRead, clearNotifications, resolveNotification, type NotificationType } from '../lib/notifications'

const ICON: Record<NotificationType, { color: string; Icon: typeof AlertCircle }> = {
  error:   { color: '#ef4444', Icon: AlertCircle },
  warning: { color: '#f59e0b', Icon: AlertTriangle },
  info:    { color: '#3b82f6', Icon: Info },
  success: { color: '#22c55e', Icon: CheckCircle2 },
}

function relTime(ts: number, pt: boolean): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return pt ? 'agora' : 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return pt ? `${m}min` : `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return pt ? `${h}h` : `${h}h`
  return pt ? `${Math.floor(h / 24)}d` : `${Math.floor(h / 24)}d`
}

interface Props {
  lang: 'pt' | 'en'
  /** Optional style overrides for the trigger button (to match the header's action row). */
  buttonStyle?: React.CSSProperties
}

/** Bell icon with an unread badge and a dropdown of the notification history. */
export function NotificationBell({ lang, buttonStyle }: Props) {
  const pt = lang === 'pt'
  const notes = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unread = notes.filter(n => !n.read).length

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) markAllRead() // opening the panel clears the unread badge
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={toggle}
        title={pt ? 'Notificações' : 'Notifications'}
        style={buttonStyle ?? {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 34, borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)', cursor: 'pointer', position: 'relative',
        }}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: '#ef4444', color: '#fff',
            fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxSizing: 'border-box',
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 3000,
          width: 320, maxHeight: 380, overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0,
            background: 'var(--bg-card)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
              {pt ? 'Notificações' : 'Notifications'}
            </span>
            {notes.length > 0 && (
              <button
                onClick={() => clearNotifications()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-tertiary)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <Trash2 size={11} />{pt ? 'Limpar' : 'Clear'}
              </button>
            )}
          </div>

          {notes.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>
              {pt ? 'Nenhuma notificação.' : 'No notifications.'}
            </div>
          ) : (
            notes.map(n => {
              const { color, Icon } = ICON[n.type]
              const { title, message } = resolveNotification(n, lang)
              return (
                <div key={n.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 9,
                  padding: '10px 12px', borderBottom: '1px solid var(--border)',
                }}>
                  <Icon size={15} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
                    {message && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.45, wordBreak: 'break-word' }}>
                        {message}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {relTime(n.ts, pt)}
                  </span>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
