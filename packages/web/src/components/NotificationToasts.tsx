import React, { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Info, CheckCircle2, X } from 'lucide-react'
import { useNotifications, dismissNotification, type AppNotification, type NotificationType } from '../lib/notifications'

const TOAST_MS = 3000

const STYLE: Record<NotificationType, { color: string; Icon: typeof AlertCircle }> = {
  error:   { color: '#ef4444', Icon: AlertCircle },
  warning: { color: '#f59e0b', Icon: AlertTriangle },
  info:    { color: '#3b82f6', Icon: Info },
  success: { color: '#22c55e', Icon: CheckCircle2 },
}

/**
 * Fixed overlay that pops each NEW notification as a toast, auto-dismissing after 3s.
 * The notification itself stays in the store (bell) — only the popup is transient.
 */
export function NotificationToasts() {
  const notes = useNotifications()
  const [toasts, setToasts] = useState<AppNotification[]>([])
  const seen = useRef<Set<string>>(new Set())
  const initialized = useRef(false)

  useEffect(() => {
    // On first run, treat everything already in the store as seen so we don't
    // replay historical notifications as toasts on mount.
    if (!initialized.current) {
      initialized.current = true
      for (const n of notes) seen.current.add(n.id)
      return
    }
    for (const n of notes) {
      if (seen.current.has(n.id)) continue
      seen.current.add(n.id)
      setToasts(t => [n, ...t])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== n.id)), TOAST_MS)
    }
  }, [notes])

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 4000,
      display: 'flex', flexDirection: 'column', gap: 10,
      maxWidth: 'min(360px, calc(100vw - 32px))', pointerEvents: 'none',
    }}>
      {toasts.map(n => {
        const { color, Icon } = STYLE[n.type]
        return (
          <div
            key={n.id}
            style={{
              pointerEvents: 'auto',
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '11px 12px', borderRadius: 10,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderLeft: `3px solid ${color}`,
              boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
              animation: 'toastIn 0.18s ease-out',
            }}
          >
            <Icon size={16} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</div>
              {n.message && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.45, wordBreak: 'break-word' }}>
                  {n.message}
                </div>
              )}
            </div>
            <button
              onClick={() => setToasts(t => t.filter(x => x.id !== n.id))}
              aria-label="dismiss"
              style={{
                flexShrink: 0, display: 'flex', padding: 2, border: 'none',
                background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer',
              }}
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }`}</style>
    </div>
  )
}

// Re-exported so callers can also remove from the store if desired.
export { dismissNotification }
